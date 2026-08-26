const fs = require('fs');
const path = require('path');

console.log('=== CODEX SINGLE-SHELL VERIFICATION ===\n');

let passedChecks = 0;
const totalChecks = 5;

// Check 1: App.tsx routes /codex inside AppShell
const appTsxPath = path.resolve(__dirname, '../src/App.tsx');
const appTsx = fs.readFileSync(appTsxPath, 'utf8');

const hasAppShellRoute = appTsx.includes('<Route path="/" element={<AppShell />}>') || appTsx.includes('<Route element={<AppShell />}>') || appTsx.includes('element={<AppShell />}');
const hasCodexInsideShell = appTsx.includes('<Route path="codex" element={<CodeXStudio />}');

if (hasAppShellRoute && hasCodexInsideShell) {
  console.log('[PASS] Check 1: /codex route is properly nested inside the single AppShell route');
  passedChecks++;
} else {
  console.error('[FAIL] Check 1: /codex route is not inside AppShell route');
}

// Check 2: CodeXStudio does NOT mount a second AppShell or LeftRail
const codexStudioPath = path.resolve(__dirname, '../src/pages/CodeXStudio.tsx');
const codexStudio = fs.readFileSync(codexStudioPath, 'utf8');

const hasDuplicateAppShell = codexStudio.includes('<AppShell') || codexStudio.includes('import AppShell');
const hasDuplicateLeftRail = codexStudio.includes('<LeftRail') || codexStudio.includes('import LeftRail');

if (!hasDuplicateAppShell && !hasDuplicateLeftRail) {
  console.log('[PASS] Check 2: CodeXStudio does not render duplicate AppShell or LeftRail navigation');
  passedChecks++;
} else {
  console.error('[FAIL] Check 2: CodeXStudio contains duplicate AppShell or LeftRail!');
}

// Check 3: LeftRail uses client-side React Router NavLink for Codex
const leftRailPath = path.resolve(__dirname, '../src/components/layout/LeftRail.tsx');
const leftRail = fs.readFileSync(leftRailPath, 'utf8');

const hasCodexNavLink = leftRail.includes('to="/codex"') && leftRail.includes('NavLink');
if (hasCodexNavLink) {
  console.log('[PASS] Check 3: LeftRail uses React Router client-side NavLink to /codex (no window.open or target="_blank")');
  passedChecks++;
} else {
  console.error('[FAIL] Check 3: LeftRail does not have standard NavLink to /codex');
}

// Check 4: Electron main.ts suppresses default menus and handles window opening
const mainTsPath = path.resolve(__dirname, '../electron/main.ts');
const mainTs = fs.readFileSync(mainTsPath, 'utf8');

const hasMenuNull = mainTs.includes('Menu.setApplicationMenu(null)');
const hasWindowOpenHandler = mainTs.includes('setWindowOpenHandler');
const hasSingleInstanceLock = mainTs.includes('requestSingleInstanceLock');

if (hasMenuNull && hasWindowOpenHandler && hasSingleInstanceLock) {
  console.log('[PASS] Check 4: Electron main process enforces Menu.setApplicationMenu(null), setWindowOpenHandler, and requestSingleInstanceLock');
  passedChecks++;
} else {
  console.error('[FAIL] Check 4: Electron main.ts missing Menu.setApplicationMenu(null) or setWindowOpenHandler');
}

// Check 5: No secondary window spawn in codex components
const codexComponentsDir = path.resolve(__dirname, '../src/components/codex');
const files = fs.readdirSync(codexComponentsDir);
let hasForbiddenWindowOpen = false;

for (const file of files) {
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
    const content = fs.readFileSync(path.join(codexComponentsDir, file), 'utf8');
    if (content.includes('window.open(') || content.includes('target="_blank"')) {
      // Check if it is for an external docs link or internal
      if (content.includes("window.open('/'") || content.includes('window.open("/"')) {
        hasForbiddenWindowOpen = true;
      }
    }
  }
}

if (!hasForbiddenWindowOpen) {
  console.log('[PASS] Check 5: No internal window.open calls found in CodeX workspace components');
  passedChecks++;
} else {
  console.error('[FAIL] Check 5: Found internal window.open call in CodeX workspace');
}

console.log(`\nResult: ${passedChecks}/${totalChecks} checks passed.\n`);

if (passedChecks === totalChecks) {
  console.log('CODEX SINGLE-SHELL RUNTIME VERIFIED');
  process.exit(0);
} else {
  console.error('CODEX SINGLE-SHELL VERIFICATION FAILED');
  process.exit(1);
}
