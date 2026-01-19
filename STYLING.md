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
│  4. Cache and memoize                                                │
│  5. Re-read on theme/appearance change                              │
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
5. Cache in a ref
6. Set up MutationObserver to detect `data-*` attribute changes (theme switches)
7. Provide fallback values if Kookie UI is not present

```typescript
function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(FALLBACK_TOKENS);

  useEffect(() => {
    const root = document.querySelector('.radix-themes') ?? document.documentElement;
    const styles = getComputedStyle(root);

    const readTokens = (): ThemeTokens => ({
      // Spacing
      '--space-1': parsePx(styles.getPropertyValue('--space-1')),
      '--space-2': parsePx(styles.getPropertyValue('--space-2')),
      '--space-3': parsePx(styles.getPropertyValue('--space-3')),
      // ...

      // Colors
      '--gray-1': parseColorToRGB(styles.getPropertyValue('--gray-1')),
      '--gray-2': parseColorToRGB(styles.getPropertyValue('--gray-2')),
      // ...

      // Radix colors for sockets
      '--blue-9': parseColorToRGB(styles.getPropertyValue('--blue-9')),
      '--purple-9': parseColorToRGB(styles.getPropertyValue('--purple-9')),
      '--green-9': parseColorToRGB(styles.getPropertyValue('--green-9')),
      // ...
    });

    setTokens(readTokens());

    // Watch for theme changes
    const observer = new MutationObserver(() => setTokens(readTokens()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-accent-color', 'data-gray-color', 'data-radius', 'data-scaling', 'class'] });

    return () => observer.disconnect();
  }, []);

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

---

## Phase 2: Props API

### 2.1 KookieFlow Props

**File:** `src/types/index.ts`

```typescript
type Size = '1' | '2' | '3' | '4' | '5';
type Variant = 'surface' | 'outline' | 'soft' | 'classic' | 'ghost';
type Radius = 'none' | 'small' | 'medium' | 'large' | 'full';

interface KookieFlowProps {
  // ... existing props (nodes, edges, etc.)

  // Styling props (match Kookie UI Card)
  size?: Size;           // Default: '2'
  variant?: Variant;     // Default: 'surface'
  radius?: Radius;       // Default: inherits from Theme, or 'medium'

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

  // Node-specific (not in Card)
  headerHeight?: number;
  headerBackground?: string;
}
```

### 2.2 Size Scale Mapping

Match Kookie UI Card exactly:

```typescript
const SIZE_MAP = {
  '1': {
    padding: '--space-2',       // 8px
    borderRadius: '--radius-3', // 10px (matches Card size-1 feel)
    headerHeight: 20,
    fontSize: 12,
    socketSize: 8,
  },
  '2': {
    padding: '--space-3',       // 12px
    borderRadius: '--radius-4', // 12px
    headerHeight: 24,
    fontSize: 14,
    socketSize: 10,
  },
  '3': {
    padding: '--space-4',       // 16px
    borderRadius: '--radius-4', // 12px
    headerHeight: 28,
    fontSize: 14,
    socketSize: 10,
  },
  '4': {
    padding: '--space-5',       // 24px
    borderRadius: '--radius-5', // 16px
    headerHeight: 32,
    fontSize: 16,
    socketSize: 12,
  },
  '5': {
    padding: '--space-6',       // 32px
    borderRadius: '--radius-5', // 16px
    headerHeight: 36,
    fontSize: 16,
    socketSize: 12,
  },
};
```

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
    padding: overrides?.borderRadius ?? padding,
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

### Milestone 1: Foundation
- [ ] Add `@kushagradhawan/kookie-ui` as peerDependency + devDependency
- [ ] Create `useThemeTokens()` hook with CSS var reading
- [ ] Implement fallback tokens for standalone mode
- [ ] Add color parsing utilities (`parseColorToRGB`, `hexToRGB`, `parsePx`)
- [ ] Test token reading with Kookie UI Theme

### Milestone 2: Props & Resolution
- [ ] Add `size`, `variant`, `radius` props to KookieFlowProps
- [ ] Add `NodeStyleOverrides` type
- [ ] Define SIZE_MAP matching Kookie UI Card
- [ ] Define VARIANT_MAP matching Kookie UI Card
- [ ] Implement `resolveNodeStyle()` function
- [ ] Wire tokens through context to child components

### Milestone 3: Node Shader
- [ ] Update node shader to accept color/style uniforms
- [ ] Add shadow SDF for classic variant
- [ ] Implement header color region in shader
- [ ] Update instance attributes for selected/hovered state
- [ ] Handle transparent backgrounds (ghost, outline)
- [ ] Test all 5 variants visually

### Milestone 4: Socket Colors
- [ ] Update socketTypes config to accept CSS var references
- [ ] Implement `resolveSocketColor()` function
- [ ] Update Sockets.tsx to use resolved colors
- [ ] Update ConnectionLine to use resolved colors
- [ ] Test socket colors with different Radix palettes

### Milestone 5: Polish & Testing
- [ ] Dark mode testing (appearance toggle)
- [ ] Light mode testing
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

- [ ] All 5 variants render correctly (surface, outline, soft, classic, ghost)
- [ ] All 5 sizes render correctly
- [ ] Radius prop overrides size-based radius
- [ ] Selection shows accent border color
- [ ] Hover shows background change
- [ ] Classic variant shows shadow
- [ ] Ghost/outline have transparent backgrounds
- [ ] Socket colors resolve from Radix tokens
- [ ] Dark mode: colors invert appropriately
- [ ] Light mode: colors work correctly
- [ ] Standalone mode: fallback tokens work
- [ ] Performance: no regression in 10k node benchmark
- [ ] Kookie UI Button inside node looks proportional at matching size

---

## Open Questions

1. **Header accent colors** — Should each node type define a header color, or derive from the first output socket type color?

2. **Translucent material** — Kookie UI Card supports `material="translucent"` with backdrop blur. Worth supporting in WebGL? (Would require render-to-texture, significant complexity)

3. **Per-node style override** — Should individual nodes be able to override the global variant? e.g., `node.style = { borderColor: '--red-9' }` for error state?

4. **Animation** — Should hover/selection transitions be animated? (Interpolate in shader over time using a uniform)

5. **Theme change reactivity** — Currently planned to use MutationObserver. Is there a better way to subscribe to Kookie UI theme changes?

---

*Created: January 2026*
