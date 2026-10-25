# 02: Canvas End-to-End

**What to build:** A user can create a new canvas (1920×1080, white background) and see it rendered in the browser. The canvas state is persisted in SQLite and survives page refresh.

**Blocked by:** 01 (Project Scaffold)

**Status:** ready-for-agent

- [ ] SQLite schema for `canvases` table (id, name, width, height, backgroundColor, revision, createdAt, updatedAt)
- [ ] Fastify API: `POST /paint/canvas` creates a new canvas, `GET /paint/canvas/:id` returns a canvas
- [ ] Frontend: "New Canvas" button that calls the API
- [ ] Frontend: Fabric.js renders a 1920×1080 white canvas when a canvas is loaded
- [ ] Frontend: Zustand store manages current canvas state
- [ ] Refreshing the page re-loads the same canvas from the database
