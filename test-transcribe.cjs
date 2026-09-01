const fs = require('fs');
const path = require('path');
const http = require('http');

async function transcribeFile(filePath, lang) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const fileBytes = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  
  let header = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`;
  let langPart = lang ? `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${lang}` : '';
  let footer = `\r\n--${boundary}--\r\n`;
  
  const payload = Buffer.concat([
    Buffer.from(header, 'utf8'),
    fileBytes,
    Buffer.from(langPart + footer, 'utf8')
  ]);

  return new Promise((resolve) => {
    const req = http.request(
      'http://127.0.0.1:4600/api/voice/transcribe',
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length
        }
      },
      (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, data: body }); }
        });
      }
    );
    req.on('error', e => resolve({ error: e.message }));
    req.write(payload);
    req.end();
  });
}

(async () => {
  const de = await transcribeFile('docs/acceptance/audio/german_speech_sample.mp3', 'de');
  console.log('DE Transcribe:', JSON.stringify(de, null, 2));
  const ro = await transcribeFile('docs/acceptance/audio/romanian_speech_sample.mp3', 'ro');
  console.log('RO Transcribe:', JSON.stringify(ro, null, 2));
})();
