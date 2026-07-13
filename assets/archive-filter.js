(function () {
  const categoryParam = 'category';
  const legacyFilterParam = 'filter';
  const topicParam = 'topic';
  const queryParam = 'q';

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('ko')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function availableCategory(buttons, value) {
    return buttons.some((button) => button.dataset.filter === value) ? value : 'all';
  }

  function categoryFromHash(buttons, hashValue = window.location.hash) {
    let hash = hashValue.replace(/^#/, '');
    try {
      hash = decodeURIComponent(hash);
    } catch (error) {
      return '';
    }
    const value = hash.replace(/^filter[-=:/]?/, '');
    return buttons.some((button) => button.dataset.filter === value) ? value : '';
  }

  function stateFromLocation(buttons, topicSelect) {
    const params = new URLSearchParams(window.location.search);
    const category = params.get(categoryParam)
      || params.get(legacyFilterParam)
      || categoryFromHash(buttons)
      || 'all';
    const topic = params.get(topicParam) || 'all';
    const availableTopics = Array.from(topicSelect.options).map((option) => option.value);
    return {
      category: availableCategory(buttons, category),
      topic: availableTopics.includes(topic) ? topic : 'all',
      query: String(params.get(queryParam) || '').slice(0, 120),
    };
  }

  function setActiveCategory(buttons, category) {
    buttons.forEach((button) => {
      const isActive = button.dataset.filter === category;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function setRovingFocus(buttons, index) {
    buttons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === index ? 0 : -1;
    });
    buttons[index].focus();
  }

  function updateLocation(state, mode = 'push') {
    const url = new URL(window.location.href);
    url.searchParams.delete(legacyFilterParam);
    if (state.category === 'all') url.searchParams.delete(categoryParam);
    else url.searchParams.set(categoryParam, state.category);
    if (state.topic === 'all') url.searchParams.delete(topicParam);
    else url.searchParams.set(topicParam, state.topic);
    if (state.query) url.searchParams.set(queryParam, state.query);
    else url.searchParams.delete(queryParam);
    if (/^#filter/.test(url.hash)) url.hash = '';
    if (url.href === window.location.href) return;
    window.history[mode === 'replace' ? 'replaceState' : 'pushState'](
      { archiveState: state },
      '',
      url,
    );
  }

  function createResultStatus(tools) {
    const status = document.createElement('p');
    status.className = 'filter-status';
    status.id = 'archive-filter-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    tools.after(status);
    return status;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tools = document.querySelector('.archive-tools');
    const toolbar = document.querySelector('.filter-bar[role="toolbar"], .filter-bar');
    const topicSelect = document.getElementById('archive-topic-select');
    const searchInput = document.getElementById('archive-search-input');
    const searchForm = document.querySelector('.archive-search');
    const clearButton = document.querySelector('.archive-search-clear');
    if (!tools || !toolbar || !topicSelect || !searchInput || !searchForm || !clearButton) return;

    const filterButtons = Array.from(toolbar.querySelectorAll('.filter-btn'));
    const cards = Array.from(document.querySelectorAll('.doc-card[data-category]'));
    const results = document.getElementById('archive-results');
    const noResults = results ? results.querySelector('.archive-no-results') : null;
    if (!filterButtons.length || !results) return;

    [...filterButtons, topicSelect, searchInput].forEach((control) => {
      control.setAttribute('aria-controls', results.id);
    });
    const status = createResultStatus(tools);
    let currentState = stateFromLocation(filterButtons, topicSelect);
    let queryHistoryTimer;

    function applyState(nextState, options = {}) {
      const safeState = {
        category: availableCategory(filterButtons, nextState.category),
        topic: Array.from(topicSelect.options).some((option) => option.value === nextState.topic)
          ? nextState.topic
          : 'all',
        query: String(nextState.query || '').slice(0, 120),
      };
      const normalizedQuery = normalize(safeState.query);
      let visibleCount = 0;

      currentState = safeState;
      setActiveCategory(filterButtons, safeState.category);
      topicSelect.value = safeState.topic;
      searchInput.value = safeState.query;
      clearButton.hidden = !safeState.query;

      cards.forEach((card) => {
        const topics = String(card.dataset.topics || '').split('|');
        const categoryMatches = safeState.category === 'all'
          || card.dataset.category === safeState.category;
        const topicMatches = safeState.topic === 'all' || topics.includes(safeState.topic);
        const queryMatches = !normalizedQuery || normalize(card.dataset.search).includes(normalizedQuery);
        const visible = categoryMatches && topicMatches && queryMatches;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      if (noResults) noResults.hidden = visibleCount !== 0;
      const activeButton = filterButtons.find((button) => button.dataset.filter === safeState.category);
      const categoryLabel = normalize(activeButton ? activeButton.textContent : '전체');
      const topicLabel = safeState.topic === 'all' ? '모든 쟁점' : safeState.topic;
      const queryLabel = safeState.query ? ` · “${safeState.query}”` : '';
      status.textContent = `${categoryLabel} · ${topicLabel}${queryLabel} 검색 결과 ${visibleCount}건`;

      if (options.updateHistory) updateLocation(safeState, options.historyMode);
    }

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyState({ ...currentState, category: button.dataset.filter || 'all' }, {
          updateHistory: true,
          historyMode: 'push',
        });
      });
    });

    toolbar.addEventListener('keydown', (event) => {
      const currentIndex = filterButtons.indexOf(document.activeElement);
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % filterButtons.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + filterButtons.length) % filterButtons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = filterButtons.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      setRovingFocus(filterButtons, nextIndex);
    });

    topicSelect.addEventListener('change', () => {
      applyState({ ...currentState, topic: topicSelect.value }, {
        updateHistory: true,
        historyMode: 'push',
      });
    });

    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      applyState({ ...currentState, query: searchInput.value.trim() }, {
        updateHistory: true,
        historyMode: 'push',
      });
    });

    searchInput.addEventListener('input', () => {
      applyState({ ...currentState, query: searchInput.value });
      window.clearTimeout(queryHistoryTimer);
      queryHistoryTimer = window.setTimeout(() => {
        updateLocation(currentState, 'replace');
      }, 180);
    });

    clearButton.addEventListener('click', () => {
      searchInput.value = '';
      applyState({ ...currentState, query: '' }, {
        updateHistory: true,
        historyMode: 'replace',
      });
      searchInput.focus();
    });

    const syncFromLocation = () => applyState(stateFromLocation(filterButtons, topicSelect));
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    applyState(currentState);
  });
}());
