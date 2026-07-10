const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const {
  assertIsoDate,
  escapeAttr,
  escapeHtml,
  relativeTo,
  renderPageHead,
  renderTime,
  versionedAssetHref,
  writeTextFile,
} = require('./lib/site-utils');

const rootDir = __dirname;
const sourceDir = path.join(rootDir, '_source', 'MoM');
const outputDir = path.join(rootDir, 'MoM');
const generatedDir = path.join(rootDir, '_source', 'generated');

const requiredFrontMatterFields = ['title', 'date', 'excerpt', 'type', 'slug'];
const documentTypes = {
  minutes: {
    label: '회의록',
    action: '회의록 전문 보기',
  },
  report: {
    label: '결산 자료',
    action: '결산 자료 전문 보기',
  },
};

function parseFrontMatterScalar(rawValue, sourcePath, key) {
  const value = rawValue.trim();
  if (!value) return '';
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`${relativeTo(rootDir, sourcePath)} has invalid JSON quoting for ${key}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseFrontMatter(markdown, sourcePath) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`${relativeTo(rootDir, sourcePath)} must start with YAML front matter`);
  }

  const metadata = {};
  match[1].split(/\r?\n/).forEach((line, index) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) {
      throw new Error(`${relativeTo(rootDir, sourcePath)} has invalid front matter on line ${index + 2}`);
    }
    const [, key, rawValue] = field;
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      throw new Error(`${relativeTo(rootDir, sourcePath)} repeats front matter field: ${key}`);
    }
    metadata[key] = parseFrontMatterScalar(rawValue, sourcePath, key);
  });

  const missing = requiredFrontMatterFields.filter((field) => !String(metadata[field] || '').trim());
  if (missing.length) {
    throw new Error(`${relativeTo(rootDir, sourcePath)} is missing front matter: ${missing.join(', ')}`);
  }

  const unexpected = Object.keys(metadata).filter((field) => !requiredFrontMatterFields.includes(field));
  if (unexpected.length) {
    throw new Error(`${relativeTo(rootDir, sourcePath)} has unsupported front matter: ${unexpected.join(', ')}`);
  }

  metadata.title = String(metadata.title).trim();
  metadata.date = assertIsoDate(metadata.date, `${relativeTo(rootDir, sourcePath)} front matter date`);
  metadata.excerpt = String(metadata.excerpt).trim();
  metadata.type = String(metadata.type).trim();
  metadata.slug = String(metadata.slug).trim();

  if (!documentTypes[metadata.type]) {
    throw new Error(`${relativeTo(rootDir, sourcePath)} type must be one of: ${Object.keys(documentTypes).join(', ')}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug) || metadata.slug === 'index') {
    throw new Error(`${relativeTo(rootDir, sourcePath)} has an unsafe or reserved slug: ${metadata.slug}`);
  }

  return {
    metadata,
    body: markdown.slice(match[0].length),
  };
}

function sanitizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '#';
  if (url.startsWith('//')) return '#';
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^[./#?A-Za-z0-9_%~가-힣-]/.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }
  return '#';
}

function headingClass(level) {
  if (level <= 2) return ['h2', 'section-title'];
  if (level === 3) return ['h3', 'subsection-title'];
  return ['h4', 'subsubsection-title'];
}

function isEscapedAt(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findTokenPositions(markdown, token) {
  const positions = [];
  let line = 1;
  let column = 1;
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      line += 1;
      column = 1;
      continue;
    }
    const isExactStrongMarker = token !== '**'
      || (markdown[index - 1] !== '*' && markdown[index + token.length] !== '*');
    if (isExactStrongMarker && markdown.startsWith(token, index) && !isEscapedAt(markdown, index)) {
      positions.push({ index, line, column });
      index += token.length - 1;
      column += token.length;
      continue;
    }
    column += 1;
  }
  return positions;
}

function findMarkdownSyntaxResidues(markdown) {
  const source = String(markdown || '');
  const issues = [];
  const strongMarkers = findTokenPositions(source, '**');
  if (strongMarkers.length % 2 === 1) {
    const marker = strongMarkers[strongMarkers.length - 1];
    issues.push({
      code: 'unbalanced-strong-marker',
      line: marker.line,
      column: marker.column,
      message: '짝이 맞지 않는 ** 강조 표시가 있습니다.',
    });
  }

  source.split(/\r?\n/).forEach((lineText, lineIndex) => {
    let offset = lineText.indexOf('\\[');
    while (offset !== -1) {
      issues.push({
        code: 'escaped-bracket-residue',
        line: lineIndex + 1,
        column: offset + 1,
        message: '화면에 남을 수 있는 \\[ 이스케이프 잔재가 있습니다.',
      });
      offset = lineText.indexOf('\\[', offset + 2);
    }
  });

  return issues;
}

const markdownResidueFixtures = Object.freeze([
  Object.freeze({
    name: 'unclosed strong marker',
    markdown: '문장에 **닫히지 않은 강조가 있습니다.',
    expectedCode: 'unbalanced-strong-marker',
  }),
  Object.freeze({
    name: 'escaped bracket residue',
    markdown: '> \\[참고] 화면에 역슬래시가 남습니다.',
    expectedCode: 'escaped-bracket-residue',
  }),
]);

function assertNoMarkdownSyntaxResidues(markdown, sourcePath) {
  const issues = findMarkdownSyntaxResidues(markdown);
  if (!issues.length) return;
  const details = issues
    .map((issue) => `${relativeTo(rootDir, sourcePath)}:${issue.line}:${issue.column} ${issue.message}`)
    .join('\n');
  throw new Error(details);
}

function inlineTokenText(token) {
  if (!token) return '';
  if (token.type === 'text' || token.type === 'code_inline') return token.content;
  if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
  if (token.type === 'image') return token.content || '';
  if (token.children) return token.children.map(inlineTokenText).join('');
  return '';
}

function configureMarkdownRenderer() {
  const markdownIt = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  markdownIt.inline.ruler.before('escape', 'safe_br', (state, silent) => {
    const match = state.src.slice(state.pos).match(/^<br\s*\/?>/i);
    if (!match) return false;
    if (!silent) state.push('hardbreak', 'br', 0);
    state.pos += match[0].length;
    return true;
  });

  const defaultLinkOpen = markdownIt.renderer.rules.link_open
    || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  markdownIt.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const hrefIndex = token.attrIndex('href');
    if (hrefIndex >= 0) token.attrs[hrefIndex][1] = sanitizeUrl(token.attrs[hrefIndex][1]);
    token.attrJoin('class', 'content-link');
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  markdownIt.renderer.rules.table_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin('class', 'mom-table');
    return `<div class="table-container" tabindex="0" role="region" aria-label="회의록 표">\n${self.renderToken(tokens, index, options)}`;
  };
  markdownIt.renderer.rules.table_close = (tokens, index, options, env, self) => (
    `${self.renderToken(tokens, index, options)}</div>\n`
  );

  return markdownIt;
}

const markdownRenderer = configureMarkdownRenderer();

function annotateTableCells(tokens) {
  let headers = [];
  let inHeader = false;
  let inBody = false;
  let bodyColumn = 0;

  tokens.forEach((token, index) => {
    if (token.type === 'table_open') headers = [];
    if (token.type === 'thead_open') inHeader = true;
    if (token.type === 'thead_close') inHeader = false;
    if (token.type === 'tbody_open') inBody = true;
    if (token.type === 'tbody_close') inBody = false;
    if (token.type === 'tr_open' && inBody) bodyColumn = 0;
    if (token.type === 'th_open' && inHeader) {
      token.attrSet('scope', 'col');
      headers.push(inlineTokenText(tokens[index + 1]).replace(/\s+/g, ' ').trim());
    }
    if (token.type === 'td_open' && inBody) {
      token.attrSet('data-label', headers[bodyColumn] || '');
      bodyColumn += 1;
    }
  });
}

function annotateDocumentTokens(tokens, title) {
  const toc = [];
  let headingIndex = 0;
  let listDepth = 0;

  tokens.forEach((token, index) => {
    if (token.type === 'paragraph_open') token.attrJoin('class', 'body-text');
    if (token.type === 'blockquote_open') token.attrJoin('class', 'quote-block');
    if (token.type === 'hr') token.attrJoin('class', 'divider');

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth += 1;
      token.attrJoin('class', 'bullet-list');
    }
    if (token.type === 'list_item_open' && listDepth > 1) {
      token.attrJoin('class', `list-level-${Math.min(listDepth - 1, 3)}`);
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth = Math.max(0, listDepth - 1);
    }

    if (token.type !== 'heading_open') return;
    const inlineToken = tokens[index + 1];
    const closingToken = tokens[index + 2];
    const text = inlineTokenText(inlineToken).replace(/\s+/g, ' ').trim();
    if (text === title) {
      token.hidden = true;
      inlineToken.hidden = true;
      inlineToken.content = '';
      inlineToken.children = [];
      closingToken.hidden = true;
      return;
    }

    const level = Number(token.tag.slice(1));
    const [tag, className] = headingClass(level);
    const id = `section-${headingIndex + 1}`;
    headingIndex += 1;
    token.tag = tag;
    closingToken.tag = tag;
    token.attrSet('id', id);
    token.attrJoin('class', className);
    if (level <= 3 && text) toc.push({ id, text, level });
  });

  annotateTableCells(tokens);
  return toc;
}

function parseMarkdown(markdown, title) {
  const normalized = String(markdown || '').replace(/^\s*<br\s*\/?>\s*$/gim, '');
  const env = {};
  const tokens = markdownRenderer.parse(normalized, env);
  const toc = annotateDocumentTokens(tokens, title);
  return {
    content: markdownRenderer.renderer.render(tokens, markdownRenderer.options, env),
    toc,
  };
}

function buildUtilityBar() {
  return `  <div class="utility-bar" id="utility-bar">
    <div class="utility-button-container">
      <button id="zoom-in-btn" aria-label="글자 크기 크게">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
      </button>
      <span class="utility-tooltip">글자 크게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-out-btn" aria-label="글자 크기 작게">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
      </button>
      <span class="utility-tooltip">글자 작게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-reset-btn" aria-label="글자 크기 초기화">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
      </button>
      <span class="utility-tooltip">기본 크기</span>
    </div>
    <div class="utility-button-container">
      <button id="copy-btn" aria-label="텍스트 복사">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
      <span class="utility-tooltip">텍스트 복사</span>
    </div>
    <div class="utility-button-container">
      <button id="copy-link-btn" aria-label="웹페이지 링크 복사">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>
      <span class="utility-tooltip">링크 복사</span>
    </div>
    <div class="utility-button-container">
      <button id="to-top-btn" aria-label="맨 위로 이동">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="18 15 12 9 6 15"></polyline></svg>
      </button>
      <span class="utility-tooltip">맨 위로</span>
    </div>
  </div>`;
}

function renderLogoMark() {
  return `<div class="header-logo logo-mark" role="img" aria-label="우체국물류지원단 물류노동조합 로고">
          <span>우체국물류지원단</span>
          <strong>물류노동조합</strong>
        </div>`;
}

function renderDocumentToc(toc) {
  if (!toc.length) return '';

  const links = toc.map((item) => (
    `        <a href="#${escapeAttr(item.id)}" class="document-toc-link document-toc-level-${item.level}">${escapeHtml(item.text)}</a>`
  )).join('\n');

  return `    <nav class="document-toc" aria-label="문서 목차">
      <h2 class="document-toc-title">문서 목차</h2>
      <div class="document-toc-links">
${links}
      </div>
    </nav>

`;
}

function buildDetailHtml({ title, description, content, toc, date, type, outputPath }) {
  const typeMeta = documentTypes[type];
  const documentTools = versionedAssetHref(rootDir, outputPath, 'assets/document-tools.js');
  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir,
    outputFile: outputPath,
    title,
    description,
    schemaType: 'Article',
    openGraphType: 'article',
    datePublished: date,
  })}
</head>

<body>
  <a href="../index.html" class="back-link">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
    첫 페이지로 돌아가기
  </a>

  <main class="mom-container document-article" id="mom-article" data-document-category="${escapeAttr(typeMeta.label)}">
    <header class="mom-header">
      <div class="header-top-row">
        ${renderLogoMark()}
        <div class="mom-category">${escapeHtml(typeMeta.label)}</div>
      </div>
      <h1 class="statement-title">${escapeHtml(title)}</h1>
      <p class="document-date">${renderTime(date)}</p>
    </header>

${renderDocumentToc(toc)}
    <div class="mom-body" data-copy-body>
${content}
    </div>
  </main>

${buildUtilityBar()}
  <script src="${escapeAttr(documentTools)}" defer></script>
</body>

</html>
`;
}

function buildIndexHtml(docs, outputPath) {
  const cards = docs.map((doc, index) => {
    const idBase = `mom-doc-${index + 1}`;
    return `      <a href="${escapeAttr(doc.outputFileName)}" class="doc-card" data-category="mom" aria-labelledby="${idBase}-title" aria-describedby="${idBase}-meta">
        <div class="card-meta" id="${idBase}-meta">
          <span class="badge-category">${escapeHtml(doc.typeMeta.label)}</span>
          ${renderTime(doc.date)}
        </div>
        <h2 class="doc-title" id="${idBase}-title">${escapeHtml(doc.title)}</h2>
        <p class="doc-excerpt" id="${idBase}-excerpt">${escapeHtml(doc.excerpt)}</p>
        <div class="card-footer" id="${idBase}-action">
          ${escapeHtml(doc.typeMeta.action)}
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
      </a>`;
  }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir,
    outputFile: outputPath,
    title: '운영위원회 회의록 아카이브',
    description: '우체국물류지원단 물류노동조합 운영위원회의 정기 및 임시 회의록 일람입니다.',
    schemaType: 'CollectionPage',
  })}
</head>

<body>
  <main class="archive-container">
    <a href="../index.html" class="back-link">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      첫 페이지로 돌아가기
    </a>
    <header class="archive-header">
      ${renderLogoMark()}
      <h1 class="archive-title">운영위원회 회의록</h1>
      <p class="archive-desc">우체국물류지원단 물류노동조합 운영위원회의 정기 및 임시 회의록 보관소입니다.</p>
    </header>

    <section class="doc-list" aria-label="운영위원회 회의록 목록">
${cards}
    </section>

    <footer class="archive-footer">
      <p>&copy; 2026 우체국물류지원단 물류노동조합. All rights reserved.</p>
    </footer>
  </main>
</body>

</html>
`;
}

function readSourceFiles() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  return fs.readdirSync(sourceDir)
    .filter((file) => path.extname(file) === '.md' && file !== 'README.md' && !file.includes('프레임'))
    .sort();
}

function createMomDocument(file) {
  const sourcePath = path.join(sourceDir, file);
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const { metadata, body } = parseFrontMatter(markdown, sourcePath);
  assertNoMarkdownSyntaxResidues(body, sourcePath);
  const typeMeta = documentTypes[metadata.type];
  const parsed = parseMarkdown(body, metadata.title);
  const outputFileName = `${metadata.slug}.html`;
  const outputPath = path.join(outputDir, outputFileName);

  return {
    sourcePath,
    outputPath,
    outputFileName,
    title: metadata.title,
    date: metadata.date,
    excerpt: metadata.excerpt,
    type: metadata.type,
    typeMeta,
    slug: metadata.slug,
    html: buildDetailHtml({
      title: metadata.title,
      description: metadata.excerpt,
      content: parsed.content,
      toc: parsed.toc,
      date: metadata.date,
      type: metadata.type,
      outputPath,
    }),
  };
}

function assertUniqueMomDocuments(docs) {
  const uniqueFields = [
    ['slug', (doc) => doc.slug],
    ['output path', (doc) => path.resolve(doc.outputPath).toLowerCase()],
    ['public href', (doc) => `MoM/${doc.outputFileName}`.toLowerCase()],
  ];

  uniqueFields.forEach(([label, getValue]) => {
    const seen = new Map();
    docs.forEach((doc) => {
      const value = getValue(doc);
      const previous = seen.get(value);
      if (previous) {
        throw new Error(
          `Duplicate ${label} "${value}" in ${relativeTo(rootDir, previous.sourcePath)} and ${relativeTo(rootDir, doc.sourcePath)}`,
        );
      }
      seen.set(value, doc);
    });
  });
}

function writeMomDocument(doc) {
  writeTextFile(doc.outputPath, doc.html);
}

function toManifestDocument(doc) {
  return {
    category: 'mom',
    href: `MoM/${doc.outputFileName}`,
    title: doc.title,
    date: doc.date,
    excerpt: doc.excerpt,
    action: doc.typeMeta.action,
    type: doc.type,
    slug: doc.slug,
    sortKey: doc.date,
  };
}

function writeMomManifest(docs) {
  writeTextFile(
    path.join(generatedDir, 'mom.json'),
    `${JSON.stringify(docs.map(toManifestDocument), null, 2)}\n`,
  );
}

function logGeneratedFiles(docs) {
  docs.forEach((doc) => {
    console.log(`Generated ${relativeTo(rootDir, doc.outputPath)} from ${relativeTo(rootDir, doc.sourcePath)}`);
  });
  console.log(`Generated ${relativeTo(rootDir, path.join(outputDir, 'index.html'))}`);
  console.log(`Generated ${relativeTo(rootDir, path.join(generatedDir, 'mom.json'))}`);
}

function build() {
  const docs = readSourceFiles().map(createMomDocument);
  assertUniqueMomDocuments(docs);
  docs.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug, 'ko'));
  docs.forEach(writeMomDocument);

  const indexPath = path.join(outputDir, 'index.html');
  writeTextFile(indexPath, buildIndexHtml(docs, indexPath));
  writeMomManifest(docs);
  logGeneratedFiles(docs);
}

module.exports = {
  findMarkdownSyntaxResidues,
  markdownResidueFixtures,
  parseFrontMatter,
  parseMarkdown,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
