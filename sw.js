/* Service worker: makes the app installable and fully offline.

   Cache-first with a background refresh. An instrument has to start instantly
   and must not care whether there is signal, so freshness comes second — a new
   version is picked up on the next launch. */

const VERSION = 'snythia-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/state.js',
  './js/util.js',
  './js/audio/engine.js',
  './js/audio/fx.js',
  './js/audio/voice.js',
  './js/audio/polysynth.js',
  './js/audio/drums.js',
  './js/audio/presets.js',
  './js/audio/kits.js',
  './js/audio/clock.js',
  './js/audio/groove.js',
  './js/audio/recorder.js',
  './js/midi/hub.js',
  './js/midi/webmidi.js',
  './js/midi/blemidi.js',
  './js/midi/native.js',
  './js/ui/dom.js',
  './js/ui/sheet.js',
  './js/ui/panels.js',
  './js/ui/keyboard.js',
  './js/ui/pads.js',
  './js/ui/knob.js',
  './js/ui/toast.js',
  './js/ui/visualizer.js',
  './js/ui/bash.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll fails the whole install if any single file 404s, so add
      // individually and let the rest through.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch((err) => {
          console.warn('[sw] could not cache', url, err);
        })),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // Serve the cached copy immediately when we have one; refresh behind it.
      return cached || network;
    }),
  );
});
