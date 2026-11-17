const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { digest, mergeCaddy, sqlpageHttpOnly, caddyAdminRequest, runningCaddy, reloadCaddy } = require('../server/deployment/infinity-proxy/cutover.cjs');
const baseline = {
  apps: {
    http: { servers: { srv0: { listen: [':3001'], routes: [{ match: [{ host: ['dsv.fixture.invalid'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:3000' }] }] }], tls_connection_policies: [{}] } } },
    tls: { certificates: { load_files: [{ certificate: 'fixture.crt', key: 'fixture.key' }] } }
  }
};
const jobServer = { listen: [':443'], routes: [{ match: [{ host: ['job.pulsit.co.za'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '127.0.0.1:3201' }] }] }] };

test('adding job HTTPS preserves every existing Caddy setting and certificate', () => {
  const originalDigest = digest(baseline);
  const result = mergeCaddy(baseline, jobServer);
  assert.equal(digest(baseline), originalDigest);
  assert.deepEqual(result.apps.http.servers.srv0, baseline.apps.http.servers.srv0);
  assert.deepEqual(result.apps.tls, baseline.apps.tls);
  assert.deepEqual(result.apps.http.servers.job_infinity_https.listen, [':443']);
  assert.deepEqual(result.apps.http.servers.job_infinity_https.tls_connection_policies, [{}]);
  assert.equal(result.apps.http.servers.job_infinity_https.automatic_https.disable, true);
  delete result.apps.http.servers.job_infinity_https;
  assert.deepEqual(result, baseline);
});

test('configuration drift digests ignore key order while detecting routing changes', () => {
  assert.equal(digest({a:1,b:2}), digest({b:2,a:1}));
  assert.notEqual(digest(baseline), digest({...baseline, admin:{disabled:true}}));
});

test('SQLPage preparation removes only its HTTPS domain and retains all other values', () => {
  const source = { port:4438, https_domain:'job.pulsit.co.za', database_url:'fixture://private-value', other:{nested:true} };
  const result = sqlpageHttpOnly(source);
  assert.deepEqual(result, {port:4438,database_url:'fixture://private-value',other:{nested:true}});
  assert.equal(source.https_domain, 'job.pulsit.co.za');
  assert.throws(() => sqlpageHttpOnly({...source,port:8080}), /Unexpected SQLPage hosting settings/);
});

test('preparation refuses an existing HTTPS listener or duplicate target server', () => {
  const occupied = structuredClone(baseline);
  occupied.apps.http.servers.other = {listen:[':443']};
  assert.throws(() => mergeCaddy(occupied,jobServer), /already has a 443 listener/);
  const duplicate = structuredClone(baseline);
  duplicate.apps.http.servers.job_infinity_https = {};
  assert.throws(() => mergeCaddy(duplicate,jobServer), /already exists/);
});

test('the admin client reads and posts without browser Fetch metadata', async t => {
  const received = [];
  const server = http.createServer((request, response) => {
    // Reproduce Caddy's origin-check trigger: Sec-Fetch-Mode without an Origin.
    if (request.headers['sec-fetch-mode'] && !request.headers.origin) {
      response.writeHead(403).end('origin required');
      return;
    }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push({ method:request.method, path:request.url, body, headers:request.headers });
      response.setHeader('Content-Type','application/json');
      response.end(request.method === 'GET' ? JSON.stringify(baseline) : '');
    });
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  assert.equal((await fetch('http://127.0.0.1:' + port + '/config/')).status,403);
  const send = (pathname,options) => caddyAdminRequest(pathname,{...options,port});
  assert.deepEqual(await runningCaddy(send),baseline);
  const proposed = mergeCaddy(baseline,jobServer);
  await reloadCaddy(proposed,send);
  assert.equal(received.length,2);
  assert.deepEqual(received.map(request=>[request.method,request.path]),[['GET','/config/'],['POST','/load']]);
  for (const request of received) {
    assert.equal(request.headers['sec-fetch-mode'],undefined);
    assert.equal(request.headers.origin,undefined);
  }
  assert.deepEqual(JSON.parse(received[1].body),proposed);
});

test('admin rejection errors include the status without printing configuration or diagnostics', async () => {
  const send = async () => ({statusCode:403,body:'private fixture diagnostics'});
  await assert.rejects(runningCaddy(send),error=>/HTTP 403/.test(error.message)&&!error.message.includes('private fixture'));
  await assert.rejects(reloadCaddy(baseline,send),error=>/HTTP 403/.test(error.message)&&!error.message.includes('private fixture'));
});
