const { parseJarvisAction } = require('../dist/domains/jarvis/actionRuntime');

async function test() {
  const res = await parseJarvisAction('Open the notion and a genetic workflow template.', {
    activeModule: 'revenue-operator',
    activeRoute: '/revenue-operator'
  });
  console.log('Parse result for phonetic whisper transcript:', res);
}

test().catch(console.error);
