export interface TenantTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  fontHeading: string;
  fontBody: string;
}

export interface TenantLabels {
  course: string;
  courses: string;
  batch: string;
  student: string;
  students: string;
  guardian: string;
  guardians: string;
  class: string;
}

export interface TenantLocale {
  currency: string;
  currencySymbol: string;
  countryCode: string;
  language: string;
  timezone: string;
}

export type ModuleKey = 'attendance' | 'onlinePayments' | 'enquiries' | 'expenses' | 'finance';

export interface TenantConfig {
  slug: string;
  name: string;
  shortName: string;
  /** Apps Script web app URL, or "mock" for the in-browser demo backend. Empty = not deployed yet. */
  apiUrl: string;
  expectedApiVersion: number;
  preset: string;
  logo: string;
  theme: TenantTheme;
  labels: TenantLabels;
  locale: TenantLocale;
  modules: Record<ModuleKey, boolean>;
}
