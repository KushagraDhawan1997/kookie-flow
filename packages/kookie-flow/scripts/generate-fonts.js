#!/usr/bin/env node
/**
 * MSDF Font Atlas Generator
 *
 * Generates MSDF font atlas from Inter font for use in WebGL text rendering.
 * Run with: pnpm generate:fonts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '..', 'fonts');
const INTER_TTF = join(FONTS_DIR, 'Inter-Regular.ttf');

// Characters to include in atlas (ASCII + common extended)
const CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '©®™°±×÷€£¥¢' +
  'àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ' +
  'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŸ' +
  '–—''""…';

// Inter font download URL (Google Fonts)
const INTER_URL =
  'https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.woff2';

// Alternative: Use Google Fonts CDN for TTF
const INTER_TTF_URL =
  'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff2';

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);

    const file = fs.createWriteStream(dest);

    const request = (urlString) => {
      https
        .get(urlString, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            request(response.headers.location);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log(`Downloaded to ${dest}`);
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlink(dest, () => {}); // Delete partial file
          reject(err);
        });
    };

    request(url);
  });
}

async function main() {
  console.log('MSDF Font Atlas Generator\n');

  // Ensure fonts directory exists
  if (!existsSync(FONTS_DIR)) {
    mkdirSync(FONTS_DIR, { recursive: true });
  }

  // Check if we need to download Inter
  if (!existsSync(INTER_TTF)) {
    console.log('Inter font not found. Downloading...\n');

    // Try to download from rsms/inter GitHub
    try {
      // We'll use a TTF version from a CDN
      const ttfUrl =
        'https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-Regular.otf';
      await downloadFile(ttfUrl, INTER_TTF.replace('.ttf', '.otf'));
      console.log('Downloaded Inter-Regular.otf');
    } catch (err) {
      console.error('Failed to download Inter font:', err.message);
      console.log('\nPlease download Inter font manually:');
      console.log('1. Go to https://rsms.me/inter/');
      console.log('2. Download the font files');
      console.log(`3. Place Inter-Regular.ttf or Inter-Regular.otf in ${FONTS_DIR}`);
      process.exit(1);
    }
  }

  // Find font file (ttf or otf)
  let fontFile = INTER_TTF;
  if (!existsSync(fontFile)) {
    fontFile = INTER_TTF.replace('.ttf', '.otf');
  }
  if (!existsSync(fontFile)) {
    console.error('Font file not found. Please run the script again or download manually.');
    process.exit(1);
  }

  console.log(`Using font: ${fontFile}`);
  console.log('Generating MSDF atlas...\n');

  // Write charset to temp file
  const charsetFile = join(FONTS_DIR, '.charset.txt');
  writeFileSync(charsetFile, CHARSET);

  // Run msdf-bmfont-xml
  const outputName = 'inter-msdf';
  const cmd = [
    'npx',
    'msdf-bmfont',
    `"${fontFile}"`,
    '-f', 'json',
    '-o', `"${join(FONTS_DIR, outputName)}"`,
    '-s', '48', // Font size
    '-r', '4', // Distance range (spread)
    '-m', '1024,1024', // Max texture size
    '-t', 'msdf', // Field type: msdf for multi-channel
    '--charset-file', `"${charsetFile}"`,
    '--pot', // Power of two texture
    '--smart-size', // Optimize texture size
  ].join(' ');

  try {
    console.log(`Running: ${cmd}\n`);
    execSync(cmd, {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
    });

    console.log('\nMSDF atlas generated successfully!');
    console.log(`Output: ${join(FONTS_DIR, outputName + '.png')}`);
    console.log(`Metrics: ${join(FONTS_DIR, outputName + '.json')}`);
  } catch (err) {
    console.error('Failed to generate MSDF atlas:', err.message);
    process.exit(1);
  }

  // Clean up charset file
  try {
    fs.unlinkSync(charsetFile);
  } catch {}
}

main().catch(console.error);
