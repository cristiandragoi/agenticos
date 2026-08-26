const fs = require('fs');
const path = require('path');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const dst = path.join('B:/AgenticOS/backups', `checkpoint-overnight-stabilization-${ts}`);
fs.mkdirSync(dst, { recursive: true });

const files = [
  'server/src/__tests__/jarvisConversationalSupervisor.test.ts',
  'server/src/domains/jarvis/executionSupervisor.ts',
  'server/src/domains/jarvis/coreMemory.ts',
  'server/src/domains/jarvis/conversationalAck.ts',
  'server/src/services/jarvis/progressTranslator.ts',
  'scripts/verify-jarvis-conversational-supervisor.cjs',
];

for (const f of files) {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(dst, path.basename(f)));
    console.log('Backed up:', f, '->', path.join(dst, path.basename(f)));
  }
}
console.log('Checkpoint created at:', dst);
