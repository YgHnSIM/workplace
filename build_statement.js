const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const {
  assertIsoDate,
  escapeAttr,
  escapeHtml,
  formatKoreanDate,
  relativeTo,
  renderPageHead,
  versionedAssetHref,
} = require('./lib/site-utils');
const { CATEGORY_BY_ID, loadContentGraph } = require('./lib/content-model');
const { writeOutputMap } = require('./lib/build-utils');
const {
  renderBreadcrumb,
  renderDocumentTools,
  renderSiteMasthead,
} = require('./lib/site-components');

const rootDir = __dirname;
const outputDir = path.join(rootDir, 'statement');

const ALLOWED_TAGS = new Set([
  'section',
  'h2',
  'p',
  'div',
  'ol',
  'ul',
  'li',
  'strong',
  'em',
  'br',
]);
const ALLOWED_CLASSES = new Set([
  'intro-section',
  'section-title',
  'body-text',
  'no-indent',
  'demands',
  'closing-block',
  'closing-highlight',
  'closing-text',
]);
const PRINT_DENSITIES = Object.freeze({
  short: { maxScore: 1400 },
  standard: { maxScore: 2800 },
  long: { maxScore: Number.POSITIVE_INFINITY },
});

function visit(node, callback) {
  callback(node);
  (node.childNodes || []).forEach((child) => visit(child, callback));
}

function getAttribute(node, name) {
  const attribute = (node.attrs || []).find((item) => item.name === name);
  return attribute ? attribute.value : undefined;
}

function classesOf(node) {
  return new Set(String(getAttribute(node, 'class') || '').split(/\s+/).filter(Boolean));
}

function hasClass(node, className) {
  return classesOf(node).has(className);
}

function nodeText(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(nodeText).join(' ');
}

function inspectStatementFragment(fragment, sourcePath = 'statement body fragment') {
  const document = parse5.parseFragment(String(fragment || ''), { sourceCodeLocationInfo: true });
  const label = typeof sourcePath === 'string' ? sourcePath : String(sourcePath);
  const metrics = {
    sectionCount: 0,
    sectionTitleCount: 0,
    paragraphCount: 0,
    lineBreakCount: 0,
    demandCount: 0,
    closingRowCount: 0,
    characterCount: 0,
  };
  const closingBlocks = [];
  const closingParagraphs = [];
  let demandBlockCount = 0;

  visit(document, (node) => {
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') {
      throw new Error(`${label} contains unsupported comment or doctype markup`);
    }
    if (!node.tagName) return;
    if (!ALLOWED_TAGS.has(node.tagName)) {
      throw new Error(`${label} contains unsupported <${node.tagName}> markup`);
    }
    (node.attrs || []).forEach((attribute) => {
      if (attribute.name !== 'class') {
        throw new Error(`${label} contains unsupported ${attribute.name} attribute on <${node.tagName}>`);
      }
    });
    classesOf(node).forEach((className) => {
      if (!ALLOWED_CLASSES.has(className)) {
        throw new Error(`${label} contains unsupported class: ${className}`);
      }
    });

    if (node.tagName === 'section') metrics.sectionCount += 1;
    if (node.tagName === 'h2' && hasClass(node, 'section-title')) metrics.sectionTitleCount += 1;
    if (node.tagName === 'p' && hasClass(node, 'body-text')) metrics.paragraphCount += 1;
    if (node.tagName === 'br') metrics.lineBreakCount += 1;
    if (node.tagName === 'div' && hasClass(node, 'demands')) demandBlockCount += 1;
    if (node.tagName === 'li' && (node.parentNode && ['ol', 'ul'].includes(node.parentNode.tagName))) {
      let ancestor = node.parentNode;
      while (ancestor && ancestor !== document) {
        if (hasClass(ancestor, 'demands')) {
          metrics.demandCount += 1;
          break;
        }
        ancestor = ancestor.parentNode;
      }
    }
    if (node.tagName === 'div' && hasClass(node, 'closing-block')) closingBlocks.push(node);
    if (node.tagName === 'p' && (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text'))) {
      closingParagraphs.push(node);
    }
  });

  metrics.characterCount = nodeText(document).replace(/\s+/g, '').length;
  if (metrics.sectionCount < 1 || metrics.sectionTitleCount < 1 || metrics.paragraphCount < 1) {
    throw new Error(`${label} must contain sections, section-title headings, and body-text paragraphs`);
  }
  if (demandBlockCount > 1) throw new Error(`${label} may contain at most one demands block`);
  if (demandBlockCount === 1 && metrics.demandCount < 1) {
    throw new Error(`${label} demands block must contain at least one list item`);
  }
  if (closingBlocks.length !== 1) {
    throw new Error(`${label} must contain one closing block with highlights and one closing-text row`);
  }
  const closingBlock = closingBlocks[0];
  if (closingBlock.parentNode !== document) {
    throw new Error(`${label} closing block must be a top-level element`);
  }
  const closingRows = (closingBlock.childNodes || []).filter((node) => node.tagName);
  const invalidClosingText = (closingBlock.childNodes || [])
    .some((node) => node.nodeName === '#text' && String(node.value || '').trim());
  const validClosingRows = closingRows.every((node) => (
    node.tagName === 'p'
    && (hasClass(node, 'closing-highlight') || hasClass(node, 'closing-text'))
  ));
  const closingTextRows = closingRows.filter((node) => hasClass(node, 'closing-text'));
  if (invalidClosingText || !validClosingRows || closingRows.length < 2
    || closingTextRows.length !== 1 || !hasClass(closingRows.at(-1), 'closing-text')) {
    throw new Error(`${label} closing block must end with one closing-text row after its highlights`);
  }
  if (closingParagraphs.some((node) => node.parentNode !== closingBlock)) {
    throw new Error(`${label} closing rows must be direct children of the closing block`);
  }
  metrics.closingRowCount = closingRows.length;

  const topLevelElements = (document.childNodes || []).filter((node) => node.tagName);
  const invalidTopLevelNode = (document.childNodes || []).find((node) => {
    if (node.nodeName === '#text') return String(node.value || '').trim();
    if (node.tagName === 'section') return false;
    return node !== closingBlock;
  });
  if (invalidTopLevelNode || topLevelElements.at(-1) !== closingBlock) {
    throw new Error(`${label} may contain only sections followed by the closing block at the top level`);
  }

  return {
    html: parse5.serialize(document).trim(),
    metrics,
  };
}

function validateStatementFragment(fragment, sourcePath = 'statement body fragment') {
  return inspectStatementFragment(fragment, sourcePath).metrics;
}

function scoreStatementContent(metrics, document = {}) {
  const titleCharacterCount = String(document.title || '').replace(/\s+/g, '').length;
  const titleLineCount = Array.isArray(document.printTitleLines) && document.printTitleLines.length > 0
    ? document.printTitleLines.length
    : 1;
  return metrics.characterCount
    + ((metrics.paragraphCount || 0) * 45)
    + ((metrics.lineBreakCount || 0) * 35)
    + (metrics.sectionTitleCount * 120)
    + (metrics.demandCount * 85)
    + (metrics.closingRowCount * 60)
    + (titleCharacterCount * 6)
    + (Math.max(0, titleLineCount - 1) * 80);
}

function selectPrintDensity(metrics, document = {}) {
  const score = scoreStatementContent(metrics, document);
  const density = Object.entries(PRINT_DENSITIES)
    .find(([, profile]) => score <= profile.maxScore)[0];
  return { density, score };
}

function normalizeStatementHref(value) {
  const href = String(value || '').trim().replace(/\\/g, '/');
  if (!/^statement\/[^/?#]+\.html$/u.test(href) || href.split('/').includes('..')) {
    throw new Error(`Statement href must be statement/<filename>.html: ${value}`);
  }
  return href;
}

function validateStatementDocument(rawDocument) {
  const isV2 = rawDocument && rawDocument.route && rawDocument.dates && rawDocument.workflow;
  const document = isV2
    ? {
      ...rawDocument,
      href: rawDocument.route,
      date: rawDocument.dates.publishedOn,
      dateModified: rawDocument.dates.modifiedOn,
      excerpt: rawDocument.summary,
      printTitleLines: rawDocument.presentation?.print?.titleLines,
    }
    : { ...rawDocument };
  ['title', 'date', 'excerpt', 'href'].forEach((field) => {
    if (!String(document[field] || '').trim()) throw new Error(`Statement document is missing ${field}`);
  });
  document.title = String(document.title).trim();
  document.date = assertIsoDate(document.date, `statement date for ${document.href}`);
  document.excerpt = String(document.excerpt).trim();
  document.href = normalizeStatementHref(document.href);
  document.action = String(document.action || '성명서 보기').trim();
  if (document.printDensity !== undefined) {
    document.printDensity = String(document.printDensity).trim();
    if (!Object.hasOwn(PRINT_DENSITIES, document.printDensity)) {
      throw new Error(`${document.href} printDensity must be short, standard, or long`);
    }
  }

  if (document.printTitleLines !== undefined) {
    if (!Array.isArray(document.printTitleLines) || document.printTitleLines.length < 1
      || document.printTitleLines.some((line) => !String(line || '').trim())) {
      throw new Error(`${document.href} printTitleLines must be a non-empty string array`);
    }
    document.printTitleLines = document.printTitleLines.map((line) => String(line).trim());
    if (document.printTitleLines.join(' ').replace(/\s+/g, ' ') !== document.title.replace(/\s+/g, ' ')) {
      throw new Error(`${document.href} printTitleLines must combine to the catalog title`);
    }
  }
  return document;
}

function renderStatementTitle(document) {
  const lines = document.printTitleLines || [document.title];
  return lines.map((line) => `<span class="statement-title-line">${escapeHtml(line)}</span>`).join(' ');
}

function renderStatementHtml(rawDocument, bodyFragment, options = {}) {
  const document = validateStatementDocument(rawDocument);
  const record = rawDocument && rawDocument.route && rawDocument.dates && rawDocument.workflow
    ? rawDocument
    : {
      id: `statement:${path.basename(document.href, '.html')}`,
      category: 'statement',
      route: document.href,
      title: document.title,
      summary: document.excerpt,
      dates: {
        publishedOn: document.date,
        modifiedOn: document.dateModified || document.date,
        reviewedOn: document.dateModified || document.date,
        eventOn: document.date,
      },
      workflow: { status: 'final', visibility: 'public' },
      topicIds: [],
      evidence: { count: 0, note: '공개 기록', noteVisibility: 'private', sourceIds: [], complete: false },
      relatedDocumentIds: [],
      displayOrder: 0,
      presentation: { print: {} },
    };
  const buildRoot = path.resolve(options.rootDir || rootDir);
  const outputPath = path.resolve(options.outputPath || path.join(buildRoot, ...document.href.split('/')));
  const inspectedFragment = inspectStatementFragment(bodyFragment, options.sourcePath || document.href);
  const { metrics } = inspectedFragment;
  const automaticDensity = selectPrintDensity(metrics, document);
  const { score } = automaticDensity;
  const density = document.printDensity || automaticDensity.density;
  const eventDate = record.dates?.eventOn || document.date;
  const categoryLabel = CATEGORY_BY_ID.get('statement').label;
  const logo300 = versionedAssetHref(buildRoot, outputPath, 'assets/logo-header-300.webp');
  const logo600 = versionedAssetHref(buildRoot, outputPath, 'assets/logo-header-600.webp');
  const documentTools = versionedAssetHref(buildRoot, outputPath, 'assets/document-tools.js');
  const titleClass = document.title.replace(/\s+/g, '').length > 42 ? ' statement-title--long' : '';

  const html = `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir: buildRoot,
    outputFile: outputPath,
    title: document.title,
    description: document.excerpt,
    record,
    schemaType: 'WebPage',
    openGraphType: 'article',
    topicLabels: options.topicLabels || [],
    robots: record.workflow?.visibility === 'unlisted' ? 'noindex,follow' : undefined,
  })}
  <style>
    @page { margin: 18mm 0; size: 420mm 594mm; }
    @page :first { margin-top: 0; }
  </style>
</head>

<body>
${renderSiteMasthead({ rootDir: buildRoot, outputFile: outputPath })}
  <main class="statement-container document-article" id="statement-article" data-document-category="${escapeAttr(categoryLabel)}" data-print-density="${density}">
    <header class="statement-header">
${renderBreadcrumb({ rootDir: buildRoot, outputFile: outputPath, category: 'statement' })}
      <p class="statement-identity">
        <span>차별 없는 일터</span>
        <span>병들지 않는 노동</span>
      </p>
      <span class="statement-brand-mark" aria-hidden="true">
        <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" loading="eager" decoding="sync" alt="">
      </span>
      <h1 class="statement-title${titleClass}">${renderStatementTitle(document)}</h1>
    </header>

    <div class="statement-body" data-copy-body>
${inspectedFragment.html}

      <div class="signature-block">
        <p class="signature-date"><time datetime="${escapeAttr(eventDate)}">${escapeHtml(formatKoreanDate(eventDate))}</time></p>
        <div class="signature-org-row">
          <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" loading="eager" decoding="sync" fetchpriority="high" alt="우체국물류지원단 물류노동조합" class="signature-org-logo">
        </div>
      </div>
    </div>
  </main>

${renderDocumentTools()}
  <script src="${escapeAttr(documentTools)}" defer></script>
</body>

</html>
`;

  return {
    automaticDensity: automaticDensity.density,
    density,
    document,
    html,
    metrics,
    score,
  };
}

function renderStatementOutputs(graph = loadContentGraph({ projectRoot: rootDir })) {
  const outputs = new Map();
  const buildRoot = graph.projectRoot || rootDir;
  graph.documents.filter((record) => record.category === 'statement').forEach((record) => {
    const sourcePath = graph.sourcePathsById.get(record.id);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Statement source is missing: ${record.route}`);
    }
    const outputPath = path.join(buildRoot, ...record.route.split('/'));
    const rendered = renderStatementHtml(record, fs.readFileSync(sourcePath, 'utf8'), {
      outputPath,
      rootDir: buildRoot,
      sourcePath: relativeTo(buildRoot, sourcePath),
      topicLabels: record.topicIds.map((topicId) => graph.topicsById.get(topicId)?.label || topicId),
    });
    outputs.set(outputPath, rendered.html);
  });
  return outputs;
}

function build() {
  const graph = loadContentGraph({ projectRoot: rootDir });
  const outputs = renderStatementOutputs(graph);
  writeOutputMap(outputs, { projectRoot: rootDir });
  outputs.forEach((_content, outputPath) => console.log(`Generated ${relativeTo(graph.projectRoot || rootDir, outputPath)}`));
}

module.exports = {
  PRINT_DENSITIES,
  renderStatementHtml,
  scoreStatementContent,
  selectPrintDensity,
  validateStatementDocument,
  validateStatementFragment,
  renderStatementOutputs,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
