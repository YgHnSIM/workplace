const fs = require('fs');
const path = require('path');
const {
  renderPageHead,
  versionedAssetHref,
  relativeTo,
} = require('./lib/site-utils');
const { archiveHref } = require('./lib/site-components');
const { loadContentGraph } = require('./lib/content-model');
const { writeOutputMap } = require('./lib/build-utils');

const rootDir = __dirname;

function renderNewsletterHtml(document, sourceHtml, options = {}) {
  const buildRoot = path.resolve(options.rootDir || rootDir);
  const outputPath = path.resolve(options.outputPath || path.join(buildRoot, ...document.route.split('/')));
  const head = renderPageHead({
    rootDir: buildRoot,
    outputFile: outputPath,
    title: document.title,
    description: document.summary,
    record: document,
    schemaType: 'WebPage',
    openGraphType: 'article',
    topicLabels: options.topicLabels || [],
    robots: document.workflow?.visibility === 'unlisted' ? 'noindex,follow' : undefined,
    stylesheet: 'assets/newsletter.css',
  });

  const categoryArchiveHref = archiveHref(buildRoot, outputPath, 'newsletter');
  const documentToolsHref = versionedAssetHref(buildRoot, outputPath, 'assets/document-tools.js');
  const newsletterCssHref = versionedAssetHref(buildRoot, outputPath, 'assets/newsletter.css');

  let html = sourceHtml;
  html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, `<head>\n${head}\n</head>`);
  html = html.replace(/(["'])(?:\.\.\/)*assets\/newsletter\.css(?:\?v=[^"'\s>]*)?\1/g, `$1${newsletterCssHref}$1`);
  html = html.replace(/(["'])(?:\.\.\/)*assets\/document-tools\.js(?:\?v=[^"'\s>]*)?\1/g, `$1${documentToolsHref}$1`);
  html = html.replace(/href=["'](?:\.\.\/)*newsletter(?:\/index\.html|\/)?["']/g, `href="${categoryArchiveHref}"`);

  return html;
}

function renderNewsletterOutputs(graph = loadContentGraph({ projectRoot: rootDir })) {
  const outputs = new Map();
  const buildRoot = graph.projectRoot || rootDir;

  const newsletterDocs = graph.documents.filter((doc) => doc.category === 'newsletter');
  newsletterDocs.forEach((doc) => {
    const outputPath = path.join(buildRoot, ...doc.route.split('/'));
    const sourcePath = graph.sourcePathsById.get(doc.id);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Newsletter source is missing: ${doc.route}`);
    }
    const sourceHtml = fs.readFileSync(sourcePath, 'utf8');
    const topicLabels = doc.topicIds.map((id) => graph.topicsById.get(id)?.label || id);
    const rendered = renderNewsletterHtml(doc, sourceHtml, {
      rootDir: buildRoot,
      outputPath,
      topicLabels,
    });
    outputs.set(outputPath, rendered);
  });

  return outputs;
}

function build() {
  const graph = loadContentGraph({ projectRoot: rootDir });
  const outputs = renderNewsletterOutputs(graph);
  writeOutputMap(outputs, { projectRoot: rootDir });
  outputs.forEach((_content, outputPath) => console.log(`Generated ${relativeTo(rootDir, outputPath)}`));
}

module.exports = {
  renderNewsletterHtml,
  renderNewsletterOutputs,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
