/**
 * Service Worker для Путеводителя РГАТУ
 * Обеспечивает офлайн-доступ и кэширование ресурсов
 * v9: getInstalledRelatedApps() для проверки установки PWA
 */

const CACHE_NAME = 'rgatu-guide-v9';

// Относительные пути — совпадают с окончанием URL независимо от базового пути
const STATIC_ASSETS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'manifest.json',
  'icons/favicon.svg',
  'data/data_departments.json',
  'data/data_documents.json',
  'data/data_contacts.json',
  'data/data_leadership.json',
  'data/data_subdivisions.json',
  'data/data_meta.json',
  // SVG-карты — кэшируем для полного офлайна
  'maps/floor_1.svg',
  'maps/floor_2.svg',
  'maps/floor_3.svg',
  'maps/floor_4.svg',
  'maps/floor_5.svg',
];

// Проверяет, соответствует ли путь запроса одному из кэшируемых ресурсов
function isStaticAsset(pathname) {
  return STATIC_ASSETS.some(asset => pathname.endsWith(asset));
}

// Установка — кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: кэширование статики v8');
      return cache.addAll(STATIC_ASSETS.map(a => './' + a));
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

  // Только GET-запросы и только с того же источника
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Навигационные запросы (пользователь открывает URL в браузере)
  // В офлайне отдаём index.html из кэша — PWA работает как приложение
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Офлайн — ищем в кэше запрос или любой index.html
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Статические ресурсы (HTML, CSS, JS, JSON, SVG) — Cache First, обновляем в фоне
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Фоновое обновление
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Всё остальное — Network First с fallback на кэш
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
