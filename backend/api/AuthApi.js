const AuthApi = (() => {
  function login(payload) {
    Util.requireFields(payload, ['password']);
    return Auth.login(payload.password);
  }

  function changePassword(payload, ctx) {
    Util.requireFields(payload, ['current', 'next']);
    const session = Auth.changePassword(payload.current, payload.next);
    Db.withLock(() => Audit.log('password.change', 'Settings', '', 'Password changed; other devices logged out', ctx));
    return session;
  }

  return { login, changePassword };
})();
