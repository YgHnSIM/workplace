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

const supportedStatuses = new Set(['draft', 'reviewed', 'final']);

const categoryLabels = {
  all: '전체',
  statement: '성명서',
  mom: '회의록',
  knowledge: '지식',
  notice: '알림',
};

const categoryTitles = {
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
  const topics = doc.topics.map((topic) => (
    `<span class="card-topic">${escapeHtml(topic)}</span>`
  )).join('');
  const searchText = [doc.title, doc.excerpt, label, statusLabels[doc.status], ...doc.topics]
    .join(' ')
    .toLocaleLowerCase('ko');
  return `      <article class="doc-card" data-category="${escapeAttr(doc.category)}" data-status="${escapeAttr(doc.status)}" data-topics="${escapeAttr(doc.topics.join('|'))}" data-search="${escapeAttr(searchText)}">
        <div class="card-meta" id="${metaId}">
          <span class="badge-category">${escapeHtml(label)}</span>
          ${renderTime(doc.date)}
          <span class="card-status" data-status="${escapeAttr(doc.status)}">${escapeHtml(statusLabels[doc.status])}</span>
        </div>
        <h2 class="doc-title" id="${titleId}"><a class="doc-card-link" href="${escapeAttr(pageHref(doc.href, outputFile))}" aria-describedby="${metaId} ${excerptId}">${escapeHtml(doc.title)}</a></h2>
        <p class="doc-excerpt" id="${excerptId}">${escapeHtml(doc.excerpt)}</p>
        <div class="card-topics" aria-label="주제">${topics}</div>
        <div class="card-footer" aria-hidden="true">
          ${escapeHtml(doc.action || `${label} 보기`)}
          ${renderIconChevron()}
        </div>
      </article>`;
}

function renderFilterButton(category, active = false) {
  return `      <button class="filter-btn${active ? ' active' : ''}" id="filter-${escapeAttr(category)}" type="button" data-filter="${escapeAttr(category)}" aria-pressed="${active ? 'true' : 'false'}" tabindex="${active ? '0' : '-1'}">${escapeHtml(categoryLabels[category] || category)}</button>`;
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

function renderArchiveTools(docs) {
  const topics = [...new Set(docs.flatMap((doc) => doc.topics))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const topicOptions = topics.map((topic) => (
    `          <option value="${escapeAttr(topic)}">${escapeHtml(topic)}</option>`
  )).join('\n');
  const updated = newestDate(docs);

  return `    <section class="archive-tools" aria-label="자료 찾기">
      <div class="archive-ledger-meta" aria-label="자료실 현황">
        <span>공개 문서 <strong>${docs.length}</strong>건</span>
        <span>최근 수정 ${renderTime(updated, 'ledger-date')}</span>
      </div>
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
${renderFilterBar(docs)}
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

function buildArchiveHtml({ title, description, docs, outputFile, includeFilter = false }) {
  const cards = docs.map((doc, index) => renderCard(doc, outputFile, index)).join('\n\n');
  const noResults = docs.length ? `
      <div class="empty-state archive-no-results" role="status" hidden>
        <p>조건에 맞는 자료가 없습니다. 검색어나 필터를 바꿔보세요.</p>
      </div>` : '';
  const listContent = cards ? `${cards}${noResults}` : `      <div class="empty-state" role="status">
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
    dateModified: newestDate(docs),
    keywords: [...new Set(docs.flatMap((doc) => doc.topics))],
    schemaProperties: collectionSchema(docs),
  })}
</head>

<body>
  <main class="archive-container">
${renderBackLink(outputFile)}    <header class="archive-header">
      <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
      <div class="archive-heading">
        <p class="archive-kicker">쟁점별 기록 원장</p>
        <h1 class="archive-title">${escapeHtml(title)}</h1>
      </div>
      <p class="archive-desc">${escapeHtml(description)}</p>
    </header>

${includeFilter ? `${renderArchiveTools(docs)}\n\n` : ''}    <section class="doc-list${docs.length === 0 ? ' is-empty' : ''}" id="archive-results" aria-label="${escapeAttr(title)} 목록">
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
  return docs.reduce((latest, doc) => {
    const candidate = doc.dateModified || doc.date;
    return candidate > latest ? candidate : latest;
  }, '');
}

function buildSitemapXml(docs) {
  const entries = [
    { href: '', date: newestDate(docs) },
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
  const homeHref = pageHref('index.html', outputFile);
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

    updated = syncStructuredMetadata(updated, doc);
    updated = replaceManagedBlock(updated, 'document-facts', renderDocumentFacts(doc, filePath), (html, block) => {
      const headerEnd = html.indexOf('</header>');
      if (headerEnd < 0) throw new Error(`${doc.href} must contain a header`);
      const insertionPoint = headerEnd + '</header>'.length;
      return `${html.slice(0, insertionPoint)}\n\n${block}${html.slice(insertionPoint)}`;
    });

    const related = renderRelatedDocuments(doc, docs, filePath);
    if (related) {
      updated = replaceManagedBlock(updated, 'related-documents', related, (html, block) => {
        const mainEnd = html.lastIndexOf('</main>');
        if (mainEnd < 0) throw new Error(`${doc.href} must contain a main element`);
        const beforeMainEnd = html.slice(0, mainEnd).replace(/[ \t]+$/, '');
        return `${beforeMainEnd}\n${block}\n  ${html.slice(mainEnd)}`;
      });
    }
    updated = updated.replace(
      /^[ \t]+\r?\n(?=<!-- (?:document-facts|related-documents):start -->)/gm,
      '',
    );

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
    includeFilter: true,
  }));

  ['mom', 'knowledge', 'notice'].forEach((category) => {
    const meta = categoryTitles[category];
    const outputFile = path.join(rootDir, meta.directory, 'index.html');
    writeFile(outputFile, buildArchiveHtml({
      title: meta.title,
      description: meta.description,
      docs: docs.filter((doc) => doc.category === category),
      outputFile,
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
