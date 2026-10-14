const AuthApi = (() => {
  /** auth.login { password, withData? } — withData also returns the bootstrap snapshot, saving a round trip. */
  function login(payload) {
    Util.requireFields(payload, ['password']);
    const session = Auth.login(payload.password);
    if (!payload.withData) return session;
    try {
      session.data = SystemApi.bootstrap();
    } catch (e) {
      console.error('bootstrap at login', e && e.stack); // the client falls back to system.bootstrap
    }
    return session;
  }

  function changePassword(payload, ctx) {
    Util.requireFields(payload, ['current', 'next']);
    const session = Auth.changePassword(payload.current, payload.next);
    Db.withLock(() => Audit.log('password.change', 'Settings', '', 'Password changed; other devices logged out', ctx));
    return session;
  }

  return { login, changePassword };
})();
