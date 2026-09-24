// Bundles the Electron main, preload and renderer.
// Electron cannot run TypeScript directly, and the renderer must be a single
// file because its CSP allows only 'self' scripts.
import { build } from 'esbuild';

// Our packages are ESM and Electron's main process is CommonJS. Converting
// between them leaves `import.meta.url` undefined, which breaks any dependency
// that calls createRequire(import.meta.url) — so it is defined explicitly.
//
// This belongs to the Node builds ONLY. It was previously in the shared config,
// so the renderer bundle also began with `require('url')` — and the renderer
// runs with contextIsolation on and nodeIntegration off, where `require` does
// not exist. That line threw on load, which meant the whole renderer script
// never executed: the window painted its static HTML and then sat there with no
// address, no QR code and no activity, looking like a UI that had simply not
// been wired up.
//
// It failed silently because nothing in the main process notices, and the
// terminal entry point (`npm run serve`) prints its own QR and was the path
// actually being used. Found by Codex reading the build rather than by anyone
// watching the window.
const nodeOnly = {
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': 'import_meta_url' },
};

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'warning',
};

/**
 * Left out of the bundle on purpose.
 *
 * The Agent SDK finds its own native binary with a dynamic require -
 * `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` - which esbuild cannot
 * see, so bundling it produced a main.cjs that resolved that package from
 * `dist/` and never found it. Every agent run through the packaged app failed
 * with "native CLI binary for win32-x64 not found", while the same code run
 * unbundled through tsx worked perfectly - which is why it went undiagnosed:
 * the harness exercises the loader that works.
 *
 * Required from node_modules at runtime instead, which is also why the SDK is a
 * direct dependency of this app rather than only of agent-core.
 */
const runtimeOnly = ['electron', '@anthropic-ai/claude-agent-sdk'];

await build({
  ...common,
  ...nodeOnly,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist/main.cjs',
  external: runtimeOnly,
});
await build({
  ...common,
  ...nodeOnly,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist/preload.cjs',
  external: runtimeOnly,
});
await build({
  ...common,
  platform: 'browser',
  target: 'chrome120',
  entryPoints: ['renderer/renderer.ts'],
  outfile: 'renderer/renderer.js',
});

// Cheap, and it is the check that would have caught the above. A browser bundle
// containing `require(` is dead on arrival, and the failure is invisible from
// the main process.
import { readFileSync } from 'node:fs';
const rendered = readFileSync('renderer/renderer.js', 'utf8');
if (/\brequire\s*\(/.test(rendered)) {
  throw new Error(
    'renderer.js contains require() — it will throw on load in the renderer, where Node is not available.',
  );
}

// The same class of failure, in the other direction. If the Agent SDK is ever
// inlined again, every run through the packaged app dies with "native CLI
// binary not found" while the test harnesses keep passing, because they load
// the same code unbundled. That gap cost an afternoon of chasing the wrong
// hypotheses, so it is a build failure now rather than a runtime one.
const main = readFileSync('dist/main.cjs', 'utf8');
if (!main.includes('require("@anthropic-ai/claude-agent-sdk")')) {
  throw new Error(
    'main.cjs does not require the Agent SDK at runtime — it has been inlined, and its native binary lookup will fail.',
  );
}

console.log('built');
