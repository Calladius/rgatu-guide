// sw для путеводителя ргату

const CACHE_NAME = 'rgatu-guide-v19';

// таймаут сети — если инет "есть" но заблокирован, не висим
const NETWORK_TIMEOUT = 3000;

// относительные пути чтобы работало на любом домене
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
  // svg карты для офлайна
  'maps/floor_1.svg',
  'maps/floor_2.svg',
  'maps/floor_3.svg',
  'maps/floor_4.svg',
  'maps/floor_5.svg',
];

// проверка на статический ассет
function isStaticAsset(pathname) {
  return STATIC_ASSETS.some(asset => pathname.endsWith(asset));
}

// фетч с таймаутом, если сеть не ответила — промис отваливается
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

// кэшируем статику при установке
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: кэширование статики v11');
      return cache.addAll(STATIC_ASSETS.map(a => './' + a));
    })
  );
  self.skipWaiting();
});

// удаляем старый кэш и перезакачиваем статику
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => {
      // перезакачиваем все файлы чтобы сразу были свежие
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS.map(a => './' + a));
      });
    })
  );
  self.clients.claim();
});

// перехват запросов
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // только GET и только со своего origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // навигация — network first с таймаутом
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, NETWORK_TIMEOUT)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // сеть отвалилась — отдаём из кэша
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // ститика — cache first, обновляем в фоне
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // фоновое обновление, не блокирует отдачу
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

  // остальное — network first
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
