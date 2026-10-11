# Dependency patches

## uhtml 5.0.9

Repeated callback renders must keep the initialized `Hole` in the render cache.
Upstream replaces it with a new, uninitialized hole after the second render.
The third render can then throw a `Node.insertBefore` type error and leave the
download queue stale even though the engine accepted and saved the job.

The patch retains the initialized hole. The default package export points to
the patched source so Vite and Vitest use the same fix without editing generated
library bundles. Vite still bundles and minifies the source for production.
The source debug flag is disabled to match the upstream production export.

The web workspace pins the patched version. Bun applies the patch on install.
Remove the patch after a verified upstream fix passes this regression test:

```bash
bun --cwd apps/web test test/queue.test.ts
```
