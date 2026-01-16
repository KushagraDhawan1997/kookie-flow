# Required Assets for Docs Site

This document lists the image assets that need to be created for the docs site.

## Favicon Files

Place these files in `/apps/docs/public/`:

| File | Size | Format | Purpose |
|------|------|--------|---------|
| `favicon.ico` | 48x48 | ICO | Legacy browser favicon |
| `favicon.svg` | Any | SVG | Modern browser favicon (scalable) |
| `favicon-96x96.png` | 96x96 | PNG | High-DPI favicon |
| `apple-touch-icon.png` | 180x180 | PNG | iOS home screen icon |
| `favicon-192x192.png` | 192x192 | PNG | Android PWA icon |
| `favicon-512x512.png` | 512x512 | PNG | Android PWA splash icon |

## Open Graph Image

| File | Size | Format | Purpose |
|------|------|--------|---------|
| `opengraph-image.png` | 1200x630 | PNG | Social media sharing preview |

**Requirements:**
- File size under 200KB
- Include project logo
- Use brand colors (dark theme: #0a0a0a background)
- Add readable text: "Kookie Flow" + tagline
- High contrast for visibility in feeds

## Logo

| File | Size | Format | Purpose |
|------|------|--------|---------|
| `logo.png` | 200x200+ | PNG | JSON-LD schema, general branding |
| `logo.svg` | Any | SVG | Scalable logo for various uses |

## Design Guidelines

**Brand Colors:**
- Background: `#0a0a0a` (near black)
- Accent: `#6366f1` (indigo)
- Text: `#ffffff` (white)
- Muted: `#888888` (gray)

**Typography:**
- Use system fonts or Inter for consistency
- Keep text minimal and bold on OG images

## Quick Generation

Use a tool like [Favicon.io](https://favicon.io/) or [RealFaviconGenerator](https://realfavicongenerator.net/) to generate the favicon set from a single high-resolution source image.

For OG images, tools like [OG Image Playground](https://og-playground.vercel.app/) or Figma work well.
