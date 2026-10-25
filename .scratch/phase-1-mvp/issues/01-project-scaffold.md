# 01: Project Scaffold

**What to build:** Initialize the monorepo with pnpm workspace, TypeScript, and the basic directory structure for both backend and frontend apps.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `pnpm-workspace.yaml` defines `apps/*` and `packages/*` workspaces
- [ ] `apps/daemon/` is a working Fastify + TypeScript server (can start with `pnpm dev`)
- [ ] `apps/web/` is a working React + Vite + TypeScript app (can start with `pnpm dev`)
- [ ] `packages/protocol/` exists with shared TypeScript types (Canvas, Layer, Action interfaces)
- [ ] Root `package.json` has common dev scripts (`dev`, `build`, `lint`)
- [ ] `apps/web` includes Fabric.js dependency and can render a blank HTML canvas element
