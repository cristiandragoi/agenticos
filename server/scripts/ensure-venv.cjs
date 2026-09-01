const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverDir = path.resolve(__dirname, '..');
const venvDir = path.join(serverDir, '.venv');
const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
const reqFile = path.join(serverDir, 'requirements.txt');

function findHostPython() {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const candidates = [
    'C:\\Python314\\python.exe',
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'C:\\Python314\\python.exe';
}

function ensureVenv() {
  if (!fs.existsSync(venvPython)) {
    console.log('[ensure-venv] Creating virtual environment at:', venvDir);
    const hostPython = findHostPython();
    execSync(`"${hostPython}" -m venv "${venvDir}"`, { stdio: 'inherit' });
  }

  // Check if dependencies are installed
  let depsOk = false;
  try {
    const probe = execSync(`"${venvPython}" -c "import edge_tts, faster_whisper; print('OK')"`, { stdio: 'pipe' }).toString();
    if (probe.trim() === 'OK') {
      depsOk = true;
    }
  } catch {}

  if (!depsOk) {
    console.log('[ensure-venv] Installing dependencies from:', reqFile);
    execSync(`"${venvPython}" -m pip install -r "${reqFile}"`, { stdio: 'inherit' });
  }

  const ver = execSync(`"${venvPython}" --version`, { stdio: 'pipe' }).toString().trim();
  console.log(`[ensure-venv] Python venv ready: ${venvPython} (${ver})`);
}

ensureVenv();
