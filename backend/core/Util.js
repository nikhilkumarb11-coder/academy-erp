class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const Util = (() => {
  const props = () => PropertiesService.getScriptProperties();
  let propCache = null; // per-execution copy; each service call costs a round trip
  let zone = null;

  function allProps() {
    if (!propCache) propCache = props().getProperties();
    return propCache;
  }

  function prop(key, required) {
    const value = allProps()[key] || null;
    if (required && !value) throw new AppError('CONFIG', `Script Property ${key} is not set`);
    return value;
  }

  function setProp(key, value) {
    props().setProperty(key, String(value));
    if (propCache) propCache[key] = String(value);
  }

  function setProps(values) {
    const clean = {};
    Object.keys(values).forEach((k) => { clean[k] = String(values[k]); });
    props().setProperties(clean);
    if (propCache) Object.assign(propCache, clean);
  }

  function tz() {
    if (!zone) zone = Session.getScriptTimeZone() || 'Asia/Kolkata';
    return zone;
  }

  function nowIso() {
    return Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  function today() {
    return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd');
  }

  /** Sortable, collision-safe id such as STU-lx2k9a-4f3c1b. */
  function newId(prefix) {
    const time = Date.now().toString(36);
    const rand = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    return `${prefix}-${time}-${rand}`;
  }

  function base64url(bytesOrString) {
    return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, '');
  }

  function fromBase64url(text) {
    const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
  }

  function hmac(message, secret) {
    return base64url(Utilities.computeHmacSha256Signature(message, secret));
  }

  function sha256Hex(text) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
      .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
      .join('');
  }

  /** Constant-time comparison for secrets and signatures. */
  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function requireFields(payload, fields) {
    const missing = fields.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
    if (missing.length) throw new AppError('VALIDATION', `Missing: ${missing.join(', ')}`, { missing });
  }

  return { prop, setProp, setProps, tz, nowIso, today, newId, base64url, fromBase64url, hmac, sha256Hex, safeEqual, requireFields };
})();
