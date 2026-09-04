// The mobile app keeps its own node_modules (see the root package.json note), but the
// @axune/* packages are file: links to ../../packages, so Metro must watch that folder to
// transform their TypeScript sources.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const packagesRoot = path.resolve(projectRoot, '../../packages');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [packagesRoot];

module.exports = config;
