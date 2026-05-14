/**
 * Service Worker для Путеводителя РГАТУ
 * Обеспечивает офлайн-доступ и кэширование ресурсов
 * v6: SVG-карты кэшируются при установке для полного офлайна
 */

const CACHE_NAME = 'rgatu-guide-v6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/favicon.svg',
  '/data/data_departments.json',
  '/data/data_documents.json',
  '/data/data_contacts.json',
  '/data/data_leadership.json',
  '/data/data_subdivisions.json',
  '/data/data_meta.json',
  // SVG-карты — кэшируем для полного офлайна
  '/maps/floor_1.svg',
  '/maps/floor_2.svg',
  '/maps/floor_3.svg',
  '/maps/floor_4.svg',
  '/maps/floor_5.svg',
];

// Установка — кэшируем статику (без SVG — они загружаются по требованию)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: кэширование статики v5');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Активация — удаляем старый кэш
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Перехват запросов
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Только GET-запросы
  if (request.method !== 'GET') return;

  // Статические ресурсы (HTML, CSS, JS) — Cache First, обновляем в фоне
  if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset) || url.pathname === asset)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Фоновое обновление
        const fetchPromise = fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // SVG-карты — Cache First с фоновым обновлением (офлайн приоритет)
  if (url.pathname.endsWith('.svg')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Фоновое обновление — скачиваем свежую версию если онлайн
        const fetchPromise = fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => cached);
        // Отдаём кэш мгновенно, обновляем в фоне
        return cached || fetchPromise;
      })
    );
    return;
  }

  // JSON-данные — Network First с fallback на кэш
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Всё остальное — Network First
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
