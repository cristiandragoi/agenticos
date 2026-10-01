const { exec } = require('child_process');
const t0 = Date.now();
const scriptPath = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\server\\scripts\\list_desktop_windows.ps1';
exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, (err, stdout, stderr) => {
  console.log('Execution took:', Date.now() - t0, 'ms');
  if (err) console.error('Error:', err.message);
  console.log('Stdout length:', stdout?.length);
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout.trim());
      console.log('Parsed windows count:', parsed.length);
    } catch (e) {
      console.error('Parse error:', e.message, 'Output was:', stdout.slice(0, 200));
    }
  }
});
