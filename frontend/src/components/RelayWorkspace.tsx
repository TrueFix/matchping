import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, LocateFixed, PanelLeft, PanelLeftClose, RefreshCw, Search, Square } from 'lucide-react';
import { WorldMap } from './WorldMap';
import { useRegion } from '@/lib/use-region';
import { latencyLabel, tone, type Location, type ScanState } from '@/types';

type WorkspaceProps = {
  state: ScanState;
  appId: string;
  setAppId: (value: string) => void;
  start: () => void;
  cancel: () => void;
  error: string;
};
type MeasurementFilter = 'all' | 'measured' | 'unavailable';
const filterNames: Record<MeasurementFilter, string> = { all: 'All locations', measured: 'Measured', unavailable: 'Unavailable' };

function statusText(scan: ScanState) {
  if (scan.phase === 'loading') return 'Loading Steam relays';
  if (scan.running) return `Checking ${scan.completed} of ${scan.locations.length}`;
  return { done: 'Scan complete', cancelled: 'Scan stopped', error: 'Scan unavailable', idle: 'Ready to scan' }[scan.phase] ?? 'Ready to scan';
}

function RelayRow({ relay, active, choose }: { relay: Location; active: boolean; choose: () => void }) {
  const bracket = relay.name.lastIndexOf(' (');
  const city = bracket < 0 ? relay.name : relay.name.slice(0, bracket);
  const context = bracket < 0 ? `${relay.relays.length} relay endpoints` : relay.name.slice(bracket + 2).replace(/\)$/, '');
  return <li>
    <button type="button" className="relay-row" aria-pressed={active} onClick={choose}>
      <span aria-hidden="true" className={`status-dot ${tone(relay)}`} />
      <span className="relay-row-place"><span className="relay-row-city" title={relay.name}>{city}</span><span className="relay-row-context">{context}</span></span>
      <span className="relay-row-result"><span className="relay-row-code">{relay.code.toUpperCase()}</span><span className={`relay-row-ping ${tone(relay)}`} title={relay.detail}>{latencyLabel(relay)}</span></span>
    </button>
  </li>;
}

export default function RelayWorkspace({ state, appId, setAppId, start, cancel, error }: WorkspaceProps) {
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [measurementFilter, setMeasurementFilter] = useState<MeasurementFilter>('all');
  const [order, setOrder] = useState('latency');
  const [selection, setSelection] = useState<string | null>(null);
  const region = useRegion();
  const replies = state.locations.filter(location => location.latency !== null);
  const fastest = replies.reduce<Location | null>((best, candidate) => !best || candidate.latency! < best.latency! ? candidate : best, null);
  const pending = state.locations.filter(location => location.status === 'pending').length;
  const missing = state.locations.filter(location => location.status === 'timeout').length;
  const problem = error || state.error || state.warning;
  const displayed = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const matching = state.locations.filter(location => {
      const matchesStatus = measurementFilter === 'all' || (measurementFilter === 'measured' ? location.status === 'measured' : location.status !== 'measured' && location.status !== 'pending');
      return matchesStatus && `${location.name} ${location.code}`.toLocaleLowerCase().includes(search);
    });
    return matching.sort((left, right) => order === 'name' ? left.name.localeCompare(right.name) :
      (left.latency ?? Infinity) - (right.latency ?? Infinity) || left.name.localeCompare(right.name));
  }, [state.locations, query, measurementFilter, order]);
  const progress = state.locations.length ? state.completed / state.locations.length * 100 : 0;

  function choose(code: string) {
    region.interact();
    setSelection(current => current === code ? null : code);
  }

  return <div className="relay-layout workspace-layout">
    <nav className="map-toolbar" aria-label="Relay explorer controls">
      <button type="button" className="workspace-button panel-toggle" aria-label={listOpen ? 'Hide locations' : 'Show locations'} aria-expanded={listOpen} aria-controls="relay-panel" onClick={() => setListOpen(value => !value)}>
        {listOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}Locations
      </button>
      <span className="toolbar-game">{state.appId === 730 ? 'Counter-Strike 2' : `App ${state.appId}`}</span>
      <span className="toolbar-status" aria-live="polite"><i aria-hidden="true" className={`status-dot ${state.running ? 'moderate' : state.phase === 'done' ? 'good' : 'unknown'}`} />{statusText(state)}{query || measurementFilter !== 'all' ? ' · Filtered' : ''}</span>
      <button type="button" className="fastest-shortcut" disabled={!fastest} title={fastest?.name ?? 'Waiting for measured replies'} aria-label={fastest ? `Locate fastest relay: ${fastest.name}` : 'Fastest relay not measured yet'} onClick={() => {
        if (fastest) { setQuery(''); setMeasurementFilter('all'); choose(fastest.code); }
      }}><span className="fastest-label">Lowest ping</span><strong className={fastest ? tone(fastest) : ''}>{fastest ? `${Math.round(fastest.latency!)} ms` : '— ms'}</strong><ArrowUpRight size={14} /></button>
      <details className="region-settings" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
        <summary aria-label="Region settings" title="Region and automatic startup focus"><LocateFixed size={16} /><span role="status">{region.locating ? 'Finding region…' : region.region ? `${region.region.country} · ${region.region.continent}` : 'World view'}</span><ChevronDown size={13} /></summary>
        <div className="region-popover">
          <div className="region-location"><strong>Your region</strong><button type="button" className="workspace-button" disabled={region.locating} aria-label="Find my region" aria-describedby="region-notice" onClick={() => { setSelection(null); region.find(); }}>Recenter</button></div>
          <label className="auto-region"><input type="checkbox" aria-label="Auto region on startup" checked={region.enabled} onChange={event => region.setEnabled(event.target.checked)} aria-describedby="region-notice" />Automatically focus on startup</label>
          <p id="region-notice" className="region-privacy">Public IP location via ipwho.is. Approximate; VPNs affect results.</p>
        </div>
      </details>
      <button type="button" className={`workspace-button scan-action ${state.running ? 'scan-stop' : 'scan-start'}`} onClick={state.running ? cancel : start}>{state.running ? <><Square size={16} />Stop scan</> : <><RefreshCw size={16} />Scan network</>}</button>
    </nav>

    {problem && !listOpen && <div className="notice" role="alert">{problem}</div>}
    {region.error && <div className="notice" role="alert">Region lookup unavailable. {region.error} You can still explore the map.</div>}

    <div className="relay-body">
      <section className="atlas-area" aria-label="Connection atlas">
        <h2 className="sr-only">Connection atlas</h2>
        <div className="progress-track" role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={state.locations.length || 1} aria-valuenow={state.completed}><div style={{ width: `${progress}%` }} /></div>
        <div className="map-stage">
          <WorldMap locations={displayed} selected={selection} onSelect={choose} regionFocus={region.focus} onInteract={region.interact} />
          <div className="legend" aria-label="Ping color guide">{[['good', 'Under 60 ms'], ['moderate', '60–129 ms'], ['high', '130+ ms'], ['unknown', 'Unmeasured']].map(([color, label]) => <span key={color}><i aria-hidden="true" className={`status-dot ${color}`} />{label}</span>)}</div>
        </div>
      </section>

      {listOpen && <aside id="relay-panel" className="panel relay-panel" aria-label="Relay locations">
        <div className="panel-settings">
          <div className="panel-title"><h2>Relay locations</h2><span className="location-count">{state.locations.length} worldwide</span></div>
          <p className="panel-scan-status">{state.phase === 'loading' ? 'Fetching Steam configuration…' : statusText(state)}</p>
          <form className="app-form" onSubmit={event => { event.preventDefault(); start(); }}>
            <label htmlFor="app-id">App ID</label><input id="app-id" inputMode="numeric" pattern="[0-9]+" required value={appId} onChange={event => setAppId(event.target.value)} aria-describedby="app-hint" />
            <button className="workspace-button scan-start" type="submit"><ArrowUpRight size={16} />Load app</button>
          </form>
          <p id="app-hint" className="app-hint">Public SDR data required. CS2 uses App ID 730.</p>
          <p className="panel-explainer">Selecting a relay shows its measurements and endpoint. It never changes your matchmaking region.</p>
          <label className="search"><Search aria-hidden="true" size={16} /><input type="text" aria-label="Search locations" placeholder="Search city or relay code…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="measurement-filters" role="group" aria-label="Filter locations by measurement">{(Object.keys(filterNames) as MeasurementFilter[]).map(value => <button type="button" key={value} aria-pressed={measurementFilter === value} onClick={() => setMeasurementFilter(value)}>{filterNames[value]}</button>)}</div>
          {problem && <div className="notice" role="alert">{problem}</div>}
        </div>
        <div className="sort-row"><span>{displayed.length} locations{state.stale ? ' · Cached data' : ''}</span><select aria-label="Sort locations" value={order} onChange={event => setOrder(event.target.value)}><option value="latency">Lowest latency first</option><option value="name">Name A–Z</option></select></div>
        <div className="relay-list" tabIndex={0} aria-label="Relay location list">
          <ul className="relay-items">{displayed.map(location => <RelayRow key={location.code} relay={location} active={selection === location.code} choose={() => choose(location.code)} />)}</ul>
          {!displayed.length && <p className="empty">{state.phase === 'loading' ? 'Loading relay locations from Steam…' : query || measurementFilter !== 'all' ? 'No locations match these filters.' : 'Load an App ID to explore its relay network.'}</p>}
        </div>
        <div className="panel-results-footer"><p className="panel-results"><strong>{replies.length}/{state.locations.length}</strong> replies · <strong>{missing}</strong> no ICMP reply{pending ? ` · ${pending} pending` : ''}</p><p className="panel-limit">No reply? Some relays block ICMP. Try scanning again before drawing conclusions.</p></div>
      </aside>}
    </div>
  </div>;
}
