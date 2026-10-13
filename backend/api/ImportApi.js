/**
 * Bulk import of families, students, course enrolments and opening dues (PRD addendum G5, go-live migration).
 * One input row = one student. Rows with the same phone become one family; a phone that already belongs
 * to a family adds the student to that family. A student whose name already exists in the family is skipped.
 *
 * import.students { rows: [ImportRow], commit: boolean, bill_current_month: boolean, opening_due_date? }
 * ImportRow: { guardian_name, phone, alt_phone, email, address, student_name, class, dob, gender,
 *              join_date, courses ("Karate; Abacus"), fee_plan, opening_due, opening_due_note, notes }
 * Returns { results: [{ row, status: 'new_family'|'existing_family'|'duplicate'|'error', message, family }],
 *           summary, changes? (on commit) }.
 */
const ImportApi = (() => {
  const MAX_ROWS = 500;
  const MAX_AMOUNT = 10000000;

  const key = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function catalog() {
    const courses = Db.all('Courses');
    const plans = Db.all('FeePlans').filter((p) => Validate.bool(p.active))
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
    return {
      course: new Map(courses.map((c) => [key(c.name), c])),
      plan: new Map(plans.map((p) => [key(p.name), p])),
      defaultPlan: plans.find((p) => p.frequency === 'Monthly') || plans[0] || null,
    };
  }

  /** Validates one row; throws AppError('VALIDATION') with the first problem. */
  function prepare(row, cat, cc, today) {
    const parent = {
      guardian_name: Validate.text(row.guardian_name, 'guardian_name', { required: true, max: 80, label: 'Guardian name' }),
      phone: Validate.phone(row.phone, 'phone', { required: true, countryCode: cc, label: 'Phone' }),
      alt_phone: Validate.phone(row.alt_phone, 'alt_phone', { countryCode: cc, label: 'Alternate phone' }),
      email: Validate.text(row.email, 'email', { max: 120, label: 'Email' }),
      address: Validate.text(row.address, 'address', { max: 300, label: 'Address' }),
      notes: '',
      extra: '',
    };
    const joinDate = Validate.date(row.join_date || today, 'join_date', { label: 'Join date' });
    const student = {
      name: Validate.text(row.student_name, 'student_name', { required: true, max: 80, label: 'Student name' }),
      class: Validate.text(row.class, 'class', { max: 30, label: 'Class' }),
      dob: Validate.date(row.dob, 'dob', { label: 'Date of birth' }),
      gender: Validate.text(row.gender, 'gender', { max: 20, label: 'Gender' }),
      notes: Validate.text(row.notes, 'notes', { max: 500, label: 'Notes' }),
      extra: '',
      join_date: joinDate,
      status: 'Active',
      status_reason: '',
    };

    let plan = cat.defaultPlan;
    if (String(row.fee_plan || '').trim()) {
      plan = cat.plan.get(key(row.fee_plan));
      if (!plan) Validate.fail('fee_plan', `Fee plan "${row.fee_plan}" not found`);
    }
    const seen = {};
    const enrollments = String(row.courses || '').split(/[;|\n]/).map((s) => s.trim()).filter(Boolean).map((name) => {
      const course = cat.course.get(key(name));
      if (!course) Validate.fail('courses', `Course "${name}" not found`);
      if (seen[course.id]) Validate.fail('courses', `${course.name} is listed twice`);
      if (!plan) Validate.fail('fee_plan', 'Add an active fee plan first');
      seen[course.id] = true;
      return {
        course_id: course.id, batch_id: '', fee_plan_id: plan.id, start_date: joinDate, end_date: '',
        monthly_fee_override: '', discount_note: '', status: 'Active', status_reason: '',
      };
    });

    const openingDue = Validate.number(row.opening_due, 'opening_due', { min: 0, max: MAX_AMOUNT, label: 'Opening due' });
    const note = Validate.text(row.opening_due_note, 'opening_due_note', { max: 60, label: 'Opening due note' });
    return { parent, student, enrollments, openingDue: Number(openingDue) || 0, openingNote: note };
  }

  function run(payload, ctx) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) Validate.fail('rows', 'The file has no rows');
    if (rows.length > MAX_ROWS) Validate.fail('rows', `Import at most ${MAX_ROWS} rows at a time`);
    const commit = payload.commit === true;
    const today = Util.today();
    const dueDate = Validate.date(payload.opening_due_date || today, 'opening_due_date', { required: true, label: 'Opening due date' });

    const work = () => {
      const cc = String(Db.getMap('Settings').country_code || '91');
      const cat = catalog();
      const parentsByPhone = new Map(Db.all('Parents').map((p) => [p.phone, p]));
      const namesByParent = {};
      Db.all('Students').forEach((s) => {
        (namesByParent[s.parent_id] = namesByParent[s.parent_id] || new Set()).add(key(s.name));
      });
      /** phone -> { parent (existing row or fields), existing, students: [prepared], names: Set } */
      const families = new Map();
      const results = rows.map((row, i) => {
        let p;
        try {
          p = prepare(row || {}, cat, cc, today);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          return { row: i + 1, status: 'error', message: e.message };
        }
        let fam = families.get(p.parent.phone);
        if (!fam) {
          const existing = parentsByPhone.get(p.parent.phone);
          fam = {
            parent: existing || p.parent,
            existing: !!existing,
            students: [],
            names: new Set(existing ? namesByParent[existing.id] || [] : []),
          };
          families.set(p.parent.phone, fam);
        }
        const family = fam.parent.guardian_name;
        if (fam.names.has(key(p.student.name))) {
          return { row: i + 1, status: 'duplicate', message: `${p.student.name} is already in ${family}'s family`, family };
        }
        fam.names.add(key(p.student.name));
        fam.students.push(p);
        const differs = key(family) !== key(p.parent.guardian_name);
        return {
          row: i + 1,
          status: fam.existing ? 'existing_family' : 'new_family',
          message: differs ? `Same phone as ${family}; added to that family` : '',
          family,
        };
      });

      const summary = {
        families: [...families.values()].filter((f) => f.students.length && !f.existing).length,
        existingFamilies: [...families.values()].filter((f) => f.students.length && f.existing).length,
        students: results.filter((r) => r.status === 'new_family' || r.status === 'existing_family').length,
        enrollments: 0,
        openingDues: 0,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        errors: results.filter((r) => r.status === 'error').length,
      };
      families.forEach((f) => f.students.forEach((s) => {
        summary.enrollments += s.enrollments.length;
        summary.openingDues += s.openingDue;
      }));
      if (!commit) return { results, summary };

      const changes = { Parents: [], Students: [], Enrollments: [], FeeDues: [] };
      const newFamilies = [...families.values()].filter((f) => f.students.length && !f.existing);
      Db.insert('Parents', newFamilies.map((f) => f.parent), 'PAR').forEach((saved, i) => {
        newFamilies[i].parent = saved;
        changes.Parents.push(saved);
      });

      const studentRows = [];
      const owners = [];
      families.forEach((f) => f.students.forEach((s) => {
        studentRows.push(Object.assign({ parent_id: f.parent.id }, s.student));
        owners.push(s);
      }));
      const savedStudents = Db.insert('Students', studentRows, 'STU');
      changes.Students.push(...savedStudents);

      const enrolRows = [];
      const dueRows = [];
      savedStudents.forEach((st, i) => {
        owners[i].enrollments.forEach((e) => enrolRows.push(Object.assign({ student_id: st.id }, e)));
        if (owners[i].openingDue > 0) {
          dueRows.push(FeesApi.buildCharge(st, {
            label: owners[i].openingNote || 'Opening balance',
            amount: owners[i].openingDue,
            due_date: dueDate,
            note: 'Imported opening due',
          }, ''));
        }
      });
      changes.Enrollments.push(...Db.insert('Enrollments', enrolRows, 'ENR'));
      Fees.addChanges(changes, 'FeeDues', Db.insert('FeeDues', dueRows, 'DUE'));
      if (payload.bill_current_month && changes.Enrollments.length) {
        Fees.mergeChanges(changes, Fees.generate(today.slice(0, 7), { enrollmentIds: changes.Enrollments.map((e) => e.id) }).changes);
      }
      families.forEach((f) => { if (f.existing && f.students.length) Fees.mergeChanges(changes, Fees.applyCredit(f.parent.id)); });

      Audit.log('import.students', 'Students', '', `${summary.students} student(s), ${summary.families} new family(ies), ${summary.enrollments} enrolment(s), opening dues ${summary.openingDues}`, ctx);
      return { results, summary, changes };
    };

    return commit ? Db.withLock(work) : work();
  }

  return { run };
})();
