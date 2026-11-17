const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const access = require('../ticket-access');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

// Execute the actual access predicate from each SQLPage endpoint against isolated in-memory fixtures.
// No SQL Server connection, real session, or production data is used.
function predicate(sql) {
  const last = "ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))";
  const end = sql.indexOf(last);
  const start = sql.lastIndexOf('ticket.IsDeleted = 0\n', end);
  assert.ok(start >= 0 && end > start, 'Endpoint must enforce the complete visibility predicate');
  return sql.slice(start, end + last.length);
}
function identity(type, id = 99, helpdesk = false) {
  return {$ticket_user_id:id, $ticket_user_type:type, $ticket_is_requester:[12,13].includes(type)?1:0,
    $ticket_requester_group:type===12?'IBLS':type===13?'CRM':'Internal',
    $ticket_staff_access:[0,7,8,14].includes(type)||(type===1&&helpdesk)?1:0, $software_access_allowed:type===7?1:0};
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tickets (TicketID INT, RequesterGroup TEXT, Department TEXT, IsDeleted INT, Status TEXT, RequestedByUserID INT);
    INSERT INTO tickets VALUES (1,'Internal','Helpdesk',0,'Open',1),(2,'IBLS','Helpdesk',0,'Open',20),
    (3,'IBLS','Pulscam',0,'Closed',21),(4,'Internal','Software',0,'Open',1),
    (5,'IBLS','Helpdesk',1,'Open',20),(6,'Internal','Helpdesk',0,'Cancelled',1),
    (7,'CRM','Helpdesk',0,'Open',30),(8,'CRM','Pulscam',0,'Closed',31),(9,'CRM','Helpdesk',1,'Open',30),
    (10,'Infinity','Helpdesk',0,'Open',NULL),(11,'Infinity','TAD',0,'Closed',NULL),
    (12,'Infinity','Helpdesk',1,'Open',NULL);`);
  return db;
}
for (const file of ['api_tickets.sql','api_ticket.sql','api_attachment.sql','acknowledge_ticket.sql','add_comment.sql','update_department.sql','update_zoho_ticket.sql','update_client_contacted.sql']) {
  test(`${file}: group access denies direct IDs and invalid sessions`, () => {
    const db = fixture();
    try {
      const query = db.prepare(`SELECT TicketID FROM tickets ticket WHERE ${predicate(source(file))} ORDER BY TicketID`);
      const ids = user => query.all(user).map(row=>row.TicketID);
      assert.deepEqual(ids(identity(12)), [2,3]); // Different creators, active and completed.
      assert.deepEqual(ids(identity(13)), [7,8]); // CRM cannot read IBLS or Internal tickets.
      assert.deepEqual(ids(identity(7)), [1,2,3,4,6,7,8,10,11]);
      assert.deepEqual(ids(identity(8)), [1,2,3,6,7,8,10,11]);
      assert.deepEqual(ids(identity(14)), [1,2,3,6,7,8,10,11]);
      assert.deepEqual(ids(identity(1)), [1,6,10,11]);
      assert.deepEqual(ids(identity(1,99,true)), [1,2,3,6,7,8,10,11]);
      assert.deepEqual(ids(identity(null,null)), []);
      assert.deepEqual(ids(identity(12,null)), []);
      assert.deepEqual(ids(identity(null)), []);
    } finally { db.close(); }
  });
}
test('IBLS and CRM cannot invoke any ticket management predicate, including their own group', () => {
  for (const file of ['acknowledge_ticket.sql','add_comment.sql','update_department.sql','update_zoho_ticket.sql','update_client_contacted.sql']) {
    const sql = source(file);
    assert.match(sql, /AND \$ticket_manage_access = 1/);
    const db = fixture();
    try {
      const query = db.prepare(`SELECT TicketID FROM tickets ticket WHERE ${predicate(sql)} AND $ticket_manage_access = 1`);
      assert.deepEqual(query.all({...identity(12),$ticket_manage_access:0}), []);
      assert.deepEqual(query.all({...identity(13),$ticket_manage_access:0}), []);
      assert.ok(query.all({...identity(8),$ticket_manage_access:1}).length > 0);
    } finally { db.close(); }
  }
});
test('details, comments and attachments share the same visibility checks', () => {
  const sql = source('api_ticket.sql');
  assert.equal((sql.match(/ticket\.RequesterGroup = \$ticket_requester_group/g)||[]).length, 3);
  assert.equal((sql.match(/ticket\.IsDeleted = 0/g)||[]).length, 4);
  assert.doesNotMatch(sql, /StoredFilePath AS/);
  assert.match(source('api_attachment.sql'), /sqlpage\.read_file_as_data_url\(\$attachment_path\)/);
});

test('every access check includes Infinity in the normal system without changing requester isolation', () => {
  const files = ['api_tickets.sql', 'api_ticket.sql', 'api_attachment.sql', 'acknowledge_ticket.sql',
    'add_comment.sql', 'update_department.sql', 'update_zoho_ticket.sql', 'update_client_contacted.sql'];
  const db = fixture();
  try {
    for (const file of files) {
      const sql = source(file);
      assert.doesNotMatch(sql, /ticket\.RequesterGroup = 'Internal' OR/);
      const last = "ticket.RequesterGroup IN ('Internal', 'Infinity') OR $ticket_staff_access = 1)))";
      let offset = 0;
      for (let end; (end = sql.indexOf(last, offset)) !== -1; offset = end + last.length) {
        const start = sql.lastIndexOf('ticket.IsDeleted = 0\n', end);
        const query = db.prepare(`SELECT TicketID FROM tickets ticket WHERE ${sql.slice(start, end + last.length)} AND ticket.RequesterGroup = 'Infinity' ORDER BY TicketID`);
        assert.deepEqual(query.all(identity(1)).map(row => row.TicketID), [10, 11], file);
        assert.deepEqual(query.all(identity(12)), [], file);
        assert.deepEqual(query.all(identity(13)), [], file);
        assert.deepEqual(query.all(identity(null, null)), [], file);
      }
    }
  } finally { db.close(); }
});
test('creation marker is derived from the session; the public path cannot select IBLS or CRM', () => {
  const sql = source('create_ticket.sql');
  assert.match(sql, /CASE WHEN \$ticket_is_requester = 1 THEN \$ticket_requester_group ELSE 'Internal' END/);
  assert.doesNotMatch(sql, /[:$](?:requesterGroup|requester_group)(?!_value)/);
  assert.match(source('public_create_ticket.sql'), /WHEN \$public_is_requester = 1 THEN 'requester_public_denied'/);
  assert.match(sql, /'sqlpage\/internaltickets_attachments'/);
});
test('restricted integration endpoints authenticate the session instead of trusting username cookies', () => {
  for (const file of ['api_escalations.sql','api_zoho_escalation.sql','api_unique_escalation.sql','api_escalation_map_options.sql','api_escalation_map_update.sql','api_quick_log_dashboard.sql','api_log_communication_submit.sql']) {
    assert.match(source(file), /sqlpage\.run_sql\('sqlpage\/internaltickets_access.sql'\)/);
    assert.doesNotMatch(source(file), /sqlpage\.cookie\('(?:username|Username)'\)/);
  }
  const quickLog=source('api_log_communication_submit.sql');
  assert.match(quickLog,/AND \$ticket_user_type IN \(7, 8, 14\) AND \$ticket_user_id IS NOT NULL/);
  assert.match(quickLog,/sqlpage\.run_sql\('sqlpage\/quick_log_submission_context.sql'\)/);
  assert.match(quickLog,/THEN N'CC_Escalation\/quick_log_submit.sql'/);
  assert.doesNotMatch(quickLog,/\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO\s+)?(?:Pulsit_comparison|CC)\.dbo\./i);
});
test('all locally hosted legacy ticket copies deny IBLS before executing their old queries', () => {
  const base = path.resolve(__dirname,'../..');
  for (const dir of ['internaltickets - Copy','internaltickets/production-update-draft/internaltickets']) {
    const location = path.join(base,dir);
    if (!fs.existsSync(location)) continue;
    for (const file of fs.readdirSync(location).filter(file=>file.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(location,file),'utf8');
      assert.ok(sql.startsWith('-- Archive/copy access guard:'),file);
      assert.match(sql.slice(0,700),/SELECT 'redirect' AS component/);
      assert.match(sql.slice(0,700),/canManageIBLS.*<> 1/);
    }
  }
});

function frontend(user) {
  const context = vm.createContext({window:{InternalTicketAccess:access,matchMedia:()=>({matches:false})},
    document:{querySelector:()=>null},location:{search:''}, URLSearchParams,console});
  const script = source('script.js');
  vm.runInContext(script.slice(0,script.indexOf('elements.detail?.addEventListener')), context);
  context.user = user;
  vm.runInContext('state.currentUser = user;',context);
  return {context,render: ticket=> {context.ticket=ticket;return vm.runInContext('ticketDetailHtml(ticket, [], [{attachmentId:7, originalFileName:"Test.pdf",downloadUrl:"api_attachment.sql?attachment_id=7"}])',context);}};
}
test('IBLS detail view shows updates and authenticated downloads without management controls', () => {
  const h = frontend({userId:42,user_type:12});
  const html = h.render({ticketId:2,ticketNumber:'TEST-2',department:'Helpdesk',requesterGroup:'IBLS',status:'Open',priority:'Medium',canManage:false});
  assert.match(html,/Conversation/);
  assert.match(html,/requester-ticket-badge/);
  assert.match(html,/data-ticket-action="download-attachment"/);
  assert.doesNotMatch(html,/id="commentForm"|data-ticket-action="assign-self"|save-department|edit-zoho-ticket/);
  assert.equal(vm.runInContext('canViewJobcards()',h.context),false);
});
test('staff keeps ticket management; IBLS tickets cannot be routed to Software', () => {
  const h = frontend({userId:42,user_type:7});
  const html = h.render({ticketId:2,ticketNumber:'TEST-2',department:'Helpdesk',requesterGroup:'IBLS',status:'Open',priority:'Medium',canManage:true});
  assert.match(html,/id="commentForm"/);
  assert.match(html,/data-ticket-action="assign-self"/);
  assert.match(html,/save-department/);
  assert.doesNotMatch(html,/<option value="Software"/);
  const completed = h.render({ticketId:3,department:'Pulscam',requesterGroup:'IBLS',status:'Cancelled',priority:'Medium',canManage:true});
  assert.doesNotMatch(completed,/data-ticket-action="assign-self"|save-department|edit-zoho-ticket/);
});

function serviceHarness(user) {
  const requests=[];
  class Request {
    constructor(){this.inputs={};requests.push(this);}
    input(name,type,value){this.inputs[name]=value;return this;}
    async query(sql){this.queryText=sql;return {recordset:sql.includes('WITH session_source')?(user?[user]:[]):sql.includes('INSERT INTO CC.dbo.tkt_InternalTickets')?[{TicketID:100,TicketNumber:'TEST-100'}]:[]};}
  }
  const db={sql:{Request,NVarChar:()=>'',Int:'',BigInt:'',MAX:''},withTransaction:async handler=>handler({})};
  const context = vm.createContext({module:{exports:{}},require:name=>name==='./db'?db:name==='../ticket-access'?access:require(path.join(__dirname,'..','server',name)),console});
  vm.runInContext(source('server/ticketService.js'),context);
  return {service:context.module.exports,requests};
}
const body={department:'Helpdesk',priority:'Medium',category:'Other',registration:'TEST',description:'Fixture',requester_name:'Fixture user'};
test('Express creation ignores forged role/group fields and preserves the authenticated creator', async () => {
  for (const [type,expected] of [[12,'IBLS'],[13,'CRM'],[8,'Internal']]) {
    const h=serviceHarness({Seqno:42,Usertype:type});
    const result=await h.service.createTicket({body:{...body,user_type:8,requesterGroup:type===12?'Internal':'IBLS'},sessionId:'fixture'});
    assert.equal(result.success,true);
    const inserted=h.requests.find(r=>r.queryText.includes('INSERT INTO CC.dbo.tkt_InternalTickets'));
    assert.equal(inserted.inputs.requesterGroup,expected);
    assert.equal(inserted.inputs.requestedByUserId,42);
  }
});
test('Express limits IBLS creation to Helpdesk and rejects unresolved users and alternate public creation', async () => {
  const h=serviceHarness({Seqno:42,Usertype:12});
  await assert.rejects(h.service.createTicket({body:{...body,department:'Software'},sessionId:'fixture'}),/Software tickets/);
  for (const department of ['Pulscam','TAD']) {
    await assert.rejects(h.service.createTicket({body:{...body,department,user_type:7},sessionId:'fixture'}),/IBLS users can only create Helpdesk tickets/);
  }
  await assert.rejects(h.service.createPublicTicket({body,sessionId:'fixture'}),/signed-in ticket form/);
  await assert.rejects(serviceHarness(null).service.createTicket({body,sessionId:'fixture'}),/could not be matched/);
  await assert.rejects(serviceHarness({Seqno:42,Usertype:null}).service.createTicket({body,sessionId:'fixture'}),/user type could not be resolved/);
  assert.equal(h.requests.filter(r=>r.queryText.includes('INSERT INTO')).length,0);
});

test('CRM and staff retain Pulscam ticket creation', async () => {
  for (const type of [13,7,8]) {
    const h=serviceHarness({Seqno:42,Usertype:type});
    assert.equal((await h.service.createTicket({body:{...body,department:'Pulscam'},sessionId:'fixture'})).success,true);
    assert.equal(h.requests.find(r=>r.queryText.includes('INSERT INTO CC.dbo.tkt_InternalTickets')).inputs.department,'Pulscam');
  }
});

test('IBLS form and department filter offer only Helpdesk while other roles retain their options', () => {
  for (const [role,formValues,filterValues] of [
    [12,['Helpdesk'],['','Helpdesk']],
    [13,['','Helpdesk','Pulscam'],['','Helpdesk','Pulscam','TAD']],
    [7,['','Helpdesk','Pulscam','Software'],['','Helpdesk','CC','Pulscam','TAD','Software']]
  ]) {
    const h=frontend({userId:42,user_type:role});
    const department={value:'Pulscam'}, category={value:''}, filterDepartment={value:''};
    h.context.form={elements:{department,category}};
    h.context.filters={elements:{department:filterDepartment}};
    vm.runInContext('elements.form=form; elements.filters=filters; syncTicketDepartmentOptions(); renderDepartmentOptions();',h.context);
    const values=select=>Array.from(select.innerHTML.matchAll(/<option value="([^"]*)"/g),match=>match[1]);
    assert.deepEqual(values(department),formValues);
    assert.deepEqual(values(filterDepartment),filterValues);
    assert.equal(department.value,role===12?'Helpdesk':'Pulscam');
    assert.match(department.innerHTML,/<option value="Helpdesk" selected>/);
  }
});

test('SQLPage validates IBLS Helpdesk creation and returns only its permitted department option', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const validation=source('create_ticket.sql').match(/SET error_code = (CASE[\s\S]*?\nEND);/)[1];
    const query=db.prepare(`SELECT ${validation} AS error`);
    const vars={$ticket_user_id:42,$ticket_user_type:12,$department_value:'Helpdesk',$priority_value:'Medium',
      $category_value:'Other',$registration_value:'TEST',$description_value:'Fixture',$client_callback_value:0,$client_name_value:'',$client_contact_value:''};
    assert.equal(query.get(vars).error,null);
    for (const department of ['Pulscam','TAD']) assert.equal(query.get({...vars,$department_value:department}).error,'ibls_department_denied');
    assert.equal(query.get({...vars,$ticket_user_type:13,$department_value:'Pulscam'}).error,null);
    assert.equal(query.get({...vars,$ticket_user_type:null}).error,'user_not_found');
    db.exec("CREATE TABLE departments (value TEXT, label TEXT); INSERT INTO departments VALUES ('Helpdesk','Helpdesk'),('CC','Call Centre'),('Pulscam','Pulscam'),('TAD','TAD'),('Software','Software');");
    const filter=source('api_tickets.sql').match(/SELECT v\.\[value\], v\.\[label\][\s\S]*?WHERE ([\s\S]*?)\n\s*FOR JSON PATH/)[1];
    const departments=db.prepare(`SELECT v.value FROM departments v WHERE ${filter}`);
    assert.deepEqual(departments.all({$ticket_user_type:12,$software_access_allowed:0,$ticket_is_requester:1}).map(row=>row.value),['Helpdesk']);
    assert.deepEqual(departments.all({$ticket_user_type:13,$software_access_allowed:0,$ticket_is_requester:1}).map(row=>row.value),['Helpdesk','Pulscam','TAD']);
  } finally { db.close(); }
});
test('CRM detail view is read-only and CRM creation cannot bypass Software or public form restrictions', async () => {
  const html=frontend({userId:30,user_type:13}).render({ticketId:7,ticketNumber:'CRM-7',department:'Helpdesk',requesterGroup:'CRM',status:'Open',priority:'Medium',canManage:false});
  assert.match(html, /requester-ticket-badge">CRM/);
  assert.match(html, /Conversation/);
  assert.doesNotMatch(html, /id="commentForm"|assign-self|save-department|edit-zoho-ticket/);
  const h=serviceHarness({Seqno:30,Usertype:13});
  await assert.rejects(h.service.createTicket({body:{...body,department:'Software'},sessionId:'fixture'}),/Software tickets/);
  await assert.rejects(h.service.createPublicTicket({body,sessionId:'fixture'}),/signed-in ticket form/);
  assert.equal(h.requests.filter(r=>r.queryText.includes('INSERT INTO')).length,0);
});
test('staff can manage CRM tickets without offering Software routing', () => {
  const h=frontend({userId:42,user_type:7});
  const html=h.render({ticketId:7,department:'Helpdesk',requesterGroup:'CRM',status:'Open',priority:'Medium',canManage:true});
  assert.match(html,/id="commentForm"/);
  assert.doesNotMatch(html,/<option value="Software"/);
  assert.match(source('update_department.sql'), /RequesterGroup IN \('IBLS', 'CRM'\)/);
});

test('Infinity is labelled in normal ticket list and detail views and staff retain routing controls', () => {
  const h = frontend({userId: 42, user_type: 1});
  const html = h.render({ticketId: 10, ticketNumber: 'TEST-10', department: 'Helpdesk',
    requesterGroup: 'Infinity', status: 'Open', priority: 'Medium', canManage: true});
  assert.match(html, /requester-ticket-badge">Infinity/);
  assert.match(html, /id="commentForm"/);
  assert.match(html, /save-department/);
  assert.match(source('index.html'), /<option value="Infinity">Infinity<\/option>/);
  assert.equal(vm.runInContext('requesterTicketBadge("Infinity")', h.context).includes('Infinity'), true);
});

test('Infinity detail shows submitter, registration and callback fields in the existing staff view', () => {
  const h = frontend({userId: 42, user_type: 1});
  const html = h.render({ticketId: 10, ticketNumber: 'TEST-10', department: 'Helpdesk', requesterGroup: 'Infinity',
    status: 'Open', priority: 'High', category: 'Event follow up', canManage: true,
    createdBy: 'Infinity fixture submitter', registration: 'API-TEST', clientName: 'Fixture client',
    clientContact: '0000000000', clientCallbackRequired: true, clientContacted: false});
  for (const text of ['Infinity fixture submitter', 'API-TEST', 'Fixture client', '0000000000', 'Event follow up']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /priority-high/);
});
for (const [role, group] of [[12,'IBLS'],[13,'CRM']]) {
test(`${group} navigation includes Settings and shared tickets while hiding staff modules`, () => {
  const h=frontend({userId:30,user_type:role});
  const title={}, completed={}, staffFilter={};
  const sections=['tickets','jobcards','escalations','dispatch','settings'].map(group=>({dataset:{sidebarGroup:group}}));
  const links=['active','closed','helpdesk','logout','schedule','pause'].map(view=>({
    dataset:{navFilter:view,...(view==='logout'?{requesterAllowed:'true'}:{})},
    getAttribute:()=>view==='logout'?'/signin.sql':'index.html'
  }));
  h.context.document.body={classList:{toggle(){}}};
  h.context.document.querySelector=selector=>selector==='.page-title h1'?title:completed;
  h.context.document.querySelectorAll=selector=>selector==='.app-sidebar .nav-section'?sections:selector==='.app-sidebar a'?links:[staffFilter];
  vm.runInContext('syncRequesterAccess()',h.context);
  assert.equal(title.textContent,`${group} Active Tickets`);
  assert.equal(completed.textContent,'Completed Tickets');
  assert.equal(staffFilter.hidden,true);
  assert.deepEqual(sections.map(s=>s.hidden),[false,true,true,true,false]);
  assert.deepEqual(links.map(link=>link.hidden),[false,false,true,false,true,true]);
  assert.match(source('index.html'), /href="\/signin.sql" data-requester-allowed="true"/);
  assert.match(source('index.html'), /id="themeToggle"/);
  assert.equal(vm.runInContext('canViewJobcards()',h.context),false);
  assert.equal(vm.runInContext('canViewDispatchLink()',h.context),false);
  assert.equal(vm.runInContext('canViewDashboard()',h.context),false);
  assert.equal(vm.runInContext('canViewQuickLogs()',h.context),false);
  h.context.location.search='?status=Closed';
  vm.runInContext('syncRequesterAccess()',h.context);
  assert.equal(title.textContent,`${group} Completed Tickets`);
});
}
test('anonymous public submissions remain Internal even when IBLS fields are supplied', async () => {
  const h=serviceHarness(null);
  await h.service.createPublicTicket({body:{...body,requesterGroup:'IBLS',user_type:12}});
  const inserted=h.requests.find(r=>r.queryText.includes('INSERT INTO CC.dbo.tkt_InternalTickets'));
  assert.equal(inserted.inputs.requesterGroup,'Internal');
  assert.equal(inserted.inputs.requestedByUserId,null);
});
