/* RO2 UI visual verification: serve packaged dist + proxy /api -> :4000 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIST = path.resolve('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/app/dist');
const PORT = 4599;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const upstream = http.request({ host: '127.0.0.1', port: 4000, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: '127.0.0.1:4000' } }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => { res.writeHead(502); res.end(String(e.message)); });
    req.pipe(upstream);
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(DIST, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(DIST, 'index.html'))); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
server.listen(PORT, () => console.log(`UI verify server on http://localhost:${PORT}/`));
