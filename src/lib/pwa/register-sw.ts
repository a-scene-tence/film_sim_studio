export type SwCallbacks = {
  onUpdateReady: (apply: () => void) => void;
  onOfflineReady: () => void;
};

export function registerServiceWorker(cb: SwCallbacks): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') {
    void navigator.serviceWorker.getRegistrations().then((rs) => {
      for (const r of rs) void r.unregister();
    });
    return;
  }
  const hadController = navigator.serviceWorker.controller !== null;
  let accepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (accepted) {
      window.location.reload();
      return;
    }
    if (!hadController) cb.onOfflineReady();
  });
  const offer = (w: ServiceWorker) =>
    cb.onUpdateReady(() => {
      accepted = true;
      w.postMessage({ type: 'SKIP_WAITING' });
    });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
        });
      });
      window.setInterval(() => {
        void reg.update();
      }, 60 * 60 * 1000);
    })
    .catch((e: unknown) => {
      console.warn('service worker registration failed', e);
    });
}
