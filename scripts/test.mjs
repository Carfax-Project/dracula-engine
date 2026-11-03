import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/test');
const tests = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts'));

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: tests.map((f) => join(root, 'test', f)), outdir: out, bundle: true, sourcemap: 'inline',
  platform: 'node', format: 'cjs', target: 'node22', external: ['ffmpeg-static'], logLevel: 'warning',
  loader: { '.glsl': 'text' },
});
const run = spawnSync(process.execPath, ['--test', ...tests.map((f) => join(out, f.replace(/\.ts$/, '.js')))], { stdio: 'inherit' });
process.exit(run.status ?? 1);
