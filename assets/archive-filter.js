(function () {
  function setActiveFilter(activeButton) {
    document.querySelectorAll('.filter-btn').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    activeButton.classList.add('active');
    activeButton.setAttribute('aria-pressed', 'true');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const filterButtons = document.querySelectorAll('.filter-btn');
    const cards = document.querySelectorAll('.doc-card[data-category]');

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter || 'all';
        setActiveFilter(button);
        cards.forEach((card) => {
          card.hidden = filter !== 'all' && card.dataset.category !== filter;
        });
      });
    });
  });
}());
