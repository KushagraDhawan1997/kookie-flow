#!/usr/bin/env node
/**
 * MSDF Font Atlas Generator
 *
 * Generates MSDF font atlases from Google Sans for use in WebGL text rendering.
 * Supports multiple weights (Regular, SemiBold).
 * Run with: pnpm generate:fonts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '..', 'fonts');

// Font weights to generate
const FONT_WEIGHTS = [
  { name: 'regular', file: 'GoogleSans-Regular.ttf', output: 'google-sans-regular-msdf' },
  { name: 'semibold', file: 'GoogleSans-SemiBold.ttf', output: 'google-sans-semibold-msdf' },
];

// Characters to include in atlas (ASCII + common extended)
const CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '©®™°±×÷€£¥¢' +
  'àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ' +
  'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŸ' +
  '\u2013\u2014\u2018\u2019\u201C\u201D\u2026'; // en-dash, em-dash, quotes, ellipsis

async function generateAtlas(fontPath, outputName, charsetFile) {
  const cmd = [
    'npx',
    'msdf-bmfont',
    `"${fontPath}"`,
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

  console.log(`Running: ${cmd}\n`);
  execSync(cmd, {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });
}

function findMetricsFile(outputName, fontFileName) {
  // msdf-bmfont sometimes names the JSON after the input font file
  const expectedPath = join(FONTS_DIR, `${outputName}.json`);
  if (existsSync(expectedPath)) {
    return expectedPath;
  }
  // Fallback to font filename without extension
  const fallbackPath = join(FONTS_DIR, fontFileName.replace(/\.ttf$/i, '.json'));
  if (existsSync(fallbackPath)) {
    return fallbackPath;
  }
  return null;
}

async function main() {
  console.log('MSDF Font Atlas Generator (Google Sans - Multiple Weights)\n');

  // Ensure fonts directory exists
  if (!existsSync(FONTS_DIR)) {
    mkdirSync(FONTS_DIR, { recursive: true });
  }

  // Check which fonts are available
  const availableFonts = FONT_WEIGHTS.filter(weight => {
    const fontPath = join(FONTS_DIR, weight.file);
    if (existsSync(fontPath)) {
      console.log(`Found: ${weight.file}`);
      return true;
    } else {
      console.log(`Missing: ${weight.file}`);
      return false;
    }
  });

  if (availableFonts.length === 0) {
    console.error('\nNo Google Sans font files found!');
    console.log('Please download Google Sans from https://fonts.google.com/specimen/Google+Sans');
    console.log(`Place the TTF files in ${FONTS_DIR}`);
    process.exit(1);
  }

  console.log(`\nGenerating atlases for ${availableFonts.length} weight(s)...\n`);

  // Write charset to temp file
  const charsetFile = join(FONTS_DIR, '.charset.txt');
  writeFileSync(charsetFile, CHARSET);

  const generatedFonts = [];

  for (const weight of availableFonts) {
    const fontPath = join(FONTS_DIR, weight.file);
    console.log(`\n========================================`);
    console.log(`Generating: ${weight.name} (${weight.file})`);
    console.log(`========================================\n`);

    try {
      await generateAtlas(fontPath, weight.output, charsetFile);

      const metricsPath = findMetricsFile(weight.output, weight.file);
      const atlasPath = join(FONTS_DIR, `${weight.output}.png`);

      if (metricsPath && existsSync(atlasPath)) {
        generatedFonts.push({
          ...weight,
          metricsPath,
          atlasPath,
        });
        console.log(`\nSuccess: ${weight.output}.png`);
      } else {
        console.error(`\nWarning: Could not find generated files for ${weight.name}`);
      }
    } catch (err) {
      console.error(`\nFailed to generate ${weight.name}:`, err.message);
    }
  }

  // Clean up charset file
  try {
    unlinkSync(charsetFile);
  } catch {}

  if (generatedFonts.length === 0) {
    console.error('\nNo fonts were generated successfully!');
    process.exit(1);
  }

  // Embed all fonts into TypeScript
  console.log('\n========================================');
  console.log('Embedding fonts into TypeScript...');
  console.log('========================================\n');
  await embedFonts(generatedFonts);
}

async function embedFonts(fonts) {
  const outputPath = join(__dirname, '..', 'src', 'core', 'embedded-font.ts');

  const fontExports = [];
  let totalSize = 0;

  for (const font of fonts) {
    // Read metrics JSON
    const metrics = JSON.parse(fs.readFileSync(font.metricsPath, 'utf-8'));

    // Read atlas and convert to base64
    const atlasBuffer = fs.readFileSync(font.atlasPath);
    const atlasBase64 = atlasBuffer.toString('base64');
    const atlasDataUrl = `data:image/png;base64,${atlasBase64}`;

    const size = atlasBase64.length / 1024;
    totalSize += size;

    const varNameMetrics = `EMBEDDED_FONT_METRICS_${font.name.toUpperCase()}`;
    const varNameAtlas = `EMBEDDED_FONT_ATLAS_URL_${font.name.toUpperCase()}`;

    fontExports.push({
      name: font.name,
      varNameMetrics,
      varNameAtlas,
      metrics,
      atlasDataUrl,
      glyphCount: metrics.chars?.length || 0,
      size,
    });

    console.log(`  ${font.name}: ${metrics.chars?.length || 0} glyphs, ${size.toFixed(1)} KB`);
  }

  // Generate TypeScript file
  let tsContent = `/**
 * Embedded MSDF Font Atlas
 *
 * This module contains Google Sans MSDF fonts embedded as base64.
 * This enables zero-config usage of WebGL text rendering.
 *
 * Generated fonts: ${fonts.map(f => f.name).join(', ')}
 */

import type { FontMetrics } from '../utils/text-layout';

`;

  // Add exports for each font
  for (const font of fontExports) {
    tsContent += `/**
 * Google Sans ${font.name.charAt(0).toUpperCase() + font.name.slice(1)} MSDF font metrics.
 */
export const ${font.varNameMetrics}: FontMetrics = ${JSON.stringify(font.metrics, null, 2)};

/**
 * Google Sans ${font.name.charAt(0).toUpperCase() + font.name.slice(1)} MSDF atlas as base64 data URL.
 */
export const ${font.varNameAtlas} = '${font.atlasDataUrl}';

`;
  }

  // Add convenience aliases for default font (regular)
  const regularFont = fontExports.find(f => f.name === 'regular');
  if (regularFont) {
    tsContent += `/**
 * Default font metrics (Regular weight).
 * @deprecated Use EMBEDDED_FONT_METRICS_REGULAR for explicit weight selection.
 */
export const EMBEDDED_FONT_METRICS = ${regularFont.varNameMetrics};

/**
 * Default font atlas (Regular weight).
 * @deprecated Use EMBEDDED_FONT_ATLAS_URL_REGULAR for explicit weight selection.
 */
export const EMBEDDED_FONT_ATLAS_URL = ${regularFont.varNameAtlas};

`;
  }

  // Add font weight type and map
  tsContent += `/**
 * Available font weights.
 */
export type FontWeight = ${fontExports.map(f => `'${f.name}'`).join(' | ')};

/**
 * Font metrics by weight.
 */
export const FONT_METRICS_BY_WEIGHT: Record<FontWeight, FontMetrics> = {
${fontExports.map(f => `  ${f.name}: ${f.varNameMetrics},`).join('\n')}
};

/**
 * Font atlas URLs by weight.
 */
export const FONT_ATLAS_BY_WEIGHT: Record<FontWeight, string> = {
${fontExports.map(f => `  ${f.name}: ${f.varNameAtlas},`).join('\n')}
};
`;

  writeFileSync(outputPath, tsContent);
  console.log(`\nEmbedded font written to ${outputPath}`);
  console.log(`  Total: ${fontExports.length} weight(s), ${totalSize.toFixed(1)} KB`);
}

main().catch(console.error);
