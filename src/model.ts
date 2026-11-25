export const statuses = ['Backlog', 'Todo', 'In Progress', 'Done'] as const;
export type Status = typeof statuses[number];
export type Priority = 'low' | 'medium' | 'high';
export type Task = { id:string; title:string; description:string; priority:Priority; assignee:string; status:Status; position:number; updatedAt:string };
export type Snapshot = { revision:number; tasks:Task[] };
export type Patch = Partial<Pick<Task,'title'|'description'|'priority'|'assignee'|'status'|'position'>> & {beforeId?:string;afterId?:string};
export type Operation = {kind:'create';id:string;task:Task} | {kind:'update';id:string;patch:Patch} | {kind:'delete';id:string};
export function column(tasks:Task[],status:Status) { return tasks.filter(t=>t.status===status).sort((a,b)=>a.position-b.position || a.id.localeCompare(b.id)); }
export function applyOperation(tasks:Task[],op:Operation):Task[] {
  const existing=tasks.find(t=>t.id===op.id);
  if(op.kind==='create' && existing) return tasks;
  if(op.kind!=='create' && !existing) return tasks;
  const columns=statuses.map(s=>column(tasks,s).filter(t=>t.id!==op.id));
  if(op.kind!=='delete') {
    const patch=op.kind==='update'?op.patch:{};
    const {beforeId,afterId,...values}=patch;
    const task=op.kind==='create'?op.task:{...existing!,...values};
    const target=columns[statuses.indexOf(task.status)];
    let index=patch.position ?? (existing?.status===task.status?existing.position:target.length);
    const before=target.findIndex(t=>t.id===beforeId), after=target.findIndex(t=>t.id===afterId);
    if(before>=0) index=before; else if(after>=0) index=after+1;
    target.splice(Math.max(0,Math.min(index,target.length)),0,task);
  }
  return columns.flatMap(list=>list.map((t,position)=>({...t,position})));
}
export function projectBoard(base:Snapshot,pending:Operation[]) { return pending.reduce((tasks,op)=>applyOperation(tasks,op),base.tasks); }
export function acceptSnapshot(current:Snapshot,incoming:Snapshot) { return incoming.revision>=current.revision?incoming:current; }
export function filterTasks(tasks:Task[],q:string,priority:string,assignee:string) { const query=q.trim().toLowerCase(); return tasks.filter(t=>t.title.toLowerCase().includes(query)&&(!priority||t.priority===priority)&&(!assignee||t.assignee===assignee)); }
export function movePatch(tasks:Task[],id:string,status:Status,anchor?:string,after=false):Patch {
  const target=column(tasks,status).filter(t=>t.id!==id);
  const at=target.findIndex(t=>t.id===anchor);
  if(at<0) return {status,position:target.length,...(target.length?{afterId:target[target.length-1].id}:{})};
  return {status,position:at+(after?1:0),...(after?{afterId:target[at].id,...(target[at+1]?{beforeId:target[at+1].id}:{})}:{beforeId:target[at].id,...(target[at-1]?{afterId:target[at-1].id}:{})})};
}
