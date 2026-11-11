// مزود الرسائل النصية. تحقق من وثائق مزودك قبل التشغيل (الحقول قد تختلف حسب الحساب والدولة).
const E = process.env;
async function send(to, text) {
  try {
    switch (E.SMS_PROVIDER) {
      case 'twilio': {
        const body = new URLSearchParams({ To: to, From: E.TWILIO_FROM, Body: text });
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_SID}/Messages.json`, {
          method: 'POST', body,
          headers: { Authorization: 'Basic ' + Buffer.from(`${E.TWILIO_SID}:${E.TWILIO_TOKEN}`).toString('base64') } });
        if (!r.ok) throw new Error('twilio ' + r.status + ' ' + await r.text());
        break;
      }
      case 'unifonic': {
        const body = new URLSearchParams({ AppSid: E.UNIFONIC_APPSID, SenderID: E.UNIFONIC_SENDER, Recipient: to.replace(/\D/g, ''), Body: text });
        const r = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', { method: 'POST', body });
        if (!r.ok) throw new Error('unifonic ' + r.status);
        break;
      }
      case 'http': { // أي مزود محلي
        const r = await fetch(E.SMS_HTTP_URL, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E.SMS_HTTP_TOKEN}` },
          body: JSON.stringify({ to, text }) });
        if (!r.ok) throw new Error('sms http ' + r.status);
        break;
      }
      default: console.log(`[SMS → ${to}] ${text}`);
    }
  } catch (e) { console.error('SMS failed:', e.message) } // لا نوقف الطلب إذا فشلت الرسالة
}
module.exports = { send };
