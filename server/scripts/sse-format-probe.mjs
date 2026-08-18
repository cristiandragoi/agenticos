// Dump the raw SSE body of one Jarvis turn to learn the wire format.
const res = await fetch('http://127.0.0.1:4600/api/jarvis/conversations/conv-fdab68cf-/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
  body: JSON.stringify({ prompt: 'Say OK', inputChannel: 'typed' }),
});
const text = await res.text();
console.log('STATUS', res.status);
console.log('LEN', text.length);
console.log(JSON.stringify(text.slice(0, 900)));
