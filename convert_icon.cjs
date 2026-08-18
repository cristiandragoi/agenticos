const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const pngToIco = require('png-to-ico');

async function convert() {
  const buildDir = path.join(__dirname, 'build', 'icons');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const inputJpg = 'C:\\Users\\Cris\\.gemini\\antigravity\\brain\\daeb0620-8470-4c90-9551-eb2877a836e8\\media__1783893929912.jpg';
  const outPng = path.join(buildDir, 'agenticos.png');
  const outIco = path.join(buildDir, 'agenticos.ico');

  // Read JPG and resize for icon
  const image = await Jimp.read(inputJpg);
  await image.resize(256, 256).writeAsync(outPng);
  console.log('PNG generated at', outPng);

  // Convert to ICO
  const pngToIcoModule = await import('png-to-ico');
  const pngToIcoFn = pngToIcoModule.default || pngToIcoModule;
  const buf = await pngToIcoFn(outPng);
  fs.writeFileSync(outIco, buf);
  console.log('ICO generated at', outIco);
}

convert().catch(console.error);
