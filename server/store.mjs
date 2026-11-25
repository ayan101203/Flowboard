import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const priorities = ['low', 'medium', 'high'];
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = message => { throw new HttpError(400, message); };
const fields = ['title', 'description', 'priority', 'assignee', 'status'];
function validate(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object');
  const result = {};
  for (const key of fields) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== 'string') fail(`${key} must be a string`);
    if (key === 'title' && (!value.trim() || value.length > 120)) fail('Title must contain 1–120 characters');
    if (key === 'description' && value.length > 4000) fail('Description is too long');
    if (key === 'assignee' && value.length > 80) fail('Assignee is too long');
    if (key === 'priority' && !priorities.includes(value)) fail('Invalid priority');
    if (key === 'status' && !STATUSES.includes(value)) fail('Invalid status');
    result[key] = key === 'description' ? value : value.trim();
  }
  if (creating && !result.title) fail('Title is required');
  if ('position' in body && (!Number.isSafeInteger(body.position) || body.position < 0)) fail('Position must be a nonnegative integer');
  for (const key of ['beforeId', 'afterId']) if (key in body && (typeof body[key] !== 'string' || !body[key])) fail(`${key} must be a nonempty string`);
  return result;
}
export function openStore(path, seed = true) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')), assignee TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Backlog','Todo','In Progress','Done')), position INTEGER NOT NULL, updatedAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS task_order ON tasks(status,position);
    CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta VALUES (1,0);`);
  const select = db.prepare('SELECT * FROM tasks ORDER BY status,position,id');
  const upsert = db.prepare(`INSERT INTO tasks VALUES (:id,:title,:description,:priority,:assignee,:status,:position,:updatedAt) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,priority=excluded.priority,assignee=excluded.assignee,status=excluded.status,position=excluded.position,updatedAt=excluded.updatedAt`);
  const revision = () => db.prepare('SELECT revision FROM meta WHERE id=1').get().revision;
  const snapshot = () => ({ revision: revision(), tasks: select.all() });
  function transact(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (err) { db.exec('ROLLBACK'); throw err; } }
  if (seed && revision() === 0 && !select.all().length) transact(() => {
    const examples = [
      ['Explore dashboard ideas','Collect references for the project dashboard.','low','Maya','Backlog'],
      ['Define notification rules','Decide which updates should notify users.','medium','Alex','Backlog'],
      ['Design task details','Sketch the editable task detail experience.','high','Maya','Todo'],
      ['Review API contract','Check task fields and endpoint behavior.','medium','Sam','Todo'],
      ['Build board layout','Create responsive columns and task cards.','high','Alex','In Progress'],
      ['Set up project','Initialize the repository and development tools.','low','Sam','Done']
    ];
    const counts = {}; const updatedAt = new Date().toISOString();
    for (const [title,description,priority,assignee,status] of examples) { const position = counts[status] ?? 0; counts[status] = position + 1; upsert.run({id:randomUUID(),title,description,priority,assignee,status,position,updatedAt}); }
    db.exec('UPDATE meta SET revision=1 WHERE id=1');
  });
  function mutate(type, id, body = {}) {
    return transact(() => {
      const old = select.all(); const existing = old.find(t => t.id === id);
      if (type !== 'created' && !existing) throw new HttpError(404,'Task not found');
      if (type === 'created' && existing) throw new HttpError(409,'Task ID already exists');
      let task;
      if (type !== 'deleted') {
        const patch = validate(body,type === 'created');
        task = { ...(existing ?? {id,title:'',description:'',priority:'medium',assignee:'',status:'Backlog',position:0,updatedAt:''}), ...patch };
      }
      const columns = Object.fromEntries(STATUSES.map(s => [s, old.filter(t => t.status === s && t.id !== id)]));
      if (task) {
        const target = columns[task.status];
        let index = existing && existing.status === task.status ? existing.position : target.length;
        if ('position' in body) index = body.position;
        const before = target.findIndex(t => t.id === body.beforeId);
        const after = target.findIndex(t => t.id === body.afterId);
        if (before >= 0) index = before; else if (after >= 0) index = after + 1;
        target.splice(Math.min(index,target.length),0,task);
      } else db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      const now = new Date().toISOString();
      for (const status of STATUSES) columns[status].forEach((t,position) => {
        const previous = old.find(p => p.id === t.id);
        const next = {...t,position};
        if (!previous || fields.some(k => previous[k] !== next[k]) || previous.position !== position) upsert.run({...next,updatedAt:now});
      });
      db.exec('UPDATE meta SET revision=revision+1 WHERE id=1');
      return { ...snapshot(), type, taskId:id };
    });
  }
  return { snapshot, mutate, close: () => db.close() };
}
