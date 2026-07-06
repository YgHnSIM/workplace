const fs = require('fs');
const path = require('path');

const momDir = path.join(__dirname, 'MoM');

// Create the template HTML dynamically to avoid extra files
const templateHTML = `<!DOCTYPE html>
<html lang="ko">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}} - 우체국물류지원단 물류노동조합</title>
  <meta name="description" content="{{DESCRIPTION}}">
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

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-main);
      background-color: var(--bg-page);
      color: var(--text-primary);
      line-height: 1.8;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px 100px 20px;
    }

    .mom-container {
      width: 100%;
      max-width: 800px;
      background-color: var(--bg-card);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 48px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
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
      transition: color 0.2s ease;
    }

    .back-link:hover {
      color: var(--color-accent);
    }

    .back-link svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
    }

    /* Header */
    .mom-header {
      border-bottom: 2px solid var(--color-border);
      padding-bottom: 20px;
      margin-bottom: 30px;
    }

    .header-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .header-logo {
      height: 48px;
      object-fit: contain;
    }

    .mom-category {
      font-size: 13px;
      font-weight: 800;
      background-color: var(--color-accent-light);
      color: var(--color-accent);
      padding: 4px 10px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .statement-title {
      font-size: var(--font-size-title);
      font-weight: 900;
      color: var(--text-primary);
      line-height: 1.4;
      word-break: keep-all;
      letter-spacing: -0.02em;
    }

    /* Content Typography */
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
      color: var(--text-primary);
      margin-top: 28px;
      margin-bottom: 12px;
      border-left: 4px solid var(--color-accent);
      padding-left: 10px;
    }

    .subsubsection-title {
      font-size: calc(var(--font-size-base) * 1.08);
      font-weight: 800;
      color: var(--text-primary);
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

    .bullet-list {
      margin-left: 24px;
      margin-bottom: var(--spacing-unit);
      color: var(--text-secondary);
      font-size: var(--font-size-base);
    }

    .bullet-list li {
      margin-bottom: 8px;
    }

    .content-link {
      color: var(--color-accent);
      text-decoration: underline;
      font-weight: 700;
    }

    .content-link:hover {
      color: #1d4ed8;
    }

    /* Table Styles */
    .table-container {
      width: 100%;
      overflow-x: auto;
      margin-top: 20px;
      margin-bottom: 30px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }

    .mom-table {
      width: 100%;
      border-collapse: collapse;
      font-size: calc(var(--font-size-base) * 0.95);
      text-align: left;
      min-width: 500px;
    }

    .mom-table th, .mom-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
    }

    .mom-table th {
      background-color: var(--color-accent-light);
      color: var(--color-accent);
      font-weight: 800;
      border-bottom: 2px solid var(--color-border);
    }

    .mom-table tr:last-child th, .mom-table tr:last-child td {
      border-bottom: none;
    }

    .mom-table td strong {
      color: var(--color-accent);
    }

    .divider {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: 30px 0;
    }

    /* Utility Bar */
    .utility-bar {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      border: 1px solid var(--color-border);
      border-radius: 30px;
      padding: 6px 12px;
      display: flex;
      gap: 8px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      z-index: 1000;
      transition: all 0.3s ease;
    }

    .utility-bar:hover {
      background: #ffffff;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.05);
    }

    .utility-button-container {
      position: relative;
    }

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
      transition: all 0.2s ease;
    }

    .utility-bar button:hover {
      background-color: var(--color-accent-light);
      color: var(--color-accent);
    }

    .utility-bar button svg {
      width: 20px;
      height: 20px;
    }

    .utility-tooltip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) translateY(-8px);
      background-color: var(--text-primary);
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .utility-button-container:hover .utility-tooltip {
      opacity: 1;
    }

    /* Print styling */
    @media print {
      body {
        background-color: #ffffff;
        padding: 0;
      }
      .mom-container {
        box-shadow: none;
        border: none;
        padding: 0;
      }
      .utility-bar, .back-link {
        display: none !important;
      }
    }

    /* Mobile Sizing */
    @media (max-width: 600px) {
      body {
        padding: 20px 10px 100px 10px;
      }
      .mom-container {
        padding: 24px 16px;
        box-shadow: none;
        border: none;
      }
      .back-link {
        padding-left: 16px;
      }
      .statement-title {
        font-size: calc(20px * var(--font-scale));
      }
      .utility-bar {
        bottom: 16px;
        right: 16px;
        left: 16px;
        flex-direction: row;
        justify-content: space-around;
        padding: 8px;
        border-radius: 16px;
        width: calc(100% - 32px);
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 4px 25px rgba(0, 0, 0, 0.12);
      }
      .utility-tooltip {
        display: none;
      }
      .header-top-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
      }
      .header-logo {
        height: 38px;
      }
    }
  </style>
</head>

<body>

  <a href="index.html" class="back-link">
    <svg viewBox="0 0 24 24">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
    회의록 아카이브로 돌아가기
  </a>

  <article class="mom-container" id="mom-article">
    <header class="mom-header">
      <div class="header-top-row">
        <img src="../logo_직사각형.png" alt="우체국물류지원단 물류노동조합 로고" class="header-logo">
        <div class="mom-category">회의록</div>
      </div>
      <h1 class="statement-title">{{TITLE}}</h1>
    </header>

    <main class="mom-body">
      {{CONTENT}}
    </main>
  </article>

  <!-- Floating Utility Bar -->
  <div class="utility-bar" id="utility-bar">
    <div class="utility-button-container">
      <button id="zoom-in-btn" aria-label="글자 크기 크게">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <span class="utility-tooltip">글자 크게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-out-btn" aria-label="글자 크기 작게">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </button>
      <span class="utility-tooltip">글자 작게</span>
    </div>
    <div class="utility-button-container">
      <button id="zoom-reset-btn" aria-label="글자 크기 초기화">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>
      <span class="utility-tooltip">기본 크기</span>
    </div>
    <div class="utility-button-container">
      <button id="copy-btn" aria-label="텍스트 복사">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
      <span class="utility-tooltip">텍스트 복사</span>
    </div>
    <div class="utility-button-container">
      <button id="print-btn" aria-label="인쇄 또는 PDF 저장">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="6 9 6 2 18 2 18 9"></polyline>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
          <rect x="6" y="14" width="12" height="8"></rect>
        </svg>
      </button>
      <span class="utility-tooltip">인쇄 / PDF</span>
    </div>
    <div class="utility-button-container">
      <button id="to-top-btn" aria-label="맨 위로 이동">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
      <span class="utility-tooltip">맨 위로</span>
    </div>
  </div>

  <script>
    // Text scaling variables
    let currentScale = 1.0;
    const scaleStep = 0.1;
    const minScale = 0.8;
    const maxScale = 1.5;

    // Sizing and navigation handlers
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('zoom-reset-btn');
    const copyBtn = document.getElementById('copy-btn');
    const printBtn = document.getElementById('print-btn');
    const toTopBtn = document.getElementById('to-top-btn');

    zoomInBtn.addEventListener('click', () => changeTextSize('up'));
    zoomOutBtn.addEventListener('click', () => changeTextSize('down'));
    zoomResetBtn.addEventListener('click', () => changeTextSize('reset'));
    copyBtn.addEventListener('click', copyStatementText);
    printBtn.addEventListener('click', () => window.print());
    toTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    function changeTextSize(direction) {
      if (direction === 'up') {
        currentScale = Math.min(currentScale + scaleStep, maxScale);
      } else if (direction === 'down') {
        currentScale = Math.max(currentScale - scaleStep, minScale);
      } else if (direction === 'reset') {
        currentScale = 1.0;
      }
      document.documentElement.style.setProperty('--font-scale', currentScale.toFixed(1));
    }

    function copyStatementText() {
      const article = document.getElementById('mom-article');
      if (!article) return;
      
      const clone = article.cloneNode(true);
      
      let plainText = "";
      
      const category = clone.querySelector('.mom-category')?.innerText || "회의록";
      plainText += \`[\${category}]\\n\\n\`;
      
      const title = clone.querySelector('.statement-title')?.innerText || "";
      plainText += \`\${title}\\n\\n\`;
      plainText += "==================================================\\n\\n";
      
      // Basic text extractor from body
      const bodyElements = clone.querySelector('.mom-body').children;
      for (let i = 0; i < bodyElements.length; i++) {
        const el = bodyElements[i];
        if (el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4') {
          plainText += \`\\n\text\\n\\n\`;
        } else if (el.tagName === 'P') {
          plainText += \`\text\\n\\n\`;
        } else if (el.tagName === 'UL') {
          const lis = el.querySelectorAll('li');
          lis.forEach(li => {
            plainText += \`- \${li.innerText}\\n\`;
          });
          plainText += '\\n';
        } else if (el.tagName === 'TABLE' || el.classList.contains('table-container')) {
          const rows = el.querySelectorAll('tr');
          rows.forEach(tr => {
            const cells = tr.querySelectorAll('th, td');
            const rowText = Array.from(cells).map(c => c.innerText).join(' | ');
            plainText += \`| \${rowText} |\\n\`;
          });
          plainText += '\\n';
        }
      }
      
      navigator.clipboard.writeText(plainText.trim()).then(() => {
        alert("회의록 전체 텍스트가 클립보드에 복사되었습니다.");
      }).catch(err => {
        console.error("복사 실패:", err);
        const textarea = document.createElement('textarea');
        textarea.value = plainText.trim();
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          alert("회의록 전체 텍스트가 클립보드에 복사되었습니다. (대체 방식)");
        } catch (e) {
          alert("텍스트 복사에 실패했습니다. 직접 복사해주세요.");
        }
        document.body.removeChild(textarea);
      });
    }
  </script>
</body>

</html>`;

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let html = "";
  let inList = false;
  let inTable = false;
  let tableRows = [];

  const parseTable = (rows) => {
    let tableHtml = '<div class="table-container">\n<table class="mom-table">\n';
    const validRows = rows.filter(r => !r.match(/\|?\s*:?-+:?\s*\|/));
    
    validRows.forEach((row, idx) => {
      const cells = row.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
      const tag = idx === 0 ? 'th' : 'td';
      tableHtml += '  <tr>\n';
      cells.forEach(cell => {
        const cellText = cell
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="content-link">$1</a>');
        tableHtml += `    <${tag}>${cellText}</${tag}>\n`;
      });
      tableHtml += '  </tr>\n';
    });
    tableHtml += '</table>\n</div>\n';
    return tableHtml;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Table end condition
    if (inTable && !line.startsWith('|')) {
      html += parseTable(tableRows);
      inTable = false;
      tableRows = [];
    }

    // List end condition (skip empty lines to aggregate lists)
    const isListItem = line.startsWith('- ') || line.startsWith('* ');
    if (inList && !isListItem && line !== '') {
      html += "</ul>\n";
      inList = false;
    }

    if (line === '') {
      continue;
    }

    // Heading 1
    if (line.startsWith('# ')) {
      const text = line.replace(/^#\s+/, '').replace(/\*\*/g, '');
    }
    // Heading 2
    else if (line.startsWith('## ')) {
      const text = line.replace(/^##\s+/, '').replace(/\*\*/g, '');
      html += `<h2 class="section-title">${text}</h2>\n`;
    }
    // Heading 3
    else if (line.startsWith('### ')) {
      const text = line.replace(/^###\s+/, '').replace(/\*\*/g, '');
      html += `<h3 class="subsection-title">${text}</h3>\n`;
    }
    // Heading 4
    else if (line.startsWith('#### ')) {
      const text = line.replace(/^####\s+/, '').replace(/\*\*/g, '');
      html += `<h4 class="subsubsection-title">${text}</h4>\n`;
    }
    // Divider
    else if (line === '---' || line.match(/^---+$/)) {
      html += `<hr class="divider">\n`;
    }
    // Table rows
    else if (line.startsWith('|')) {
      inTable = true;
      tableRows.push(line);
    }
    // Bullet lists
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        html += `<ul class="bullet-list">\n`;
        inList = true;
      }
      const text = line
        .replace(/^[-*]\s+/, '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="content-link">$1</a>');
      html += `  <li>${text}</li>\n`;
    }
    // Default Paragraphs
    else {
      const text = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="content-link">$1</a>');
      html += `<p class="body-text">${text}</p>\n`;
    }
  }

  // Handle trailing table or list
  if (inTable && tableRows.length > 0) {
    html += parseTable(tableRows);
  }
  if (inList) {
    html += "</ul>\n";
  }

  return html;
}

// Read MoM directory for .md files
fs.readdir(momDir, (err, files) => {
  if (err) {
    console.error('Error reading MoM directory:', err);
    process.exit(1);
  }

  files.forEach(file => {
    if (path.extname(file) === '.md' && file !== 'README.md' && !file.includes('프레임')) {
      const filePath = path.join(momDir, file);
      const markdownContent = fs.readFileSync(filePath, 'utf8');

      // Extract title (usually first heading # or file name)
      const firstLine = markdownContent.split('\n')[0].trim();
      let title = file.replace('.md', '');
      if (firstLine.startsWith('# ')) {
        title = firstLine.replace(/^#\s+/, '').replace(/\*\*/g, '');
      }

      console.log(`Processing: ${file} -> Title: ${title}`);

      const htmlContent = parseMarkdown(markdownContent);
      
      const fileDescription = `${title} - 우체국물류지원단 물류노동조합 공식 회의록입니다.`;
      
      let finalHTML = templateHTML
        .replace(/{{TITLE}}/g, title)
        .replace(/{{DESCRIPTION}}/g, fileDescription)
        .replace(/{{CONTENT}}/g, htmlContent);

      // Extract month number from file name (e.g. 202601 -> 202601)
      const match = file.match(/^(\d{6})/);
      let outputFileName = file.replace('.md', '.html');
      if (match) {
        outputFileName = `${match[1]}.html`; // e.g. 202601.html
      }

      const outputFilePath = path.join(momDir, outputFileName);
      fs.writeFileSync(outputFilePath, finalHTML, 'utf8');
      console.log(`Successfully generated: ${outputFileName}`);
    }
  });
});
