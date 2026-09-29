import { useEffect } from 'react';
import { AppState } from 'react-native';
import { sweepExpiredMessages } from './disappearing';

/**
 * T7.3: expired messages are removed when the app comes to the foreground
 * (and once at sign-in); an open chat sweeps itself every 30 s.
 */
export function useExpirySweeper(myUserId: string | null | undefined): void {
  useEffect(() => {
    if (!myUserId) return;
    const me = String(myUserId);
    const run = () => {
      sweepExpiredMessages({ myUserId: me }).catch((e) => console.warn('[disappearing] sweep failed:', e));
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [myUserId]);
}

export const CHAT_SWEEP_INTERVAL_MS = 30_000;
