const CACHE = "medwaste-v1";
const ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./css/styles.css",
  "./js/waste-db.js", "./js/policy.js", "./js/ledger.js",
  "./js/mock-robot.js", "./js/app.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Cache-first for the shell. Ward Wi-Fi drops constantly and a segregation
// console that goes blank in a basement corridor is worse than useless.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit)
    )
  );
});
