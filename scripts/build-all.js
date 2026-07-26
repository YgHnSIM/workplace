const path = require('path');
const { loadContentGraph } = require('../lib/content-model');
const { mergeOutputMaps, writeOutputMap } = require('../lib/build-utils');
const { renderMomOutputs } = require('../build_mom');
const { renderStatementOutputs } = require('../build_statement');
const { renderSiteOutputs } = require('../build_site');

const projectRoot = path.resolve(__dirname, '..');

function buildAll(options = {}) {
  const root = path.resolve(options.projectRoot || projectRoot);
  const graph = loadContentGraph({ projectRoot: root, allowLegacy: false });
  const outputs = mergeOutputMaps(
    renderMomOutputs(graph),
    renderStatementOutputs(graph),
    renderSiteOutputs(graph),
  );
  writeOutputMap(outputs, { projectRoot: root });
  return { graph, outputs };
}

if (require.main === module) {
  try {
    const result = buildAll();
    console.log(`Built ${result.outputs.size} output files from ${result.graph.documents.length} documents.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildAll };
