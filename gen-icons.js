// Run with: node gen-icons.js
// Generates icon-192.png and icon-512.png using canvas
const { createCanvas } = require('canvas');
const fs = require('fs');

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const r = size * 0.18;

  // Background
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#1f2229');
  bg.addColorStop(1, '#16181d');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, size, size, r);
  ctx.fill();

  // Accent bar
  ctx.fillStyle = '#3db8f5';
  ctx.fillRect(0, 0, size * 0.06, size);

  // ADH text
  const fs1 = size * 0.18;
  ctx.font = `bold ${fs1}px sans-serif`;
  ctx.fillStyle = '#3db8f5';
  ctx.textAlign = 'center';
  ctx.fillText('ADH', size * 0.56, size * 0.38);

  // AUDIT text
  const fs2 = size * 0.10;
  ctx.font = `${fs2}px sans-serif`;
  ctx.fillStyle = '#e4e7ef';
  ctx.fillText('FIELD AUDIT', size * 0.56, size * 0.52);

  // Tool icon (clipboard)
  const cx = size * 0.56, cy = size * 0.70, bw = size * 0.28, bh = size * 0.22;
  ctx.strokeStyle = '#3db8f5';
  ctx.lineWidth = size * 0.025;
  ctx.strokeRect(cx - bw/2, cy - bh/2, bw, bh);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i === 0 ? '#22c55e' : i === 1 ? '#f97316' : '#94a3b8';
    ctx.fillRect(cx - bw*0.35, cy - bh*0.25 + i*(bh*0.25), bw*0.7, size*0.015);
  }

  return c.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

try {
  fs.writeFileSync('icon-192.png', drawIcon(192));
  fs.writeFileSync('icon-512.png', drawIcon(512));
  console.log('Icons generated.');
} catch(e) {
  console.log('node-canvas not available — using inline SVG icons instead.');
}
