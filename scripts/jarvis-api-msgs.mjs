// Count + first/last of the conversation via the live API (same endpoint the GUI uses).
const base = 'http://127.0.0.1:4000/api/jarvis/conversations/conv-e110afce-/messages';
const res = await fetch(base);
const a = await res.json();
console.log('HTTP', res.status, 'COUNT:', Array.isArray(a) ? a.length : 'n/a');
if (Array.isArray(a) && a.length) {
  console.log('FIRST:', JSON.stringify({ role: a[0].role, content: (a[0].content || '').slice(0, 70), createdAt: a[0].createdAt }));
  console.log('LAST :', JSON.stringify({ role: a[a.length - 1].role, content: (a[a.length - 1].content || '').slice(0, 70), createdAt: a[a.length - 1].createdAt }));
}
