/**
 * Row shapes returned by the Apps Script API. Mirrors backend/Schema.js.
 * Sheets returns booleans as true/"TRUE" and numbers as number/"" so use the helpers in lib/values.
 */

type SheetBool = boolean | 'TRUE' | 'FALSE' | '';
type SheetNumber = number | '';

interface Timestamps {
  created_at: string;
  updated_at: string;
}

interface Entity extends Timestamps {
  id: string;
  deleted?: SheetBool;
}

export interface Category extends Entity {
  name: string;
  sort_order: SheetNumber;
}

export interface Course extends Entity {
  category_id: string;
  name: string;
  monthly_fee: SheetNumber;
  classes_per_week: SheetNumber;
  description: string;
  active: SheetBool;
  sort_order: SheetNumber;
}

export interface Batch extends Entity {
  course_id: string;
  name: string;
  schedule_note: string;
  capacity: SheetNumber;
  active: SheetBool;
}

export interface FeePlan extends Entity {
  name: string;
  frequency: 'Monthly' | 'Quarterly' | 'HalfYearly' | 'Annual';
  months_covered: SheetNumber;
  discount_pct: SheetNumber;
  active: SheetBool;
  sort_order: SheetNumber;
}

export interface ChargeItem extends Entity {
  name: string;
  default_amount: SheetNumber;
  applies_to: 'Admission' | 'Course' | 'Any';
  active: SheetBool;
}

export interface CustomField extends Entity {
  entity: 'Student' | 'Parent' | 'Enquiry';
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options: string;
  required: SheetBool;
  sort_order: SheetNumber;
  active: SheetBool;
}

export interface Parent extends Entity {
  guardian_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  address: string;
  notes: string;
  extra: string;
}

export type StudentStatus = 'Active' | 'On hold' | 'Dropped' | 'Completed';

export interface Student extends Entity {
  parent_id: string;
  name: string;
  class: string;
  dob: string;
  gender: string;
  join_date: string;
  status: StudentStatus;
  status_reason: string;
  notes: string;
  extra: string;
}

export interface Enrollment extends Entity {
  student_id: string;
  course_id: string;
  batch_id: string;
  fee_plan_id: string;
  start_date: string;
  end_date: string;
  monthly_fee_override: SheetNumber;
  discount_note: string;
  status: StudentStatus;
  status_reason: string;
}

export interface MessageTemplate extends Entity {
  type: string;
  name: string;
  text: string;
  active: SheetBool;
}

export interface ExpenseCategory extends Entity {
  name: string;
  sort_order: SheetNumber;
}

export type DueStatus = 'Pending' | 'Partial' | 'Paid' | 'Waived';

export interface FeeDue extends Timestamps {
  id: string;
  kind: 'Recurring' | 'OneTime';
  enrollment_id: string;
  student_id: string;
  parent_id: string;
  charge_item_id: string;
  period_key: string;
  period_label: string;
  period_start: string;
  period_end: string;
  amount_due: SheetNumber;
  discount: SheetNumber;
  adjustment: SheetNumber;
  amount_paid: SheetNumber;
  balance: SheetNumber;
  prorated: SheetBool;
  due_date: string;
  status: DueStatus;
  notes: string;
  deleted?: SheetBool;
}

export type PaymentMode = 'Gateway' | 'Cash' | 'UPI' | 'Bank';

export interface Payment extends Timestamps {
  id: string;
  parent_id: string;
  amount: SheetNumber;
  mode: PaymentMode;
  paid_at: string;
  gateway_payment_id: string;
  link_id: string;
  receipt_no: string;
  status: 'Recorded' | 'Cancelled';
  cancel_reason: string;
  notes: string;
  client_ref: string;
}

export interface PaymentAllocation extends Timestamps {
  id: string;
  payment_id: string;
  /** Blank = unspent credit (advance). */
  due_id: string;
  student_id: string;
  amount: SheetNumber;
}

export interface Receipt extends Timestamps {
  id: string;
  receipt_no: string;
  payment_id: string;
  drive_file_id: string;
  drive_url: string;
  status: 'Active' | 'Cancelled';
}

export interface Holiday extends Entity {
  date: string;
  /** Blank = all courses. */
  course_id: string;
  reason: string;
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Leave';

export interface AttendanceMark extends Timestamps {
  id: string;
  date: string;
  course_id: string;
  batch_id: string;
  student_id: string;
  status: AttendanceStatus;
  remarks: string;
}

export type Settings = Record<string, string>;

/** Tabs cached on the device (BOOTSTRAP_TABS in backend/Schema.js). */
export interface CoreTables {
  Categories: Category[];
  Courses: Course[];
  Batches: Batch[];
  FeePlans: FeePlan[];
  ChargeItems: ChargeItem[];
  CustomFields: CustomField[];
  Parents: Parent[];
  Students: Student[];
  Enrollments: Enrollment[];
  MessageTemplates: MessageTemplate[];
  ExpenseCategories: ExpenseCategory[];
  FeeDues: FeeDue[];
  Payments: Payment[];
  PaymentAllocations: PaymentAllocation[];
  Receipts: Receipt[];
  Holidays: Holiday[];
}

export type CoreTabName = keyof CoreTables;

export const CORE_TABS: CoreTabName[] = [
  'Categories', 'Courses', 'Batches', 'FeePlans', 'ChargeItems', 'CustomFields',
  'Parents', 'Students', 'Enrollments', 'MessageTemplates', 'ExpenseCategories',
  'FeeDues', 'Payments', 'PaymentAllocations', 'Receipts', 'Holidays',
];

/** Changes whenever the set of cached tabs changes, so caches from older builds are discarded. */
export const CACHE_SHAPE = CORE_TABS.join(',').length.toString(36) + CORE_TABS.length;

/** Response of system.bootstrap and system.sync. */
export type CoreSnapshot = CoreTables & { settings: Settings; serverTime: string };

export interface CoreData {
  tables: CoreTables;
  settings: Settings;
  /** Server clock of the last successful bootstrap/sync; next sync asks for changes after it. */
  syncedAt: string;
}

export interface PingResult {
  apiVersion: number;
  schemaVersion: number;
  serverTime: string;
}

export interface Session {
  token: string;
  expiresAt: number;
}
