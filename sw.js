const CACHE = 'pos-v4';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.url.includes('api.php')||e.request.url.includes('auth.php')) {
    return e.respondWith(fetch(e.request).catch(()=>new Response(JSON.stringify({success:false,message:'offline'}),{headers:{'Content-Type':'application/json'}})));
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,cl));}return r;}).catch(()=>caches.match('./index.html'))));
});
