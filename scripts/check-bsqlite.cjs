// Check better-sqlite3 availability from server dir
try {
  const resolved = require.resolve('better-sqlite3');
  console.log('better-sqlite3 RESOLVED:', resolved);
} catch (e) {
  console.log('better-sqlite3 NOT FOUND from cwd, err:', e.message.split('\n')[0]);
}
