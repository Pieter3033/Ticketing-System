// Operator-run hosting steps. Importing this module never changes files or services.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

class OperatorError extends Error {}
function ensure(value, message) { if (!value) throw new OperatorError(message); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function mergeCaddy(baseline, jobServer) {
  ensure(baseline?.apps?.http?.servers, 'Existing Caddy HTTP settings are missing.');
  ensure(baseline?.apps?.tls?.certificates?.load_files?.length, 'Expected existing certificate settings are missing.');
  ensure(!baseline.apps.http.servers.job_infinity_https, 'The job HTTPS server already exists; review the current settings.');
  ensure(!Object.values(baseline.apps.http.servers).some(server => (server.listen || []).some(address => /:443$/.test(address))), 'Existing Caddy already has a 443 listener; review its routes first.');
  ensure(jobServer.listen?.length === 1 && jobServer.listen[0] === ':443', 'Unexpected proposed HTTPS listener.');
  const merged = clone(baseline);
  merged.apps.http.servers.job_infinity_https = clone(jobServer);
  // Use the already-loaded, trusted certificate covering job.pulsit.co.za.
  // Existing DSV TLS settings and the port-80 redirect remain unchanged.
  merged.apps.http.servers.job_infinity_https.tls_connection_policies = [{}];
  merged.apps.http.servers.job_infinity_https.automatic_https = { disable: true };
  return merged;
}
function sqlpageHttpOnly(configuration) {
  ensure(Number(configuration.port) === 4438 && configuration.https_domain === 'job.pulsit.co.za', 'Unexpected SQLPage hosting settings. Nothing was changed.');
  const updated = clone(configuration);
  delete updated.https_domain;
  return updated;
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new OperatorError('A required configuration file could not be read. No file contents were printed.'); }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function localPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
    socket.setTimeout(1500, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}
// Use a plain local HTTP client, like the successful PowerShell inspection.
// Node fetch adds Sec-Fetch-Mode, which enables Caddy's browser-origin checks.
function caddyAdminRequest(pathname, { method = 'GET', body, timeout = 5000, port = 2019 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    }
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, response => {
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 2097152) {
          response.destroy();
          request.destroy(new OperatorError('Caddy returned more configuration data than expected.'));
        } else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(timeout, () => request.destroy(new Error('Local administration request timed out.')));
    request.on('error', reject);
    request.end(body);
  });
}
async function runningCaddy(send = caddyAdminRequest) {
  let response;
  try { response = await send('/config/'); }
  catch { throw new OperatorError('The existing Caddy administration endpoint could not be reached.'); }
  ensure(response.statusCode >= 200 && response.statusCode < 300, 'The existing Caddy settings could not be read (HTTP ' + response.statusCode + ').');
  try { return JSON.parse(response.body); }
  catch { throw new OperatorError('The existing Caddy response was not valid configuration JSON.'); }
}
async function reloadCaddy(configuration, send = caddyAdminRequest) {
  let response;
  try {
    response = await send('/load', { method: 'POST', body: JSON.stringify(configuration), timeout: 20000 });
  } catch { throw new OperatorError('Caddy reload could not be confirmed. Re-run this step to inspect its state before proceeding.'); }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new OperatorError('Caddy rejected the proposed configuration (HTTP ' + response.statusCode + '). Its previous routing remains active. Use 05-ROLLBACK-HTTPS.cmd to restore SQLPage HTTPS.');
  }
}
function paths(root) {
  return {
    root, plan: path.join(root, 'cutover-plan.json'), state: path.join(root, 'cutover-state.json'),
    sql: path.resolve(root, '..', 'Jobcard Offical_2', 'sqlpage', 'sqlpage.json')
  };
}
function privatePath(root, relative) {
  const resolved = path.resolve(root, relative);
  ensure(resolved.startsWith(path.resolve(root) + path.sep), 'Unexpected backup path.');
  return resolved;
}
function productionOnly() {
  ensure(Object.values(os.networkInterfaces()).flat().some(address => address?.address === '192.168.140.222'), 'Run this step on the production server.');
}
async function requireInternalListeners() {
  ensure(await localPort(3201), 'The adapter is not listening on 3201. Keep RUN-ADAPTER.cmd open.');
  ensure(await localPort(4438), 'SQLPage is not listening on 4438. Start its existing application before continuing.');
}
function checkWebsiteHttps() {
  return new Promise(resolve => {
    const request = https.request({ hostname: '127.0.0.1', port: 443, servername: 'job.pulsit.co.za',
      headers: { Host: 'job.pulsit.co.za' }, path: '/internaltickets/index.html', method: 'HEAD', timeout: 5000 }, response => {
      response.resume(); resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
    request.end();
  });
}
async function prepare(root) {
  const p = paths(root);
  if (fs.existsSync(p.state)) {
    const state = readJson(p.state);
    ensure(digest(readJson(p.sql)) === state.sqlPreparedDigest, 'A previous preparation exists but SQLPage settings differ. Review before repeating.');
    console.log('Preparation already completed. Restart SQLPage, then run 04-ACTIVATE-API.cmd.');
    return;
  }
  await requireInternalListeners();
  const plan = readJson(p.plan);
  const baseline = readJson(privatePath(root, plan.baselineSnapshot));
  ensure(digest(baseline) === plan.baselineDigest, 'The inspected Caddy snapshot differs from the reviewed plan.');
  ensure(digest(await runningCaddy()) === plan.baselineDigest, 'Caddy settings changed since inspection. Run 02-INSPECT-EXISTING-PROXY.cmd again.');
  const sqlOriginalRaw = fs.readFileSync(p.sql);
  const sqlOriginal = readJson(p.sql);
  const sqlPrepared = sqlpageHttpOnly(sqlOriginal);
  const merged = mergeCaddy(baseline, plan.jobServer);
  const backupRelative = path.join('private-backups', 'cutover-' + randomUUID().slice(0, 8));
  const backupRoot = privatePath(root, backupRelative);
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.writeFileSync(path.join(backupRoot, 'sqlpage-original.private.json'), sqlOriginalRaw, { flag: 'wx' });
  writeJson(path.join(backupRoot, 'caddy-original.private.json'), baseline);
  const proposed = path.join(backupRoot, 'caddy-with-api.private.json');
  writeJson(proposed, merged);
  console.log('Validating the full Caddy configuration, including its existing certificate files...');
  const validation = spawnSync(path.join(root, 'caddy.exe'), ['validate', '--config', proposed], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (validation.status !== 0) {
    const accessDenied = /access is denied|permission denied/i.test(validation.stderr || '');
    throw new OperatorError('Caddy validation failed; SQLPage settings were not changed.' + (accessDenied ? ' Run this preparation as Administrator so it can read the existing certificate files.' : ' Existing certificate/configuration paths need review.'));
  }
  console.log('Caddy validation passed. Existing DSV routing and certificate settings are preserved.');
  ensure(digest(await runningCaddy()) === plan.baselineDigest, 'Caddy settings changed during validation. Nothing was applied.');
  ensure(fs.readFileSync(p.sql).equals(sqlOriginalRaw), 'SQLPage settings changed during preparation. Nothing was applied.');
  const state = { status: 'prepared; awaiting operator SQLPage restart', backupRelative,
    originalCaddyDigest: digest(baseline), proposedCaddyDigest: digest(merged),
    sqlOriginalDigest: digest(sqlOriginal), sqlPreparedDigest: digest(sqlPrepared),
    databaseWrites: 0, preparationRestartedProcesses: false };
  writeJson(p.state, state);
  // Writing the existing file preserves its current Windows ACL. No process is restarted.
  try { writeJson(p.sql, sqlPrepared); }
  catch {
    try { fs.writeFileSync(p.sql, sqlOriginalRaw); } catch {}
    throw new OperatorError('SQLPage configuration could not be updated safely. Do not restart it; review its private backup first.');
  }
  console.log('PREPARATION COMPLETE: SQLPage configuration backed up; only https_domain removed.');
  console.log('The running website has not been restarted or reloaded.');
  console.log('NEXT: Restart the existing SQLPage application on this server, then run 04-ACTIVATE-API.cmd.');
}
async function activate(root) {
  const p = paths(root), state = readJson(p.state);
  const backupRoot = privatePath(root, state.backupRelative);
  const proposed = readJson(path.join(backupRoot, 'caddy-with-api.private.json'));
  ensure(digest(proposed) === state.proposedCaddyDigest, 'Proposed Caddy settings changed; review before applying.');
  ensure(digest(readJson(p.sql)) === state.sqlPreparedDigest, 'SQLPage configuration differs from the prepared version.');
  await requireInternalListeners();
  const active = await runningCaddy();
  if (digest(active) !== state.proposedCaddyDigest) {
    ensure(digest(active) === state.originalCaddyDigest, 'Caddy settings changed; no reload was attempted.');
    ensure(!(await localPort(443)), 'SQLPage still owns HTTPS port 443. Restart SQLPage after preparation, then run this step again.');
    console.log('Reloading the existing Caddy instance with the additional job API HTTPS route...');
    await reloadCaddy(proposed);
  }
  ensure(digest(await runningCaddy()) === state.proposedCaddyDigest, 'The proposed routing could not be confirmed.');
  state.status = 'Caddy API route active; verifying website HTTPS';
  writeJson(p.state, state);
  ensure(await checkWebsiteHttps(), 'The route loaded but website HTTPS verification failed. Use 05-ROLLBACK-HTTPS.cmd and restart SQLPage to restore its previous HTTPS setup.');
  state.status = 'HTTPS route active and website verified';
  writeJson(p.state, state);
  console.log('HTTPS ACTIVE: The API URL now routes to the JSON adapter. Website HTTPS returned HTTP 200.');
  console.log('Existing DSV server configuration is unchanged. No ticket was created or changed.');
  console.log('Keep the adapter, SQLPage and existing Caddy running. Configure their normal persistent startup separately.');
}
async function rollback(root) {
  const p = paths(root), state = readJson(p.state);
  const backupRoot = privatePath(root, state.backupRelative);
  const original = readJson(path.join(backupRoot, 'caddy-original.private.json'));
  ensure(digest(original) === state.originalCaddyDigest, 'Caddy backup differs from the recorded original.');
  const currentSql = digest(readJson(p.sql));
  ensure([state.sqlOriginalDigest, state.sqlPreparedDigest].includes(currentSql), 'SQLPage settings changed after preparation; they were preserved for manual review.');
  const activeDigest = digest(await runningCaddy());
  ensure([state.originalCaddyDigest, state.proposedCaddyDigest].includes(activeDigest), 'Caddy settings changed; no rollback overwrite was attempted.');
  if (activeDigest === state.proposedCaddyDigest) await reloadCaddy(original);
  fs.copyFileSync(path.join(backupRoot, 'sqlpage-original.private.json'), p.sql);
  state.status = 'original settings restored; operator SQLPage restart required';
  writeJson(p.state, state);
  console.log('Original Caddy and SQLPage settings restored. Restart the existing SQLPage application to restore its HTTPS listener.');
}

module.exports = { canonical, digest, mergeCaddy, sqlpageHttpOnly, caddyAdminRequest, runningCaddy, reloadCaddy, OperatorError };
if (require.main === module) {
  (async () => {
    productionOnly();
    const action = process.argv[2];
    ensure(['prepare', 'activate', 'rollback'].includes(action), 'Select prepare, activate or rollback.');
    await ({ prepare, activate, rollback }[action])(__dirname);
  })().catch(error => {
    console.error(error instanceof OperatorError ? error.message : 'The step could not complete. No configuration contents were printed; review file access and the recorded cutover state.');
    process.exitCode = 1;
  });
}
