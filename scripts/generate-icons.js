/* ============================================
   evzero/valorant — icon generator
   ============================================
   Takes assets/icon-source.png (any square PNG, ideally 512x512+) and emits
   the variants the app + electron-builder need:

     - assets/icon.png      256x256  → BrowserWindow + electron-builder fallback
     - assets/tray.png       32x32   → system tray (small, sharp)
     - assets/tray@2x.png    64x64   → HiDPI tray
     - assets/icon.ico      multi-size (16/32/48/64/128/256) → Windows installer

   Run:   npm run icons
   ============================================ */

'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SOURCE = path.join(ASSETS, 'icon-source.png');

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('ERROR: missing assets/icon-source.png');
    console.error('Drop your icon image (square PNG, 512x512 or larger) at:');
    console.error('  ' + SOURCE);
    process.exit(1);
  }

  const meta = await sharp(SOURCE).metadata();
  console.log(`Source: ${meta.width}x${meta.height} ${meta.format}`);

  const sizes = [
    { name: 'icon.png',     size: 256 },
    { name: 'tray.png',     size: 32  },
    { name: 'tray@2x.png',  size: 64  },
  ];

  for (const { name, size } of sizes) {
    const out = path.join(ASSETS, name);
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    const stat = fs.statSync(out);
    console.log(`  ${name.padEnd(14)} ${size}x${size}  ${(stat.size / 1024).toFixed(1)} KB`);
  }

  // Build a multi-resolution Windows .ico from the larger PNG variants. Most
  // Windows surfaces (taskbar, alt-tab, installer) hand-pick a size from the
  // multi-image .ico based on context, so we ship the common ones.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const tmp = await Promise.all(icoSizes.map(async (size) => {
    const buf = await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return buf;
  }));
  const ico = await pngToIco(tmp);
  const icoOut = path.join(ASSETS, 'icon.ico');
  fs.writeFileSync(icoOut, ico);
  console.log(`  icon.ico       multi    ${(ico.length / 1024).toFixed(1)} KB  (${icoSizes.join(', ')})`);

  console.log('\nDone. Restart the app to see the new icons.');
}

main().catch((err) => {
  console.error('Failed:', err && err.message || err);
  process.exit(1);
});
