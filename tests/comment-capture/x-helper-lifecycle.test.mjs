import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, waitFor} from './harness.mjs';

test('X fails closed when the manager cannot coordinate recovery storage', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xSearchWindow = xSearchWindow;');
  const app=await launchApp({source,sharedStore:true,tabs:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__xSearchWindow));
    const result=await app.page.evaluate(async()=>{GM.listValues=undefined;GM.openInTab=()=>{window.__opened=true;return null};return {result:await __xSearchWindow('https://example.com/article'),opened:Boolean(window.__opened)}});
    assert.equal(result.result.status,'unavailable');
    assert.equal(result.opened,false,'a helper is not opened without a recoverable index');
    assert.equal([...app.store.values()].some(value=>value?.kind==='x-search'),false,'no article address is left in a bridge payload');
  } finally {await app.browser.close()}
});

test('the X helper index does not rewrite shared state without coordination', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__bridgeIndexTest = { indexXSearch };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__bridgeIndexTest));
    const key='HNewhere:x_helper_index';const existing=[{nonce:'11111111111111111111111111111111',ts:Date.now()-700000}];app.store.set(key,existing);
    const result=await app.page.evaluate(async()=>{GM.listValues=undefined;try{await __bridgeIndexTest.indexXSearch('22222222222222222222222222222222');return 'succeeded'}catch{return 'unavailable'}});
    assert.equal(result,'unavailable');
    assert.deepEqual(app.store.get(key),existing);
  } finally {await app.browser.close()}
});

test('an expired unindexed bridge payload is eligible for the storage sweep', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__bridgeSweepTest = staleStorageKeys;');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__bridgeSweepTest));
    const stale=await app.page.evaluate(()=>{
      const now=Date.now(),prefix='HNewhere:bridge_payload:';
      return __bridgeSweepTest(new Map([[prefix+'old',{kind:'x-search',ts:now-700000}],[prefix+'fresh',{kind:'x-search',ts:now}],[prefix+'index',[]]]),now,{migrated:true,seeded:true,collected:true});
    });
    assert(stale.includes('HNewhere:bridge_payload:old'));
    assert(!stale.includes('HNewhere:bridge_payload:fresh'));
    assert(!stale.includes('HNewhere:bridge_payload:index'));
  } finally {await app.browser.close()}
});

for (const operation of ['index', 'sweep', 'x-index']) test(`concurrent bridge ${operation} preserves a newly indexed helper`, {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`{
    const get=GM.getValue;
    GM.getValue=async (...args)=>{const value=await get(...args);if(args[0]===window.__indexKey && window.__holdBridgeIndex){window.__bridgeIndexRead=true;await new Promise(resolve=>{window.__releaseBridgeIndex=resolve});}return value};
    globalThis.__bridgeIndexTest={indexBridgePayload,sweepBridgePayloads,indexXSearch};
  }`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  const first='11111111111111111111111111111111',second='22222222222222222222222222222222';
  try {
    await app.page.goto('https://backchnnl.app/');
    const other=await app.context.newPage();await other.goto('https://backchnnl.app/');
    await Promise.all([app.page.waitForFunction(()=>Boolean(window.__bridgeIndexTest)),other.waitForFunction(()=>Boolean(window.__bridgeIndexTest))]);
    const key=operation==='x-index'?'HNewhere:x_helper_index':'HNewhere:bridge_payload:index';
    if(operation==='sweep')app.store.set(key,[{nonce:first,ts:Date.now()-700000}]);
    await app.page.evaluate(({operation,first,key})=>{window.__indexKey=key;window.__holdBridgeIndex=true;window.__indexWork=operation==='index'?__bridgeIndexTest.indexBridgePayload(first):operation==='x-index'?__bridgeIndexTest.indexXSearch(first):__bridgeIndexTest.sweepBridgePayloads()}, {operation,first,key});
    await app.page.waitForFunction(()=>window.__bridgeIndexRead===true);
    await other.evaluate(({second,operation})=>{window.__otherIndexWork=operation==='x-index'?__bridgeIndexTest.indexXSearch(second):__bridgeIndexTest.indexBridgePayload(second)},{second,operation});
    await new Promise(resolve=>setTimeout(resolve,300));
    await app.page.evaluate(()=>{window.__holdBridgeIndex=false;window.__releaseBridgeIndex()});
    await Promise.all([app.page.evaluate(()=>window.__indexWork),other.evaluate(()=>window.__otherIndexWork)]);
    const nonces=(app.store.get(key)||[]).map(entry=>entry.nonce);
    assert(nonces.includes(second),'the new helper remains in the shared index');
    if(operation!=='sweep')assert(nonces.includes(first),'the original helper also remains indexed');
    else assert(!nonces.includes(first),'the expired entry is swept');
  } finally {await app.browser.close()}
});

test('an X helper identifies itself and keeps its animated title when X changes it', {timeout:20000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, stageBridgePayload, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><head><title>Search / X</title></head><body></body></html>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    await app.page.evaluate(async nonce=>{
      const target='https://example.com/article';
      await __xHelper.stageBridgePayload(nonce,{kind:'x-search',nonce,target,query:'url:'+__xHelper.normalizeURL(target),expires:Date.now()+10000});
      window.__xHelper.dispatchXSearchWindow();
    },nonce);
    await app.page.waitForFunction(()=>/Backchannel is refreshing X/.test(document.title),null,{timeout:2000});
    const first=await app.page.title();
    await app.page.waitForFunction(title=>document.title!==title,first,{timeout:2000});
    await app.page.evaluate(()=>{document.title='Search / X'});
    await app.page.waitForFunction(()=>/Backchannel is refreshing X/.test(document.title),null,{timeout:2000});
  } finally {await app.browser.close()}
});

test('a frozen X helper is closed in the background after its search times out', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const X_SEARCH_WAIT_MS = 10000;','const X_SEARCH_WAIT_MS = 1200;');
  source=source.replace('const DISCOVER_CEILING_MS = 12000;','const DISCOVER_CEILING_MS = 3000;');
  const seam='const deadline = Date.now() + X_SEARCH_WAIT_MS - 4000;';
  assert(source.includes(seam));
  source=source.replace(seam,seam+' if (globalThis.__freezeXHelper) await new Promise(resolve => { globalThis.__resumeXHelper = resolve; });');
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'x.com') globalThis.__freezeXHelper = true; else { globalThis.__reloadXSettings = () => loadSettings(); } init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><head><title>Search / X</title></head><body></body></html>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,x:true}});
    await app.page.evaluate(()=>window.__reloadXSettings());
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.length>0,5000),'Sync opens the X helper');
    const helper=opened[0];
    await helper.waitForFunction(()=>typeof window.__resumeXHelper==='function',null,{timeout:5000});
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000),'Sync finishes even while the helper is suspended');
    assert(await waitFor(()=>helper.isClosed(),5000),'the caller removes the paused helper without selecting it');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/X tab.*open/i);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'an unsuccessful search does not add a source announcement');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count(),30,'the available source stays readable after the helper timeout');
    assert(![...app.store.values()].some(value=>value?.kind==='x-search'&&value.done),'a closed helper needs no recovery marker');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('the X helper respects reduced motion', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, stageBridgePayload, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.page.emulateMedia({reducedMotion:'reduce'});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    await app.page.evaluate(async nonce=>{const target='https://example.com/article';await __xHelper.stageBridgePayload(nonce,{kind:'x-search',nonce,target,query:'url:'+__xHelper.normalizeURL(target),expires:Date.now()+10000});__xHelper.dispatchXSearchWindow()},nonce);
    await app.page.waitForFunction(()=>document.title==='Backchannel is refreshing X — Loading search');
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await app.page.title(),'Backchannel is refreshing X — Loading search');
  } finally {await app.browser.close()}
});

test('a stalled manager self-close falls back to closing the X helper window', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    const closed=await app.page.evaluate(async nonce=>{
      const now=Date.now();await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'x-search',nonce,query:'url:'+__xHelper.normalizeURL('https://example.com/article'),ts:now,expires:now+10000,done:true});
      GM.closeTab=()=>new Promise(()=>{});window.close=()=>{window.__closed=true};
      await __xHelper.dispatchXSearchWindow();return Boolean(window.__closed);
    },nonce);
    assert.equal(closed,true);
  } finally {await app.browser.close()}
});

test('an X helper starting just after its request expires closes itself', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    const result=await app.page.evaluate(async nonce=>{
      const target='https://example.com/article',now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'x-search',nonce,target,query:'url:'+__xHelper.normalizeURL(target),ts:now-2000,expires:now-100});
      GM.closeTab=async()=>{window.__closed=true};window.close=()=>{window.__closed=true};
      await __xHelper.dispatchXSearchWindow();
      return Boolean(window.__closed);
    },nonce);
    assert.equal(result,true,'the expired helper closes without waiting for another refresh');
  } finally {await app.browser.close()}
});

test('an X helper closes when the source was disabled before it started', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:false},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    const result=await app.page.evaluate(async nonce=>{
      const target='https://example.com/article',now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'x-search',nonce,target,query:'url:'+__xHelper.normalizeURL(target),ts:now,expires:now+10000});
      GM.closeTab=async()=>{window.__closed=true};window.close=()=>{window.__closed=true};
      await __xHelper.dispatchXSearchWindow();return Boolean(window.__closed);
    },nonce);
    assert.equal(result,true);
  } finally {await app.browser.close()}
});

test('the caller closes an X helper when its self-close is unavailable', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'x.com') { GM.closeTab=async()=>{}; window.close=()=>{}; } else globalThis.__reloadXSettings=()=>loadSettings(); init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><head><title>Search / X</title></head><body><a data-testid="AppTabBar_Profile_Link"></a><h1>No results</h1></body></html>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,x:true}});
    await app.page.evaluate(()=>window.__reloadXSettings());
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.length>0,5000));
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert(await waitFor(()=>opened[0].isClosed(),3000),'the caller removes it without a foreground recovery step');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/X tab.*open|X could not finish/i);
    assert.equal([...app.store.values()].some(value=>value?.kind==='x-search' && value.done),false,'confirmed removal clears its recovery marker');
  } finally {await app.browser.close()}
});

test('a normally closed X helper leaves no recovery notice or marker', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'backchnnl.app') globalThis.__reloadXSettings=()=>loadSettings(); init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><head><title>Search / X</title></head><body><a data-testid="AppTabBar_Profile_Link"></a><h1>No results</h1></body></html>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,x:true}});
    await app.page.evaluate(()=>window.__reloadXSettings());
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.length>0,5000));
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert(await waitFor(()=>opened[0].isClosed(),3000));
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/X tab.*open|X could not finish/i);
    assert.equal([...app.store.values()].some(value=>value?.kind==='x-search' && value.done),false,'the confirmed helper leaves no recovery marker');
  } finally {await app.browser.close()}
});

test('manager closure failures stay bounded and cannot report a successful Sync',{timeout:40000},async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',`const nativeClose=GM.closeTab;window.__rejectClose=true;GM.closeTab=async(...args)=>{if(window.__rejectClose)throw new Error('Simulated manager removal failure');return nativeClose(...args)};if(location.hostname==='x.com')window.close=()=>{};else{window.__reloadXSettings=()=>loadSettings();window.__waitForSync=()=>runningSync?.promise}init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title><a data-testid="AppTabBar_Profile_Link"></a><h1>No results</h1>'}));
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().click();await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,x:true}});await app.page.evaluate(()=>window.__reloadXSettings());
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>opened.length>0&&await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',25000),'a failed manager cannot leave Sync running indefinitely');
    assert(opened.length<=2,`automatic cleanup cannot keep creating more tabs when removal is broken (${opened.length})`);
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/^Synced$/);
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert.equal(await app.page.locator('#toast .toast-action').count(),0);
    await app.page.evaluate(()=>window.__waitForSync());
    await app.page.evaluate(()=>{window.__rejectClose=false});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.every(page=>page.isClosed()),10000),'Sync removes the original helper and its previous cleanup relay once manager removal works again');
    assert.equal(app.page.isClosed(),false);
  }finally{await app.browser.close()}
});

test('an X helper leaves a different search open after navigation', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__xHelper = { dispatchXSearchWindow, stageBridgePayload, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Search / X</title>'}));
  try {
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(window.__xHelper));
    await app.page.evaluate(async nonce=>{
      const target='https://example.com/article';
      await __xHelper.stageBridgePayload(nonce,{kind:'x-search',nonce,target,query:'url:'+__xHelper.normalizeURL(target),expires:Date.now()+10000});
      GM.closeTab=async()=>{window.__closed=true};window.close=()=>{window.__closed=true};
      window.__finished=__xHelper.dispatchXSearchWindow();
    },nonce);
    await app.page.waitForFunction(()=>/Backchannel is refreshing X/.test(document.title));
    const result=await app.page.evaluate(async()=>{history.replaceState({},'','/search?q=something-else'+location.hash);document.title='New search / X';await window.__finished;return {closed:Boolean(window.__closed),title:document.title}});
    assert.equal(result.closed,false);
    assert.equal(result.title,'New search / X');
  } finally {await app.browser.close()}
});

test('repeating a cleanup result does not restart its dismissal',{timeout:15000},async()=>{
  const source=(await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8')).replace('const TOAST_BRIEF_MS = 1800;','const TOAST_BRIEF_MS = 300;').replace('init().catch(console.error);','window.__repeatXCleanupNotice=showXCleanupNotice;init().catch(console.error);');
  const app=await launchApp({source,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__repeatXCleanupNotice());
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    await new Promise(resolve=>setTimeout(resolve,180));
    await app.page.evaluate(()=>window.__repeatXCleanupNotice());
    await new Promise(resolve=>setTimeout(resolve,220));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'an identical callback cannot extend the visible result');
    await app.page.evaluate(()=>window.__repeatXCleanupNotice());
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'an identical result cannot reopen after dismissal');
  }finally{await app.browser.close()}
});
