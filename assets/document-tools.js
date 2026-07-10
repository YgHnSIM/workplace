(function () {
  const scaleStep = 0.1;
  const minScale = 0.8;
  const maxScale = 1.5;
  const scaleStorageKey = 'workplace-document-font-scale';

  function clampScale(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.min(maxScale, Math.max(minScale, Math.round(numericValue * 10) / 10));
  }

  function readStoredScale() {
    try {
      const storedScale = window.localStorage.getItem(scaleStorageKey);
      return storedScale === null ? 1 : clampScale(storedScale);
    } catch (error) {
      return 1;
    }
  }

  let currentScale = readStoredScale();

  function applyTextScale(shouldPersist = false) {
    const scaleValue = currentScale.toFixed(1);
    document.documentElement.style.setProperty('--font-scale', scaleValue);
    document.documentElement.dataset.fontScale = scaleValue;

    if (shouldPersist) {
      try {
        window.localStorage.setItem(scaleStorageKey, scaleValue);
      } catch (error) {
        // The scale still applies for this page when storage is unavailable.
      }
    }

    const zoomInButton = document.getElementById('zoom-in-btn');
    const zoomOutButton = document.getElementById('zoom-out-btn');
    const resetButton = document.getElementById('zoom-reset-btn');
    if (zoomInButton) zoomInButton.disabled = currentScale >= maxScale;
    if (zoomOutButton) zoomOutButton.disabled = currentScale <= minScale;
    if (resetButton) resetButton.disabled = currentScale === 1;
  }

  applyTextScale();

  function ensureStatusRegion() {
    let status = document.getElementById('document-action-status');
    if (status) return status;

    status = document.createElement('div');
    status.id = 'document-action-status';
    status.className = 'document-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    document.body.appendChild(status);
    return status;
  }

  function announce(message, isError = false) {
    const status = ensureStatusRegion();
    status.dataset.state = isError ? 'error' : 'success';
    status.setAttribute('role', isError ? 'alert' : 'status');
    status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    status.textContent = '';
    window.requestAnimationFrame(() => {
      status.textContent = message;
    });
  }

  function changeTextSize(direction) {
    if (direction === 'up') currentScale = clampScale(currentScale + scaleStep);
    if (direction === 'down') currentScale = clampScale(currentScale - scaleStep);
    if (direction === 'reset') currentScale = 1;
    applyTextScale(true);
    announce(`글자 크기 ${Math.round(currentScale * 100)}%`);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePreformattedText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  function elementText(element) {
    return element ? element.innerText : '';
  }

  function collectTable(table) {
    const lines = [];
    const caption = normalizeText(elementText(table.querySelector('caption')));
    if (caption) lines.push(caption);

    Array.from(table.querySelectorAll('tr')).forEach((row) => {
      const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'))
        .map((cell) => normalizeText(cell.innerText));
      if (cells.length) lines.push(`| ${cells.join(' | ')} |`);
    });
    return lines.join('\n');
  }

  function collectList(list, lines, depth = 0) {
    const ordered = list.tagName === 'OL';
    const items = Array.from(list.children).filter((child) => child.tagName === 'LI');

    items.forEach((item, index) => {
      const itemCopy = item.cloneNode(true);
      itemCopy.querySelectorAll('ul, ol').forEach((nestedList) => nestedList.remove());
      const prefix = ordered ? `${index + 1}.` : '-';
      const text = normalizeText(itemCopy.innerText || itemCopy.textContent);
      if (text) lines.push(`${'  '.repeat(depth)}${prefix} ${text}`);

      Array.from(item.children)
        .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
        .forEach((nestedList) => collectList(nestedList, lines, depth + 1));
    });
    lines.push('');
  }

  function collectDefinitionList(list, lines) {
    Array.from(list.children).forEach((item) => {
      const text = normalizeText(item.innerText);
      if (!text) return;
      if (item.tagName === 'DT') lines.push(text);
      if (item.tagName === 'DD') lines.push(`  ${text}`);
    });
    lines.push('');
  }

  function collectNode(node, lines) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(node.textContent);
      if (text) lines.push(text, '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.hidden) return;

    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;

    if (/^H[1-6]$/.test(tag)) {
      const text = normalizeText(node.innerText);
      if (text) lines.push('', text, '');
      return;
    }

    if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'ADDRESS' || tag === 'FIGCAPTION') {
      const text = normalizeText(node.innerText);
      if (text) lines.push(text, '');
      return;
    }

    if (tag === 'PRE') {
      const text = normalizePreformattedText(node.textContent);
      if (text) lines.push(text, '');
      return;
    }

    if (tag === 'CODE') {
      const text = normalizeText(node.textContent);
      if (text) lines.push(text, '');
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      collectList(node, lines);
      return;
    }

    if (tag === 'DL') {
      collectDefinitionList(node, lines);
      return;
    }

    if (tag === 'TABLE') {
      const tableText = collectTable(node);
      if (tableText) lines.push(tableText, '');
      return;
    }

    if (tag === 'FIGURE') {
      Array.from(node.querySelectorAll('img')).forEach((image) => {
        const alt = normalizeText(image.getAttribute('alt'));
        if (alt) lines.push(alt);
      });
      const caption = normalizeText(elementText(node.querySelector('figcaption')));
      if (caption) lines.push(caption);
      if (caption || node.querySelector('img[alt]')) lines.push('');
      return;
    }

    if (tag === 'IMG') {
      const alt = normalizeText(node.getAttribute('alt'));
      if (alt) lines.push(alt, '');
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

    if (tag === 'BR') {
      lines.push('');
      return;
    }

    if (tag === 'HR') {
      lines.push('--------------------------------------------------', '');
      return;
    }

    const blockTags = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIGURE', 'FOOTER',
      'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL',
    ]);
    const hasBlockChild = Array.from(node.children)
      .some((child) => blockTags.has(child.tagName) || /^H[1-6]$/.test(child.tagName));

    if (!hasBlockChild) {
      const text = normalizeText(node.innerText || node.textContent);
      if (text) lines.push(text, '');
      return;
    }

    Array.from(node.childNodes).forEach((child) => collectNode(child, lines));
  }

  function buildPlainText(article) {
    const lines = [];
    const category = article.dataset.documentCategory
      || normalizeText(elementText(article.querySelector('.mom-category, .statement-category')))
      || '문서';
    const title = normalizeText(elementText(article.querySelector('.statement-title, h1')));
    const meta = normalizeText(elementText(article.querySelector('.statement-meta')));
    const body = article.querySelector('[data-copy-body]') || article.querySelector('.mom-body, .statement-body') || article;

    lines.push(`[${category}]`, '');
    if (title) lines.push(title, '');
    if (meta) lines.push(meta, '');
    lines.push('==================================================', '');
    Array.from(body.childNodes).forEach((child) => collectNode(child, lines));

    return lines
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function findTableLabel(table, index) {
    const caption = normalizeText(elementText(table.querySelector('caption')));
    if (caption) return caption;

    const section = table.closest('section');
    const sectionHeading = section ? section.querySelector('h2, h3, h4') : null;
    const headingText = normalizeText(elementText(sectionHeading));
    if (headingText) return `${headingText} 표`;
    return `${normalizeText(document.title) || '문서'} 표 ${index + 1}`;
  }

  function prepareResponsiveTables() {
    const tables = Array.from(document.querySelectorAll('.mom-table, .post-table'));
    tables.forEach((table, index) => {
      let container = table.closest('.table-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'table-container';
        table.before(container);
        container.appendChild(table);
      }

      container.classList.add('table-scroll-region');
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', findTableLabel(table, index));
      if (!container.hasAttribute('tabindex')) container.tabIndex = 0;

      const rows = Array.from(table.querySelectorAll('tr'));
      const headerCells = rows[0]
        ? Array.from(rows[0].querySelectorAll(':scope > th, :scope > td'))
        : [];

      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
        cells.forEach((cell, cellIndex) => {
          if (cell.tagName === 'TH' && !cell.hasAttribute('scope')) {
            cell.setAttribute('scope', rowIndex === 0 ? 'col' : 'row');
          }
          if (rowIndex > 0 && cell.tagName === 'TD' && !cell.hasAttribute('data-label')) {
            const header = normalizeText(elementText(headerCells[cellIndex]));
            if (header) cell.dataset.label = header;
          }
        });
      });
    });
  }

  function buildDocumentToc() {
    const article = document.querySelector('.document-article');
    if (
      !article
      || article.dataset.documentCategory === '성명서'
      || article.dataset.documentToc === 'false'
      || article.querySelector('.document-toc')
      || article.querySelector('.history-nav')
    ) return;

    const body = article.querySelector('[data-copy-body]');
    if (!body) return;

    const headings = Array.from(body.querySelectorAll('h2, h3'))
      .filter((heading) => normalizeText(heading.innerText));
    if (headings.length < 2) return;

    const nav = document.createElement('nav');
    nav.className = 'document-toc';
    nav.setAttribute('aria-label', '문서 목차');

    const title = document.createElement('h2');
    title.className = 'document-toc-title';
    title.textContent = '문서 목차';
    nav.appendChild(title);

    const links = document.createElement('div');
    links.className = 'document-toc-links';

    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `section-${index + 1}`;
      const link = document.createElement('a');
      link.className = `document-toc-link document-toc-level-${heading.tagName === 'H3' ? '3' : '2'}`;
      link.href = `#${heading.id}`;
      link.textContent = normalizeText(heading.innerText);
      links.appendChild(link);
    });

    nav.appendChild(links);
    body.before(nav);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    const activeElement = document.activeElement;
    let copied = false;

    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy') === true;
    } catch (error) {
      copied = false;
    } finally {
      textarea.remove();
      if (activeElement instanceof HTMLElement) {
        try {
          activeElement.focus({ preventScroll: true });
        } catch (error) {
          activeElement.focus();
        }
      }
    }
    return copied;
  }

  function copyText(text, successMessage, failureMessage) {
    const finishWithFallback = () => {
      const copied = fallbackCopy(text);
      announce(copied ? successMessage : failureMessage, !copied);
    };

    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => announce(successMessage))
        .catch(finishWithFallback);
      return;
    }
    finishWithFallback();
  }

  function copyDocumentText() {
    const article = document.querySelector('.document-article')
      || document.getElementById('mom-article')
      || document.getElementById('statement-article');
    if (!article) {
      announce('복사할 문서를 찾지 못했습니다.', true);
      return;
    }

    const text = buildPlainText(article);
    copyText(
      text,
      '문서 전체 텍스트를 클립보드에 복사했습니다.',
      '복사하지 못했습니다. 문서 내용을 직접 선택해 복사해주세요.',
    );
  }

  function copyPageLink() {
    copyText(
      window.location.href,
      '웹페이지 링크를 클립보드에 복사했습니다.',
      '링크를 복사하지 못했습니다. 주소창의 링크를 직접 복사해주세요.',
    );
  }

  function preferredScrollBehavior() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function addClickListener(id, listener) {
    const element = document.getElementById(id);
    if (element) element.addEventListener('click', listener);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTextScale();
    prepareResponsiveTables();
    buildDocumentToc();
    addClickListener('zoom-in-btn', () => changeTextSize('up'));
    addClickListener('zoom-out-btn', () => changeTextSize('down'));
    addClickListener('zoom-reset-btn', () => changeTextSize('reset'));
    addClickListener('copy-btn', copyDocumentText);
    addClickListener('copy-link-btn', copyPageLink);
    addClickListener('to-top-btn', () => {
      window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    });
  });
}());
