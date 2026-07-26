const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadContentGraph,
  validateRoute,
  validateSourceTree,
} = require('../lib/content-model');
const { buildAll } = require('../scripts/build-all');

const projectRoot = path.resolve(__dirname, '..');
const temporaryDirectories = [];

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-content-model-'));
  temporaryDirectories.push(root);
  fs.cpSync(path.join(projectRoot, '_source'), path.join(root, '_source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notice'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'notice', '2025-performance-pay.jpg'),
    path.join(root, 'notice', '2025-performance-pay.jpg'),
  );
  return root;
}

function readCatalog(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '_source', 'catalog.json'), 'utf8'));
}

function writeCatalog(root, catalog) {
  fs.writeFileSync(path.join(root, '_source', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

test.after(() => {
  temporaryDirectories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

test('content graph exposes one v2 record set and the public listing policy', () => {
  const graph = loadContentGraph({ projectRoot });
  assert.equal(graph.documents.length, 14);
  assert.equal(graph.listedDocuments.length, 12);
  assert.equal(graph.documentsById.get('statement:성명서_202607').route, 'statement/성명서_202607.html');
  assert.equal(graph.documentsById.get('knowledge:retirement-benefit-db-dc-guide').workflow.visibility, 'unlisted');
  assert.equal(graph.documentsById.get('knowledge:sick-leave-double-reduction').workflow.visibility, 'unlisted');
  graph.documents.forEach((document) => {
    ['href', 'date', 'excerpt', 'topics', 'sourceCount', 'provenance', 'relatedDocuments', 'groupOrder', 'order', 'sortKey']
      .forEach((legacyField) => assert.equal(Object.hasOwn(document, legacyField), false, `${legacyField} should not be in v2`));
  });
  const categoryCounts = Object.groupBy(graph.listedDocuments, (document) => document.category);
  assert.equal(categoryCounts.statement.length, 1);
  assert.equal(categoryCounts.mom.length, 7);
  assert.equal(categoryCounts.knowledge.length, 2);
  assert.equal(categoryCounts.notice.length, 2);
});

test('source validation returns located errors for invalid types and unknown fields', () => {
  const root = fixtureRoot();
  const catalog = readCatalog(root);
  catalog.documents[0].title = 42;
  catalog.documents[0].route = 42;
  catalog.documents[0].presentation.print.titleLines = 'not-an-array';
  catalog.documents[0].unexpected = true;
  writeCatalog(root, catalog);
  const result = validateSourceTree({ projectRoot: root });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((error) => error.includes('/documents/0/title')));
  assert.ok(result.errors.some((error) => error.includes('/documents/0/route')));
  assert.ok(result.errors.some((error) => error.includes('titleLines')));
  assert.ok(result.errors.some((error) => error.includes('must NOT have additional properties')));
});

test('all renderers return a single-root output map for a fixture project', () => {
  const root = fixtureRoot();
  fs.cpSync(path.join(projectRoot, 'assets'), path.join(root, 'assets'), { recursive: true });
  const result = buildAll({ projectRoot: root });
  assert.equal(result.outputs.size, 21);
  assert.ok(result.outputs.has(path.join(root, 'index.html')));
  assert.ok(result.outputs.has(path.join(root, 'MoM', '202607.html')));
  assert.ok(result.outputs.has(path.join(root, 'knowledge', 'performance-bonus-average-wage-analysis.html')));
});

test('source validation fails before an existing output can be overwritten', () => {
  const root = fixtureRoot();
  fs.cpSync(path.join(projectRoot, 'assets'), path.join(root, 'assets'), { recursive: true });
  const sentinel = 'existing generated output\n';
  fs.writeFileSync(path.join(root, 'index.html'), sentinel, 'utf8');
  const catalog = readCatalog(root);
  catalog.documents[0].title = 99;
  writeCatalog(root, catalog);
  assert.throws(() => buildAll({ projectRoot: root }), /title/);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), sentinel);
});

test('source validation rejects unsafe routes, missing relationships, and incomplete evidence', () => {
  const root = fixtureRoot();
  const catalog = readCatalog(root);
  catalog.documents[0].route = 'knowledge/../notice/%E1.html?x=1';
  catalog.documents[0].relatedDocumentIds = ['knowledge:missing'];
  catalog.documents[0].evidence = {
    count: 1,
    note: 'Fixture',
    noteVisibility: 'public',
    sourceIds: ['missing-source', 'another-source'],
    complete: true,
  };
  writeCatalog(root, catalog);
  const result = validateSourceTree({ projectRoot: root });
  assert.equal(result.success, false);
  assert.ok(result.errors.some((error) => error.includes('.route')));
  assert.ok(result.errors.some((error) => error.includes('unknown document')));
  assert.ok(result.errors.some((error) => error.includes('unknown source')));
  assert.ok(result.errors.some((error) => error.includes('cannot exceed evidence.count')));
});

test('route validator rejects traversal, query, fragments, schemes, and encoded paths', () => {
  const invalidRoutes = [
    '../knowledge/example.html',
    'knowledge/../example.html',
    'knowledge/example.html?draft=1',
    'knowledge/example.html#part',
    'https://example.com/example.html',
    'knowledge/%65xample.html',
  ];
  invalidRoutes.forEach((route) => {
    const errors = [];
    assert.equal(validateRoute(route, 'knowledge', 'fixture', errors), undefined, route);
    assert.ok(errors.length > 0, route);
  });
});
