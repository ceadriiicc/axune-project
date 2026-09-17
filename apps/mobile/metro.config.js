// The mobile app keeps its own node_modules (see the root package.json note), but the
// @axune/* packages are file: links to ../../packages, so Metro must watch that folder to
// transform their TypeScript sources.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const packagesRoot = path.resolve(projectRoot, '../../packages');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [packagesRoot];

// Where Metro looks for third-party modules, regardless of which file imported them.
//
// Without this, a bare import inside packages/* resolves the way Node would: by walking
// up from the importing file. `packages/secure-channel/src/index.ts` imports @noble/*, so
// the walk goes packages/secure-channel/node_modules, packages/node_modules, and out of
// the repo entirely - it never reaches apps/mobile/node_modules, because that is not an
// ancestor of the file doing the importing.
//
// Locally that still worked, because packages/secure-channel had its own node_modules
// from having been developed and tested on its own. That directory is gitignored, so the
// EAS builder never received it and the iOS build failed in the Bundle JavaScript phase
// with "Unable to resolve module @noble/ciphers/chacha" - a failure that could not be
// reproduced here until that directory was moved aside to imitate a clean checkout.
//
// secure-channel is the first local package with third-party dependencies of its own;
// protocol, shared and git-core have none, which is why this never came up before.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
