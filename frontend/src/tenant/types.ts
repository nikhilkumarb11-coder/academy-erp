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
  /** Square logo: a path under the site (e.g. "branding/rays/logo.png") or a full URL. Empty = initial letter. */
  logo: string;
  /** Folder with icon-192.png, icon-512.png, maskable-512.png and apple-touch-icon.png for installing the app. */
  icons?: string;
  tagline?: string;
  /** Public profile settings (address, phone, contact person, ...) filled in once when still empty. */
  profile?: Record<string, string>;
  theme: TenantTheme;
  labels: TenantLabels;
  locale: TenantLocale;
  modules: Record<ModuleKey, boolean>;
}
