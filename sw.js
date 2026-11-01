/* 小艺绘画 Service Worker：应用壳预缓存 + samp 小样图缓存优先 + HTML 网络优先 */
const CACHE='xy-shell-v1';
const SHELL=[
  './',
  './index.html',
  './xiaoyi-paint.html',
  './manifest.webmanifest',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return; // API 请求直通网络，离线由业务层报错
  const isDoc=req.destination==='document'||/\.html?(\?|$)/.test(url.pathname)||url.pathname==='/';
  if(isDoc){ // HTML：网络优先，失败回退缓存（保证发版即时生效）
    e.respondWith(
      fetch(req).then(r=>{
        const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));return r;
      }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./xiaoyi-paint.html')))
    );
    return;
  }
  // 静态资源（图标 / samp 小样图）：缓存优先 + 运行时回填
  e.respondWith(
    caches.match(req,{ignoreSearch:true}).then(hit=>{
      if(hit)return hit;
      return fetch(req).then(r=>{
        if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp));}
        return r;
      });
    })
  );
});
