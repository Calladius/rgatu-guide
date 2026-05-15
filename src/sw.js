/**
 * Service Worker для Путеводителя РГАТУ
 * Обеспечивает офлайн-доступ и кэширование ресурсов
 * v14: подсказки поиска шире на мобильных, word-break
 */

const CACHE_NAME = 'rgatu-guide-v14';

// Таймаут для сетевых запросов (мс)
// Если сеть не ответила за это время — отдаём из кэша
// Защищает от ситуации: интернет «есть», но заблокирован (firewall, РКН и т.д.)
const NETWORK_TIMEOUT = 3000;

// Относительные пути — совпадают с окончанием URL независимо от базового пути
const STATIC_ASSETS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'manifest.json',
  'icons/favicon.svg',
  'icons/favicon.ico',
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

// Запрос к сети с таймаутом
// Если сеть не ответила за timeoutMs — промис отклоняется
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('SW timeout'));
    }, timeoutMs);

    fetch(request, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
  });
}

// Установка — кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: кэширование статики v11');
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
  // Network First с таймаутом: если сеть не ответила за 3с — отдаём из кэша
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, NETWORK_TIMEOUT)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Таймаут или ошибка сети — отдаём из кэша
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
        // Фоновое обновление с таймаутом — не блокирует отдачу из кэша
        const fetchPromise = fetchWithTimeout(request, NETWORK_TIMEOUT)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Всё остальное — Network First с таймаутом и fallback на кэш
  event.respondWith(
    fetchWithTimeout(request, NETWORK_TIMEOUT)
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
