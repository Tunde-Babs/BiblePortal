'use strict';
/**
 * Renders assets/icon.svg into the icon sets each platform expects.
 *
 * Electron does the rasterising, so there is no dependency on ImageMagick,
 * librsvg or a design tool being installed — the same engine that draws the app
 * draws its icon. `iconutil` (built into macOS) assembles the .icns.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'icon.svg');
const OUT = path.join(ROOT, 'assets');
const ICONSET = path.join(OUT, 'icon.iconset');

/** Sizes macOS needs; the @2x variants reuse the doubled render. */
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

const ICONSET_MAP = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const rendered = new Map();

  // Render from a real file rather than a data URL: encoding the SVG inline
  // pushed the URL past what loadURL would accept and every render after the
  // first failed with ERR_FAILED.
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bp-icon-'));
  const htmlFile = path.join(tmpDir, 'icon.html');

  // One window, resized per size — creating and destroying a window per render
  // raced the offscreen compositor.
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: false },
  });

  try {
    for (const size of SIZES) {
      fs.writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
        svg{display:block;width:${size}px;height:${size}px}
      </style></head><body>${svg}</body></html>`, 'utf8');

      win.setContentSize(size, size);
      await win.loadFile(htmlFile);
      // Let the gradients and the blur filter settle before capturing.
      await new Promise((r) => setTimeout(r, 260));

      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      const png = image.toPNG();
      if (!png.length) throw new Error(`capture produced no data at ${size}px`);
      rendered.set(size, png);
      console.log(`  rendered ${size}x${size}  (${(png.length / 1024).toFixed(0)} KB)`);
    }
  } finally {
    win.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // --- macOS .icns ---------------------------------------------------------
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });
  for (const [size, name] of ICONSET_MAP) {
    fs.writeFileSync(path.join(ICONSET, name), rendered.get(size));
  }

  try {
    execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(OUT, 'icon.icns')]);
    const bytes = fs.statSync(path.join(OUT, 'icon.icns')).size;
    console.log(`  icon.icns  ${(bytes / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.error('  iconutil failed:', err.message);
  }

  // --- a plain 512 PNG, which Linux and several tools want -----------------
  fs.writeFileSync(path.join(OUT, 'icon.png'), rendered.get(512));
  console.log('  icon.png   512×512');

  fs.rmSync(ICONSET, { recursive: true, force: true });
  app.exit(0);
});
