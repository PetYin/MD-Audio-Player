import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import './build-creditlist.mjs';
await viteBuild();
for (const name of ['main', 'preload']) {
  await build({ entryPoints: [`desktop/${name}.ts`], outfile: `dist/desktop/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'node:sqlite'], sourcemap: true });
}
