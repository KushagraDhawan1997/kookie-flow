# Verified findings — the remaining audit items

One file per item. Each was investigated by an agent that read the current source, then put to
three critics with different jobs: does the defect exist, is the proposed fix safe, is the proposed
fix minimal and necessary.

**Nothing was refuted and that is not the interesting part.** All thirteen defects are real. What
the adversarial pass actually bought was corrections to the FIXES — several of which were unsafe or
non-minimal as first written, and two of which rested on a false premise. Read the critics section
before implementing; it is where the value is.

Two items came back already closed (C24, C33), by commits on this branch.

| item | risk | proof | depends on |
|---|---|---|---|
| [C17](C17.md) | high | counts-spike | C15, C16 |
| [C18](C18.md) | medium | pixel | — |
| [C19](C19.md) | medium | counts-spike | C17, C18 |
| [C21](C21.md) | medium | behaviour-browser | — |
| [C22](C22.md) | medium | behaviour-browser | — |
| [C23](C23.md) | medium | behaviour-browser | — |
| [C25](C25.md) | medium | counts-spike | — |
| [C26](C26.md) | medium | unit | — |
| [C28](C28.md) | medium | behaviour-browser | — |
| [C29](C29.md) | medium | behaviour-browser | — |
| [C15](C15.md) | low | counts-spike | — |
| [C27](C27.md) | low | behaviour-browser | — |
| [C30](C30.md) | low | unit | — |
| [C34](C34.md) | medium | counts-spike | — |

## Found while fixing, not by the audit

- **C34** — a theme flip leaks about 16 GL buffers. Found by building C25's law: the same law
  measures 8 material disposals without C25's fix and 88 with it, and the buffer number does not
  move between those two runs, which is what says it is a different defect. Filed with its
  measurement, not fixed — the repair touches the mechanism eaaed92 installed to make a theme
  change reach WebGL at all.

## Already closed

- **C24** — CLOSED for the meshes, by commit eaaed92 "fix(theme): make a theme change reach WebGL, and survive being reached" (touches exactly entity-selection.tsx, nodes.tsx, sockets.tsx, useThemeTokens.ts + the new theme-flip.mjs). All three named files replaced the buffer-init effect with a CALLBACK REF, so 
- **C33** — GONE. Closed by commit 2e65c87 "fix(gl): clamp the corner radius so a large radius cannot erase the shape" (Kushagra Dhawan, 2026-09-09 01:11:59), which touched exactly the two files the audit names plus the harness fixture: `entity-selection.tsx | 14 ++`, `nodes.tsx | 7 ++`, `harness/fixture/app.ts
