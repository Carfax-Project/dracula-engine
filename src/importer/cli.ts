import path from 'node:path';
import { findGames } from './files';
import { importGame } from './import';

const args = process.argv.slice(2);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const [game] = opt('--game'), [out] = opt('--out');

if (!game || !out) {
  console.error('usage: npm run import -- --game <installed game, CD images, or a folder holding both games> --out <data folder> [--no-videos]');
  console.error('       with both games found, each goes to <data folder>/<game>');
  process.exit(2);
}
const games = findGames(game);
if (!games.length) {
  console.error(`no Dracula game in ${game}`);
  process.exit(1);
}
(async () => {
  for (const g of games) {
    const t = Date.now();
    await importGame({
      game: g, out: games.length > 1 ? path.join(out, g.id) : out,
      videos: !args.includes('--no-videos'), log: (m) => console.log(m),
    });
    console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
})().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
