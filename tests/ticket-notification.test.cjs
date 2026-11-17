const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const access = require('../ticket-access');

// Exercise the real notification functions without a browser, account or database.
function frontend(user, search = '?department=Helpdesk', loaded = true) {
  const audio = [];
  class AudioFixture {
    constructor() { this.volume = 1; this.plays = []; audio.push(this); }
    play() { this.plays.push(this.volume); return Promise.resolve(); }
    pause() {}
  }
  const context = vm.createContext({
    window: { InternalTicketAccess: access, matchMedia: () => ({ matches: false }) },
    document: { querySelector: () => null },
    location: { search }, URLSearchParams, console, Audio: AudioFixture,
    user, loaded
  });
  const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  vm.runInContext(script.slice(0, script.indexOf('elements.detail?.addEventListener')), context);
  vm.runInContext('state.currentUser = user; state.currentUserLoaded = loaded;', context);
  return { context, audio, run: code => vm.runInContext(code, context) };
}

for (const [role, group] of [[12, 'IBLS'], [13, 'CRM']]) {
  test(`${group} remains silent on interaction, polling and direct notification attempts in every view`, async () => {
    for (const search of ['', '?department=Helpdesk', '?department=Pulscam', '?department=CC', '?status=Closed']) {
      const h = frontend({ userId: 42, user_type: role }, search);
      h.run('unlockNotificationAudio(); notifyForNewHelpdeskTickets([{ticketId: 1}], false, 1);');
      h.run('notifyForNewHelpdeskTickets([{ticketId: 1}, {ticketId: 2}], true, 2); playHelpdeskTicketNotification();');
      await Promise.resolve();
      assert.equal(h.audio.length, 0, `${group}: ${search || 'active'}`);
    }
  });
}

test('audio stays disabled until a valid account and role have been resolved', () => {
  for (const [user, loaded] of [
    [null, false], [{userId: 42, user_type: 8}, false],
    [{user_type: 8}, true], [{userId: 42}, true], [{userId: 42, user_type: ''}, true]
  ]) {
    const h = frontend(user, '?department=Helpdesk', loaded);
    h.run('unlockNotificationAudio(); playHelpdeskTicketNotification();');
    assert.equal(h.audio.length, 0);
  }
});

test('staff opening a department view stays silent; genuinely new tickets still alert once', () => {
  for (const role of [7, 8]) {
    for (const department of ['Helpdesk', 'Pulscam', 'CC']) {
      const h = frontend({userId: 42, user_type: role}, `?department=${department}`);
      h.run('notifyForNewHelpdeskTickets([{ticketId: 1}], true, 1);');
      assert.equal(h.audio.length, 0, 'First fetch establishes the baseline');
      h.run('notifyForNewHelpdeskTickets([{ticketId: 1}], true, 1);');
      assert.equal(h.audio.length, 0, 'Unchanged tickets do not alert');
      h.run('notifyForNewHelpdeskTickets([{ticketId: 1}, {ticketId: 2}, {ticketId: 3}], true, 3);');
      assert.deepEqual(h.audio[0].plays, [1]);
      h.run('notifyForNewHelpdeskTickets([{ticketId: 1}, {ticketId: 2}, {ticketId: 3}], true, 3);');
      assert.deepEqual(h.audio[0].plays, [1], 'Repeated poll does not repeat the sound');
    }
  }
});

test('staff audio unlocking is silent and Active/Completed views have no sound', async () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('unlockNotificationAudio();');
  await Promise.resolve();
  assert.deepEqual(h.audio[0].plays, [0]);
  assert.equal(h.run('state.notificationAudioUnlocked'), true);
  for (const search of ['', '?status=Closed']) {
    const quiet = frontend({userId: 42, user_type: 8}, search);
    quiet.run('unlockNotificationAudio(); notifyForNewHelpdeskTickets([{ticketId: 1}], false, 1);');
    quiet.run('notifyForNewHelpdeskTickets([{ticketId: 2}], true, 2); playHelpdeskTicketNotification();');
    assert.equal(quiet.audio.length, 0);
  }
});

test('existing tickets entering or returning to the filtered results never alert', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([{ticketId: 10}], false, 100);');
  // Tickets 80 and 100 existed elsewhere when the page opened. Moving/reopening them is silent.
  h.run('notifyForNewHelpdeskTickets([{ticketId: 10}, {ticketId: 80}, {ticketId: 100}], true, 100);');
  h.run('notifyForNewHelpdeskTickets([], true, 100);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 100}], true, 100);');
  assert.equal(h.audio.length, 0);
});

test('new tickets outside the current filters are consumed without alerting later', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([{ticketId: 10}], false, 100);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 10}], true, 101);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], true, 101);');
  assert.equal(h.audio.length, 0, 'A later move or filter match is not a creation');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}, {ticketId: 102}], true, 102);');
  assert.deepEqual(h.audio[0].plays, [1]);
});

test('manual refreshes and filter changes silently advance the creation baseline', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([{ticketId: 10}], false, 100);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], false, 101);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], true, 101);');
  assert.equal(h.audio.length, 0);
});

test('stale responses cannot lower the cursor and replay an old creation alert', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([], false, 100);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], true, 101);');
  h.run('notifyForNewHelpdeskTickets([], false, 100);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], true, 101);');
  assert.deepEqual(h.audio[0].plays, [1]);
});

test('missing or invalid server cursors never fall back to alerting on list changes', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([], false, 100);');
  for (const cursor of [undefined, null, '', 'invalid', -1, 101.5, Number.MAX_SAFE_INTEGER + 1]) {
    h.context.cursor = cursor;
    h.run('notifyForNewHelpdeskTickets([{ticketId: 101}], true, cursor);');
  }
  assert.equal(h.audio.length, 0);
  assert.equal(h.run('state.latestCreatedTicketId'), 100);
});

test('an empty system baseline still recognizes the first newly created ticket', () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run('notifyForNewHelpdeskTickets([], false, 0);');
  h.run('notifyForNewHelpdeskTickets([{ticketId: 1}], true, 1);');
  assert.deepEqual(h.audio[0].plays, [1]);
});

test('ticket loading uses the backend creation cursor rather than newly displayed IDs', async () => {
  const h = frontend({userId: 42, user_type: 8});
  h.run(`requestJson = async () => payload;
    renderStats = renderDepartmentOptions = renderAssignedToOptions = syncFilterControls = renderTickets = () => {};`);
  h.context.payload = {tickets: [{ticketId: 10}], latestCreatedTicketId: 100};
  await h.run('loadTickets()');
  h.context.payload = {tickets: [{ticketId: 100}], latestCreatedTicketId: 100};
  await h.run('loadTickets({notifyNewTickets: true})');
  assert.equal(h.audio.length, 0);
  h.context.payload = {tickets: [{ticketId: 101}], latestCreatedTicketId: 101};
  await h.run('loadTickets({notifyNewTickets: true})');
  assert.deepEqual(h.audio[0].plays, [1]);
});

test('backend creation cursor includes filtered, closed and deleted tickets and is staff-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'api_tickets.sql'), 'utf8');
  const match = sql.match(/(CASE WHEN \$ticket_manage_access = 1 THEN \([\s\S]*?\) END) AS latestCreatedTicketId/);
  assert.ok(match, 'API must supply the unfiltered creation cursor');
  const expression = match[1].replace('CC.dbo.tkt_InternalTickets', 'tickets');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE tickets (TicketID INT, Department TEXT, Status TEXT, IsDeleted INT);
      INSERT INTO tickets VALUES (10,'Helpdesk','Open',0), (90,'Software','Open',0),
      (95,'Pulscam','Closed',0), (100,'Helpdesk','Open',1);`);
    const query = db.prepare(`SELECT ${expression} AS cursor`);
    assert.equal(query.get({$ticket_manage_access: 1}).cursor, 100);
    assert.equal(query.get({$ticket_manage_access: 0}).cursor, null);
    assert.match(sql, /SET ticket_manage_access = CASE WHEN \$ticket_user_id IS NOT NULL AND \$ticket_user_type IS NOT NULL AND \$ticket_is_requester = 0/);
    db.exec('DELETE FROM tickets;');
    assert.equal(query.get({$ticket_manage_access: 1}).cursor, 0);
  } finally { db.close(); }
});
