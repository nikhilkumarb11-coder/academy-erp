/**
 * Input validation and normalization shared by all write actions.
 * Every helper throws AppError('VALIDATION') with a field-specific message and details.{field}.
 */
const Validate = (() => {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  function fail(field, message) {
    throw new AppError('VALIDATION', message, { field });
  }

  function text(value, field, { required = false, max = 200, label = field } = {}) {
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (required && !v) fail(field, `${label} is required`);
    if (v.length > max) fail(field, `${label} must be at most ${max} characters`);
    return v;
  }

  /** Returns a number, or '' when blank and not required. */
  function number(value, field, { required = false, min = -Infinity, max = Infinity, integer = false, label = field } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) fail(field, `${label} is required`);
      return '';
    }
    const n = Number(value);
    if (!Number.isFinite(n)) fail(field, `${label} must be a number`);
    if (integer && !Number.isInteger(n)) fail(field, `${label} must be a whole number`);
    if (n < min || n > max) fail(field, `${label} must be between ${min} and ${max}`);
    return n;
  }

  function date(value, field, { required = false, label = field } = {}) {
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (!v) {
      if (required) fail(field, `${label} is required`);
      return '';
    }
    if (!DATE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) fail(field, `${label} must be a date (yyyy-mm-dd)`);
    return v;
  }

  function oneOf(value, field, options, { label = field } = {}) {
    if (!options.includes(value)) fail(field, `${label} must be one of: ${options.join(', ')}`);
    return value;
  }

  function bool(value) {
    return value === true || String(value).toUpperCase() === 'TRUE';
  }

  /**
   * E.164 without spaces, e.g. +919876543210. Mirrors frontend/src/lib/phone.ts.
   * Returns '' for blank input when not required.
   */
  /** Digits after the country code where the length is fixed (India: 10-digit mobile numbers). */
  const LOCAL_LENGTH = { 91: 10 };

  function phone(value, field, { required = false, countryCode = '91', label = field } = {}) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      if (required) fail(field, `${label} is required`);
      return '';
    }
    const cc = String(countryCode);
    const len = LOCAL_LENGTH[cc];
    const localOk = (local) => (len ? local.length === len : local.length >= 6 && local.length <= 12);
    let out = '';
    if (raw.startsWith('+') || digits.startsWith('00')) {
      const intl = raw.startsWith('+') ? digits : digits.slice(2);
      if (intl.startsWith(cc)) out = localOk(intl.slice(cc.length)) ? `+${intl}` : '';
      else out = intl.length >= 8 && intl.length <= 15 ? `+${intl}` : '';
    } else {
      const local = digits.replace(/^0+/, '');
      if (localOk(local)) out = `+${cc}${local}`;
      else if (local.startsWith(cc) && localOk(local.slice(cc.length))) out = `+${local}`;
    }
    if (!out) fail(field, len ? `${label} must be a ${len}-digit mobile number` : `${label} is not a valid phone number`);
    return out;
  }

  /** Custom-field values: keeps only defined keys, checks required ones, returns a JSON string. Errors point at <prefix>.extra.<key>. */
  function extra(value, entity, prefix) {
    const at = (key) => (prefix ? `${prefix}.extra.${key}` : `extra.${key}`);
    const input = typeof value === 'string' ? safeParse(value) : value || {};
    const defs = Db.all('CustomFields').filter((f) => f.entity === entity && bool(f.active));
    const out = {};
    defs.forEach((f) => {
      const v = input[f.key];
      const blank = v === undefined || v === null || v === '';
      if (blank) {
        if (bool(f.required)) fail(at(f.key), `${f.label} is required`);
        return;
      }
      if (f.type === 'number') out[f.key] = number(v, at(f.key), { label: f.label });
      else if (f.type === 'date') out[f.key] = date(v, at(f.key), { label: f.label });
      else if (f.type === 'select') {
        const options = String(f.options || '').split('|').filter(Boolean);
        out[f.key] = oneOf(String(v), at(f.key), options, { label: f.label });
      } else out[f.key] = text(v, at(f.key), { label: f.label, max: 500 });
    });
    return Object.keys(out).length ? JSON.stringify(out) : '';
  }

  function safeParse(s) {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  /** Case-insensitive uniqueness of `field` among non-deleted rows matching `scope`, excluding `selfId`. */
  function unique(tab, field, value, { selfId, scope, label = field } = {}) {
    const needle = String(value).trim().toLowerCase();
    const clash = Db.all(tab).find(
      (r) => r.id !== selfId && String(r[field]).trim().toLowerCase() === needle && (!scope || scope(r)),
    );
    if (clash) throw new AppError('CONFLICT', `${label} "${value}" already exists`, { field, id: clash.id });
  }

  return { text, number, date, oneOf, bool, phone, extra, unique, fail };
})();
