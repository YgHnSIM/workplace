const fs = require('fs');
const path = require('path');
const {
  absolutePublicUrl,
  assertIsoDate,
  escapeAttr,
  escapeHtml,
  relativeTo,
  renderPageHead,
  renderTime,
  toPosixPath,
  versionedAssetHref,
} = require('./lib/site-utils');
const {
  archiveHref,
  renderArchiveCategoryNav,
  renderDocumentHeader,
  renderDocumentTools,
  renderSiteMasthead,
} = require('./lib/site-components');
const { CATEGORY_REGISTRY, loadContentGraph } = require('./lib/content-model');
const { writeOutputMap } = require('./lib/build-utils');

const rootDir = __dirname;

const categoryLabels = Object.freeze({
  all: '전체',
  ...Object.fromEntries(CATEGORY_REGISTRY.map((category) => [category.key, category.label])),
});
const categoryTitles = Object.freeze(
  Object.fromEntries(CATEGORY_REGISTRY.map((category) => [category.key, {
    directory: category.directory,
    title: category.title,
    description: category.description,
  }])),
);
const statusLabels = Object.freeze({ draft: '초안', reviewed: '검토 완료', final: '확정' });

function normalizeHref(href) {
  const value = toPosixPath(String(href || '').trim());
  if (!value || value.startsWith('/') || value.startsWith('//') || value.includes('\\')
    || value.includes('?') || value.includes('#') || value.includes('%')
    || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe document route: ${href}`);
  }
  return value;
}

function pageHref(docHref, outputFile, buildRoot = rootDir) {
  const normalized = normalizeHref(docHref);
  const target = path.join(buildRoot, ...normalized.split('/'));
  const relative = toPosixPath(path.relative(path.dirname(outputFile), target));
  return relative || path.basename(target);
}

function topicLabels(record, graph) {
  return record.topicIds.map((topicId) => graph.topicsById.get(topicId)?.label || topicId);
}

function renderDocument(record, graph) {
  const labels = topicLabels(record, graph);
  return {
    ...record,
    href: record.route,
    date: record.dates.publishedOn,
    dateModified: record.dates.modifiedOn,
    reviewedOn: record.dates.reviewedOn,
    excerpt: record.summary,
    status: record.workflow.status,
    visibility: record.workflow.visibility,
    topics: labels,
    sourceCount: record.evidence.count,
    provenance: record.evidence.note,
    showProvenance: record.evidence.noteVisibility === 'public',
    relatedDocuments: record.relatedDocumentIds.map((id) => graph.documentsById.get(id)?.route).filter(Boolean),
  };
}

function renderCard(doc, outputFile, index, buildRoot = rootDir) {
  const label = categoryLabels[doc.category] || doc.category;
  const idBase = `doc-${index + 1}`;
  const metaId = `${idBase}-meta`;
  const titleId = `${idBase}-title`;
  const excerptId = `${idBase}-excerpt`;
  const topics = doc.topics.map((topic) => `<span class="card-topic">${escapeHtml(topic)}</span>`).join('');
  const searchText = [doc.title, doc.excerpt, label, statusLabels[doc.status], ...doc.topics]
    .join(' ').toLocaleLowerCase('ko');
  return `      <article class="doc-card" data-category="${escapeAttr(doc.category)}" data-status="${escapeAttr(doc.status)}" data-visibility="${escapeAttr(doc.visibility)}" data-topics="${escapeAttr(doc.topics.join('|'))}" data-search="${escapeAttr(searchText)}">
        <div class="card-meta" id="${metaId}">
          ${renderTime(doc.date)}
          <span class="badge-category">${escapeHtml(label)}</span>
          <span class="card-status" data-status="${escapeAttr(doc.status)}">${escapeHtml(statusLabels[doc.status])}</span>
        </div>
        <h2 class="doc-title" id="${titleId}"><a class="doc-card-link" href="${escapeAttr(pageHref(doc.href, outputFile, buildRoot))}" aria-describedby="${metaId} ${excerptId}">${escapeHtml(doc.title)}</a></h2>
        <p class="doc-excerpt" id="${excerptId}">${escapeHtml(doc.excerpt)}</p>
        <div class="card-topics" aria-label="주제">${topics}</div>
      </article>`;
}

function renderArchiveTools(docs) {
  const topics = [...new Set(docs.flatMap((doc) => doc.topics))].sort((a, b) => a.localeCompare(b, 'ko'));
  const topicOptions = topics.map((topic) => `          <option value="${escapeAttr(topic)}">${escapeHtml(topic)}</option>`).join('\n');
  return `    <section class="archive-tools" aria-label="자료 찾기">
      <p class="archive-result-summary" id="archive-result-summary" aria-live="polite">자료 ${docs.length}건</p>
      <div class="archive-query-row">
        <form class="archive-search" role="search" novalidate>
          <label for="archive-search-input">자료 검색</label>
          <div class="archive-search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
            <input id="archive-search-input" name="q" type="search" inputmode="search" autocomplete="off" placeholder="제목·설명·주제 검색">
            <button class="archive-search-clear" type="button" hidden>지우기</button>
          </div>
        </form>
        <div class="topic-filter">
          <label for="archive-topic-select">쟁점</label>
          <select id="archive-topic-select" name="topic">
            <option value="all">모든 쟁점</option>
${topicOptions}
          </select>
        </div>
      </div>
    </section>`;
}

function collectionSchema(docs) {
  return {
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: docs.length,
      itemListElement: docs.map((doc, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absolutePublicUrl(doc.href),
        name: doc.title,
      })),
    },
  };
}

function renderArchiveList({ docs, outputFile, title, showOlderDocuments = false, buildRoot = rootDir }) {
  const visibleDocs = showOlderDocuments ? docs.slice(0, 8) : docs;
  const olderDocs = showOlderDocuments ? docs.slice(8) : [];
  const cards = visibleDocs.map((doc, index) => renderCard(doc, outputFile, index, buildRoot)).join('\n\n');
  const olderCards = olderDocs.map((doc, index) => renderCard(doc, outputFile, visibleDocs.length + index, buildRoot)).join('\n\n');
  const older = olderCards ? `
      <details class="archive-older-documents" data-archive-older-documents>
        <summary>이전 자료 ${olderDocs.length}건 보기</summary>
        <div class="archive-older-document-list">
${olderCards}
        </div>
      </details>` : '';
  const noResults = docs.length ? `
      <div class="empty-state archive-no-results" role="status" hidden>
        <p>일치하는 자료가 없습니다.</p>
      </div>` : '';
  return cards
    ? `${cards}${older}${noResults}`
    : `      <div class="empty-state" role="status">
        <p>아직 공개된 ${escapeHtml(title)} 자료가 없습니다.</p>
      </div>`;
}

function newestDate(docs) {
  return docs.reduce((latest, doc) => {
    const candidate = doc.dateModified || doc.date;
    return candidate > latest ? candidate : latest;
  }, '');
}

function buildArchiveHtml({ title, description, docs, outputFile, category = 'all', buildRoot = rootDir }) {
  const listContent = renderArchiveList({
    docs,
    outputFile,
    title,
    showOlderDocuments: category === 'all',
    buildRoot,
  });
  const archiveFilter = versionedAssetHref(buildRoot, outputFile, 'assets/archive-filter.js');
  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir: buildRoot,
    outputFile,
    title,
    description,
    schemaType: 'CollectionPage',
    keywords: [...new Set(docs.flatMap((doc) => doc.topics))],
    schemaProperties: collectionSchema(docs),
  })}
</head>

<body>
${renderSiteMasthead({ rootDir: buildRoot, outputFile })}
  <main class="archive-container" data-archive-category="${escapeAttr(category)}">
    <header class="archive-header">
      <h1 class="archive-title">${escapeHtml(title)}</h1>
      <p class="archive-desc">${escapeHtml(description)}</p>
    </header>

${renderArchiveCategoryNav({ rootDir: buildRoot, outputFile, activeCategory: category })}

${renderArchiveTools(docs)}

    <section class="doc-list${docs.length === 0 ? ' is-empty' : ''}" id="archive-results" aria-label="${escapeAttr(title)} 목록">
${listContent}
    </section>

    <footer class="archive-footer">
      <p>우체국물류지원단 물류노동조합</p>
    </footer>
  </main>
  <script src="${escapeAttr(archiveFilter)}" defer></script>
</body>

</html>
`;
}

function buildSitemapXml(docs) {
  const entries = [
    { href: '', date: newestDate(docs) },
    ...CATEGORY_REGISTRY.map((category) => ({
      href: `${category.directory}/`,
      date: newestDate(docs.filter((doc) => doc.category === category.key)),
    })),
    ...docs.map((doc) => ({ href: doc.href, date: doc.dateModified || doc.date })),
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
  const pattern = new RegExp(`(["'])(?:\\.\\.?/)*${escapedAssetPath}(?:\\?v=[^"'\\s>]*)?\\1`, 'g');
  return html.replace(pattern, (_, quote) => `${quote}${expectedHref}${quote}`);
}

function renderDocumentFacts(doc, outputFile, buildRoot = rootDir) {
  const homeHref = archiveHref(buildRoot, outputFile, 'all');
  const topics = doc.topics.map((topic) => (
    `<a href="${escapeAttr(`${homeHref}?topic=${encodeURIComponent(topic)}`)}">${escapeHtml(topic)}</a>`
  )).join('');
  const provenance = doc.showProvenance ? `\n      <p>${escapeHtml(doc.provenance)}</p>` : '';
  return `    <aside class="document-facts" aria-label="문서 정보">
      <dl>
        <div>
          <dt>상태</dt>
          <dd><span class="document-status-badge" data-status="${escapeAttr(doc.status)}">${escapeHtml(statusLabels[doc.status])}</span></dd>
        </div>
        <div>
          <dt>최근 검토</dt>
          <dd>${renderTime(doc.dateModified, 'document-fact-date')}</dd>
        </div>
        <div>
          <dt>근거</dt>
          <dd>${doc.sourceCount}건</dd>
        </div>
        <div class="document-fact-topics">
          <dt>쟁점</dt>
          <dd>${topics}</dd>
        </div>
      </dl>${provenance}
    </aside>`;
}

function renderRelatedDocuments(doc, docs, outputFile, buildRoot = rootDir) {
  if (!doc.relatedDocuments.length) return '';
  const docsByHref = new Map(docs.map((candidate) => [candidate.href, candidate]));
  const items = doc.relatedDocuments
    .map((href) => docsByHref.get(href))
    .filter((item) => item && item.visibility === 'public');
  if (!items.length) return '';
  const links = items.map((item) => `        <a class="related-document" href="${escapeAttr(pageHref(item.href, outputFile, buildRoot))}">
          <span>${escapeHtml(categoryLabels[item.category] || item.category)} · ${renderTime(item.date, 'related-document-date')}</span>
          <strong>${escapeHtml(item.title)}</strong>
        </a>`).join('\n');
  return `    <aside class="related-documents" aria-labelledby="related-documents-title">
      <h2 id="related-documents-title">관련 자료</h2>
      <div class="related-document-grid">
${links}
      </div>
    </aside>`;
}

function replaceManagedBlock(html, name, content, insertBlock) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const block = `${start}\n${content}\n${end}`;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<!-- ${escapedName}:start -->[\\s\\S]*?<!-- ${escapedName}:end -->`);
  if (pattern.test(html)) return html.replace(pattern, block);
  return insertBlock(html, block);
}

function upsertManagedComponent(html, name, component, insertBlock) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<!-- ${escapedName}:start -->[\\s\\S]*?<!-- ${escapedName}:end -->`);
  if (pattern.test(html)) return html.replace(pattern, component);
  return insertBlock(html, component);
}

function insertAfterDocumentHeader(html, block, href) {
  const mainStart = html.search(/<main\b/i);
  const headerEnd = mainStart >= 0 ? html.indexOf('</header>', mainStart) : -1;
  if (headerEnd < 0) throw new Error(`${href} must contain a document header`);
  const insertionPoint = headerEnd + '</header>'.length;
  return `${html.slice(0, insertionPoint)}\n\n${block}${html.slice(insertionPoint)}`;
}

function removeElementWithClass(html, className) {
  const openingPattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'ig');
  let updated = html;
  let match = openingPattern.exec(updated);
  while (match) {
    const tagPattern = /<\/?div\b[^>]*>/ig;
    tagPattern.lastIndex = match.index;
    let depth = 0;
    let tag;
    let end = -1;
    while ((tag = tagPattern.exec(updated))) {
      if (/^<\/div\b/i.test(tag[0])) depth -= 1;
      else depth += 1;
      if (depth === 0) { end = tagPattern.lastIndex; break; }
    }
    if (end < 0) break;
    updated = `${updated.slice(0, match.index)}${updated.slice(end)}`;
    openingPattern.lastIndex = 0;
    match = openingPattern.exec(updated);
  }
  return updated;
}

function removeLegacyDocumentControls(html) {
  return removeElementWithClass(html, 'utility-bar')
    .replace(/\s*<a\b[^>]*class=["'][^"']*\bback-link\b[^"']*["'][^>]*>[\s\S]*?<\/a>\s*/gi, '\n')
    .replace(/\s*<script\b[^>]*document-tools\.js[^>]*><\/script>\s*/gi, '\n');
}

function markMobileStackTables(html) {
  return html.replace(
    /<table\b([^>]*\bclass=["'][^"']*\bpost-table\b[^"']*["'][^>]*)>/gi,
    (match, attributes) => (/data-mobile-layout\s*=/.test(attributes)
      ? match
      : `<table${attributes} data-mobile-layout="stack">`),
  );
}

function extractPageStyles(html) {
  const styles = [...String(html).matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((match) => match[0].trim());
  return styles.map((style) => `<!-- page-style:start -->\n${style}\n<!-- page-style:end -->`).join('\n');
}

function replaceSourceHead(html, record, sourceStyles, filePath, graph, buildRoot = rootDir) {
  const keywords = topicLabels(record, graph);
  const head = `<head>\n  <!-- seo-head:start -->\n${renderPageHead({
    rootDir: buildRoot,
    outputFile: filePath,
    title: record.title,
    description: record.summary,
    record,
    schemaType: 'WebPage',
    openGraphType: 'article',
    keywords,
    topicLabels: keywords,
    robots: record.workflow.visibility === 'unlisted' ? 'noindex,follow' : undefined,
  })}\n  <!-- seo-head:end -->${sourceStyles ? `\n${sourceStyles}` : ''}\n</head>`;
  if (!/<head\b/i.test(html)) throw new Error(`${record.route} must contain a head element`);
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head);
}

function migrateManualDocumentShell(html, doc, filePath, buildRoot = rootDir) {
  let updated = removeLegacyDocumentControls(html);
  const documentHeader = `<!-- document-header:start -->\n${renderDocumentHeader({
    rootDir: buildRoot,
    outputFile: filePath,
    category: doc.category,
    title: doc.title,
    description: doc.excerpt,
  })}\n<!-- document-header:end -->`;
  const existingHeader = /<!-- document-header:start -->[\s\S]*?<!-- document-header:end -->/;
  if (existingHeader.test(updated)) updated = updated.replace(existingHeader, documentHeader);
  else {
    const legacyHeader = /<header\b[^>]*class=["'][^"']*\b(?:archive-header|history-header)\b[^"']*["'][^>]*>[\s\S]*?<\/header>/i;
    if (!legacyHeader.test(updated)) throw new Error(`${doc.href} must contain a replaceable document header`);
    updated = updated.replace(legacyHeader, documentHeader);
  }
  updated = updated
    .replace(/\s*<nav\b[^>]*class=["'][^"']*\bdocument-toc\b[^"']*["'][^>]*>[\s\S]*?<\/nav>\s*/gi, '\n')
    .replace(/\s*<nav\b[^>]*class=["'][^"']*\bhistory-nav\b[^"']*["'][^>]*>[\s\S]*?<\/nav>\s*/gi, '\n');
  if (['notice/2025-performance-pay.html', 'knowledge/retirement-benefit-db-dc-guide.html'].includes(doc.href)) {
    updated = markMobileStackTables(updated);
  }
  return updated;
}

function syncSiteMasthead(html, filePath, buildRoot = rootDir) {
  return upsertManagedComponent(
    html,
    'site-masthead',
    renderSiteMasthead({ rootDir: buildRoot, outputFile: filePath }),
    (source, component) => source.replace(/<body\b[^>]*>/i, (openingTag) => `${openingTag}\n${component}`),
  );
}

function syncDocumentTools(html, filePath, buildRoot = rootDir) {
  const component = renderDocumentTools();
  let updated = upsertManagedComponent(
    html,
    'document-tools',
    component,
    (source, content) => source.replace(
      /<\/body>/i,
      `${content}\n  <script src="${escapeAttr(versionedAssetHref(buildRoot, filePath, 'assets/document-tools.js'))}" defer></script>\n</body>`,
    ),
  );
  if (!/<script\b[^>]*document-tools\.js[^>]*><\/script>/i.test(updated)) {
    updated = updated.replace(
      /<\/body>/i,
      `  <script src="${escapeAttr(versionedAssetHref(buildRoot, filePath, 'assets/document-tools.js'))}" defer></script>\n</body>`,
    );
  }
  return updated;
}

function renderManualOutputs(graph, docs) {
  const outputs = new Map();
  const buildRoot = graph.projectRoot || rootDir;
  docs.filter((doc) => ['knowledge', 'notice'].includes(doc.category)).forEach((doc) => {
    const filePath = path.join(buildRoot, ...doc.href.split('/'));
    const sourcePath = graph.sourcePathsById.get(doc.id);
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`${doc.href} source is missing`);
    const original = fs.readFileSync(sourcePath, 'utf8');
    const sourceStyles = extractPageStyles(original);
    let updated = replaceSourceHead(original, graph.documentsById.get(doc.id), sourceStyles, filePath, graph, buildRoot);
    const assetPaths = ['assets/interface.css', 'assets/document-tools.js', 'assets/video-embed.js'];
    updated = assetPaths.reduce((html, assetPath) => replaceVersionedAssetReference(
      html,
      assetPath,
      versionedAssetHref(buildRoot, filePath, assetPath),
    ), updated);
    updated = migrateManualDocumentShell(updated, doc, filePath, buildRoot);
    updated = syncSiteMasthead(updated, filePath, buildRoot);
    updated = syncDocumentTools(updated, filePath, buildRoot);
    updated = replaceManagedBlock(
      updated,
      'document-facts',
      renderDocumentFacts(doc, filePath, buildRoot),
      (html, block) => insertAfterDocumentHeader(html, block, doc.href),
    );
    const related = renderRelatedDocuments(doc, docs, filePath, buildRoot);
    if (related) {
      updated = replaceManagedBlock(updated, 'related-documents', related, (html, block) => {
        const mainEnd = html.lastIndexOf('</main>');
        if (mainEnd < 0) throw new Error(`${doc.href} must contain a main element`);
        const beforeMainEnd = html.slice(0, mainEnd).replace(/[ \t]+$/, '');
        return `${beforeMainEnd}\n${block}\n  ${html.slice(mainEnd)}`;
      });
    } else {
      updated = updated.replace(/\s*<!-- related-documents:start -->[\s\S]*?<!-- related-documents:end -->\s*/i, '\n');
    }
    updated = updated
      .replace(/^[ \t]+\r?\n(?=<!-- (?:document-(?:facts|tools)|related-documents|site-masthead):start -->)/gm, '')
      .replace(/^[ \t]+(?=\r?\n)/gm, '');
    outputs.set(filePath, updated);
  });
  return outputs;
}

function renderArchiveOutputs(docs, buildRoot = rootDir) {
  const outputs = new Map();
  outputs.set(path.join(buildRoot, 'index.html'), buildArchiveHtml({
    title: '공개 자료실',
    description: '회의록, 성명서, 노동·법률 해설과 조합원 안내를 쟁점별로 찾아볼 수 있습니다.',
    docs,
    outputFile: path.join(buildRoot, 'index.html'),
    category: 'all',
    buildRoot,
  }));
  CATEGORY_REGISTRY.forEach((category) => {
    const meta = categoryTitles[category.key];
    const outputFile = path.join(buildRoot, meta.directory, 'index.html');
    outputs.set(outputFile, buildArchiveHtml({
      title: meta.title,
      description: meta.description,
      docs: docs.filter((doc) => doc.category === category.key),
      outputFile,
      category: category.key,
      buildRoot,
    }));
  });
  outputs.set(path.join(buildRoot, 'sitemap.xml'), buildSitemapXml(docs));
  outputs.set(path.join(buildRoot, 'robots.txt'), buildRobotsTxt());
  return outputs;
}

function renderSiteOutputs(graph = loadContentGraph({ projectRoot: rootDir })) {
  const buildRoot = graph.projectRoot || rootDir;
  const allDocs = graph.documents.map((record) => renderDocument(record, graph));
  const listedDocs = graph.listedDocuments.map((record) => renderDocument(record, graph));
  return require('./lib/build-utils').mergeOutputMaps(
    renderArchiveOutputs(listedDocs, buildRoot),
    renderManualOutputs(graph, allDocs),
  );
}

function build() {
  const graph = loadContentGraph({ projectRoot: rootDir });
  const outputs = renderSiteOutputs(graph);
  writeOutputMap(outputs, { projectRoot: rootDir });
  outputs.forEach((_content, outputPath) => console.log(`Generated ${relativeTo(rootDir, outputPath)}`));
}

module.exports = {
  buildRobotsTxt,
  buildSitemapXml,
  normalizeHref,
  renderSiteOutputs,
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
