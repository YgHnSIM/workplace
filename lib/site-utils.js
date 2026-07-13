const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_ORIGIN = 'https://yghnsim.github.io';
const SITE_BASE_PATH = '/workplace/';
const SITE_NAME = '우체국물류지원단 물류노동조합';
const SITE_DESCRIPTION = `${SITE_NAME} 공개 자료실`;

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

function escapeNoBreakHtml(value) {
  return escapeHtml(value).replace(/\s+/g, '&nbsp;');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertIsoDate(value, fieldName = 'date') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format: ${value}`);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${fieldName} is not a valid calendar date: ${value}`);
  }
  return date;
}

function formatKoreanDate(value) {
  const date = assertIsoDate(value);
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function relativeTo(rootDir, filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}

function contentHash(filePath, length = 12) {
  const digest = crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
  return digest.slice(0, length);
}

function versionedAssetHref(rootDir, outputFile, assetPath) {
  const normalizedAssetPath = toPosixPath(String(assetPath || '').replace(/^\/+/, ''));
  if (!normalizedAssetPath || normalizedAssetPath.split('/').includes('..')) {
    throw new Error(`Unsafe asset path: ${assetPath}`);
  }

  const absoluteAssetPath = path.join(rootDir, ...normalizedAssetPath.split('/'));
  if (!fs.existsSync(absoluteAssetPath)) {
    throw new Error(`Asset is missing: ${normalizedAssetPath}`);
  }

  const relativePath = toPosixPath(path.relative(path.dirname(outputFile), absoluteAssetPath));
  return `${relativePath}?v=${contentHash(absoluteAssetPath)}`;
}

function absolutePublicUrl(publicPath = '') {
  const normalized = toPosixPath(String(publicPath || '').replace(/^\/+/, ''));
  return new URL(`${SITE_BASE_PATH}${normalized}`, SITE_ORIGIN).href;
}

function canonicalPathForOutput(rootDir, outputFile) {
  const relative = relativeTo(rootDir, outputFile);
  if (relative === 'index.html') return '';
  if (relative.endsWith('/index.html')) return `${relative.slice(0, -'index.html'.length)}`;
  return relative;
}

function canonicalUrlForOutput(rootDir, outputFile) {
  return absolutePublicUrl(canonicalPathForOutput(rootDir, outputFile));
}

function safeJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function renderPageHead({
  rootDir,
  outputFile,
  title,
  description = SITE_DESCRIPTION,
  schemaType = 'WebPage',
  openGraphType = 'website',
  datePublished,
  dateModified,
  keywords = [],
  schemaProperties = {},
}) {
  const pageTitle = title === SITE_NAME ? title : `${title} - ${SITE_NAME}`;
  const canonicalUrl = canonicalUrlForOutput(rootDir, outputFile);
  const socialImageUrl = absolutePublicUrl('assets/social-card.png');
  const favicon32 = versionedAssetHref(rootDir, outputFile, 'assets/favicon-32.png');
  const favicon192 = versionedAssetHref(rootDir, outputFile, 'assets/favicon-192.png');
  const stylesheet = versionedAssetHref(rootDir, outputFile, 'assets/interface.css');
  const normalizedDate = datePublished ? assertIsoDate(datePublished, 'datePublished') : '';
  const normalizedModifiedDate = dateModified
    ? assertIsoDate(dateModified, 'dateModified')
    : normalizedDate;
  const normalizedKeywords = Array.isArray(keywords)
    ? keywords.map((keyword) => String(keyword || '').trim()).filter(Boolean)
    : [];
  const publisher = {
    '@type': 'Organization',
    name: SITE_NAME,
    url: absolutePublicUrl(),
    logo: {
      '@type': 'ImageObject',
      url: absolutePublicUrl('assets/favicon-192.png'),
    },
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    headline: title,
    description,
    url: canonicalUrl,
    image: socialImageUrl,
    inLanguage: 'ko-KR',
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absolutePublicUrl(),
    },
    publisher,
    ...(normalizedDate ? { datePublished: normalizedDate } : {}),
    ...(normalizedModifiedDate ? { dateModified: normalizedModifiedDate } : {}),
    ...(normalizedKeywords.length ? { keywords: normalizedKeywords.join(', ') } : {}),
    ...schemaProperties,
  };
  const articleDateMeta = [
    normalizedDate
      ? `<meta property="article:published_time" content="${escapeAttr(normalizedDate)}">`
      : '',
    normalizedModifiedDate
      ? `<meta property="article:modified_time" content="${escapeAttr(normalizedModifiedDate)}">`
      : '',
  ].filter(Boolean).map((meta) => `\n  ${meta}`).join('');
  const keywordMeta = normalizedKeywords.length
    ? `\n  <meta name="keywords" content="${escapeAttr(normalizedKeywords.join(', '))}">`
    : '';

  return `  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:type" content="${escapeAttr(openGraphType)}">
  <meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">
  <meta property="og:title" content="${escapeAttr(pageTitle)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  <meta property="og:image" content="${escapeAttr(socialImageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">${articleDateMeta}${keywordMeta}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(pageTitle)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${escapeAttr(socialImageUrl)}">
  <link rel="icon" href="${escapeAttr(favicon32)}" sizes="32x32" type="image/png">
  <link rel="icon" href="${escapeAttr(favicon192)}" sizes="192x192" type="image/png">
  <link rel="apple-touch-icon" href="${escapeAttr(favicon192)}" sizes="192x192">
  <link rel="stylesheet" href="${escapeAttr(stylesheet)}">
  <script type="application/ld+json">
${safeJson(jsonLd)}
  </script>`;
}

function renderTime(value, className = 'doc-date') {
  const date = assertIsoDate(value);
  const classAttribute = className ? ` class="${escapeAttr(className)}"` : '';
  return `<time${classAttribute} datetime="${escapeAttr(date)}">${escapeNoBreakHtml(formatKoreanDate(date))}</time>`;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
}

function isExternalRef(ref) {
  return /^(https?:|mailto:|tel:|#)/i.test(ref);
}

function walkFiles(dir, options = {}) {
  const ignoredDirs = options.ignoredDirs || new Set();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) return;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, options));
      return;
    }

    if (entry.isFile()) files.push(fullPath);
  });

  return files;
}

module.exports = {
  SITE_BASE_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  absolutePublicUrl,
  assertIsoDate,
  canonicalUrlForOutput,
  contentHash,
  escapeAttr,
  escapeHtml,
  escapeNoBreakHtml,
  formatKoreanDate,
  isExternalRef,
  readJson,
  relativeTo,
  renderPageHead,
  renderTime,
  toPosixPath,
  versionedAssetHref,
  walkFiles,
  writeTextFile,
};
