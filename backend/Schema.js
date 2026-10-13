/**
 * Single source of truth for spreadsheet tabs and columns.
 * Columns may be appended, never renamed or removed (other tenants' sheets depend on them).
 * Column order in a sheet does not matter: Db maps by header name.
 */

const API_VERSION = 1;

const COMMON = ['created_at', 'updated_at'];
const ENTITY = ['deleted', ...COMMON];

const SCHEMA = {
  _meta: ['key', 'value'],
  Settings: ['key', 'value', 'updated_at'],
  Counters: ['key', 'value', 'updated_at'],

  Parents: ['id', 'guardian_name', 'phone', 'alt_phone', 'email', 'address', 'notes', 'extra', ...ENTITY],
  Students: ['id', 'parent_id', 'name', 'class', 'dob', 'gender', 'join_date', 'status', 'status_reason', 'notes', 'extra', ...ENTITY],

  Categories: ['id', 'name', 'sort_order', ...ENTITY],
  Courses: ['id', 'category_id', 'name', 'monthly_fee', 'classes_per_week', 'description', 'active', 'sort_order', ...ENTITY],
  Batches: ['id', 'course_id', 'name', 'schedule_note', 'capacity', 'active', ...ENTITY],
  FeePlans: ['id', 'name', 'frequency', 'months_covered', 'discount_pct', 'active', 'sort_order', ...ENTITY],
  ChargeItems: ['id', 'name', 'default_amount', 'applies_to', 'active', ...ENTITY],

  Enrollments: ['id', 'student_id', 'course_id', 'batch_id', 'fee_plan_id', 'start_date', 'end_date', 'monthly_fee_override', 'discount_note', 'status', 'status_reason', ...ENTITY],

  Attendance: ['id', 'date', 'course_id', 'batch_id', 'student_id', 'status', 'remarks', ...COMMON],
  Holidays: ['id', 'date', 'course_id', 'reason', ...ENTITY],

  FeeDues: ['id', 'kind', 'enrollment_id', 'student_id', 'parent_id', 'charge_item_id', 'period_key', 'period_label', 'period_start', 'period_end', 'amount_due', 'discount', 'adjustment', 'amount_paid', 'balance', 'prorated', 'due_date', 'status', 'notes', ...COMMON, 'deleted'],
  Payments: ['id', 'parent_id', 'amount', 'mode', 'paid_at', 'gateway_payment_id', 'link_id', 'receipt_no', 'status', 'cancel_reason', 'notes', ...COMMON, 'client_ref'],
  PaymentAllocations: ['id', 'payment_id', 'due_id', 'student_id', 'amount', ...COMMON],
  PaymentLinks: ['id', 'parent_id', 'due_ids', 'amount', 'gateway_link_id', 'short_url', 'status', 'expires_at', ...COMMON],
  Receipts: ['id', 'receipt_no', 'payment_id', 'drive_file_id', 'drive_url', 'status', ...COMMON],

  Enquiries: ['id', 'name', 'phone', 'course_interested', 'source', 'enquiry_date', 'next_followup_date', 'trial_date', 'status', 'lost_reason', 'notes', 'converted_student_id', 'extra', ...ENTITY],

  ExpenseCategories: ['id', 'name', 'sort_order', ...ENTITY],
  Expenses: ['id', 'date', 'category_id', 'amount', 'mode', 'payee', 'notes', 'source', 'ref_id', ...ENTITY],
  RecurringExpenses: ['id', 'category_id', 'amount', 'payee', 'day_of_month', 'auto_create', 'active', 'notes', ...ENTITY],
  BalanceItems: ['id', 'type', 'name', 'amount', 'as_of_date', 'notes', ...ENTITY],

  MessageTemplates: ['id', 'type', 'name', 'text', 'active', ...ENTITY],
  MessageLog: ['id', 'sent_at', 'type', 'parent_id', 'student_id', 'template_id', 'channel', 'preview'],
  WhatsAppGroups: ['id', 'name', 'notes', 'last_sent_at', ...ENTITY],
  Notifications: ['id', 'type', 'title', 'body', 'ref_entity', 'ref_id', 'read', 'created_at'],

  CustomFields: ['id', 'entity', 'key', 'label', 'type', 'options', 'required', 'sort_order', 'active', ...ENTITY],

  AuditLog: ['timestamp', 'action', 'entity', 'entity_id', 'summary', 'device'],
};

/** Columns stored as plain text so Sheets never auto-converts dates, phones or period keys. */
const TEXT_COLUMN_PATTERN = /(^id$|_id$|_ids$|date|_at$|^timestamp$|phone|period_|^key$|^value$|receipt_no|^class$|^dob$)/;

/** Tabs whose rows are loaded at login and kept in the client cache. */
const BOOTSTRAP_TABS = [
  'Categories', 'Courses', 'Batches', 'FeePlans', 'ChargeItems', 'CustomFields',
  'Parents', 'Students', 'Enrollments', 'MessageTemplates', 'ExpenseCategories',
  'FeeDues', 'Payments', 'PaymentAllocations', 'Receipts', 'Holidays',
];

/** Default business settings; tenant presets may override, the owner edits them in the app. */
const DEFAULT_SETTINGS = {
  academy_name: 'My Academy',
  academy_phone: '',
  academy_address: '',
  academy_email: '',
  academy_tagline: '',
  contact_person: '',
  gstin: '',
  receipt_footer: '',
  // Synced from the tenant config by the app; used to brand receipts.
  logo_url: '',
  brand_primary: '#0B1F3A',
  brand_accent: '#C9A227',
  currency: 'INR',
  country_code: '91',
  timezone: 'Asia/Kolkata',
  fy_start_month: '4',
  due_day: '5',
  receipt_prefix: 'RCPT',
  session_hours: '12',
  rounding: 'nearest_rupee',
  sibling_discount_pct: '0',
  gateway_fee_as_expense: 'Y',
  gateway_fee_category: 'Gateway fees',
  opening_balances_date: '',
  logo_drive_id: '',
};

const STATUS = {
  student: ['Active', 'On hold', 'Dropped', 'Completed'],
  enrollment: ['Active', 'On hold', 'Dropped', 'Completed'],
  attendance: ['Present', 'Absent', 'Leave'],
  due: ['Pending', 'Partial', 'Paid', 'Waived'],
  dueKind: ['Recurring', 'OneTime'],
  payment: ['Recorded', 'Cancelled'],
  paymentMode: ['Gateway', 'Cash', 'UPI', 'Bank'],
  manualPaymentMode: ['Cash', 'UPI', 'Bank'],
  enquiry: ['New', 'Follow-up', 'Trial', 'Converted', 'Lost'],
  feePlanFrequency: ['Monthly', 'Quarterly', 'HalfYearly', 'Annual'],
};
