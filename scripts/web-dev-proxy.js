#!/usr/bin/env node
// Local-only dev helper: expo-sqlite's web target needs the page itself to
// be cross-origin-isolated (COOP+COEP) for SharedArrayBuffer to exist —
// without it, every local SQLite queue write (Attendance, DPR, everything)
// hangs forever with no error, since the worker's lock buffer can never be
// constructed. The documented metro.config.js `server.enhanceMiddleware`
// fix only reaches Metro's own bundle-serving requests, not Expo Router's
// SPA-fallback middleware that serves the actual HTML document in this
// Expo CLI version — so the root page never gets the headers no matter
// what metro.config.js says. This proxy guarantees them on every response
// regardless of which internal handler served it.
//
// Usage: node scripts/web-dev-proxy.js [proxyPort] [targetPort]
// Then open http://localhost:<proxyPort> instead of the Expo web port directly.
const http = require('http');

const proxyPort = Number(process.argv[2]) || 8082;
const targetPort = Number(process.argv[3]) || 8081;

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    { hostname: 'localhost', port: targetPort, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
      });
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502);
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const proxyReq = http.request({
    hostname: 'localhost', port: targetPort, path: req.url, method: req.method, headers: req.headers,
  });
  proxyReq.on('upgrade', (proxyRes, proxySocket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('') +
      `\r\n`
    );
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.end();
});

server.listen(proxyPort, () => {
  console.log(`[web-dev-proxy] http://localhost:${proxyPort} -> http://localhost:${targetPort} (adds COOP/COEP headers)`);
});
