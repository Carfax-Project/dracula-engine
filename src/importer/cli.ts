import { importGame } from './import';

const args = process.argv.slice(2);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const [game] = opt('--game'), [out] = opt('--out');

if (!game || !out) {
  console.error('usage: npm run import -- --game <GOG folder> --out <data folder> [--overlay <folder>]... [--no-videos]');
  process.exit(2);
}
const t = Date.now();
importGame({ game, out, overlays: opt('--overlay'), videos: !args.includes('--no-videos'), log: (m) => console.log(m) }).then(
  () => console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)} s`),
  (e) => { console.error((e as Error).message); process.exitCode = 1; },
);
