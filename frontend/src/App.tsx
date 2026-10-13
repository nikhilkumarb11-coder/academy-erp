import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { lazy, useEffect, useMemo, useState, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { FullScreenMessage, Spinner } from './components/ui';
import { createQueryClient, idbPersister } from './data/queryClient';
import { CACHE_SHAPE } from './data/types';
import { AppShell } from './layout/AppShell';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MorePage } from './pages/MorePage';
import { TenantPickerPage } from './pages/TenantPickerPage';
import { loadTenant, slugFromLocation, tenantBasePath } from './tenant/loadTenant';
import { TenantContext } from './tenant/TenantContext';
import { applyTenantBranding } from './tenant/theme';
import type { TenantConfig } from './tenant/types';

const CACHE_MAX_AGE = 7 * 24 * 3600_000;

/** Route-level code splitting: each screen downloads on first visit (the service worker precaches them all). */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const ImportPage = page(() => import('./pages/settings/ImportPage'), 'ImportPage');
const AdmissionPage = page(() => import('./pages/admissions/AdmissionPage'), 'AdmissionPage');
const AttendancePage = page(() => import('./pages/attendance/AttendancePage'), 'AttendancePage');
const CourseMasterPage = page(() => import('./pages/courses/CourseMasterPage'), 'CourseMasterPage');
const EnquiriesPage = page(() => import('./pages/enquiries/EnquiriesPage'), 'EnquiriesPage');
const ExpensesPage = page(() => import('./pages/expenses/ExpensesPage'), 'ExpensesPage');
const FamilyFeesPage = page(() => import('./pages/fees/FamilyFeesPage'), 'FamilyFeesPage');
const FeesPage = page(() => import('./pages/fees/FeesPage'), 'FeesPage');
const PaymentsPage = page(() => import('./pages/fees/PaymentsPage'), 'PaymentsPage');
const ReceiptPage = page(() => import('./pages/fees/ReceiptPage'), 'ReceiptPage');
const RemindersPage = page(() => import('./pages/reminders/RemindersPage'), 'RemindersPage');
const ReportsPage = page(() => import('./pages/reports/ReportsPage'), 'ReportsPage');
const StudentProfilePage = page(() => import('./pages/students/StudentProfilePage'), 'StudentProfilePage');
const StudentsPage = page(() => import('./pages/students/StudentsPage'), 'StudentsPage');

function AppRoutes() {
  const { session } = useAuth();
  if (!session) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="students/:id" element={<StudentProfilePage />} />
        <Route path="admissions/new" element={<AdmissionPage />} />
        <Route path="courses" element={<CourseMasterPage />} />
        <Route path="fees" element={<FeesPage />} />
        <Route path="fees/:parentId" element={<FamilyFeesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="receipts/:paymentId" element={<ReceiptPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="enquiries" element={<EnquiriesPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/import" element={<ImportPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>
      <Route path="login" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function TenantApp({ tenant }: { tenant: TenantConfig }) {
  const queryClient = useMemo(() => createQueryClient(), []);
  const persister = useMemo(() => idbPersister(tenant.slug), [tenant.slug]);

  if (!tenant.apiUrl) {
    return (
      <FullScreenMessage title={tenant.name}>
        This academy has not been connected to its server yet. Please contact support.
      </FullScreenMessage>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        // A new API version may change row shapes, so drop caches from older builds.
        buster: `api-${tenant.expectedApiVersion}-${CACHE_SHAPE}`,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.queryKey[0] === 'core' && q.state.status === 'success',
        },
      }}
    >
      <TenantContext.Provider value={tenant}>
        <AuthProvider onLogout={() => persister.removeClient()}>
          <ToastProvider>
            <BrowserRouter basename={tenantBasePath(tenant.slug)}>
              <AppRoutes />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </TenantContext.Provider>
    </PersistQueryClientProvider>
  );
}

type LoadState = { status: 'loading' } | { status: 'ready'; tenant: TenantConfig } | { status: 'missing' } | { status: 'error' };

export function App() {
  const slug = useMemo(() => slugFromLocation(), []);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!slug) return;
    loadTenant(slug)
      .then((tenant) => {
        applyTenantBranding(tenant);
        setState({ status: 'ready', tenant });
      })
      .catch((err: Error) => setState({ status: err.message === 'NOT_FOUND' ? 'missing' : 'error' }));
  }, [slug]);

  if (!slug) return <TenantPickerPage />;
  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'missing') return <TenantPickerPage notFound={slug} />;
  if (state.status === 'error') {
    return (
      <FullScreenMessage title="Could not load">
        Check your internet connection and{' '}
        <button type="button" className="font-semibold text-primary underline" onClick={() => window.location.reload()}>try again</button>.
      </FullScreenMessage>
    );
  }
  return <TenantApp tenant={state.tenant} />;
}
