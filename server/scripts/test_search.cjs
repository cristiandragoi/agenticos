const https = require('https');

fetch('https://html.duckduckgo.com/html/?q=C+Adler+TV')
  .then(r => r.text())
  .then(html => {
    const regex = /<a class="result__url" href="([^"]+)">/g;
    let match;
    const links = [];
    while ((match = regex.exec(html)) !== null) {
      links.push(match[1]);
    }
    console.log('Links found:', links.slice(0, 10));
  })
  .catch(err => console.error(err));
