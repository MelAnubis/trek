#!/usr/bin/env node
'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CRC32 (PNG requires it for every chunk)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf, offset = 0, length = buf.length - offset) {
  let c = 0xFFFFFFFF;
  for (let i = offset; i < offset + length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Low-level PNG builder
// ---------------------------------------------------------------------------
function uint32BE(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const dataLen   = uint32BE(data.length);
  const crcInput  = Buffer.concat([typeBytes, data]);
  const crcBytes  = uint32BE(crc32(crcInput));
  return Buffer.concat([dataLen, typeBytes, data, crcBytes]);
}

function buildPNG(width, height, pixels /* Uint8Array RGBA row-major */) {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // colour type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Filter: prepend 0x00 (None) to every row
  const rowSize    = width * 4;
  const filtered   = Buffer.allocUnsafe(height * (1 + rowSize));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowSize)] = 0;
    pixels.copy(filtered, y * (1 + rowSize) + 1, y * rowSize, (y + 1) * rowSize);
  }

  const idat = zlib.deflateSync(filtered, { level: 6 });

  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Pixel buffer helpers
// ---------------------------------------------------------------------------
function createBuffer(w, h) {
  return Buffer.alloc(w * h * 4, 0);   // all transparent black
}

function setPixel(buf, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= buf.length / (w * 4)) return;
  const off = (y * w + x) * 4;
  buf[off]     = r;
  buf[off + 1] = g;
  buf[off + 2] = b;
  buf[off + 3] = a;
}

function fillRect(buf, w, h, r, g, b, a = 255) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      setPixel(buf, w, x, y, r, g, b, a);
}

// ---------------------------------------------------------------------------
// Scanline triangle fill
// ---------------------------------------------------------------------------
function fillTriangle(buf, w, h, x0, y0, x1, y1, x2, y2, r, g, b, a = 255) {
  // Sort vertices by y
  let verts = [[x0, y0], [x1, y1], [x2, y2]].sort((a, b) => a[1] - b[1]);
  const [[ax, ay], [bx, by], [cx, cy]] = verts;

  function interpolate(y, p1x, p1y, p2x, p2y) {
    if (p2y === p1y) return p1x;
    return p1x + (y - p1y) * (p2x - p1x) / (p2y - p1y);
  }

  const yStart = Math.max(0, Math.ceil(ay));
  const yEnd   = Math.min(h - 1, Math.floor(cy));

  for (let y = yStart; y <= yEnd; y++) {
    let xLeft, xRight;
    if (y < by) {
      // Between top and mid vertex: left = top→bottom edge, right = top→mid edge  (or vice-versa)
      const xa = interpolate(y, ax, ay, cx, cy);
      const xb = interpolate(y, ax, ay, bx, by);
      xLeft  = Math.min(xa, xb);
      xRight = Math.max(xa, xb);
    } else {
      // Between mid and bottom vertex
      const xa = interpolate(y, ax, ay, cx, cy);
      const xb = interpolate(y, bx, by, cx, cy);
      xLeft  = Math.min(xa, xb);
      xRight = Math.max(xa, xb);
    }
    const xS = Math.max(0, Math.ceil(xLeft));
    const xE = Math.min(w - 1, Math.floor(xRight));
    for (let x = xS; x <= xE; x++) setPixel(buf, w, x, y, r, g, b, a);
  }
}

// ---------------------------------------------------------------------------
// Draw filled circle
// ---------------------------------------------------------------------------
function fillCircle(buf, w, h, cx, cy, rad, r, g, b, a = 255) {
  const r2 = rad * rad;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy <= r2) setPixel(buf, w, cx + dx, cy + dy, r, g, b, a);
    }
  }
}

// ---------------------------------------------------------------------------
// Downsample (box-filter) from srcW×srcH → dstW×dstH
// ---------------------------------------------------------------------------
function downsample(src, srcW, srcH, dstW, dstH) {
  const dst = createBuffer(dstW, dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * scaleX, x1 = x0 + scaleX;
      const y0 = dy * scaleY, y1 = y0 + scaleY;
      let R = 0, G = 0, B = 0, A = 0, count = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < srcH; sy++) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < srcW; sx++) {
          const off = (sy * srcW + sx) * 4;
          R += src[off]; G += src[off+1]; B += src[off+2]; A += src[off+3];
          count++;
        }
      }
      if (count > 0) {
        const doff = (dy * dstW + dx) * 4;
        dst[doff]   = Math.round(R / count);
        dst[doff+1] = Math.round(G / count);
        dst[doff+2] = Math.round(B / count);
        dst[doff+3] = Math.round(A / count);
      }
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Draw the Trek Wanderer icon onto a 1024×1024 pixel buffer
// ---------------------------------------------------------------------------
function drawIcon1024() {
  const W = 1024, H = 1024;
  const buf = createBuffer(W, H);

  // 1. Background: dark green #0D2B1E = rgb(13,43,30)
  fillRect(buf, W, H, 13, 43, 30);

  // 2. Mountain body: large triangle — (100,900),(924,900),(512,150) — #1A3D2B = (26,61,43)
  fillTriangle(buf, W, H, 100, 900, 924, 900, 512, 150,  26, 61, 43);

  // 3. Bright green peak: (512,150),(310,480),(714,480) — #2ECC71 = (46,204,113)
  fillTriangle(buf, W, H, 512, 150, 310, 480, 714, 480,  46, 204, 113);

  // 4. Snow cap: (512,150),(440,320),(584,320) — white (255,255,255)
  fillTriangle(buf, W, H, 512, 150, 440, 320, 584, 320,  255, 255, 255);

  // 5. Trail dots: 6 small white circles from (512,900) up to roughly (512,480)
  //    evenly spaced; slight horizontal variation for a natural feel
  const trailPoints = [
    [512, 870],
    [520, 800],
    [508, 730],
    [516, 660],
    [504, 590],
    [512, 520],
  ];
  for (const [tx, ty] of trailPoints) {
    fillCircle(buf, W, H, tx, ty, 14, 255, 255, 255);
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Draw splash (1284×2778): dark-green bg, icon centered at 512×512
// ---------------------------------------------------------------------------
function drawSplash(iconBuf) {
  const W = 1284, H = 2778;
  const ICON_SIZE = 512;

  const buf = createBuffer(W, H);
  fillRect(buf, W, H, 13, 43, 30);  // dark green background

  // Downsample icon to 512×512 first
  const icon512 = downsample(iconBuf, 1024, 1024, ICON_SIZE, ICON_SIZE);

  // Centre the icon
  const offsetX = Math.floor((W - ICON_SIZE) / 2);
  const offsetY = Math.floor((H - ICON_SIZE) / 2);

  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const srcOff = (y * ICON_SIZE + x) * 4;
      const dstX   = offsetX + x;
      const dstY   = offsetY + y;
      if (dstX >= 0 && dstX < W && dstY >= 0 && dstY < H) {
        const dstOff = (dstY * W + dstX) * 4;
        buf[dstOff]   = icon512[srcOff];
        buf[dstOff+1] = icon512[srcOff+1];
        buf[dstOff+2] = icon512[srcOff+2];
        buf[dstOff+3] = icon512[srcOff+3];
      }
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const ASSETS = '/home/user/trek/mobile/assets';
fs.mkdirSync(ASSETS, { recursive: true });

console.log('Generating icon pixels (1024×1024)...');
const icon1024 = drawIcon1024();

console.log('Building icon.png and adaptive-icon.png...');
const iconPng = buildPNG(1024, 1024, icon1024);
fs.writeFileSync(path.join(ASSETS, 'icon.png'), iconPng);
fs.writeFileSync(path.join(ASSETS, 'adaptive-icon.png'), iconPng);
console.log(`  icon.png          : ${iconPng.length} bytes`);
console.log(`  adaptive-icon.png : ${iconPng.length} bytes`);

console.log('Downsampling favicon (64×64)...');
const favicon64 = downsample(icon1024, 1024, 1024, 64, 64);
const faviconPng = buildPNG(64, 64, favicon64);
fs.writeFileSync(path.join(ASSETS, 'favicon.png'), faviconPng);
console.log(`  favicon.png       : ${faviconPng.length} bytes`);

console.log('Building splash (1284×2778)...');
const splashBuf = drawSplash(icon1024);
const splashPng = buildPNG(1284, 2778, splashBuf);
fs.writeFileSync(path.join(ASSETS, 'splash.png'), splashPng);
console.log(`  splash.png        : ${splashPng.length} bytes`);

console.log('\nDone! All icons written to', ASSETS);
