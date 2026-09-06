// Bundles the Electron main, preload and renderer.
// Electron cannot run TypeScript directly, and the renderer must be a single
// file because its CSP allows only 'self' scripts.
import { build } from 'esbuild';

// Our packages are ESM and Electron's main process is CommonJS. Converting
// between them leaves `import.meta.url` undefined, which breaks any dependency
// that calls createRequire(import.meta.url) — so it is defined explicitly.
const shim = "const import_meta_url = require('url').pathToFileURL(__filename).href;";

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'warning',
  banner: { js: shim },
  define: { 'import.meta.url': 'import_meta_url' },
};

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist/main.cjs', external: ['electron'] });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist/preload.cjs', external: ['electron'] });
await build({
  ...common,
  platform: 'browser',
  target: 'chrome120',
  entryPoints: ['renderer/renderer.ts'],
  outfile: 'renderer/renderer.js',
});

console.log('built');
