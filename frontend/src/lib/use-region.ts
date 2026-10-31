import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { Region } from '@/types';

const preferenceKey = 'matchping.auto-region';
let pending: Promise<Region> | null = null;
function lookup() {
  // React StrictMode may mount effects twice. Share only the in-flight request;
  // successful response caching and retry cooldowns belong to the Go service.
  if (!pending) pending = api.region().finally(() => { pending = null; });
  return pending;
}

export function useRegion() {
  const [enabled, setEnabled] = useState(() => {
    try { return (localStorage.getItem(preferenceKey) ?? localStorage.getItem('server-picker.auto-region')) !== 'false'; } catch { return true; }
  });
  const [attempt, setAttempt] = useState(0);
  const [region, setRegion] = useState<Region | null>(null);
  const [focus, setFocus] = useState<Region | null>(null);
  const [locating, setLocating] = useState(enabled);
  const [error, setError] = useState('');
  const interacted = useRef(false);
  const manual = useRef(false);

  useEffect(() => {
    const explicit = manual.current;
    manual.current = false;
    if (!enabled && !explicit) { setLocating(false); return; }
    let active = true;
    setLocating(true);
    setError('');
    lookup().then(result => {
      if (!active) return;
      setRegion(result);
      // An eight-second lookup must not take the camera back from someone who
      // already started exploring, selected a relay or reset the world view.
      if (explicit || !interacted.current) setFocus({ ...result });
    }).catch(reason => {
      if (active) setError(String(reason instanceof Error ? reason.message : reason).replace(/^Error: /, ''));
    }).finally(() => { if (active) setLocating(false); });
    return () => { active = false; };
  }, [enabled, attempt]);

  return { enabled, region, focus, locating, error,
    setEnabled(value: boolean) {
      try { localStorage.setItem(preferenceKey, String(value)); } catch { /* Still usable with storage disabled. */ }
      setEnabled(value);
    },
    find() { manual.current = true; setAttempt(value => value + 1); },
    interact() { interacted.current = true; setFocus(null); },
  };
}
