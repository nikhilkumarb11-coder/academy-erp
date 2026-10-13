/**
 * Course-wise attendance and holidays (PRD §6.2).
 * Attendance is not cached on devices (it grows fastest); the roster itself comes from cached
 * enrollments, so the app only asks the server for the marks of one course and day.
 */
const AttendanceApi = (() => {
  function requireCourse(id) {
    const course = Db.find('Courses', id);
    if (!course || Db.isDeleted(course)) throw new AppError('NOT_FOUND', 'Course not found');
    return course;
  }

  /** attendance.day { course_id, date } -> { marks } */
  function day(payload) {
    Util.requireFields(payload, ['course_id', 'date']);
    const date = Validate.date(payload.date, 'date', { required: true, label: 'Date' });
    return { marks: Db.all('Attendance').filter((a) => a.course_id === payload.course_id && a.date === date && a.status) };
  }

  /**
   * attendance.save { course_id, batch_id?, date, marks: [{ student_id, status, remarks? }] }
   * Upserts one row per (date, course, student) in a single batch. status '' clears a mark.
   */
  function save(payload, ctx) {
    Util.requireFields(payload, ['course_id', 'date']);
    const date = Validate.date(payload.date, 'date', { required: true, label: 'Date' });
    if (date > Util.today()) Validate.fail('date', 'Attendance cannot be marked for a future date');
    const marks = Array.isArray(payload.marks) ? payload.marks : [];
    if (!marks.length) Validate.fail('marks', 'Nothing to save');
    if (marks.length > 500) Validate.fail('marks', 'Too many marks in one save');
    const clean = marks.map((m, i) => ({
      student_id: Validate.text(m.student_id, `marks.${i}.student_id`, { required: true, label: 'Student' }),
      status: m.status === '' ? '' : Validate.oneOf(m.status, `marks.${i}.status`, STATUS.attendance, { label: 'Status' }),
      remarks: Validate.text(m.remarks, `marks.${i}.remarks`, { max: 120, label: 'Remarks' }),
    }));

    return Db.withLock(() => {
      const course = requireCourse(payload.course_id);
      const batchId = String(payload.batch_id || '');
      const existing = new Map(Db.all('Attendance').filter((a) => a.course_id === course.id && a.date === date).map((a) => [a.student_id, a]));
      const inserts = [];
      const patches = [];
      clean.forEach((m) => {
        const row = existing.get(m.student_id);
        if (row) {
          if (row.status !== m.status || String(row.remarks || '') !== m.remarks) patches.push({ id: row.id, status: m.status, remarks: m.remarks });
        } else if (m.status) {
          inserts.push({ date, course_id: course.id, batch_id: batchId, student_id: m.student_id, status: m.status, remarks: m.remarks });
        }
      });
      Db.insert('Attendance', inserts, 'ATT');
      Db.update('Attendance', patches);
      const counts = clean.reduce((acc, m) => { acc[m.status || 'cleared'] = (acc[m.status || 'cleared'] || 0) + 1; return acc; }, {});
      const summary = `${course.name} ${date}: ${Object.keys(counts).map((k) => `${counts[k]} ${k}`).join(', ')}`;
      Audit.log(existing.size ? 'attendance.edit' : 'attendance.save', 'Attendance', `${course.id}:${date}`, summary, ctx);
      return { marks: Db.all('Attendance').filter((a) => a.course_id === course.id && a.date === date && a.status) };
    });
  }

  /** attendance.report { month: 'yyyy-MM', course_id?, student_id? } -> { rows } for the app to summarise. */
  function report(payload) {
    const month = String(payload.month || Util.today().slice(0, 7));
    if (!Fees.isMonth(month)) Validate.fail('month', 'Month must look like 2026-06');
    const rows = Db.all('Attendance').filter((a) => String(a.date).slice(0, 7) === month && a.status
      && (!payload.course_id || a.course_id === payload.course_id)
      && (!payload.student_id || a.student_id === payload.student_id));
    return { month, rows };
  }

  /** holidays.save { id?, date, course_id? ('' = all courses), reason } */
  function saveHoliday(payload, ctx) {
    const date = Validate.date(payload.date, 'date', { required: true, label: 'Date' });
    const reason = Validate.text(payload.reason, 'reason', { required: true, max: 80, label: 'Reason' });
    const courseId = String(payload.course_id || '');
    return Db.withLock(() => {
      if (courseId) requireCourse(courseId);
      const clash = Db.where('Holidays', (h) => h.date === date && h.course_id === courseId && h.id !== payload.id)[0];
      if (clash) throw new AppError('CONFLICT', `Already marked as a holiday: ${clash.reason}`, { field: 'date', id: clash.id });
      const saved = payload.id
        ? Db.update('Holidays', [{ id: payload.id, date, course_id: courseId, reason }])
        : Db.insert('Holidays', [{ date, course_id: courseId, reason }], 'HOL');
      Audit.log('holidays.save', 'Holidays', saved[0].id, `${date} ${reason}`, ctx);
      return { changes: { Holidays: saved } };
    });
  }

  function deleteHoliday(payload, ctx) {
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const h = Db.find('Holidays', payload.id);
      if (!h || Db.isDeleted(h)) throw new AppError('NOT_FOUND', 'Holiday not found');
      const saved = Db.softDelete('Holidays', [h.id]);
      Audit.log('holidays.delete', 'Holidays', h.id, `${h.date} ${h.reason}`, ctx);
      return { changes: { Holidays: saved } };
    });
  }

  return { day, save, report, saveHoliday, deleteHoliday };
})();
