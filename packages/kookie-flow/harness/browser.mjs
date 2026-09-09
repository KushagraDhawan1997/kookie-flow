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

/**
 * Where a Playwright browser cache lives when nobody has said. The Linux image path was the only
 * one here, hardcoded, and the layout under it was assumed to be `chrome-linux/chrome` — so on a
 * macOS checkout every spike in this directory failed at launch with "No Chromium found", which
 * reads as a broken harness rather than as a path this file never learned. The maintainer's own
 * machine could not run the instrument that measures the maintainer's own rules.
 */
function defaultRoots() {
  const home = process.env.HOME ?? '';
  return [
    '/opt/pw-browsers',
    home && join(home, 'Library', 'Caches', 'ms-playwright'),
    home && join(home, '.cache', 'ms-playwright'),
  ].filter(Boolean);
}

/**
 * The binary inside one `chromium-<build>` directory, whichever platform packed it.
 *
 * Playwright names the inner directory per platform and the macOS one buries the executable in an
 * .app bundle. Sorted by build number descending by the caller, so the newest install wins.
 */
function binaryIn(dir) {
  for (const parts of [['chrome-linux', 'chrome'], ['chrome-win', 'chrome.exe']]) {
    const p = join(dir, ...parts);
    if (existsSync(p)) return p;
  }
  // macOS: `chrome-mac` or `chrome-mac-arm64`, holding an .app whose name has changed across
  // releases ("Chromium.app", then "Google Chrome for Testing.app"). Match the bundle by suffix
  // rather than by name, or the harness breaks again on the next rename.
  for (const macDir of ['chrome-mac-arm64', 'chrome-mac']) {
    const outer = join(dir, macDir);
    if (!existsSync(outer)) continue;
    for (const entry of readdirSync(outer)) {
      if (!entry.endsWith('.app')) continue;
      const p = join(outer, entry, 'Contents', 'MacOS', entry.slice(0, -'.app'.length));
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Find a usable Chromium without assuming a build number, a platform, or a cache location. */
export function findChromium() {
  if (process.env.KOOKIE_CHROMIUM && existsSync(process.env.KOOKIE_CHROMIUM)) {
    return process.env.KOOKIE_CHROMIUM;
  }
  const roots = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? [process.env.PLAYWRIGHT_BROWSERS_PATH]
    : defaultRoots();

  for (const root of roots) {
    if (!existsSync(root)) continue;

    // A bare `chromium` entry is sometimes the binary itself, sometimes a directory.
    const direct = join(root, 'chromium');
    if (existsSync(direct) && !binaryIn(direct)) return direct;

    // Build numbers are not zero-padded, so a lexical sort puts 999 above 1234. Compare the
    // numeric suffix instead — the alternative silently launches an older browser than the one
    // that was just installed, which is exactly the version skew this file exists to prevent.
    const builds = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .map((d) => ({ d, n: Number(d.slice('chromium-'.length)) }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => b.n - a.n);

    for (const { d } of builds) {
      const bin = binaryIn(join(root, d));
      if (bin) return bin;
    }
  }

  return null;
}

export async function launch(chromium, opts = {}) {
  const executablePath = findChromium();
  if (!executablePath) {
    const looked = process.env.PLAYWRIGHT_BROWSERS_PATH
      ? [process.env.PLAYWRIGHT_BROWSERS_PATH]
      : defaultRoots();
    throw new Error(
      `No Chromium found under ${looked.join(', ')}. ` +
        `Install one with \`npx playwright install chromium\`, ` +
        `or set KOOKIE_CHROMIUM to a Chromium binary.`
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
