/**
 * Lahoti Yarn – Google Sheet companion script
 *
 * 1. Adds a "🏠 Costing Dashboard" menu + a "Dashboard" tab with a button that
 *    opens the costing dashboard.
 * 2. Locks every price tab at 12:00 AM IST (only ADMIN_EMAILS can edit) and
 *    unlocks it automatically as soon as the admin confirms / keeps prices in
 *    the costing dashboard. Stays unlocked until the next 12:00 AM IST.
 *
 * Setup (once, as the sheet OWNER / admin):
 *   Extensions → Apps Script → paste this file → set DASHBOARD_URL and
 *   ADMIN_EMAILS below → Save → run `installTriggers` → allow permissions.
 *   File → Settings → Time zone must be "(GMT+05:30) India Standard Time".
 */

// Public URL of the deployed costing dashboard (Cloud Run / "Share app" URL).
const DASHBOARD_URL = 'https://YOUR-COSTING-APP-URL.run.app';
// People who may edit prices while the sheet is locked.
const ADMIN_EMAILS = ['admin@yourcompany.com'];

const STATUS_API_URL = DASHBOARD_URL.replace(/\/+$/, '') + '/api/daily-pricing';
const TIME_ZONE = 'Asia/Kolkata';
const CONTROL_TAB = 'Dashboard';
const LOCK_DESCRIPTION = 'DAILY_PRICE_LOCK';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏠 Costing Dashboard')
    .addItem('⬅ Back to Costing Dashboard', 'openCostingDashboard')
    .addSeparator()
    .addItem('Check lock status now', 'syncLockWithDashboard')
    .addItem('Admin: install auto-lock (run once)', 'installTriggers')
    .addToUi();
}

/** Assign this to a drawing/button: right-click → Assign script → openCostingDashboard */
function openCostingDashboard() {
  const url = JSON.stringify(DASHBOARD_URL);
  const html = HtmlService.createHtmlOutput(
    '<script>window.open(' + url + ', "_blank"); setTimeout(function(){ google.script.host.close(); }, 800);</script>' +
    '<p style="font-family:Arial">If the dashboard did not open, <a href=' + url + ' target="_blank">click here</a>.</p>'
  ).setWidth(320).setHeight(90);
  SpreadsheetApp.getUi().showModalDialog(html, 'Opening Costing Dashboard…');
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLockWithDashboard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLockWithDashboard').timeBased().everyMinutes(1).create();
  PropertiesService.getDocumentProperties().deleteAllProperties();
  syncLockWithDashboard();
}

/** Runs every minute. Cheap no-op while already unlocked for today. */
function syncLockWithDashboard() {
  const props = PropertiesService.getDocumentProperties();
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  if (props.getProperty('state') === 'unlocked:' + today) return;

  const status = fetchDashboardStatus_();
  if (status && status.isConfirmedForToday && status.lastConfirmedDate === today) {
    unlockSheets_(status, today);
  } else {
    lockSheets_(status);
  }
}

function fetchDashboardStatus_() {
  try {
    const res = UrlFetchApp.fetch(STATUS_API_URL, {
      muteHttpExceptions: true,
      headers: { Accept: 'application/json' },
    });
    if (res.getResponseCode() !== 200) return null;
    const json = JSON.parse(res.getContentText());
    return json && json.status ? json.status : null;
  } catch (e) {
    return null;
  }
}

function lockSheets_(status) {
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('state') !== 'locked') {
    const me = Session.getEffectiveUser().getEmail();
    const allowed = ADMIN_EMAILS.concat([me]).filter(String).map(function (e) { return e.toLowerCase(); });

    SpreadsheetApp.getActive().getSheets().forEach(function (sheet) {
      if (sheet.getName() === CONTROL_TAB) return;
      const protection = sheet.protect().setDescription(LOCK_DESCRIPTION);
      protection.addEditors(allowed);
      protection.removeEditors(protection.getEditors().filter(function (u) {
        return allowed.indexOf(u.getEmail().toLowerCase()) === -1;
      }));
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
    });
    props.setProperty('state', 'locked');
  }

  writeStatus_(
    '🔒 PRICES LOCKED',
    "Locked at 12:00 AM IST. Waiting for admin to confirm or keep today's prices in the Costing Dashboard.",
    status,
    '#fde2e2'
  );
}

function unlockSheets_(status, today) {
  SpreadsheetApp.getActive().getSheets().forEach(function (sheet) {
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
      if (p.getDescription() === LOCK_DESCRIPTION) p.remove();
    });
  });
  PropertiesService.getDocumentProperties().setProperty('state', 'unlocked:' + today);

  writeStatus_(
    '✅ PRICES ACTIVE',
    'Confirmed by ' + (status.lastConfirmedBy || 'Admin') + '. Available to everyone until 12:00 AM IST.',
    status,
    '#dcfce7'
  );
}

function writeStatus_(title, detail, status, color) {
  const ss = SpreadsheetApp.getActive();
  let tab = ss.getSheetByName(CONTROL_TAB);
  if (!tab) {
    tab = ss.insertSheet(CONTROL_TAB, 0);
    tab.setColumnWidth(1, 520);
  }

  tab.getRange('A1')
    .setFormula('=HYPERLINK("' + DASHBOARD_URL + '", "⬅  Back to Costing Dashboard")')
    .setFontSize(16).setFontWeight('bold').setFontColor('#ffffff').setBackground('#4f46e5')
    .setHorizontalAlignment('center');
  tab.setRowHeight(1, 44);

  tab.getRange('A3').setValue(title).setFontSize(18).setFontWeight('bold').setBackground(color);
  tab.getRange('A4').setValue(detail).setWrap(true).setBackground(color);
  tab.getRange('A5').setValue(
    'Last confirmed: ' + ((status && status.lastConfirmedDate) || '—') +
    '   |   Checked: ' + Utilities.formatDate(new Date(), TIME_ZONE, 'dd-MM-yyyy hh:mm a') + ' IST'
  ).setFontColor('#64748b');
}
