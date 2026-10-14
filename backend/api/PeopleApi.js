/**
 * Parents, students and enrollments (PRD §6.1).
 * Every write returns { changes: { <Tab>: [rows] } } so the client can merge without a full reload.
 */
const PeopleApi = (() => {
  const OPEN = (status) => status === 'Active' || status === 'On hold';
  const CLOSED = (status) => status === 'Dropped' || status === 'Completed';

  function countryCode() {
    return String(Db.getMap('Settings').country_code || '91');
  }

  function parentFields(input) {
    return {
      guardian_name: Validate.text(input.guardian_name, 'parent.guardian_name', { required: true, max: 80, label: 'Guardian name' }),
      phone: Validate.phone(input.phone, 'parent.phone', { required: true, countryCode: countryCode(), label: 'Phone' }),
      alt_phone: Validate.phone(input.alt_phone, 'parent.alt_phone', { countryCode: countryCode(), label: 'Alternate phone' }),
      email: Validate.text(input.email, 'parent.email', { max: 120, label: 'Email' }),
      address: Validate.text(input.address, 'parent.address', { max: 300, label: 'Address' }),
      notes: Validate.text(input.notes, 'parent.notes', { max: 500, label: 'Notes' }),
      extra: Validate.extra(input.extra, 'Parent', 'parent'),
    };
  }

  function assertPhoneFree(phone, selfId) {
    const clash = Db.all('Parents').find((p) => p.phone === phone && p.id !== selfId);
    if (clash) {
      throw new AppError('CONFLICT', `${clash.guardian_name} is already registered with this phone number`, {
        field: 'parent.phone',
        parent_id: clash.id,
      });
    }
  }

  function studentFields(input, prefix) {
    return {
      name: Validate.text(input.name, `${prefix}.name`, { required: true, max: 80, label: 'Student name' }),
      class: Validate.text(input.class, `${prefix}.class`, { max: 30, label: 'Class' }),
      dob: Validate.date(input.dob, `${prefix}.dob`, { label: 'Date of birth' }),
      gender: Validate.text(input.gender, `${prefix}.gender`, { max: 20, label: 'Gender' }),
      notes: Validate.text(input.notes, `${prefix}.notes`, { max: 500, label: 'Notes' }),
      extra: Validate.extra(input.extra, 'Student', prefix),
    };
  }

  /**
   * Bills the current month for enrollments that just started or resumed, so a mid-month admission
   * does not wait for next month's run. Later start dates are billed by the monthly run.
   */
  function billNewEnrollments(ids) {
    if (!ids.length) return {};
    return Fees.generate(Util.today().slice(0, 7), { enrollmentIds: ids }).changes;
  }

  /** Validates one enrollment against the catalogue; returns normalized fields. */
  function enrollmentFields(input, prefix, existing) {
    const course = Db.find('Courses', input.course_id);
    if (!course || Db.isDeleted(course)) Validate.fail(`${prefix}.course_id`, 'Choose a valid course');
    if (!existing && !Validate.bool(course.active)) Validate.fail(`${prefix}.course_id`, `${course.name} is not active`);

    const plan = Db.find('FeePlans', input.fee_plan_id);
    const planUnchanged = existing && existing.fee_plan_id === input.fee_plan_id;
    if (!plan || Db.isDeleted(plan) || (!planUnchanged && !Validate.bool(plan.active))) {
      Validate.fail(`${prefix}.fee_plan_id`, `Choose a fee plan for ${course.name}`);
    }

    let batchId = '';
    if (input.batch_id) {
      const batch = Db.find('Batches', input.batch_id);
      if (!batch || Db.isDeleted(batch) || batch.course_id !== course.id) Validate.fail(`${prefix}.batch_id`, `Choose a valid batch for ${course.name}`);
      batchId = batch.id;
    }

    return {
      course_id: course.id,
      batch_id: batchId,
      fee_plan_id: plan.id,
      start_date: Validate.date(input.start_date || Util.today(), `${prefix}.start_date`, { required: true, label: 'Start date' }),
      monthly_fee_override: Validate.number(input.monthly_fee_override, `${prefix}.monthly_fee_override`, { min: 0, max: 10000000, label: 'Fee override' }),
      discount_note: Validate.text(input.discount_note, `${prefix}.discount_note`, { max: 200, label: 'Discount note' }),
    };
  }

  /** Optional id chosen by the device (same shape as Util.newId), so it can show the new rows before the save returns. */
  function clientId(value, prefix, field) {
    if (value === undefined || value === null || value === '') return undefined;
    const id = String(value);
    if (!new RegExp(`^${prefix}-[a-z0-9]{6,12}-[a-z0-9]{6}$`).test(id)) Validate.fail(field, 'Invalid id');
    return id;
  }

  /** The rows of an admission that was already saved (a repeated request), as admissions.create returns them. */
  function savedAdmission(parentId, studentIds) {
    const ids = new Set(studentIds);
    const enrollments = Db.where('Enrollments', (e) => ids.has(e.student_id));
    return {
      changes: {
        Parents: [Db.find('Parents', parentId)],
        Students: Db.where('Students', (s) => ids.has(s.id)),
        Enrollments: enrollments,
        FeeDues: Db.where('FeeDues', (d) => ids.has(d.student_id)),
      },
      parent_id: parentId,
      student_ids: studentIds,
      duplicate: true,
    };
  }

  /**
   * admissions.create
   * { parent: { id } | { new_id?, guardian_name, phone, ... }, students: [{ new_id?, name, class, ..., enrollments: [{ course_id, fee_plan_id, ... }] }] }
   * new_id: optional ids chosen by the device; sending the same admission again returns the saved rows.
   */
  function createAdmission(payload, ctx) {
    const studentsIn = Array.isArray(payload.students) ? payload.students : [];
    if (!studentsIn.length) Validate.fail('students', 'Add at least one student');
    if (studentsIn.length > 10) Validate.fail('students', 'At most 10 students per admission');
    const parentIn = payload.parent || {};
    const newParentId = parentIn.id ? undefined : clientId(parentIn.new_id, 'PAR', 'parent.new_id');
    const newStudentIds = studentsIn.map((s, i) => clientId(s.new_id, 'STU', `students.${i}.new_id`));
    if (new Set(newStudentIds.filter(Boolean)).size !== newStudentIds.filter(Boolean).length) Validate.fail('students', 'Invalid id');

    return Db.withLock(() => {
      let parent;
      const changes = { Parents: [], Students: [], Enrollments: [] };

      const existingStudents = newStudentIds.filter((id) => id && Db.find('Students', id));
      if (existingStudents.length) {
        const first = Db.find('Students', existingStudents[0]);
        if (existingStudents.length === studentsIn.length && first.parent_id === (parentIn.id || newParentId)) {
          return savedAdmission(first.parent_id, newStudentIds);
        }
        throw new AppError('CONFLICT', 'This admission clashes with existing records. Please try again.');
      }
      if (newParentId && Db.find('Parents', newParentId)) throw new AppError('CONFLICT', 'This admission clashes with existing records. Please try again.');

      if (parentIn.id) {
        parent = Db.find('Parents', parentIn.id);
        if (!parent || Db.isDeleted(parent)) throw new AppError('NOT_FOUND', 'Parent not found');
      }

      const today = Util.today();
      const prepared = studentsIn.map((s, i) => {
        const prefix = `students.${i}`;
        const fields = studentFields(s, prefix);
        const enrolIn = Array.isArray(s.enrollments) ? s.enrollments : [];
        const seen = {};
        const enrollments = enrolIn.map((e, j) => {
          const clean = enrollmentFields(e, `${prefix}.enrollments.${j}`);
          if (seen[clean.course_id]) Validate.fail(`${prefix}.enrollments.${j}.course_id`, 'The same course is selected twice');
          seen[clean.course_id] = true;
          return clean;
        });
        const charges = (Array.isArray(s.charges) ? s.charges : []).map((c, k) => {
          FeesApi.buildCharge({ id: '', parent_id: '' }, c, `${prefix}.charges.${k}`);
          return c;
        });
        return {
          student: Object.assign(fields, {
            join_date: Validate.date(s.join_date || today, `${prefix}.join_date`, { label: 'Join date' }),
            status: 'Active',
            status_reason: '',
          }),
          enrollments,
          charges,
        };
      });

      if (!parent) {
        const fields = parentFields(parentIn);
        assertPhoneFree(fields.phone);
        parent = Db.insert('Parents', [Object.assign({ id: newParentId }, fields)], 'PAR')[0];
        changes.Parents.push(parent);
      }

      const chargeRows = [];
      prepared.forEach(({ student, enrollments, charges }, i) => {
        const saved = Db.insert('Students', [Object.assign({ id: newStudentIds[i], parent_id: parent.id }, student)], 'STU')[0];
        changes.Students.push(saved);
        if (enrollments.length) {
          const rows = enrollments.map((e) => Object.assign({ student_id: saved.id, end_date: '', status: 'Active', status_reason: '' }, e));
          changes.Enrollments.push(...Db.insert('Enrollments', rows, 'ENR'));
        }
        charges.forEach((c, k) => chargeRows.push(FeesApi.buildCharge(saved, c, `students.${i}.charges.${k}`)));
      });
      Fees.addChanges(changes, 'FeeDues', Db.insert('FeeDues', chargeRows, 'DUE'));
      Fees.mergeChanges(changes, billNewEnrollments(changes.Enrollments.map((e) => e.id)));
      Fees.mergeChanges(changes, Fees.applyCredit(parent.id));
      if (payload.enquiry_id) Fees.addChanges(changes, 'Enquiries', EnquiriesApi.markConverted(String(payload.enquiry_id), changes.Students[0].id));

      Audit.log(
        'admission.create',
        'Parents',
        parent.id,
        `${parent.guardian_name}: ${changes.Students.map((s) => s.name).join(', ')} (${changes.Enrollments.length} course(s))`,
        ctx,
      );
      return { changes, parent_id: parent.id, student_ids: changes.Students.map((s) => s.id) };
    });
  }

  function saveParent(payload, ctx) {
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const existing = Db.find('Parents', payload.id);
      if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', 'Parent not found');
      const fields = parentFields(Object.assign({}, existing, payload));
      assertPhoneFree(fields.phone, existing.id);
      const saved = Db.update('Parents', [Object.assign({ id: existing.id }, fields)])[0];
      Audit.log('parent.update', 'Parents', saved.id, saved.guardian_name, ctx);
      return { changes: { Parents: [saved] } };
    });
  }

  function saveStudent(payload, ctx) {
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const existing = Db.find('Students', payload.id);
      if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', 'Student not found');
      const fields = studentFields(Object.assign({}, existing, payload), 'student');
      fields.join_date = Validate.date(payload.join_date !== undefined ? payload.join_date : existing.join_date, 'student.join_date', { label: 'Join date' });
      const saved = Db.update('Students', [Object.assign({ id: existing.id }, fields)])[0];
      Audit.log('student.update', 'Students', saved.id, saved.name, ctx);
      return { changes: { Students: [saved] } };
    });
  }

  /**
   * students.setStatus { id, status, reason }
   * On hold pauses active courses; Dropped/Completed closes open courses (end_date today);
   * back to Active resumes courses that were paused. Dues generation (phase 3) follows enrollment status.
   */
  function setStudentStatus(payload, ctx) {
    Util.requireFields(payload, ['id', 'status']);
    const status = Validate.oneOf(payload.status, 'status', STATUS.student, { label: 'Status' });
    const reason = Validate.text(payload.reason, 'reason', { required: status !== 'Active', max: 200, label: 'Reason' });

    return Db.withLock(() => {
      const student = Db.find('Students', payload.id);
      if (!student || Db.isDeleted(student)) throw new AppError('NOT_FOUND', 'Student not found');
      if (student.status === status) return { changes: {} };

      const today = Util.today();
      const patches = [];
      Db.where('Enrollments', (e) => e.student_id === student.id).forEach((e) => {
        if (status === 'On hold' && e.status === 'Active') patches.push({ id: e.id, status: 'On hold', status_reason: `Student on hold: ${reason}` });
        else if (CLOSED(status) && OPEN(e.status)) patches.push({ id: e.id, status, status_reason: reason, end_date: e.end_date || today });
        else if (status === 'Active' && student.status === 'On hold' && e.status === 'On hold') patches.push({ id: e.id, status: 'Active', status_reason: '' });
      });

      const saved = Db.update('Students', [{ id: student.id, status, status_reason: status === 'Active' ? '' : reason }])[0];
      const enrollments = Db.update('Enrollments', patches);
      Audit.log('student.status', 'Students', student.id, `${student.status} → ${status}${reason ? `: ${reason}` : ''}`, ctx);
      const changes = { Students: [saved], Enrollments: enrollments };
      if (status === 'Active') Fees.mergeChanges(changes, billNewEnrollments(enrollments.filter((e) => e.status === 'Active').map((e) => e.id)));
      return { changes };
    });
  }

  /** enrollments.save: add a course to a student (no id) or edit batch/plan/fee/start date (with id). */
  function saveEnrollment(payload, ctx) {
    return Db.withLock(() => {
      if (payload.id) {
        const existing = Db.find('Enrollments', payload.id);
        if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', 'Enrolment not found');
        const merged = Object.assign({}, existing, payload, { course_id: existing.course_id, student_id: existing.student_id });
        const fields = enrollmentFields(merged, 'enrollment', existing);
        const saved = Db.update('Enrollments', [Object.assign({ id: existing.id }, fields)])[0];
        Audit.log('enrollment.update', 'Enrollments', saved.id, '', ctx);
        return { changes: { Enrollments: [saved] } };
      }

      Util.requireFields(payload, ['student_id', 'course_id']);
      const student = Db.find('Students', payload.student_id);
      if (!student || Db.isDeleted(student)) throw new AppError('NOT_FOUND', 'Student not found');
      if (CLOSED(student.status)) {
        throw new AppError('CONFLICT', `${student.name} is ${student.status}. Set them back to Active before adding a course.`);
      }
      const fields = enrollmentFields(payload, 'enrollment');
      const duplicate = Db.where('Enrollments', (e) => e.student_id === student.id && e.course_id === fields.course_id && OPEN(e.status));
      if (duplicate.length) throw new AppError('CONFLICT', 'Already enrolled in this course', { field: 'enrollment.course_id' });

      const status = student.status === 'On hold' ? 'On hold' : 'Active';
      const saved = Db.insert('Enrollments', [Object.assign({ student_id: student.id, end_date: '', status, status_reason: '' }, fields)], 'ENR')[0];
      Audit.log('enrollment.create', 'Enrollments', saved.id, student.name, ctx);
      return { changes: Fees.mergeChanges({ Enrollments: [saved] }, billNewEnrollments([saved.id])) };
    });
  }

  /** enrollments.setStatus { id, status, reason, end_date? } */
  function setEnrollmentStatus(payload, ctx) {
    Util.requireFields(payload, ['id', 'status']);
    const status = Validate.oneOf(payload.status, 'status', STATUS.enrollment, { label: 'Status' });
    const reason = Validate.text(payload.reason, 'reason', { required: status !== 'Active', max: 200, label: 'Reason' });

    return Db.withLock(() => {
      const e = Db.find('Enrollments', payload.id);
      if (!e || Db.isDeleted(e)) throw new AppError('NOT_FOUND', 'Enrolment not found');
      if (status === 'Active') {
        const student = Db.find('Students', e.student_id);
        if (student && student.status !== 'Active') {
          throw new AppError('CONFLICT', `${student.name} is ${student.status}. Change the student's status first.`);
        }
        const other = Db.where('Enrollments', (x) => x.id !== e.id && x.student_id === e.student_id && x.course_id === e.course_id && OPEN(x.status));
        if (other.length) throw new AppError('CONFLICT', 'Already enrolled in this course');
      }
      const patch = { id: e.id, status, status_reason: status === 'Active' ? '' : reason };
      if (CLOSED(status)) patch.end_date = Validate.date(payload.end_date || Util.today(), 'end_date', { required: true, label: 'End date' });
      if (status === 'Active') patch.end_date = '';
      const saved = Db.update('Enrollments', [patch])[0];
      Audit.log('enrollment.status', 'Enrollments', e.id, `${e.status} → ${status}${reason ? `: ${reason}` : ''}`, ctx);
      const changes = { Enrollments: [saved] };
      return { changes: status === 'Active' ? Fees.mergeChanges(changes, billNewEnrollments([saved.id])) : changes };
    });
  }

  return { createAdmission, saveParent, saveStudent, setStudentStatus, saveEnrollment, setEnrollmentStatus };
})();
