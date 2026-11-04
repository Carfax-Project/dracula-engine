// Kept free of Electron so the tests can run it with a fake fetch.
import type { UpdateInfo } from '../shared/format';

const REPO = 'Carfax-Project/dracula-engine';
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function isNewer(tag: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(tag), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function findUpdate(fetch: Fetch, current: string, format: number): Promise<UpdateInfo | null> {
  const get = (url: string) => fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': `dracula-engine/${current}`, Accept: 'application/vnd.github+json' },
  });
  const r = await get(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!r.ok) return null;
  const rel = await r.json() as { tag_name?: unknown; html_url?: unknown };
  const tag = rel.tag_name, url = rel.html_url;
  if (typeof tag !== 'string' || !/^v?\d+(\.\d+)*$/.test(tag) || !isNewer(tag, current)) return null;
  if (typeof url !== 'string' || !url.startsWith(`https://github.com/${REPO}/releases/`)) return null;
  let newFormat: number | null = null;
  try {
    const src = await get(`https://raw.githubusercontent.com/${REPO}/${tag}/src/shared/format.ts`);
    const m = src.ok ? /DATA_FORMAT = (\d+)/.exec(await src.text()) : null;
    if (m) newFormat = Number(m[1]);
  } catch { /* offline halfway: still report the release */ }
  return { version: tag.replace(/^v/, ''), url, reimport: newFormat !== null && newFormat !== format };
}
