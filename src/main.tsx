import { render } from 'preact';
import { App } from './App';
import './styles/global.css';

var root = document.getElementById('app');
if (root) {
  render(<App />, root);
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // Ensure local Vite dev server is never intercepted by a cached Service Worker
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      for (var i = 0; i < regs.length; i++) {
        regs[i].unregister();
      }
    }).catch(function () {});
    if ('caches' in window) {
      window.caches.keys().then(function (keys) {
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('glance-') === 0) {
            window.caches.delete(keys[i]);
          }
        }
      }).catch(function () {});
    }
  } else {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        // Ignore SW registration errors on local HTTP or older contexts
      });
    });
  }
}
