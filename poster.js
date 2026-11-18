#!/usr/bin/env node
// IIPPT festival poster automation: make poster -> you approve -> post to Facebook + Instagram.
// No npm packages needed. Uses Node 18+ and Microsoft Edge (headless) to render the poster.
//
//   node poster.js list [--days 60]      show upcoming occasions
//   node poster.js make <id>             make one poster now (goes to outbox/)
//   node poster.js upcoming [--days 2]   make posters for everything in the next N days
//   node poster.js approve <id>          move a poster from outbox/ to approved/
//   node poster.js publish [--dry-run]   post approved posters whose date is today (or earlier)
//   node poster.js check-meta            check your Facebook/Instagram token works

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');

const ROOT = __dirname;
const DIRS = {
  outbox: path.join(ROOT, 'outbox'),
  approved: path.join(ROOT, 'approved'),
  posted: path.join(ROOT, 'posted'),
  backgrounds: path.join(ROOT, 'backgrounds'),
  assets: path.join(ROOT, 'assets'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const occasions = JSON.parse(fs.readFileSync(path.join(ROOT, 'occasions.json'), 'utf8')).occasions;

const extras = JSON.parse(fs.readFileSync(path.join(ROOT, 'extras.json'), 'utf8'));

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const baseId = o => o.id.replace(/-\d{4}$/, '');
const extra = o => extras[baseId(o)] || {};
const postTime = o => o.postTime || extra(o).postTime || (config.postTimes || {})[o.theme] || '08:00';
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Auto-pick a background from Openverse, limited to CC0 / public-domain images
// (free to reuse commercially with no attribution). Your own files in backgrounds/ always win.
async function fetchBackground(o, pick = 0) {
  const q = extra(o).q || o.name;
  // WordPress Photo Directory first (modern, unwatermarked photos), then everything else except
  // rawpixel (its previews carry a watermark).
  let list = [];
  for (const src of ['&source=wordpress', '']) {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&size=large&page_size=20${src}`;
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: { 'User-Agent': 'festival-poster-bot/1.0' } }).catch(() => ({ ok: false, status: 'network' }));
      if (res.ok) break;
      await new Promise(r => setTimeout(r, 4000));
    }
    if (!res.ok) { console.log(`  (background search failed: HTTP ${res.status})`); continue; }
    for (const r of (await res.json()).results)
      if (r.width >= 1080 && r.height >= 900 && !/\.gif$/i.test(r.url) && r.source !== 'rawpixel' && !list.some(x => x.id === r.id)) list.push(r);
  }
  for (const r of list.slice(pick)) {
    try {
      const img = await fetch(r.url, { headers: { 'User-Agent': 'festival-poster-bot/1.0' } });
      const type = img.headers.get('content-type') || '';
      if (!img.ok || !/^image\/(jpeg|png|webp)/.test(type)) continue;
      const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
      for (const e of IMG_EXT) fs.rmSync(path.join(DIRS.backgrounds, baseId(o) + e), { force: true });
      const file = path.join(DIRS.backgrounds, baseId(o) + ext);
      fs.writeFileSync(file, Buffer.from(await img.arrayBuffer()));
      fs.writeFileSync(path.join(DIRS.backgrounds, baseId(o) + '.credit.txt'),
        `${r.title || ''}\n${r.creator || ''}\nLicense: ${r.license}\nSource: ${r.foreign_landing_url || r.url}\n`);
      console.log(`  background: "${r.title || q}" (${r.license}, ${r.source})`);
      return file;
    } catch { /* try next */ }
  }
  console.log('  (no suitable background found, using themed backdrop)');
  return null;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function findImage(dir, names) {
  for (const n of names) for (const e of IMG_EXT) {
    const p = path.join(dir, n + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function folderName(o) { return `${o.date}_${o.id}`; }
function findFolder(id) {
  for (const stage of ['outbox', 'approved', 'posted']) {
    const hit = fs.readdirSync(DIRS[stage]).find(f => f.endsWith('_' + id));
    if (hit) return { stage, dir: path.join(DIRS[stage], hit) };
  }
  return null;
}
function getOccasion(id) {
  const o = occasions.find(x => x.id === id);
  if (!o) throw new Error(`No occasion with id "${id}". Run: node poster.js list`);
  return o;
}

// ---------- theme fallbacks (used when no background image is supplied) ----------
const THEMES = {
  festive:   { base: 'linear-gradient(180deg,#0b1340 0%,#2a1650 55%,#4a1d2e 100%)', glow: ['#ffb347', '#ffd27a', '#ff7a3d'] },
  spiritual: { base: 'linear-gradient(180deg,#0d1b4c 0%,#3a1f5c 50%,#7a3b16 100%)', glow: ['#ffcf6b', '#ff9a3d', '#fff0b3'] },
  national:  { base: 'linear-gradient(180deg,#0a1a3f 0%,#13285e 60%,#0a1a3f 100%)', glow: ['#ff9933', '#ffffff', '#138808'] },
  global:    { base: 'linear-gradient(180deg,#0e1c3d 0%,#3b1d4f 55%,#6b2346 100%)', glow: ['#ff8fb1', '#ffd27a', '#b8a4ff'] },
  solemn:    { base: 'linear-gradient(180deg,#0d1424 0%,#1f2a40 60%,#2c2f3f 100%)', glow: ['#e8e6ff', '#c7d2ff', '#ffffff'] },
};
function bokeh(colors) {
  // deterministic sprinkle of soft lights
  const spots = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 26; i++) {
    const c = colors[i % colors.length];
    const x = Math.round(rnd() * 100), y = Math.round(rnd() * 80), r = 20 + Math.round(rnd() * 70);
    spots.push(`radial-gradient(circle ${r}px at ${x}% ${y}%, ${c}55, transparent 70%)`);
  }
  return spots.join(',');
}

// ---------- poster HTML ----------
const ICONS = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm-2.5 7.2L12 7l2.5 2.2V13h-1.7v-2.3h-1.6V13H9.5z"/></svg>',
};

function logoHtml(file, side) {
  if (file) return `<img class="logo ${side}" src="${pathToFileURL(file).href}">`;
  return `<div class="logo ${side} placeholder">${side.toUpperCase()} LOGO<br><small>assets/logo-${side}.png</small></div>`;
}

function buildHtml(o) {
  const bg = findImage(DIRS.backgrounds, [o.id, o.id.replace(/-\d{4}$/, '')]);
  const theme = THEMES[o.theme] || THEMES.festive;
  const bgCss = bg
    ? `url("${pathToFileURL(bg).href}") center/cover no-repeat`
    : `${bokeh(theme.glow)}, ${theme.base}`;
  const left = findImage(DIRS.assets, ['logo-left']);
  const right = findImage(DIRS.assets, ['logo-right']);

  const name = o.name;
  const nameSize = name.length <= 10 ? 150 : name.length <= 16 ? 124 : name.length <= 22 ? 100 : 84;

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Cinzel:wght@600;700&family=Cormorant+Garamond:ital,wght@0,600;1,600&family=Lora:wght@400;600;700&display=block" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1080px;overflow:hidden;background:#0b1340}
  .poster{position:relative;width:1080px;height:1080px;background:${bgCss};font-family:'Cormorant Garamond',Georgia,serif}
  .shade{position:absolute;inset:0;background:
     linear-gradient(180deg,rgba(5,10,35,.75) 0%,rgba(5,10,35,.15) 32%,rgba(5,10,35,0) 48%,rgba(5,10,35,.25) 62%,rgba(5,10,35,.8) 86%)}
  .logo{position:absolute;top:26px;max-height:118px;max-width:430px;object-fit:contain;filter:drop-shadow(0 3px 8px rgba(0,0,0,.5))}
  .logo.left{left:28px}.logo.right{right:28px}
  .placeholder{width:300px;height:110px;border:3px dashed rgba(255,255,255,.7);color:#fff;font:700 20px/1.3 Arial;
     display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:rgba(255,255,255,.08)}
  .placeholder small{font-weight:400;font-size:14px;opacity:.8}
  .title{position:absolute;top:${o.greeting ? 150 : 190}px;left:0;right:0;text-align:center}
  .greet{font-family:Cinzel,Georgia,serif;font-weight:700;font-size:64px;color:#fff8e7;letter-spacing:1px;
     text-shadow:0 3px 14px rgba(0,0,0,.7)}
  .name{font-family:'Great Vibes',Gabriola,cursive;font-size:${nameSize}px;line-height:1.05;margin-top:-6px;padding:0 40px;
     background:linear-gradient(180deg,#fff6c8 0%,#f7d36b 35%,#d9a22b 60%,#fbe08a 85%);-webkit-background-clip:text;background-clip:text;color:transparent;
     filter:drop-shadow(0 4px 6px rgba(0,0,0,.65)) drop-shadow(0 0 18px rgba(255,190,80,.35))}
  .flourish{width:340px;height:2px;margin:6px auto 0;background:linear-gradient(90deg,transparent,#f3c75a,transparent)}
  .msg{position:absolute;left:110px;right:110px;bottom:270px;text-align:center;color:#fff;font-size:38px;line-height:1.25;font-weight:600;
     text-shadow:0 2px 10px rgba(0,0,0,.9)}
  .sig{position:absolute;bottom:196px;left:50%;transform:translateX(-50%);padding:10px 56px;border:2px solid #e8b94a;border-radius:40px;
     background:linear-gradient(180deg,rgba(10,20,60,.85),rgba(20,30,80,.85));color:#fff;font-style:italic;font-size:38px;font-weight:600;white-space:nowrap;
     box-shadow:0 0 18px rgba(232,185,74,.45)}
  .sig b{color:#f3c75a}
  .footer{position:absolute;left:0;right:0;bottom:0;height:150px;background:#fbf8f1;display:flex;align-items:center;justify-content:space-around;padding:30px 40px 0}
  .pill{position:absolute;top:-28px;left:50%;transform:translateX(-50%);background:#14224f;color:#fff;font:600 27px/1 Lora,Georgia,serif;
     padding:14px 34px;border-radius:30px;border:2px solid #e8b94a;white-space:nowrap}
  .item{display:flex;align-items:center;gap:14px;color:#111;font-family:Lora,Georgia,serif}
  .ic{width:52px;height:52px;border-radius:50%;background:#111;display:flex;align-items:center;justify-content:center;flex:none}
  .ic svg{width:32px;height:32px}
  .item .t1{font-size:20px}.item .t2{font-size:25px;font-weight:700}
  .item.big .t2{font-size:32px}
  .item.addr .t2{font-size:20px;font-weight:600;max-width:240px;line-height:1.25}
  .sep{width:2px;height:70px;background:#d8b25a}
</style></head><body>
<div class="poster">
  <div class="shade"></div>
  ${logoHtml(left, 'left')}
  ${logoHtml(right, 'right')}
  <div class="title">
    ${o.greeting ? `<div class="greet">${esc(o.greeting)}</div>` : ''}
    <div class="name">${esc(name)}</div>
    <div class="flourish"></div>
  </div>
  <div class="msg">${esc(o.message)}</div>
  <div class="sig">${esc(config.signature).replace(esc(config.collegeShort), `<b>${esc(config.collegeShort)}</b>`)}</div>
  <div class="footer">
    <div class="pill">${esc(config.contactHeading)}</div>
    <div class="item"><div class="ic">${ICONS.globe}</div><div><div class="t1">${esc(config.websiteLabel)}</div><div class="t2">${esc(config.website)}</div></div></div>
    <div class="sep"></div>
    <div class="item big"><div class="ic">${ICONS.phone}</div><div class="t2">${esc(config.phone)}</div></div>
    <div class="sep"></div>
    <div class="item addr"><div class="ic">${ICONS.pin}</div><div class="t2">${esc(config.address)}</div></div>
  </div>
</div></body></html>`;
}

function buildCaption(o) {
  const emoji = { festive: '✨🪔', spiritual: '🙏', national: '🇮🇳', global: '💐', solemn: '🕊️' }[o.theme] || '✨';
  const tags = [...(o.hashtags || []), ...(config.extraHashtags || [])].map(t => '#' + t.replace(/^#/, '')).join(' ');
  return `${o.greeting ? o.greeting + ' ' : ''}${o.name} ${emoji}

${o.message}

— ${config.signature}

🌐 ${config.websiteLabel}: ${config.website}
📞 ${config.phone}
📍 ${config.address}

${tags}`;
}

function render(htmlFile, pngFile) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-edge-'));
  try {
    execFileSync(process.env.BROWSER_PATH || config.edgePath, [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--virtual-time-budget=8000',
      '--window-size=1080,1080', `--screenshot=${pngFile}`, pathToFileURL(htmlFile).href,
    ], { stdio: 'ignore', timeout: 60000 });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (!fs.existsSync(pngFile)) throw new Error('Edge did not produce a screenshot');
}

async function make(o, newBg) {
  const haveBg = findImage(DIRS.backgrounds, [o.id, baseId(o)]);
  const prev = findFolder(o.id);
  const pickFile = prev ? path.join(prev.dir, 'bg-pick.txt') : null;
  let pick = 0;
  if (newBg === 'next') pick = (pickFile && fs.existsSync(pickFile) ? Number(fs.readFileSync(pickFile, 'utf8')) : 0) + 1;
  else if (newBg !== undefined) pick = Number(newBg);
  if (!haveBg || newBg !== undefined) await fetchBackground(o, pick);
  const existing = findFolder(o.id);
  const dir = existing && existing.stage === 'outbox' ? existing.dir : path.join(DIRS.outbox, folderName(o));
  if (existing && existing.stage !== 'outbox') { console.log(`skip ${o.id}: already ${existing.stage}`); return null; }
  fs.mkdirSync(dir, { recursive: true });
  const html = path.join(dir, 'poster.html');
  const png = path.join(dir, 'poster.png');
  fs.writeFileSync(html, buildHtml(o));
  fs.writeFileSync(path.join(dir, 'caption.txt'), buildCaption(o));
  fs.writeFileSync(path.join(dir, 'occasion.json'), JSON.stringify(o, null, 2));
  fs.writeFileSync(path.join(dir, 'review.txt'),
    `Occasion : ${o.name}\nDate     : ${o.date}${o.verify ? '   <-- lunar date, check a panchang' : ''}\nPosts at : ${postTime(o)} on that day (Facebook + Instagram)\n` +
    `Song     : ${extra(o).song || '-'}\n           (Meta's API can't attach music. Add it in the Instagram app if you want it.)\n` +
    `Approve  : node poster.js approve ${o.id}\nNew bg   : node poster.js make ${o.id} --new-bg 1   (2, 3... for more options)\n`);
  fs.writeFileSync(path.join(dir, 'bg-pick.txt'), String(pick));
  render(html, png);
  console.log(`made ${o.date} ${o.name} -> posts ${postTime(o)}${o.verify ? '  (lunar date: verify!)' : ''}\n  -> ${path.relative(ROOT, png)}`);
  return dir;
}

// ---------- Meta Graph API ----------
function secrets() {
  if (process.env.PAGE_ACCESS_TOKEN) return {
    graph_version: process.env.GRAPH_VERSION || 'v23.0',
    page_id: process.env.PAGE_ID,
    ig_user_id: process.env.IG_USER_ID,
    page_access_token: process.env.PAGE_ACCESS_TOKEN,
  };
  const f = path.join(ROOT, 'secrets.json');
  if (!fs.existsSync(f)) throw new Error('secrets.json missing. Copy secrets.example.json to secrets.json and fill it in.');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
async function graph(method, p, params, s, body) {
  const url = new URL(`https://graph.facebook.com/${s.graph_version || 'v23.0'}/${p}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${s.page_access_token}` },
    body,
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph ${method} ${p}: ${JSON.stringify(json.error || json)}`);
  return json;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function publishOne(dir, dry) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, 'occasion.json'), 'utf8'));
  const caption = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8');
  const png = path.join(dir, 'poster.png');
  if (dry) { console.log(`[dry-run] would post ${o.name} (${o.date})`); return; }
  const s = secrets();
  const log = {};

  // 1) Facebook Page photo
  const fd = new FormData();
  fd.append('source', new Blob([fs.readFileSync(png)], { type: 'image/png' }), 'poster.png');
  fd.append('message', caption);
  const fb = await graph('POST', `${s.page_id}/photos`, null, s, fd);
  log.facebook = fb;
  console.log(`Facebook posted: ${fb.post_id || fb.id}`);

  // 2) Instagram needs a public image URL -> reuse the Facebook-hosted copy
  const photo = await graph('GET', fb.id, { fields: 'images' }, s);
  const imageUrl = photo.images.sort((a, b) => b.width - a.width)[0].source;
  const container = await graph('POST', `${s.ig_user_id}/media`, { image_url: imageUrl, caption }, s);
  for (let i = 0; i < 20; i++) {
    const st = await graph('GET', container.id, { fields: 'status_code' }, s);
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR') throw new Error('Instagram could not process the image');
    await sleep(3000);
  }
  const ig = await graph('POST', `${s.ig_user_id}/media_publish`, { creation_id: container.id }, s);
  log.instagram = ig;
  console.log(`Instagram posted: ${ig.id}`);

  fs.writeFileSync(path.join(dir, 'posted.json'), JSON.stringify({ at: new Date().toISOString(), ...log }, null, 2));
  fs.renameSync(dir, path.join(DIRS.posted, path.basename(dir)));
}

// ---------- CLI ----------
(async () => {
  const cmd = process.argv[2];
  const t = today();
  if (cmd === 'list') {
    const until = addDays(t, Number(arg('--days', 60)));
    for (const o of occasions.filter(o => o.date >= t && o.date <= until)) {
      const f = findFolder(o.id);
      console.log(`${o.date} ${postTime(o)}  ${o.id.padEnd(28)} ${(f ? f.stage : '-').padEnd(9)} ${o.verify ? 'verify date' : ''}`);
    }
  } else if (cmd === 'make') {
    await make(getOccasion(process.argv[3]), arg('--new-bg'));
  } else if (cmd === 'upcoming') {
    const until = addDays(t, Number(arg('--days', config.daysAhead)));
    const due = occasions.filter(o => o.date >= t && o.date <= until && !findFolder(o.id));
    if (!due.length) console.log('Nothing new to make.');
    const made = [];
    for (const o of due) if (await make(o)) made.push(o.id);
    if (arg('--emit')) fs.writeFileSync(arg('--emit'), made.join('\n'));
  } else if (cmd === 'approve') {
    const f = findFolder(process.argv[3]);
    if (!f || f.stage !== 'outbox') throw new Error('Not found in outbox/');
    fs.renameSync(f.dir, path.join(DIRS.approved, path.basename(f.dir)));
    console.log(`approved ${process.argv[3]} — it will post on its date`);
  } else if (cmd === 'publish') {
    const dry = process.argv.includes('--dry-run');
    const now = nowHHMM();
    const ready = [];
    for (const f of fs.readdirSync(DIRS.approved)) {
      const o = JSON.parse(fs.readFileSync(path.join(DIRS.approved, f, 'occasion.json'), 'utf8'));
      if (o.date < t) console.log(`skip ${o.id}: its date (${o.date}) has passed, a late wish looks odd. Delete or re-date it.`);
      else if (o.date === t && now >= postTime(o)) ready.push(f);
      else if (o.date === t) console.log(`waiting: ${o.id} posts at ${postTime(o)}`);
    }
    if (!ready.length) console.log('Nothing due right now.');
    const done = [];
    for (const f of ready) {
      try { await publishOne(path.join(DIRS.approved, f), dry); done.push(f.slice(11)); }
      catch (e) { console.error(`FAILED ${f}: ${e.message}`); process.exitCode = 1; }
    }
    if (arg('--emit')) fs.writeFileSync(arg('--emit'), done.join('\n'));
  } else if (cmd === 'check-meta') {
    const s = secrets();
    const page = await graph('GET', s.page_id, { fields: 'name,instagram_business_account' }, s);
    console.log(`Page: ${page.name}`);
    console.log(`Linked Instagram id: ${page.instagram_business_account ? page.instagram_business_account.id : 'NONE'}`);
    if (page.instagram_business_account && page.instagram_business_account.id !== s.ig_user_id)
      console.log('WARNING: ig_user_id in secrets.json does not match the linked account above.');
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 11).join('\n'));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
