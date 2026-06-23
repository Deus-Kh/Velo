
import { io, Socket } from 'socket.io-client';

// const SOCKET_URL = 'http://localhost:9999';
const SOCKET_URL = 'http://13.63.159.111/';

let socket: Socket | null = null;
let connectPromise: Promise<Socket> | null = null;
let currentToken: string | null = null;

function resetConnectPromise() {
  connectPromise = null;
}

export function initSocket(token: string) {
  // If token changed (multi-account / relogin) -> recreate socket
  if (socket && currentToken && currentToken !== token) {
    socket.disconnect();
    socket = null;
    connectPromise = null;
  }

  if (socket) return socket;

  currentToken = token;

  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
  });

  // attach logs once per socket instance
  socket.on('connect', () => {
    resetConnectPromise();
    console.log('[socket] connected', socket?.id);
  });
  socket.on('connect_error', (e) =>
    {
      resetConnectPromise();
      console.log('[socket] connect_error', String(e?.message || e));
    },
  );
  socket.on('disconnect', (r) => {
    resetConnectPromise();
    console.log('[socket] disconnected', r);
  });

  resetConnectPromise();
  return socket;
}

export function isSocketReady(): boolean {
  return socket !== null;
}

export function getSocket(): Socket {
  if (!socket) throw new Error('Socket not initialized');
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  resetConnectPromise();
  currentToken = null;
}

/**
 * Connects socket (if needed) and resolves when 'connect' fires.
 * No polling. Only events.
 */
export function ensureSocketConnected(): Promise<Socket> {
  if (!socket) {
    return Promise.reject(new Error('Socket not initialized'));
  }

  if (socket.connected) {
    return Promise.resolve(socket);
  }

  if (connectPromise) return connectPromise;

  connectPromise = new Promise<Socket>((resolve, reject) => {
    const s = socket!;

    const cleanup = () => {
      s.off('connect', onConnect);
      s.off('connect_error', onError);
      s.off('disconnect', onDisconnectWhileConnecting);
    };

    const onConnect = () => {
      cleanup();
      resetConnectPromise();
      resolve(s);
    };

    const onError = (err: any) => {
      cleanup();
      resetConnectPromise();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onDisconnectWhileConnecting = () => {
      cleanup();
      resetConnectPromise();
      reject(new Error('Socket disconnected before connect'));
    };

    s.once('connect', onConnect);
    s.once('connect_error', onError);
    s.once('disconnect', onDisconnectWhileConnecting);

    s.connect();
  });

  return connectPromise;
}
