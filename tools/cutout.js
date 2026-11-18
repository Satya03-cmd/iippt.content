// Removes the plain white background around a logo and crops it tight.
// Uses a flood fill from the image edges, so white INSIDE the logo (book pages etc.) is kept.
//   node tools/cutout.js <input.png> <output.png>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

const [input, output] = process.argv.slice(2);
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(input).toString('base64');

const html = `<!doctype html><body><script>
const img = new Image();
img.onload = () => {
  const w = img.width, h = img.height, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  const isBg = i => p[i] > 232 && p[i+1] > 232 && p[i+2] > 232;
  const seen = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < w; i++) { stack.push(i, (h-1)*w + i); }
  for (let j = 0; j < h; j++) { stack.push(j*w, j*w + w - 1); }
  while (stack.length) {
    const k = stack.pop();
    if (seen[k] || !isBg(k*4)) continue;
    seen[k] = 1; p[k*4+3] = 0;
    const xx = k % w, yy = (k / w) | 0;
    if (xx > 0) stack.push(k-1); if (xx < w-1) stack.push(k+1);
    if (yy > 0) stack.push(k-w); if (yy < h-1) stack.push(k+w);
  }
  // soften the edge: near-white pixels touching removed background become semi-transparent
  for (let k = 0; k < w*h; k++) {
    if (seen[k]) continue;
    const xx = k % w, yy = (k / w) | 0;
    const nb = (xx>0&&seen[k-1])||(xx<w-1&&seen[k+1])||(yy>0&&seen[k-w])||(yy<h-1&&seen[k+w]);
    if (nb) { const lum = (p[k*4]+p[k*4+1]+p[k*4+2])/3; if (lum > 200) p[k*4+3] = Math.round(255 * (255-lum) / 55); }
  }
  let minX=w,minY=h,maxX=0,maxY=0;
  for (let k = 0; k < w*h; k++) if (p[k*4+3] > 10) { const xx=k%w, yy=(k/w)|0;
    if(xx<minX)minX=xx; if(xx>maxX)maxX=xx; if(yy<minY)minY=yy; if(yy>maxY)maxY=yy; }
  x.putImageData(d, 0, 0);
  const o = document.createElement('canvas'); o.width = maxX-minX+1; o.height = maxY-minY+1;
  o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
  const pre = document.createElement('pre'); pre.id = 'out'; pre.textContent = 'OUT:' + o.toDataURL('image/png') + ':END';
  document.body.appendChild(pre);
};
img.src = ${JSON.stringify(dataUrl)};
</script></body>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutout-'));
const page = path.join(tmp, 'p.html');
fs.writeFileSync(page, html);
const dom = execFileSync(config.edgePath, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(tmp, 'prof')}`,
  '--virtual-time-budget=10000', '--dump-dom', 'file:///' + page.replace(/\\/g, '/')], { maxBuffer: 200e6, timeout: 60000 }).toString();
fs.rmSync(tmp, { recursive: true, force: true });
const m = dom.match(/OUT:data:image\/png;base64,([A-Za-z0-9+/=]+):END/);
if (!m) throw new Error('cutout failed');
fs.writeFileSync(output, Buffer.from(m[1], 'base64'));
console.log('wrote', output);
