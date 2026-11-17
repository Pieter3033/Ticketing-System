const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Run the endpoint's actual path expressions and allowlist with isolated fixtures.
function pathReader() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'api_attachment.sql'), 'utf8');
  const transforms = [...sql.matchAll(/CROSS APPLY \(SELECT ([\s\S]*?) AS (normalized_path|read_path)\) (stored|normalized|storage)/g)];
  assert.equal(transforms.length, 3);
  const compatible = value => value.replace(/\bLEFT\(/g, 'take_left(').replace(/\bLEN\(/g, 'length(')
    .replace(/('internaltickets\/attachments\/') \+ /g, '$1 || ');
  const policyStart = sql.indexOf(' AND (storage.read_path LIKE');
  const policyEnd = sql.indexOf('\n);', policyStart);
  assert.ok(policyStart >= 0 && policyEnd > policyStart);
  const policy = sql.slice(policyStart + ' AND '.length, policyEnd)
    .replace(/LIKE '([^']*)'/g, (_, pattern) => `LIKE '${pattern.replaceAll('[_]', '\\_')}' ESCAPE '\\'`);
  const db = new DatabaseSync(':memory:');
  db.function('take_left', (value, length) => value == null ? null : value.slice(0, length));
  db.function('CHARINDEX', (needle, value) => value == null ? null : value.indexOf(needle) + 1);
  const query = db.prepare(`WITH
    stored AS (SELECT ${compatible(transforms[0][1])} AS normalized_path FROM (SELECT $path AS StoredFilePath) a),
    normalized AS (SELECT ${compatible(transforms[1][1])} AS normalized_path FROM stored),
    storage AS (SELECT ${compatible(transforms[2][1])} AS read_path FROM normalized)
    SELECT read_path FROM storage WHERE ${policy}`);
  return { read: value => query.get({$path: value})?.read_path, close: () => db.close() };
}

test('Windows persisted uploads read relative to the web root, with or without a leading slash', () => {
  const h = pathReader();
  try {
    for (const stored of [
      '/sqlpage\\internaltickets_attachments\\fixture.xlsx',
      '/sqlpage/internaltickets_attachments/fixture.xlsx',
      'sqlpage\\internaltickets_attachments\\fixture.xlsx',
      'sqlpage/internaltickets_attachments/fixture.xlsx'
    ]) assert.equal(h.read(stored), 'sqlpage/internaltickets_attachments/fixture.xlsx');
  } finally { h.close(); }
});

test('legacy attachment folders and the desktop mapping retain their existing behavior', () => {
  const h = pathReader();
  try {
    assert.equal(h.read('/internaltickets/attachments/fixture.pdf'), 'internaltickets/attachments/fixture.pdf');
    assert.equal(h.read('C:\\Users\\williamc\\Desktop\\Jobcards Official_3 - Risk Integrated- UI\\internaltickets\\attachments\\fixture.pdf'), 'internaltickets/attachments/fixture.pdf');
    assert.equal(h.read('E:\\SQLPage\\sqlpage\\internaltickets_attachments\\fixture.pdf'), 'E:/SQLPage/sqlpage/internaltickets_attachments/fixture.pdf');
  } finally { h.close(); }
});

test('path traversal, other folders, unexpected drives and repeated leading slashes remain denied', () => {
  const h = pathReader();
  try {
    for (const stored of [
      '/sqlpage/internaltickets_attachments/../fixture.txt',
      '/sqlpage/private/fixture.txt',
      'sqlpage/internalticketsXattachments/fixture.txt',
      'C:/private/fixture.txt',
      '//sqlpage/internaltickets_attachments/fixture.txt',
      null
    ]) assert.equal(h.read(stored), undefined);
  } finally { h.close(); }
});
