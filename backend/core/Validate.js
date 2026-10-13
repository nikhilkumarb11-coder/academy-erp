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
  function phone(value, field, { required = false, countryCode = '91', label = field } = {}) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    let digits = raw.replace(/\D/g, '');
    if (!digits) {
      if (required) fail(field, `${label} is required`);
      return '';
    }
    let out = '';
    if (raw.startsWith('+')) out = digits.length >= 8 ? `+${digits}` : '';
    else if (digits.startsWith('00')) out = digits.length >= 10 ? `+${digits.slice(2)}` : '';
    else {
      digits = digits.replace(/^0+/, '');
      if (digits.length === 10) out = `+${countryCode}${digits}`;
      else if (digits.startsWith(countryCode) && digits.length === countryCode.length + 10) out = `+${digits}`;
      else if (digits.length >= 8) out = `+${countryCode}${digits}`;
    }
    if (!out) fail(field, `${label} is not a valid phone number`);
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
