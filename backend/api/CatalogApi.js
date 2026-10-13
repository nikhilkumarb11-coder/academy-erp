/**
 * Course master: categories, courses, batches, fee plans, one-time charge items.
 * catalog.save  { tab, row }   insert when row.id is missing, otherwise partial update
 * catalog.delete { tab, id }   soft delete, refused while the record is in use
 * Both return { changes: { <Tab>: [row] } } for the client to merge into its cache.
 */
const CatalogApi = (() => {
  const ACTIVE_ENROLLMENT = (e) => e.status === 'Active' || e.status === 'On hold';

  function nextSortOrder(tab) {
    return Db.all(tab).reduce((max, r) => Math.max(max, Number(r.sort_order) || 0), 0) + 1;
  }

  const DEFS = {
    Categories: {
      prefix: 'CAT',
      label: 'Category',
      normalize(row) {
        return {
          name: Validate.text(row.name, 'name', { required: true, max: 60, label: 'Name' }),
          sort_order: Validate.number(row.sort_order, 'sort_order', { label: 'Order' }),
        };
      },
      check(row) {
        Validate.unique('Categories', 'name', row.name, { selfId: row.id, label: 'Category' });
      },
      inUse(id) {
        const n = Db.where('Courses', (c) => c.category_id === id).length;
        return n ? `It still has ${n} course(s). Move or delete them first.` : '';
      },
    },

    Courses: {
      prefix: 'CRS',
      label: 'Course',
      normalize(row) {
        return {
          category_id: Validate.text(row.category_id, 'category_id', { required: true, label: 'Category' }),
          name: Validate.text(row.name, 'name', { required: true, max: 80, label: 'Name' }),
          monthly_fee: Validate.number(row.monthly_fee, 'monthly_fee', { min: 0, max: 10000000, label: 'Monthly fee' }),
          classes_per_week: Validate.number(row.classes_per_week, 'classes_per_week', { min: 0, max: 21, integer: true, label: 'Classes per week' }),
          description: Validate.text(row.description, 'description', { max: 500, label: 'Description' }),
          active: Validate.bool(row.active),
          sort_order: Validate.number(row.sort_order, 'sort_order', { label: 'Order' }),
        };
      },
      check(row) {
        const cat = Db.find('Categories', row.category_id);
        if (!cat || Db.isDeleted(cat)) Validate.fail('category_id', 'Choose a valid category');
        Validate.unique('Courses', 'name', row.name, { selfId: row.id, label: 'Course' });
      },
      inUse(id) {
        const n = Db.where('Enrollments', (e) => e.course_id === id && ACTIVE_ENROLLMENT(e)).length;
        return n ? `${n} student(s) are enrolled. Mark the course inactive instead.` : '';
      },
    },

    Batches: {
      prefix: 'BAT',
      label: 'Batch',
      normalize(row) {
        return {
          course_id: Validate.text(row.course_id, 'course_id', { required: true, label: 'Course' }),
          name: Validate.text(row.name, 'name', { required: true, max: 60, label: 'Name' }),
          schedule_note: Validate.text(row.schedule_note, 'schedule_note', { max: 120, label: 'Schedule' }),
          capacity: Validate.number(row.capacity, 'capacity', { min: 0, max: 1000, integer: true, label: 'Capacity' }),
          active: Validate.bool(row.active),
        };
      },
      check(row) {
        const course = Db.find('Courses', row.course_id);
        if (!course || Db.isDeleted(course)) Validate.fail('course_id', 'Choose a valid course');
        Validate.unique('Batches', 'name', row.name, { selfId: row.id, scope: (b) => b.course_id === row.course_id, label: 'Batch' });
      },
      inUse(id) {
        const n = Db.where('Enrollments', (e) => e.batch_id === id && ACTIVE_ENROLLMENT(e)).length;
        return n ? `${n} student(s) are in this batch. Mark it inactive instead.` : '';
      },
    },

    FeePlans: {
      prefix: 'FPL',
      label: 'Fee plan',
      normalize(row) {
        return {
          name: Validate.text(row.name, 'name', { required: true, max: 60, label: 'Name' }),
          frequency: Validate.oneOf(row.frequency, 'frequency', STATUS.feePlanFrequency, { label: 'Frequency' }),
          months_covered: Validate.number(row.months_covered, 'months_covered', { required: true, min: 1, max: 24, integer: true, label: 'Months covered' }),
          discount_pct: Validate.number(row.discount_pct === '' ? 0 : row.discount_pct, 'discount_pct', { required: true, min: 0, max: 100, label: 'Discount %' }),
          active: Validate.bool(row.active),
          sort_order: Validate.number(row.sort_order, 'sort_order', { label: 'Order' }),
        };
      },
      check(row) {
        Validate.unique('FeePlans', 'name', row.name, { selfId: row.id, label: 'Fee plan' });
        if (!row.active && !Db.all('FeePlans').some((p) => p.id !== row.id && Validate.bool(p.active))) {
          Validate.fail('active', 'At least one fee plan must stay active');
        }
      },
      inUse(id) {
        const n = Db.where('Enrollments', (e) => e.fee_plan_id === id && ACTIVE_ENROLLMENT(e)).length;
        if (n) return `${n} enrolment(s) use this plan. Mark it inactive instead.`;
        const othersActive = Db.all('FeePlans').some((p) => p.id !== id && Validate.bool(p.active));
        return othersActive ? '' : 'At least one active fee plan is required.';
      },
    },

    ChargeItems: {
      prefix: 'CHG',
      label: 'Charge',
      normalize(row) {
        return {
          name: Validate.text(row.name, 'name', { required: true, max: 60, label: 'Name' }),
          default_amount: Validate.number(row.default_amount, 'default_amount', { min: 0, max: 10000000, label: 'Default amount' }),
          applies_to: Validate.oneOf(row.applies_to || 'Any', 'applies_to', ['Admission', 'Course', 'Any'], { label: 'Applies to' }),
          active: Validate.bool(row.active),
        };
      },
      check(row) {
        Validate.unique('ChargeItems', 'name', row.name, { selfId: row.id, label: 'Charge' });
      },
      inUse() {
        return ''; // phase 3: refuse while unpaid dues reference the item
      },
    },

    MessageTemplates: {
      prefix: 'TPL',
      label: 'Template',
      normalize(row) {
        return {
          type: Validate.oneOf(row.type, 'type', STATUS.templateType, { label: 'Type' }),
          name: Validate.text(row.name, 'name', { required: true, max: 60, label: 'Name' }),
          text: Validate.text(row.text, 'text', { required: true, max: 1000, label: 'Message' }),
          active: Validate.bool(row.active),
        };
      },
      check(row) {
        Validate.unique('MessageTemplates', 'name', row.name, { selfId: row.id, label: 'Template' });
      },
      inUse() {
        return '';
      },
    },

    WhatsAppGroups: {
      prefix: 'WAG',
      label: 'Group',
      normalize(row) {
        return {
          name: Validate.text(row.name, 'name', { required: true, max: 80, label: 'Name' }),
          notes: Validate.text(row.notes, 'notes', { max: 200, label: 'Notes' }),
        };
      },
      check(row) {
        Validate.unique('WhatsAppGroups', 'name', row.name, { selfId: row.id, label: 'Group' });
      },
      inUse() {
        return '';
      },
    },
  };

  function defFor(tab) {
    const def = DEFS[tab];
    if (!def) throw new AppError('VALIDATION', `Unknown catalogue: ${tab}`);
    return def;
  }

  function save(payload, ctx) {
    const def = defFor(payload.tab);
    const input = payload.row || {};

    return Db.withLock(() => {
      let existing = null;
      if (input.id) {
        existing = Db.find(payload.tab, input.id);
        if (!existing || Db.isDeleted(existing)) throw new AppError('NOT_FOUND', `${def.label} not found`);
      }
      const base = existing || { active: true, sort_order: nextSortOrder(payload.tab) };
      const merged = Object.assign({}, base, input);
      const clean = def.normalize(merged);
      if (clean.sort_order === '' && 'sort_order' in clean) clean.sort_order = base.sort_order || nextSortOrder(payload.tab);
      def.check(Object.assign({ id: input.id }, clean));

      const saved = existing
        ? Db.update(payload.tab, [Object.assign({ id: existing.id }, clean)])[0]
        : Db.insert(payload.tab, [clean], def.prefix)[0];
      Audit.log(existing ? 'catalog.update' : 'catalog.create', payload.tab, saved.id, clean.name, ctx);
      return { changes: { [payload.tab]: [saved] } };
    });
  }

  function remove(payload, ctx) {
    const def = defFor(payload.tab);
    Util.requireFields(payload, ['id']);
    return Db.withLock(() => {
      const row = Db.find(payload.tab, payload.id);
      if (!row || Db.isDeleted(row)) throw new AppError('NOT_FOUND', `${def.label} not found`);
      const reason = def.inUse(row.id);
      if (reason) throw new AppError('CONFLICT', `Cannot delete "${row.name}". ${reason}`);
      const deleted = Db.softDelete(payload.tab, [row.id])[0];
      Audit.log('catalog.delete', payload.tab, row.id, row.name, ctx);
      return { changes: { [payload.tab]: [deleted] } };
    });
  }

  return { save, remove };
})();
