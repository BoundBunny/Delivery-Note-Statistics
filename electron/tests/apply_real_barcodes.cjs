const fs = require('fs');
const path = require('path');
const os = require('os');
const appData = process.env.APPDATA;
const dir = path.join(appData, 'songhuodan-desktop', '用户数据');
const file = path.join(dir, 'sd_v1_products.json');
const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'js', 'seed-barcodes.js'), 'utf8');
const sandbox = {};
new Function('window', src)(sandbox);
const MAP = sandbox.SEED_BARCODES || {};
const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(arr)) throw new Error('products file is not array');
const used = new Set(arr.filter(p => p && p.barcode).map(p => String(p.barcode).trim()));
const changed = [];
for (const p of arr) {
  if (!p || p.barcode || p.category !== 'tobacco') continue;
  const rec = MAP[String(p.name || '').trim()];
  const code = rec && String(rec[String(p.unit || '').trim()] || '').trim();
  if (code && !used.has(code)) { p.barcode = code; used.add(code); changed.push([p.name, p.unit, code]); }
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = path.join(dir, 'sd_v1_products.条码补全前-' + stamp + '.json');
fs.copyFileSync(file, backup);
fs.writeFileSync(file, JSON.stringify(arr), 'utf8');
const tobacco = arr.filter(p => p.category === 'tobacco');
console.log('CHANGED', changed.length, 'TOBACCO', tobacco.length, 'FILLED', tobacco.filter(p => p.barcode).length);
console.log('BACKUP', backup);
console.log(JSON.stringify(changed.slice(0, 5)));
