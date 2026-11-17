const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createInfinityApp, endpointPath } = require('../server/infinityApp');

// Disposable HTTP listeners and mocked SQLPage transport only; no real DB or API key.
const fixtureKey = 'isolated-fixture-key-0123456789abcdef';
const payload = {
  createdBy: 'Fixture user', clientName: 'Fixture client', clientContactNo: '0000000000',
  registration: 'API-TEST', category: 'Event follow up', description: 'Fixture description',
  priority: 'Medium', department: 'CC'
};
async function gateway(t, result = () => new Response(null, { status: 204 })) {
  const calls = [];
  const app = createInfinityApp({ fetchImpl: async (...args) => { calls.push(args); return result(...args); } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return {
    calls,
    request: (body = JSON.stringify(payload), options = {}) => fetch(`http://127.0.0.1:${server.address().port}${endpointPath}`, {
      method: 'POST', body, ...options,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': fixtureKey, ...options.headers }
    })
  };
}

test('the exact screenshot JSON maps to the existing SQLPage intake and returns empty 204', async t => {
  const h = await gateway(t);
  const response = await h.request();
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.calls.length, 1);
  const [url, request] = h.calls[0];
  assert.equal(url, 'http://127.0.0.1:8080' + endpointPath);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['X-API-Key'], fixtureKey);
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    created_by: payload.createdBy, client_name: payload.clientName, client_contact: payload.clientContactNo,
    registration: payload.registration, category: payload.category, description: payload.description, priority: 'Medium'
  });
});

test('caller department, account IDs, group and status cannot reach the SQLPage handler', async t => {
  const h = await gateway(t);
  const input = { ...payload, department: 'Software', RequesterGroup: 'CRM', requestedByUserId: 7, status: 'Closed' };
  const response = await h.request(JSON.stringify(input));
  assert.equal(response.status, 204);
  const body = new URLSearchParams(h.calls[0][1].body);
  for (const name of ['department', 'RequesterGroup', 'requestedByUserId', 'status']) assert.equal(body.has(name), false);
});

test('omitted priority/category reach the SQLPage defaults and explicit priorities survive', async t => {
  const h = await gateway(t);
  const { priority, category, ...required } = payload;
  assert.equal((await h.request(JSON.stringify(required))).status, 204);
  const form = new URLSearchParams(h.calls[0][1].body);
  assert.equal(form.has('priority'), false);
  assert.equal(form.has('category'), false);
  assert.equal((await h.request(JSON.stringify({ ...payload, priority: 'Critical' }))).status, 204);
  assert.equal(new URLSearchParams(h.calls[1][1].body).get('priority'), 'Critical');
});

test('legacy form fields and JSON with a charset remain supported', async t => {
  const h = await gateway(t);
  const form = new URLSearchParams({ created_by: 'Fixture', client_name: 'Fixture', client_contact: '000',
    registration: 'TEST', description: 'Fixture' });
  assert.equal((await h.request(form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 204);
  assert.equal(new URLSearchParams(h.calls[0][1].body).get('created_by'), 'Fixture');
  assert.equal((await h.request(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status, 204);
});

test('invalid JSON, arrays, nulls and non-string fields never reach the backend', async t => {
  const h = await gateway(t);
  for (const body of ['{', 'null', '[]', '"text"', JSON.stringify({ ...payload, createdBy: null }),
    JSON.stringify({ ...payload, clientContactNo: 123 }), JSON.stringify({ ...payload, category: {} })]) {
    assert.equal((await h.request(body)).status, 400, body);
  }
  assert.equal(h.calls.length, 0);
});

test('methods, unsupported content types, missing keys and oversized data fail before forwarding', async t => {
  const h = await gateway(t);
  const get = await h.request(undefined, { method: 'GET', body: undefined });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal((await h.request('', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.request('', { headers: { 'X-API-Key': '' } })).status, 401);
  assert.equal((await h.request('x'.repeat(16400))).status, 413);
  // Small JSON can expand past the old SQLPage limit during URL encoding.
  assert.equal((await h.request(JSON.stringify({ ...payload, description: '\u20ac'.repeat(1900) }))).status, 413);
  assert.equal(h.calls.length, 0);
});

test('SQLPage rejection statuses survive while diagnostic bodies stay private', async t => {
  for (const status of [400, 401, 413, 503, 500, 200, 302]) {
    const h = await gateway(t, () => new Response('private database diagnostic fixture', { status }));
    const response = await h.request();
    assert.equal(response.status, [400, 401, 413, 503].includes(status) ? status : 502);
    assert.doesNotMatch(await response.text(), /private database diagnostic fixture/);
    assert.equal(h.calls.length, 1);
  }
});

test('transport failure and timeout do not retry or claim success', async t => {
  for (const [name, expected] of [['TypeError', 502], ['TimeoutError', 504]]) {
    const h = await gateway(t, () => { const error = new Error('private transport fixture'); error.name = name; throw error; });
    const response = await h.request();
    assert.equal(response.status, expected);
    const body = await response.text();
    assert.match(body, /Check before retrying/);
    assert.doesNotMatch(body, /private transport fixture/);
    assert.equal(h.calls.length, 1);
  }
});

test('upstream configuration refuses credentials and request-controlled paths', () => {
  for (const sqlpageOrigin of ['file:///tmp/', 'http://user:secret@localhost:8080', 'http://localhost:8080/other', 'http://localhost:8080/?x=y']) {
    assert.throws(() => createInfinityApp({ sqlpageOrigin }), /must be an HTTP origin/);
  }
});
