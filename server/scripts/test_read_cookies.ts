import Database from 'better-sqlite3';
import fs from 'fs';

const srcCookie = 'C:\\Users\\cd-pr\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Network\\Cookies';
const tmpCookie = 'C:\\Users\\cd-pr\\AppData\\Local\\Temp\\chrome_cookies_copy';

try {
  fs.copyFileSync(srcCookie, tmpCookie);
  const db = new Database(tmpCookie, { readonly: true });
  const rows = db.prepare("SELECT host_key, name, value, length(encrypted_value) as enc_len, datetime(expires_utc/1000000-11644473600,'unixepoch') as exp FROM cookies WHERE host_key LIKE '%freecash%'").all();
  console.log(`Found ${rows.length} freecash cookies in Default profile:`);
  for (const r of rows) {
    console.log(` - ${r.host_key}: ${r.name} (enc_len: ${r.enc_len}, expires: ${r.exp})`);
  }
  db.close();
} catch (e: any) {
  console.log('Error reading Cookies DB:', e.message);
}
