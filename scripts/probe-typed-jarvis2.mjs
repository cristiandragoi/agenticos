const base = 'http://127.0.0.1:4001/api';
async function main() {
  // List conversations, take the latest
  const list = await fetch(base + '/jarvis/conversations');
  const convs = await list.json();
  const conv = Array.isArray(convs) ? convs[convs.length - 1] : convs;
  const id = conv?.id || conv?.conversation?.id;
  console.log('latest conversation:', id || JSON.stringify(conv).slice(0, 200));

  const msgs = await fetch(base + `/jarvis/conversations/${id}/messages`);
  const data = await msgs.json();
  const messages = Array.isArray(data) ? data : data.messages;
  if (Array.isArray(messages)) {
    console.log('message count:', messages.length);
    for (const m of messages.slice(-4)) {
      const role = m.role || m.sender || m.type;
      const text = (m.content || m.text || m.message || '').toString().slice(0, 300);
      console.log(`[${role}] ${text}`);
    }
  } else {
    console.log('messages shape:', JSON.stringify(data).slice(0, 500));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
