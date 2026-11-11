// خادم نداء — شغّله بـ: npm install ثم npm start
const fs = require('fs'), path = require('path');
// تحميل ملف .env بدون مكتبات إضافية
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim() } } catch {}

const express = require('express');
const store = require('./lib/store');
const sms = require('./adapters/sms');
const pay = require('./adapters/payments');
const pos = require('./adapters/pos');
const gw = require('./adapters/googleWallet');
const aw = require('./adapters/appleWallet');

const db = store.load();
const core = require('./lib/core')({
  sms: (to, text) => sms.send(to, text),
  onPaid: o => { if (o.method === 'online' && o.source !== 'pos') pos.pushOrder(o) },
  onLoyalty: (phone, L) => {
    gw.update(phone, L);
    const serial = aw.serialFor(phone);
    aw.push((db.appleDevices[serial] || []).map(d => d.pushToken));
    (db.passUpdated ||= {})[serial] = Date.now();
  }
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PIN = () => process.env.CASHIER_PIN || '1234';
const staff = (req, res, next) => req.get('x-pin') === PIN() ? next() : res.status(401).json({ error: 'pin' });
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).then(r => { store.save(); if (r !== undefined && !res.headersSent) res.json(r) })
  .catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.message }) });

// حد بسيط لمنع إغراق إنشاء الطلبات
const hits = new Map();
const limit = (req, res, next) => { const k = req.ip, now = Date.now(); const a = (hits.get(k) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(k, a); a.length > 15 ? res.status(429).json({ error: 'slow down' }) : next() };

/* ---------- العميل ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/state', (req, res) => res.json({ settings: db.settings, menu: db.menu }));
app.post('/api/orders', limit, wrap(async req => {
  const o = core.createOrder(db, req.body);
  if (o.pay === 'online') return { order: o, paymentUrl: await pay.createCheckout(o) };
  return { order: o };
}));
app.get('/api/orders/:id', wrap(req => db.orders.find(o => o.id === req.params.id) || null));
app.get('/api/loyalty/:phone', wrap(req => core.loyalty(db, core.normPhone(req.params.phone))));
app.post('/api/orders/:id/feedback', limit, wrap(req => {
  const o = db.orders.find(x => x.id === req.params.id); if (!o) return { ok: false };
  db.feedback.unshift({ text: String(req.body.text || '').slice(0, 1000), number: o.number, phone: o.phone, at: Date.now() });
  return { ok: true };
}));

/* ---------- الدفع ---------- */
app.get('/api/payments/return', wrap(async (req, res) => {
  if (await pay.verify(req.query)) core.markPaid(db, req.query.order, 'online');
  res.redirect(`/?order=${encodeURIComponent(req.query.order)}#customer`);
}));
app.get('/api/payments/mock', (req, res) => { // صفحة دفع تجريبية عندما PAYMENT_PROVIDER=mock
  const id = encodeURIComponent(req.query.order);
  res.send(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center">
  <h2>Mock payment</h2><a style="display:inline-block;padding:14px 24px;background:#1D5A47;color:#fff;border-radius:12px;text-decoration:none"
  href="/api/payments/return?order=${id}&mock=paid">Pay</a></body>`);
});

/* ---------- الكاشير ---------- */
app.get('/api/cashier/orders', staff, wrap(() => core.todays(db)));
app.post('/api/cashier/orders/:id/:action', staff, wrap(req => {
  const { id, action } = req.params;
  if (action === 'paid') { const o = core.markPaid(db, id, 'counter'); return o }
  if (action === 'time') return core.addTime(db, id, +req.body.min || 5);
  if (action === 'ready') return core.markReady(db, id);
  if (action === 'picked') return core.markPicked(db, id);
  throw Object.assign(new Error('bad action'), { status: 400 });
}));
app.get('/api/admin/log', staff, (req, res) => res.json({ sms: db.sms.slice(0, 200), feedback: db.feedback.slice(0, 200) }));
app.put('/api/admin/settings', staff, wrap(req => {
  const b = req.body, s = db.settings;
  for (const k of ['storeName', 'storeNameEn', 'reviewUrl', 'currency', 'currencyEn']) if (typeof b[k] === 'string') s[k] = b[k].slice(0, 300);
  if (b.goal) s.goal = Math.max(1, Math.min(50, b.goal | 0));
  if (b.perOrderMin !== undefined) s.perOrderMin = Math.max(0, Math.min(10, +b.perOrderMin || 0));
  return s;
}));
app.put('/api/admin/menu', staff, wrap(req => { if (Array.isArray(req.body)) db.menu = req.body; return db.menu }));

/* ---------- POS → نداء: طلب دُفع على جهاز الكاشير ---------- */
app.post('/api/pos/webhook', wrap(req => {
  if (!process.env.POS_WEBHOOK_SECRET || req.get('x-pos-secret') !== process.env.POS_WEBHOOK_SECRET)
    throw Object.assign(new Error('forbidden'), { status: 403 });
  const n = pos.normalizeWebhook(req.body);
  const o = core.createOrder(db, { items: n.items, phone: n.phone, pay: 'counter', lang: n.lang, source: 'pos' });
  return n.paid ? core.markPaid(db, o.id, 'counter') : o; // يرجع رقم الطلب لطباعته على الفاتورة
}));

/* ---------- Google Wallet ---------- */
app.get('/api/wallet/google/:phone', wrap(req => {
  if (!gw.enabled()) throw Object.assign(new Error('google wallet not configured'), { status: 501 });
  const p = core.normPhone(req.params.phone); return { url: gw.saveUrl(db.settings, p, core.loyalty(db, p)) };
}));

/* ---------- Apple Wallet ---------- */
app.get('/api/wallet/apple/:phone', wrap(async (req, res) => {
  if (!aw.enabled()) throw Object.assign(new Error('apple wallet not configured'), { status: 501 });
  const p = core.normPhone(req.params.phone);
  (db.passPhones ||= {})[aw.serialFor(p)] = p;
  res.type('application/vnd.apple.pkpass').send(await aw.build(db.settings, p, core.loyalty(db, p)));
}));
// خدمة الويب الخاصة بـ Apple Wallet (تسجيل الأجهزة وجلب آخر نسخة)
const appleAuth = (req, res, next) => (req.get('Authorization') === `ApplePass ${aw.authTokenFor(req.params.serial)}`) ? next() : res.sendStatus(401);
app.post('/api/apple/v1/devices/:device/registrations/:type/:serial', appleAuth, (req, res) => {
  const list = db.appleDevices[req.params.serial] ||= [];
  const exists = list.find(d => d.device === req.params.device);
  if (!exists) list.push({ device: req.params.device, pushToken: req.body.pushToken }); else exists.pushToken = req.body.pushToken;
  store.save(); res.sendStatus(exists ? 200 : 201);
});
app.delete('/api/apple/v1/devices/:device/registrations/:type/:serial', appleAuth, (req, res) => {
  db.appleDevices[req.params.serial] = (db.appleDevices[req.params.serial] || []).filter(d => d.device !== req.params.device);
  store.save(); res.sendStatus(200);
});
app.get('/api/apple/v1/devices/:device/registrations/:type', (req, res) => {
  const since = +req.query.passesUpdatedSince || 0;
  const serials = Object.entries(db.appleDevices).filter(([s, l]) => l.some(d => d.device === req.params.device))
    .map(([s]) => s).filter(s => ((db.passUpdated || {})[s] || 0) > since);
  serials.length ? res.json({ serialNumbers: serials, lastUpdated: String(Date.now()) }) : res.sendStatus(204);
});
app.get('/api/apple/v1/passes/:type/:serial', appleAuth, wrap(async (req, res) => {
  const p = (db.passPhones || {})[req.params.serial]; if (!p) return res.sendStatus(404);
  res.type('application/vnd.apple.pkpass').send(await aw.build(db.settings, p, core.loyalty(db, p)));
}));
app.post('/api/apple/v1/log', (req, res) => { console.log('Apple Wallet log:', req.body); res.sendStatus(200) });

setInterval(store.prune, 6 * 3600e3);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Nidaa running on :${port}  (customer: /#customer  cashier: /#cashier)`));
