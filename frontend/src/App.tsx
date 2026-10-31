import { useEffect, useRef, useState } from 'react';
import { Download, HelpCircle, ShieldCheck, X } from 'lucide-react';
import { api } from './api';
import { Button } from './components/ui/button';
import RelayWorkspace from './components/RelayWorkspace';
import type { BuildInfo, ScanState, Update } from './types';

const initial: ScanState = { id: 0, appId: 730, running: false, phase: 'idle', locations: [], completed: 0, revision: 0, fetchedAt: '', stale: false, warning: '', error: '' };
export default function App() {
  const [info, setInfo] = useState<BuildInfo>({ version: '…', repository: '', appId: 730 });
  const [state, setState] = useState(initial);
  const [appId, setAppId] = useState('730');
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [updateMessage, setUpdateMessage] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const gen = generation.current;
      try {
        const next = await api.state();
        if (mounted && gen === generation.current) setState(prev => next.id >= prev.id && JSON.stringify(next) !== JSON.stringify(prev) ? next : prev);
      } catch (err) { if (mounted) setError(`Backend connection: ${String(err)}`); }
      if (mounted) timer = setTimeout(poll, 700);
    }
    api.info().then(async data => {
      if (!mounted) return;
      setInfo(data); setAppId(String(data.appId));
      await api.start(data.appId);
      if (mounted) poll();
    }).catch(err => { if (mounted) setError(String(err)); });
    return () => { mounted = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHelp(false); setUpdateOpen(false); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  async function start() {
    if (!/^\d+$/.test(appId) || !Number.isSafeInteger(Number(appId)) || Number(appId) < 1 || Number(appId) > 4294967295) {
      setError('Enter an App ID between 1 and 4294967295.'); return;
    }
    const gen = ++generation.current;
    setError('');
    try { const id = await api.start(Number(appId)); if (gen === generation.current) setState({ ...initial, id, appId: Number(appId), running: true, phase: 'loading' }); }
    catch (err) { if (gen === generation.current) setError(String(err)); }
  }
  async function cancel() {
    generation.current++;
    try { await api.cancel(); setState(await api.state()); } catch (err) { setError(String(err)); }
  }
  async function checkUpdate() {
    setUpdateOpen(true); setHelp(false); setChecking(true); setUpdateMessage(''); setUpdate(null);
    try { const result = await api.update(); setUpdate(result); setUpdateMessage(result.available ? `Version ${result.version} is available.` : 'You’re running the latest stable version.'); }
    catch (err) { setUpdateMessage(String(err).replace(/^Error: /, '')); }
    finally { setChecking(false); }
  }
  return <div className="app-frame">
    <header className="app-header">
      <div className="brand"><img className="brand-logo" src="/matchping.svg" alt="" /><h1>MatchPing</h1></div>
      <div className="header-actions"><span className="version">v{info.version}</span><Button variant="ghost" size="sm" aria-label="Check for updates" onClick={checkUpdate} disabled={checking}><Download /><span className="update-label">Check for updates</span></Button><Button variant="ghost" size="icon" aria-label="About relay measurements" aria-expanded={help} onClick={() => { setHelp(!help); setUpdateOpen(false); }}><HelpCircle /></Button></div>
    </header>
    {help && <aside className="help-panel" aria-label="About MatchPing"><div className="flex items-center justify-between"><h2>About your measurements</h2><Button size="icon" variant="ghost" aria-label="Close help" onClick={() => setHelp(false)}><X /></Button></div><p>Compare your connection to Steam’s relay network. The default App ID is 730 (Counter-Strike 2); other games need public SDR configuration.</p><h3>What the ping means</h3><p>The median of up to three ICMP replies from a responding relay, measured using your system’s ping utility. It is not in-game latency. No reply does not mean a relay is offline.</p><h3>Your region & privacy</h3><p>Automatic region focus contacts ipwho.is on startup using your connection’s public IP. Open region settings to disable automatic startup focus. Location stays in memory for 30 minutes; it is not saved or logged. VPNs affect the result.</p><h3>Read-only by design</h3><p>No firewall changes, matchmaking restrictions or automatic update installation. Steam’s coordinates can be inaccurate, and relay locations are not a guaranteed list of matchmaking regions.</p><p>Map: Natural Earth (public domain). Measurements: Steam SDR / system ICMP. No analytics or telemetry.</p></aside>}
    {updateOpen && <aside className="help-panel" aria-label="Application updates" role="status"><div className="flex items-center justify-between"><h2>Application updates</h2><Button size="icon" variant="ghost" aria-label="Close updates" onClick={() => setUpdateOpen(false)}><X /></Button></div><p>Installed: v{info.version}</p><p>{checking ? 'Checking the official GitHub release feed…' : updateMessage}</p>{update?.available && <><p>Download the new build from GitHub, then close this app before replacing it. Published release files include SHA-256 checksums.</p><Button onClick={() => api.openRelease(info.repository).catch(err => setUpdateMessage(String(err)))}><Download />Download update</Button></>}</aside>}
    <main className="workspace"><RelayWorkspace state={state} appId={appId} setAppId={setAppId} start={start} cancel={cancel} error={error} /></main>
    <footer className="app-footer"><span aria-live="polite"><span className="status-dot" />{state.stale ? 'Cached configuration' : state.revision ? `Steam configuration · rev ${state.revision}` : 'Steam SDR configuration'}{state.fetchedAt && !state.fetchedAt.startsWith('0001') ? ` · ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span><span className="footer-note"><ShieldCheck size={13} />Read-only · Relay ping is not in-game latency</span></footer>
  </div>;
}
