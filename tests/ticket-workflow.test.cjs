const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Execute real handler statements in disposable fixtures. Only SQL dialect syntax
// is adapted; authorization and workflow predicates remain intact.
function sqlite(sql) {
  return sql.replace(/CC\.dbo\./g, '')
    .replace(/TRY_CONVERT\(INT,\s*([:$][\w]+)\)/gi, 'CAST($1 AS INTEGER)')
    .replace(/NVARCHAR\((?:MAX|\d+)\)/gi, 'TEXT')
    .replace(/SYSDATETIME\(\)/g, "'2026-10-13 12:00:00'")
    .replace(/UPDATE ticket SET/g, 'UPDATE tkt_InternalTickets AS ticket SET')
    .replace(/\nFROM tkt_InternalTickets ticket\nWHERE/g, '\nWHERE')
    .replace(/SELECT TOP \(1\) /g, 'SELECT ');
}
function run(file, role, ticketId = 2, overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.function('LEFT', (value, length) => value == null ? null : String(value).slice(0, length));
  db.exec(`CREATE TABLE tkt_InternalTickets (TicketID INTEGER PRIMARY KEY, RequesterGroup TEXT, Department TEXT,
    IsDeleted INT, Status TEXT, Priority TEXT, AssignedToUserID INT, c_name TEXT, c_contact TEXT,
    c_contacted INT, zoho_ticketnum TEXT, UpdatedAt TEXT, ClosedAt TEXT);
    CREATE TABLE tkt_Comments (CommentID INTEGER PRIMARY KEY, TicketID INT, Comment TEXT, CommentedByUserID INT, status TEXT);
    INSERT INTO tkt_InternalTickets VALUES
      (1,'Internal','Helpdesk',0,'Open','Low',NULL,NULL,NULL,0,NULL,NULL,NULL),
      (2,'IBLS','Helpdesk',0,'Open','Low',NULL,NULL,NULL,0,NULL,NULL,NULL),
      (3,'CRM','Pulscam',0,'Open','Low',NULL,NULL,NULL,0,NULL,NULL,NULL),
      (4,'IBLS','Helpdesk',0,'Closed','Low',NULL,NULL,NULL,0,NULL,NULL,'2026-10-12'),
      (5,'IBLS','Helpdesk',1,'Open','Low',NULL,NULL,NULL,0,NULL,NULL,NULL),
      (6,'Internal','Software',0,'Open','Low',NULL,NULL,NULL,0,NULL,NULL,NULL),
      (7,'IBLS','Helpdesk',0,'Open','Low',NULL,'Callback','123',0,NULL,NULL,NULL),
      (8,'Infinity','Helpdesk',0,'Open','Low',NULL,'Callback','123',0,NULL,NULL,NULL);`);
  const vars = {
    $ticket_user_id: role == null ? null : 99, $ticket_user_type: role,
    $ticket_is_requester: [12, 13].includes(role) ? 1 : 0,
    $ticket_requester_group: role === 12 ? 'IBLS' : role === 13 ? 'CRM' : 'Internal',
    $ticket_staff_access: [0, 7, 8].includes(role) ? 1 : 0,
    $software_access_allowed: role === 7 ? 1 : 0,
    $ticket_manage_access: role != null && ![12, 13].includes(role) ? 1 : 0,
    ':ticket_id': ticketId, ':comment': 'Fixture update', ':priority': 'High', ':status': 'In Progress',
    ':contacted': 1, ':department': 'TAD', ':zoho_ticketnum': 'Fixture', ...overrides
  };
  const before = db.prepare('SELECT * FROM tkt_InternalTickets ORDER BY TicketID').all();
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/\r\n/g, '\n').replace(/^--.*$/gm, '');
  const body = source.slice(source.indexOf('SET ticket_manage_access'));
  try {
    for (const statement of body.split(';').map(s => s.trim()).filter(Boolean)) {
      if (statement.startsWith("SELECT 'json'")) break;
      const set = /^SET (\w+) = ([\s\S]*)$/.exec(statement);
      const sql = sqlite(set ? 'SELECT ' + set[2] + ' AS value' : statement);
      const prepared = db.prepare(sql);
      prepared.setAllowUnknownNamedParameters(true);
      if (set) vars['$' + set[1]] = prepared.get(vars)?.value ?? null;
      else prepared.run(vars);
    }
    return { before, after: db.prepare('SELECT * FROM tkt_InternalTickets ORDER BY TicketID').all(),
      comments: db.prepare('SELECT * FROM tkt_Comments').all(), updated: vars.$ticket_updated,
      commentAdded: vars.$comment_added };
  } finally { db.close(); }
}
const handlers = ['acknowledge_ticket.sql', 'update_department.sql', 'update_zoho_ticket.sql',
  'update_client_contacted.sql', 'add_comment.sql'];
for (const file of handlers) {
  test(file + ': requester and missing-session attempts cannot change tickets or add comments', () => {
    for (const role of [12, 13, null]) for (const id of [1, 2, 3, 8]) {
      const result = run(file, role, id);
      assert.deepEqual(result.after, result.before);
      assert.equal(result.comments.length, 0);
      assert.equal(result.updated, 0);
      if (file === 'add_comment.sql') assert.equal(result.commentAdded, 0);
    }
  });
  test(file + ': completed, deleted, and inaccessible tickets fail without side effects', () => {
    for (const id of [4, 5, 999, 6]) {
      const result = run(file, 8, id);
      assert.deepEqual(result.after, result.before);
      assert.equal(result.comments.length, 0);
      assert.equal(result.updated, 0);
    }
  });
}

test('normal staff can manage Infinity through every ticket workflow', () => {
  for (const file of handlers) {
    const result = run(file, 1, 8);
    assert.equal(result.updated, 1, file);
    assert.equal(result.after.find(ticket => ticket.TicketID === 8).RequesterGroup, 'Infinity');
    if (file === 'add_comment.sql') assert.equal(result.commentAdded, 1);
  }
});

test('staff can route Infinity into Call Centre while requester-group tickets cannot be moved there', () => {
  const result = run('update_department.sql', 8, 8, { ':department': 'CC' });
  assert.equal(result.updated, 1);
  assert.equal(result.after.find(ticket => ticket.TicketID === 8).Department, 'CC');
  for (const ticketId of [2, 3]) {
    const rejected = run('update_department.sql', 7, ticketId, { ':department': 'CC' });
    assert.equal(rejected.updated, 0);
    assert.deepEqual(rejected.after, rejected.before);
  }
});
test('staff updates verify stored state and append a comment only after an eligible update', () => {
  for (const file of handlers) {
    const result = run(file, 8, file === 'update_client_contacted.sql' ? 7 : 2);
    assert.equal(result.updated, 1, file);
    assert.notDeepEqual(result.after, result.before, file);
    assert.equal(result.comments.length, file === 'add_comment.sql' ? 1 : 0, file);
    if (file === 'add_comment.sql') assert.equal(result.commentAdded, 1);
  }
});
test('callback closure and requester Software routing fail before changing records', () => {
  for (const [file, id, values] of [['add_comment.sql', 7, { ':status': 'Closed' }],
    ['update_department.sql', 2, { ':department': 'Software' }]]) {
    const result = run(file, 7, id, values);
    assert.deepEqual(result.after, result.before);
    assert.equal(result.updated, 0);
    assert.equal(result.comments.length, 0);
  }
});
test('invalid comment forms cannot update priority/status or create comments', () => {
  for (const values of [{ ':comment': '' }, { ':priority': 'Invalid' }, { ':status': null }]) {
    const result = run('add_comment.sql', 8, 2, values);
    assert.deepEqual(result.after, result.before);
    assert.equal(result.updated, 0);
    assert.equal(result.comments.length, 0);
  }
});
