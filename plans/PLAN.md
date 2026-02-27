# Kookie Flow — Implementation Plan

> Open Canvas with Native Node Abilities. Figma-like freeform canvas merged with a native graph engine. GPU-rendered for performance at scale.

This document is the orchestrator. Detailed plans live in sub-files linked below.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                    <KookieFlow>                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ DOM Layer (pointer-events: none except on widgets)    │  │
│  │  [Node Labels] [Socket Labels] [Widgets] [Portals]   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ WebGL Canvas (R3F)                                    │  │
│  │  Grid · Nodes · Sockets · Edges · SelectionBox       │  │
│  │  TextEntities · ImageEntities · ConnectionLine        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    Zustand Store                            │
│  entities[], edges[], viewport, selection, connectionState  │
└─────────────────────────────────────────────────────────────┘
```

**Coordinate system:** Y-down (matches DOM), orthographic camera, `screenPos = (worldPos + viewport.offset) * viewport.zoom`

---

## Sub-Plans

| Document | What it covers |
|---|---|
| [Architecture](./architecture.md) | Problem statement, rendering strategy, component breakdown, file structure |
| [Entity Model](./entity-model.md) | Entity primitive, socket rows, preview system concept, built-in types |
| [API](./api.md) | `KookieFlowProps`, node type definitions, socket types, imperative API |
| [Phases: Completed](./phases-completed.md) | Phases 1–9.5 (all complete, condensed summaries) |
| [Phase: Text Entity](./phase-text-entity.md) | Phase 10 — MSDF rendering, hidden textarea editing, sizing modes |
| [Phase: Data Flow](./phase-data-flow.md) | Phase 8.5 — Reactive evaluation, socket values, dirty tracking |
| [Phases: Upcoming](./phases-upcoming.md) | Phases 11–17 — Image, 3D Mesh, Video, Draw, Preview, Customization, Polish |
| [Technical Decisions](./technical-decisions.md) | R3F vs alternatives, Zustand, MSDF text, coordinate system, plugin design |
| [Toolbar](./TOOLBAR_PLAN.md) | Floating toolbar — positioning, widgets, API, layered customization |

---

## Phase Status

| Phase | Name | Status |
|---|---|---|
| 1 | Core Renderer | ✅ Complete |
| 2 | Camera Controls | ✅ Complete |
| 3 | Selection | ✅ Complete |
| 3.5 | Performance Foundations | ✅ Complete |
| 4 | Node Dragging | ✅ Complete |
| 4.5 | Edge Curves | ✅ Complete |
| 5 | Edge Connections | ✅ Complete |
| 5.5 | Connection Validation & Edge Selection | ✅ Complete |
| 6 | Core Operations & Event Plugins | ✅ Complete |
| 7A | Edge Enhancements | ✅ Complete |
| 7.5 | WebGL Text Rendering (MSDF) | ✅ Complete |
| 7B | Minimap | ✅ Complete |
| 7C | Grouping & Annotations | ✅ Complete |
| 7D | Socket Widgets | ✅ Complete |
| 7E | Connection Events | ✅ Complete |
| 8 | Graph Engine | ✅ Complete |
| 8.5 | Data Flow & Evaluation | Planned |
| 9 | Entity Model Refactor | ✅ Complete |
| 9.5 | Selection Box + Resize Handles | ✅ Complete |
| 10 | Text Entity | ✅ Complete |
| 11 | Image Entity | In Progress |
| 12 | 3D Mesh Entity | Planned |
| 13 | Video Entity | Planned |
| 14 | Draw Entity | Planned |
| 15 | Preview System | Planned |
| 16 | Entity Type Customization | Planned |
| 17 | Polish & Production | Planned |

---

## Next Immediate Tasks

1. **Phase 11: Image Entity** — paste from clipboard, resize with aspect ratio lock
2. **Phase 8.5: Data Flow** — reactive evaluation plumbing, socket values store

---

_Last updated: February 2026_
