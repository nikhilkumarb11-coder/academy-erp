/**
 * WhatsApp message log (PRD §6.6). Messages are sent by the phone through wa.me links; the app
 * records what was sent so the reminder queue can skip families reminded recently.
 * The log grows quickly, so it is not cached on devices: the app reads recent rows on demand.
 */
const MessagesApi = (() => {
  const MAX_ENTRIES = 50;

  /**
   * messages.log { entries: [{ type, channel?, parent_id?, student_id?, template_id?, group_id?, preview }] }
   * -> { logged, changes: { WhatsAppGroups } }  (groups get last_sent_at)
   */
  function log(payload) {
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) Validate.fail('entries', 'Nothing to log');
    if (entries.length > MAX_ENTRIES) Validate.fail('entries', `At most ${MAX_ENTRIES} messages per call`);
    const sentAt = Util.nowIso();
    const rows = entries.map((e, i) => ({
      sent_at: sentAt,
      type: Validate.oneOf(e.type, `entries.${i}.type`, STATUS.templateType, { label: 'Type' }),
      channel: Validate.oneOf(e.channel || 'WhatsApp', `entries.${i}.channel`, STATUS.messageChannel, { label: 'Channel' }),
      parent_id: Validate.text(e.parent_id, `entries.${i}.parent_id`, { max: 40 }),
      student_id: Validate.text(e.student_id, `entries.${i}.student_id`, { max: 40 }),
      template_id: Validate.text(e.template_id, `entries.${i}.template_id`, { max: 40 }),
      group_id: Validate.text(e.group_id, `entries.${i}.group_id`, { max: 40 }),
      preview: String(e.preview == null ? '' : e.preview).replace(/\s+/g, ' ').trim().slice(0, 200),
    }));

    return Db.withLock(() => {
      const logged = Db.append('MessageLog', rows, 'MSG');
      const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))]
        .filter((id) => { const g = Db.find('WhatsAppGroups', id); return g && !Db.isDeleted(g); });
      const groups = Db.update('WhatsAppGroups', groupIds.map((id) => ({ id, last_sent_at: sentAt })));
      return { logged, changes: { WhatsAppGroups: groups } };
    });
  }

  /** messages.recent { days = 60 } -> { rows } newest first (at most 1000). */
  function recent(payload) {
    const days = Validate.number(payload.days === undefined ? 60 : payload.days, 'days', { min: 1, max: 366, integer: true, label: 'Days' });
    const cutoff = Date.now() - days * 86400000;
    const rows = Db.all('MessageLog')
      .filter((r) => new Date(r.sent_at).getTime() >= cutoff)
      .reverse()
      .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
      .slice(0, 1000);
    return { rows };
  }

  return { log, recent };
})();
