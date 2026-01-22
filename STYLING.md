# Kookie Flow — Styling & Theme Integration Plan

> Integrate with Kookie UI's design system for consistent, polished node styling.

---

## Goals

1. **Kookie UI integration** — Use the same tokens (spacing, colors, radius, shadows)
2. **Prop-based API** — `size`, `variant`, `radius` like Card component
3. **WebGL rendering** — Convert CSS vars to shader uniforms
4. **Consistent ecosystem** — A `size="2"` node feels proportional to `size="2"` Button inside it

---

## Simplifications (WebGL vs CSS)

Some Kookie UI features are simplified for WebGL rendering:

| Feature | Kookie UI (CSS) | Kookie Flow (WebGL) |
|---------|-----------------|---------------------|
| Shadows | Multi-layer box-shadow with CSS vars | Single drop shadow (blur + offset) |
| Translucent material | backdrop-filter blur | Not supported v1 (requires render-to-texture) |
| Hover transitions | CSS transition | Instant (could add shader interpolation later) |
| Border | box-shadow inset or ::after | SDF stroke |

These simplifications look visually similar but aren't pixel-perfect matches.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's App                                   │
├─────────────────────────────────────────────────────────────────────┤
│  <Theme accentColor="indigo" grayColor="slate" radius="medium">     │
│                                                                      │
│    <KookieFlow                                                       │
│      size="2"                                                        │
│      variant="surface"                                               │
│      nodes={nodes}                                                   │
│      edges={edges}                                                   │
│    />                                                                │
│                                                                      │
│  </Theme>                                                            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    useThemeTokens() Hook                             │
├─────────────────────────────────────────────────────────────────────┤
│  1. Read CSS vars from :root / .radix-themes                        │
│  2. Parse into flat token map keyed by CSS var name                 │
│  3. Convert colors to RGB arrays for WebGL                          │
│  4. Read once on mount (no runtime theme changes)                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    resolveNodeStyle()                                │
├─────────────────────────────────────────────────────────────────────┤
│  Input: size="2", variant="surface", tokens                         │
│  Output: {                                                           │
│    padding: 12,           // from --space-3                         │
│    borderRadius: 10,      // from --radius-6                        │
│    background: [0.98, 0.98, 0.98],  // from --gray-1                │
│    borderColor: [0.85, 0.85, 0.85], // from --gray-6                │
│    borderWidth: 1,                                                   │
│    shadowBlur: 0,                                                    │
│    shadowColor: [0, 0, 0, 0],                                       │
│    headerHeight: 28,                                                 │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WebGL Shaders                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Uniforms:                                                           │
│    u_borderRadius: float                                             │
│    u_borderWidth: float                                              │
│    u_borderColor: vec3                                               │
│    u_backgroundColor: vec3                                           │
│    u_shadowBlur: float                                               │
│    u_shadowColor: vec4                                               │
│    u_shadowOffset: vec2                                              │
│                                                                      │
│  Per-instance attributes (for per-node overrides):                  │
│    a_selected: float (0 or 1)                                       │
│    a_hovered: float (0 or 1)                                        │
│    a_headerColor: vec3 (node-type accent)                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Performance Budget

All styling operations must stay within these limits to maintain 60fps with 10k+ nodes:

| Operation | Budget | Frequency |
|-----------|--------|-----------|
| `useThemeTokens()` DOM read | <1ms | Once on mount |
| `resolveNodeStyle()` | <0.1ms | Once per render, memoized |
| Hover attribute update | O(1), 2 indices max | On mouse move |
| Selection attribute update | O(n) where n = changed | On selection change |
| Shader uniform update | <0.01ms | On style prop change only |

**Critical constraints:**
- Token reading must NOT happen during pan/zoom/drag
- `resolveNodeStyle()` result must be memoized—never called in render loop
- Hover updates must modify exactly 2 buffer indices (prev + current), not iterate all nodes
- No object allocations in hot paths (pre-allocate Float32Arrays, reuse Vector3 instances)

---

## Phase 1: Dependency & Token Reading

### 1.1 Add Kookie UI as peerDependency

**File:** `packages/kookie-flow/package.json`

```json
{
  "peerDependencies": {
    "@kushagradhawan/kookie-ui": ">=0.1.147",
    "@react-three/drei": ">=10.0.0",
    "@react-three/fiber": ">=9.0.0",
    "react": ">=19.0.0",
    "react-dom": ">=19.0.0",
    "three": ">=0.170.0"
  },
  "devDependencies": {
    "@kushagradhawan/kookie-ui": "^0.1.147",
    // ... existing
  }
}
```

### 1.2 Create useThemeTokens() Hook

**File:** `src/hooks/useThemeTokens.ts`

Reads CSS variables from the DOM and returns a flat map keyed by CSS variable names.

```typescript
// Flat map using actual CSS variable names as keys
interface ThemeTokens {
  // Spacing (resolved to pixels)
  '--space-1': number;  // 4px × scaling
  '--space-2': number;  // 8px × scaling
  '--space-3': number;  // 12px × scaling
  '--space-4': number;  // 16px × scaling
  '--space-5': number;  // 24px × scaling
  '--space-6': number;  // 32px × scaling

  // Radius (resolved to pixels) - actual Kookie UI values:
  // --radius-1: 6px, --radius-2: 8px, --radius-3: 10px
  // --radius-4: 12px, --radius-5: 16px, --radius-6: 20px
  // (all multiplied by --scaling and --radius-factor)
  '--radius-1': number;
  '--radius-2': number;
  '--radius-3': number;
  '--radius-4': number;
  '--radius-5': number;
  '--radius-6': number;
  '--radius-full': number;  // 9999px

  // Typography - Font sizes (resolved to pixels)
  // Used for node labels and widget sizing alignment
  '--font-size-1': number;  // 12px × scaling
  '--font-size-2': number;  // 14px × scaling
  '--font-size-3': number;  // 16px × scaling
  '--font-size-4': number;  // 18px × scaling
  '--font-size-5': number;  // 20px × scaling

  // Typography - Line heights (resolved to pixels)
  // Used for header heights to match text vertical rhythm
  '--line-height-1': number;  // 16px × scaling
  '--line-height-2': number;  // 20px × scaling
  '--line-height-3': number;  // 24px × scaling
  '--line-height-4': number;  // 26px × scaling
  '--line-height-5': number;  // 28px × scaling

  // Gray scale (as RGB arrays [0-1] for WebGL)
  '--gray-1': RGBColor;   // lightest
  '--gray-2': RGBColor;
  '--gray-3': RGBColor;
  '--gray-4': RGBColor;
  '--gray-5': RGBColor;
  '--gray-6': RGBColor;   // borders
  '--gray-7': RGBColor;
  '--gray-8': RGBColor;
  '--gray-9': RGBColor;
  '--gray-10': RGBColor;
  '--gray-11': RGBColor;
  '--gray-12': RGBColor;  // darkest

  // Gray alpha variants
  '--gray-a1': RGBAColor;
  '--gray-a2': RGBAColor;
  '--gray-a3': RGBAColor;
  // ... etc

  // Accent colors (from Theme's accentColor prop)
  '--accent-1': RGBColor;
  '--accent-2': RGBColor;
  // ... through --accent-12
  '--accent-9': RGBColor;   // primary accent
  '--accent-a3': RGBAColor; // for subtle backgrounds

  // Radix color palette (for socket types)
  // Blue
  '--blue-1': RGBColor;
  '--blue-9': RGBColor;   // primary blue
  '--blue-11': RGBColor;  // text on blue bg
  // Purple
  '--purple-1': RGBColor;
  '--purple-9': RGBColor;
  // Green
  '--green-9': RGBColor;
  // Red
  '--red-9': RGBColor;
  // Amber
  '--amber-9': RGBColor;
  // Cyan
  '--cyan-9': RGBColor;
  // ... other Radix colors as needed

  // Surfaces
  '--color-surface-solid': RGBColor;
  '--color-surface-translucent': RGBAColor;

  // Shadows (SIMPLIFIED for WebGL)
  // Kookie UI shadows are complex multi-layer CSS:
  //   --shadow-2: 0 0 0 0.5px var(--gray-a6), 0 1px 3px 0 var(--black-a3), ...
  // We simplify to single drop shadow for WebGL. Good enough visually.
  '--shadow-1': SimpleShadow;
  '--shadow-2': SimpleShadow;
  '--shadow-3': SimpleShadow;
  '--shadow-4': SimpleShadow;
  '--shadow-5': SimpleShadow;
  '--shadow-6': SimpleShadow;

  // Meta
  '--scaling': number;  // 0.9 - 1.1
  appearance: 'light' | 'dark';
}

type RGBColor = [number, number, number];       // [0-1, 0-1, 0-1]
type RGBAColor = [number, number, number, number]; // [0-1, 0-1, 0-1, 0-1]

// Simplified shadow for WebGL (single drop shadow, not multi-layer CSS)
interface SimpleShadow {
  offsetY: number;  // Vertical offset in pixels
  blur: number;     // Blur radius in pixels
  opacity: number;  // 0-1, applied to black
}
```

**Implementation approach:**

1. On mount, find the `.radix-themes` element (or `:root`)
2. Use `getComputedStyle()` to read CSS variables
3. Parse color strings (`#fcfcfc`, `rgb(...)`) to RGB arrays
4. Parse shadow strings to structured values
5. Provide fallback values if Kookie UI is not present
6. No runtime theme change support — tokens read once on mount

```typescript
function useThemeTokens(): ThemeTokens {
  // Read tokens once on mount — no runtime theme change support
  const [tokens] = useState<ThemeTokens>(() => {
    // SSR safety check
    if (typeof document === 'undefined') return FALLBACK_TOKENS;

    const root = document.querySelector('.radix-themes') ?? document.documentElement;
    const styles = getComputedStyle(root);

    // Check if Kookie UI is present
    const hasKookieUI = styles.getPropertyValue('--space-1').trim() !== '';
    if (!hasKookieUI) return FALLBACK_TOKENS;

    return {
      // Spacing
      '--space-1': parsePx(styles.getPropertyValue('--space-1')),
      '--space-2': parsePx(styles.getPropertyValue('--space-2')),
      '--space-3': parsePx(styles.getPropertyValue('--space-3')),
      // ...

      // Typography - Font sizes
      '--font-size-1': parsePx(styles.getPropertyValue('--font-size-1')),
      '--font-size-2': parsePx(styles.getPropertyValue('--font-size-2')),
      '--font-size-3': parsePx(styles.getPropertyValue('--font-size-3')),
      '--font-size-4': parsePx(styles.getPropertyValue('--font-size-4')),
      '--font-size-5': parsePx(styles.getPropertyValue('--font-size-5')),

      // Typography - Line heights
      '--line-height-1': parsePx(styles.getPropertyValue('--line-height-1')),
      '--line-height-2': parsePx(styles.getPropertyValue('--line-height-2')),
      '--line-height-3': parsePx(styles.getPropertyValue('--line-height-3')),
      '--line-height-4': parsePx(styles.getPropertyValue('--line-height-4')),
      '--line-height-5': parsePx(styles.getPropertyValue('--line-height-5')),

      // Colors
      '--gray-1': parseColorToRGB(styles.getPropertyValue('--gray-1')),
      '--gray-2': parseColorToRGB(styles.getPropertyValue('--gray-2')),
      // ...

      // Radix colors for sockets
      '--blue-9': parseColorToRGB(styles.getPropertyValue('--blue-9')),
      '--purple-9': parseColorToRGB(styles.getPropertyValue('--purple-9')),
      '--green-9': parseColorToRGB(styles.getPropertyValue('--green-9')),
      // ...
    };
  });

  return tokens;
}
```

### 1.3 Fallback Tokens (Standalone Mode)

If Kookie UI's Theme is not detected, use sensible dark-mode defaults:

```typescript
const FALLBACK_TOKENS: ThemeTokens = {
  // Spacing (assuming scaling = 1)
  '--space-1': 4,
  '--space-2': 8,
  '--space-3': 12,
  '--space-4': 16,
  '--space-5': 24,
  '--space-6': 32,

  // Radius (actual Kookie UI values at scaling=1, radius-factor=1)
  '--radius-1': 6,
  '--radius-2': 8,
  '--radius-3': 10,
  '--radius-4': 12,
  '--radius-5': 16,
  '--radius-6': 20,
  '--radius-full': 9999,

  // Typography - Font sizes (assuming scaling = 1)
  '--font-size-1': 12,
  '--font-size-2': 14,
  '--font-size-3': 16,
  '--font-size-4': 18,
  '--font-size-5': 20,

  // Typography - Line heights (assuming scaling = 1)
  '--line-height-1': 16,
  '--line-height-2': 20,
  '--line-height-3': 24,
  '--line-height-4': 26,
  '--line-height-5': 28,

  // Gray (dark mode defaults)
  '--gray-1': [0.067, 0.067, 0.067],   // #111111
  '--gray-2': [0.098, 0.098, 0.098],   // #191919
  '--gray-3': [0.133, 0.133, 0.133],   // #222222
  '--gray-4': [0.165, 0.165, 0.165],   // #2a2a2a
  '--gray-5': [0.196, 0.196, 0.196],   // #323232
  '--gray-6': [0.239, 0.239, 0.239],   // #3d3d3d
  '--gray-7': [0.306, 0.306, 0.306],   // #4e4e4e
  '--gray-8': [0.392, 0.392, 0.392],   // #646464
  '--gray-9': [0.553, 0.553, 0.553],   // #8d8d8d
  '--gray-10': [0.627, 0.627, 0.627],  // #a0a0a0
  '--gray-11': [0.737, 0.737, 0.737],  // #bcbcbc
  '--gray-12': [0.933, 0.933, 0.933],  // #eeeeee

  // Accent (indigo defaults)
  '--accent-9': [0.392, 0.404, 0.961], // #6366f5 (indigo-9)

  // Radix colors for sockets
  '--blue-9': [0.0, 0.565, 1.0],       // #0090ff
  '--purple-9': [0.557, 0.341, 0.969], // #8e57f7
  '--green-9': [0.180, 0.710, 0.486],  // #2eb77c
  '--red-9': [0.906, 0.318, 0.365],    // #e7515d
  '--amber-9': [1.0, 0.773, 0.239],    // #ffc53d
  '--cyan-9': [0.0, 0.647, 0.773],     // #00a5c5

  // Surfaces
  '--color-surface-solid': [0.098, 0.098, 0.098],

  // Shadows (simplified approximations of CSS multi-layer shadows)
  '--shadow-1': { offsetY: 1, blur: 2, opacity: 0.1 },
  '--shadow-2': { offsetY: 2, blur: 4, opacity: 0.15 },
  '--shadow-3': { offsetY: 4, blur: 8, opacity: 0.2 },
  '--shadow-4': { offsetY: 6, blur: 12, opacity: 0.25 },
  '--shadow-5': { offsetY: 8, blur: 16, opacity: 0.3 },
  '--shadow-6': { offsetY: 12, blur: 24, opacity: 0.35 },

  // Meta
  '--scaling': 1,
  appearance: 'dark',
};
```

### 1.4 ThemeContext Provider

Provide tokens via React context to avoid duplicate DOM reads and ensure single source of truth:

```typescript
// File: src/contexts/ThemeContext.tsx

const ThemeContext = createContext<ThemeTokens>(FALLBACK_TOKENS);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const tokens = useThemeTokens();
  return (
    <ThemeContext.Provider value={tokens}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
```

**Usage in KookieFlow:**

```typescript
// File: src/KookieFlow.tsx

export function KookieFlow(props: KookieFlowProps) {
  return (
    <ThemeProvider>
      <KookieFlowInner {...props} />
    </ThemeProvider>
  );
}

// Child components use useTheme() instead of useThemeTokens()
function Nodes() {
  const tokens = useTheme(); // Reads from context, no DOM access
  // ...
}
```

This ensures:
- Single DOM read on mount (in ThemeProvider)
- All components share the same token reference
- No risk of components reading stale/different values

---

## Phase 2: Props API

### 2.1 KookieFlow Props

**File:** `src/types/index.ts`

```typescript
type Size = '1' | '2' | '3' | '4' | '5';
type Variant = 'surface' | 'outline' | 'soft' | 'classic' | 'ghost';
type Radius = 'none' | 'small' | 'medium' | 'large' | 'full';

// 26 Kookie UI accent colors
type AccentColor =
  | 'gray' | 'gold' | 'bronze' | 'brown'
  | 'yellow' | 'amber' | 'orange' | 'tomato'
  | 'red' | 'ruby' | 'crimson' | 'pink'
  | 'plum' | 'purple' | 'violet' | 'iris'
  | 'indigo' | 'blue' | 'cyan' | 'teal'
  | 'jade' | 'green' | 'grass' | 'lime'
  | 'mint' | 'sky';

interface KookieFlowProps {
  // ... existing props (nodes, edges, etc.)

  // Styling props (match Kookie UI Card)
  size?: Size;           // Default: '2'
  variant?: Variant;     // Default: 'surface'
  radius?: Radius;       // Default: inherits from Theme, or 'medium'

  // Header configuration
  header?: 'none' | 'inside' | 'outside';  // Default: 'none'
  accentHeader?: boolean;                   // Default: false — tint header with accent color

  // Optional fine-grained overrides
  nodeStyle?: Partial<NodeStyleOverrides>;
}

interface NodeStyleOverrides {
  // These override the variant defaults
  background?: string;      // CSS color, converted to RGB
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;    // Direct pixel value (overrides radius prop)
  shadow?: '1' | '2' | '3' | '4' | '5' | '6' | 'none';
}

// Per-node data can include color override
interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  // ... other fields

  // Per-node color (matches Kookie UI accent colors)
  color?: AccentColor;
}
```

### 2.2 Size Scale Mapping

**Decision: Fixed to size 2 for socket/widget layout**

While SIZE_MAP supports sizes 1-5 for node styling (padding, border radius, font), socket rows and header height (inside) are fixed at 40px (`--space-7`) to provide breathing room around 32px widgets.

```typescript
const SIZE_MAP = {
  '2': {
    padding: '--space-3',       // 12px
    borderRadius: '--radius-4', // 12px
    fontSize: '--font-size-2',  // 14px
    socketSize: 10,
  },
  // Other sizes available for future use, but socket layout locked to size 2
};

// Fixed layout values (not in SIZE_MAP)
const ROW_HEIGHT = '--space-7';  // 40px - header (inside) and socket rows
const WIDGET_HEIGHT = '--space-6';  // 32px - Button/Slider/Select at size 2
// Implicit vertical padding: 4px above + 4px below widget
```

**Why token-based sizing matters:**

Using Kookie UI tokens ensures:
1. Node labels at size '2' match Kookie UI `<Text size="2">`
2. Widgets (Slider, Select, etc.) at size '2' (32px) fit within 40px rows with breathing room
3. The `--scaling` CSS variable affects everything uniformly
4. Header (inside) and socket rows share the same 40px height

### 2.2.1 Socket Layout Tokenization

Socket positioning must use tokens to ensure proper alignment with Kookie UI widgets.

**Current state** (`constants.ts` hardcoded values):

```typescript
export const SOCKET_RADIUS = 6;
export const SOCKET_SPACING = 24;  // Row height between sockets
export const SOCKET_MARGIN_TOP = 30;  // Offset from top of node
```

**Decision: Fixed to size 2, vertical stack layout**

All rows (header, outputs, inputs) use `--space-7` (40px) height, with 32px widgets centered vertically.

**Layout order**: Header (if inside) → Output rows → Input rows

```
Header position: "inside"
┌─────────────────────────────────────────────────┐
│  [Node Title]                          (accent) │  40px header row
├─────────────────────────────────────────────────┤
│                              [Output Label] [●] │  40px output row (right-aligned)
│                              [Output Label] [●] │  40px output row
├─────────────────────────────────────────────────┤
│  [●] [Input Label] [═══32px Widget═══]          │  40px input row (left-aligned)
│  [●] [Input Label] [═══32px Widget═══]          │  40px input row
└─────────────────────────────────────────────────┘

Header position: "none"
┌─────────────────────────────────────────────────┐
│                              [Output Label] [●] │  40px output row
├─────────────────────────────────────────────────┤
│  [●] [Input Label] [═══32px Widget═══]          │  40px input row
│  [●] [Input Label] [═══32px Widget═══]          │
└─────────────────────────────────────────────────┘

Header position: "outside"
     [Node Title]                                    ← floats above, separate
┌─────────────────────────────────────────────────┐
│                              [Output Label] [●] │  40px output row
├─────────────────────────────────────────────────┤
│  [●] [Input Label] [═══32px Widget═══]          │  40px input row
└─────────────────────────────────────────────────┘
```

**Row types:**
- **Output rows**: Socket on right edge, label right-aligned, no widget
- **Input rows**: Socket on left edge, label left-aligned, widget fills remaining width

**Row height token: `--space-7` (40px)**

Both header (inside) and socket rows use the same height token.

**Widget height: `--space-6` (32px)**

From Kookie UI `base-button.css`:
```css
&:where(.rt-r-size-2) {
  --base-button-height: var(--space-6);  /* 32px at 100% scaling */
}
```

Widgets are vertically centered in 40px rows, creating 4px padding above and below.

Both tokens scale with `--scaling`: `calc(Npx * var(--scaling))`

**Solution: Add socket layout constants using tokens**

```typescript
// In constants.ts - replace hardcoded values
export const SOCKET_ROW_HEIGHT = '--space-7';  // 40px - row height with breathing room
export const WIDGET_HEIGHT = '--space-6';  // 32px - Button/Slider/Select at size 2
export const SOCKET_RADIUS = 6;  // Keep as-is (visual, not layout)

// Socket margin from top is derived at runtime:
// marginTop = padding (if no header) OR rowHeight + padding (if header inside)
```

**Architecture change:**

The `getSocketPosition()` function in `geometry.ts` needs resolved layout values:

```typescript
interface ResolvedSocketLayout {
  rowHeight: number;     // Resolved from --space-7 (40px)
  widgetHeight: number;  // Resolved from --space-6 (32px)
  marginTop: number;     // Derived from padding (+ rowHeight if header inside)
  socketSize: number;    // From SIZE_MAP (10 for size 2)
}

function getSocketPosition(
  node: Node,
  socketId: string,
  isInput: boolean,
  layout: ResolvedSocketLayout
): XYPosition | null {
  // Find socket index within its array (inputs or outputs)
  const sockets = isInput ? node.inputs : node.outputs;
  const index = sockets?.findIndex(s => s.id === socketId) ?? -1;
  if (index === -1) return null;

  // Outputs come first, then inputs
  const outputCount = node.outputs?.length ?? 0;
  const rowIndex = isInput ? outputCount + index : index;

  // Y position: marginTop + rowIndex * rowHeight + rowHeight/2 (center of row)
  const y = layout.marginTop + rowIndex * layout.rowHeight + layout.rowHeight / 2;

  // X position: left edge for inputs, right edge for outputs
  const x = isInput ? 0 : node.width;

  return { x: node.position.x + x, y: node.position.y + y };
}
```

**Impact on other systems:**

1. **Edge rendering** (`edges.tsx`) - Uses `getSocketPosition()` for endpoint calculation
2. **Hit testing** (`geometry.ts`) - Uses socket positions for click detection
3. **Connection line** (`connection-line.tsx`) - Uses socket positions during drag
4. **DOM widgets** (Phase 7D) - Need socket positions for widget placement

All need access to resolved layout values via context or props.

**Widget alignment guarantee:**

With row height = `--space-7` (40px) and widget height = `--space-6` (32px):
- Button size 2: 32px height, 4px padding above/below
- Slider size 2: 32px height, centered in row
- Select size 2: 32px height, centered in row
- All scale uniformly with `--scaling`
- Visual breathing room between consecutive widgets

### 2.3 Variant Definitions

Match Kookie UI Card variants (using actual CSS var names):

```typescript
const VARIANT_MAP = {
  surface: {
    background: '--gray-1',
    backgroundHover: '--gray-2',
    borderColor: '--gray-6',
    borderColorHover: '--gray-7',
    borderWidth: 1,
    shadow: 'none',
  },
  outline: {
    background: 'transparent',
    backgroundHover: '--gray-2',
    borderColor: '--gray-6',
    borderColorHover: '--gray-7',
    borderWidth: 1,
    shadow: 'none',
  },
  soft: {
    background: '--gray-2',
    backgroundHover: '--gray-3',
    borderColor: 'transparent',
    borderWidth: 0,
    shadow: 'none',
  },
  classic: {
    background: '--color-surface-solid',
    backgroundHover: '--gray-2',
    borderColor: 'transparent',
    borderWidth: 0,
    shadow: '--shadow-2',
  },
  ghost: {
    background: 'transparent',
    backgroundHover: '--gray-3',
    borderColor: 'transparent',
    borderWidth: 0,
    shadow: 'none',
  },
};
```

### 2.4 Radius Prop Mapping

```typescript
const RADIUS_MAP = {
  none: 0,
  small: '--radius-2',   // 8px
  medium: '--radius-4',  // 12px
  large: '--radius-6',   // 20px
  full: '--radius-full', // 9999px (pill shape)
};
```

**Note:** When `radius` prop is set, it overrides the size-based radius. This allows `<KookieFlow size="2" radius="full" />` for pill-shaped nodes.

---

## Phase 3: Socket Type Colors (Radix Colors)

### 3.1 Socket Types with Theme Colors

Socket colors can reference Radix color tokens from Kookie UI:

```typescript
// User defines socket types using CSS var names
const socketTypes = {
  float: {
    color: '--blue-9',        // Resolved from theme
    label: 'Float',
  },
  int: {
    color: '--blue-9',
    label: 'Integer',
  },
  string: {
    color: '--green-9',
    label: 'String',
  },
  boolean: {
    color: '--red-9',
    label: 'Boolean',
  },
  image: {
    color: '--purple-9',
    label: 'Image',
  },
  mask: {
    color: '--gray-9',
    label: 'Mask',
  },
  any: {
    color: '--gray-7',
    label: 'Any',
    compatibleWith: '*',
  },
  vector: {
    color: '--cyan-9',
    label: 'Vector',
  },
  color: {
    color: '--amber-9',
    label: 'Color',
  },
};
```

### 3.2 Resolving Socket Colors

```typescript
function resolveSocketColor(
  socketType: SocketTypeConfig,
  tokens: ThemeTokens
): RGBColor {
  const colorRef = socketType.color;

  // If it's a CSS var reference, resolve from tokens
  if (colorRef.startsWith('--')) {
    return tokens[colorRef] ?? FALLBACK_SOCKET_COLOR;
  }

  // Otherwise, parse as direct color value (hex, rgb, etc.)
  return parseColorToRGB(colorRef);
}
```

### 3.3 Available Radix Colors

Full palette available from Kookie UI Theme:

| Color | Var Name | Typical Use |
|-------|----------|-------------|
| Blue | `--blue-9` | Numbers, floats, ints |
| Purple | `--purple-9` | Images, textures |
| Green | `--green-9` | Strings, text |
| Red | `--red-9` | Booleans, errors |
| Amber | `--amber-9` | Colors, warnings |
| Cyan | `--cyan-9` | Vectors, coordinates |
| Pink | `--pink-9` | Custom types |
| Teal | `--teal-9` | Custom types |
| Orange | `--orange-9` | Custom types |
| Gray | `--gray-9` | Any/wildcard |

All colors have scales 1-12 (light to dark) and alpha variants (a1-a12).

---

## Phase 4: Style Resolution

### 4.1 resolveNodeStyle() Function

**File:** `src/utils/style-resolver.ts`

```typescript
interface ResolvedNodeStyle {
  // Layout
  padding: number;
  headerHeight: number;

  // Border
  borderRadius: number;
  borderWidth: number;
  borderColor: RGBColor;

  // Background
  background: RGBColor;
  backgroundHover: RGBColor;

  // Shadow (simplified, for classic variant)
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;  // Applied to black

  // Selection state colors
  selectedBorderColor: RGBColor;

  // Text
  fontSize: number;

  // Sockets
  socketSize: number;
}

function resolveNodeStyle(
  size: Size,
  variant: Variant,
  radius: Radius | undefined,
  tokens: ThemeTokens,
  overrides?: Partial<NodeStyleOverrides>
): ResolvedNodeStyle {
  const sizeConfig = SIZE_MAP[size];
  const variantConfig = VARIANT_MAP[variant];

  // Resolve token references to actual values
  const padding = tokens[sizeConfig.padding];
  const borderRadius = radius
    ? (typeof RADIUS_MAP[radius] === 'number'
        ? RADIUS_MAP[radius]
        : tokens[RADIUS_MAP[radius]])
    : tokens[sizeConfig.borderRadius];

  // Resolve colors
  const background = variantConfig.background === 'transparent'
    ? [0, 0, 0] as RGBColor  // Handled specially in shader
    : tokens[variantConfig.background];

  const backgroundHover = tokens[variantConfig.backgroundHover];

  const borderColor = variantConfig.borderColor === 'transparent'
    ? [0, 0, 0] as RGBColor
    : tokens[variantConfig.borderColor];

  // Shadow (only for classic variant, simplified)
  let shadowBlur = 0;
  let shadowOffsetY = 0;
  let shadowOpacity = 0;

  if (variantConfig.shadow !== 'none') {
    const shadow = tokens[variantConfig.shadow]; // SimpleShadow
    shadowBlur = shadow.blur;
    shadowOffsetY = shadow.offsetY;
    shadowOpacity = shadow.opacity;
  }

  // Selection uses accent color
  const selectedBorderColor = tokens['--accent-9'];

  // Apply overrides
  return {
    padding: overrides?.padding ?? padding,
    headerHeight: overrides?.headerHeight ?? sizeConfig.headerHeight,
    borderRadius: overrides?.borderRadius ?? borderRadius,
    borderWidth: overrides?.borderWidth ?? variantConfig.borderWidth,
    borderColor: overrides?.borderColor
      ? parseColorToRGB(overrides.borderColor)
      : borderColor,
    background: overrides?.background
      ? parseColorToRGB(overrides.background)
      : background,
    backgroundHover,
    shadowBlur,
    shadowOffsetY,
    shadowOpacity,
    selectedBorderColor,
    fontSize: sizeConfig.fontSize,
    socketSize: sizeConfig.socketSize,
  };
}
```

**IMPORTANT: Memoization Required**

`resolveNodeStyle()` returns a new object every call. Always memoize the result:

```typescript
// ✅ CORRECT: Memoized, stable reference
const resolvedStyle = useMemo(
  () => resolveNodeStyle(size, variant, radius, tokens, overrides),
  [size, variant, radius, tokens, overrides]
);

// ❌ WRONG: Creates new object every render, breaks downstream memoization
const resolvedStyle = resolveNodeStyle(size, variant, radius, tokens, overrides);
```

For shader uniforms, also avoid creating new Vector3 instances on every style change:

```typescript
// ✅ CORRECT: Reuse Vector3 instances, update in place
const uniformsRef = useRef({
  u_borderColor: { value: new THREE.Vector3() },
  u_backgroundColor: { value: new THREE.Vector3() },
  // ...
});

useEffect(() => {
  uniformsRef.current.u_borderColor.value.set(...resolvedStyle.borderColor);
  uniformsRef.current.u_backgroundColor.value.set(...resolvedStyle.background);
  // Mark material for update if needed
}, [resolvedStyle]);
```

### 4.2 Color Parsing Utilities

**File:** `src/utils/color.ts`

```typescript
type RGBColor = [number, number, number];
type RGBAColor = [number, number, number, number];

// Parse CSS color string to RGB array [0-1]
function parseColorToRGB(color: string): RGBColor {
  // Handle hex: #fff, #ffffff
  if (color.startsWith('#')) {
    return hexToRGB(color);
  }

  // Handle rgb()/rgba()
  if (color.startsWith('rgb')) {
    return parseRGBString(color);
  }

  // Handle 'transparent'
  if (color === 'transparent') {
    return [0, 0, 0];
  }

  // Fallback
  console.warn(`Unknown color format: ${color}`);
  return [0.5, 0.5, 0.5];
}

function hexToRGB(hex: string): RGBColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex
  );
  return result
    ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      ]
    : [0, 0, 0];
}

function parsePx(value: string): number {
  // Handle "12px", "calc(12px * var(--scaling))", etc.
  // getComputedStyle returns resolved values, so usually just "12px"
  return parseFloat(value) || 0;
}
```

---

## Phase 5: Shader Updates

### Coordinate System Note

Kookie Flow uses Y-down world space (matching DOM), but WebGL's Y-axis points up. The vertex shader must flip Y when converting world → clip coordinates:

```glsl
// Vertex shader: flip Y for WebGL
vec4 worldPos = vec4(position.xy, 0.0, 1.0);
worldPos.y = -worldPos.y; // Y-down world → Y-up GL
gl_Position = projectionMatrix * viewMatrix * worldPos;
```

Shadow offsets in this plan use positive Y = downward (world space). The shader handles the flip internally.

### 5.1 Node Shader Uniforms

**File:** `src/components/Nodes.tsx` (shader section)

Current shader uses hardcoded colors. Update to use uniforms:

```glsl
// Fragment shader uniforms
uniform float u_borderRadius;
uniform float u_borderWidth;
uniform vec3 u_borderColor;
uniform vec3 u_backgroundColor;
uniform vec3 u_backgroundHoverColor;
uniform vec3 u_selectedBorderColor;
uniform float u_backgroundAlpha;       // 0 for transparent variants

// Shadow uniforms (simplified, for classic variant)
uniform float u_shadowBlur;
uniform float u_shadowOffsetY;
uniform float u_shadowOpacity;  // Applied to black

// Header
uniform float u_headerHeight;

// Per-instance attributes
attribute float a_selected;
attribute float a_hovered;
attribute vec3 a_headerColor;  // Per-node-type accent color

varying float v_selected;
varying float v_hovered;
varying vec3 v_headerColor;

void main() {
  // ... existing SDF logic for rounded rectangle

  // Shadow (simplified drop shadow, for classic variant)
  vec4 color = vec4(0.0);
  if (u_shadowBlur > 0.0) {
    vec2 shadowUV = uv - vec2(0.0, u_shadowOffsetY / size.y);
    float shadowDist = sdfRoundedRect(shadowUV, size, u_borderRadius);
    float shadow = smoothstep(0.0, u_shadowBlur, -shadowDist);
    color = vec4(0.0, 0.0, 0.0, shadow * u_shadowOpacity);  // Black with opacity
  }

  // Background
  float dist = sdfRoundedRect(uv, size, u_borderRadius);
  vec3 bgColor = mix(u_backgroundColor, u_backgroundHoverColor, v_hovered);

  // Header region (different color)
  float headerMask = 1.0 - step(u_headerHeight, localPos.y);
  bgColor = mix(bgColor, v_headerColor, headerMask * 0.15); // Subtle tint

  // Fill
  float fillAlpha = u_backgroundAlpha * (1.0 - smoothstep(-1.0, 0.0, dist));
  color = mix(color, vec4(bgColor, 1.0), fillAlpha);

  // Border
  vec3 borderColor = mix(u_borderColor, u_selectedBorderColor, v_selected);
  float borderAlpha = smoothstep(u_borderWidth, 0.0, abs(dist));
  color = mix(color, vec4(borderColor, 1.0), borderAlpha * step(0.01, u_borderWidth));

  gl_FragColor = color;
}
```

### 5.2 Passing Uniforms from React

```typescript
// In Nodes.tsx
const material = useMemo(() => {
  return new THREE.ShaderMaterial({
    uniforms: {
      u_borderRadius: { value: resolvedStyle.borderRadius },
      u_borderWidth: { value: resolvedStyle.borderWidth },
      u_borderColor: { value: new THREE.Vector3(...resolvedStyle.borderColor) },
      u_backgroundColor: { value: new THREE.Vector3(...resolvedStyle.background) },
      u_backgroundHoverColor: { value: new THREE.Vector3(...resolvedStyle.backgroundHover) },
      u_selectedBorderColor: { value: new THREE.Vector3(...resolvedStyle.selectedBorderColor) },
      u_backgroundAlpha: { value: variant === 'ghost' || variant === 'outline' ? 0 : 1 },
      u_shadowBlur: { value: resolvedStyle.shadowBlur },
      u_shadowOffsetY: { value: resolvedStyle.shadowOffsetY },
      u_shadowOpacity: { value: resolvedStyle.shadowOpacity },
      u_headerHeight: { value: resolvedStyle.headerHeight },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
  });
}, [resolvedStyle, variant]);
```

---

## Phase 6: Selection & Hover States

### 6.1 Selection Styling

When a node is selected:
- Border color changes to accent color (`--accent-9`)
- Border width could increase slightly (optional)

```typescript
const selectedBorderColor = tokens['--accent-9']; // e.g., indigo-9
```

### 6.2 Hover Styling

When hovering over a node:
- Background shifts to hover color (variant-specific)
- Managed via `a_hovered` instance attribute

### 6.3 Per-Instance State Attributes

**IMPORTANT:** Pre-allocate buffers to avoid GC pressure during hover (mouse move).

```typescript
// Pre-allocate buffers ONCE at init (not in render/effect)
const selectedBuffer = useRef(new Float32Array(MAX_NODES));
const hoveredBuffer = useRef(new Float32Array(MAX_NODES));

// Update in-place, no allocations
const updateStateAttributes = useCallback(() => {
  const selected = selectedBuffer.current;
  const hovered = hoveredBuffer.current;

  // Only update changed values (could optimize further with dirty tracking)
  nodes.forEach((node, i) => {
    selected[i] = selectedNodeIds.has(node.id) ? 1 : 0;
    hovered[i] = hoveredNodeId === node.id ? 1 : 0;
  });

  // Mark for GPU upload
  if (geometry.attributes.selected) {
    geometry.attributes.selected.needsUpdate = true;
  }
  if (geometry.attributes.hovered) {
    geometry.attributes.hovered.needsUpdate = true;
  }
}, [nodes, selectedNodeIds, hoveredNodeId]);

// Call via RAF or store subscription, NOT in render
```

**Even better:** Track previous hoveredNodeId and only update the two affected indices:

```typescript
const prevHoveredRef = useRef<string | null>(null);

// On hover change, only update 2 values instead of N
if (hoveredNodeId !== prevHoveredRef.current) {
  const prev = prevHoveredRef.current;
  const curr = hoveredNodeId;

  if (prev) {
    const prevIndex = nodeIndexMap.get(prev);
    if (prevIndex !== undefined) hoveredBuffer.current[prevIndex] = 0;
  }
  if (curr) {
    const currIndex = nodeIndexMap.get(curr);
    if (currIndex !== undefined) hoveredBuffer.current[currIndex] = 1;
  }

  geometry.attributes.hovered.needsUpdate = true;
  prevHoveredRef.current = curr;
}
```

---

## Implementation Order

### Milestone 1: Foundation ✓
- [x] Add `@kushagradhawan/kookie-ui` as peerDependency + devDependency
- [x] Create `useThemeTokens()` hook with CSS var reading
- [x] Implement fallback tokens for standalone mode
- [x] Add color parsing utilities (`parseColorToRGB`, `hexToRGB`, `parsePx`)
- [x] Test token reading with Kookie UI Theme
- [x] Create `ThemeProvider` context for sharing tokens

### Milestone 2: Props & Resolution ✓
- [x] Add `size`, `variant`, `radius` props to KookieFlowProps
- [x] Add `NodeStyleOverrides` type
- [x] Define SIZE_MAP matching Kookie UI Card
- [x] Define VARIANT_MAP matching Kookie UI Card
- [x] Implement `resolveNodeStyle()` function
- [x] Wire tokens through context to child components
- [x] Add `header`, `accentHeader` props for header configuration
- [x] Add `AccentColor` type (26 Kookie UI colors)
- [x] Add `color` prop to Node interface
- [x] Create `StyleProvider` and `useResolvedStyle` context

### Milestone 3: Node Shader & Token Alignment
- [x] Update node shader to accept color/style uniforms
- [ ] Add shadow SDF for classic variant
- [ ] Implement header color region in shader
- [x] Update instance attributes for selected/hovered state
- [x] Handle transparent backgrounds (ghost, outline)
- [ ] Test all 5 variants visually
- [ ] Add `--font-size-1` through `--font-size-5` to `ThemeTokens` interface
- [ ] Add `--line-height-1` through `--line-height-5` to `ThemeTokens` interface
- [ ] Add fallback values for typography tokens in `FALLBACK_TOKENS`
- [ ] Update `readTokensFromDOM()` to read typography tokens from CSS
- [ ] Update SIZE_MAP to use `--font-size-N` tokens instead of hardcoded pixels
- [ ] Remove headerHeight from SIZE_MAP (use `--space-7` fixed for row height)
- [ ] Update `resolveNodeStyle()` to resolve font-size and line-height tokens

### Milestone 3.5: Socket Layout Tokenization (Widget Prep)

Socket layout is fixed to size 2 with horizontal widget layout: `[socket] [label] [widget]`

Row height = 40px (`--space-7`), widget height = 32px (`--space-6`), creating 4px vertical padding.

- [ ] Add `--space-6` and `--space-7` to `ThemeTokens` interface
- [ ] Add `SOCKET_ROW_HEIGHT = '--space-7'` constant (40px, replaces `SOCKET_SPACING`)
- [ ] Add `WIDGET_HEIGHT = '--space-6'` constant (32px, for vertical centering)
- [ ] Create `ResolvedSocketLayout` interface (`rowHeight`, `widgetHeight`, `marginTop`, `socketSize`)
- [ ] Create `resolveSocketLayout()` function
- [ ] Update `getSocketPosition()` to accept layout parameter instead of using constants
- [ ] Remove static `SOCKET_SPACING` and `SOCKET_MARGIN_TOP` from constants.ts
- [ ] Update `edges.tsx` to use resolved socket layout
- [ ] Update `sockets.tsx` to use resolved socket layout
- [ ] Update `connection-line.tsx` to use resolved socket layout
- [ ] Update `geometry.ts` hit testing to use resolved socket layout
- [ ] Add socket layout to context (StyleProvider or separate SocketLayoutContext)
- [ ] Test socket positions with widgets at size 2

### Milestone 4: Socket Colors
- [x] Tokenize fallback socket colors (invalid → `--red-9`, valid target → `--green-9`, default → `--gray-8`)
- [x] Tokenize connection line colors (default → `--gray-8`, invalid → `--red-9`)
- [x] Edge colors tokenized (default → `--gray-8`, selected → `--accent-9`, invalid → `--red-9`)
- [ ] Update socketTypes config to accept CSS var references (deferred — see "Socket Type Theming" below)
- [ ] Implement `resolveSocketColor()` function (deferred)
- [ ] Optional: Create `createThemedSocketTypes(tokens)` helper (deferred)

#### Tokenization Summary by Component

| Component | Tokens Used | Purpose |
|-----------|-------------|---------|
| grid.tsx | `--gray-3`, `--gray-4` | Minor/major grid lines |
| kookie-flow.tsx | `--gray-2` | Canvas background |
| text-renderer.tsx | `--gray-12`, `--gray-11` | Primary/secondary text |
| dom-layer.tsx | `--gray-12`, `--gray-11` | DOM text labels |
| selection-box.tsx | `--accent-9` | Fill and border |
| connection-line.tsx | `--gray-8`, `--red-9` | Default line, invalid state |
| edges.tsx | `--gray-8`, `--accent-9`, `--red-9` | Default, selected, invalid |
| sockets.tsx | `--red-9`, `--green-9`, `--gray-8` | Invalid, valid target, fallback |

### Milestone 5: Polish & Testing
- [ ] Dark mode testing (mount with dark theme)
- [ ] Light mode testing (mount with light theme)
- [ ] Standalone mode testing (no Kookie UI)
- [ ] Socket size scaling with node size
- [ ] Edge selection color from accent
- [ ] Performance regression test (10k nodes)

### Milestone 6: Documentation
- [ ] Update PLAN.md with styling phase complete
- [ ] Add styling examples to demo app
- [ ] Document props in README
- [ ] Create variant showcase

---

## Testing Checklist

### Variants & Sizing
- [ ] All 5 variants render correctly (surface, outline, soft, classic, ghost)
- [ ] All 5 sizes render correctly
- [ ] Radius prop overrides size-based radius
- [ ] Selection shows accent border color
- [ ] Hover shows background change
- [ ] Classic variant shows shadow
- [ ] Ghost/outline have transparent backgrounds

### Color Tokenization (Completed)
- [x] Grid lines use `--gray-3` and `--gray-4`
- [x] Canvas background uses `--gray-2`
- [x] Text colors: primary `--gray-12`, secondary `--gray-11`
- [x] Edge colors: default `--gray-8`, selected `--accent-9`, invalid `--red-9`
- [x] Socket fallback colors: invalid `--red-9`, valid target `--green-9`, default `--gray-8`
- [x] Connection line: default `--gray-8`, invalid `--red-9`
- [x] Selection box: fill/border use `--accent-9`

### Theme Integration
- [ ] Socket type colors resolve from Radix tokens (user-configurable)
- [ ] Dark mode: colors correct when mounted with dark theme
- [ ] Light mode: colors correct when mounted with light theme
- [ ] Standalone mode: fallback tokens work

### Performance
- [ ] No regression in 10k node benchmark
- [ ] Kookie UI Button inside node looks proportional at matching size

---

## Design Decisions (Resolved)

1. **Header accent colors** — Optional via props, not automatic.

   Headers are controlled via explicit props rather than derived from socket colors. This keeps the API simple and gives users full control.

2. **Translucent material** — Skipped for v1.

   Render-to-texture adds significant complexity. Revisit if users specifically request it.

3. **Per-node color override** — Yes, matches Kookie UI pattern.

   Nodes support a `color` prop using the same 26 accent colors as Kookie UI (gray, gold, bronze, brown, yellow, amber, orange, tomato, red, ruby, crimson, pink, plum, purple, violet, iris, indigo, blue, cyan, teal, jade, green, grass, lime, mint, sky).

   ```typescript
   interface FlowNode {
     id: string;
     // ... existing fields
     color?: AccentColor;  // 26 Kookie UI accent colors
   }
   ```

4. **Animation** — Skipped for v1.

   Instant state changes are acceptable. May add shader interpolation later if needed.

5. **Theme change reactivity** — Read once on mount.

   No MutationObserver. Tokens are read once when the component mounts. Users who need runtime theme changes can remount the component.

6. **Socket type theming** — User-configurable via props, no built-in helper (yet).

   `DEFAULT_SOCKET_TYPES` in `constants.ts` contains domain-specific colors (e.g., ComfyUI conventions: purple for images, orange for latent, green for models). These are **not** tokenized automatically because:
   - They represent application-domain semantics, not UI theme colors
   - Different apps have different data type conventions
   - Hardcoded colors ensure consistency when no theme is present

   **Current approach:** Users can pass custom `socketTypes` via props and build themed colors using the `useThemeTokens()` hook:

   ```tsx
   import { useThemeTokens, KookieFlow } from '@kushagradhawan/kookie-flow';

   function MyFlow() {
     const tokens = useThemeTokens();

     const themedSocketTypes = {
       image: { color: rgbToHex(tokens['--purple-9']), name: 'Image' },
       latent: { color: rgbToHex(tokens['--orange-9']), name: 'Latent' },
       model: { color: rgbToHex(tokens['--green-9']), name: 'Model' },
       clip: { color: rgbToHex(tokens['--amber-9']), name: 'CLIP' },
       vae: { color: rgbToHex(tokens['--red-9']), name: 'VAE' },
       conditioning: { color: rgbToHex(tokens['--cyan-9']), name: 'Conditioning' },
       any: { color: rgbToHex(tokens['--gray-9']), name: 'Any' },
     };

     return <KookieFlow socketTypes={themedSocketTypes} ... />;
   }
   ```

   **Potential future improvement:** Provide a `createThemedSocketTypes(tokens, mapping)` helper function that makes this easier:

   ```tsx
   // Potential API (not implemented yet)
   const socketTypes = createThemedSocketTypes(tokens, {
     image: { token: '--purple-9', name: 'Image' },
     latent: { token: '--orange-9', name: 'Latent' },
     // ...
   });
   ```

   **Mapping from current defaults to Radix tokens:**

   | Socket Type | Current Color | Radix Token |
   |-------------|---------------|-------------|
   | any | #808080 | `--gray-9` |
   | image | #a855f7 | `--purple-9` |
   | latent | #f97316 | `--orange-9` |
   | model | #22c55e | `--green-9` |
   | clip | #facc15 | `--amber-9` |
   | vae | #ef4444 | `--red-9` |
   | conditioning | #06b6d4 | `--cyan-9` |
   | control_net | #3b82f6 | `--blue-9` |
   | mask | #6b7280 | `--gray-8` |

---

*Created: January 2026*
