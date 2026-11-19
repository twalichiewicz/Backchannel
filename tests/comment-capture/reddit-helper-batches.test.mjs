import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,waitFor} from './harness.mjs';

const nonce='0123456789abcdef0123456789abcdef';
const payloadKey='HNewhere:bridge_payload:'+nonce;
const resultKey='HNewhere:bridge_result:'+nonce;

async function helperApp({requests=[],status=200,identityName='fixture',settings={sources:{hn:true,reddit:true}}}={}) {
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`globalThis.__dispatchBatch = dispatchRedditReadWindow;
    globalThis.__consumeStaged = async (nonce,path) => {
      const stage=await readBridgePayload(nonce);
      const readBatch={nonce,created:stage.ts,expires:stage.expires,connected:true,sequence:stage.requests.length,pathIds:new Map(stage.requests.map(request=>[request.path,request.id]))};
      try {return {result:await fetchReddit(path,null,{listing:true,readBatch})};} catch(error) {return {status:error.feedStatus};}
    };`);
  const app=await launchApp({source,appHost:'www.reddit.com',handler:'Userscripts',sharedStore:true,settings:{...settings,updateCheck:false}});
  const fetched=[];
  let active=0,peak=0;
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/') return route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'});
    if(path==='/api/me.json') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{name:identityName}})});
    fetched.push(path);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,35));active--;
    const responseStatus=typeof status==='function'?status(path):status;
    return route.fulfill({status:responseStatus,headers:responseStatus===429?{'Retry-After':'60'}:{},contentType:'application/json',body:JSON.stringify({data:{children:[]}})}).catch(()=>{});
  });
  await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
  await app.page.waitForFunction(()=>typeof window.__dispatchBatch==='function');
  await app.page.evaluate(async ({nonce,requests})=>{
    const now=Date.now();
    await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000,requests});
    const timeout=window.setTimeout;
    window.setTimeout=(callback,delay,...args)=>delay===150?0:timeout(callback,delay,...args);
    window.close=()=>{};GM.closeTab=async()=>{};
    await window.__dispatchBatch();
  },{nonce,requests});
  return {...app,fetched,peak:()=>peak};
}

test('staged Reddit work starts after authentication and drains without polling timers', {timeout:15000}, async()=>{
  const requests=Array.from({length:7},(_,index)=>({id:index+1,path:`/r/feed${index}.json?limit=100`}));
  const app=await helperApp({requests});
  try {
    assert(await waitFor(()=>requests.every(request=>app.store.get(resultKey+':'+request.id)?.phase==='response'),1500),'all staged requests finish while polling timers never fire');
    assert.equal(app.peak(),3,'at most three requests are active');
    assert.equal(app.fetched.length,7);
  } finally {await app.browser.close()}
});

test('a staged Reddit rate limit stops the remaining queue before the caller consumes results', {timeout:15000}, async()=>{
  const requests=Array.from({length:7},(_,index)=>({id:index+1,path:`/r/feed${index}.json?limit=100`}));
  const app=await helperApp({requests,status:429});
  try {
    assert(await waitFor(()=>requests.every(request=>app.store.get(resultKey+':'+request.id)),1500),'queued work settles without a timer');
    assert(app.fetched.length<=3,'cooldown prevents additional provider requests');
    assert(app.store.get('HNewhere:reddit_poll')?.until>Date.now(),'helper stores provider cooldown immediately');
  } finally {await app.browser.close()}
});

test('a completed staged success survives a sibling cooldown without allowing new upstream work', {timeout:15000}, async()=>{
  const app=await helperApp({requests:[{id:1,path:'/r/good.json'},{id:2,path:'/r/limited.json'}],status:path=>path==='/r/limited.json'?429:200});
  try {
    assert(await waitFor(()=>app.store.get(resultKey+':1')?.response?.ok && app.store.get('HNewhere:reddit_poll')?.until>Date.now(),1500));
    const completed=await app.page.evaluate(nonce=>window.__consumeStaged(nonce,'/r/good.json'),nonce);
    const stage=app.store.get(payloadKey);
    app.store.set(payloadKey,{...stage,requests:[...stage.requests,{id:3,path:'/r/future.json'}]});
    const future=await app.page.evaluate(nonce=>window.__consumeStaged(nonce,'/r/future.json'),nonce);
    assert.deepEqual(completed.result?.json,{data:{children:[]}},'a completed provider response remains usable');
    assert.equal(future.status,'limited','the same cooldown still prevents new requests');
    assert.equal(app.fetched.length,2);
    assert(app.store.get('HNewhere:reddit_poll')?.until>Date.now(),'consuming success does not clear active cooldown');
  } finally {await app.browser.close()}
});

test('helper rejects unsafe and excess staged request IDs without fetching them', {timeout:15000}, async()=>{
  const app=await helperApp({requests:[{id:1,path:'//example.com/r/popular.json'},{id:51,path:'/r/excess.json'},{id:2,path:'/r/allowed.json'},{id:2,path:'/r/reused.json'}]});
  try {
    assert(await waitFor(()=>app.store.get(resultKey+':2')?.phase==='response',1500));
    assert.deepEqual(app.fetched,['/r/allowed.json']);
    assert.equal(app.store.get(resultKey+':1')?.error,'invalid-request');
  } finally {await app.browser.close()}
});

test('staged work waits for explicit Reddit sign-in readiness', {timeout:15000}, async()=>{
  const app=await helperApp({identityName:'',requests:[{id:1,path:'/r/popular.json'}]});
  try {
    assert(await waitFor(()=>app.store.get(resultKey)?.phase==='login',1500));
    assert.deepEqual(app.fetched,[]);
  } finally {await app.browser.close()}
});

test('a lost Reddit session pauses the remaining staged queue', {timeout:15000}, async()=>{
  const app=await helperApp({status:401,requests:Array.from({length:7},(_,index)=>({id:index+1,path:`/r/feed${index}.json`}))});
  try {
    assert(await waitFor(()=>app.store.get(resultKey+':3')?.phase==='response',1500));
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(app.fetched.length,3);
    assert.equal(app.store.has(resultKey+':4'),false);
  } finally {await app.browser.close()}
});

test('Reddit preparation stages enabled feeds and current discovery before opening and reuses IDs', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`globalThis.__prepareBatch = async (nonce) => {
    await loadSettings();
    setAppSubject({url:'https://framed.example.com/gc'});
    appState={open:{key:'framed.example.com/gc'}};
    const batch={nonce,tab:true,created:Date.now(),expires:Date.now()+10000,sequence:0};
    GM.openInTab=async()=>{globalThis.__openedStage=await readBridgePayload(nonce);await save(BRIDGE_RESULT_PREFIX+nonce,{source:REDDIT_READ_SOURCE,nonce,ts:Date.now(),phase:'ready',requestId:0});return {id:1};};
    await prepareRedditReadBatch(batch);
    const staged=await readBridgePayload(nonce);
    for(const request of staged.requests||[]) await save(BRIDGE_RESULT_PREFIX+nonce+':'+request.id,{source:REDDIT_READ_SOURCE,nonce,ts:Date.now(),phase:'response',requestId:request.id,response:{ok:true,json:{data:{children:[]}}}});
    const response=await requestRedditReadWindow('/api/info.json?url='+encodeURIComponent('https://framed.example.com/gc'),batch);
    const settings=await loadSettings();await saveSettings({sources:{...settings.sources,reddit:false}});
    const disabled=await requestRedditReadWindow('/r/popular.json?limit=100',batch);
    return {staged:globalThis.__openedStage,after:await readBridgePayload(nonce),sequence:batch.sequence,ok:response.ok,disabled:disabled.localFailure};
  };`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>typeof window.__prepareBatch==='function');
    const result=await app.page.evaluate(nonce=>window.__prepareBatch(nonce),nonce);
    assert.equal(result.staged.requests?.length,4,'one enabled feed and three independent discovery paths are staged before opening');
    assert(result.staged.requests.some(request=>request.path==='/r/popular.json?limit=100'));
    assert(!result.staged.requests.some(request=>request.path.includes('/comments/')),'metadata is authoritative before any thread request');
    assert.equal(result.after.requests.length,4,'consuming a staged path adds no duplicate');
    assert.equal(result.sequence,4);
    assert.equal(result.ok,true);
    assert.equal(result.disabled,'disabled','staged results cannot bypass a later source disable');
  } finally {await app.browser.close()}
});

test('successful Reddit data with no close acknowledgement retains actionable cleanup state', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('waitRedditReadReply(batch, "done", 2000)','waitRedditReadReply(batch, "done", 150)');
  source=source.replace('init().catch(console.error);',`globalThis.__finishBatch = async nonce => {
    const batch={nonce,connected:true,tabAttempted:true,created:Date.now(),expires:Date.now()+10000,sequence:0,users:0};
    await stageBridgePayload(nonce,{kind:'reddit-read',nonce,origin:location.origin,ts:batch.created,expires:batch.expires,requests:[]});
    await finishRedditReadBatch(batch);return {cleanupPending:!!batch.cleanupPending,closeAcknowledged:batch.closeAcknowledged,stage:await readBridgePayload(nonce)};
  };`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>typeof window.__finishBatch==='function');
    const result=await app.page.evaluate(nonce=>window.__finishBatch(nonce),nonce);
    assert.equal(result.closeAcknowledged,false);
    assert.equal(result.cleanupPending,true,'successful data does not imply helper cleanup finished');
    assert.equal(result.stage.done,true,'the nonce remains terminal so a resumed helper can close safely');
  } finally {await app.browser.close()}
});
