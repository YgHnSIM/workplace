(function () {
  const scaleStep = 0.1;
  const minScale = 0.8;
  const maxScale = 1.5;
  const scaleStorageKey = 'workplace-document-font-scale';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function clampScale(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.min(maxScale, Math.max(minScale, Math.round(numericValue * 10) / 10));
  }

  function readStoredScale() {
    try {
      const stored = window.localStorage.getItem(scaleStorageKey);
      return stored === null ? 1 : clampScale(stored);
    } catch (error) {
      return 1;
    }
  }

  let currentScale = readStoredScale();
  let statusRegion;

  function toolButtons(action) {
    return Array.from(document.querySelectorAll(`[data-document-action="${action}"]`));
  }

  function applyTextScale(shouldPersist) {
    const value = currentScale.toFixed(1);
    document.documentElement.style.setProperty('--font-scale', value);
    document.documentElement.dataset.fontScale = value;
    const percentage = Math.round(currentScale * 100);

    document.querySelectorAll('#document-font-scale').forEach((output) => {
      output.textContent = `현재 ${percentage}%`;
    });
    toolButtons('font-up').forEach((button) => { button.disabled = currentScale >= maxScale; });
    toolButtons('font-down').forEach((button) => { button.disabled = currentScale <= minScale; });
    toolButtons('font-reset').forEach((button) => { button.disabled = currentScale === 1; });

    if (shouldPersist) {
      try {
        window.localStorage.setItem(scaleStorageKey, value);
      } catch (error) {
        // Storage availability must not prevent an in-page scale change.
      }
    }
  }

  function announce(message, isError) {
    if (!statusRegion) statusRegion = document.getElementById('document-action-status');
    if (!statusRegion) return;
    statusRegion.dataset.state = isError ? 'error' : 'success';
    statusRegion.textContent = '';
    window.requestAnimationFrame(() => {
      statusRegion.textContent = message;
    });
  }

  function changeTextSize(direction) {
    if (direction === 'up') currentScale = clampScale(currentScale + scaleStep);
    if (direction === 'down') currentScale = clampScale(currentScale - scaleStep);
    if (direction === 'reset') currentScale = 1;
    applyTextScale(true);
    announce(`글자 크기 ${Math.round(currentScale * 100)}%`);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    const activeElement = document.activeElement;
    let copied = false;
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(textarea);
    try {
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy') === true;
    } catch (error) {
      copied = false;
    } finally {
      textarea.remove();
      if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
    }
    return copied;
  }

  function copyText(text, successMessage, failureMessage) {
    const finishWithFallback = () => {
      const copied = fallbackCopy(text);
      announce(copied ? successMessage : failureMessage, !copied);
    };
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => announce(successMessage),
        finishWithFallback,
      );
      return;
    }
    finishWithFallback();
  }

  function documentArticle() {
    return document.querySelector('.document-article');
  }

  function copyDocumentText() {
    const article = documentArticle();
    if (!article) {
      announce('복사할 문서를 찾지 못했습니다.', true);
      return;
    }
    const category = article.dataset.documentCategory || '문서';
    const title = normalizeText(article.querySelector('h1') && article.querySelector('h1').innerText);
    const body = article.querySelector('[data-copy-body]') || article;
    const text = [`[${category}]`, title, normalizeText(body.innerText)].filter(Boolean).join('\n\n');
    copyText(text, '본문을 클립보드에 복사했습니다.', '복사하지 못했습니다. 내용을 직접 선택해 복사해주세요.');
  }

  function shareDocument() {
    const shareData = { title: document.title, url: window.location.href };
    if (navigator.share) {
      navigator.share(shareData).then(
        () => announce('공유했습니다.'),
        (error) => {
          if (error && error.name === 'AbortError') {
            announce('공유를 취소했습니다.');
            return;
          }
          copyText(shareData.url, '링크를 클립보드에 복사했습니다.', '링크를 복사하지 못했습니다. 주소창의 링크를 직접 복사해주세요.');
        },
      );
      return;
    }
    copyText(shareData.url, '링크를 클립보드에 복사했습니다.', '링크를 복사하지 못했습니다. 주소창의 링크를 직접 복사해주세요.');
  }

  function preferredScrollBehavior() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function setupDocumentTools() {
    const root = document.querySelector('[data-document-tools]');
    if (!root) return;
    const trigger = root.querySelector('.document-tools-trigger');
    const panel = root.querySelector('.document-tools-panel');
    const backdrop = root.querySelector('.document-tools-backdrop');
    const closeButton = root.querySelector('.document-tools-close');
    if (!trigger || !panel || !backdrop || !closeButton) return;
    statusRegion = root.querySelector('.document-tools-status');

    const focusable = () => Array.from(panel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const isOpen = () => !panel.hidden;
    const close = (restoreFocus) => {
      if (!isOpen()) return;
      panel.hidden = true;
      backdrop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus !== false) trigger.focus({ preventScroll: true });
    };
    const open = () => {
      panel.hidden = false;
      backdrop.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-modal', String(window.matchMedia('(max-width: 768px)').matches));
      window.requestAnimationFrame(() => {
        const first = focusable()[0];
        if (first) first.focus();
      });
    };

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));
    closeButton.addEventListener('click', () => close());
    backdrop.addEventListener('click', () => close());
    document.addEventListener('pointerdown', (event) => {
      if (isOpen() && !root.contains(event.target)) close();
    });
    document.addEventListener('keydown', (event) => {
      if (!isOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-document-action]');
      if (!action) return;
      switch (action.dataset.documentAction) {
        case 'font-down': changeTextSize('down'); break;
        case 'font-up': changeTextSize('up'); break;
        case 'font-reset': changeTextSize('reset'); break;
        case 'copy-document': copyDocumentText(); break;
        case 'share': shareDocument(); break;
        case 'copy-link': copyText(window.location.href, '링크를 클립보드에 복사했습니다.', '링크를 복사하지 못했습니다. 주소창의 링크를 직접 복사해주세요.'); break;
        case 'top':
          window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
          announce('문서 처음으로 이동했습니다.');
          break;
        default: break;
      }
    });
  }

  function tableLabel(table, index) {
    const caption = normalizeText(table.querySelector('caption') && table.querySelector('caption').innerText);
    if (caption) return caption;
    const heading = table.closest('section') && table.closest('section').querySelector('h2, h3');
    return normalizeText(heading && heading.innerText) || `${normalizeText(document.title) || '문서'} 표 ${index + 1}`;
  }

  function isNumericColumn(label) {
    return /(금액|합계|수량|비율|지급률|단가|원|%)/.test(normalizeText(label));
  }

  function setOverflowState(container) {
    const overflowing = container.dataset.tableMode !== 'stack'
      && container.scrollWidth > container.clientWidth + 1;
    container.classList.toggle('has-overflow', overflowing);
    if (!overflowing) {
      delete container.dataset.scrollStart;
      delete container.dataset.scrollEnd;
      return;
    }
    container.dataset.scrollStart = String(container.scrollLeft > 1);
    container.dataset.scrollEnd = String(container.scrollLeft + container.clientWidth < container.scrollWidth - 1);
  }

  function prepareResponsiveTables() {
    const tables = Array.from(document.querySelectorAll('table.mom-table, table.post-table'));
    tables.forEach((table, tableIndex) => {
      let container = table.closest('.table-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'table-container';
        table.before(container);
        container.appendChild(table);
      }

      const rows = Array.from(table.querySelectorAll('tr'));
      const headerCells = rows[0]
        ? Array.from(rows[0].querySelectorAll(':scope > th, :scope > td'))
        : [];
      const headers = headerCells.map((cell) => normalizeText(cell.innerText));
      const columnCount = headers.length || Math.max(0, ...rows.map((row) => row.children.length));
      const requestedStack = table.dataset.mobileLayout === 'stack';
      const mode = requestedStack ? 'stack' : (columnCount <= 2 ? 'native' : 'scroll');

      table.dataset.columnCount = String(columnCount);
      table.dataset.tableMode = mode;
      container.dataset.columnCount = String(columnCount);
      container.dataset.tableMode = mode;
      container.classList.add('table-scroll-region');
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', tableLabel(table, tableIndex));
      if (!container.hasAttribute('tabindex')) container.tabIndex = 0;

      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
        cells.forEach((cell, cellIndex) => {
          const label = headers[cellIndex] || '';
          if (cell.tagName === 'TH' && !cell.hasAttribute('scope')) {
            cell.setAttribute('scope', rowIndex === 0 ? 'col' : 'row');
          }
          if (rowIndex > 0 && cell.tagName === 'TD' && !cell.dataset.label && label) {
            cell.dataset.label = label;
          }
          if (isNumericColumn(label)) cell.classList.add('table-number');
          if (/^(항목|구분|번호)$/.test(label)) cell.classList.add('table-identifier');
        });
      });

      const update = () => setOverflowState(container);
      container.addEventListener('scroll', update, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(update).observe(container);
      window.requestAnimationFrame(update);
    });
  }

  function tocGroups(headings) {
    const groups = [];
    let current;
    headings.forEach((heading) => {
      if (heading.tagName === 'H2') {
        current = { heading, children: [] };
        groups.push(current);
      } else {
        if (!current) {
          current = { heading: null, children: [] };
          groups.push(current);
        }
        current.children.push(heading);
      }
    });
    return groups;
  }

  function makeToc(article) {
    const body = article.querySelector('[data-copy-body]');
    if (!body) return null;
    const headings = Array.from(body.querySelectorAll('h2, h3'))
      .filter((heading) => normalizeText(heading.innerText));
    if (!headings.length) return null;
    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `section-${index + 1}`;
    });

    const nav = document.createElement('nav');
    nav.className = 'document-toc';
    nav.setAttribute('aria-label', '문서 목차');
    nav.dataset.generatedToc = 'true';
    nav.innerHTML = '<div class="document-toc-heading"><h2 class="document-toc-title">문서 목차</h2><button class="document-toc-toggle" type="button">목차 접기</button></div>';
    const list = document.createElement('ol');
    list.className = 'document-toc-sections';
    tocGroups(headings).forEach((group) => {
      const item = document.createElement('li');
      item.className = 'document-toc-group';
      if (group.heading) {
        const link = document.createElement('a');
        link.className = 'document-toc-link document-toc-section';
        link.href = `#${group.heading.id}`;
        link.textContent = normalizeText(group.heading.innerText);
        item.appendChild(link);
      }
      if (group.children.length) {
        const children = document.createElement('ol');
        children.className = 'document-toc-children';
        group.children.forEach((heading) => {
          const child = document.createElement('li');
          const link = document.createElement('a');
          link.className = 'document-toc-link document-toc-child';
          link.href = `#${heading.id}`;
          link.textContent = normalizeText(heading.innerText);
          child.appendChild(link);
          children.appendChild(child);
        });
        item.appendChild(children);
      }
      list.appendChild(item);
    });
    nav.appendChild(list);
    body.before(nav);
    return nav;
  }

  function setupToc() {
    const article = documentArticle();
    if (!article) return;
    let toc = article.querySelector('.document-toc');
    if (toc && !toc.querySelector('.document-toc-sections')) {
      toc.remove();
      toc = null;
    }
    if (!toc) toc = makeToc(article);
    if (!toc) return;

    const toggle = toc.querySelector('.document-toc-toggle');
    const sections = toc.querySelector('.document-toc-sections');
    if (!toggle || !sections) return;
    if (!sections.id) sections.id = 'document-toc-sections';
    toggle.setAttribute('aria-controls', sections.id);
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const setCollapsed = (collapsed) => {
      toc.dataset.collapsed = String(collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? '목차 펼치기' : '목차 접기';
    };
    setCollapsed(mobileQuery.matches);
    toggle.addEventListener('click', () => setCollapsed(toc.dataset.collapsed !== 'true'));
    sections.addEventListener('click', (event) => {
      if (mobileQuery.matches && event.target.closest('a')) setCollapsed(true);
    });
    mobileQuery.addEventListener('change', (event) => setCollapsed(event.matches));

    const body = article.querySelector('[data-copy-body]');
    const headings = body ? Array.from(body.querySelectorAll('h2, h3')).filter((heading) => heading.id) : [];
    const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
    const setActive = (id) => {
      links.forEach((link) => {
        const current = link.getAttribute('href') === `#${id}`;
        link.classList.toggle('is-current', current);
        if (current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };
    const updateFromScroll = () => {
      const threshold = window.scrollY + 160;
      const current = headings.filter((heading) => heading.offsetTop <= threshold).at(-1) || headings[0];
      if (current) setActive(current.id);
    };
    if (window.IntersectionObserver) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      }, { rootMargin: '-15% 0px -68% 0px', threshold: [0, 1] });
      headings.forEach((heading) => observer.observe(heading));
    }
    window.addEventListener('scroll', updateFromScroll, { passive: true });
    updateFromScroll();
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTextScale(false);
    setupDocumentTools();
    prepareResponsiveTables();
    setupToc();
  });
}());
