// Builds everything with esbuild (fast). Type checking: npm run typecheck.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);
const release = process.argv.includes('--release');
const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', legalComments: 'none' };

await Promise.all([
  build({ ...common, entryPoints: [r('src/main/main.ts')], outfile: r('dist/app/main.js'),
    platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [r('src/importer/cli.ts')], outfile: r('dist/app/import.js'),
    platform: 'node', format: 'cjs', target: 'node22', external: ['ffmpeg-static'] }),
  build({ ...common, entryPoints: [r('src/importer/worker.ts')], outfile: r('dist/app/import-worker.js'),
    platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'ffmpeg-static'] }),
  build({ ...common, entryPoints: [r('src/main/preload.ts')], outfile: r('dist/app/preload.js'),
    platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ ...common, entryPoints: [r('src/renderer/app.ts')], outfile: r('dist/app/renderer/app.js'),
    platform: 'browser', format: 'iife', target: 'chrome120', loader: { '.glsl': 'text' },
    define: { DEV: String(!release) }, minifySyntax: release }),
]);
mkdirSync(r('dist/app/renderer/assets'), { recursive: true });
copyFileSync(r('src/renderer/index.html'), r('dist/app/renderer/index.html'));
// Cover art and anything else the page loads by URL, served from game://app/assets/.
for (const f of readdirSync(r('src/renderer/assets'))) {
  copyFileSync(r(`src/renderer/assets/${f}`), r(`dist/app/renderer/assets/${f}`));
}
console.log('build ok');
