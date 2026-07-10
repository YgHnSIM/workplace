(function () {
  const filterParam = 'filter';

  function availableFilter(buttons, value) {
    return buttons.some((button) => button.dataset.filter === value) ? value : 'all';
  }

  function filterFromHash(buttons, hashValue = window.location.hash) {
    let hash = hashValue.replace(/^#/, '');
    try {
      hash = decodeURIComponent(hash);
    } catch (error) {
      return '';
    }

    const value = hash.replace(/^filter[-=:/]?/, '');
    return buttons.some((button) => button.dataset.filter === value) ? value : '';
  }

  function filterFromLocation(buttons) {
    const params = new URLSearchParams(window.location.search);
    const queryFilter = params.get(filterParam);
    if (queryFilter) return availableFilter(buttons, queryFilter);
    return filterFromHash(buttons) || 'all';
  }

  function setActiveFilter(buttons, activeButton) {
    buttons.forEach((button) => {
      const isActive = button === activeButton;
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

  function updateLocation(buttons, filter) {
    const url = new URL(window.location.href);
    if (filter === 'all') url.searchParams.delete(filterParam);
    else url.searchParams.set(filterParam, filter);

    if (filterFromHash(buttons, url.hash)) url.hash = '';
    if (url.href === window.location.href) return;

    window.history.pushState({ archiveFilter: filter }, '', url);
  }

  function createResultStatus(toolbar) {
    const status = document.createElement('p');
    status.className = 'filter-status';
    status.id = 'archive-filter-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    toolbar.after(status);
    return status;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.querySelector('.filter-bar[role="toolbar"], .filter-bar');
    if (!toolbar) return;

    const filterButtons = Array.from(toolbar.querySelectorAll('.filter-btn'));
    const cards = Array.from(document.querySelectorAll('.doc-card[data-category]'));
    if (!filterButtons.length) return;

    const results = cards.length ? cards[0].closest('.doc-list') : null;
    if (results) {
      if (!results.id) results.id = 'archive-results';
      filterButtons.forEach((button) => button.setAttribute('aria-controls', results.id));
    }

    const status = createResultStatus(toolbar);

    function applyFilter(filter, options = {}) {
      const safeFilter = availableFilter(filterButtons, filter);
      const activeButton = filterButtons.find((button) => button.dataset.filter === safeFilter)
        || filterButtons[0];
      let visibleCount = 0;

      setActiveFilter(filterButtons, activeButton);
      cards.forEach((card) => {
        const isVisible = safeFilter === 'all' || card.dataset.category === safeFilter;
        card.hidden = !isVisible;
        if (isVisible) visibleCount += 1;
      });

      const filterLabel = (activeButton.textContent || '').trim();
      status.textContent = `${filterLabel} 자료 ${visibleCount}건`;
      if (options.updateHistory) updateLocation(filterButtons, safeFilter);
    }

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        applyFilter(button.dataset.filter || 'all', { updateHistory: true });
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

    const syncFilterFromLocation = () => applyFilter(filterFromLocation(filterButtons));
    window.addEventListener('popstate', syncFilterFromLocation);
    window.addEventListener('hashchange', syncFilterFromLocation);
    syncFilterFromLocation();
  });
}());
