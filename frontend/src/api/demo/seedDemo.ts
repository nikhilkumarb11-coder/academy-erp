/**
 * Builds the demo academy through the real API actions: families admitted two months ago, three months
 * of dues, most of them paid (a few families behind), an annual-plan student, attendance for the last
 * two weeks and a holiday. Dates are relative to today so the demo always looks current.
 */
type Call = (action: string, payload: unknown, token?: string) => unknown;

interface Row { id: string; [k: string]: unknown }
interface Boot {
  Courses: Row[];
  FeePlans: Row[];
  ChargeItems: Row[];
  FeeDues: Row[];
  Enrollments: Row[];
  Students: Row[];
}

const FAMILIES: [string, string, string[]][] = [
  ['Ravi Kumar', '9876500001', ['Aarav', 'Diya']], ['Lakshmi Narayanan', '9876500002', ['Vihaan']],
  ['Imran Shaikh', '9876500003', ['Ayaan', 'Zara']], ['Priya Reddy', '9876500004', ['Saanvi']],
  ['Suresh Babu', '9876500005', ['Rohan', 'Riya']], ['Anitha Joseph', '9876500006', ['Ethan']],
  ['Venkat Rao', '9876500007', ['Krishna', 'Lasya']], ['Fathima Begum', '9876500008', ['Ayesha']],
  ['Kiran Patel', '9876500009', ['Dev']], ['Deepa Menon', '9876500010', ['Nila', 'Advik']],
  ['Arjun Singh', '9876500011', ['Kabir']], ['Meena Iyer', '9876500012', ['Ananya', 'Ishaan']],
];
const FEES = [1000, 1200, 900, 800, 1500, 700, 1100, 1300, 2000, 2500];
const BEHIND = new Set([2, 6, 10]);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = (d: Date) => iso(d).slice(0, 7);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthStart = (d: Date, offset: number) => new Date(d.getFullYear(), d.getMonth() + offset, 1);

/** Deterministic pseudo-random numbers so every reset looks the same. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function seedDemo(call: Call, opts: { preset: { id: string }; academyName: string; password: string }) {
  const { token } = call('auth.login', { password: opts.password }) as { token: string };
  const api = (action: string, payload: unknown = {}) => call(action, payload, token);

  api('system.seed', { preset: opts.preset });
  api('settings.update', { academy_name: opts.academyName, academy_phone: '+919876500000', academy_address: 'Road No. 12, Banjara Hills, Hyderabad' });

  let boot = api('system.bootstrap') as Boot;
  boot.Courses.forEach((c, i) => api('catalog.save', { tab: 'Courses', row: { id: c.id, monthly_fee: FEES[i % FEES.length] } }));
  const firstCourse = boot.Courses[0];
  api('catalog.save', { tab: 'Batches', row: { course_id: firstCourse.id, name: 'Morning', schedule_note: 'Mon/Wed/Fri 7 am' } });
  api('catalog.save', { tab: 'Batches', row: { course_id: firstCourse.id, name: 'Evening', schedule_note: 'Mon/Wed/Fri 6 pm' } });

  const plans = [...boot.FeePlans].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const monthly = plans[0];
  const annual = plans.find((p) => p.frequency === 'Annual');
  const admissionFee = boot.ChargeItems.find((c) => c.applies_to === 'Admission');

  const today = new Date();
  const start = iso(monthStart(today, -2));
  const parentIds: string[] = [];
  FAMILIES.forEach(([guardian, phone, kids], fi) => {
    const res = api('admissions.create', {
      parent: { guardian_name: guardian, phone, address: 'Hyderabad' },
      students: kids.map((name, ci) => {
        const courseCount = 1 + ((fi + ci) % 2);
        return {
          name: `${name} ${guardian.split(' ')[1] ?? ''}`.trim(),
          class: String(3 + ((fi + ci) % 8)),
          join_date: start,
          charges: admissionFee ? [{ charge_item_id: admissionFee.id, amount: 500, due_date: start }] : [],
          enrollments: Array.from({ length: courseCount }, (_, k) => ({
            course_id: boot.Courses[(fi * 2 + ci + k) % boot.Courses.length].id,
            fee_plan_id: annual && fi === 3 && k === 0 ? annual.id : monthly.id,
            start_date: start,
          })),
        };
      }),
    }) as { parent_id: string };
    parentIds.push(res.parent_id);
  });

  api('dues.generate', { month: monthOf(monthStart(today, -2)) });
  api('dues.generate', { month: monthOf(monthStart(today, -1)) });

  // Families pay what was due before this month (a few are behind); half also pay this month already.
  boot = api('system.bootstrap') as Boot;
  const thisMonth = iso(monthStart(today, 0));
  parentIds.forEach((pid, i) => {
    const dues = boot.FeeDues.filter((d) => d.parent_id === pid);
    const old = dues.filter((d) => String(d.due_date) < thisMonth).reduce((s, d) => s + Number(d.balance), 0);
    const paidOld = BEHIND.has(i) ? Math.round(old / 2 / 100) * 100 : old;
    if (paidOld > 0) {
      const paidAt = iso(addDays(monthStart(today, -1), 3 + (i % 10)));
      api('payments.record', { parent_id: pid, amount: paidOld, mode: ['Cash', 'UPI', 'UPI', 'Bank'][i % 4], paid_at: paidAt });
    }
    const current = dues.filter((d) => String(d.due_date) >= thisMonth).reduce((s, d) => s + Number(d.balance), 0);
    if (!BEHIND.has(i) && i % 2 === 0 && current > 0 && today.getDate() > 2) {
      api('payments.record', { parent_id: pid, amount: current + (i === 0 ? 1000 : 0), mode: 'UPI', paid_at: iso(addDays(today, -1)) });
    }
  });

  // Attendance for the last 14 days (alternate weekdays per course), with one holiday.
  boot = api('system.bootstrap') as Boot;
  const holiday = addDays(today, -6);
  api('holidays.save', { date: iso(holiday), reason: 'Festival holiday' });
  const rnd = random(42);
  const activeStudents = new Set(boot.Students.filter((s) => s.status === 'Active').map((s) => s.id));
  boot.Courses.forEach((course, ci) => {
    const roster = boot.Enrollments.filter((e) => e.course_id === course.id && e.status === 'Active' && activeStudents.has(String(e.student_id)));
    if (!roster.length) return;
    for (let back = 14; back >= 1; back--) {
      const day = addDays(today, -back);
      const weekday = day.getDay();
      if (weekday === 0 || iso(day) === iso(holiday)) continue;
      if ((weekday + ci) % 2 === 1) continue;
      api('attendance.save', {
        course_id: course.id,
        date: iso(day),
        marks: roster.map((e) => {
          const r = rnd();
          return { student_id: e.student_id, status: r < 0.88 ? 'Present' : 'Absent' };
        }),
      });
    }
  });

  // One student on hold, to show how status affects billing.
  const onHold = boot.Students.find((s) => String(s.name).startsWith('Ethan'));
  if (onHold) api('students.setStatus', { id: onHold.id, status: 'On hold', reason: 'Exams' });

  seedBusiness(api, today, boot.Courses);
}

const ENQUIRIES: [string, string, string, number, string, number | null][] = [
  // name, phone, source, days ago, status, follow-up in days
  ['Harsha', '9876500101', 'Walk-in', 1, 'New', 0],
  ['Sneha', '9876500102', 'Social media', 4, 'Follow-up', -1],
  ['Varun', '9876500103', 'Referral', 6, 'Trial', 2],
  ['Pooja', '9876500104', 'Banner', 9, 'Follow-up', 3],
  ['Nikhil', '9876500105', 'Phone call', 20, 'Lost', null],
  ['Tara', '9876500106', 'Walk-in', 2, 'New', 1],
];

function seedBusiness(api: (action: string, payload?: unknown) => unknown, today: Date, courses: Row[]) {
  ENQUIRIES.forEach(([name, phone, source, ago, status, follow], i) => {
    api('enquiries.save', {
      row: {
        name, phone, source, status,
        enquiry_date: iso(addDays(today, -ago)),
        course_interested: courses[i % courses.length]?.id ?? '',
        next_followup_date: follow === null ? '' : iso(addDays(today, follow)),
        trial_date: status === 'Trial' ? iso(addDays(today, follow ?? 1)) : '',
        lost_reason: status === 'Lost' ? 'Timings did not suit' : '',
        notes: i === 1 ? 'Asked about weekend batches' : '',
      },
    });
  });

  const boot = api('system.bootstrap') as { ExpenseCategories: Row[] };
  const cat = (name: string) => (boot.ExpenseCategories.find((c) => String(c.name).toLowerCase().includes(name)) ?? boot.ExpenseCategories[0]).id;
  const rent = (api('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat('rent'), amount: 18000, payee: 'Landlord', day_of_month: 5, auto_create: true } }) as { changes: { RecurringExpenses: Row[] } }).changes.RecurringExpenses[0];
  const salary = (api('catalog.save', { tab: 'RecurringExpenses', row: { category_id: cat('salar'), amount: 15000, payee: 'Karate coach', day_of_month: 1, auto_create: false } }) as { changes: { RecurringExpenses: Row[] } }).changes.RecurringExpenses[0];

  [-2, -1, 0].forEach((offset) => {
    const first = monthStart(today, offset);
    const month = monthOf(first);
    const on = (day: number) => iso(new Date(first.getFullYear(), first.getMonth(), day));
    const past = (day: number) => offset < 0 || today.getDate() >= day;
    if (past(5)) api('expenses.save', { row: { date: on(5), category_id: cat('rent'), amount: 18000, mode: 'Bank', payee: 'Landlord', ref_id: `${rent.id}:${month}` } });
    if (offset < 0) api('expenses.save', { row: { date: on(1), category_id: cat('salar'), amount: 15000, mode: 'Bank', payee: 'Karate coach', ref_id: `${salary.id}:${month}` } });
    if (past(10)) api('expenses.save', { row: { date: on(10), category_id: cat('utilit'), amount: 2400 + offset * 150, mode: 'UPI', payee: 'Electricity board' } });
    if (offset === -1) api('expenses.save', { row: { date: on(14), category_id: cat('market'), amount: 3500, mode: 'Cash', payee: 'Flex banner printing', notes: 'Summer camp banners' } });
  });
  api('catalog.save', { tab: 'BalanceItems', row: { type: 'Asset', name: 'Mats and equipment', amount: 45000, as_of_date: iso(monthStart(today, -2)) } });
  api('catalog.save', { tab: 'BalanceItems', row: { type: 'Asset', name: 'Rent deposit', amount: 50000, as_of_date: iso(monthStart(today, -2)) } });
}
