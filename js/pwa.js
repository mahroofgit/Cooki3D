// Installable-app support: service worker, install button, and launch-with-file.
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA({ onFile } = {}) {
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.claude) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  document.documentElement.classList.toggle('standalone', isStandalone());

  const btn = document.getElementById('install');
  const help = document.getElementById('install-help');
  if (!btn || isStandalone()) return;

  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; });
  if (isIOS()) btn.hidden = false; // Safari has no install prompt: show instructions instead

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      btn.hidden = true;
    } else {
      help.hidden = !help.hidden;
    }
  });
  help?.querySelector('button')?.addEventListener('click', () => { help.hidden = true; });

  // Android/desktop: "Open with Cookie Cutter Forge" from the file manager.
  if ('launchQueue' in window && onFile) {
    window.launchQueue.setConsumer(async params => {
      const h = params.files?.[0];
      if (h) onFile(await h.getFile());
    });
  }
}
