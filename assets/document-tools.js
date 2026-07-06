(function () {
  const scaleStep = 0.1;
  const minScale = 0.8;
  const maxScale = 1.5;
  let currentScale = 1.0;

  function changeTextSize(direction) {
    if (direction === 'up') currentScale = Math.min(currentScale + scaleStep, maxScale);
    if (direction === 'down') currentScale = Math.max(currentScale - scaleStep, minScale);
    if (direction === 'reset') currentScale = 1.0;
    document.documentElement.style.setProperty('--font-scale', currentScale.toFixed(1));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function collectTable(table) {
    return Array.from(table.querySelectorAll('tr'))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => normalizeText(cell.innerText));
        return cells.length ? `| ${cells.join(' | ')} |` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  function collectNode(node, lines) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;

    if (/^H[1-6]$/.test(tag)) {
      lines.push('', normalizeText(node.innerText), '');
      return;
    }

    if (tag === 'P' || tag === 'BLOCKQUOTE') {
      const text = normalizeText(node.innerText);
      if (text) lines.push(text, '');
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      const ordered = tag === 'OL';
      Array.from(node.children).forEach((child, index) => {
        if (child.tagName !== 'LI') return;
        const prefix = ordered ? `${index + 1}.` : '-';
        lines.push(`${prefix} ${normalizeText(child.innerText)}`);
      });
      lines.push('');
      return;
    }

    if (tag === 'TABLE') {
      const tableText = collectTable(node);
      if (tableText) lines.push(tableText, '');
      return;
    }

    if (node.classList.contains('table-container')) {
      const table = node.querySelector('table');
      if (table) {
        const tableText = collectTable(table);
        if (tableText) lines.push(tableText, '');
      }
      return;
    }

    Array.from(node.children).forEach((child) => collectNode(child, lines));
  }

  function buildPlainText(article) {
    const lines = [];
    const category = article.dataset.documentCategory
      || normalizeText(article.querySelector('.mom-category, .statement-category')?.innerText)
      || '문서';
    const title = normalizeText(article.querySelector('.statement-title, h1')?.innerText);
    const meta = normalizeText(article.querySelector('.statement-meta')?.innerText);
    const body = article.querySelector('[data-copy-body]') || article.querySelector('.mom-body, .statement-body') || article;

    lines.push(`[${category}]`, '');
    if (title) lines.push(title, '');
    if (meta) lines.push(meta, '');
    lines.push('==================================================', '');
    Array.from(body.children).forEach((child) => collectNode(child, lines));

    return lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function copyDocumentText() {
    const article = document.querySelector('.document-article') || document.getElementById('mom-article') || document.getElementById('statement-article');
    if (!article) return;

    const text = buildPlainText(article);
    const successMessage = '문서 전체 텍스트가 클립보드에 복사되었습니다.';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert(successMessage);
      }).catch(() => fallbackCopy(text, successMessage));
      return;
    }
    fallbackCopy(text, successMessage);
  }

  function fallbackCopy(text, successMessage) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      alert(successMessage);
    } catch (error) {
      alert('텍스트 복사에 실패했습니다. 직접 복사해주세요.');
    }
    document.body.removeChild(textarea);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('zoom-in-btn')?.addEventListener('click', () => changeTextSize('up'));
    document.getElementById('zoom-out-btn')?.addEventListener('click', () => changeTextSize('down'));
    document.getElementById('zoom-reset-btn')?.addEventListener('click', () => changeTextSize('reset'));
    document.getElementById('copy-btn')?.addEventListener('click', copyDocumentText);
    document.getElementById('print-btn')?.addEventListener('click', () => window.print());
    document.getElementById('to-top-btn')?.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}());
