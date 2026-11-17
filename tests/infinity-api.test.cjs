const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '..', 'api_infinity_tickets.sql'), 'utf8').replace(/\r\n/g, '\n');
const key = 'isolated-fixture-key-0123456789abcdef';
const hash = createHash('sha256').update(key, 'ascii').digest('hex');
const requiredFields = {
  created_by: 'Infinity fixture submitter', description: 'Fixture description',
  registration: 'API-TEST', client_name: 'Fixture client', client_contact: '0000000000'
};

// Run the endpoint's actual SET expressions and guarded INSERT against isolated fixtures.
// Adapt only SQLPage request inputs and SQL Server functions; no live connection is used.
function sqlite(sql) {
  return sql.replace(/sqlpage\.request_method\(\)/g, '$fixture_method')
    .replace(/sqlpage\.read_file_as_text\('sqlpage\/infinity_ticket_config.json'\)/g, '$fixture_settings')
    .replace(/sqlpage\.header\('x-api-key'\)/g, '$fixture_key')
    .replace(/sqlpage\.header\('content-type'\)/g, '$fixture_type')
    .replace(/TRY_CONVERT\(VARBINARY\(32\), ([^,]+), 2\)/g, 'try_hex($1)')
    .replace(/TRY_CONVERT\(INT, (JSON_VALUE\([^)]+\))\)/g, 'CAST($1 AS INTEGER)')
    .replace(/DATALENGTH\(CAST\(([^()]+) AS NVARCHAR\(MAX\)\)\)/g, 'utf16_bytes($1)')
    .replace(/CC\.dbo\./g, '')
    .replace(/N?VARCHAR\(MAX\)/g, 'TEXT')
    .replace(/\bLEFT\(/g, 'left_text(');
}

function submit(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.function('try_hex', value => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null);
  db.function('DATALENGTH', value => value == null ? null : Buffer.byteLength(String(value), 'utf8'));
  db.function('utf16_bytes', value => value == null ? null : String(value).length * 2);
  db.function('LEN', value => value == null ? null : String(value).replace(/ +$/, '').length);
  db.function('left_text', (value, length) => value == null ? null : String(value).slice(0, length));
  db.function('HASHBYTES', (_algorithm, value) => value == null ? null : createHash('sha256').update(value, 'ascii').digest());
  db.function('JSON_VALUE', (body, field) => {
    const value = JSON.parse(body)[field.slice(2)];
    return value == null || typeof value === 'object' ? null : String(value);
  });
  db.exec(`CREATE TABLE tkt_InternalTickets (
    TicketID INTEGER PRIMARY KEY, Title TEXT, Department TEXT, Priority TEXT, Category TEXT,
    reg_no TEXT, c_name TEXT, c_contact TEXT, c_contacted INT, Description TEXT,
    RequestedByUserID INT, RequesterGroup TEXT, ExternalCreatedBy TEXT,
    Status TEXT DEFAULT 'Open');`);
  const fields = {...requiredFields, ...options.fields};
  for (const field of options.omit ?? []) delete fields[field];
  const vars = {
    $fixture_method: options.method ?? 'POST',
    $fixture_key: Object.hasOwn(options, 'key') ? options.key : key,
    $fixture_type: options.contentType ?? 'application/x-www-form-urlencoded',
    $fixture_settings: JSON.stringify({enabled: options.enabled ?? 1,
      apiKeySha256: Object.hasOwn(options, 'hash') ? options.hash : hash,
      department: options.department ?? null}),
    ':category': fields.category ?? null, ':description': fields.description ?? null,
    ':registration': fields.registration ?? null, ':priority': fields.priority ?? null,
    ':createdBy': fields.createdBy ?? null, ':clientName': fields.clientName ?? null,
    ':clientContactNo': fields.clientContactNo ?? null,
    ':created_by': fields.created_by ?? null, ':client_name': fields.client_name ?? null,
    ':client_contact': fields.client_contact ?? null
  };
  try {
    const body = source.slice(0, source.indexOf('-- Report the result'))
      .replace(/^--.*$/gm, '').replace(/'application\/x-www-form-urlencoded;%'/g, "'application/x-www-form-urlencoded__SEMICOLON__%'");
    for (const statement of body.split(';').map(value => value.trim()).filter(Boolean)) {
      const restored = statement.replace(/__SEMICOLON__/g, ';');
      const set = /^SET (\w+) = ([\s\S]*)$/.exec(restored);
      const prepared = db.prepare(sqlite(set ? 'SELECT ' + set[2] + ' AS value' : restored));
      prepared.setAllowUnknownNamedParameters(true);
      if (set) vars['$' + set[1]] = prepared.get(vars)?.value ?? null;
      else prepared.run(vars);
    }
    return {status: vars.$infinity_error_status ?? 204, rows: db.prepare('SELECT * FROM tkt_InternalTickets').all()};
  } finally { db.close(); }
}

test('Infinity stores submitter and callback details with Medium and Event follow up defaults', () => {
  const result = submit();
  assert.equal(result.status, 204);
  assert.equal(result.rows.length, 1);
  const ticket = result.rows[0];
  assert.equal(ticket.RequesterGroup, 'Infinity');
  assert.equal(ticket.Department, 'CC');
  assert.equal(ticket.Priority, 'Medium');
  assert.equal(ticket.Category, 'Event follow up');
  assert.equal(ticket.Title, 'Event follow up');
  assert.equal(ticket.Status, 'Open');
  assert.equal(ticket.RequestedByUserID, null);
  assert.equal(ticket.reg_no, requiredFields.registration);
  assert.equal(ticket.ExternalCreatedBy, requiredFields.created_by);
  assert.equal(ticket.c_name, requiredFields.client_name);
  assert.equal(ticket.c_contact, requiredFields.client_contact);
  assert.equal(ticket.c_contacted, 0);
});

test('camel-case fields match the screenshot and old department config cannot override CC', () => {
  const result = submit({department: 'Helpdesk', omit: ['created_by', 'client_name', 'client_contact'], fields: {
    createdBy: 'Camel fixture submitter', clientName: 'Camel fixture client', clientContactNo: '0000000000',
    department: 'Software'
  }});
  assert.equal(result.status, 204);
  assert.equal(result.rows[0].Department, 'CC');
  assert.equal(result.rows[0].Priority, 'Medium');
  assert.equal(result.rows[0].ExternalCreatedBy, 'Camel fixture submitter');
  assert.equal(result.rows[0].c_name, 'Camel fixture client');
  assert.equal(result.rows[0].c_contact, '0000000000');
  assert.equal(submit({department: 'Unknown'}).rows[0].Department, 'CC');
});

test('submitted department, requester group, internal user ID and status cannot override server ownership', () => {
  const result = submit({department: 'TAD', fields: {
    category: 'Other', description: 'Fixture', department: 'Software', requesterGroup: 'CRM',
    RequestedByUserID: 7, priority: 'Critical', status: 'Closed', reference: 'Ignored',
    infinity_department: 'Software', infinity_error_status: null
  }});
  assert.equal(result.status, 204);
  const ticket = result.rows[0];
  assert.equal(ticket.Department, 'CC');
  assert.equal(ticket.RequesterGroup, 'Infinity');
  assert.equal(ticket.RequestedByUserID, null);
  assert.equal(ticket.Priority, 'Critical');
  assert.equal(ticket.ExternalCreatedBy, requiredFields.created_by);
  assert.equal(ticket.Status, 'Open');
});

test('registration, callback contact and long descriptions remain free text without lookups', () => {
  const description = 'x'.repeat(5000);
  const result = submit({contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    fields: {category: 'Other', description, registration: 'No vehicle lookup'}});
  assert.equal(result.status, 204);
  assert.equal(result.rows[0].Description, description);
  assert.equal(result.rows[0].reg_no, 'No vehicle lookup');
});

test('category and priority can be supplied, with blank values using the defaults', () => {
  const custom = submit({fields: {category: 'Custom category', priority: 'Low'}});
  assert.equal(custom.status, 204);
  assert.equal(custom.rows[0].Category, 'Custom category');
  assert.equal(custom.rows[0].Priority, 'Low');
  const defaults = submit({fields: {category: ' ', priority: ' '}});
  assert.equal(defaults.status, 204);
  assert.equal(defaults.rows[0].Category, 'Event follow up');
  assert.equal(defaults.rows[0].Priority, 'Medium');
});

test('Dispatch Recovery Team always creates Critical tickets regardless of the supplied priority', () => {
  for (const priority of [undefined, '', 'Low', 'Medium', 'High', 'Critical', 'Unknown']) {
    const fields = {category: 'Dispatch Recovery Team'};
    if (priority !== undefined) fields.priority = priority;
    const result = submit({fields});
    assert.equal(result.status, 204);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].Priority, 'Critical', String(priority));
    assert.equal(result.rows[0].Department, 'CC');
  }
});

test('the recovery-category match tolerates case and surrounding spaces without matching other categories', () => {
  for (const category of [' dispatch recovery team ', 'DISPATCH RECOVERY TEAM', 'Dispatch Recovery Team']) {
    const result = submit({fields: {category, priority: 'Low'}});
    assert.equal(result.status, 204);
    assert.equal(result.rows[0].Priority, 'Critical');
  }
  for (const category of ['Dispatch Recovery Team follow up', 'Other']) {
    assert.equal(submit({fields: {category}}).rows[0].Priority, 'Medium');
    assert.equal(submit({fields: {category, priority: 'High'}}).rows[0].Priority, 'High');
  }
});

test('submitter, registration, client name, contact and description are required', () => {
  for (const field of Object.keys(requiredFields)) {
    for (const options of [{omit: [field]}, {fields: {[field]: ' '}}]) {
      const result = submit(options);
      assert.equal(result.status, 400, field);
      assert.equal(result.rows.length, 0);
    }
  }
});

test('submitter and callback storage limits are checked without truncating names or phone numbers', () => {
  for (const [field, limit] of [['created_by', 120], ['client_name', 100], ['client_contact', 50]]) {
    assert.equal(submit({fields: {[field]: 'x'.repeat(limit)}}).status, 204, field);
    const tooLong = submit({fields: {[field]: 'x'.repeat(limit + 1)}});
    assert.equal(tooLong.status, 400, field);
    assert.equal(tooLong.rows.length, 0);
  }
  const result = submit({fields: {registration: 'x'.repeat(60)}});
  assert.equal(result.status, 204);
  assert.equal(result.rows[0].reg_no.length, 50);
});

test('quoted free text remains data', () => {
  const description = "Customer's device: '; DROP TABLE tickets; --";
  const result = submit({fields: {category: 'Other', description}});
  assert.equal(result.status, 204);
  assert.equal(result.rows[0].Description, description);
});

test('missing, invalid and differently cased credentials cannot insert', () => {
  for (const fixtureKey of [null, '', 'short', 'wrong-'.repeat(10), key.toUpperCase()]) {
    const result = submit({key: fixtureKey});
    assert.equal(result.status, 401);
    assert.equal(result.rows.length, 0);
  }
});

test('disabled intake and invalid configuration fail closed', () => {
  for (const options of [{enabled: 0}, {hash: null}, {hash: ''}, {hash: 'z'.repeat(64)},
    {hash: hash + '00'}]) {
    const result = submit(options);
    assert.equal(result.status, 503);
    assert.equal(result.rows.length, 0);
  }
});

test('unsupported methods and content types, missing fields and oversize input cannot insert', () => {
  for (const [options, status] of [
    [{method: 'GET'}, 405], [{method: 'PUT'}, 405],
    [{contentType: 'application/json'}, 415], [{contentType: 'text/plain'}, 415],
    [{omit: ['description']}, 400], [{fields: {priority: 'Unknown'}}, 400],
    [{fields: {category: 'Other', description: ' '}}, 400],
    [{fields: {category: 'x'.repeat(101), description: 'Fixture'}}, 400],
    [{fields: {category: 'Other', description: 'x'.repeat(66000)}}, 413]
  ]) {
    const result = submit(options);
    assert.equal(result.status, status);
    assert.equal(result.rows.length, 0);
  }
});

test('SQLPage 0.25 uses POST-only fields and private file settings without a process restart', () => {
  assert.match(source, /CAST\(:category AS NVARCHAR\(MAX\)\)/);
  assert.match(source, /CAST\(:description AS NVARCHAR\(MAX\)\)/);
  assert.doesNotMatch(source, /sqlpage\.(request_body|environment_variable)\(/);
});

test('VARCHAR-bound request strings respect NVARCHAR category and combined field limits', () => {
  assert.equal(submit({fields: {category: 'x'.repeat(100), description: 'Fixture'}}).status, 204);
  assert.equal(submit({fields: {category: 'x'.repeat(101), description: 'Fixture'}}).status, 400);
  const overhead = requiredFields.created_by.length + requiredFields.registration.length
    + requiredFields.client_name.length + requiredFields.client_contact.length + 'Test'.length;
  assert.equal(submit({fields: {category: 'Test', description: 'x'.repeat(65536 - overhead)}}).status, 204);
  assert.equal(submit({fields: {category: 'Test', description: 'x'.repeat(65537 - overhead)}}).status, 413);
});

test('ticket detail reads the external submitter only for Infinity while preserving internal creators', () => {
  const detail = fs.readFileSync(path.join(__dirname, '..', 'api_ticket.sql'), 'utf8');
  const expression = detail.match(/(COALESCE\(CASE WHEN ticket\.RequesterGroup = 'Infinity'[\s\S]*?) AS createdBy,/)[1];
  const db = new DatabaseSync(':memory:');
  db.function('CONCAT', {varargs: true}, (...values) => values.map(value => value ?? '').join(''));
  db.exec(`CREATE TABLE tickets (RequesterGroup TEXT, ExternalCreatedBy TEXT);
    CREATE TABLE creators (Name TEXT, Surname TEXT, Username TEXT);
    INSERT INTO creators VALUES ('Staff','Fixture','staff-fixture');`);
  try {
    const query = db.prepare(`SELECT ${expression} AS name FROM tickets ticket LEFT JOIN creators creator ON 1=1`);
    for (const [group, supplied, expected] of [['Infinity','Infinity fixture submitter','Infinity fixture submitter'],
      ['Internal','Untrusted external field','Staff Fixture'], ['CRM','Untrusted external field','Staff Fixture']]) {
      db.exec('DELETE FROM tickets');
      db.prepare('INSERT INTO tickets VALUES (?,?)').run(group, supplied);
      assert.equal(query.get().name, expected);
    }
    db.exec("DELETE FROM tickets; DELETE FROM creators; INSERT INTO tickets VALUES ('Infinity',NULL);");
    assert.equal(query.get().name, 'Infinity');
  } finally {db.close();}
});

test('success is emitted after the write and contains no ticket data', () => {
  assert.ok(source.indexOf("500 AS status") < source.indexOf('INSERT INTO'));
  assert.ok(source.indexOf('INSERT INTO') < source.indexOf("COALESCE($infinity_error_status, 204) AS status"));
  assert.match(source, /COALESCE\(\$infinity_error_status, 204\) AS status/);
  assert.match(source, /WHERE \$infinity_error_status IS NOT NULL;\s*$/);
});
