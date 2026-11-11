// Google Wallet — بطاقة ولاء. يحتاج: حساب Google Pay & Wallet Console (Issuer ID) + Service Account JSON.
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');
const E = process.env;
let sa; const SA = () => sa || (sa = require(require('path').resolve(E.GOOGLE_SA_JSON)));
const classId = () => `${E.GOOGLE_ISSUER_ID}.${E.GOOGLE_CLASS_SUFFIX || 'loyalty_v1'}`;
const objectId = phone => `${E.GOOGLE_ISSUER_ID}.c_${crypto.createHash('sha256').update(phone).digest('hex').slice(0, 24)}`;
const enabled = () => !!(E.GOOGLE_ISSUER_ID && E.GOOGLE_SA_JSON);

function buildClass(settings) {
  return { id: classId(), issuerName: settings.storeNameEn, programName: settings.storeName,
    programLogo: { sourceUri: { uri: E.LOGO_URL } }, hexBackgroundColor: '#1D5A47', reviewStatus: 'UNDER_REVIEW' };
}
function buildObject(phone, L) {
  return { id: objectId(phone), classId: classId(), state: 'ACTIVE', accountId: phone, accountName: phone,
    loyaltyPoints: { label: 'Stamps / أختام', balance: { string: `${L.stamps}/${L.goal}` } },
    secondaryLoyaltyPoints: { label: 'Free drinks / مجاني', balance: { int: L.rewards } },
    barcode: { type: 'QR_CODE', value: phone } };
}
// رابط "Save to Google Wallet" — ينشئ البطاقة والفئة عند أول ضغطة
function saveUrl(settings, phone, L) {
  const token = jwt.sign({ iss: SA().client_email, aud: 'google', typ: 'savetowallet', origins: [E.BASE_URL],
    payload: { loyaltyClasses: [buildClass(settings)], loyaltyObjects: [buildObject(phone, L)] } },
    SA().private_key, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}
// تحديث عدد الأختام — يصل للجوال تلقائياً
async function update(phone, L) {
  if (!enabled()) return;
  try {
    const auth = new GoogleAuth({ credentials: SA(), scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
    const client = await auth.getClient();
    await client.request({ url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId(phone)}`,
      method: 'PATCH', data: { loyaltyPoints: buildObject(phone, L).loyaltyPoints, secondaryLoyaltyPoints: buildObject(phone, L).secondaryLoyaltyPoints } });
  } catch (e) { if (e.response?.status !== 404) console.error('Google Wallet update:', e.message) } // 404 = العميل لم يضف البطاقة
}
module.exports = { saveUrl, update, enabled };
