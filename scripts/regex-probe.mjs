// Test the model-truth regex against the real profile config.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const localAppData = process.env.LOCALAPPDATA || '';
const cfgPath = path.join(localAppData, 'hermes', 'profiles', 'backend-engineer', 'config.yaml');
console.log('exists=' + existsSync(cfgPath));
const content = readFileSync(cfgPath, 'utf8');
console.log('bytes=' + content.length);
const modelBlock = content.match(/^model:\r?\n((?:[ \t]+[^\r\n]*\r?\n|\r?\n)*)/m);
console.log('block_matched=' + Boolean(modelBlock));
if (modelBlock) {
  const block = modelBlock[1];
  console.log('block=' + JSON.stringify(block.slice(0, 300)));
  const provider = block.match(/^[ \t]+provider:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || null;
  const model = block.match(/^[ \t]+default:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || null;
  console.log('provider=' + provider);
  console.log('model=' + model);
}
