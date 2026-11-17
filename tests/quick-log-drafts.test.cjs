const test=require('node:test');
const assert=require('node:assert/strict');
const drafts=require('../quick-log-drafts.js');
function storage(initial={}) {
 const map=new Map(Object.entries(initial));
 return {get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
}
const operator={username:'operator1',name:'Operator One'};
const key=(owner='operator1',caseId='new')=>drafts.prefix+JSON.stringify(['TEST & 1','Door / event',caseId,owner]);
const raw=(overrides={})=>JSON.stringify({version:1,savedAt:'2026-10-06T12:00:00.000Z',seat:'1',rows:[{comments:'First'},{comments:'Second'}],submissionId:'unchanged-retry-id',attemptFingerprint:'unchanged-payload',...overrides});

test('completed case drafts stay in storage but are excluded from open logs',()=>{
 const shared=storage({[key('operator1','412495')]:raw(),[key()]:raw()});
 const active=drafts.forOpenLogs(drafts.collect(shared,operator),[]);
 assert.equal(active.length,1);assert.equal(active[0].caseId,'');
 assert.equal(shared.getItem(key('operator1','412495')),raw());
 assert.equal(drafts.merge([],active).length,1);
});

test('open case drafts outside the displayed page remain visible without duplicating server cases',()=>{
 const shared=storage({[key('operator1','123')]:raw(),[key('operator1','456')]:raw(),[key('operator1','789')]:raw()});
 const active=drafts.forOpenLogs(drafts.collect(shared,operator),[{caseId:123},{caseId:456}]);
 const merged=drafts.merge([{caseId:123,regNo:'TEST & 1',eventName:'Door / event'}],active);
 assert.equal(merged.length,2);assert.deepEqual(merged.map(log=>String(log.caseId)).sort(),['123','456']);
 assert.equal(active.filter(draft=>!draft.caseId).length,0);
});

test('existing tab drafts migrate with all entries and retry keys intact, and become visible in another tab',()=>{
 const original=raw({company:'Preview company'});const tab=storage({[key()]:original});const shared=storage();
 assert.deepEqual(drafts.migrate(tab,shared,operator),[]);
 assert.equal(tab.getItem(key()),null);assert.equal(shared.getItem(key()),original);
 const otherTab=storage();drafts.migrate(otherTab,shared,operator);
 const [draft]=drafts.collect(shared,operator);
 assert.equal(draft.commentCount,2);assert.equal(draft.awaitingConfirmation,true);
 assert.equal(draft.lastComment,'Second');
 assert.equal(draft.company,'Preview company');
});
test('failed migration preserves the original tab draft',()=>{
 const tab=storage({[key()]:raw()});const shared=storage();shared.setItem=()=>{throw Error('Storage blocked');};
 assert.throws(()=>drafts.migrate(tab,shared,operator));assert.equal(tab.getItem(key()),raw());
});
test('older display-name drafts migrate to the operator username without leaving a duplicate',()=>{
 const original=raw();const tab=storage({[key('Operator One')]:original});const shared=storage();
 drafts.migrate(tab,shared,operator);
 assert.equal(tab.length,0);assert.equal(shared.getItem(key()),original);assert.equal(shared.getItem(key('Operator One')),null);
 drafts.removeIfUnchanged(shared,key(),original);assert.equal(drafts.collect(shared,operator).length,0);
});
test('a conflicting shared draft is never overwritten or removed by migration',()=>{
 const tab=storage({[key()]:raw()});const newer=raw({savedAt:'2026-10-06T13:00:00Z',submissionId:'another-request'});const shared=storage({[key()]:newer});
 assert.deepEqual(drafts.migrate(tab,shared,operator),[key()]);
 assert.equal(tab.getItem(key()),raw());assert.equal(shared.getItem(key()),newer);
});
test('lists exclude other operators and malformed storage, while recognizing older full-name keys',()=>{
 const shared=storage({[key('operator2')]:raw(),[key('Operator One','123')]:raw(),[key('operator1','-1')]:raw(),[drafts.prefix+'invalid']:'{}',[key('operator1','456')]:'{"version":1,"rows":[]}'});
 const result=drafts.collect(shared,operator);assert.equal(result.length,1);assert.equal(result[0].caseId,'123');
 assert.equal(drafts.collect(shared,{username:'other',name:'Other'}).length,0);
 assert.equal(drafts.collect(shared,{}).length,0);
});
test('saved case drafts merge once, new drafts remain separate, and links preserve their exact context',()=>{
 const existing=drafts.collect(storage({[key('operator1','123')]:raw({company:'Stale draft company'})}),operator)[0];
 const fresh=drafts.collect(storage({[key()]:raw()}),operator)[0];
 const result=drafts.merge([{caseId:123,regNo:'TEST & 1',company:'Server company',eventName:'Door / event',seat:'Risk',datetimeOpened:'2026-10-01'}],[existing,fresh]);
 assert.equal(result.length,2);assert.equal(result.find(r=>r.caseId==='123').seat,'Risk');
 assert.equal(result.find(r=>r.caseId==='123').company,'Server company');
 assert.equal(fresh.company,'');
 const url=new URL(drafts.url(existing),'http://localhost');
 assert.equal(url.pathname,'/CC_Escalation/main.sql');assert.equal(url.searchParams.get('reg_no'),'TEST & 1');
 assert.equal(url.searchParams.get('event'),'Door / event');assert.equal(url.searchParams.get('seqno'),'123');assert.equal(url.searchParams.get('quick_log'),'1');
 assert.equal(new URL(drafts.url(fresh),'http://localhost').searchParams.has('seqno'),false);
});
