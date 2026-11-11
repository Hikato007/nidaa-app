// منطق الطلبات — نفس منطق الواجهة (index.html → Core) حتى تتطابق النسخة التجريبية مع الفعلية.
const SMS = {
  ar: { paid: '{s}: استلمنا طلبك رقم {n}. الوقت المتوقع {m} دقيقة. ختم {st}/{g}. تابع طلبك: {link}',
        ready: '{s}: طلبك رقم {n} جاهز، تفضّل للكاونتر.',
        time: '{s}: طلبك رقم {n} يحتاج {m} دقائق إضافية. نعتذر عن الانتظار.',
        reward: '{s}: مبروك! حصلت على مشروب مجاني.' },
  en: { paid: '{s}: We got your order #{n}. About {m} min. Stamp {st}/{g}. Track: {link}',
        ready: '{s}: Order #{n} is ready at the counter.',
        time: '{s}: Order #{n} needs {m} more minutes. Sorry for the wait.',
        reward: '{s}: Congrats! You earned a free drink.' }
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` };
const rid = () => require('crypto').randomBytes(9).toString('base64url');
const ref = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; for (let i = 0; i < 4; i++) r += a[require('crypto').randomInt(a.length)]; return r };
const normPhone = p => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 8 ? d : null };

function smsText(db, key, o, vars) {
  let s = (SMS[o.lang] || SMS.ar)[key];
  const all = { s: o.lang === 'en' ? db.settings.storeNameEn : db.settings.storeName, n: o.number,
    link: `${process.env.BASE_URL || ''}/?order=${o.id}#customer`, ...vars };
  for (const k in all) s = s.split(`{${k}}`).join(all[k]);
  return s;
}

module.exports = (hooks) => {
  // hooks: { sms(to,text), onPaid(order, customer), onLoyalty(phone, customer) }
  const send = (db, to, text) => { db.sms.unshift({ to, text, at: Date.now() }); db.sms = db.sms.slice(0, 500); hooks.sms(to, text) };
  return {
    normPhone,
    createOrder(db, { items, phone, pay, lang, source }) {
      const lines = (items || []).map(i => { const m = db.menu.find(x => x.id === i.id);
        return m && i.qty > 0 ? { id: m.id, ar: m.ar, en: m.en, price: m.price, prep: m.prep, qty: Math.min(20, i.qty | 0) } : null }).filter(Boolean);
      if (!lines.length) throw Object.assign(new Error('empty'), { status: 400 });
      const p = normPhone(phone); if (!p) throw Object.assign(new Error('phone'), { status: 400 });
      const o = { id: rid(), ref: ref(), items: lines, total: +lines.reduce((s, l) => s + l.price * l.qty, 0).toFixed(3),
        phone: p, pay: pay === 'online' ? 'online' : 'counter', lang: lang === 'en' ? 'en' : 'ar', source: source || 'qr',
        status: 'awaiting_payment', number: null, createdAt: Date.now(), paidAt: null, etaAt: null, estMin: null, extraMin: 0, readyAt: null };
      db.orders.push(o); return o;
    },
    markPaid(db, id, method) {
      const o = db.orders.find(x => x.id === id); if (!o || o.status !== 'awaiting_payment') return o;
      if (db.seq.day !== today()) db.seq = { day: today(), n: 0 };
      const ahead = db.orders.filter(x => x.status === 'preparing').length;
      o.number = ++db.seq.n; o.paidAt = Date.now(); o.method = method || o.pay;
      o.estMin = Math.max(...o.items.map(i => i.prep)) + Math.min(ahead, 10) * (+db.settings.perOrderMin || 0);
      o.etaAt = o.paidAt + o.estMin * 60000; o.status = 'preparing';
      const c = db.customers[o.phone] || (db.customers[o.phone] = { stamps: 0, rewards: 0, visits: 0 });
      c.stamps++; c.visits++; let rewarded = false;
      const g = +db.settings.goal || 8; if (c.stamps >= g) { c.stamps -= g; c.rewards++; rewarded = true }
      send(db, o.phone, smsText(db, 'paid', o, { m: o.estMin, st: c.stamps, g }));
      if (rewarded) send(db, o.phone, smsText(db, 'reward', o, {}));
      hooks.onPaid(o); hooks.onLoyalty(o.phone, { ...c, goal: g });
      return o;
    },
    addTime(db, id, min) {
      const o = db.orders.find(x => x.id === id); if (!o || o.status !== 'preparing') return o;
      min = Math.max(1, Math.min(60, min | 0));
      o.etaAt = Math.max(o.etaAt, Date.now()) + min * 60000; o.extraMin += min;
      if (min >= 5) send(db, o.phone, smsText(db, 'time', o, { m: min }));
      return o;
    },
    markReady(db, id) { const o = db.orders.find(x => x.id === id); if (!o || o.status !== 'preparing') return o;
      o.status = 'ready'; o.readyAt = Date.now(); send(db, o.phone, smsText(db, 'ready', o, {})); return o },
    markPicked(db, id) { const o = db.orders.find(x => x.id === id); if (!o || o.status !== 'ready') return o;
      o.status = 'picked'; o.pickedAt = Date.now(); return o },
    loyalty(db, phone) { const c = db.customers[phone] || { stamps: 0, rewards: 0, visits: 0 }; return { ...c, goal: +db.settings.goal || 8 } },
    todays(db) { const s = new Date(); s.setHours(0, 0, 0, 0); return db.orders.filter(o => o.createdAt >= s.getTime()) }
  };
};
