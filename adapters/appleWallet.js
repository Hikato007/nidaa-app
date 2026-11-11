// Apple Wallet — بطاقة ولاء .pkpass مع تحديث تلقائي عبر APNs.
// يحتاج: حساب Apple Developer + Pass Type ID + شهادة التوقيع + شهادة WWDR (انظر README).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), http2 = require('http2');
const { PKPass } = require('passkit-generator');
const E = process.env;
const enabled = () => !!(E.APPLE_PASS_TYPE_ID && E.APPLE_TEAM_ID && fs.existsSync(E.APPLE_SIGNER_CERT || ''));
const serialFor = phone => crypto.createHash('sha256').update('nidaa:' + phone).digest('hex').slice(0, 32);
const authTokenFor = serial => crypto.createHmac('sha256', E.APPLE_SIGNER_PASS || E.CASHIER_PIN || 'nidaa').update(serial).digest('hex');

async function build(settings, phone, L) {
  const serial = serialFor(phone);
  const pass = await PKPass.from({
    model: path.join(__dirname, '..', 'models', 'loyalty.pass'),
    certificates: { wwdr: fs.readFileSync(E.APPLE_WWDR), signerCert: fs.readFileSync(E.APPLE_SIGNER_CERT),
      signerKey: fs.readFileSync(E.APPLE_SIGNER_KEY), signerKeyPassphrase: E.APPLE_SIGNER_PASS } },
  { serialNumber: serial, passTypeIdentifier: E.APPLE_PASS_TYPE_ID, teamIdentifier: E.APPLE_TEAM_ID,
    organizationName: settings.storeNameEn, description: `${settings.storeNameEn} loyalty`,
    webServiceURL: `${E.BASE_URL}/api/apple`, authenticationToken: authTokenFor(serial) });
  pass.primaryFields.push({ key: 'stamps', label: 'أختام / Stamps', value: `${L.stamps}/${L.goal}`, changeMessage: 'أختامك الآن %@' });
  pass.secondaryFields.push({ key: 'rewards', label: 'مجاني / Free', value: L.rewards });
  pass.backFields.push({ key: 'store', label: settings.storeNameEn, value: settings.storeName });
  pass.setBarcodes({ message: phone, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' });
  return pass.getAsBuffer();
}
// إشعار الجهاز بأن البطاقة تغيّرت → يطلب النسخة الجديدة من /api/apple/v1/passes/...
function push(tokens) {
  if (!tokens.length || !enabled()) return;
  const c = http2.connect('https://api.push.apple.com', { cert: fs.readFileSync(E.APPLE_SIGNER_CERT),
    key: fs.readFileSync(E.APPLE_SIGNER_KEY), passphrase: E.APPLE_SIGNER_PASS });
  c.on('error', e => console.error('APNs:', e.message));
  let left = tokens.length;
  for (const t of tokens) {
    const r = c.request({ ':method': 'POST', ':path': `/3/device/${t}`, 'apns-topic': E.APPLE_PASS_TYPE_ID });
    r.on('response', () => {}); r.on('close', () => { if (--left === 0) c.close() }); r.end('{}');
  }
}
module.exports = { build, push, enabled, serialFor, authTokenFor };
