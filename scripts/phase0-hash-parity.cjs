// phase0-hash-parity.cjs — compare source-built dists vs packaged dists (recursive, hash-based).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = 'B:/AgenticOS';
const PKG = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS';

const pairs = [
  { label: 'server/dist', src: path.join(ROOT, 'server/dist'), pkg: path.join(PKG, 'resources/server/dist') },
  { label: 'renderer dist', src: path.join(ROOT, 'dist'), pkg: path.join(PKG, 'resources/app/dist') },
  { label: 'dist-electron', src: path.join(ROOT, 'dist-electron'), pkg: path.join(PKG, 'resources/app/dist-electron') },
];

function walk(base) {
  const out = {};
  if (!fs.existsSync(base)) return out;
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile()) {
        const rel = path.relative(base, p).replace(/\\/g, '/');
        const buf = fs.readFileSync(p);
        out[rel] = { size: buf.length, hash: crypto.createHash('sha1').update(buf).digest('hex') };
      }
    }
  })(base);
  return out;
}

for (const pair of pairs) {
  const src = walk(pair.src);
  const pkg = walk(pair.pkg);
  const srcKeys = Object.keys(src);
  const pkgKeys = Object.keys(pkg);
  const onlySrc = srcKeys.filter(k => !(k in pkg));
  const onlyPkg = pkgKeys.filter(k => !(k in src));
  const diff = [];
  for (const k of srcKeys) {
    if (k in pkg && src[k].hash !== pkg[k].hash) diff.push(k);
  }
  const status = (onlySrc.length === 0 && onlyPkg.length === 0 && diff.length === 0) ? 'PARITY' : 'DIVERGED';
  console.log(`\n=== ${pair.label} === ${status}`);
  console.log(`  src files: ${srcKeys.length}, pkg files: ${pkgKeys.length}`);
  if (onlySrc.length) console.log(`  only-in-src (${onlySrc.length}): ${onlySrc.slice(0, 8).join(', ')}${onlySrc.length > 8 ? ' …' : ''}`);
  if (onlyPkg.length) console.log(`  only-in-pkg (${onlyPkg.length}): ${onlyPkg.slice(0, 8).join(', ')}${onlyPkg.length > 8 ? ' …' : ''}`);
  if (diff.length) console.log(`  content-diff (${diff.length}): ${diff.slice(0, 25).join(', ')}${diff.length > 25 ? ' …' : ''}`);
}
console.log('\nDONE');
