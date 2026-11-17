const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const drafts=require('../quick-log-drafts.js');
function harness(completed=false){
 const opened=[];
 const context=vm.createContext({console,URLSearchParams,window:{QuickLogDrafts:drafts,matchMedia:()=>({matches:false,addEventListener(){}}),open:(...args)=>opened.push(args)},document:{body:{dataset:{quickLogView:completed?'completed':''}},querySelector:()=>null,addEventListener(){}},setTimeout,clearTimeout});
 let source=fs.readFileSync(path.join(__dirname,'../quick_logs.js'),'utf8');source=source.slice(0,source.lastIndexOf('\nsyncThemeToggle();'));
 vm.runInContext(source,context);vm.runInContext("state.openQuickLogs=[{listKey:'123',caseId:123,regNo:'TEST & 1',eventName:'Door / event'}];",context);
 return {context,opened,run:expr=>vm.runInContext(expr,context)};
}
test('each open-log row activation opens a distinct new tab with its original context',async()=>{
 const h=harness();await h.run("openQuickLogFromHistory('123')");await h.run("openQuickLogFromHistory('123')");
 assert.equal(h.opened.length,2);
 for(const [target,name,features] of h.opened){const url=new URL(target,'http://localhost');assert.equal(name,'_blank');assert.equal(features,'noopener,noreferrer');assert.equal(url.searchParams.get('seqno'),'123');assert.equal(url.searchParams.get('event'),'Door / event');assert.equal(url.searchParams.has('completed'),false);}
 await h.run("openQuickLogFromHistory('missing')");assert.equal(h.opened.length,2);
});
test('completed log rows open the read-only completed view in a new tab',async()=>{
 const h=harness(true);h.run("state.openQuickLogs[0].zohoOb='994119';");await h.run("openQuickLogFromHistory('123')");
 assert.equal(h.opened.length,1);assert.equal(new URL(h.opened[0][0],'http://localhost').searchParams.get('completed'),'1');
 assert.equal(new URL(h.opened[0][0],'http://localhost').searchParams.get('seqno'),'123');
});

test('completed OB filtering uses the Zoho reference instead of the internal case ID',()=>{
 const h=harness(true);h.run("state.openQuickLogs=[{caseId:412569,zohoOb:' 994119 '},{caseId:994119,zohoOb:'796327'},{caseId:412570}];state.quickLogFilters={zohoOb:'994119'};");
 assert.equal(h.run('JSON.stringify(filteredOpenQuickLogs().map(log=>log.caseId))'),'[412569]');
 h.run("state.quickLogFilters={zohoOb:'412569'};");assert.equal(h.run('filteredOpenQuickLogs().length'),0);
 h.run("state.quickLogFilters={zohoOb:'796'};");assert.equal(h.run('JSON.stringify(filteredOpenQuickLogs().map(log=>log.caseId))'),'[994119]');
});

test('a completed case browser draft does not reappear in the open list or its counts',async()=>{
 const h=harness();const badge={};const summary={};const list={};
 const key=drafts.prefix+JSON.stringify(['CM62WJZN','Panic On','412495','operator1']);
 const raw=JSON.stringify({version:1,rows:[{comments:'Preserved edits'}]});
 const storage={length:1,key:()=>key,getItem:k=>k===key?raw:null};
 h.context.localStorage=storage;h.context.sessionStorage={length:0};
 h.context.document.querySelector=()=>badge;
 h.context.summary=summary;h.context.list=list;
 h.context.fetch=async()=>({ok:true,text:async()=>JSON.stringify({authorized:true,operator:{username:'operator1'},totalOpenCount:0,openCaseIds:[],logs:[]})});
 h.run('elements.quickLogHistoryCount=summary;elements.quickLogHistoryList=list;');
 await h.run('loadOpenQuickLogs()');
 assert.equal(h.run('state.openQuickLogs.length'),0);assert.equal(h.run('state.browserDrafts.length'),0);
 assert.equal(badge.textContent,'0');assert.equal(summary.textContent,'0 open · 0 drafts');
 assert.match(list.innerHTML,/No open quick logs/);assert.equal(storage.getItem(key),raw);
});

test('standalone drafts reopen their own editor with account context and only appear for their owner',async()=>{
 const h=harness();
 const key=drafts.prefix+JSON.stringify(['PREVIEW','Quick Log','new','operator1']);
 const raw=JSON.stringify({version:1,editor:'standalone',zohoId:'account-1',zohoAccount:'Preview account',rows:[{comments:'Preserved draft'}]});
 const storage={length:1,key:()=>key,getItem:k=>k===key?raw:null};
 const [draft]=drafts.collect(storage,{username:'operator1'});
 assert.equal(draft.zohoId,'account-1');assert.equal(draft.zohoAccount,'Preview account');
 assert.equal(drafts.collect(storage,{username:'someone-else'}).length,0);
 h.context.draft=draft;h.run('state.openQuickLogs=[draft];');
 await h.run('openQuickLogFromHistory(draft.listKey)');
 const target=new URL(h.opened[0][0],'http://localhost');
 assert.equal(target.pathname,'/internaltickets/quick_logs.html');assert.equal(target.searchParams.get('draft'),key);
});

test('table communications preserve seconds and their visible order in the submission payload',()=>{
 const h=harness();
 const values=[{comm_type:'Call Made',datetime_comm:'2026-11-16T12:25:37',comments:'First'}, {comm_type:'Call Received',datetime_comm:'2026-11-16T12:26',comments:'Second'}];
 h.context.rows=values.map(row=>({querySelector:selector=>({value:row[selector.match(/data-field='([^']+)'/)[1]]||''})}));
 h.run('elements.logCommunicationRows={querySelectorAll:()=>rows};');
 const result=JSON.parse(h.run('JSON.stringify(collectLogCommunicationRows())'));
 assert.deepEqual(result.map(row=>row.datetime_comm),['2026-11-16 12:25:37','2026-11-16 12:26:00']);
 assert.deepEqual(result.map(row=>row.comments),['First','Second']);
});

function categoryFormHarness(category='Unlimp Vehicle', saved=new Map()) {
 const h=harness();
 h.context.FormData=FormData;
 h.context.crypto=require('node:crypto').webcrypto;
 h.context.QuickLogPolicy=require('../../CC_Escalation/quick_log_policy.js');
 h.context.localStorage={get length(){return saved.size;},key:index=>[...saved.keys()][index]??null,getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 h.context.fields={comm_type:'Call Made',datetime_comm:'2026-11-16T12:25:37',comments:'Synthetic communication'};
 h.context.formNodes=Object.fromEntries(['Reg','Category','CaseId','ZohoSearch','Zoho','Seat','Close','Message','DraftStatus','Summary','Form','Rows','Submit','DialogClose','AccountHint'].map(name=>[name,{value:'',textContent:'',dataset:{},hidden:true,focus(){this.focused=true;}}]));
 h.context.formNodes.Reg.value='PREVIEW';h.context.formNodes.Category.value=category;h.context.formNodes.ZohoSearch.value='Preview account';h.context.formNodes.Seat.value='1';h.context.formNodes.Close.type='hidden';
 h.context.formNodes.Form.checkValidity=()=>true;h.context.formNodes.Form.classList={add(){},remove(){}};
 h.context.formNodes.Form.querySelectorAll=()=>['Reg','Category','ZohoSearch','Seat','Submit'].map(key=>h.context.formNodes[key]);
 h.context.formNodes.Rows.querySelectorAll=()=>[{querySelector:selector=>({value:h.context.fields[selector.match(/data-field='([^']+)'/)[1]]||''})}];
 h.run("for(const [key,node] of Object.entries(formNodes)) elements['logCommunication'+key]=node;state.currentUser={username:'operator1'};state.communicationOptions={authorized:true,submissionEnabled:true,accountSelectionEnabled:true,csrfToken:'fixture-csrf',seats:[{value:'1',label:'Risk'}]};state.logCommunicationZohoOptions=[{value:'account-1',label:'Preview account'}];loadOpenQuickLogs=async()=>{};const realBuildLogCommunicationZohoOptions=buildLogCommunicationZohoOptions;buildLogCommunicationZohoOptions=()=>{};clearLogCommunicationForm=()=>{communicationDraftKey=null;communicationDraftRaw=null;communicationSubmissionId=null;communicationSubmissionProtocol=null;communicationAttemptFingerprint=null;};");
 return {...h,saved,nodes:h.context.formNodes};
}

test('selected categories survive draft saving and restoration, and appear in the draft list',()=>{
 const h=categoryFormHarness('Main Gate Tailgating - Lytehouse');
 h.run('saveCommunicationDraft()');
 assert.equal(h.saved.size,1);
 const [key,raw]=[...h.saved][0];
 assert.equal(JSON.parse(raw).category,'Main Gate Tailgating - Lytehouse');
 const [draft]=drafts.collect(h.context.localStorage,{username:'operator1'});
 assert.equal(draft.eventName,'Main Gate Tailgating - Lytehouse');
 h.context.ownedDraft=draft;h.context.restored=[];
 h.run("state.browserDrafts=[ownedDraft];addLogCommunicationRow=row=>restored.push(row);populateLogCommunicationSeats=value=>elements.logCommunicationSeat.value=value;");
 h.nodes.Category.value='';h.context.draftKey=key;h.run('restoreCommunicationDraft(draftKey)');
 assert.equal(h.nodes.Category.value,'Main Gate Tailgating - Lytehouse');
 assert.equal(h.context.restored[0].comments,'Synthetic communication');
 // Editing a category moves this draft without losing its communication rows.
 h.nodes.Category.value='Canopy Unlock';h.run('saveCommunicationDraft()');
 assert.equal(h.saved.size,1);assert.equal(h.saved.has(key),false);
 assert.equal(JSON.parse([...h.saved.values()][0]).category,'Canopy Unlock');
});

test('a missing category blocks submission; a selected category is sent with the ordered communication payload',async()=>{
 const h=categoryFormHarness('');let requests=0,body;
 h.context.fetch=async(url,options)=>{requests++;body=options.body;return queuedCommunication(body);};
 await h.run('submitLogCommunication({preventDefault(){}})');
 assert.equal(requests,0);assert.equal(h.nodes.Category.focused,true);
 h.nodes.Category.value='WHS Camera Health Check - Hikvision';
 await h.run('submitLogCommunication({preventDefault(){}})');
 assert.equal(requests,1);assert.equal(body.get('category'),'WHS Camera Health Check - Hikvision');
 assert.equal(body.get('close_case'),'1');assert.equal(JSON.parse(body.get('comments_json'))[0].comments,'Synthetic communication');
 assert.equal(body.get('event'),'WHS Camera Health Check - Hikvision');assert.equal(body.get('zoho_account_id'),'account-1');assert.equal(body.has('zoho_id'),false);
 assert.equal(body.get('account_context_version'),'1');
 assert.equal(body.get('csrf_token'),'fixture-csrf');assert.match(h.nodes.Message.textContent,/queued for Zoho.*confirmation is pending/);
 assert.equal(h.saved.size,0);
});

function queuedCommunication(body) {
 return {ok:true,text:async()=>JSON.stringify({success:true,caseId:123,insertedComments:JSON.parse(body.get('comments_json')).length,submissionId:body.get('submission_id')})};
}

test('a lost response preserves an immutable draft and retries the same submission ID and payload',async()=>{
 const h=categoryFormHarness(),requests=[];
 h.context.fetch=async(url,options)=>{requests.push(options.body);if(requests.length===1)throw Error('Connection lost');return queuedCommunication(options.body);};
 await h.run('submitLogCommunication({preventDefault(){}})');
 assert.equal(h.saved.size,1);assert.equal(h.nodes.Seat.disabled,true);assert.equal(h.nodes.Submit.disabled,false);assert.equal(h.nodes.Submit.textContent,'Retry submission');
 const saved=JSON.parse([...h.saved.values()][0]);assert.ok(saved.submissionId);assert.ok(saved.attemptFingerprint);
 await h.run('submitLogCommunication({preventDefault(){}})');
 assert.equal(requests.length,2);assert.equal(requests[0].get('submission_id'),requests[1].get('submission_id'));assert.equal(requests[0].get('comments_json'),requests[1].get('comments_json'));assert.equal(h.saved.size,0);
});

test('a pending request survives reopening in another tab and a temporary authentication rejection',async()=>{
 const first=categoryFormHarness();let originalId;
 first.context.fetch=async(url,options)=>{originalId=options.body.get('submission_id');throw Error('Connection lost');};
 await first.run('submitLogCommunication({preventDefault(){}})');
 const h=categoryFormHarness('Unlimp Vehicle',first.saved),draft=drafts.collect(h.context.localStorage,{username:'operator1'})[0];
 h.context.ownedDraft=draft;h.context.key=draft.listKey;
 h.run("state.browserDrafts=[ownedDraft];addLogCommunicationRow=()=>{};populateLogCommunicationSeats=value=>elements.logCommunicationSeat.value=value;restoreCommunicationDraft(key);");
 let requests=0;
 h.context.fetch=async(url,options)=>{requests++;assert.equal(options.body.get('submission_id'),originalId);return requests===1?{ok:false,text:async()=>JSON.stringify({success:false,status:'unauthorized',message:'Sign in again'})}:queuedCommunication(options.body);};
 await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(h.run('communicationSubmissionId'),originalId);assert.equal(h.nodes.Seat.disabled,true);
 await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(requests,2);assert.equal(h.saved.size,0);
});

test('unexpected confirmations retain the request and altered retries cannot send a new payload',async()=>{
 const h=categoryFormHarness();let calls=0;
 h.context.fetch=async(url,options)=>{calls++;return calls===1?{ok:true,text:async()=>JSON.stringify({success:true,caseId:123,insertedComments:0,submissionId:options.body.get('submission_id')})}:queuedCommunication(options.body);};
 await h.run('submitLogCommunication({preventDefault(){}})');
 const originalId=h.run('communicationSubmissionId');assert.ok(originalId);assert.equal(h.saved.size,1);
 h.context.fields.comments='Altered after an unconfirmed submission';
 await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(calls,1);assert.equal(h.run('communicationSubmissionId'),originalId);
 h.context.fields.comments='Synthetic communication';
 await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(calls,2);assert.equal(h.saved.size,0);
});

test('validation, unavailable submission and failed browser storage never send a POST',async()=>{
 for(const setup of [h=>{h.context.fields.contact_no='not a number';},h=>h.run('state.communicationOptions.submissionEnabled=false;'),h=>h.run('state.communicationOptions.accountSelectionEnabled=false;'),h=>{h.context.localStorage.setItem=()=>{throw Error('Storage blocked');};}]) {
  const h=categoryFormHarness();let calls=0;h.context.fetch=async()=>{calls++;};setup(h);
  await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(calls,0);assert.equal(h.nodes.Seat.disabled,false);assert.equal(h.run('communicationAttemptFingerprint'),null);
 }
});

test('a definite account rejection keeps the draft editable and successful submission preserves a newer shared draft',async()=>{
 const rejected=categoryFormHarness();rejected.context.fetch=async()=>({ok:true,text:async()=>JSON.stringify({success:false,status:'invalid_account',definitelyNotSaved:true,message:'Select a valid account'})});
 await rejected.run('submitLogCommunication({preventDefault(){}})');assert.equal(rejected.saved.size,1);assert.equal(rejected.run('communicationAttemptFingerprint'),null);assert.equal(rejected.nodes.Seat.disabled,false);
 const h=categoryFormHarness();let release,calls=0;
 const pending=new Promise(resolve=>release=resolve);h.context.fetch=async(url,options)=>{calls++;await pending;return queuedCommunication(options.body);};
 const submitting=h.run('submitLogCommunication({preventDefault(){}})');await Promise.resolve();
 const [key,raw]=[...h.saved][0],newer=JSON.stringify({...JSON.parse(raw),savedAt:'2026-11-16T16:00:00Z',rows:[{comments:'Newer shared draft'}]});h.saved.set(key,newer);
 await h.run('submitLogCommunication({preventDefault(){}})');release();await submitting;assert.equal(calls,1);assert.equal(h.saved.get(key),newer);
});

function accountLookupHarness() {
 const h=categoryFormHarness();
 h.nodes.ZohoSearch.value='';h.nodes.Zoho.value='';
 h.run("buildLogCommunicationZohoOptions=realBuildLogCommunicationZohoOptions;state.rows=[{zohoId:'account-1',zohoAccount:'Preview account'},{zohoId:'account-2',zohoAccount:'Manual account'}];buildLogCommunicationZohoOptions();");
 h.lookup=()=>h.run("lookupCommunicationAccount(formNodes.Reg.value.trim().toUpperCase(),communicationAccountLookupVersion,communicationAccountChoiceVersion)");
 return h;
}

test('registration lookup fills a mapped account while operators can select a different account',async()=>{
 const h=accountLookupHarness();
 h.context.fetch=async()=>({ok:true,text:async()=>JSON.stringify({authorized:true,mappingCount:1,account:{value:'account-1',label:'Preview account'}})});
 await h.lookup();assert.equal(h.nodes.Zoho.value,'account-1');assert.match(h.nodes.AccountHint.textContent,/different account/);
 h.run("selectLogCommunicationZohoOption({value:'account-2',label:'Manual account'})");
 assert.equal(h.nodes.Zoho.value,'account-2');h.run('saveCommunicationDraft()');assert.equal(JSON.parse([...h.saved.values()][0]).zohoId,'account-2');
 h.context.fetch=async(url,options)=>{assert.equal(options.body.get('zoho_account_id'),'account-2');return queuedCommunication(options.body);};
 await h.run('submitLogCommunication({preventDefault(){}})');assert.equal(h.saved.size,0);
});

test('an account chosen before entering registration is not replaced by an automatic lookup',async()=>{
 const h=accountLookupHarness();let calls=0;h.context.fetch=async()=>{calls++;};
 h.run("selectLogCommunicationZohoOption({value:'account-2',label:'Manual account'})");
 h.nodes.Reg.value='MAPPED-REG';await h.lookup();assert.equal(calls,0);assert.equal(h.nodes.Zoho.value,'account-2');
});

test('unmapped, ambiguous and unavailable registration lookups keep manual account selection available',async()=>{
 for(const count of [0,2,'offline']) {
  const h=accountLookupHarness();h.nodes.Reg.value='UNMAPPED';h.nodes.ZohoSearch.value='';h.nodes.Zoho.value='';
  h.context.fetch=async()=>{if(count==='offline')throw Error('Unavailable');return {ok:true,text:async()=>JSON.stringify({authorized:true,mappingCount:count})};};
  await h.lookup();assert.equal(h.nodes.Zoho.value,'');assert.match(h.nodes.AccountHint.textContent,/Select|select/);
  h.run("selectLogCommunicationZohoOption({value:'account-2',label:'Manual account'})");
  h.context.fetch=async(url,options)=>{assert.equal(options.body.get('reg_no'),'UNMAPPED');assert.equal(options.body.get('zoho_account_id'),'account-2');return queuedCommunication(options.body);};
  await h.run('submitLogCommunication({preventDefault(){}})');assert.match(h.nodes.Message.textContent,/queued for Zoho/);
 }
});

test('late lookup results cannot replace a manual choice or apply to an older registration',async()=>{
 for(const action of ['manual','registration']) {
  const h=accountLookupHarness();let release;const pending=new Promise(resolve=>release=resolve);
  h.context.fetch=async()=>{await pending;return {ok:true,text:async()=>JSON.stringify({authorized:true,mappingCount:1,account:{value:'account-1',label:'Preview account'}})};};
  const lookup=h.lookup();
  if(action==='manual')h.run("selectLogCommunicationZohoOption({value:'account-2',label:'Manual account'})");
  else {h.nodes.Reg.value='NEW-REG';h.nodes.ZohoSearch.value='';h.nodes.Zoho.value='';h.run('communicationAccountLookupVersion++');}
  release();await lookup;assert.equal(h.nodes.Zoho.value,action==='manual'?'account-2':'');
 }
});

test('changing registration clears a previous automatic suggestion while preserving manual choices',async()=>{
 const h=accountLookupHarness();h.context.setTimeout=()=>0;
 h.context.fetch=async()=>({ok:true,text:async()=>JSON.stringify({authorized:true,mappingCount:1,account:{value:'account-1',label:'Preview account'}})});
 await h.lookup();assert.equal(h.nodes.Zoho.value,'account-1');
 h.nodes.Reg.value='UNMAPPED';h.run('scheduleCommunicationAccountLookup()');assert.equal(h.nodes.Zoho.value,'');
 h.run("selectLogCommunicationZohoOption({value:'account-2',label:'Manual account'})");
 h.nodes.Reg.value='ANOTHER-REG';h.run('scheduleCommunicationAccountLookup()');assert.equal(h.nodes.Zoho.value,'account-2');
});

test('legacy pending drafts retain the old envelope on retry after the account protocol changes',async()=>{
 const h=categoryFormHarness();h.context.fetch=async()=>{throw Error('Lost response');};await h.run('submitLogCommunication({preventDefault(){}})');
 const [key,raw]=[...h.saved][0],legacy=JSON.parse(raw);delete legacy.submissionProtocol;h.saved.set(key,JSON.stringify(legacy));
 const reopened=categoryFormHarness('Unlimp Vehicle',h.saved);reopened.context.ownedDraft=drafts.collect(reopened.context.localStorage,{username:'operator1'})[0];reopened.context.key=key;
 reopened.run("state.browserDrafts=[ownedDraft];state.communicationOptions.accountSelectionEnabled=false;addLogCommunicationRow=()=>{};populateLogCommunicationSeats=value=>elements.logCommunicationSeat.value=value;restoreCommunicationDraft(key);");
 reopened.context.fetch=async(url,options)=>{assert.equal(options.body.get('account_context_version'),'');assert.equal(options.body.get('submission_id'),legacy.submissionId);return queuedCommunication(options.body);};
 await reopened.run('submitLogCommunication({preventDefault(){}})');assert.equal(h.saved.size,0);
});

function categorySearchHarness(category='Unlimp Vehicle') {
 const h=categoryFormHarness(category);
 const html=fs.readFileSync(path.join(__dirname,'../quick_logs.html'),'utf8');
 const markup=html.match(/<select id="logCommunicationCategory"[^>]*>([\s\S]*?)<\/select>/)[1];
 h.nodes.Category.options=[...markup.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(match=>({value:match[1],label:match[2]}));
 for(const name of ['CategoryTrigger','CategoryValue','CategoryMenu','CategorySearch','CategoryOptions','CategoryEmpty']) {
  const attributes=new Map();
  h.nodes[name]={value:'',textContent:'',hidden:true,innerHTML:'',focus(){this.focused=true;},setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),attributes};
 }
 h.nodes.CategoryOptions.querySelector=()=>({scrollIntoView(){}});
 h.run("for(const [key,node] of Object.entries(formNodes)) elements['logCommunication'+key]=node;");
 return h;
}

test('category search filters all 22 options without changing the selected category, including empty results',()=>{
 const h=categorySearchHarness();
 h.run('openCommunicationCategoryMenu()');
 assert.equal(h.run('filteredCommunicationCategories().length'),22);
 assert.equal(h.nodes.CategorySearch.focused,true);
 assert.equal(h.nodes.CategoryTrigger.attributes.get('aria-expanded'),'true');
 h.nodes.CategorySearch.value='  LYtEhouse ';
 assert.equal(h.run('filteredCommunicationCategories().length'),5);
 h.nodes.CategorySearch.value='Cargo DOOR';
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(filteredCommunicationCategories().map(option=>option.value))')),['Cargo Door Lock','Cargo Door Unlock']);
 h.nodes.CategorySearch.value='no matching category';h.run('renderCommunicationCategoryOptions()');
 assert.equal(h.nodes.CategoryEmpty.hidden,false);
 assert.equal(h.nodes.CategorySearch.attributes.has('aria-activedescendant'),false);
 h.run("communicationCategorySearchKeydown({key:'Enter',preventDefault(){}})");
 assert.equal(h.nodes.Category.value,'Unlimp Vehicle');
});

test('keyboard category selection updates the saved value and label; Escape keeps the selection',()=>{
 const h=categorySearchHarness();
 h.run('openCommunicationCategoryMenu()');
 h.nodes.CategorySearch.value='Cargo';h.run('renderCommunicationCategoryOptions()');
 h.run("communicationCategorySearchKeydown({key:'ArrowDown',preventDefault(){}});communicationCategorySearchKeydown({key:'Enter',preventDefault(){}})");
 assert.equal(h.nodes.Category.value,'Cargo Door Unlock');assert.equal(h.nodes.CategoryValue.textContent,'Cargo Door Unlock');
 assert.equal(h.nodes.CategoryMenu.hidden,true);assert.equal(h.nodes.CategoryTrigger.focused,true);
 h.run('saveCommunicationDraft()');assert.equal(JSON.parse([...h.saved.values()][0]).category,'Cargo Door Unlock');
 h.run('openCommunicationCategoryMenu()');h.nodes.CategorySearch.value='Canopy';h.run('renderCommunicationCategoryOptions()');
 h.run("communicationCategorySearchKeydown({key:'Escape',preventDefault(){},stopPropagation(){}})");
 assert.equal(h.nodes.Category.value,'Cargo Door Unlock');assert.equal(h.nodes.CategoryMenu.hidden,true);
 h.run("setCommunicationCategoryValue('Main Gate Tailgating - Lytehouse')");
 assert.equal(h.nodes.CategoryValue.textContent,'Main Gate Tailgating - Lytehouse');
});
