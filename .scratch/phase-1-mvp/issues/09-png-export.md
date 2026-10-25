# 09: PNG Export

**What to build:** Users can export the current canvas as a PNG image file.

**Blocked by:** 02 (Canvas End-to-End)

**Status:** ready-for-agent

- [ ] Fastify API: `POST /paint/canvas/:id/export` returns PNG blob
- [ ] Backend: Use Fabric.js `canvas.toDataURL('png')` to generate the image
- [ ] Frontend: "Export as PNG" button in the menu bar
- [ ] Frontend: Clicking the button triggers a file download
- [ ] Acceptance: Export a canvas with a drawing, open the downloaded PNG, it matches what was on screen
