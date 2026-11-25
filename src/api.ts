import type { Operation, Snapshot } from './model';
async function request(path:string,init?:RequestInit):Promise<Snapshot> {
  const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init?.headers},cache:'no-store'});
  const body=await response.json();
  if(!response.ok) throw new Error(body.error||`Request failed (${response.status})`);
  return body;
}
export const getBoard=()=>request('/api/board');
export function sendOperation(op:Operation) {
  if(op.kind==='create') return request('/api/tasks',{method:'POST',body:JSON.stringify(op.task)});
  const path=`/api/tasks/${encodeURIComponent(op.id)}`;
  return op.kind==='delete'?request(path,{method:'DELETE'}):request(path,{method:'PATCH',body:JSON.stringify(op.patch)});
}
