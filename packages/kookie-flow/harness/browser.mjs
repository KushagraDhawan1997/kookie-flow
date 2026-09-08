/**
 * Browser launch helper for the Phase-0 harness.
 *
 * Pinned executablePath is load-bearing, not defensive: a `playwright-core` resolved from npm
 * asks for whichever Chromium build that release pins, and the image here ships a different one.
 * Without an explicit path the launch fails with "Executable doesn't exist", which reads like a
 * broken harness rather than a version skew.
 *
 * See plans/migration/environment-facts.md for the probe this encodes.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Find a usable Chromium without assuming a build number. */
export function findChromium() {
  if (process.env.KOOKIE_CHROMIUM && existsSync(process.env.KOOKIE_CHROMIUM)) {
    return process.env.KOOKIE_CHROMIUM;
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return null;

  // A bare `chromium` entry is sometimes the binary itself, sometimes a directory.
  const direct = join(root, 'chromium');
  if (existsSync(direct) && !existsSync(join(direct, 'chrome-linux'))) return direct;

  const candidates = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((d) => join(root, d, 'chrome-linux', 'chrome'))
    .filter((p) => existsSync(p));

  return candidates[0] ?? null;
}

export async function launch(chromium, opts = {}) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      `No Chromium found under ${process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'}. ` +
        `Set KOOKIE_CHROMIUM to a Chromium binary.`
    );
  }
  return chromium.launch({ executablePath, ...opts });
}

/**
 * What the GPU actually is, for the record. Every perf number this harness prints is only
 * comparable against another number from the same renderer — see environment-facts.md.
 */
export async function describeRenderer(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: true,
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      software: /swiftshader|llvmpipe|software/i.test(
        String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '')
      ),
    };
  });
}
