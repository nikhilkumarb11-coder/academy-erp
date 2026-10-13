/**
 * JSON API entry point. Clients POST with Content-Type: text/plain (avoids CORS preflight,
 * which Apps Script cannot answer) and a body of { action, token, payload, device }.
 * Responses are { ok: true, data } or { ok: false, error: { code, message, details } }.
 */

function doGet() {
  return jsonResponse({ ok: true, data: { service: 'academy-erp', apiVersion: API_VERSION } });
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'Body must be JSON' } });
  }

  try {
    const route = routes()[request.action];
    if (!route) throw new AppError('UNKNOWN_ACTION', `Unknown action: ${request.action}`);
    const ctx = { device: String(request.device || '').slice(0, 60) };
    if (!route.public) Object.assign(ctx, Auth.verify(request.token));
    const data = route.handler(request.payload || {}, ctx);
    return jsonResponse({ ok: true, data });
  } catch (err) {
    const known = err instanceof AppError;
    if (!known) console.error(request.action, err && err.stack);
    return jsonResponse({
      ok: false,
      error: {
        code: known ? err.code : 'SERVER',
        message: known ? err.message : 'Something went wrong. Please retry.',
        details: known ? err.details : undefined,
      },
    });
  }
}

/** Action registry. Built lazily so file load order never matters. */
function routes() {
  return {
    'system.ping': { public: true, handler: SystemApi.ping },
    'auth.login': { public: true, handler: AuthApi.login },
    'auth.changePassword': { handler: AuthApi.changePassword },
    'system.bootstrap': { handler: SystemApi.bootstrap },
    'system.sync': { handler: SystemApi.sync },
    'system.migrate': { handler: SystemApi.migrate },
    'system.seed': { handler: SystemApi.seed },
    'settings.update': { handler: SystemApi.updateSettings },
    'system.backup': { handler: SystemApi.backup },
    'system.backupStatus': { handler: SystemApi.backupStatus },
    'import.students': { handler: ImportApi.run },

    'catalog.save': { handler: CatalogApi.save },
    'catalog.delete': { handler: CatalogApi.remove },

    'admissions.create': { handler: PeopleApi.createAdmission },
    'parents.save': { handler: PeopleApi.saveParent },
    'students.save': { handler: PeopleApi.saveStudent },
    'students.setStatus': { handler: PeopleApi.setStudentStatus },
    'enrollments.save': { handler: PeopleApi.saveEnrollment },
    'enrollments.setStatus': { handler: PeopleApi.setEnrollmentStatus },

    'dues.generate': { handler: FeesApi.generate },
    'dues.addCharge': { handler: FeesApi.addCharge },
    'dues.adjust': { handler: FeesApi.adjust },
    'dues.remove': { handler: FeesApi.remove },
    'payments.record': { handler: FeesApi.record },
    'payments.cancel': { handler: FeesApi.cancel },
    'receipts.get': { handler: FeesApi.getReceipt },

    'attendance.day': { handler: AttendanceApi.day },
    'attendance.save': { handler: AttendanceApi.save },
    'attendance.report': { handler: AttendanceApi.report },
    'holidays.save': { handler: AttendanceApi.saveHoliday },
    'holidays.delete': { handler: AttendanceApi.deleteHoliday },

    'messages.log': { handler: MessagesApi.log },
    'messages.recent': { handler: MessagesApi.recent },

    'enquiries.save': { handler: EnquiriesApi.save },
    'enquiries.delete': { handler: EnquiriesApi.remove },
    'expenses.save': { handler: ExpensesApi.save },
    'expenses.delete': { handler: ExpensesApi.remove },
  };
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
