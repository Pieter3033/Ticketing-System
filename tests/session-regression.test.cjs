const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const access = require('../ticket-access');
const read = file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function guard() {
  const context = vm.createContext({window:{}});
  vm.runInContext(read('session_guard.js'),context);
  return context.window.InternalTicketSessionGuard;
}
test('a valid session is not treated as expired when account metadata is incomplete',()=>{
  const g = guard();
  for(const user of [{session_valid:true},{session_valid:1,userId:42},{session_valid:'1',user_type:8}]) {
    assert.equal(g.isMissingSession(user),false);
  }
  assert.equal(g.isMissingSession({session_valid:false,userId:42,username:'fixture',user_type:8}),true);
  assert.equal(g.isMissingSession({username:'fixture'}),false); // Older API response compatibility.
});
test('current-user API failures show an error and never trigger the login redirect',async()=>{
  const context = vm.createContext({window:{InternalTicketAccess:access,matchMedia:()=>({matches:false})},
    document:{querySelector:()=>null},location:{search:''},URLSearchParams,console});
  const script=read('script.js');
  vm.runInContext(script.slice(0,script.indexOf('elements.detail?.addEventListener')),context);
  const notices=[];
  context.recordNotice=(...args)=>notices.push(args);
  vm.runInContext("requestJson = async()=>{throw Error('API unavailable');}; showNotice = recordNotice; window.InternalTicketSessionGuard={isMissingSession(){throw Error('Guard must not be called on transport failure');}};",context);
  assert.equal(await vm.runInContext('loadCurrentUser()',context),false);
  assert.equal(vm.runInContext('state.currentUserLoaded',context),false);
  assert.match(notices[0][0],/Could not verify your session/);
});
test('a genuinely absent session still invokes the login guard',async()=>{
  const context = vm.createContext({window:{InternalTicketAccess:access,matchMedia:()=>({matches:false})},
    document:{querySelector:()=>null},location:{search:''},URLSearchParams,console});
  const script=read('script.js');
  vm.runInContext(script.slice(0,script.indexOf('elements.detail?.addEventListener')),context);
  let redirects=0;
  context.guard={isMissingSession:guard().isMissingSession,showMissingSession:()=>redirects++};
  vm.runInContext('requestJson=async()=>({session_valid:false});window.InternalTicketSessionGuard=guard;',context);
  assert.equal(await vm.runInContext('loadCurrentUser()',context),false);
  assert.equal(redirects,1);
});
