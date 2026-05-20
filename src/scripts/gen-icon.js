/**
 * gen-icon.js
 * SVG → 256x256 PNG → ICO (via png-to-ico default export which handles resizing)
 * Run: node scripts/gen-icon.js
 */

const path = require('path');
const fs   = require('fs');
const sharp = require('sharp');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SVG_PATH  = path.join(BUILD_DIR, 'icon.svg');
const PNG256    = path.join(BUILD_DIR, 'icon-256.png');
const ICO_PATH  = path.join(BUILD_DIR, 'icon.ico');

async function main() {
  // 1. Render SVG → 256×256 PNG
  const svgBuf = fs.readFileSync(SVG_PATH);
  await sharp(svgBuf).resize(256, 256).png().toFile(PNG256);
  console.log('Generated 256x256 PNG');

  // 2. png-to-ico is an ES module — use dynamic import
  const { default: pngToIco } = await import('png-to-ico');

  // Pass a single 256×256 PNG; the library internally generates 48/32/16 sizes
  const icoBuf = await pngToIco(PNG256);
  fs.writeFileSync(ICO_PATH, icoBuf);
  console.log(`ICO written to ${ICO_PATH}`);

  // Clean up temp PNG
  fs.unlinkSync(PNG256);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
