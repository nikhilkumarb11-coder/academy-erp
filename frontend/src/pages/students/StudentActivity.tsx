import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { Card, StatusBadge } from '../../components/ui';
import type { AttendanceMark, CoreTables, Student } from '../../data/types';
import { formatDate, monthLabel, todayIso } from '../../lib/dates';
import { byDueOrder, dueTitle, isOpenDue } from '../../lib/ledger';
import { isDeleted, num } from '../../lib/values';
import { useModuleEnabled, useTenant } from '../../tenant/TenantContext';
import { useMoney } from '../fees/feeShared';

/** Student profile: this child's open dues, recent payments and this month's attendance. */
export function StudentActivity({ t, student }: { t: CoreTables; student: Student }) {
  const money = useMoney();
  const today = todayIso();
  const dues = t.FeeDues.filter((d) => d.student_id === student.id && !isDeleted(d));
  const open = dues.filter(isOpenDue).sort(byDueOrder);
  const balance = open.reduce((s, d) => s + num(d.balance), 0);
  const dueIds = new Set(dues.map((d) => d.id));
  const paymentIds = new Set(t.PaymentAllocations.filter((a) => a.student_id === student.id || dueIds.has(a.due_id)).map((a) => a.payment_id));
  const payments = t.Payments.filter((p) => paymentIds.has(p.id)).sort((a, b) => b.paid_at.localeCompare(a.paid_at)).slice(0, 3);
  const familyPath = `/fees/${student.parent_id}`;

  return (
    <>
      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Fees</h2>
            <p className="text-sm text-muted">{balance > 0 ? `${money(balance)} due` : dues.length ? 'All paid' : 'No dues yet'}</p>
          </div>
          {balance > 0 && (
            <Link to={`${familyPath}?pay=1`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-medium text-white">
              <Wallet className="size-4" aria-hidden /> Collect
            </Link>
          )}
        </div>
        {open.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-xl border border-line text-sm">
            {open.slice(0, 4).map((d) => {
              const { title, period } = dueTitle(t, d);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 break-words">{title}{period && <span className="text-muted"> · {period}</span>}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{money(num(d.balance))}</span>
                    {d.due_date < today && <StatusBadge status="Overdue" />}
                  </span>
                </li>
              );
            })}
            {open.length > 4 && <li className="px-3 py-2 text-muted">+{open.length - 4} more</li>}
          </ul>
        )}
        {payments.length > 0 && (
          <>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Recent payments</p>
            <ul className="mb-2 space-y-1 text-sm">
              {payments.map((p) => (
                <li key={p.id}>
                  <Link to={`/receipts/${p.id}`} className="flex justify-between gap-3 hover:text-primary">
                    <span className={p.status === 'Cancelled' ? 'text-muted line-through' : ''}>{formatDate(p.paid_at)} · {p.mode}</span>
                    <span className="tabular-nums">{money(num(p.amount))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Link to={familyPath} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">Family fees & receipts <ChevronRight className="size-4" aria-hidden /></Link>
      </Card>
      <AttendanceSummary studentId={student.id} />
    </>
  );
}

function AttendanceSummary({ studentId }: { studentId: string }) {
  const enabled = useModuleEnabled('attendance');
  const tenant = useTenant();
  const { api } = useAuth();
  const month = todayIso().slice(0, 7);
  const report = useQuery({
    queryKey: ['attendance-student', tenant.slug, studentId, month],
    queryFn: () => api<{ rows: AttendanceMark[] }>('attendance.report', { month, student_id: studentId }),
    enabled,
  });
  if (!enabled) return null;

  const rows = (report.data?.rows ?? []).filter((r) => r.status === 'Present' || r.status === 'Absent');
  const present = rows.filter((r) => r.status === 'Present').length;
  const pct = rows.length ? Math.round((present / rows.length) * 100) : null;
  const recentAbsences = rows.filter((r) => r.status === 'Absent').map((r) => r.date).sort().reverse().slice(0, 3);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Attendance</h2>
          <p className="text-sm text-muted">{monthLabel(month)}</p>
        </div>
        {pct !== null && <p className={`text-2xl font-semibold tabular-nums ${pct < 75 ? 'text-danger' : 'text-success'}`}>{pct}%</p>}
      </div>
      {report.isPending ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : report.isError ? (
        <p className="mt-2 text-sm text-muted">Could not load attendance.</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Not marked yet this month.</p>
      ) : (
        <>
          <p className="mt-2 text-sm">{present} present · {rows.length - present} absent</p>
          {recentAbsences.length > 0 && <p className="mt-1 text-xs text-muted">Absent on {recentAbsences.map(formatDate).join(', ')}</p>}
        </>
      )}
      <Link to="/attendance" className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">Mark attendance <ChevronRight className="size-4" aria-hidden /></Link>
    </Card>
  );
}
