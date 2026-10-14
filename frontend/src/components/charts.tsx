import { useMemo, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useMoney } from '../pages/fees/feeShared';
import { useTenant } from '../tenant/TenantContext';
import { Card } from './ui';

/** Chart colours from the tenant theme; SVG attributes cannot read CSS variables, so they are resolved here. */
export function useChartColors() {
  const tenant = useTenant();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const primary = read('--tenant-primary', '#0b1f3a');
    const accent = read('--tenant-accent', '#c9a227');
    return {
      primary,
      accent,
      success: read('--color-success', '#15803d'),
      danger: read('--color-danger', '#b91c1c'),
      muted: read('--color-muted', '#6b7280'),
      line: read('--color-line', '#e5e1d8'),
      palette: [primary, accent, '#0f766e', '#7c3aed', '#db2777', '#2563eb', '#ea580c', '#65a30d', '#0891b2', '#9ca3af'],
    };
  }, [tenant.slug]); // the theme variables change with the tenant
}

/** Short amounts for axes: ₹12K, ₹1.2L. */
export function useCompactMoney() {
  const { locale } = useTenant();
  return useMemo(() => {
    const f = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
    return (n: number) => `${n < 0 ? '−' : ''}${locale.currencySymbol}${f.format(Math.abs(n))}`;
  }, [locale.currencySymbol]);
}

export function ChartCard({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

const tooltipStyle = { borderRadius: 12, border: '1px solid #e5e1d8', fontSize: 12, boxShadow: '0 4px 16px rgb(0 0 0 / 0.08)' };

export interface Slice {
  name: string;
  value: number;
}

/** Donut with the total in the middle and a legend listing each share. */
export function Donut({ data, totalLabel, money: asMoney = true }: { data: Slice[]; totalLabel: string; money?: boolean }) {
  const colors = useChartColors();
  const money = useMoney();
  const fmt = (n: number) => (asMoney ? money(n) : String(n));
  const shown = data.filter((d) => d.value > 0);
  const total = shown.reduce((s, d) => s + d.value, 0);
  if (!total) return <p className="py-8 text-center text-sm text-muted">Nothing to show yet.</p>;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[11rem_1fr]">
      <div className="relative mx-auto size-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="100%" paddingAngle={shown.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {shown.map((d, i) => <Cell key={d.name} fill={colors.palette[i % colors.palette.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-base font-semibold tabular-nums">{fmt(total)}</p>
            <p className="text-[11px] text-muted">{totalLabel}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {shown.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colors.palette[i % colors.palette.length] }} />
            <span className="min-w-0 flex-1 break-words">{d.name}</span>
            <span className="tabular-nums text-muted">{Math.round((d.value / total) * 100)}%</span>
            <span className="w-24 text-right font-medium tabular-nums">{fmt(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface InOutPoint {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

/** Money in and out per month as bars, with the profit as a line. */
export function InOutChart({ data, height = 260 }: { data: InOutPoint[]; height?: number }) {
  const colors = useChartColors();
  const money = useMoney();
  const compact = useCompactMoney();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: colors.muted }} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: colors.muted }} />
          <Tooltip formatter={(v) => money(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: colors.line, opacity: 0.4 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="inflow" name="Money in" fill={colors.primary} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="outflow" name="Money out" fill={colors.accent} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Line dataKey="net" name="Profit" stroke={colors.success} strokeWidth={2} dot={{ r: 2.5 }} type="linear" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Simple vertical bars; the highlighted bar uses the primary colour, others a lighter one. */
export function Bars({ data, money: asMoney = true, highlight, onSelect, height = 220, color }: {
  data: { label: string; value: number; key?: string }[];
  money?: boolean;
  highlight?: string;
  onSelect?: (key: string) => void;
  height?: number;
  color?: string;
}) {
  const colors = useChartColors();
  const money = useMoney();
  const compact = useCompactMoney();
  const fill = color ?? colors.primary;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={colors.line} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: colors.muted }} />
          <YAxis tickFormatter={asMoney ? compact : undefined} allowDecimals={false} tickLine={false} axisLine={false} width={asMoney ? 52 : 32} tick={{ fontSize: 11, fill: colors.muted }} />
          <Tooltip formatter={(v) => (asMoney ? money(Number(v)) : String(v))} contentStyle={tooltipStyle} cursor={{ fill: colors.line, opacity: 0.4 }} />
          <Bar dataKey="value" name="" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}
            onClick={onSelect ? (d) => onSelect(String((d as { payload?: { key?: string } }).payload?.key ?? '')) : undefined}
            className={onSelect ? 'cursor-pointer' : undefined}>
            {data.map((d) => <Cell key={d.key ?? d.label} fill={fill} fillOpacity={!highlight || d.key === highlight ? 1 : 0.35} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for ranked lists (enrolment by course, income by course). */
export function RankBars({ data, money: asMoney = false, color }: { data: { label: string; value: number }[]; money?: boolean; color?: string }) {
  const colors = useChartColors();
  const money = useMoney();
  if (!data.length) return <p className="py-8 text-center text-sm text-muted">Nothing to show yet.</p>;
  return (
    <div style={{ height: Math.max(120, data.length * 34 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: colors.muted }} />
          <Tooltip formatter={(v) => (asMoney ? money(Number(v)) : String(v))} contentStyle={tooltipStyle} cursor={{ fill: colors.line, opacity: 0.4 }} />
          <Bar dataKey="value" name="" fill={color ?? colors.accent} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}
            label={{ position: 'right', fontSize: 12, fill: colors.muted, formatter: (v: unknown) => (asMoney ? money(Number(v)) : String(v)) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
