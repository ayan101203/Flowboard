# Flowboard — Collaborative Kanban Board

Machine coding assignment · React + TypeScript · Node.js · SQLite

Flowboard is a shared Kanban board with Backlog, Todo, In Progress and Done columns. The same server hosts the API and production frontend, so no CORS configuration or separate frontend deployment is required.

## Quick start

**Prerequisites:** Node.js 22.13+ (Node 22.16 tested), npm, and a modern browser.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The API runs on port 3001; Vite proxies `/api` to it. The SQLite database is created automatically at `data/board.sqlite`. Six example tasks are seeded on the first run only. Use `SEED_DEMO=false` on a fresh database to start empty.

For a production build:

```bash
npm run build
npm start
```

Open **http://localhost:3001**. No separate database installation is necessary. The server uses Node's built-in `node:sqlite`, which may produce an experimental-feature warning on Node 22.

Run automated tests (no third-party packages needed):

```bash
npm test
```

### Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port (development proxy expects 3001) |
| `DB_PATH` | `./data/board.sqlite` | SQLite file path; use persistent storage in production |
| `SEED_DEMO` | `true` | Set `false` to disable demo tasks on initial startup |
| `FAILURE_RATE` | `0` | Fraction of task writes rejected before commit; use `0.25` for occasional failure or `1` for deterministic failure testing |

Environment variables are read from the process. To test failures on macOS/Linux, stop the running app and execute `FAILURE_RATE=1 npm run dev` (or `FAILURE_RATE=1 npm start` after building). In PowerShell: `$env:FAILURE_RATE='1'; npm run dev`. Restore `FAILURE_RATE=0` afterward.

## Implementation status

| Assignment requirement | Implementation |
|---|---|
| Fetch board; create, edit, delete | Implemented in API and frontend |
| Drag between columns; reorder within columns | Native HTML drag-and-drop; positions persisted transactionally |
| Search and combined priority/assignee filters | Case-insensitive title search and two conjunctive filters |
| Task detail modal | Title, description, priority, assignee, status editable; deletion confirmation |
| Optimistic update and rollback | Immediate local overlay for all writes; failed overlay removed, error shown, board reconciled |
| Real-time collaboration | SSE stream broadcasts committed events; initial/reconnect snapshots |
| URL state | `q`, `priority`, `assignee` query parameters; restored on refresh |
| Persistent storage | SQLite with WAL, transaction and revision counter |

**Verification:** Nine automated tests passed in Node 22.16, covering the actual HTTP API, two SSE clients, reconnect, persistent ordering, invalid input, simulated write failures, restart persistence, partial concurrent edits, and pure frontend state/filter logic. The frontend package install/build and real-browser interaction could not be verified in the creation environment because the npm registry was unreachable. Run the build and manual checks below before submitting. No public repository or hosted instance has been created. A lockfile has not been generated; commit `package-lock.json` after a successful `npm install`.

**Scope:** One shared board, no authentication, per-user permissions, multi-board support, or production-grade scaling (not required by the assignment). Native drag-and-drop is intended for desktop browsers; on touch devices or with a keyboard, use the status editor to move tasks and the up/down card buttons to reorder. Same-field simultaneous edits use last committed write wins. A failed request closes the editor and rolls back the board; users must reopen the task to retry. Network ambiguity (a write commits but its response is lost) is reconciled by fetching the latest board and/or SSE; the server's committed state remains authoritative. There is no offline mutation persistence. Deploy a single server instance; the in-memory SSE connection registry is not shared across instances.

## Architecture

```text
Browser A (React) ─── REST writes ───┐
                                    ├── Node.js HTTP API ─── SQLite
Browser B (React) ─── REST writes ───┘        │
                                            ├── SSE → Browser A
                                            └── SSE → Browser B
```

The server commits each task mutation and normalizes affected column positions in a single synchronous SQLite transaction. It increments a persisted board revision, then broadcasts the resulting snapshot with the mutation type and task ID. No messages are broadcast for rejected transactions.

## Optimistic updates and rollback

The frontend keeps a confirmed server snapshot and a queue of pending operations separately. The rendered board is the confirmed snapshot plus those operations applied in sequence. Writes are sent sequentially per browser, while other browsers can submit writes concurrently. The same task is temporarily locked for local edits while its request is pending, but other tasks remain editable.

1. A task update or drag immediately adds an operation to the pending queue and recomputes the visible board.
2. The API request persists the edit or move. A successful response advances the confirmed snapshot if its revision is not older, and removes only the matching pending operation.
3. On failure, the client removes only that operation and displays an error. The other pending operations and any newer remote changes are retained. A fresh GET reconciles uncertain server state.

This avoids restoring an old copy of the entire board and accidentally losing changes from another collaborator.

## Real-time updates and conflicts

`EventSource('/api/events')` receives `created`, `updated`, `deleted`, or `snapshot` events, each with a complete authoritative task snapshot and monotonic revision. EventSource reconnects automatically; the server sends a fresh snapshot on every connection. A heartbeat keeps idle streams active. Older HTTP responses and SSE snapshots cannot replace a newer confirmed revision. Pending edits are reapplied on top of new snapshots. Creating/deleting the same task in an echoed event is idempotent in the projection.

The edit modal tracks dirty fields separately, so remote changes to untouched fields remain visible while locally edited fields are preserved. Saving sends only changed fields rather than an entire stale task. If a task is deleted while the modal is open, saving is disabled. If users edit the same field concurrently, the last server-committed value wins. Drag operations send status and position plus optional neighboring task IDs, which let the backend resolve positions relative to the latest column, including when a filter hides some cards. Revisions, not wall-clock timestamps, order board updates.

## REST API

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/board` | `{ revision, tasks }` |
| POST | `/api/tasks` | 201 and committed snapshot/event |
| PATCH | `/api/tasks/:id` | 200 and committed snapshot/event |
| DELETE | `/api/tasks/:id` | 200 and committed snapshot/event |
| GET | `/api/events` | `text/event-stream`; snapshot and mutation events |

Task shape:

```ts
type Task = {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  status: 'Backlog' | 'Todo' | 'In Progress' | 'Done';
  position: number;
  updatedAt: string;
};
```

Example create request:

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Review assignment","priority":"high","assignee":"Alex","status":"Todo"}'
```

Example move: `PATCH /api/tasks/<id>` with `{"status":"Done","position":0}`. The optional `beforeId` and `afterId` anchors take precedence if they refer to a task in the destination column. Invalid input returns 400, missing tasks 404, duplicate IDs 409, simulated failures 503. Error responses use `{ "error": "..." }`.

## Manual browser checklist

- Open the same URL in two separate tabs or browsers. Both should show **Live sync**.
- Create a task in tab A. Confirm it appears in tab B without refresh.
- Edit its details and verify tab B updates. Drag it into another column, then reorder within the column. Refresh both tabs and verify positions persist.
- Search by title and select a priority and an assignee. Refresh; all three filters should persist via the URL.
- Open an existing task in tab A and type a new title without saving. Change only the description in tab B and save. Tab A should retain its draft title and show the updated description. Save A and verify both changes persist.
- Delete a task in tab B while it is open in A; A should show that it was removed and disable saving.
- Restart the server with `FAILURE_RATE=1`, then try updating, dragging, creating or deleting a task. The UI should update optimistically, revert and show an error. Restart with `FAILURE_RATE=0` to resume normal operation.
- Stop and restart the normal server; verify both tabs reconnect and converge to the latest snapshot.

## Deployment

The application can run as one Node web service with a persistent disk. The included `render.yaml` is a starter Blueprint for Render. A persistent disk generally requires a paid service; review the current plan and charges before confirming. This configuration has not been deployed or verified on Render.

### Push to GitHub

Create an empty GitHub repository, then from this project folder:

```bash
npm install
npm run build
npm test
git init
git add .
git commit -m "Build collaborative Kanban board"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

### Deploy using Render

1. Sign in to Render and create a Blueprint using your GitHub repository, or create a Node web service manually.
2. Set build command `npm install && npm run build`, start command `npm start`, and Node version `22.16.0` (or a supported newer Node 22 release).
3. Add a persistent disk mounted at `/var/data`, and set `DB_PATH=/var/data/board.sqlite`. Use one instance. Set `FAILURE_RATE=0` for the normal deployment.
4. Deploy, open the service's HTTPS URL, and perform the manual two-tab checks. Share that URL and your Git repository URL (or the ZIP) in the submission.

Alternatively, deploy the supplied Dockerfile to a host supporting Docker and persistent volumes:

```bash
docker build -t flowboard .
docker run --rm -p 3001:3001 -v flowboard-data:/data flowboard
```

Do not expose real sensitive data on a public unauthenticated demo board.

### Deploy using NPM

The application can be built and run in production mode using npm without Docker.

1. Clone the repository:

   ```bash
   git clone https://github.com/ayan101203/Flowboard.git
   cd Flowboard
   ```

2. Ensure Node.js version 22.16.0 or a compatible newer Node 22 release is installed.

3. Install the dependencies:

   ```bash
   npm install
   ```

4. Build the React and TypeScript frontend:

   ```bash
   npm run build
   ```

5. Start the production server:

   ```bash
   npm start
   ```

6. Open the application in your browser:

   http://localhost:3001

The Node.js backend serves both the frontend and REST API through a
single server. The SQLite database is initialized automatically.

To start the application in development mode instead, use:

```bash
npm run dev
```

The development frontend is available at http://localhost:5173.

To run the automated tests:

```bash
npm test
```

For public deployment using npm, run the production commands on a
Node.js-compatible hosting platform with persistent storage and
configure the required environment variables.

## Project layout

```text
src/             React UI, API client, optimistic state, filtering and CSS
server/          Node HTTP API, SSE, SQLite persistence
scripts/         Local frontend/backend development launcher
tests/           HTTP API, persistence, SSE and client state tests
render.yaml      Deployment configuration
Dockerfile       Container build and persistent storage setup
```

## Coding agents used

OpenAI ChatGPT was used to design, generate and test this implementation. Review the code and update this section if other tools or manual changes are used before submission.
