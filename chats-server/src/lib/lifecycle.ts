/**
 * Process lifecycle (T4.2): one shutdown path for signals and crashes, run
 * under a process manager that restarts on a non-zero exit (systemd unit in
 * deploy/systemd/velo-server.service).
 *
 * Order on shutdown: stop accepting HTTP connections → close the socket.io
 * server (disconnects clients so they reconnect to the next process) →
 * close Redis → disconnect MongoDB → exit. A second signal while a shutdown
 * is in progress is ignored; a step that throws is logged and the exit code
 * becomes 1; a step that hangs is cut by a force-exit timer so a wedged
 * dependency can never keep a dead process alive.
 */
export type LifecycleDeps = {
  /** Stop accepting new connections and wait for the listener to close. */
  stopAccepting: () => Promise<void>;
  /** Disconnect every socket.io client and close the io server. */
  closeSockets: () => void | Promise<void>;
  closeRedis: () => Promise<void>;
  disconnectDb: () => Promise<void>;
  exit: (code: number) => void;
  log: (message: string) => void;
  /** Hard deadline for the whole sequence; systemd's TimeoutStopSec must be longer. */
  timeoutMs?: number;
  /** Injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void } | unknown;
  clearTimer?: (handle: unknown) => void;
};

export type Lifecycle = {
  /** Runs the sequence once; later calls resolve without doing anything. */
  shutdown: (reason: string, code?: number) => Promise<void>;
  /** Wires SIGTERM/SIGINT (clean exit 0) and crash events (exit 1 → the manager restarts). */
  install: (proc: NodeJS.EventEmitter) => void;
  readonly inProgress: boolean;
};

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout));
  let inProgress = false;

  async function step(name: string, fn: () => void | Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      deps.log('[server] shutdown step failed (' + name + '): ' + ((e as Error)?.message ?? String(e)));
      return false;
    }
  }

  const shutdown = async (reason: string, code = 0): Promise<void> => {
    if (inProgress) {
      deps.log('[server] shutdown already in progress, ignoring ' + reason);
      return;
    }
    inProgress = true;
    deps.log('[server] ' + reason + ': shutting down');

    const timer = setTimer(() => {
      deps.log('[server] shutdown exceeded ' + String(timeoutMs) + ' ms, forcing exit');
      deps.exit(code === 0 ? 1 : code);
    }, timeoutMs) as { unref?: () => void } | undefined;
    if (timer && typeof timer.unref === 'function') timer.unref();

    let clean = true;
    clean = (await step('stopAccepting', deps.stopAccepting)) && clean;
    clean = (await step('closeSockets', deps.closeSockets)) && clean;
    clean = (await step('closeRedis', deps.closeRedis)) && clean;
    clean = (await step('disconnectDb', deps.disconnectDb)) && clean;

    clearTimer(timer);
    const exitCode = clean ? code : code === 0 ? 1 : code;
    deps.log('[server] shutdown complete, exit ' + String(exitCode));
    deps.exit(exitCode);
  };

  const install = (proc: NodeJS.EventEmitter): void => {
    proc.on('SIGTERM', () => void shutdown('SIGTERM', 0));
    proc.on('SIGINT', () => void shutdown('SIGINT', 0));
    proc.on('uncaughtException', (err: unknown) => {
      deps.log('[server] uncaught exception: ' + ((err as Error)?.stack ?? String(err)));
      void shutdown('uncaughtException', 1);
    });
    proc.on('unhandledRejection', (reason: unknown) => {
      deps.log('[server] unhandled rejection: ' + ((reason as Error)?.stack ?? String(reason)));
      void shutdown('unhandledRejection', 1);
    });
  };

  return {
    shutdown,
    install,
    get inProgress() {
      return inProgress;
    },
  };
}
