const { spawn } = require('child_process');

console.log('Starting backend server...');
const server = spawn('npx.cmd', ['tsx', 'server/src/index.ts'], { shell: true });

server.stdout.on('data', data => console.log(`[Server] ${data}`));
server.stderr.on('data', data => console.error(`[Server Error] ${data}`));

setTimeout(async () => {
  console.log('\n--- Modifying a provider (refresh auth) ---');
  
  try {
    // 1. Refresh auth (modifies the provider status to connected)
    let res = await fetch('http://localhost:4000/api/providers/prov-internal-api/refresh', { method: 'POST' });
    let data = await res.json();
    console.log('Refresh Auth Response:', data.provider.status);

    console.log('\n--- Restarting server ---');
    server.kill();
    
    // Give it a second to die
    setTimeout(() => {
      const server2 = spawn('npx.cmd', ['tsx', 'server/src/index.ts'], { shell: true });
      server2.stdout.on('data', d => console.log(`[Server2] ${d}`));

      setTimeout(async () => {
        console.log('\n--- Fetching provider after restart ---');
        try {
          let res2 = await fetch('http://localhost:4000/api/providers/prov-internal-api');
          let data2 = await res2.json();
          console.log('Provider Status after restart:', data2.status);
          
          if (data2.status === 'connected') {
            console.log('\n✅ PERSISTENCE VERIFIED!');
          } else {
            console.log('\n❌ PERSISTENCE FAILED!');
          }
        } catch (err) {
          console.error(err);
        }
        server2.kill();
        process.exit(0);
      }, 3000);
    }, 1000);

  } catch (err) {
    console.error('Error during fetch:', err);
    server.kill();
    process.exit(1);
  }
}, 3000);
