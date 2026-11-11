// بوابة الدفع. mock = صفحة دفع تجريبية. stripe = Stripe Checkout.
// لبوابة محلية (مثل HyperPay أو Tap أو ZainCash) اكتب دالتين بنفس الشكل: createCheckout و verify.
const E = process.env;
const dec = +(E.CURRENCY_DECIMALS || 2);
async function createCheckout(order) {
  const ret = `${E.BASE_URL}/api/payments/return?order=${order.id}`;
  if (E.PAYMENT_PROVIDER === 'stripe') {
    const p = new URLSearchParams({
      mode: 'payment', success_url: ret + '&session_id={CHECKOUT_SESSION_ID}', cancel_url: `${E.BASE_URL}/?order=${order.id}#customer`,
      'metadata[order_id]': order.id });
    order.items.forEach((it, i) => {
      p.set(`line_items[${i}][quantity]`, it.qty);
      p.set(`line_items[${i}][price_data][currency]`, E.PAYMENT_CURRENCY || 'usd');
      p.set(`line_items[${i}][price_data][unit_amount]`, Math.round(it.price * 10 ** dec));
      p.set(`line_items[${i}][price_data][product_data][name]`, order.lang === 'en' ? it.en : it.ar);
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', body: p,
      headers: { Authorization: `Bearer ${E.STRIPE_SECRET}` } });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'stripe');
    return j.url;
  }
  return `${E.BASE_URL}/api/payments/mock?order=${order.id}`;
}
async function verify(query) {
  if (E.PAYMENT_PROVIDER === 'stripe') {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(query.session_id)}`,
      { headers: { Authorization: `Bearer ${E.STRIPE_SECRET}` } });
    const j = await r.json();
    return j.payment_status === 'paid' && j.metadata?.order_id === query.order;
  }
  return query.mock === 'paid';
}
module.exports = { createCheckout, verify };
