const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const access = require('../ticket-access');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function view(userType = 8) {
  const context = vm.createContext({ window: { InternalTicketAccess: access, matchMedia: () => ({ matches: false }) },
    document: { querySelector: () => null }, location: { search: '?department=CC' }, URLSearchParams, console, userType });
  const script = source('script.js');
  vm.runInContext(script.slice(0, script.indexOf('elements.detail?.addEventListener')), context);
  vm.runInContext('state.currentUser = {userId:42, user_type:userType}; state.currentUserLoaded = true;', context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('Call Centre stays pinned when clearing or changing table filters and refreshes automatically', () => {
  const h = view();
  assert.equal(h.run('currentTicketViewKey()'), 'callcentre');
  assert.equal(h.run('queryFromFilters().get("department")'), 'CC');
  h.run('state.filters = {department:"Helpdesk", category:"Event follow up"};');
  assert.equal(h.run('queryFromFilters().get("department")'), 'CC');
  h.run('state.filters = {};');
  assert.equal(h.run('queryFromFilters().get("department")'), 'CC');
  assert.equal(h.run('shouldAutoRefreshTickets()'), true);
});

test('Call Centre label, count and selected routing option are shown to staff', () => {
  const h = view();
  const count = {};
  h.context.count = count;
  h.run('document.querySelector = selector => selector === \'[data-nav-count="callcentre"]\' ? count : null; document.querySelectorAll = () => [];');
  h.run('renderStats({callCentreCount:4});');
  assert.equal(count.textContent, 4);
  const html = h.run('ticketDetailHtml({ticketId:10,department:"CC",requesterGroup:"Infinity",status:"Open",canManage:true}, [], [])');
  assert.match(html, /<option value="CC" selected>Call Centre<\/option>/);
  assert.equal(h.run('departmentLabel("CC")'), 'Call Centre');
});

test('Call Centre queue count excludes completed/deleted/other department rows', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE visible_tickets (IsDeleted INT, Department TEXT, Status TEXT);
      INSERT INTO visible_tickets VALUES (0,'CC','Open'),(0,'CC','In Progress'),(0,'CC','Waiting on User'),
      (0,'CC','Closed'),(0,'CC','Cancelled'),(1,'CC','Open'),(0,'Helpdesk','Open');`);
    const expression = source('api_tickets.sql').match(/(\(SELECT COUNT\(\*\) FROM visible_tickets[^\n]+) AS callCentreCount/)[1];
    assert.equal(db.prepare(`SELECT ${expression} AS count`).get().count, 3);
  } finally { db.close(); }
});

test('requester profiles cannot gain Call Centre routing or notification permission', () => {
  for (const userType of [12, 13]) {
    const h = view(userType);
    assert.equal(h.run('canPlayTicketNotification()'), false);
    const select = { value: '' };
    h.context.select = select;
    h.run('elements.filters = {elements:{department:select}}; renderDepartmentOptions();');
    assert.doesNotMatch(select.innerHTML, /value="CC"/);
  }
});
