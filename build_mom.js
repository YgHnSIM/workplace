const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const sourceDir = path.join(rootDir, '_source', 'MoM');
const outputDir = path.join(rootDir, 'MoM');

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '#';
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

  let html = '<div class="table-container">\n<table class="mom-table">\n';
  validRows.forEach((row, rowIndex) => {
    const tag = rowIndex === 0 ? 'th' : 'td';
    html += '  <tr>\n';
    splitTableRow(row).forEach((cell) => {
      html += `    <${tag}>${renderInline(cell)}</${tag}>\n`;
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
        html += `<${tag} class="${className}">${escapeHtml(text)}</${tag}>\n`;
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

  return html;
}

function cleanHeadingText(line) {
  return stripMarkdown(line.replace(/^#{1,6}\s+/, ''));
}

function getPublicSectionType(line) {
  const clean = cleanHeadingText(line);
  const roman = clean.match(/^([IVX]+)\.\s+/i);
  const numbered = clean.match(/^(\d+)\.\s*/);
  const isMajorSection = roman || numbered || /회의 개요|주요 결정|결정사항|결정 사항|핵심 요약|차기 회의/.test(clean);

  if (!isMajorSection) return null;
  if (/회의 개요/.test(clean)) return 'overview';
  if (/주요 결정|결정사항|결정 사항|핵심 요약/.test(clean)) return 'summary';
  if (/차기 회의/.test(clean)) return 'next';

  if (roman) {
    const key = roman[1].toUpperCase();
    if (key === 'I') return 'overview';
    if (key === 'IV') return 'summary';
    if (key === 'V') return 'next';
  }

  return 'private';
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

function collectAttendeeNames(markdown) {
  const names = new Set();
  markdown.split(/\r?\n/).forEach((line) => {
    if (!/^\s*\|/.test(line)) return;
    const cells = splitTableRow(line).map(stripMarkdown);
    if (cells.length < 2 || !/(참석|참관)/.test(cells[0])) return;

    cells[1]
      .replace(/<br\s*\/?>/gi, ',')
      .split(',')
      .map((part) => part.replace(/\([^)]*\)/g, '').trim())
      .forEach((part) => {
        const match = part.match(/^[가-힣]{2,4}/);
        if (match) names.add(match[0]);
      });
  });
  return Array.from(names).sort((a, b) => b.length - a.length);
}

function redactLine(line, names) {
  if (/^\s*\|/.test(line)) {
    const cells = splitTableRow(line);
    const firstCell = stripMarkdown(cells[0] || '');
    if (/(참석|참관)/.test(firstCell)) {
      return `| ${firstCell} | 세부 명단 비공개 |`;
    }
  }

  let result = line;
  names.forEach((name) => {
    result = result.replace(new RegExp(`${escapeRegExp(name)}\\s*(위원장|사무국장|국장|지부장|감사|간사|위원)`, 'g'), '담당 $1');
    result = result.replace(new RegExp(escapeRegExp(name), 'g'), '담당자');
  });
  return result;
}

function makePublicMarkdown(markdown, title) {
  const names = collectAttendeeNames(markdown);
  const sections = [];
  let current = { type: 'private', lines: [] };

  markdown.split(/\r?\n/).forEach((line) => {
    const type = /^#{1,6}\s+/.test(line.trim()) ? getPublicSectionType(line.trim()) : null;
    const clean = cleanHeadingText(line.trim());
    const isDocumentTitle = /^#\s+/.test(line.trim()) && clean === title;

    if (type && !isDocumentTitle) {
      if (current.lines.length > 0) sections.push(current);
      current = { type, lines: [line] };
      return;
    }

    if (!isDocumentTitle) current.lines.push(line);
  });
  if (current.lines.length > 0) sections.push(current);

  const publicLines = [];
  sections.forEach((section) => {
    if (!['overview', 'summary', 'next'].includes(section.type)) return;
    section.lines.forEach((line) => {
      if (/^<br\s*\/?>$/i.test(line.trim())) return;
      publicLines.push(redactLine(line, names));
    });
    publicLines.push('');
  });

  if (publicLines.length === 0) {
    return markdown
      .split(/\r?\n/)
      .map((line) => redactLine(line, names))
      .join('\n');
  }

  return publicLines.join('\n').trim();
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

  return '회의 개요, 주요 결정사항, 차기 회의 안내를 정리한 공개용 요약본입니다.';
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
      <button id="print-btn" aria-label="인쇄 또는 PDF 저장">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
      </button>
      <span class="utility-tooltip">인쇄 / PDF</span>
    </div>
    <div class="utility-button-container">
      <button id="to-top-btn" aria-label="맨 위로 이동">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="18 15 12 9 6 15"></polyline></svg>
      </button>
      <span class="utility-tooltip">맨 위로</span>
    </div>
  </div>`;
}

function buildDetailHtml({ title, description, content }) {
  return `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="icon" href="../logo_정사각형.png" type="image/png">
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
    :root {
      --font-scale: 1.0;
      --font-size-base: calc(16px * var(--font-scale));
      --font-size-title: calc(26px * var(--font-scale));
      --font-size-section-title: calc(20px * var(--font-scale));
      --font-size-subsection-title: calc(17px * var(--font-scale));
      --spacing-unit: 1.5rem;
      --bg-page: #f8fafc;
      --bg-card: #ffffff;
      --text-primary: #0f172a;
      --text-secondary: #334155;
      --text-muted: #64748b;
      --color-accent: #1e3a8a;
      --color-accent-light: #eff6ff;
      --color-border: #e2e8f0;
      --font-main: 'Pretendard', sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-main);
      background-color: var(--bg-page);
      color: var(--text-primary);
      line-height: 1.8;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px 100px;
    }
    .mom-container {
      width: 100%;
      max-width: 800px;
      background-color: var(--bg-card);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 48px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,.05), 0 2px 4px -1px rgba(0,0,0,.03);
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 24px;
      align-self: flex-start;
      max-width: 800px;
      width: 100%;
      transition: color .2s ease;
    }
    .back-link:hover { color: var(--color-accent); }
    .back-link svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.5; }
    .mom-header { border-bottom: 2px solid var(--color-border); padding-bottom: 20px; margin-bottom: 30px; }
    .header-top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .header-logo { height: 48px; object-fit: contain; }
    .mom-category {
      font-size: 13px;
      font-weight: 800;
      background-color: var(--color-accent-light);
      color: var(--color-accent);
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: .05em;
    }
    .statement-title { font-size: var(--font-size-title); font-weight: 900; line-height: 1.4; word-break: keep-all; }
    .public-note {
      margin-top: 16px;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 600;
      word-break: keep-all;
    }
    .section-title {
      font-size: var(--font-size-section-title);
      font-weight: 800;
      color: var(--color-accent);
      margin-top: 40px;
      margin-bottom: 16px;
      border-bottom: 2px solid var(--color-accent-light);
      padding-bottom: 8px;
    }
    .subsection-title {
      font-size: var(--font-size-subsection-title);
      font-weight: 800;
      margin-top: 28px;
      margin-bottom: 12px;
      border-left: 4px solid var(--color-accent);
      padding-left: 10px;
    }
    .subsubsection-title {
      font-size: calc(var(--font-size-base) * 1.08);
      font-weight: 800;
      margin-top: 24px;
      margin-bottom: 10px;
    }
    .body-text {
      font-size: var(--font-size-base);
      color: var(--text-secondary);
      margin-bottom: var(--spacing-unit);
      text-align: justify;
      word-break: keep-all;
    }
    .bullet-list { margin-left: 24px; margin-bottom: var(--spacing-unit); color: var(--text-secondary); font-size: var(--font-size-base); }
    .bullet-list li { margin-bottom: 8px; }
    .bullet-list .list-level-1 { margin-left: 1.25rem; }
    .bullet-list .list-level-2 { margin-left: 2.5rem; }
    .content-link { color: var(--color-accent); text-decoration: underline; font-weight: 700; }
    .quote-block {
      border-left: 4px solid var(--color-border);
      color: var(--text-secondary);
      margin: 0 0 var(--spacing-unit);
      padding: 8px 0 8px 16px;
      background: #fafbfc;
    }
    .table-container { width: 100%; overflow-x: auto; margin: 20px 0 30px; border: 1px solid var(--color-border); border-radius: 8px; }
    .mom-table { width: 100%; border-collapse: collapse; font-size: calc(var(--font-size-base) * .95); text-align: left; min-width: 500px; }
    .mom-table th, .mom-table td { padding: 12px 16px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
    .mom-table th { background-color: var(--color-accent-light); color: var(--color-accent); font-weight: 800; border-bottom: 2px solid var(--color-border); }
    .mom-table tr:last-child th, .mom-table tr:last-child td { border-bottom: none; }
    .mom-table td strong { color: var(--color-accent); }
    .divider { border: none; border-top: 1px solid var(--color-border); margin: 30px 0; }
    .utility-bar {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(255,255,255,.9);
      backdrop-filter: blur(10px);
      border: 1px solid var(--color-border);
      border-radius: 30px;
      padding: 6px 12px;
      display: flex;
      gap: 8px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.05);
      z-index: 1000;
    }
    .utility-button-container { position: relative; }
    .utility-bar button {
      background: none;
      border: none;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .2s ease;
    }
    .utility-bar button:hover { background-color: var(--color-accent-light); color: var(--color-accent); }
    .utility-bar button svg { width: 20px; height: 20px; }
    .utility-tooltip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) translateY(-8px);
      background-color: var(--text-primary);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity .2s ease;
    }
    .utility-button-container:hover .utility-tooltip { opacity: 1; }
    @media print {
      body { background-color: #fff; padding: 0; }
      .mom-container { box-shadow: none; border: none; padding: 0; }
      .utility-bar, .back-link { display: none !important; }
    }
    @media (max-width: 600px) {
      body { padding: 20px 10px 100px; }
      .mom-container { padding: 24px 16px; box-shadow: none; border: none; }
      .back-link { padding-left: 16px; }
      .statement-title { font-size: calc(20px * var(--font-scale)); }
      .utility-bar {
        bottom: 16px;
        right: 16px;
        left: 16px;
        justify-content: space-around;
        padding: 8px;
        border-radius: 16px;
        width: calc(100% - 32px);
      }
      .utility-tooltip { display: none; }
      .header-top-row { flex-direction: column; align-items: flex-start; gap: 16px; }
      .header-logo { height: 38px; }
    }
  </style>
</head>

<body>
  <a href="index.html" class="back-link">
    <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
    회의록 아카이브로 돌아가기
  </a>

  <article class="mom-container document-article" id="mom-article" data-document-category="회의록">
    <header class="mom-header">
      <div class="header-top-row">
        <img src="../logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
        <div class="mom-category">회의록</div>
      </div>
      <h1 class="statement-title">${escapeHtml(title)}</h1>
      <p class="public-note">공개용 요약본입니다. 참석자 세부 명단과 내부 대응 세부사항은 비공개 처리했습니다.</p>
    </header>

    <main class="mom-body" data-copy-body>
${content}
    </main>
  </article>

${buildUtilityBar()}
  <script src="../assets/document-tools.js"></script>
</body>

</html>
`;
}

function buildIndexHtml(docs) {
  const cards = docs.map((doc) => `      <a href="${escapeAttr(doc.outputFileName)}" class="doc-card">
        <div class="card-meta">
          <span class="badge-category">회의록</span>
          <span class="doc-date">${escapeHtml(doc.date)}</span>
        </div>
        <h2 class="doc-title">${escapeHtml(doc.title)}</h2>
        <p class="doc-excerpt">${escapeHtml(doc.excerpt)}</p>
        <div class="card-footer">
          공개 요약 보기
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
      </a>`).join('\n\n');

  return `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>운영위원회 회의록 아카이브 - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="우체국물류지원단 물류노동조합 운영위원회의 공개용 회의록 요약 일람입니다.">
  <link rel="icon" href="../logo_정사각형.png" type="image/png">
  <style>
    @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
    :root {
      --bg-page: #f8fafc;
      --bg-card: #ffffff;
      --text-primary: #0f172a;
      --text-secondary: #334155;
      --text-muted: #64748b;
      --color-accent: #1e3a8a;
      --color-accent-light: #eff6ff;
      --color-border: #e2e8f0;
      --font-main: 'Pretendard', sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-main);
      background-color: var(--bg-page);
      color: var(--text-primary);
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px;
    }
    .archive-container { width: 100%; max-width: 800px; }
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 24px;
      transition: color .2s ease;
    }
    .back-link:hover { color: var(--color-accent); }
    .back-link svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.5; }
    .archive-header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 40px; border-bottom: 2px solid var(--color-border); padding-bottom: 30px; }
    .header-logo { height: 50px; object-fit: contain; margin-bottom: 20px; }
    .archive-title { font-size: 26px; font-weight: 800; letter-spacing: 0; }
    .archive-desc { font-size: 15px; color: var(--text-muted); margin-top: 8px; font-weight: 500; word-break: keep-all; }
    .doc-list { display: flex; flex-direction: column; gap: 20px; }
    .doc-card {
      background-color: var(--bg-card);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,.02), 0 2px 4px -1px rgba(0,0,0,.02);
      transition: all .25s cubic-bezier(.4,0,.2,1);
      text-decoration: none;
      display: block;
      position: relative;
      overflow: hidden;
    }
    .doc-card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,.05), 0 4px 6px -2px rgba(0,0,0,.05); border-color: #bfdbfe; }
    .doc-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background-color: var(--color-accent); opacity: 0; transition: opacity .2s ease; }
    .doc-card:hover::before { opacity: 1; }
    .card-meta { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; font-size: 13px; font-weight: 700; }
    .badge-category { background-color: var(--color-accent-light); color: var(--color-accent); padding: 2px 8px; border-radius: 4px; letter-spacing: .05em; }
    .doc-date { color: var(--text-muted); }
    .doc-title { font-size: 18px; font-weight: 800; color: var(--text-primary); line-height: 1.4; margin-bottom: 10px; word-break: keep-all; transition: color .2s ease; }
    .doc-card:hover .doc-title { color: var(--color-accent); }
    .doc-excerpt { font-size: 14px; color: var(--text-secondary); line-height: 1.6; word-break: keep-all; margin-bottom: 16px; }
    .card-footer { display: flex; justify-content: flex-end; align-items: center; font-weight: 700; font-size: 13px; color: var(--color-accent); gap: 4px; }
    .card-footer svg { width: 14px; height: 14px; transition: transform .2s ease; stroke: currentColor; fill: none; stroke-width: 2.5; }
    .doc-card:hover .card-footer svg { transform: translateX(4px); }
    .archive-footer { text-align: center; margin-top: 60px; font-size: 13px; color: var(--text-muted); font-weight: 500; border-top: 1px solid var(--color-border); padding-top: 24px; }
    @media (max-width: 600px) {
      body { padding: 30px 15px; }
      .archive-header { margin-bottom: 30px; padding-bottom: 20px; }
      .header-logo { height: 40px; }
      .archive-title { font-size: 20px; }
      .doc-card { padding: 18px; }
      .doc-title { font-size: 16px; }
    }
  </style>
</head>

<body>
  <div class="archive-container">
    <a href="../index.html" class="back-link">
      <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      메인 자료실로 돌아가기
    </a>
    <header class="archive-header">
      <img src="../logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
      <h1 class="archive-title">운영위원회 회의록</h1>
      <p class="archive-desc">공개 가능한 회의 개요, 주요 결정사항, 차기 회의 안내를 모은 요약 아카이브입니다.</p>
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

function build() {
  fs.mkdirSync(outputDir, { recursive: true });

  const docs = readSourceFiles().map((file) => {
    const sourcePath = path.join(sourceDir, file);
    const markdown = fs.readFileSync(sourcePath, 'utf8');
    const title = extractTitle(markdown, file);
    const publicMarkdown = makePublicMarkdown(markdown, title);
    const content = parseMarkdown(publicMarkdown, title);
    const match = file.match(/^(\d{6})/);
    const outputFileName = match ? `${match[1]}.html` : `${path.basename(file, '.md')}.html`;
    const description = `${title} 공개용 요약본입니다.`;
    const outputPath = path.join(outputDir, outputFileName);

    fs.writeFileSync(outputPath, buildDetailHtml({ title, description, content }), 'utf8');

    return {
      sourcePath,
      outputPath,
      outputFileName,
      title,
      date: extractDate(markdown, file),
      excerpt: extractExcerpt(publicMarkdown),
      sortKey: match ? match[1] : file,
    };
  });

  docs.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  fs.writeFileSync(path.join(outputDir, 'index.html'), buildIndexHtml(docs), 'utf8');

  docs.forEach((doc) => {
    console.log(`Generated ${path.relative(rootDir, doc.outputPath)} from ${path.relative(rootDir, doc.sourcePath)}`);
  });
  console.log(`Generated ${path.relative(rootDir, path.join(outputDir, 'index.html'))}`);
}

try {
  build();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
