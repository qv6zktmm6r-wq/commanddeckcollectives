document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('[data-menu-toggle]');
  const panel = document.querySelector('[data-mobile-panel]');

  if (toggle && panel) {
    const setOpen = (open) => {
      panel.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
    panel.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  const lightbox = document.querySelector('[data-lightbox]');
  const photos = [...document.querySelectorAll('[data-lightbox-item]')];
  if (lightbox && photos.length && typeof lightbox.showModal === 'function') {
    const image = lightbox.querySelector('[data-lightbox-image]');
    const caption = lightbox.querySelector('[data-lightbox-caption]');
    const prev = lightbox.querySelector('[data-lightbox-prev]');
    const next = lightbox.querySelector('[data-lightbox-next]');
    let current = 0;
    const show = (index) => {
      current = (index + photos.length) % photos.length;
      const photo = photos[current];
      const thumb = photo.querySelector('img');
      image.width = Number(thumb?.getAttribute('width')) || 1000;
      image.height = Number(thumb?.getAttribute('height')) || 1000;
      image.src = photo.href;
      image.alt = thumb?.alt || '';
      caption.textContent = photo.dataset.caption || '';
      caption.hidden = !caption.textContent;
    };
    prev.hidden = next.hidden = photos.length < 2;
    photos.forEach((photo, index) => photo.addEventListener('click', (event) => {
      event.preventDefault();
      show(index);
      lightbox.showModal();
    }));
    prev.addEventListener('click', () => show(current - 1));
    next.addEventListener('click', () => show(current + 1));
    lightbox.querySelector('[data-lightbox-close]').addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox || event.target.tagName === 'FIGURE') lightbox.close();
    });
    lightbox.addEventListener('keydown', (event) => {
      if (photos.length < 2) return;
      if (event.key === 'ArrowLeft') show(current - 1);
      if (event.key === 'ArrowRight') show(current + 1);
    });
    lightbox.addEventListener('close', () => photos[current].focus());
  }

  // The standalone preview has no backend; Shopify themes submit the real contact form instead.
  const previewForm = document.querySelector('[data-preview-form]');
  if (previewForm) {
    previewForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const status = previewForm.querySelector('[data-form-status]');
      status.textContent = 'Preview only — nothing was sent. In the Shopify theme, this request goes to the store inbox.';
      status.hidden = false;
    });
  }
});
