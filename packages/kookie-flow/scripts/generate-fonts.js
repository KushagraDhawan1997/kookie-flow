#!/usr/bin/env node
/**
 * MSDF Font Atlas Generator
 *
 * Generates MSDF font atlases for WebGL text rendering.
 * Supports multiple font families and weights.
 *
 * Usage:
 *   pnpm generate:fonts              - Generate Google Sans (default)
 *   pnpm generate:fonts google-sans  - Generate Google Sans
 *   pnpm generate:fonts inter        - Generate Inter
 *   pnpm generate:fonts roboto       - Generate Roboto
 *   pnpm generate:fonts source-serif - Generate Source Serif Pro
 *   pnpm generate:fonts all          - Generate all fonts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '..', 'fonts');

/**
 * Font family configurations.
 * Each family has a list of weights with TTF file names and output names.
 */
const FONT_FAMILIES = {
  'google-sans': {
    displayName: 'Google Sans',
    weights: [
      { name: 'regular', file: 'GoogleSans-Regular.ttf', output: 'google-sans-regular-msdf' },
      { name: 'semibold', file: 'GoogleSans-SemiBold.ttf', output: 'google-sans-semibold-msdf' },
    ],
    downloadUrl: 'https://fonts.google.com/specimen/Google+Sans',
  },
  'inter': {
    displayName: 'Inter',
    weights: [
      { name: 'regular', file: 'Inter-Regular.ttf', output: 'inter-regular-msdf' },
      { name: 'semibold', file: 'Inter-SemiBold.ttf', output: 'inter-semibold-msdf' },
    ],
    downloadUrl: 'https://fonts.google.com/specimen/Inter',
  },
  'roboto': {
    displayName: 'Roboto',
    weights: [
      { name: 'regular', file: 'Roboto-Regular.ttf', output: 'roboto-regular-msdf' },
      { name: 'medium', file: 'Roboto-Medium.ttf', output: 'roboto-medium-msdf' },
    ],
    downloadUrl: 'https://fonts.google.com/specimen/Roboto',
  },
  'source-serif': {
    displayName: 'Source Serif Pro',
    weights: [
      { name: 'regular', file: 'SourceSerifPro-Regular.ttf', output: 'source-serif-regular-msdf' },
      { name: 'semibold', file: 'SourceSerifPro-SemiBold.ttf', output: 'source-serif-semibold-msdf' },
    ],
    downloadUrl: 'https://fonts.google.com/specimen/Source+Serif+Pro',
  },
};

// Get target font family from command line args
const targetFamily = process.argv[2] || 'google-sans';

// For backwards compatibility, also support FONT_WEIGHTS format
const FONT_WEIGHTS = targetFamily === 'all'
  ? Object.values(FONT_FAMILIES).flatMap(f => f.weights)
  : (FONT_FAMILIES[targetFamily]?.weights || FONT_FAMILIES['google-sans'].weights);

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
  const familyConfig = FONT_FAMILIES[targetFamily];

  if (targetFamily === 'all') {
    console.log('MSDF Font Atlas Generator (All Fonts)\n');
    // Generate all font families
    for (const [familyKey, config] of Object.entries(FONT_FAMILIES)) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Processing: ${config.displayName}`);
      console.log('='.repeat(50));
      await generateFamily(familyKey, config);
    }
    return;
  }

  if (!familyConfig) {
    console.error(`Unknown font family: ${targetFamily}`);
    console.log('Available families:', Object.keys(FONT_FAMILIES).join(', '));
    process.exit(1);
  }

  console.log(`MSDF Font Atlas Generator (${familyConfig.displayName})\n`);
  await generateFamily(targetFamily, familyConfig);
}

async function generateFamily(familyKey, familyConfig) {
  // Ensure fonts directory exists
  if (!existsSync(FONTS_DIR)) {
    mkdirSync(FONTS_DIR, { recursive: true });
  }

  // Check which fonts are available
  const availableFonts = familyConfig.weights.filter(weight => {
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
    console.error(`\nNo ${familyConfig.displayName} font files found!`);
    console.log(`Please download from ${familyConfig.downloadUrl}`);
    console.log(`Place the TTF files in ${FONTS_DIR}`);
    if (targetFamily !== 'all') {
      process.exit(1);
    }
    return;
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
  await embedFonts(familyKey, familyConfig, generatedFonts);
}

async function embedFonts(familyKey, familyConfig, fonts) {
  // For Google Sans, use the original path for backwards compatibility
  // For other fonts, use separate files in embedded-fonts directory
  const isGoogleSans = familyKey === 'google-sans';
  const outputDir = join(__dirname, '..', 'src', 'core');
  const outputPath = isGoogleSans
    ? join(outputDir, 'embedded-font.ts')
    : join(outputDir, 'embedded-fonts', `${familyKey}.ts`);

  // Ensure output directory exists
  if (!isGoogleSans) {
    const fontsDir = join(outputDir, 'embedded-fonts');
    if (!existsSync(fontsDir)) {
      mkdirSync(fontsDir, { recursive: true });
    }
  }

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

  // Determine import path for FontMetrics based on file location
  const importPath = isGoogleSans ? '../utils/text-layout' : '../../utils/text-layout';

  // Generate TypeScript file
  let tsContent = `/**
 * Embedded MSDF Font Atlas - ${familyConfig.displayName}
 *
 * This module contains ${familyConfig.displayName} MSDF fonts embedded as base64.
 * This enables zero-config usage of WebGL text rendering.
 *
 * Generated fonts: ${fonts.map(f => f.name).join(', ')}
 */

import type { FontMetrics } from '${importPath}';

`;

  // Add exports for each font
  for (const font of fontExports) {
    tsContent += `/**
 * ${familyConfig.displayName} ${font.name.charAt(0).toUpperCase() + font.name.slice(1)} MSDF font metrics.
 */
export const ${font.varNameMetrics}: FontMetrics = ${JSON.stringify(font.metrics, null, 2)};

/**
 * ${familyConfig.displayName} ${font.name.charAt(0).toUpperCase() + font.name.slice(1)} MSDF atlas as base64 data URL.
 */
export const ${font.varNameAtlas} = '${font.atlasDataUrl}';

`;
  }

  // Add convenience aliases for default font (regular) - only for Google Sans for backwards compat
  const regularFont = fontExports.find(f => f.name === 'regular');
  if (regularFont && isGoogleSans) {
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
