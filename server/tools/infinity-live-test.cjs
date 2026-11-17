// A one-request operator test. Default mode previews the plan without reading credentials.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createHash } = require('node:crypto');

function ensure(value, message) { if (!value) throw new Error(message); }
function readKey(credentialsPath, settingsPath) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
  ensure(Number(settings.enabled) === 1, 'Infinity intake is disabled; no request was sent.');
  const expected = String(settings.apiKeySha256 || '').toLowerCase();
  ensure(/^[a-f0-9]{64}$/.test(expected), 'Infinity credential configuration is invalid; no request was sent.');
  const handoff = fs.readFileSync(credentialsPath, 'utf8');
  const candidates = [...new Set(handoff.match(/[A-Za-z0-9_~.+/=-]{32,256}/g) || [])];
  const matches = candidates.filter(value => createHash('sha256').update(value, 'ascii').digest('hex') === expected);
  ensure(matches.length === 1, 'The private handoff does not match the current API key; no request was sent.');
  return matches[0];
}
function sendOnce(plan, key) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(plan.payload), 'utf8');
    const request = https.request('https://job.pulsit.co.za/internaltickets/api_infinity_tickets.sql', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key, 'Content-Length': body.length }
    }, response => {
      let responseBytes = 0;
      response.on('data', chunk => { responseBytes += chunk.length; });
      response.on('end', () => resolve({ status: response.statusCode, responseBytes }));
      response.on('error', () => reject(new Error('The response could not be confirmed. Reconcile the test marker before retrying.')));
    });
    request.setTimeout(20000, () => request.destroy(new Error('Request timed out. Reconcile the test marker before retrying.')));
    request.on('error', () => reject(new Error('Ticket submission could not be confirmed. Reconcile the test marker before retrying.')));
    request.end(body);
  });
}
async function main() {
  const planIndex = process.argv.indexOf('--plan');
  ensure(planIndex >= 0 && process.argv[planIndex + 1], 'Supply --plan with the prepared test plan path.');
  const planPath = path.resolve(process.argv[planIndex + 1]);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  ensure(plan.endpoint === 'https://job.pulsit.co.za/internaltickets/api_infinity_tickets.sql', 'Unexpected test endpoint.');
  ensure(plan.expectedAffectedRows === 1 && plan.table === 'CC.dbo.tkt_InternalTickets', 'Unexpected database test scope.');
  ensure(String(plan.payload?.description || '').includes(plan.marker), 'The payload must contain its unique test marker.');
  if (!process.argv.includes('--send-once')) {
    console.log(JSON.stringify({ mode: 'preview only; no credentials read and no request sent', ...plan }, null, 2));
    return;
  }
  const attemptPath = path.join(path.dirname(planPath), 'attempt.json');
  ensure(!fs.existsSync(attemptPath), 'This plan already has an attempt record. Reconcile it before any retry.');
  const key = readKey(plan.credentialsPath, plan.settingsPath);
  const attempt = { marker: plan.marker, status: 'sending; outcome not yet confirmed', requestSent: false };
  fs.writeFileSync(attemptPath, JSON.stringify(attempt, null, 2) + '\n', { flag: 'wx' });
  try {
    attempt.requestSent = true;
    fs.writeFileSync(attemptPath, JSON.stringify(attempt, null, 2) + '\n');
    const response = await sendOnce(plan, key);
    Object.assign(attempt, response, { status: response.status === 204 ? 'HTTP 204 received; database verification required' : 'Rejected or uncertain; reconcile before retrying' });
    fs.writeFileSync(attemptPath, JSON.stringify(attempt, null, 2) + '\n');
    console.log(JSON.stringify(attempt));
    if (response.status !== 204) process.exitCode = 1;
  } catch {
    attempt.status = 'outcome uncertain; reconcile the marker before retrying';
    fs.writeFileSync(attemptPath, JSON.stringify(attempt, null, 2) + '\n');
    throw new Error('The submission outcome is uncertain. No retry was attempted; verify the unique marker first.');
  }
}

module.exports = { readKey };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
