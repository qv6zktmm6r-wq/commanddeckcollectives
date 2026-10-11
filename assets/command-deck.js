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
