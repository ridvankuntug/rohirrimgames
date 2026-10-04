import { useEffect, useState } from 'react';
import { probeOnlineHealth } from '../services/onlineHealth';

// 'checking' until the probe settles, then 'online' or 'offline'.
// The probe is aborted on unmount so a late answer never sets state.
export function useOnlineHealth() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    const controller = new AbortController();
    probeOnlineHealth({ signal: controller.signal }).then(isOnline => {
      if (!controller.signal.aborted) setStatus(isOnline ? 'online' : 'offline');
    });
    return () => controller.abort();
  }, []);

  return status;
}
