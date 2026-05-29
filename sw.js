// ===== SERVICE WORKER - Portfolio Manager =====
// กลยุทธ์: Cache First สำหรับ assets, Network First สำหรับ API

const CACHE_NAME = 'portfolio-v1';
const STATIC_CACHE = 'portfolio-static-v1';
const API_CACHE   = 'portfolio-api-v1';

// ไฟล์ที่ต้อง cache ไว้ใช้งาน offline
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ===== INSTALL: pre-cache static assets =====
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Installation complete');
        return self.skipWaiting(); // เปิดใช้งาน SW ใหม่ทันที
      })
      .catch((err) => {
        console.warn('[SW] Pre-cache failed (some files may not exist yet):', err);
        return self.skipWaiting();
      })
  );
});

// ===== ACTIVATE: ลบ cache เก่าออก =====
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  const allowedCaches = [STATIC_CACHE, API_CACHE];

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !allowedCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activated — claiming clients');
        return self.clients.claim(); // ควบคุม tab ที่เปิดอยู่ทันที
      })
  );
});

// ===== FETCH: จัดการ request ทั้งหมด =====
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ข้ามคำขอที่ไม่ใช่ HTTP/HTTPS
  if (!request.url.startsWith('http')) return;

  // ข้ามคำขอ Chrome extension
  if (url.protocol === 'chrome-extension:') return;

  // กลยุทธ์แยกตามประเภท request
  if (isAPIRequest(url)) {
    // API → Network First (ใช้ cache เป็น fallback)
    event.respondWith(networkFirst(request));
  } else if (isStaticAsset(url)) {
    // รูปภาพ/CSS/JS → Cache First
    event.respondWith(cacheFirst(request));
  } else {
    // HTML pages → Stale While Revalidate
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ===== ตรวจสอบประเภท request =====
function isAPIRequest(url) {
  // Apps Script URL มักมี script.google.com หรือ APPS_SCRIPT_URL
  return url.hostname.includes('script.google.com') ||
         url.hostname.includes('googleapis.com') ||
         url.searchParams.has('action');
}

function isStaticAsset(url) {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf)$/i.test(url.pathname);
}

// ===== กลยุทธ์: Network First =====
// ลอง network ก่อน, ถ้าล้มเหลวใช้ cache
async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const networkResponse = await fetchWithTimeout(request, 5000);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.log('[SW] Network failed, using cache for:', request.url);
    const cached = await cache.match(request);
    if (cached) return cached;

    // ส่ง offline response กลับไป
    return offlineAPIResponse();
  }
}

// ===== กลยุทธ์: Cache First =====
// ใช้ cache ก่อน, ถ้าไม่มีค่อยไปดึงจาก network
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.log('[SW] Cache miss + network fail:', request.url);
    return new Response('Offline', { status: 503 });
  }
}

// ===== กลยุทธ์: Stale While Revalidate =====
// ส่ง cache กลับทันที แล้ว update ใน background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cached); // fallback ถ้า network ล้มเหลว

  return cached || fetchPromise;
}

// ===== Fetch พร้อม Timeout =====
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    fetch(request)
      .then((response) => { clearTimeout(timer); resolve(response); })
      .catch((err)      => { clearTimeout(timer); reject(err); });
  });
}

// ===== Offline API Response =====
function offlineAPIResponse() {
  return new Response(
    JSON.stringify({
      success: false,
      offline: true,
      error: 'คุณอยู่ในโหมด Offline — ไม่สามารถดึงข้อมูลได้ในขณะนี้'
    }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// ===== รับ Message จาก App =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
