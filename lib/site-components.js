const path = require('path');
const {
  escapeAttr,
  escapeHtml,
  toPosixPath,
  versionedAssetHref,
} = require('./site-utils');
const { CATEGORY_REGISTRY } = require('./content-model');

const archiveCategories = Object.freeze([
  Object.freeze({ key: 'all', label: '전체', directory: '' }),
  ...CATEGORY_REGISTRY.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    directory: category.directory,
  })),
]);

const categoryByKey = new Map(archiveCategories.map((category) => [category.key, category]));

function categoryFor(key) {
  return categoryByKey.get(key) || categoryByKey.get('all');
}

function archiveHref(rootDir, outputFile, category = 'all') {
  const targetDirectory = path.join(rootDir, categoryFor(category).directory);
  const relative = toPosixPath(path.relative(path.dirname(outputFile), targetDirectory));
  if (!relative) return './';
  return `${relative.replace(/\/$/, '')}/`;
}

function renderIcon(name) {
  const icons = {
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"></path></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11"></rect><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"></path></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="2"></circle><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="19" r="2"></circle><path d="m8 11 8-5M8 13l8 5"></path></svg>',
    top: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"></path><path d="M12 8v11"></path></svg>',
  };
  return icons[name] || '';
}

function renderSiteMasthead({ rootDir, outputFile }) {
  const homeHref = archiveHref(rootDir, outputFile, 'all');
  const logo300 = versionedAssetHref(rootDir, outputFile, 'assets/logo-header-300.webp');
  const logo600 = versionedAssetHref(rootDir, outputFile, 'assets/logo-header-600.webp');

  return `<!-- site-masthead:start -->
  <header class="site-masthead">
    <a class="site-logo" href="${escapeAttr(homeHref)}" aria-label="우체국물류지원단 물류노동조합 첫 페이지">
      <img src="${escapeAttr(logo300)}" srcset="${escapeAttr(logo300)} 1x, ${escapeAttr(logo600)} 2x" width="300" height="84" alt="우체국물류지원단 물류노동조합">
    </a>
    <a class="site-archive-entry" href="${escapeAttr(homeHref)}">공개 자료실</a>
  </header>
<!-- site-masthead:end -->`;
}

function renderBreadcrumb({ rootDir, outputFile, category }) {
  const categoryMeta = categoryFor(category);
  const homeHref = archiveHref(rootDir, outputFile, 'all');
  const categoryHref = archiveHref(rootDir, outputFile, categoryMeta.key);
  return `    <nav class="document-breadcrumb" aria-label="현재 위치">
      <ol>
        <li><a href="${escapeAttr(homeHref)}">공개 자료실</a></li>
        <li aria-current="page"><a href="${escapeAttr(categoryHref)}">${escapeHtml(categoryMeta.label)}</a></li>
      </ol>
    </nav>`;
}

function renderArchiveCategoryNav({ rootDir, outputFile, activeCategory = 'all' }) {
  const links = archiveCategories.map((category) => {
    const current = category.key === activeCategory ? ' aria-current="page"' : '';
    return `      <a href="${escapeAttr(archiveHref(rootDir, outputFile, category.key))}"${current}>${escapeHtml(category.label)}</a>`;
  }).join('\n');
  return `    <nav class="archive-category-nav" aria-label="자료 분류">
${links}
    </nav>`;
}

function renderDocumentHeader({ rootDir, outputFile, category, title, description, className = '' }) {
  return `    <header class="document-header${className ? ` ${escapeAttr(className)}` : ''}">
${renderBreadcrumb({ rootDir, outputFile, category })}
      <h1 class="document-title">${escapeHtml(title)}</h1>
      ${description ? `<p class="document-summary">${escapeHtml(description)}</p>` : ''}
    </header>`;
}

function renderDocumentTools() {
  return `<!-- document-tools:start -->
  <div class="document-tools" data-document-tools>
    <button class="document-tools-trigger" type="button" aria-expanded="false" aria-controls="document-tools-panel">문서 도구</button>
    <div class="document-tools-backdrop" hidden></div>
    <section class="document-tools-panel" id="document-tools-panel" aria-label="문서 도구" role="dialog" aria-modal="false" tabindex="-1" hidden>
      <div class="document-tools-panel-header">
        <h2>문서 도구</h2>
        <button class="document-tools-close" type="button" aria-label="문서 도구 닫기">닫기</button>
      </div>
      <div class="document-tools-size" role="group" aria-label="글자 크기">
        <button type="button" data-document-action="font-down">글자 축소</button>
        <output id="document-font-scale" for="document-font-down document-font-up">현재 100%</output>
        <button type="button" data-document-action="font-up">글자 확대</button>
        <button type="button" data-document-action="font-reset">초기화</button>
      </div>
      <div class="document-tools-actions">
        <button type="button" data-document-action="copy-document">${renderIcon('copy')}<span>본문 복사</span></button>
        <button type="button" data-document-action="share">${renderIcon('share')}<span>공유</span></button>
        <button type="button" data-document-action="copy-link">${renderIcon('copy')}<span>링크 복사</span></button>
        <button type="button" data-document-action="top">${renderIcon('top')}<span>맨 위로</span></button>
      </div>
      <p class="document-tools-status" id="document-action-status" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>
  </div>
<!-- document-tools:end -->`;
}

function normalizeToc(toc) {
  const groups = [];
  let currentGroup;
  toc.forEach((item) => {
    if (!item || !item.id || !item.text) return;
    if (Number(item.level) <= 2) {
      currentGroup = { ...item, children: [] };
      groups.push(currentGroup);
      return;
    }
    if (!currentGroup) {
      currentGroup = { id: '', text: '세부 항목', level: 2, children: [] };
      groups.push(currentGroup);
    }
    currentGroup.children.push(item);
  });
  return groups;
}

function renderDocumentToc(toc) {
  const groups = normalizeToc(Array.isArray(toc) ? toc : []);
  if (!groups.length) return '';
  const sections = groups.map((group) => {
    const groupLink = group.id
      ? `<a class="document-toc-link document-toc-section" href="#${escapeAttr(group.id)}">${escapeHtml(group.text)}</a>`
      : `<span class="document-toc-section">${escapeHtml(group.text)}</span>`;
    const children = group.children.length
      ? `\n          <ol class="document-toc-children">\n${group.children.map((item) => (
        `            <li><a class="document-toc-link document-toc-child" href="#${escapeAttr(item.id)}">${escapeHtml(item.text)}</a></li>`
      )).join('\n')}\n          </ol>`
      : '';
    return `        <li class="document-toc-group">\n          ${groupLink}${children}\n        </li>`;
  }).join('\n');

  return `    <nav class="document-toc" aria-label="문서 목차" data-generated-toc="true">
      <div class="document-toc-heading">
        <h2 class="document-toc-title">문서 목차</h2>
        <button class="document-toc-toggle" type="button">목차 접기</button>
      </div>
      <ol class="document-toc-sections">
${sections}
      </ol>
    </nav>`;
}

module.exports = {
  archiveCategories,
  archiveHref,
  categoryFor,
  renderArchiveCategoryNav,
  renderBreadcrumb,
  renderDocumentHeader,
  renderDocumentToc,
  renderDocumentTools,
  renderIcon,
  renderSiteMasthead,
};
