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
const {
  archiveHref,
  renderArchiveCategoryNav,
  renderDocumentHeader,
  renderDocumentTools,
  renderSiteMasthead,
} = require('./lib/site-components');

const rootDir = __dirname;
const catalogPath = path.join(rootDir, '_source', 'catalog.json');
const momManifestPath = path.join(rootDir, '_source', 'generated', 'mom.json');
const homeFilePath = path.join(rootDir, 'index.html');
const sitemapPath = path.join(rootDir, 'sitemap.xml');
const robotsPath = path.join(rootDir, 'robots.txt');

const supportedStatuses = new Set(['draft', 'reviewed', 'final']);

const categoryLabels = {
  all: '전체',
  statement: '성명서',
  mom: '회의록',
  knowledge: '지식',
  notice: '알림',
};

const categoryTitles = {
  statement: {
    directory: 'statement',
    title: '성명서',
    description: '노동 현장의 쟁점과 요구를 알리는 노동조합 성명서입니다.',
  },
  mom: {
    directory: 'MoM',
    title: '운영위원회 회의록',
    description: '우체국물류지원단 물류노동조합 운영위원회의 정기·임시 회의록과 결산 자료입니다.',
  },
  knowledge: {
    directory: 'knowledge',
    title: '지식',
    description: '노동·법률 쟁점을 판례와 공개 자료에 비추어 해설한 지식 자료입니다.',
  },
  notice: {
    directory: 'notice',
    title: '알림',
    description: '노동조합의 활동 기록과 조합원 안내를 모았습니다.',
  },
};

const statusLabels = {
  draft: '초안',
  reviewed: '검토 완료',
  final: '확정',
};

const defaultTopics = {
  mom: ['운영위원회', '회의록'],
  knowledge: ['노동 지식'],
  notice: ['조합 알림'],
  statement: ['노동조합', '성명서'],
};

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
  const date = assertIsoDate(doc.date, `${sourceLabel} date for ${doc.href}`);
  const dateModified = doc.dateModified
    ? assertIsoDate(doc.dateModified, `${sourceLabel} dateModified for ${doc.href}`)
    : date;
  if (dateModified < date) {
    throw new Error(`${sourceLabel} dateModified cannot precede date for ${doc.href}`);
  }

  const status = String(doc.status || 'final').trim();
  if (!supportedStatuses.has(status)) {
    throw new Error(`${sourceLabel} status must be draft, reviewed, or final for ${doc.href}`);
  }

  const rawTopics = Array.isArray(doc.topics) && doc.topics.length
    ? doc.topics
    : (defaultTopics[doc.category] || [doc.category]);
  const topics = [...new Set(rawTopics.map((topic) => String(topic || '').trim()).filter(Boolean))];
  if (!topics.length) throw new Error(`${sourceLabel} topics cannot be empty for ${doc.href}`);

  const sourceCount = doc.sourceCount === undefined ? 1 : Number(doc.sourceCount);
  if (!Number.isInteger(sourceCount) || sourceCount < 1) {
    throw new Error(`${sourceLabel} sourceCount must be a positive integer for ${doc.href}`);
  }

  const relatedDocuments = Array.isArray(doc.relatedDocuments)
    ? [...new Set(doc.relatedDocuments.map((href) => normalizeHref(href)))]
    : [];
  const showProvenance = doc.showProvenance === undefined ? true : doc.showProvenance;
  if (typeof showProvenance !== 'boolean') {
    throw new Error(`${sourceLabel} showProvenance must be a boolean for ${doc.href}`);
  }

  return {
    ...doc,
    href: normalizeHref(doc.href),
    date,
    dateModified,
    status,
    topics,
    sourceCount,
    provenance: String(doc.provenance || '노동조합 공개 기록').trim(),
    showProvenance,
    relatedDocuments,
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

function assertRelatedDocuments(docs) {
  const hrefs = new Set(docs.map((doc) => doc.href));
  docs.forEach((doc) => {
    doc.relatedDocuments.forEach((href) => {
      if (href === doc.href) throw new Error(`${doc.href} cannot relate to itself`);
      if (!hrefs.has(href)) throw new Error(`${doc.href} relates to missing document: ${href}`);
    });
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
  assertRelatedDocuments(docs);
  return docs.sort((a, b) => (
    b.date.localeCompare(a.date)
    || ((a.groupOrder || 0) - (b.groupOrder || 0))
    || ((a.order || 0) - (b.order || 0))
    || a.href.localeCompare(b.href, 'ko')
  ));
}

function renderCard(doc, outputFile, index) {
  const label = categoryLabels[doc.category] || doc.category;
  const idBase = `doc-${index + 1}`;
  const metaId = `${idBase}-meta`;
  const titleId = `${idBase}-title`;
  const excerptId = `${idBase}-excerpt`;
  const topics = doc.topics.map((topic) => (
    `<span class="card-topic">${escapeHtml(topic)}</span>`
  )).join('');
  const searchText = [doc.title, doc.excerpt, label, statusLabels[doc.status], ...doc.topics]
    .join(' ')
    .toLocaleLowerCase('ko');
  return `      <article class="doc-card" data-category="${escapeAttr(doc.category)}" data-status="${escapeAttr(doc.status)}" data-topics="${escapeAttr(doc.topics.join('|'))}" data-search="${escapeAttr(searchText)}">
        <div class="card-meta" id="${metaId}">
          ${renderTime(doc.date)}
          <span class="badge-category">${escapeHtml(label)}</span>
          <span class="card-status" data-status="${escapeAttr(doc.status)}">${escapeHtml(statusLabels[doc.status])}</span>
        </div>
        <h2 class="doc-title" id="${titleId}"><a class="doc-card-link" href="${escapeAttr(pageHref(doc.href, outputFile))}" aria-describedby="${metaId} ${excerptId}">${escapeHtml(doc.title)}</a></h2>
        <p class="doc-excerpt" id="${excerptId}">${escapeHtml(doc.excerpt)}</p>
        <div class="card-topics" aria-label="주제">${topics}</div>
      </article>`;
}

function renderArchiveTools(docs) {
  const topics = [...new Set(docs.flatMap((doc) => doc.topics))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const topicOptions = topics.map((topic) => (
    `          <option value="${escapeAttr(topic)}">${escapeHtml(topic)}</option>`
  )).join('\n');
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

function renderArchiveList({ docs, outputFile, title, showOlderDocuments = false }) {
  const visibleDocs = showOlderDocuments ? docs.slice(0, 8) : docs;
  const olderDocs = showOlderDocuments ? docs.slice(8) : [];
  const cards = visibleDocs.map((doc, index) => renderCard(doc, outputFile, index)).join('\n\n');
  const olderCards = olderDocs.map((doc, index) => renderCard(doc, outputFile, visibleDocs.length + index)).join('\n\n');
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
  const listContent = cards ? `${cards}${older}${noResults}` : `      <div class="empty-state" role="status">
        <p>아직 공개된 ${escapeHtml(title)} 자료가 없습니다.</p>
      </div>`;

  return listContent;
}

function buildArchiveHtml({ title, description, docs, outputFile, category = 'all' }) {
  const listContent = renderArchiveList({
    docs,
    outputFile,
    title,
    showOlderDocuments: category === 'all',
  });
  const archiveFilter = versionedAssetHref(rootDir, outputFile, 'assets/archive-filter.js');

  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir,
    outputFile,
    title,
    description,
    schemaType: 'CollectionPage',
    dateModified: newestDate(docs),
    keywords: [...new Set(docs.flatMap((doc) => doc.topics))],
    schemaProperties: collectionSchema(docs),
  })}
</head>

<body>
${renderSiteMasthead({ rootDir, outputFile })}
  <main class="archive-container" data-archive-category="${escapeAttr(category)}">
    <header class="archive-header">
      <h1 class="archive-title">${escapeHtml(title)}</h1>
      <p class="archive-desc">${escapeHtml(description)}</p>
    </header>

${renderArchiveCategoryNav({ rootDir, outputFile, activeCategory: category })}

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

function newestDate(docs) {
  return docs.reduce((latest, doc) => {
    const candidate = doc.dateModified || doc.date;
    return candidate > latest ? candidate : latest;
  }, '');
}

function buildSitemapXml(docs) {
  const entries = [
    { href: '', date: newestDate(docs) },
    { href: 'statement/', date: newestDate(docs.filter((doc) => doc.category === 'statement')) },
    { href: 'MoM/', date: newestDate(docs.filter((doc) => doc.category === 'mom')) },
    { href: 'knowledge/', date: newestDate(docs.filter((doc) => doc.category === 'knowledge')) },
    { href: 'notice/', date: newestDate(docs.filter((doc) => doc.category === 'notice')) },
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
  const pattern = new RegExp(
    `(["'])(?:\\.\\.?/)*${escapedAssetPath}(?:\\?v=[^"'\\s>]*)?\\1`,
    'g',
  );
  return html.replace(pattern, (_, quote) => `${quote}${expectedHref}${quote}`);
}

function renderDocumentFacts(doc, outputFile) {
  const homeHref = archiveHref(rootDir, outputFile, 'all');
  const topics = doc.topics.map((topic) => (
    `<a href="${escapeAttr(`${homeHref}?topic=${encodeURIComponent(topic)}`)}">${escapeHtml(topic)}</a>`
  )).join('');
  const provenance = doc.showProvenance
    ? `\n      <p>${escapeHtml(doc.provenance)}</p>`
    : '';

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

function renderRelatedDocuments(doc, docs, outputFile) {
  if (!doc.relatedDocuments.length) return '';
  const docsByHref = new Map(docs.map((candidate) => [candidate.href, candidate]));
  const items = doc.relatedDocuments.map((href) => docsByHref.get(href)).filter(Boolean);
  if (!items.length) return '';

  const links = items.map((item) => `        <a class="related-document" href="${escapeAttr(pageHref(item.href, outputFile))}">
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
      if (depth === 0) {
        end = tagPattern.lastIndex;
        break;
      }
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

function removeLegacyStyleRules(html) {
  const legacySelector = /\.(?:utility-bar|back-link|history-nav|archive-kicker|card-footer)\b/i;
  const stripRules = (css) => css.replace(
    /^([ \t]*)([^{}]+?)\{([^{}]*)\}/gm,
    (match, indent, rawSelectors, declarations) => {
      const selectors = rawSelectors.split(',').map((selector) => selector.trim()).filter(Boolean);
      if (!selectors.some((selector) => legacySelector.test(selector))) return match;
      const retained = selectors.filter((selector) => !legacySelector.test(selector));
      if (!retained.length) return '';
      return `${indent}${retained.join(', ')} {${declarations}}`;
    },
  );
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, opening, css, closing) => `${opening}${stripRules(css)}${closing}`,
  );
}

function markMobileStackTables(html) {
  return html.replace(
    /<table\b([^>]*\bclass=["'][^"']*\bpost-table\b[^"']*["'][^>]*)>/gi,
    (match, attributes) => (/data-mobile-layout\s*=/.test(attributes)
      ? match
      : `<table${attributes} data-mobile-layout="stack">`),
  );
}

function migrateManualDocumentShell(html, doc, filePath) {
  let updated = removeLegacyStyleRules(removeLegacyDocumentControls(html));
  const documentHeader = `<!-- document-header:start -->\n${renderDocumentHeader({
    rootDir,
    outputFile: filePath,
    category: doc.category,
    title: doc.title,
    description: doc.excerpt,
  })}\n<!-- document-header:end -->`;
  const existingHeader = /<!-- document-header:start -->[\s\S]*?<!-- document-header:end -->/;
  if (existingHeader.test(updated)) {
    updated = updated.replace(existingHeader, documentHeader);
  } else {
    const legacyHeader = /<header\b[^>]*class=["'][^"']*\b(?:archive-header|history-header)\b[^"']*["'][^>]*>[\s\S]*?<\/header>/i;
    if (!legacyHeader.test(updated)) throw new Error(`${doc.href} must contain a replaceable document header`);
    updated = updated.replace(legacyHeader, documentHeader);
  }

  updated = updated
    .replace(/\s*<nav\b[^>]*class=["'][^"']*\bdocument-toc\b[^"']*["'][^>]*>[\s\S]*?<\/nav>\s*/gi, '\n')
    .replace(/\s*<nav\b[^>]*class=["'][^"']*\bhistory-nav\b[^"']*["'][^>]*>[\s\S]*?<\/nav>\s*/gi, '\n');

  if ([
    'notice/2025-performance-pay.html',
    'knowledge/retirement-benefit-db-dc-guide.html',
  ].includes(doc.href)) {
    updated = markMobileStackTables(updated);
  }
  return updated;
}

function syncSiteMasthead(html, filePath) {
  return upsertManagedComponent(
    html,
    'site-masthead',
    renderSiteMasthead({ rootDir, outputFile: filePath }),
    (source, component) => source.replace(/<body\b[^>]*>/i, (openingTag) => `${openingTag}\n${component}`),
  );
}

function syncDocumentTools(html, filePath) {
  const component = renderDocumentTools();
  let updated = upsertManagedComponent(
    html,
    'document-tools',
    component,
    (source, content) => source.replace(
      /<\/body>/i,
      `${content}\n  <script src="${escapeAttr(versionedAssetHref(rootDir, filePath, 'assets/document-tools.js'))}" defer></script>\n</body>`,
    ),
  );
  if (!/<script\b[^>]*document-tools\.js[^>]*><\/script>/i.test(updated)) {
    updated = updated.replace(
      /<\/body>/i,
      `  <script src="${escapeAttr(versionedAssetHref(rootDir, filePath, 'assets/document-tools.js'))}" defer></script>\n</body>`,
    );
  }
  return updated;
}

function syncStructuredMetadata(html, doc) {
  let updated = html
    .replace(/^[ \t]*<meta property="article:modified_time"[^>]*>\r?\n?/gim, '')
    .replace(/^[ \t]*<meta name="keywords"[^>]*>\r?\n?/gim, '');
  const meta = `  <meta property="article:modified_time" content="${escapeAttr(doc.dateModified)}">\n  <meta name="keywords" content="${escapeAttr(doc.topics.join(', '))}">\n`;
  if (/<meta name="twitter:card"/i.test(updated)) {
    updated = updated.replace(/^[ \t]*<meta name="twitter:card"/im, `${meta}$&`);
  } else {
    updated = updated.replace(/<\/head>/i, `${meta}</head>`);
  }

  const jsonLdPattern = /(<script\s+type=["']application\/ld\+json["']\s*>)([\s\S]*?)(<\/script>)/i;
  const match = updated.match(jsonLdPattern);
  if (!match) throw new Error(`${doc.href} must contain JSON-LD metadata`);

  let jsonLd;
  try {
    jsonLd = JSON.parse(match[2]);
  } catch (error) {
    throw new Error(`${doc.href} contains invalid JSON-LD: ${error.message}`);
  }
  jsonLd.datePublished = jsonLd.datePublished || doc.date;
  jsonLd.dateModified = doc.dateModified;
  jsonLd.keywords = doc.topics.join(', ');
  jsonLd.about = doc.topics.map((topic) => ({ '@type': 'Thing', name: topic }));
  jsonLd.mainEntityOfPage = absolutePublicUrl(doc.href);
  const serialized = JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c');
  return updated.replace(
    jsonLdPattern,
    (_match, openingTag, _existingJson, closingTag) => `${openingTag}\n${serialized}\n  ${closingTag}`,
  );
}

function syncDocumentPages(docs) {
  const assetPaths = ['assets/interface.css', 'assets/document-tools.js', 'assets/video-embed.js'];
  docs.forEach((doc) => {
    const filePath = path.join(rootDir, ...doc.href.split('/'));
    if (path.extname(filePath).toLowerCase() !== '.html') {
      throw new Error(`Catalog document must point to an HTML file: ${doc.href}`);
    }

    const original = fs.readFileSync(filePath, 'utf8');
    let updated = assetPaths.reduce((html, assetPath) => replaceVersionedAssetReference(
      html,
      assetPath,
      versionedAssetHref(rootDir, filePath, assetPath),
    ), original);

    if (doc.category === 'knowledge' || doc.category === 'notice') {
      updated = migrateManualDocumentShell(updated, doc, filePath);
    }
    updated = syncSiteMasthead(updated, filePath);
    updated = syncDocumentTools(updated, filePath);
    updated = syncStructuredMetadata(updated, doc);
    updated = replaceManagedBlock(
      updated,
      'document-facts',
      renderDocumentFacts(doc, filePath),
      (html, block) => insertAfterDocumentHeader(html, block, doc.href),
    );

    const related = renderRelatedDocuments(doc, docs, filePath);
    if (related) {
      updated = replaceManagedBlock(updated, 'related-documents', related, (html, block) => {
        const mainEnd = html.lastIndexOf('</main>');
        if (mainEnd < 0) throw new Error(`${doc.href} must contain a main element`);
        const beforeMainEnd = html.slice(0, mainEnd).replace(/[ \t]+$/, '');
        return `${beforeMainEnd}\n${block}\n  ${html.slice(mainEnd)}`;
      });
    }
    updated = updated
      .replace(/^[ \t]+\r?\n(?=<!-- (?:document-(?:facts|tools)|related-documents|site-masthead):start -->)/gm, '')
      .replace(/^[ \t]+(?=\r?\n)/gm, '');

    if (updated !== original) {
      writeTextFile(filePath, updated);
      console.log(`Synchronized document metadata in ${relativeTo(rootDir, filePath)}`);
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
    title: '공개 자료실',
    description: '회의록, 성명서, 노동·법률 해설과 조합원 안내를 쟁점별로 찾아볼 수 있습니다.',
    docs,
    outputFile: homeFilePath,
    category: 'all',
  }));

  ['statement', 'mom', 'knowledge', 'notice'].forEach((category) => {
    const meta = categoryTitles[category];
    const outputFile = path.join(rootDir, meta.directory, 'index.html');
    writeFile(outputFile, buildArchiveHtml({
      title: meta.title,
      description: meta.description,
      docs: docs.filter((doc) => doc.category === category),
      outputFile,
      category,
    }));
  });

  syncDocumentPages(docs);
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
