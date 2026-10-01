const fs = require('fs');
const buf = fs.readFileSync('C:/Users/cd-pr/OneDrive/Desktop/AgenticOS.lnk', 'latin1');
const matches = buf.match(/[A-Za-z]:\\[a-zA-Z0-9_\-\\\s\.]+\.exe/g);
console.log('Matches:', matches);
