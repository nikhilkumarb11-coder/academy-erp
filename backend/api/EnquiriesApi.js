/**
 * Enquiry pipeline (PRD §6.7): New → Follow-up / Trial → Converted or Lost.
 * Conversion happens through admissions.create with enquiry_id, which links the new student.
 */
const EnquiriesApi = (() => {
  /** enquiries.save { row: { id?, name, phone, course_interested, source, ... } } -> { changes: { Enquiries } } */
  function save(payload, ctx) {
    const input = payload.row || {};
    const countryCode = String(Db.getMap('Settings').country_code || '91');

    return Db.withLock(() => {
      let existing = null;
      if (input.id) {
        existing = Db.find('Enquiries', input.id);
        if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', 'Enquiry not found');
      }
      const m = Object.assign({ status: 'New', source: 'Walk-in', enquiry_date: Util.today() }, existing || {}, input);
      const clean = {
        name: Validate.text(m.name, 'name', { required: true, max: 80, label: 'Name' }),
        phone: Validate.phone(m.phone, 'phone', { required: true, countryCode, label: 'Phone' }),
        course_interested: Validate.text(m.course_interested, 'course_interested', { max: 300, label: 'Course' }),
        source: Validate.oneOf(m.source, 'source', STATUS.enquirySource, { label: 'Source' }),
        enquiry_date: Validate.date(m.enquiry_date, 'enquiry_date', { required: true, label: 'Enquiry date' }),
        next_followup_date: Validate.date(m.next_followup_date, 'next_followup_date', { label: 'Next follow-up' }),
        trial_date: Validate.date(m.trial_date, 'trial_date', { label: 'Trial date' }),
        status: Validate.oneOf(m.status, 'status', STATUS.enquiry, { label: 'Status' }),
        lost_reason: Validate.text(m.lost_reason, 'lost_reason', { max: 200, label: 'Reason' }),
        notes: Validate.text(m.notes, 'notes', { max: 1000, label: 'Notes' }),
      };
      if (clean.status === 'Lost' && !clean.lost_reason) Validate.fail('lost_reason', 'Say why the enquiry was lost');
      if (clean.status !== 'Lost') clean.lost_reason = '';
      if (clean.status === 'Converted' || clean.status === 'Lost') clean.next_followup_date = '';

      const saved = existing
        ? Db.update('Enquiries', [Object.assign({ id: existing.id }, clean)])[0]
        : Db.insert('Enquiries', [Object.assign({ converted_student_id: '', extra: '' }, clean)], 'ENQ')[0];
      Audit.log(existing ? 'enquiry.update' : 'enquiry.create', 'Enquiries', saved.id, `${clean.name} (${clean.status})`, ctx);
      return { changes: { Enquiries: [saved] } };
    });
  }

  function remove(payload, ctx) {
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const row = Db.find('Enquiries', payload.id);
      if (!row || Db.isDeleted(row)) throw new AppError('NOT_FOUND', 'Enquiry not found');
      const saved = Db.softDelete('Enquiries', [row.id]);
      Audit.log('enquiry.delete', 'Enquiries', row.id, row.name, ctx);
      return { changes: { Enquiries: saved } };
    });
  }

  /** Called inside admissions.create's lock: marks the enquiry converted and links the first new student. */
  function markConverted(enquiryId, studentId) {
    const row = Db.find('Enquiries', enquiryId);
    if (!row || Db.isDeleted(row)) return [];
    return Db.update('Enquiries', [{ id: row.id, status: 'Converted', converted_student_id: studentId, next_followup_date: '', lost_reason: '' }]);
  }

  return { save, remove, markConverted };
})();
