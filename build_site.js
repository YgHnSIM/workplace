const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const catalogPath = path.join(rootDir, '_source', 'catalog.json');
const momManifestPath = path.join(rootDir, '_source', 'generated', 'mom.json');
const assetVersion = '20260707-1';

const categoryLabels = {
  all: '전체',
  statement: '성명서',
  mom: '회의록',
  knowledge: '지식',
  notice: '알림',
};

const categoryTitles = {
  knowledge: {
    title: '지식',
    description: '우체국물류지원단 물류노동조합 지식 자료 목록입니다.',
  },
  notice: {
    title: '알림',
    description: '우체국물류지원단 물류노동조합 알림 목록입니다.',
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeHref(href) {
  const value = String(href || '').trim().replace(/\\/g, '/');
  if (!value || value.startsWith('/') || value.startsWith('//')) {
    throw new Error(`Unsafe href in catalog: ${href}`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error(`External href is not allowed in catalog: ${href}`);
  }
  if (value.split('/').includes('..')) {
    throw new Error(`Parent directory href is not allowed in catalog: ${href}`);
  }
  return value;
}

function pageHref(docHref, outputFile) {
  const normalized = normalizeHref(docHref);
  const target = path.join(rootDir, normalized);
  if (!fs.existsSync(target)) {
    throw new Error(`Catalog target is missing: ${normalized}`);
  }
  const relative = path.relative(path.dirname(outputFile), target).replace(/\\/g, '/');
  return relative || path.basename(target);
}

function readDocuments() {
  const catalog = readJson(catalogPath);
  const manualDocs = catalog.documents.map((doc) => ({
    ...doc,
    href: normalizeHref(doc.href),
  }));

  const momDocs = readJson(momManifestPath).map((doc, index) => ({
    ...doc,
    href: normalizeHref(doc.href),
    groupOrder: 20,
    order: index,
  }));

  return [...manualDocs, ...momDocs]
    .sort((a, b) => (a.groupOrder - b.groupOrder) || (a.order - b.order));
}

function renderIconChevron() {
  return `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>`;
}

function renderCard(doc, outputFile) {
  const label = categoryLabels[doc.category] || doc.category;
  return `      <a href="${escapeAttr(pageHref(doc.href, outputFile))}" class="doc-card" data-category="${escapeAttr(doc.category)}">
        <div class="card-meta">
          <span class="badge-category">${escapeHtml(label)}</span>
          <span class="doc-date">${escapeHtml(doc.date)}</span>
        </div>
        <h2 class="doc-title">${escapeHtml(doc.title)}</h2>
        <p class="doc-excerpt">${escapeHtml(doc.excerpt)}</p>
        <div class="card-footer">
          ${escapeHtml(doc.action || `${label} 보기`)}
          ${renderIconChevron()}
        </div>
      </a>`;
}

function renderFilterBar() {
  return `    <div class="filter-bar">
      <button class="filter-btn active" id="filter-all" type="button" data-filter="all" aria-pressed="true">전체</button>
      <button class="filter-btn" id="filter-statement" type="button" data-filter="statement" aria-pressed="false">성명서</button>
      <button class="filter-btn" id="filter-mom" type="button" data-filter="mom" aria-pressed="false">회의록</button>
      <button class="filter-btn" id="filter-knowledge" type="button" data-filter="knowledge" aria-pressed="false">지식</button>
      <button class="filter-btn" id="filter-notice" type="button" data-filter="notice" aria-pressed="false">알림</button>
    </div>`;
}

function buildArchiveHtml({ title, description, docs, outputFile, includeFilter = false }) {
  const cards = docs.map((doc) => renderCard(doc, outputFile)).join('\n\n');
  const script = includeFilter ? `\n  <script src="assets/archive-filter.js?v=${assetVersion}"></script>` : '';

  return `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="icon" href="${outputFile === path.join(rootDir, 'index.html') ? '' : '../'}logo_정사각형.png" type="image/png">
  <link rel="stylesheet" href="${outputFile === path.join(rootDir, 'index.html') ? '' : '../'}assets/interface.css?v=${assetVersion}">
</head>

<body>
  <main class="archive-container">
${outputFile === path.join(rootDir, 'index.html') ? '' : '    <a href="../index.html" class="back-link">첫 페이지로 돌아가기</a>\n'}    <header class="archive-header">
      <img src="${outputFile === path.join(rootDir, 'index.html') ? '' : '../'}logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
      <h1 class="archive-title">${escapeHtml(title)}</h1>
      <p class="archive-desc">${escapeHtml(description)}</p>
    </header>

${includeFilter ? `${renderFilterBar()}\n\n` : ''}    <section class="doc-list" aria-label="${escapeAttr(title)} 목록">
${cards}
    </section>

    <footer class="archive-footer">
      <p>&copy; 2026 우체국물류지원단 물류노동조합. All rights reserved.</p>
    </footer>
  </main>${script}
</body>

</html>
`;
}

function writeFile(filePath, html) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`Generated ${path.relative(rootDir, filePath)}`);
}

function build() {
  const docs = readDocuments();
  const homePath = path.join(rootDir, 'index.html');

  writeFile(homePath, buildArchiveHtml({
    title: '아카이브',
    description: '우체국물류지원단 물류노동조합의 활동 자료 보관소입니다.',
    docs,
    outputFile: homePath,
    includeFilter: true,
  }));

  ['knowledge', 'notice'].forEach((category) => {
    const outputFile = path.join(rootDir, category, 'index.html');
    const meta = categoryTitles[category];
    writeFile(outputFile, buildArchiveHtml({
      title: meta.title,
      description: meta.description,
      docs: docs.filter((doc) => doc.category === category),
      outputFile,
    }));
  });
}

try {
  build();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
