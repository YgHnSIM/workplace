const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const {
  assertIsoDate,
  escapeAttr,
  relativeTo,
  renderPageHead,
  versionedAssetHref,
  writeTextFile,
} = require('./lib/site-utils');
const {
  renderDocumentHeader,
  renderDocumentToc,
  renderDocumentTools,
  renderSiteMasthead,
} = require('./lib/site-components');

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
  if (!toc.some((item) => item.level === 2)) {
    toc.forEach((item) => {
      if (item.level === 3) item.level = 2;
    });
  }
  return {
    content: markdownRenderer.renderer.render(tokens, markdownRenderer.options, env),
    toc,
  };
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
    dateModified: date,
    keywords: type === 'report' ? ['운영위원회', '결산'] : ['운영위원회', '회의록'],
  })}
</head>

<body>
${renderSiteMasthead({ rootDir, outputFile: outputPath })}
  <main class="mom-container document-article" id="mom-article" data-document-category="${escapeAttr(typeMeta.label)}">
${renderDocumentHeader({
    rootDir,
    outputFile: outputPath,
    category: 'mom',
    title,
    description,
  })}

${renderDocumentToc(toc)}
    <div class="mom-body" data-copy-body>
${content}
    </div>
  </main>

${renderDocumentTools()}
  <script src="${escapeAttr(documentTools)}" defer></script>
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
  const topics = metadata.type === 'report' ? ['운영위원회', '결산'] : ['운영위원회', '회의록'];

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
    status: 'final',
    topics,
    sourceCount: 1,
    provenance: '노동조합 운영위원회 공식 기록',
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
    dateModified: doc.date,
    excerpt: doc.excerpt,
    action: doc.typeMeta.action,
    type: doc.type,
    slug: doc.slug,
    sortKey: doc.date,
    status: doc.status,
    topics: doc.topics,
    sourceCount: doc.sourceCount,
    provenance: doc.provenance,
    relatedDocuments: [],
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
  console.log(`Generated ${relativeTo(rootDir, path.join(generatedDir, 'mom.json'))}`);
}

function build() {
  const docs = readSourceFiles().map(createMomDocument);
  assertUniqueMomDocuments(docs);
  docs.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug, 'ko'));
  docs.forEach(writeMomDocument);

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
