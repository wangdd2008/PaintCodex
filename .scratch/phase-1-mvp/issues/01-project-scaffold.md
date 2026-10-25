# 01: Project Scaffold

**What to build:** Initialize the monorepo with pnpm workspace, TypeScript, and the basic directory structure for both backend and frontend apps.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `pnpm-workspace.yaml` defines `apps/*` and `packages/*` workspaces
- [x] `apps/daemon/` is a working Fastify + TypeScript server (can start with `pnpm dev`)
- [x] `apps/web/` is a working React + Vite + TypeScript app (can start with `pnpm dev`)
- [x] `packages/protocol/` exists with shared TypeScript types (Canvas, Layer, Action interfaces)
- [x] Root `package.json` has common dev scripts (`dev`, `build`, `lint`)
- [x] `apps/web` includes Fabric.js dependency and can render a blank HTML canvas element

## Comments

- 2026-10-25: Implemented in `0e257f4` on `feat/phase-1-mvp`. Verified with `pnpm build`, `pnpm --filter @paintcodex/daemon test`, and a dev-server smoke check (`GET /health` → `{"ok":true}`, Vite `/` → 200). Layer content encoding is fixed in `packages/protocol` as `{ kind: 'fabric' | 'svg', ... }` so brush and AI layers share one contract.
