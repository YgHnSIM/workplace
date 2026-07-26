const path = require('path');
const MarkdownIt = require('markdown-it');
const {
  escapeAttr,
  relativeTo,
  renderPageHead,
  versionedAssetHref,
} = require('./lib/site-utils');
const { loadContentGraph, parseYamlFrontMatter } = require('./lib/content-model');
const { writeOutputMap } = require('./lib/build-utils');
const {
  renderDocumentHeader,
  renderDocumentToc,
  renderDocumentTools,
  renderSiteMasthead,
} = require('./lib/site-components');

const rootDir = __dirname;
function parseFrontMatter(markdown, sourcePath) {
  const label = relativeTo(rootDir, sourcePath);
  try {
    return parseYamlFrontMatter(markdown, label);
  } catch (error) {
    throw new Error(error.message);
  }
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

function topicLabelsForRecord(record, graph) {
  return record.topicIds.map((topicId) => graph.topicsById.get(topicId)?.label || topicId);
}

function renderMomDocument(record, sourceData, graph, outputPath) {
  const buildRoot = graph.projectRoot || rootDir;
  const parsed = parseMarkdown(sourceData.body, record.title);
  const category = graph.categoryRegistry.find((candidate) => candidate.key === 'mom');
  const documentTools = versionedAssetHref(buildRoot, outputPath, 'assets/document-tools.js');
  const topicLabels = topicLabelsForRecord(record, graph);
  return `<!DOCTYPE html>
<html lang="ko">

<head>
${renderPageHead({
    rootDir: buildRoot,
    outputFile: outputPath,
    title: record.title,
    description: record.summary,
    record,
    schemaType: 'WebPage',
    openGraphType: 'article',
    keywords: topicLabels,
    topicLabels,
  })}
</head>

<body>
${renderSiteMasthead({ rootDir: buildRoot, outputFile: outputPath })}
  <main class="mom-container document-article" id="mom-article" data-document-category="${escapeAttr(category.label)}">
${renderDocumentHeader({
    rootDir: buildRoot,
    outputFile: outputPath,
    category: 'mom',
    title: record.title,
    description: record.summary,
  })}

${renderDocumentToc(parsed.toc)}
    <div class="mom-body" data-copy-body>
${parsed.content}
    </div>
  </main>

${renderDocumentTools()}
  <script src="${escapeAttr(documentTools)}" defer></script>
</body>

</html>
`;
}

function renderMomOutputs(graph = loadContentGraph({ projectRoot: rootDir })) {
  const outputs = new Map();
  const buildRoot = graph.projectRoot || rootDir;
  graph.documents.filter((record) => record.category === 'mom').forEach((record) => {
    const sourceData = graph.sourceDataById.get(record.id);
    if (!sourceData || typeof sourceData.body !== 'string') {
      throw new Error(`${record.id} has no Markdown source body`);
    }
    const outputPath = path.join(buildRoot, ...record.route.split('/'));
    outputs.set(outputPath, renderMomDocument(record, sourceData, graph, outputPath));
  });
  return outputs;
}

function build() {
  const graph = loadContentGraph({ projectRoot: rootDir });
  const outputs = renderMomOutputs(graph);
  writeOutputMap(outputs, { projectRoot: rootDir });
  outputs.forEach((_content, outputPath) => {
    console.log(`Generated ${relativeTo(graph.projectRoot || rootDir, outputPath)}`);
  });
}

module.exports = {
  findMarkdownSyntaxResidues,
  markdownResidueFixtures,
  parseFrontMatter,
  parseMarkdown,
  renderMomOutputs,
};

if (require.main === module) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
