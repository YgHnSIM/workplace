const path = require('path');
const { validateSourceTree } = require('../lib/content-model');

const projectRoot = path.resolve(__dirname, '..');
const result = validateSourceTree({ projectRoot, allowLegacy: false });

if (!result.success) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Source validation passed for ${result.data.documents.length} documents (${result.data.listedDocuments.length} listed).`);
}
