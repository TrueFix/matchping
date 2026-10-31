import type { BuildInfo, ScanState, Update, Region } from './types';

type DesktopAPI = {
  FindRegion(): Promise<Region>;
  Info(): Promise<BuildInfo>; State(): Promise<ScanState>; StartScan(appId: number): Promise<number>;
  CancelScan(): Promise<void>; CheckUpdate(): Promise<Update>; OpenRelease(): Promise<void>;
};
declare global { interface Window { go?: { main?: { App?: DesktopAPI } } } }
const desktop = () => window.go?.main?.App;
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
export const api = {
  region: () => desktop()?.FindRegion() ?? request<Region>('region', {}),
  info: () => desktop()?.Info() ?? request<BuildInfo>('info'),
  state: () => desktop()?.State() ?? request<ScanState>('state'),
  start: (appId: number) => desktop()?.StartScan(appId) ?? request<number>('scan', { appId }),
  cancel: () => desktop()?.CancelScan() ?? request('cancel', {}),
  update: () => desktop()?.CheckUpdate() ?? request<Update>('update', {}),
  openRelease: async (repository: string) => {
    if (desktop()) return desktop()!.OpenRelease();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('No release repository configured');
    window.open(`https://github.com/${repository}/releases/latest`, '_blank', 'noopener,noreferrer');
  },
};
