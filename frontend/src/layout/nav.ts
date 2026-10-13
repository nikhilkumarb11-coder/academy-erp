import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck,
  IndianRupee,
  LayoutDashboard,
  MessageCircle,
  PhoneIncoming,
  Receipt,
  Settings,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, TenantLabels } from '../tenant/types';

export interface NavItem {
  to: string;
  label: (l: TenantLabels) => string;
  icon: LucideIcon;
  module?: ModuleKey;
  /** Shown in the mobile bottom bar; everything else lives under "More". */
  mobileTab?: boolean;
  /** Phase in which the screen is built (docs/01-Development-Plan.md). */
  phase: number;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: () => 'Dashboard', icon: LayoutDashboard, mobileTab: true, phase: 5 },
  { to: '/students', label: (l) => l.students, icon: Users, mobileTab: true, phase: 2 },
  { to: '/admissions/new', label: () => 'New admission', icon: UserPlus, phase: 2 },
  { to: '/courses', label: (l) => l.courses, icon: BookOpen, phase: 2 },
  { to: '/attendance', label: () => 'Attendance', icon: CalendarCheck, module: 'attendance', mobileTab: true, phase: 3 },
  { to: '/fees', label: () => 'Fees & dues', icon: IndianRupee, mobileTab: true, phase: 3 },
  { to: '/payments', label: () => 'Payments', icon: Receipt, phase: 3 },
  { to: '/reminders', label: () => 'Reminders', icon: MessageCircle, phase: 4 },
  { to: '/notifications', label: () => 'Payments received', icon: Bell, module: 'onlinePayments', phase: 4 },
  { to: '/enquiries', label: () => 'Enquiries', icon: PhoneIncoming, module: 'enquiries', phase: 5 },
  { to: '/expenses', label: () => 'Expenses', icon: Wallet, module: 'expenses', phase: 5 },
  { to: '/reports', label: () => 'Reports', icon: BarChart3, module: 'finance', phase: 5 },
  { to: '/settings', label: () => 'Settings', icon: Settings, phase: 1 },
];

export function visibleNav(modules: Record<ModuleKey, boolean>): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.module || modules[item.module] !== false);
}
