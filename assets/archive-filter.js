(function () {
  const topicParam = 'topic';
  const queryParam = 'q';
  const legacyCategoryParams = ['category', 'filter'];
  const categoryRoutes = {
    statement: 'statement/',
    mom: 'MoM/',
    knowledge: 'knowledge/',
    notice: 'notice/',
  };

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('ko')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function redirectLegacyCategory() {
    const params = new URLSearchParams(window.location.search);
    const category = legacyCategoryParams.map((name) => params.get(name)).find(Boolean);
    const archive = document.querySelector('[data-archive-category]');
    if (!category || !categoryRoutes[category] || !archive || archive.dataset.archiveCategory !== 'all') {
      return false;
    }

    legacyCategoryParams.forEach((name) => params.delete(name));
    const home = document.querySelector('.site-archive-entry');
    const target = new URL(categoryRoutes[category], home ? home.href : window.location.href);
    target.search = params.toString();
    window.location.replace(target.href);
    return true;
  }

  function stateFromLocation(topicSelect) {
    const params = new URLSearchParams(window.location.search);
    const availableTopics = Array.from(topicSelect.options).map((option) => option.value);
    const topic = params.get(topicParam) || 'all';
    return {
      topic: availableTopics.includes(topic) ? topic : 'all',
      query: String(params.get(queryParam) || '').slice(0, 120),
    };
  }

  function updateLocation(state, mode) {
    const url = new URL(window.location.href);
    legacyCategoryParams.forEach((name) => url.searchParams.delete(name));
    if (state.topic === 'all') url.searchParams.delete(topicParam);
    else url.searchParams.set(topicParam, state.topic);
    if (state.query) url.searchParams.set(queryParam, state.query);
    else url.searchParams.delete(queryParam);
    if (url.href === window.location.href) return;
    window.history[mode === 'replace' ? 'replaceState' : 'pushState']({ archiveState: state }, '', url);
  }

  function resultText(state, count) {
    if (state.query && state.topic !== 'all') return `${state.topic} · “${state.query}” 검색 결과 ${count}건`;
    if (state.query) return `“${state.query}” 검색 결과 ${count}건`;
    if (state.topic !== 'all') return `${state.topic} · ${count}건`;
    return `자료 ${count}건`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (redirectLegacyCategory()) return;
    const tools = document.querySelector('.archive-tools');
    const topicSelect = document.getElementById('archive-topic-select');
    const searchInput = document.getElementById('archive-search-input');
    const searchForm = document.querySelector('.archive-search');
    const clearButton = document.querySelector('.archive-search-clear');
    const results = document.getElementById('archive-results');
    const summary = document.getElementById('archive-result-summary');
    if (!tools || !topicSelect || !searchInput || !searchForm || !clearButton || !results || !summary) return;

    const cards = Array.from(results.querySelectorAll('.doc-card[data-category]'));
    const noResults = results.querySelector('.archive-no-results');
    const olderDocuments = results.querySelector('[data-archive-older-documents]');
    [topicSelect, searchInput].forEach((control) => control.setAttribute('aria-controls', results.id));
    let currentState = stateFromLocation(topicSelect);
    let queryHistoryTimer;

    function applyState(nextState, options) {
      const safeState = {
        topic: Array.from(topicSelect.options).some((option) => option.value === nextState.topic)
          ? nextState.topic
          : 'all',
        query: String(nextState.query || '').slice(0, 120),
      };
      const normalizedQuery = normalize(safeState.query);
      let visibleCount = 0;
      let olderMatch = false;

      currentState = safeState;
      topicSelect.value = safeState.topic;
      searchInput.value = safeState.query;
      clearButton.hidden = !safeState.query;
      cards.forEach((card) => {
        const topics = String(card.dataset.topics || '').split('|');
        const topicMatches = safeState.topic === 'all' || topics.includes(safeState.topic);
        const queryMatches = !normalizedQuery || normalize(card.dataset.search).includes(normalizedQuery);
        const visible = topicMatches && queryMatches;
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
          if (olderDocuments && olderDocuments.contains(card)) olderMatch = true;
        }
      });

      if (noResults) noResults.hidden = visibleCount !== 0;
      if (olderDocuments) {
        olderDocuments.open = (safeState.topic !== 'all' || Boolean(safeState.query)) && olderMatch;
      }
      summary.textContent = resultText(safeState, visibleCount);
      if (options && options.updateHistory) updateLocation(safeState, options.historyMode);
    }

    topicSelect.addEventListener('change', () => {
      applyState({ ...currentState, topic: topicSelect.value }, { updateHistory: true, historyMode: 'push' });
    });
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      applyState({ ...currentState, query: searchInput.value.trim() }, { updateHistory: true, historyMode: 'push' });
    });
    searchInput.addEventListener('input', () => {
      applyState({ ...currentState, query: searchInput.value });
      window.clearTimeout(queryHistoryTimer);
      queryHistoryTimer = window.setTimeout(() => updateLocation(currentState, 'replace'), 180);
    });
    clearButton.addEventListener('click', () => {
      applyState({ ...currentState, query: '' }, { updateHistory: true, historyMode: 'replace' });
      searchInput.focus();
    });
    window.addEventListener('popstate', () => applyState(stateFromLocation(topicSelect)));
    applyState(currentState);
  });
}());
