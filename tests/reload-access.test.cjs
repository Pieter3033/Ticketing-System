const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function menuElements(html) {
  return Array.from(html.matchAll(/<(?:section|a)\b[^>]*data-(?:hide|show)-for-user-type="[^"]+"[^>]*>/g), match => {
    const attrs = Object.fromEntries(Array.from(match[0].matchAll(/([\w-]+)="([^"]*)"/g), attr => [attr[1], attr[2]]));
    return { hidden: true, attrs, dataset: { hideForUserType: attrs['data-hide-for-user-type'], showForUserType: attrs['data-show-for-user-type'] } };
  });
}
function frontend(role, html = read('internaltickets/index.html')) {
  const menus = menuElements(html);
  const dispatch = { hidden: true };
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }) },
    document: {
      querySelector: selector => selector === '[data-show-for-dispatch-access]' ? dispatch : null,
      querySelectorAll: selector => selector === '[data-hide-for-user-type], [data-show-for-user-type]' ? menus : []
    },
    location: { search: '' }, URLSearchParams, console
  });
  const source = read('internaltickets/script.js');
  vm.runInContext(source.slice(0, source.indexOf('elements.detail?.addEventListener')), context);
  vm.runInContext(`state.currentUser={userId:42,user_type:${JSON.stringify(role)},helpdesk:false};
    syncTicketDepartmentOptions=()=>{};syncRegistrationLookupAccess=()=>{};syncRequesterAccess=()=>{};`, context);
  return { menus, dispatch, run: code => vm.runInContext(code, context) };
}

test('Reload combines standard CC tools with jobcards without administrative rights', () => {
  const reload = frontend(14);
  assert.equal(reload.run('canViewDispatchLink()'), true);
  assert.equal(reload.run('canViewQuickLogs()'), true);
  assert.equal(reload.run('canViewJobcards()'), true);
  assert.equal(reload.run('canViewDashboard()'), false);
  const cc = frontend(8);
  assert.equal(cc.run('canViewDispatchLink()'), true);
  assert.equal(cc.run('canViewQuickLogs()'), true);
  assert.equal(cc.run('canViewJobcards()'), false);
  assert.equal(cc.run('canViewDashboard()'), false);
  for (const role of [12, 13, null]) {
    const requester = frontend(role);
    assert.equal(requester.run('canViewDispatchLink()'), false);
    assert.equal(requester.run('canViewQuickLogs()'), false);
    assert.equal(requester.run('canViewJobcards()'), false);
  }
});

for (const file of ['index.html', 'quick_logs.html', 'completed_quick_logs.html', 'escalations.html']) {
  test(`${file}: Reload can navigate jobcards, quick logs and dispatch while admin tools stay hidden`, () => {
    const app = frontend(14, read('internaltickets/' + file));
    app.run('syncSidebarAccess()');
    assert.equal(app.menus.find(menu => menu.attrs['data-sidebar-group'] === 'jobcards').hidden, false);
    assert.equal(app.menus.find(menu => menu.attrs['data-sidebar-group'] === 'escalations').hidden, false);
    assert.equal(app.menus.find(menu => /(?:^|\/)quick_logs\.html$/.test(menu.attrs.href || '')).hidden, false);
    assert.equal(app.dispatch.hidden, false);
    for (const menu of app.menus.filter(menu => menu.attrs['data-show-for-user-type'] === '7')) assert.equal(menu.hidden, true);
    assert.equal(app.menus.find(menu => /pause%20events/.test(menu.attrs.href || '')).hidden, true);
  });
}

test('new account creation and deletion retain CC operator records for Reload profiles', () => {
  assert.match(read('Admin/admin.sql'), /\{"label":"Reload","value":14\}/);
  assert.match(read('Admin/add_user_func.sql'), /HAVING TRY_CONVERT\(int, :user_type\) IN \(8, 14\)/);
  assert.match(read('Admin/delete_user_func.sql'), /remaining_user\.Usertype\) IN \(8, 14\)/);
  for (const file of ['admin.sql', 'reset_password.sql', 'delete_user.sql']) {
    assert.match(read('Admin/' + file), /WHEN Usertype = 14 THEN 'Reload'/);
    assert.match(read('Admin/' + file), /WHEN Usertype = 4 THEN 'Impala Locks'/);
  }
});

test('sign-in and return paths recognise Reload without altering existing Reload Checklist roles', () => {
  const sql = read('login.sql');
  assert.match(sql, /= 14 THEN 'internaltickets\/index\.html'/);
  assert.match(sql, /= 4 THEN 'Reload\/Main Menu\.sql'/);
  assert.match(sql, /= 6 THEN 'Reload Checklists\/Main Menu\.sql'/);
});
