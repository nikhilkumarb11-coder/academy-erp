/**
 * Single shared login per tenant (PRD §2). Tokens are stateless and HMAC-signed;
 * bumping SESSION_VERSION (e.g. on password change) invalidates every device.
 *
 * Script Properties used: PASSWORD_HASH, PASSWORD_SALT, TOKEN_SECRET, SESSION_VERSION.
 */
const Auth = (() => {
  const HASH_ROUNDS = 500;
  const MAX_FAILED_LOGINS = 5;
  const LOCKOUT_SECONDS = 15 * 60;

  function hashPassword(password, salt) {
    let h = salt + ':' + password;
    for (let i = 0; i < HASH_ROUNDS; i++) h = Util.sha256Hex(h);
    return h;
  }

  function setPassword(password) {
    if (!password || String(password).length < 8) throw new AppError('VALIDATION', 'Password must be at least 8 characters');
    const salt = Utilities.getUuid();
    Util.setProp('PASSWORD_SALT', salt);
    Util.setProp('PASSWORD_HASH', hashPassword(String(password), salt));
    Util.setProp('SESSION_VERSION', Number(Util.prop('SESSION_VERSION') || 0) + 1);
  }

  /** Login lasts until Log out (or password change). Expiry is far ahead only as a hard safety net. */
  const SESSION_MS = 10 * 365.25 * 24 * 3600 * 1000;

  function issueToken() {
    const payload = {
      role: 'owner',
      sv: Number(Util.prop('SESSION_VERSION') || 1),
      exp: Date.now() + SESSION_MS,
    };
    const body = Util.base64url(JSON.stringify(payload));
    return { token: `${body}.${Util.hmac(body, Util.prop('TOKEN_SECRET', true))}`, expiresAt: payload.exp };
  }

  function login(password) {
    const cache = CacheService.getScriptCache();
    const failed = Number(cache.get('failed_logins') || 0);
    if (failed >= MAX_FAILED_LOGINS) throw new AppError('LOCKED', 'Too many attempts. Try again in 15 minutes.');

    const ok = Util.safeEqual(
      hashPassword(String(password || ''), Util.prop('PASSWORD_SALT', true)),
      Util.prop('PASSWORD_HASH', true),
    );
    if (!ok) {
      cache.put('failed_logins', String(failed + 1), LOCKOUT_SECONDS);
      throw new AppError('AUTH', 'Incorrect password');
    }
    cache.remove('failed_logins');
    return issueToken();
  }

  /** Returns the session context or throws AUTH. */
  function verify(token) {
    if (!token || token.indexOf('.') < 0) throw new AppError('AUTH', 'Please log in');
    const [body, sig] = token.split('.');
    if (!Util.safeEqual(sig, Util.hmac(body, Util.prop('TOKEN_SECRET', true)))) throw new AppError('AUTH', 'Invalid session');
    let payload;
    try {
      payload = JSON.parse(Util.fromBase64url(body));
    } catch (e) {
      throw new AppError('AUTH', 'Invalid session');
    }
    if (payload.exp < Date.now()) throw new AppError('AUTH', 'Session expired');
    if (payload.sv !== Number(Util.prop('SESSION_VERSION') || 1)) throw new AppError('AUTH', 'Session revoked');
    return { role: payload.role };
  }

  function changePassword(current, next) {
    login(current);
    setPassword(next);
    return issueToken();
  }

  return { setPassword, login, verify, changePassword };
})();
