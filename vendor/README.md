# vendor

## `kookie-ui-react-0.0.0.tgz`

KookieUI v2 (`@kookie-ui/react`), vendored as a packed tarball because it is **not published**:
version `0.0.0`, 404 on npm, and living in a sibling checkout at `/home/user/kookie-ui-v2`.

### Why a tarball and not a `file:` link to the sibling

A `file:../../../kookie-ui-v2/packages/ui` dependency resolves relative to `packages/kookie-flow`,
so it *demands* that checkout, under that exact directory name, next to this one. A clone without
it fails `pnpm install` at the root — for everybody, including a contributor who only wants to
change the quadtree. A tarball resolves as a real package: the exports map, the types entry and
the stylesheet all work, install needs no sibling, and the bytes are pinned to exactly the build
that was tested.

### Regenerating it

```
cd /path/to/kookie-ui-v2 && pnpm --filter @kookie-ui/react run build
cd packages/ui && npm pack --pack-destination /path/to/kookie-flow/vendor
cd /path/to/kookie-flow && pnpm install
```

The version in the filename is v2's own, so a rebuild at the same version overwrites in place. If
v2 ever bumps, the filename changes and `package.json` has to change with it — which is the point:
a silent update is exactly what vendoring is meant to prevent.

### When this goes away

The day `@kookie-ui/react` publishes. Replace the `file:` specifier with a real semver range and
delete this directory. Until then the peer range is a placeholder and **kookie-flow is not
releasable against v2** — see `plans/migration/decisions.md` D4, which also records the unresolved
CJS question: v2 is ESM-only by deliberate design and kookie-flow currently publishes a CJS entry
point.
