const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web target runs SQLite in a Worker backed by a wasm build,
// using a SharedArrayBuffer for synchronous cross-thread communication.
// Browsers only expose SharedArrayBuffer on cross-origin-isolated pages, so
// without these two headers every openDatabaseAsync() call on web hangs
// forever waiting for a worker response that can never arrive (the queue-
// backed "Saved" flow — Attendance, DPR, everything — depends on this).
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return middleware(req, res, next);
  };
};

module.exports = withNativeWind(config, { input: './global.css' });
