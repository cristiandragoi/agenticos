import { _electron as electron } from 'playwright';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

async function main() {
  console.log('[TEST] Launching installed Electron app:', EXE_PATH);
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  console.log('[TEST] Waiting for first window...');
  const page = await app.firstWindow();
  console.log('[TEST] First window loaded. URL:', page.url());

  console.log('[TEST] Polling backend at http://127.0.0.1:4600/api/health ...');
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4600/api/health');
      if (res.ok) {
        const data = await res.json();
        console.log(`[TEST] Backend HEALTHY at attempt ${i + 1}! Status:`, data);
        healthy = true;
        break;
      } else {
        console.log(`[TEST] Attempt ${i + 1}: status ${res.status}`);
      }
    } catch (e: any) {
      console.log(`[TEST] Attempt ${i + 1}: fetch failed (${e.message})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('[TEST] Closing app...');
  await app.close();
  console.log('[TEST] Done. Result:', healthy ? 'SUCCESS' : 'FAILED');
}

main().catch((err) => {
  console.error('[TEST] ERROR:', err);
  process.exit(1);
});
