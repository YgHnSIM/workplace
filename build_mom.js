const fs = require('fs');
const path = require('path');
const {
  escapeAttr,
  escapeHtml,
  escapeNoBreakHtml,
  relativeTo,
  writeTextFile,
} = require('./lib/site-utils');

const rootDir = __dirname;
const sourceDir = path.join(rootDir, '_source', 'MoM');
const outputDir = path.join(rootDir, 'MoM');
const generatedDir = path.join(rootDir, '_source', 'generated');
const assetVersion = '20260707-6';

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

function stripMarkdown(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInline(value) {
  const tokens = [];
  const save = (html) => {
    const token = `@@TOKEN_${tokens.length}@@`;
    tokens.push(html);
    return token;
  };

  let text = String(value || '');
  text = text.replace(/<br\s*\/?>/gi, () => save('<br>'));
  text = text.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return save(`<a href="${escapeAttr(sanitizeUrl(url))}" class="content-link">${renderInline(label)}</a>`);
  });
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  tokens.forEach((html, index) => {
    text = text.replace(`@@TOKEN_${index}@@`, html);
  });
  return text;
}

function splitTableRow(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(row) {
  const cells = splitTableRow(row);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(line) {
  return /^#{1,6}\s+/.test(line)
    || /^(-{3,}|\*{3,})$/.test(line.trim())
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>/.test(line)
    || /^\s*\|/.test(line)
    || /^<br\s*\/?>$/i.test(line.trim());
}

function renderTable(rows) {
  const validRows = rows.filter((row) => !isTableSeparator(row));
  if (validRows.length === 0) return '';

  const headers = splitTableRow(validRows[0]).map(stripMarkdown);
  let html = '<div class="table-container">\n<table class="mom-table">\n';
  validRows.forEach((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td';
    html += '  <tr>\n';
    splitTableRow(row).forEach((cell, cellIndex) => {
      const label = rowIndex === 0 ? '' : ` data-label="${escapeAttr(headers[cellIndex] || '')}"`;
      html += `    <${tag}${label}>${renderInline(cell)}</${tag}>\n`;
    });
    html += '  </tr>\n';
  });
  html += '</table>\n</div>\n';
  return html;
}

function renderList(rows, ordered = false) {
  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag} class="bullet-list">\n`;
  rows.forEach((row) => {
    const match = ordered ? row.match(/^(\s*)\d+[.)]\s+(.*)$/) : row.match(/^(\s*)[-*]\s+(.*)$/);
    if (!match) return;

    const indent = match[1].replace(/\t/g, '  ').length;
    const level = Math.min(Math.floor(indent / 2), 3);
    const levelClass = level > 0 ? ` class="list-level-${level}"` : '';
    html += `  <li${levelClass}>${renderInline(match[2])}</li>\n`;
  });
  html += `</${tag}>\n`;
  return html;
}

function renderBlockquote(rows) {
  const text = rows.map((row) => row.replace(/^\s*>\s?/, '').trim()).join(' ');
  return `<blockquote class="quote-block">${renderInline(text)}</blockquote>\n`;
}

function headingClass(level) {
  if (level <= 2) return ['h2', 'section-title'];
  if (level === 3) return ['h3', 'subsection-title'];
  return ['h4', 'subsubsection-title'];
}

function parseMarkdown(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  let html = '';
  const toc = [];
  let headingIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line || /^<br\s*\/?>$/i.test(line)) {
      continue;
    }

    if (/^\s*\|/.test(rawLine)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html += renderTable(rows);
      continue;
    }

    if (/^\s*[-*]\s+/.test(rawLine) || /^\s*\d+[.)]\s+/.test(rawLine)) {
      const ordered = /^\s*\d+[.)]\s+/.test(rawLine);
      const rows = [];
      const listPattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && (listPattern.test(lines[i]) || !lines[i].trim())) {
        if (lines[i].trim()) rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html += renderList(rows, ordered);
      continue;
    }

    if (/^\s*>/.test(rawLine)) {
      const rows = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html += renderBlockquote(rows);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const text = stripMarkdown(heading[2].replace(/\s+#+$/, ''));
      if (text && text !== title) {
        const level = heading[1].length;
        const [tag, className] = headingClass(level);
        const id = `section-${headingIndex + 1}`;
        headingIndex += 1;
        if (level <= 3) toc.push({ id, text, level });
        html += `<${tag} id="${id}" class="${className}">${escapeHtml(text)}</${tag}>\n`;
      }
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      html += '<hr class="divider">\n';
      continue;
    }

    const paragraph = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !isBlockStart(lines[i + 1])) {
      i += 1;
      paragraph.push(lines[i].trim());
    }
    html += `<p class="body-text">${renderInline(paragraph.join(' '))}</p>\n`;
  }

  return { content: html, toc };
}

function cleanHeadingText(line) {
  return stripMarkdown(line.replace(/^#{1,6}\s+/, ''));
}

function extractTitle(markdown, fileName) {
  const heading = markdown.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (heading) {
    const text = cleanHeadingText(heading);
    if (!/^[IVX]+\.\s+/i.test(text)) return text;
  }

  const fileMatch = fileName.match(/^(\d{4})(\d{2})/);
  if (fileMatch) return `${fileMatch[1]}년 ${Number(fileMatch[2])}월 운영위원회 회의록`;
  return path.basename(fileName, path.extname(fileName));
}

function makePublicMarkdown(markdown) {
  return markdown;
}

function extractDate(markdown, fileName) {
  const dateMatch = markdown.match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/);
  if (dateMatch) return dateMatch[1].replace(/\s+/g, ' ');

  const fileMatch = fileName.match(/^(\d{4})(\d{2})/);
  if (fileMatch) return `${fileMatch[1]}년 ${Number(fileMatch[2])}월`;
  return '';
}

function extractExcerpt(publicMarkdown) {
  const lines = publicMarkdown.split(/\r?\n/);
  let inSummary = false;
  let tableHeaderSeen = false;

  for (const line of lines) {
    const clean = cleanHeadingText(line.trim());
    if (/^IV\.\s+/.test(clean) || /주요 결정|결정사항|결정 사항|핵심 요약/.test(clean)) {
      inSummary = true;
      continue;
    }
    if (inSummary && /^#{1,6}\s+/.test(line) && !/^IV\.\s+/.test(clean) && !/주요 결정|결정사항|결정 사항|핵심 요약/.test(clean)) break;
    if (!inSummary) continue;

    if (/^\s*\|/.test(line) && !isTableSeparator(line)) {
      if (!tableHeaderSeen) {
        tableHeaderSeen = true;
        continue;
      }
      const text = splitTableRow(line).slice(1).map(stripMarkdown).join(' - ');
      if (text) return text.slice(0, 120);
    }

    const list = line.match(/^\s*[-*]\s+(.*)$/);
    if (list) return stripMarkdown(list[1]).slice(0, 120);
  }

  return '운영위원회 회의 주요 내용과 결정사항을 정리한 회의록입니다.';
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

function buildDetailHtml({ title, description, content, toc }) {
  return `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="icon" href="../logo_정사각형.png" type="image/png">
  <link rel="stylesheet" href="../assets/interface.css?v=${assetVersion}">
</head>

<body>
  <a href="../index.html" class="back-link">
    <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
    첫 페이지로 돌아가기
  </a>

  <article class="mom-container document-article" id="mom-article" data-document-category="회의록">
    <header class="mom-header">
      <div class="header-top-row">
        <img src="../logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
        <div class="mom-category">회의록</div>
      </div>
      <h1 class="statement-title">${escapeHtml(title)}</h1>
    </header>

${renderDocumentToc(toc)}
    <main class="mom-body" data-copy-body>
${content}
    </main>
  </article>

${buildUtilityBar()}
  <script src="../assets/document-tools.js?v=${assetVersion}"></script>
</body>

</html>
`;
}

function buildIndexHtml(docs) {
  const cards = docs.map((doc, index) => {
    const idBase = `mom-doc-${index + 1}`;
    return `      <a href="${escapeAttr(doc.outputFileName)}" class="doc-card" aria-labelledby="${idBase}-title" aria-describedby="${idBase}-meta ${idBase}-excerpt ${idBase}-action">
        <div class="card-meta" id="${idBase}-meta">
          <span class="badge-category">회의록</span>
          <span class="doc-date">${escapeNoBreakHtml(doc.date)}</span>
        </div>
        <h2 class="doc-title" id="${idBase}-title">${escapeHtml(doc.title)}</h2>
        <p class="doc-excerpt" id="${idBase}-excerpt">${escapeHtml(doc.excerpt)}</p>
        <div class="card-footer" id="${idBase}-action">
          회의록 전문 보기
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
      </a>`;
  }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>운영위원회 회의록 아카이브 - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="우체국물류지원단 물류노동조합 운영위원회의 정기 및 임시 회의록 일람입니다.">
  <link rel="icon" href="../logo_정사각형.png" type="image/png">
  <link rel="stylesheet" href="../assets/interface.css?v=${assetVersion}">
</head>

<body>
  <div class="archive-container">
    <a href="../index.html" class="back-link">
      <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      첫 페이지로 돌아가기
    </a>
    <header class="archive-header">
      <img src="../logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
      <h1 class="archive-title">운영위원회 회의록</h1>
      <p class="archive-desc">우체국물류지원단 물류노동조합 운영위원회의 정기 및 임시 회의록 보관소입니다.</p>
    </header>

    <div class="doc-list">
${cards}
    </div>

    <footer class="archive-footer">
      <p>&copy; 2026 우체국물류지원단 물류노동조합. All rights reserved.</p>
    </footer>
  </div>
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
  const title = extractTitle(markdown, file);
  const publicMarkdown = makePublicMarkdown(markdown, title);
  const parsed = parseMarkdown(publicMarkdown, title);
  const match = file.match(/^(\d{6})/);
  const outputFileName = match ? `${match[1]}.html` : `${path.basename(file, '.md')}.html`;
  const description = `${title} - 우체국물류지원단 물류노동조합 공식 회의록입니다.`;
  const outputPath = path.join(outputDir, outputFileName);

  return {
    sourcePath,
    outputPath,
    outputFileName,
    title,
    date: extractDate(markdown, file),
    excerpt: extractExcerpt(publicMarkdown),
    sortKey: match ? match[1] : file,
    html: buildDetailHtml({ title, description, content: parsed.content, toc: parsed.toc }),
  };
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
    action: '회의록 전문 보기',
    sortKey: doc.sortKey,
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
  docs.forEach(writeMomDocument);

  docs.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  writeTextFile(path.join(outputDir, 'index.html'), buildIndexHtml(docs));
  writeMomManifest(docs);
  logGeneratedFiles(docs);
}

try {
  build();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
