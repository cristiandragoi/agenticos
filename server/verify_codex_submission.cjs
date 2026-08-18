const fs = require('fs');
const path = require('path');

const studioChatPath = path.join(__dirname, '../src/components/codex/StudioChat.tsx');
const emptyStatePath = path.join(__dirname, '../src/components/codex/StudioEmptyState.tsx');

function verifyFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let errors = [];

  // Should NOT have hardcoded 'omniRoute' in task payload
  if (content.includes("validationProvider: 'omniRoute'")) {
    errors.push(`Found hardcoded validationProvider: 'omniRoute' in ${path.basename(filePath)}`);
  }
  if (content.includes('validationProvider: runSettings.valProvider || \'omniRoute\'')) {
    errors.push(`Found hardcoded valProvider fallback in ${path.basename(filePath)}`);
  }

  // Should NOT unconditionally have disableFallback: true
  if (content.match(/executionOptions:\s*\{\s*disableFallback:\s*true\s*\}/)) {
    errors.push(`Found unconditional disableFallback: true in ${path.basename(filePath)}`);
  }

  // Should contain dynamic routing payload
  if (!content.includes('...(routing ? { routing } : {})') && !content.includes('...(runSettings.routing ? { routing: runSettings.routing } : {})')) {
    errors.push(`Missing dynamic routing spread in ${path.basename(filePath)}`);
  }

  // Should dynamically add disableFallback ONLY for forced mode
  if (!content.includes('mode === \'forced\' ? { executionOptions: { disableFallback: true } } : {}')) {
    errors.push(`Missing forced mode disableFallback check in ${path.basename(filePath)}`);
  }

  return errors;
}

console.log('--- CodeX Task Submission Verification ---');
const chatErrors = verifyFile(studioChatPath);
const emptyStateErrors = verifyFile(emptyStatePath);

const allErrors = [...chatErrors, ...emptyStateErrors];

if (allErrors.length === 0) {
  console.log('✅ SUCCESS: Task submission dynamic payload generation is correct.');
  console.log(' - Preferred mode retains fallback (disableFallback is omitted).');
  console.log(' - Forced mode correctly adds executionOptions: { disableFallback: true }.');
  console.log(' - validationProvider is only included if explicitly configured.');
  process.exit(0);
} else {
  console.error('❌ FAILED: Found the following issues:');
  allErrors.forEach(err => console.error(` - ${err}`));
  process.exit(1);
}
