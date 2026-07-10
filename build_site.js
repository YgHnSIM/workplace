const fs = require('fs');
const path = require('path');
const {
  absolutePublicUrl,
  assertIsoDate,
  escapeAttr,
  escapeHtml,
  readJson,
  relativeTo,
  renderPageHead,
  renderTime,
  toPosixPath,
  versionedAssetHref,
  writeTextFile,
} = require('./lib/site-utils');

const rootDir = __dirname;
const catalogPath = path.join(rootDir, '_source', 'catalog.json');
const momManifestPath = path.join(rootDir, '_source', 'generated', 'mom.json');
const homeFilePath = path.join(rootDir, 'index.html');
const sitemapPath = path.join(rootDir, 'sitemap.xml');
const robotsPath = path.join(rootDir, 'robots.txt');

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

function isHomeOutput(outputFile) {
  return outputFile === homeFilePath;
}

function renderBackLink(outputFile) {
  return isHomeOutput(outputFile) ? '' : `    <a href="../index.html" class="back-link">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      첫 페이지로 돌아가기
    </a>
`;
}

function normalizeHref(href) {
  const value = toPosixPath(String(href || '').trim());
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
  const relative = toPosixPath(path.relative(path.dirname(outputFile), target));
  return relative || path.basename(target);
}

function validateDocument(doc, sourceLabel) {
  ['category', 'href', 'title', 'date', 'excerpt'].forEach((field) => {
    if (!String(doc[field] || '').trim()) {
      throw new Error(`${sourceLabel} document is missing ${field}`);
    }
  });
  return {
    ...doc,
    href: normalizeHref(doc.href),
    date: assertIsoDate(doc.date, `${sourceLabel} date for ${doc.href}`),
  };
}

function assertUniqueDocumentHrefs(docs) {
  const seen = new Map();
  docs.forEach((doc) => {
    const key = doc.href.toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      throw new Error(`Duplicate public href in document manifests: ${previous.href} and ${doc.href}`);
    }
    seen.set(key, doc);
  });
}

function readDocuments() {
  const catalog = readJson(catalogPath);
  const manualDocs = catalog.documents
    .map((doc) => validateDocument(doc, '_source/catalog.json'));

  const momDocs = readJson(momManifestPath).map((doc, index) => validateDocument({
    ...doc,
    groupOrder: 20,
    order: index,
  }, '_source/generated/mom.json'));

  const docs = [...manualDocs, ...momDocs];
  assertUniqueDocumentHrefs(docs);
  return docs.sort((a, b) => (
    b.date.localeCompare(a.date)
    || ((a.groupOrder || 0) - (b.groupOrder || 0))
    || ((a.order || 0) - (b.order || 0))
    || a.href.localeCompare(b.href, 'ko')
  ));
}

function renderIconChevron() {
  return `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>`;
}

function renderCard(doc, outputFile, index) {
  const label = categoryLabels[doc.category] || doc.category;
  const idBase = `doc-${index + 1}`;
  const metaId = `${idBase}-meta`;
  const titleId = `${idBase}-title`;
  const excerptId = `${idBase}-excerpt`;
  const actionId = `${idBase}-action`;
  return `      <a href="${escapeAttr(pageHref(doc.href, outputFile))}" class="doc-card" data-category="${escapeAttr(doc.category)}" aria-labelledby="${titleId}" aria-describedby="${metaId}">
        <div class="card-meta" id="${metaId}">
          <span class="badge-category">${escapeHtml(label)}</span>
          ${renderTime(doc.date)}
        </div>
        <h2 class="doc-title" id="${titleId}">${escapeHtml(doc.title)}</h2>
        <p class="doc-excerpt" id="${excerptId}">${escapeHtml(doc.excerpt)}</p>
        <div class="card-footer" id="${actionId}">
          ${escapeHtml(doc.action || `${label} 보기`)}
          ${renderIconChevron()}
        </div>
      </a>`;
}

function renderFilterButton(category, active = false) {
  return `      <button class="filter-btn${active ? ' active' : ''}" id="filter-${escapeAttr(category)}" type="button" data-filter="${escapeAttr(category)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(categoryLabels[category] || category)}</button>`;
}

function renderFilterBar(docs) {
  const categories = Object.keys(categoryLabels)
    .filter((category) => category !== 'all' && docs.some((doc) => doc.category === category));
  const buttons = [
    renderFilterButton('all', true),
    ...categories.map((category) => renderFilterButton(category)),
  ].join('\n');

  return `    <div class="filter-bar" role="toolbar" aria-label="자료 분류 필터">
${buttons}
    </div>`;
}

function buildArchiveHtml({ title, description, docs, outputFile, includeFilter = false }) {
  const cards = docs.map((doc, index) => renderCard(doc, outputFile, index)).join('\n\n');
  const listContent = cards || `      <div class="empty-state" role="status">
        <p>아직 공개된 ${escapeHtml(title)} 자료가 없습니다.</p>
      </div>`;
  const logo300 = versionedAssetHref(rootDir, outputFile, 'assets/logo-header-300.webp');
  const logo600 = versionedAssetHref(rootDir, outputFile, 'assets/logo-header-600.webp');
  const script = includeFilter
    ? `\n  <script src="${escapeAttr(versionedAssetHref(rootDir, outputFile, 'assets/archive-filter.js'))}" defer></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir,
    outputFile,
    title,
    description,
    schemaType: 'CollectionPage',
  })}
</head>

<body>
  <main class="archive-container">
${renderBackLink(outputFile)}    <header class="archive-header">
      <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
      <h1 class="archive-title">${escapeHtml(title)}</h1>
      <p class="archive-desc">${escapeHtml(description)}</p>
    </header>

${includeFilter ? `${renderFilterBar(docs)}\n\n` : ''}    <section class="doc-list${docs.length === 0 ? ' is-empty' : ''}" aria-label="${escapeAttr(title)} 목록">
${listContent}
    </section>

    <footer class="archive-footer">
      <p>&copy; 2026 우체국물류지원단 물류노동조합. All rights reserved.</p>
    </footer>
  </main>${script}
</body>

</html>
`;
}

function newestDate(docs) {
  return docs.reduce((latest, doc) => (doc.date > latest ? doc.date : latest), '');
}

function buildSitemapXml(docs) {
  const entries = [
    { href: '', date: newestDate(docs) },
    { href: 'MoM/', date: newestDate(docs.filter((doc) => doc.category === 'mom')) },
    { href: 'knowledge/', date: newestDate(docs.filter((doc) => doc.category === 'knowledge')) },
    { href: 'notice/', date: newestDate(docs.filter((doc) => doc.category === 'notice')) },
    ...docs.map((doc) => ({ href: doc.href, date: doc.date })),
  ];
  const seen = new Set();
  const urls = entries.map(({ href, date }) => {
    const loc = absolutePublicUrl(href);
    if (seen.has(loc)) throw new Error(`Duplicate URL in sitemap: ${loc}`);
    seen.add(loc);
    const lastmod = date ? `\n    <lastmod>${escapeHtml(assertIsoDate(date, `sitemap lastmod for ${href || '/'}`))}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lastmod}\n  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRobotsTxt() {
  return `User-agent: *
Allow: /
Sitemap: ${absolutePublicUrl('sitemap.xml')}
`;
}

function replaceVersionedAssetReference(html, assetPath, expectedHref) {
  const escapedAssetPath = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(["'])(?:\\.\\.?/)*${escapedAssetPath}(?:\\?v=[^"'\\s>]*)?\\1`,
    'g',
  );
  return html.replace(pattern, (_, quote) => `${quote}${expectedHref}${quote}`);
}

function syncManualAssetVersions(docs) {
  const assetPaths = ['assets/interface.css', 'assets/document-tools.js', 'assets/video-embed.js'];
  docs.filter((doc) => doc.category !== 'mom').forEach((doc) => {
    const filePath = path.join(rootDir, ...doc.href.split('/'));
    if (path.extname(filePath).toLowerCase() !== '.html') {
      throw new Error(`Catalog document must point to an HTML file: ${doc.href}`);
    }

    const original = fs.readFileSync(filePath, 'utf8');
    const updated = assetPaths.reduce((html, assetPath) => replaceVersionedAssetReference(
      html,
      assetPath,
      versionedAssetHref(rootDir, filePath, assetPath),
    ), original);

    if (updated !== original) {
      writeTextFile(filePath, updated);
      console.log(`Updated asset versions in ${relativeTo(rootDir, filePath)}`);
    }
  });
}

function writeFile(filePath, html) {
  writeTextFile(filePath, html);
  console.log(`Generated ${relativeTo(rootDir, filePath)}`);
}

function build() {
  const docs = readDocuments();

  writeFile(homeFilePath, buildArchiveHtml({
    title: '아카이브',
    description: '우체국물류지원단 물류노동조합의 활동 자료 보관소입니다.',
    docs,
    outputFile: homeFilePath,
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

  syncManualAssetVersions(docs);
  writeFile(sitemapPath, buildSitemapXml(docs));
  writeFile(robotsPath, buildRobotsTxt());
}

module.exports = {
  buildRobotsTxt,
  buildSitemapXml,
  replaceVersionedAssetReference,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
