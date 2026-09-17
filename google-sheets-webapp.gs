/**
 * Phoenix Club — Registration → Google Sheets bridge
 * Deploy this as a Web App bound to the "registraions-details" spreadsheet.
 *
 * Setup (once, ~2 minutes):
 *   1. Open the spreadsheet → Extensions → Apps Script
 *   2. Delete the placeholder code, paste this file, Save
 *   3. Edit SHARED_SECRET below to any random string you choose
 *   4. Deploy → New deployment → type "Web app"
 *        Execute as:        Me
 *        Who has access:    Anyone
 *   5. Copy the /exec URL it gives you
 *   6. Put both values in the Phoenix Club server environment:
 *        SHEETS_WEBHOOK_URL=<the /exec URL>
 *        SHEETS_WEBHOOK_SECRET=<the same SHARED_SECRET>
 *
 * The site posts one registration per request. Rows are keyed by Registration
 * Code, so a replayed or retried request updates the existing row instead of
 * creating a duplicate.
 */

const SHARED_SECRET = 'CHANGE_ME_TO_A_RANDOM_STRING';
const SHEET_NAME = 'Sheet1';
const TIMEZONE = 'Asia/Kolkata';

const COLUMNS = [
  'Timestamp',
  'Registration Code',
  'Full Name',
  'Enrollment / Roll No.',
  'Email',
  'Phone',
  'School / Department',
  'Academic Year',
  'Event Name',
  'Event Date',
  'Event Time',
  'Venue',
  'Event Type',
  'Registration Status',
  'Attendance Status',
  'Payment Status',
  'Motivation / Notes',
  'Source',
  'DB Record ID'
];

/** Returns the target sheet, creating it and its formatted header row if needed. */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const firstCell = sheet.getRange(1, 1).getValue();
  if (!firstCell) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    const header = sheet.getRange(1, 1, 1, COLUMNS.length);
    header
      .setFontWeight('bold')
      .setFontColor('#ffffff')
      .setBackground('#ea580c')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setRowHeight(1, 42);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, COLUMNS.length, 150);
    sheet.setColumnWidth(1, 180);  // Timestamp
    sheet.setColumnWidth(17, 320); // Motivation / Notes
  }

  // Force these columns to plain text on every call (cheap, idempotent), not just
  // at creation. Sheets auto-parses cell values the same way whether they arrive
  // from the UI or from setValues(): a phone number like "+91 98765 43210" is
  // read as the start of a formula and becomes #ERROR!, and a roll number can
  // lose a leading zero or flip to scientific notation if read as a number.
  sheet.getRange('D2:D').setNumberFormat('@'); // Enrollment / Roll No.
  sheet.getRange('F2:F').setNumberFormat('@'); // Phone

  return sheet;
}

/** Maps an incoming payload onto the COLUMNS order. */
function buildRow_(p) {
  const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  return [
    stamp,
    p.reg_code || '',
    p.full_name || '',
    p.enrollment_id || '',
    p.email || '',
    p.phone || '',
    p.department || '',
    p.academic_year || '',
    p.event_name || '',
    p.event_date || '',
    p.event_time || '',
    p.venue || '',
    p.event_type || '',
    p.status || 'confirmed',
    p.attendance_status || 'pending',
    p.payment_status || 'free',
    p.additional_info || '',
    p.source || 'Website Form',
    p.db_id || ''
  ];
}

/**
 * Writes one row at `targetRow`, forcing the text-critical cells to plain text
 * FIRST. Sheets parses values written by the API exactly like typed input, so
 * "+91 98765 43210" becomes #ERROR! (read as a formula) and a roll number like
 * "0024010" loses its leading zeros unless the destination cell is already
 * formatted as text. Setting the format on the specific target cells is more
 * reliable than a column-wide format, which a newly created row may not inherit.
 */
function writeRow_(sheet, row, targetRow) {
  sheet.getRange(targetRow, 4).setNumberFormat('@'); // Enrollment / Roll No.
  sheet.getRange(targetRow, 6).setNumberFormat('@'); // Phone
  sheet.getRange(targetRow, 1, 1, COLUMNS.length).setValues([row]);
}

/** Finds the 1-based row for an existing Registration Code, or -1. */
function findRowByRegCode_(sheet, regCode) {
  if (!regCode) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const codes = sheet.getRange(2, 2, last - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).trim() === String(regCode).trim()) return i + 2;
  }
  return -1;
}

function json_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty body' });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_({ ok: false, error: 'invalid json' });
    }

    if (SHARED_SECRET && payload.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    const sheet = getSheet_();
    const row = buildRow_(payload);
    const existing = findRowByRegCode_(sheet, payload.reg_code);

    if (existing > 0) {
      writeRow_(sheet, row, existing);
      return json_({ ok: true, action: 'updated', row: existing });
    }

    const targetRow = Math.max(sheet.getLastRow() + 1, 2);
    writeRow_(sheet, row, targetRow);
    return json_({ ok: true, action: 'appended', row: targetRow });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Reads every data row into an array of {ColumnName: value} objects. */
function readAllRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  return values.map(function (row) {
    const obj = {};
    COLUMNS.forEach(function (col, i) { obj[col] = row[i]; });
    return obj;
  });
}

/**
 * doGet supports two shapes:
 *   (no params)        health check — safe to leave unauthenticated, no PII
 *   ?action=rows&secret=... returns every row as JSON — gated by the secret
 *     because rows include student email/phone. This is how the Vercel
 *     deployment reads the sheet as its live database (duplicate checks,
 *     per-event capacity counts) since it has no SQL database of its own.
 */
function doGet(e) {
  const sheet = getSheet_();
  const params = (e && e.parameter) || {};

  if (params.action === 'rows') {
    if (SHARED_SECRET && params.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    return json_({ ok: true, rows: readAllRows_(sheet) });
  }

  return json_({
    ok: true,
    service: 'Phoenix Club registration sink',
    sheet: sheet.getName(),
    columns: COLUMNS.length,
    rows: Math.max(0, sheet.getLastRow() - 1)
  });
}
