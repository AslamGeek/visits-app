/**
 * MedRep offline-first API.
 *
 * Deploy as a Google Apps Script Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The browser never receives Google credentials. This script is the only layer
 * that reads or writes the spreadsheet.
 */

var CONFIG = {
  SPREADSHEET_ID: '1Zg5Rxn6TNskev1EFwwrZI9gWP1mDyifBg6ACI_YTFxU',
  TIME_ZONE: 'Asia/Kolkata',
  MAX_REMEMBERED_OPERATIONS: 250
};

// Reuse the spreadsheet handle during one Apps Script invocation. Opening the
// same spreadsheet for every tab is one of the largest bootstrap delays.
var ACTIVE_SPREADSHEET_ = null;

var SHEET_HEADERS = {
  Doctors: [
    'ID', 'Name', 'Specialties', 'Hospital', 'Pharmacy', 'Area', 'Camp',
    'Potential', 'Stockist', 'Prescriber', 'OP Timing', 'Call Schedule',
    'Prescribing Products', 'Notes'
  ],
  Visits: [
    'Date', 'Day', 'Camp', 'Doctors (count)', 'Pharmacy (count)',
    'Doctors', 'Pharmacy'
  ],
  Settings: [
    'Areas', 'Specialties', 'Camps', 'Potentials', 'Stockist',
    'OP Timings', 'Call Schedule'
  ],
  Products: ['ProdID', 'Name', 'DosageForm']
};

var HEADER_ALIASES = {
  'ID': ['DocID'],
  'OP Timing': ['OPTimings', 'OP Timings'],
  'Call Schedule': ['CallSchedule'],
  'Prescribing Products': ['PrescribingProducts'],
  'Notes': ['Remarks']
};

function doGet(e) {
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    if (action === 'bootstrap') return json_(bootstrap_());
    return json_({
      success: true,
      service: 'MedRep API',
      spreadsheetId: CONFIG.SPREADSHEET_ID,
      message: 'API is ready.'
    });
  } catch (error) {
    return jsonError_(error);
  }
}

function doPost(e) {
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(request.action || '');
    var opId = cleanText_(request.opId, 120);
    var payload = request.payload || {};

    if (!opId) throw new Error('Operation ID is required.');
    if (wasProcessed_(opId)) return json_({ success: true, duplicate: true });

    var result;
    if (action === 'upsertDoctor') result = upsertDoctor_(payload);
    else if (action === 'saveVisit') result = saveVisit_(payload);
    else if (action === 'undoVisit') result = undoVisit_(payload.visit || payload);
    else throw new Error('Unsupported action: ' + action);

    rememberOperation_(opId);
    result.success = true;
    return json_(result);
  } catch (error) {
    return jsonError_(error);
  }
}

/**
 * Run once from the Apps Script editor before deploying.
 * It is intentionally non-destructive:
 * - reuses a completely blank Sheet1 as Doctors;
 * - creates only missing agreed tabs;
 * - never clears or replaces existing rows;
 * - accepts the legacy GAS header aliases.
 */
function setupSpreadsheet() {
  var ss = spreadsheet_();
  var doctors = ss.getSheetByName('Doctors');
  var defaultSheet = ss.getSheetByName('Sheet1');

  if (!doctors && defaultSheet && isBlankSheet_(defaultSheet)) {
    defaultSheet.setName('Doctors');
    doctors = defaultSheet;
  }

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    ensureSheet_(ss, name, SHEET_HEADERS[name]);
  });

  return 'MedRep spreadsheet is ready.';
}

function spreadsheet_() {
  if (!ACTIVE_SPREADSHEET_) {
    ACTIVE_SPREADSHEET_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return ACTIVE_SPREADSHEET_;
}

function sheet_(name) {
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing ' + name + ' sheet. Run setupSpreadsheet once.');
  return sheet;
}

function isBlankSheet_(sheet) {
  return sheet.getLastRow() <= 1 && sheet.getLastColumn() <= 1 && !sheet.getRange(1, 1).getValue();
}

function ensureSheet_(ss, name, expectedHeaders) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (isBlankSheet_(sheet)) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.getRange(1, 1, 1, expectedHeaders.length)
      .setFontWeight('bold')
      .setBackground('#e3f3eb')
      .setFontColor('#0d6045');
    sheet.setFrozenRows(1);
    return;
  }

  var headers = readHeaders_(sheet);
  expectedHeaders.forEach(function (header) {
    columnIndex_(headers, header);
  });
}

function readHeaders_(sheet) {
  var lastColumn = Math.max(1, sheet.getLastColumn());
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
}

function normalizedHeader_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function columnIndex_(headers, canonical) {
  var candidates = [canonical].concat(HEADER_ALIASES[canonical] || [])
    .map(normalizedHeader_);
  for (var i = 0; i < headers.length; i++) {
    if (candidates.indexOf(normalizedHeader_(headers[i])) !== -1) return i;
  }
  throw new Error('Missing column "' + canonical + '".');
}

function valueAt_(headers, row, canonical) {
  return row[columnIndex_(headers, canonical)];
}

function cleanText_(value, maxLength) {
  return String(value === null || value === undefined ? '' : value)
    .trim()
    .slice(0, maxLength || 500);
}

function cleanList_(value) {
  if (Array.isArray(value)) {
    return unique_(value.map(function (item) { return cleanText_(item, 150); }).filter(Boolean));
  }
  var text = cleanText_(value, 5000);
  if (!text) return [];
  if (text.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return cleanList_(parsed);
    } catch (ignored) {}
  }
  return unique_(text.split(/,|\n/).map(function (item) { return item.trim(); }).filter(Boolean));
}

function unique_(values) {
  var seen = {};
  return values.filter(function (value) {
    var key = String(value).trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function normalized_(value) {
  return cleanText_(value, 500).toLowerCase();
}

function normalizedPrescriber_(value) {
  var normalized = normalized_(value);
  return normalized === 'rx' || normalized === 'yes' ? 'Rx' : 'NRx';
}

function localDate_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function displayDateValue_(value) {
  if (value instanceof Date) return localDate_(value);
  return cleanText_(value, 20);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(error) {
  console.error(error && error.stack ? error.stack : error);
  return json_({
    success: false,
    message: error && error.message ? error.message : String(error || 'Unknown error')
  });
}

function getSettings_() {
  var sheet = sheet_('Settings');
  var headers = readHeaders_(sheet);
  var values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues()
    : [];

  function column(name) {
    var index = columnIndex_(headers, name);
    return unique_(values.map(function (row) { return cleanText_(row[index], 150); }).filter(Boolean));
  }

  return {
    areas: column('Areas'),
    specialties: column('Specialties'),
    camps: column('Camps'),
    potentials: column('Potentials'),
    stockists: column('Stockist'),
    opTimings: column('OP Timings'),
    callSchedules: column('Call Schedule')
  };
}

function getProducts_() {
  var sheet = sheet_('Products');
  var headers = readHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  return rows.map(function (row) {
    return {
      prodId: cleanText_(valueAt_(headers, row, 'ProdID'), 100),
      name: cleanText_(valueAt_(headers, row, 'Name'), 150),
      dosageForm: cleanText_(valueAt_(headers, row, 'DosageForm'), 100)
    };
  }).filter(function (product) { return product.prodId && product.name; });
}

function doctorFromRow_(headers, row) {
  var id = cleanText_(valueAt_(headers, row, 'ID'), 120);
  if (!id) return null;
  return {
    id: id,
    name: cleanText_(valueAt_(headers, row, 'Name'), 120),
    specialties: cleanList_(valueAt_(headers, row, 'Specialties')),
    hospital: cleanText_(valueAt_(headers, row, 'Hospital'), 150),
    pharmacy: cleanText_(valueAt_(headers, row, 'Pharmacy'), 150),
    area: cleanText_(valueAt_(headers, row, 'Area'), 120),
    camp: cleanText_(valueAt_(headers, row, 'Camp'), 120),
    potential: cleanText_(valueAt_(headers, row, 'Potential'), 100),
    stockist: cleanText_(valueAt_(headers, row, 'Stockist'), 120),
    prescriber: normalizedPrescriber_(valueAt_(headers, row, 'Prescriber')),
    opTiming: cleanText_(valueAt_(headers, row, 'OP Timing'), 120),
    callSchedule: cleanText_(valueAt_(headers, row, 'Call Schedule'), 120),
    prescribingProductIds: cleanList_(valueAt_(headers, row, 'Prescribing Products')),
    notes: cleanText_(valueAt_(headers, row, 'Notes'), 500),
    updatedAt: new Date().toISOString(),
    syncState: 'synced'
  };
}

function getDoctors_() {
  var sheet = sheet_('Doctors');
  var headers = readHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) { return doctorFromRow_(headers, row); })
    .filter(Boolean);
}

function validateChoice_(label, value, allowed, optional) {
  if (!value && optional) return '';
  var match = allowed.filter(function (item) { return normalized_(item) === normalized_(value); })[0];
  if (!match) throw new Error(label + ' must come from the spreadsheet master list.');
  return match;
}

function validateDoctor_(input) {
  var settings = getSettings_();
  var products = getProducts_();
  var productIds = products.map(function (product) { return product.prodId; });
  var prescriber = normalizedPrescriber_(input.prescriber);
  var specialties = cleanList_(input.specialties).map(function (value) {
    return validateChoice_('Specialty', value, settings.specialties, false);
  });

  var doctor = {
    id: cleanText_(input.id, 120),
    name: cleanText_(input.name, 120),
    specialties: specialties,
    hospital: cleanText_(input.hospital, 150),
    pharmacy: cleanText_(input.pharmacy, 150),
    area: validateChoice_('Area', cleanText_(input.area, 120), settings.areas, false),
    camp: validateChoice_('Camp', cleanText_(input.camp, 120), settings.camps, false),
    potential: validateChoice_('Potential', cleanText_(input.potential, 100), settings.potentials, true),
    stockist: validateChoice_('Stockist', cleanText_(input.stockist, 120), settings.stockists, true),
    prescriber: prescriber,
    opTiming: validateChoice_('OP timing', cleanText_(input.opTiming, 120), settings.opTimings, true),
    callSchedule: validateChoice_('Call schedule', cleanText_(input.callSchedule, 120), settings.callSchedules, true),
    prescribingProductIds: prescriber === 'Rx'
      ? cleanList_(input.prescribingProductIds).map(function (value) {
          return validateChoice_('Product', value, productIds, false);
        })
      : [],
    notes: cleanText_(input.notes, 500),
    updatedAt: new Date().toISOString(),
    syncState: 'synced'
  };

  if (!doctor.id || !doctor.name) throw new Error('Doctor ID and name are required.');
  return doctor;
}

function doctorCellValue_(doctor, canonical) {
  var map = {
    'ID': doctor.id,
    'Name': doctor.name,
    'Specialties': doctor.specialties.join(', '),
    'Hospital': doctor.hospital,
    'Pharmacy': doctor.pharmacy,
    'Area': doctor.area,
    'Camp': doctor.camp,
    'Potential': doctor.potential,
    'Stockist': doctor.stockist,
    'Prescriber': doctor.prescriber,
    'OP Timing': doctor.opTiming,
    'Call Schedule': doctor.callSchedule,
    'Prescribing Products': doctor.prescribingProductIds.join(', '),
    'Notes': doctor.notes
  };
  return map[canonical];
}

function upsertDoctor_(input) {
  var doctor = validateDoctor_(input);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_('Doctors');
    var headers = readHeaders_(sheet);
    var lastRow = sheet.getLastRow();
    var rows = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
      : [];
    var idIndex = columnIndex_(headers, 'ID');
    var nameIndex = columnIndex_(headers, 'Name');
    var hospitalIndex = columnIndex_(headers, 'Hospital');
    var rowNumber = -1;

    rows.forEach(function (row, index) {
      var existingId = cleanText_(row[idIndex], 120);
      if (existingId === doctor.id) rowNumber = index + 2;
      if (
        existingId !== doctor.id &&
        normalized_(row[nameIndex]) === normalized_(doctor.name) &&
        normalized_(row[hospitalIndex]) === normalized_(doctor.hospital)
      ) {
        throw new Error('A doctor with the same name and hospital already exists (' + existingId + ').');
      }
    });

    var existingRow = rowNumber > 0
      ? sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]
      : new Array(headers.length).fill('');

    SHEET_HEADERS.Doctors.forEach(function (canonical) {
      existingRow[columnIndex_(headers, canonical)] = doctorCellValue_(doctor, canonical);
    });

    if (rowNumber > 0) {
      sheet.getRange(rowNumber, 1, 1, headers.length).setValues([existingRow]);
    } else {
      sheet.appendRow(existingRow);
    }
    return { doctor: doctor };
  } finally {
    lock.releaseLock();
  }
}

function visitDay_(dateString) {
  var parts = dateString.split('-').map(Number);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(parts[0], parts[1] - 1, parts[2]).getDay()
  ];
}

function validateVisitDate_(value) {
  var date = cleanText_(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid visit date is required.');
  if (date < localDate_(new Date())) throw new Error('Past dates cannot be logged.');
  return date;
}

function saveVisit_(input) {
  var date = validateVisitDate_(input.date);
  var camp = cleanText_(input.camp, 120);
  var kind = cleanText_(input.kind, 20) || 'Visit';
  if (['Visit', 'Sunday', 'Holiday', 'Leave'].indexOf(kind) === -1) throw new Error('Invalid visit type.');
  if (!camp) throw new Error('Camp is required.');

  var doctorLines = [];
  var pharmacyLines = [];
  var doctorIds = [];

  if (kind === 'Visit') {
    var requestedIds = cleanList_(input.doctorIds);
    var doctorById = {};
    getDoctors_().forEach(function (doctor) { doctorById[doctor.id] = doctor; });
    var pharmacyMap = {};
    requestedIds.forEach(function (id) {
      var doctor = doctorById[id];
      if (!doctor || doctor.camp !== camp) return;
      doctorIds.push(doctor.id);
      doctorLines.push(
        doctor.id + ' — ' + doctor.name + ' (' + (doctor.specialties.join(', ') || 'General') + ')'
      );
      if (doctor.pharmacy && !pharmacyMap[normalized_(doctor.pharmacy)]) {
        pharmacyMap[normalized_(doctor.pharmacy)] = true;
        pharmacyLines.push(doctor.pharmacy);
      }
    });
    if (!doctorLines.length) throw new Error('Select at least one doctor from this camp.');
  } else {
    doctorLines = ['NO_VISIT:' + kind];
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_('Visits');
    var headers = readHeaders_(sheet);
    var row = new Array(headers.length).fill('');
    row[columnIndex_(headers, 'Date')] = date;
    row[columnIndex_(headers, 'Day')] = visitDay_(date);
    row[columnIndex_(headers, 'Camp')] = camp;
    row[columnIndex_(headers, 'Doctors (count)')] = kind === 'Visit' ? doctorLines.length : 0;
    row[columnIndex_(headers, 'Pharmacy (count)')] = kind === 'Visit' ? pharmacyLines.length : 0;
    row[columnIndex_(headers, 'Doctors')] = doctorLines.join('\n');
    row[columnIndex_(headers, 'Pharmacy')] = pharmacyLines.join('\n');
    sheet.insertRowBefore(2);
    sheet.getRange(2, 1, 1, headers.length).setValues([row]);
    sheet.getRange(2, columnIndex_(headers, 'Doctors') + 1).setWrap(true);
    sheet.getRange(2, columnIndex_(headers, 'Pharmacy') + 1).setWrap(true);
    return { visit: visitFromRow_(headers, row, 2), doctorIds: doctorIds };
  } finally {
    lock.releaseLock();
  }
}

function undoVisit_(input) {
  var targetDate = cleanText_(input.date, 20);
  var targetCamp = cleanText_(input.camp, 120);
  var targetDoctors = Array.isArray(input.doctorLines)
    ? input.doctorLines.map(function (line) { return cleanText_(line, 1000); }).filter(Boolean).join('\n')
    : cleanText_(input.doctorLines, 5000).replace(/\r\n/g, '\n');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = sheet_('Visits');
    var headers = readHeaders_(sheet);
    if (sheet.getLastRow() <= 1) return { removed: false };
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    var dateIndex = columnIndex_(headers, 'Date');
    var campIndex = columnIndex_(headers, 'Camp');
    var doctorsIndex = columnIndex_(headers, 'Doctors');
    for (var index = 0; index < rows.length; index++) {
      var rowDoctors = cleanText_(rows[index][doctorsIndex], 5000).replace(/\r\n/g, '\n');
      if (
        displayDateValue_(rows[index][dateIndex]) === targetDate &&
        cleanText_(rows[index][campIndex], 120) === targetCamp &&
        rowDoctors === targetDoctors
      ) {
        sheet.deleteRow(index + 2);
        return { removed: true };
      }
    }
    return { removed: false };
  } finally {
    lock.releaseLock();
  }
}

function visitFromRow_(headers, row, sheetRow) {
  var date = displayDateValue_(valueAt_(headers, row, 'Date'));
  var doctorsText = cleanText_(valueAt_(headers, row, 'Doctors'), 5000).replace(/\r\n/g, '\n');
  var doctorLines = doctorsText ? doctorsText.split('\n').filter(Boolean) : [];
  var pharmacyText = cleanText_(valueAt_(headers, row, 'Pharmacy'), 5000).replace(/\r\n/g, '\n');
  var pharmacyLines = pharmacyText ? pharmacyText.split('\n').filter(Boolean) : [];
  var noVisit = doctorsText.indexOf('NO_VISIT:') === 0 ? doctorsText.slice(9) : '';
  var kind = ['Sunday', 'Holiday', 'Leave'].indexOf(noVisit) !== -1 ? noVisit : 'Visit';
  var doctorIds = doctorLines.map(function (line) {
    var separator = line.indexOf(' — ');
    return separator > 0 ? line.slice(0, separator).trim() : '';
  }).filter(Boolean);

  var fingerprint = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      [date, valueAt_(headers, row, 'Camp'), doctorsText, pharmacyText, sheetRow].join('|')
    )
  ).slice(0, 18);

  return {
    localId: 'server-' + fingerprint,
    date: date,
    day: cleanText_(valueAt_(headers, row, 'Day'), 20) || visitDay_(date),
    camp: cleanText_(valueAt_(headers, row, 'Camp'), 120),
    kind: kind,
    doctorIds: doctorIds,
    doctorCount: Number(valueAt_(headers, row, 'Doctors (count)')) || 0,
    pharmacyCount: Number(valueAt_(headers, row, 'Pharmacy (count)')) || 0,
    doctorLines: doctorLines,
    pharmacyLines: pharmacyLines,
    createdAt: date ? date + 'T00:00:00.000Z' : new Date().toISOString(),
    syncState: 'synced'
  };
}

function getVisits_() {
  var sheet = sheet_('Visits');
  var headers = readHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.map(function (row, index) { return visitFromRow_(headers, row, index + 2); })
    .filter(function (visit) { return visit.date; })
    .sort(function (a, b) {
      if (a.date === b.date) return b.localId.localeCompare(a.localId);
      return b.date.localeCompare(a.date);
    });
}

function bootstrap_() {
  return {
    success: true,
    doctors: getDoctors_(),
    visits: getVisits_(),
    settings: getSettings_(),
    products: getProducts_(),
    serverTime: new Date().toISOString()
  };
}

function processedOperations_() {
  var raw = PropertiesService.getScriptProperties().getProperty('MEDREP_PROCESSED_OPS');
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignored) {
    return [];
  }
}

function wasProcessed_(opId) {
  return processedOperations_().indexOf(opId) !== -1;
}

function rememberOperation_(opId) {
  var operations = processedOperations_();
  operations.push(opId);
  if (operations.length > CONFIG.MAX_REMEMBERED_OPERATIONS) {
    operations = operations.slice(operations.length - CONFIG.MAX_REMEMBERED_OPERATIONS);
  }
  PropertiesService.getScriptProperties().setProperty(
    'MEDREP_PROCESSED_OPS',
    JSON.stringify(operations)
  );
}
