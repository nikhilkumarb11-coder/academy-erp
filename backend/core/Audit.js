/** Append-only audit trail. Call inside the same lock as the write it describes. */
const Audit = (() => {
  function log(action, entity, entityId, summary, ctx) {
    Db.insert('AuditLog', [{
      timestamp: Util.nowIso(),
      action,
      entity,
      entity_id: entityId || '',
      summary: summary || '',
      device: (ctx && ctx.device) || '',
    }]);
  }

  return { log };
})();
