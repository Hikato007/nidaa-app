// جسر نظام الكاشير (POS). لا يوجد معيار موحد بين أنظمة POS، لذلك:
// 1) pushOrder: عندما يدفع العميل إلكترونياً نرسل الطلب لنظامك ليُسجَّل في المبيعات والمطبخ.
// 2) normalizeWebhook: عندما يُدفع طلب على POS (نقداً مثلاً) يرسله POS إلينا فيظهر رقمه وتصل الرسالة.
// عدّل الحقول هنا حسب وثائق API نظامك (Foodics، Square، Loyverse، Odoo POS …).
const E = process.env;
async function pushOrder(order) {
  if (E.POS_PROVIDER !== 'webhook' || !E.POS_PUSH_URL) return;
  try {
    const r = await fetch(E.POS_PUSH_URL, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E.POS_TOKEN}` },
      body: JSON.stringify({ reference: order.id, number: order.number, paid: true, method: order.method,
        total: order.total, phone: order.phone,
        items: order.items.map(i => ({ sku: i.id, name: i.en, qty: i.qty, price: i.price })) }) });
    if (!r.ok) throw new Error('POS ' + r.status);
  } catch (e) { console.error('POS push failed:', e.message) }
}
// شكل متوقع (عدّله): { items:[{sku,qty}], phone, lang, paid:true, reference }
function normalizeWebhook(body) {
  return { items: (body.items || []).map(i => ({ id: i.sku || i.id, qty: i.qty || i.quantity })),
    phone: body.phone || body.customer?.phone, lang: body.lang || 'ar', paid: body.paid !== false, ref: body.reference };
}
module.exports = { pushOrder, normalizeWebhook };
