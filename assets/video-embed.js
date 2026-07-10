(function () {
  const videoIdPattern = /^[A-Za-z0-9_-]{6,}$/;

  function createIframe(button) {
    const videoId = String(button.dataset.videoId || '').trim();
    if (!videoIdPattern.test(videoId)) return;

    const iframe = document.createElement('iframe');
    iframe.className = String(button.dataset.frameClass || 'post-video-frame').trim();
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;
    iframe.title = String(button.dataset.videoTitle || 'YouTube 영상').trim();
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    button.replaceWith(iframe);
    iframe.focus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.video-facade[data-video-id]').forEach((button) => {
      button.addEventListener('click', () => createIframe(button));
    });
  });
}());
