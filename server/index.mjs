import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openStore, HttpError } from './store.mjs';
const root = fileURLToPath(new URL('../dist/',import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const json = (res,status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
async function readBody(req) { let size=0; const chunks=[]; for await (const chunk of req) { size+=chunk.length; if(size>65536) throw new HttpError(413,'Request too large'); chunks.push(chunk); } try { const body=JSON.parse(Buffer.concat(chunks).toString()); if(!body || typeof body!=='object' || Array.isArray(body)) throw Error(); return body; } catch { throw new HttpError(400,'Invalid JSON object'); } }
export function createApp({ database = process.env.DB_PATH || './data/board.sqlite', seed = process.env.SEED_DEMO !== 'false', failureRate = Number(process.env.FAILURE_RATE || 0), shouldFail = () => Math.random() < failureRate } = {}) {
  const store = openStore(database,seed); const clients=new Set();
  function sendEvent(res,event) { if (res.destroyed || res.writableEnded) { clients.delete(res); return; } if (!res.write(`id: ${event.revision}\ndata: ${JSON.stringify(event)}\n\n`)) { clients.delete(res); res.destroy(); } }
  const heartbeat=setInterval(()=>{ for(const res of clients) if(!res.write(': heartbeat\n\n')) { clients.delete(res); res.destroy(); } },15000); heartbeat.unref();
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'); const path=url.pathname;
      if (path==='/api/board' && req.method==='GET') return json(res,200,store.snapshot());
      if (path==='/api/events' && req.method==='GET') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}); res.flushHeaders(); res.write('retry: 1500\n\n'); clients.add(res); res.on('close',()=>clients.delete(res)); sendEvent(res,{...store.snapshot(),type:'snapshot'}); return;
      }
      const match=path.match(/^\/api\/tasks\/([^/]+)$/);
      const isCreate=path==='/api/tasks' && req.method==='POST';
      if(isCreate || (match && ['PATCH','DELETE'].includes(req.method))) {
        const body=req.method==='DELETE'?{}:await readBody(req);
        if(shouldFail(req)) throw new HttpError(503,'Simulated temporary API failure. Please try again.');
        const id=isCreate?(body.id??randomUUID()):decodeURIComponent(match[1]);
        if(typeof id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new HttpError(400,'Invalid task ID');
        const type=isCreate?'created':req.method==='PATCH'?'updated':'deleted';
        const result=store.mutate(type,id,body);
        for(const client of clients) sendEvent(client,result);
        return json(res,isCreate?201:200,result);
      }
      if(path.startsWith('/api/')) return json(res,404,{error:'Endpoint not found'});
      if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed'});
      let file=resolve(root,'.'+decodeURIComponent(path));
      if(file!==resolve(root) && !file.startsWith(resolve(root)+sep)) return json(res,403,{error:'Forbidden'});
      if(!existsSync(file)||!statSync(file).isFile()) file=resolve(root,'index.html');
      if(!existsSync(file)) return json(res,503,{error:'Frontend not built. Run npm run build or npm run dev.'});
      res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':file.endsWith('index.html')?'no-cache':'public, max-age=3600'});
      if(req.method==='HEAD') return res.end(); createReadStream(file).pipe(res);
    } catch(err) { if(!res.headersSent) json(res,err.status||500,{error:err.status?err.message:'Unexpected server error'}); else res.end(); if(!err.status) console.error(err); }
  });
  server.on('close',()=>{clearInterval(heartbeat); store.close();});
  function close() { for(const res of clients) res.end(); clients.clear(); server.closeAllConnections(); return new Promise(resolve=>server.close(resolve)); }
  return {server,close};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) { const app=createApp(); const port=Number(process.env.PORT||3001); app.server.listen(port,'0.0.0.0',()=>console.log(`Flowboard listening on http://localhost:${port}`)); for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.close()); }
