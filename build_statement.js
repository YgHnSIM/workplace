const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const {
  assertIsoDate,
  escapeAttr,
  escapeHtml,
  formatKoreanDate,
  readJson,
  relativeTo,
  renderPageHead,
  versionedAssetHref,
  writeTextFile,
} = require('./lib/site-utils');

const rootDir = __dirname;
const sourceDir = path.join(rootDir, '_source', 'statement');
const outputDir = path.join(rootDir, 'statement');
const catalogPath = path.join(rootDir, '_source', 'catalog.json');

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
  const titleLineCount = Array.isArray(document.titleLines) && document.titleLines.length > 0
    ? document.titleLines.length
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
  const document = { ...rawDocument };
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

  if (document.titleLines !== undefined) {
    if (!Array.isArray(document.titleLines) || document.titleLines.length < 1
      || document.titleLines.some((line) => !String(line || '').trim())) {
      throw new Error(`${document.href} titleLines must be a non-empty string array`);
    }
    document.titleLines = document.titleLines.map((line) => String(line).trim());
    if (document.titleLines.join(' ').replace(/\s+/g, ' ') !== document.title.replace(/\s+/g, ' ')) {
      throw new Error(`${document.href} titleLines must combine to the catalog title`);
    }
  }
  return document;
}

function renderStatementTitle(document) {
  const lines = document.titleLines || [document.title];
  return lines.map((line) => escapeHtml(line)).join('<br>\n        ');
}

function buildUtilityBar() {
  return `  <div class="utility-bar" id="utility-bar">
    <div class="utility-button-container">
      <button id="zoom-in-btn" aria-label="글자 크기 크게"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
      <span class="utility-tooltip">글자 크게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-out-btn" aria-label="글자 크기 작게"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
      <span class="utility-tooltip">글자 작게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-reset-btn" aria-label="글자 크기 초기화"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></button>
      <span class="utility-tooltip">기본 크기</span>
    </div>
    <div class="utility-button-container">
      <button id="copy-btn" aria-label="텍스트 복사"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
      <span class="utility-tooltip">텍스트 복사</span>
    </div>
    <div class="utility-button-container">
      <button id="copy-link-btn" aria-label="웹페이지 링크 복사"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></button>
      <span class="utility-tooltip">링크 복사</span>
    </div>
    <div class="utility-button-container">
      <button id="to-top-btn" aria-label="맨 위로 이동"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
      <span class="utility-tooltip">맨 위로</span>
    </div>
  </div>`;
}

function renderStatementHtml(rawDocument, bodyFragment, options = {}) {
  const document = validateStatementDocument(rawDocument);
  const buildRoot = path.resolve(options.rootDir || rootDir);
  const outputPath = path.resolve(options.outputPath || path.join(buildRoot, ...document.href.split('/')));
  const inspectedFragment = inspectStatementFragment(bodyFragment, options.sourcePath || document.href);
  const { metrics } = inspectedFragment;
  const automaticDensity = selectPrintDensity(metrics, document);
  const { score } = automaticDensity;
  const density = document.printDensity || automaticDensity.density;
  const logo300 = versionedAssetHref(buildRoot, outputPath, 'assets/logo-header-300.webp');
  const logo600 = versionedAssetHref(buildRoot, outputPath, 'assets/logo-header-600.webp');
  const documentTools = versionedAssetHref(buildRoot, outputPath, 'assets/document-tools.js');

  const html = `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir: buildRoot,
    outputFile: outputPath,
    title: document.title,
    description: document.excerpt,
    schemaType: 'Article',
    openGraphType: 'article',
    datePublished: document.date,
  })}
  <style>
    @page { margin: 0; size: 420mm 594mm; }
  </style>
</head>

<body>
  <a href="../index.html" class="back-link">첫 페이지로 돌아가기</a>

  <main class="statement-container document-article" id="statement-article" data-document-category="성명서" data-document-toc="false" data-print-density="${density}">
    <header class="statement-header">
      <p class="statement-identity">
        <span>차별 없는 일터</span>
        <span>병들지 않는 노동</span>
      </p>
      <span class="statement-brand-mark" aria-hidden="true">
        <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" loading="eager" decoding="sync" alt="">
      </span>
      <h1 class="statement-title">${renderStatementTitle(document)}</h1>
    </header>

    <div class="statement-body" data-copy-body>
${inspectedFragment.html}

      <div class="signature-block">
        <p class="signature-date"><time datetime="${escapeAttr(document.date)}">${escapeHtml(formatKoreanDate(document.date))}</time></p>
        <div class="signature-org-row">
          <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" loading="eager" decoding="sync" fetchpriority="high" alt="우체국물류지원단 물류노동조합" class="signature-org-logo">
        </div>
      </div>
    </div>
  </main>

${buildUtilityBar()}
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

function sourcePathForDocument(document) {
  const fileName = `${path.basename(document.href, '.html')}.body.html`;
  return path.join(sourceDir, fileName);
}

function readStatementDocuments() {
  const catalog = readJson(catalogPath);
  const documents = catalog.documents
    .filter((document) => document.category === 'statement')
    .map(validateStatementDocument);
  const seen = new Set();
  documents.forEach((document) => {
    const key = document.href.toLocaleLowerCase('en');
    if (seen.has(key)) throw new Error(`Duplicate statement href: ${document.href}`);
    seen.add(key);
  });
  return documents;
}

function assertSourceParity(documents) {
  const expected = new Set(documents.map((document) => path.basename(sourcePathForDocument(document)).toLocaleLowerCase('en')));
  const actual = fs.existsSync(sourceDir)
    ? fs.readdirSync(sourceDir)
      .filter((file) => file.endsWith('.body.html'))
      .map((file) => file.toLocaleLowerCase('en'))
    : [];
  actual.forEach((file) => {
    if (!expected.has(file)) throw new Error(`Orphan statement source: _source/statement/${file}`);
  });
}

function build() {
  const documents = readStatementDocuments();
  assertSourceParity(documents);
  documents.forEach((document) => {
    const sourcePath = sourcePathForDocument(document);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Statement source is missing: ${relativeTo(rootDir, sourcePath)}`);
    }
    const bodyFragment = fs.readFileSync(sourcePath, 'utf8');
    const outputPath = path.join(rootDir, ...document.href.split('/'));
    const rendered = renderStatementHtml(document, bodyFragment, {
      outputPath,
      rootDir,
      sourcePath: relativeTo(rootDir, sourcePath),
    });
    writeTextFile(outputPath, rendered.html);
    console.log(
      `Generated ${relativeTo(rootDir, outputPath)} from ${relativeTo(rootDir, sourcePath)} `
      + `(print density: ${rendered.density}, score: ${rendered.score})`,
    );
  });
}

module.exports = {
  PRINT_DENSITIES,
  renderStatementHtml,
  scoreStatementContent,
  selectPrintDensity,
  validateStatementDocument,
  validateStatementFragment,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
