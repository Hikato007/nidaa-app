// تخزين بسيط في ملف JSON — مناسب لفرع واحد. للإنتاج متعدد الفروع انقل نفس البنية إلى PostgreSQL.
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
const DEFAULT = {
  settings: { storeName: 'مقهى المساء', storeNameEn: 'Al Masa Café',
    reviewUrl: 'https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID',
    currency: 'د.أ', currencyEn: 'JOD', goal: 8, perOrderMin: 1 },
  menu: require('./menu.json'),
  orders: [], customers: {}, sms: [], feedback: [], seq: { day: '', n: 0 },
  appleDevices: {} // serial -> [{device, pushToken}]
};
let db;
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { db = JSON.parse(JSON.stringify(DEFAULT)) }
  for (const k in DEFAULT) if (db[k] === undefined) db[k] = DEFAULT[k];
  return db;
}
let timer;
function save() { clearTimeout(timer); timer = setTimeout(() => {
  const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE);
}, 50) }
function prune() { const cut = Date.now() - 7 * 864e5; db.orders = db.orders.filter(o => o.createdAt > cut); save() }
module.exports = { load, save, prune };
