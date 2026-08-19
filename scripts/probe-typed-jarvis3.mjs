const base = 'http://127.0.0.1:4001/api';
async function main() {
  const id = process.argv[2] || 'conv-340a6ce6-';
  const msgs = await fetch(base + `/jarvis/conversations/${id}/messages`);
  const data = await msgs.json();
  console.log('status:', msgs.status);
  const messages = Array.isArray(data) ? data : data.messages;
  if (Array.isArray(messages)) {
    console.log('message count:', messages.length);
    for (const m of messages.slice(-6)) {
      const role = m.role || m.sender || m.type;
      const text = (m.content || m.text || m.message || '').toString().slice(0, 500);
      console.log(`--- [${role}] ${text}`);
    }
  } else {
    console.log('shape:', JSON.stringify(data).slice(0, 600));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
