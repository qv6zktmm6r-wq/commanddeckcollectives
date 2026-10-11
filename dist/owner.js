// Install help and offline support for the owner app (kept out of owner.html so the page can forbid inline scripts).
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (!standalone) {
  const help = document.querySelector('[data-install-help]');
  help.hidden = false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const android = /android/i.test(navigator.userAgent);
  if (ios) help.querySelector('[data-install-android]').hidden = true;
  if (android) help.querySelector('[data-install-ios]').hidden = true;
  const button = help.querySelector('[data-install-button]');
  let deferred;
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('owner-sw.js');
