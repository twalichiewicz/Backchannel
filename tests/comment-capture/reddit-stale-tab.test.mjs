import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,STORIES,waitFor} from './harness.mjs';

const managerBridge=`{
  const openTab = GM.openInTab;
  const closeTab = GM.closeTab;
  GM.openInTab = async (...args) => { if (globalThis.__delayOpen) await new Promise(resolve => { globalThis.__releaseOpen = resolve; }); if (globalThis.__failNextOpen) { globalThis.__failNextOpen = false; return null; } const tab = await openTab(...args); const registered = tab ? { ...tab, id: await globalThis.__registerManagerTab(args[0]) } : tab; if (globalThis.__hangOpenAfterCreation) return new Promise(() => {}); if (globalThis.__delayOpenAfterCreation) await new Promise(resolve => { globalThis.__releaseOpenAfterCreation = resolve; }); return registered; };
  GM.closeTab = async (id) => { if (globalThis.__hangSelfClose && id == null) { globalThis.__selfCloseStarted = true; return new Promise(() => {}); } if (globalThis.__hangManagerClose && id != null) { globalThis.__managerCloseStarted = true; return new Promise(() => {}); } if (globalThis.__dropManagerClose && id != null) throw new Error('Simulated manager removal failure'); return id == null ? closeTab() : globalThis.__closeManagerTab(id); };
  globalThis.__startOwnerRead = async () => { await loadSettings(); return runRedditReadAction(async () => { globalThis.__ownerReady = true; await new Promise(() => {}); }); };
  globalThis.__startFiniteOwnerRead = async () => { await loadSettings(); try { await runRedditReadAction(async () => []); } finally { globalThis.__finiteOwnerFinished = true; } };
  globalThis.__requestOldReddit = () => requestRedditReadWindow('/r/popular.json', redditReadBatch).finally(() => { globalThis.__oldReadFinished = true; });
  globalThis.__reloadSettings = () => loadSettings();
} init().catch(console.error);`;

function freezeRedditWorker(source, resumable=true){
  const seam='if (!redditReadHelperLocation(nonce)) break;\n\t\t\t\t\tconst current = await readBridgePayload(nonce);';
  assert(source.includes(seam),'the Reddit worker loop is available');
  const pause=resumable?'await new Promise(resolve => { globalThis.__resumeRedditHelper = resolve; });':'await new Promise(() => {});';
  return source.replace(seam,`if (!redditReadHelperLocation(nonce)) break;\n\t\t\t\t\tif (globalThis.__freezeRedditHelper) ${pause}\n\t\t\t\t\tconst current = await readBridgePayload(nonce);`);
}

async function setupManager(app){
  const opened=[];const managerTabs=new Map();const blockedIds=new Set();let nextTabId=1;
  app.context.on('page',page=>opened.push(page));
  await app.context.exposeFunction('__registerManagerTab',async url=>{
    let tab;
    assert(await waitFor(()=>{tab=app.context.pages().find(page=>page.url()===url);return Boolean(tab)},5000),'manager can identify the opened tab');
    const id=nextTabId++;managerTabs.set(id,tab);return id;
  });
  await app.context.exposeFunction('__closeManagerTab',async id=>{const tab=managerTabs.get(id);if(!blockedIds.has(id)&&tab&&!tab.isClosed())await tab.close();});
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const body=path==='/'?'<title>Reddit fixture</title>':path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):JSON.stringify({data:{children:[]}});
    await route.fulfill({status:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  return {opened,managerTabs,blockedIds};
}

async function resumeHelper(helper){
  if(helper.isClosed()) return;
  try { await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function',null,{timeout:5000}); }
  catch(error){if(helper.isClosed()) return;throw error;}
  try { await helper.evaluate(()=>{window.__freezeRedditHelper=false;window.__resumeRedditHelper()}); }
  catch(error){if(helper.isClosed()) return;throw error;}
  assert(await waitFor(()=>helper.isClosed(),5000),'the helper closes itself when it resumes');
}

test('a Reader refresh retires a suspended helper left by an expired owner without selecting it', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  assert.equal((source.match(/Date\.now\(\) \+ 120000/g)||[]).length,2,'both refresh lease writes are controlled');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  const tick='const tickTitle = () => { titleFrame = (titleFrame + 1) % titleFrames.length; paintTitle(); };';
  assert(source.includes(tick));
  source=source.replace(tick,'const tickTitle = () => { if (globalThis.__freezeRedditHelper) return; titleFrame = (titleFrame + 1) % titleFrames.length; paintTitle(); };');
  source=freezeRedditWorker(source);
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    await owner.waitForFunction(()=>typeof window.__startOwnerRead==='function');
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000),'the original refresh owns its helper');
    const helper=opened.find(page=>page!==owner && !page.isClosed());
    assert(helper,'the first helper is open');
    const held=app.store.get('HNewhere:reddit_shared_refresh');
    assert.match(held?.helperNonce || '',/^[a-f0-9]{32}$/,'the original helper is recorded with its lease');
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function',null,{timeout:5000});
    await app.page.locator('#app-list-sync').click();
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(helper.isClosed(),false,'an unexpired owner keeps its helper');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the Reader completes its refresh');
    assert(await waitFor(()=>helper.isClosed(),5000),'the old helper closes through its own validated session without saved tab IDs or user selection');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Reddit tab.*open|select.*tab/i);
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('stale tab IDs do not close unrelated tabs after a browser restart', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);',managerBridge);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {managerTabs}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const unrelated=await app.context.newPage();await unrelated.goto(STORIES[0].url);
    managerTabs.set(999,unrelated);
    app.store.set('HNewhere:reddit_shared_refresh',{id:'old',owner:'old',state:'running',started:Date.now()-5000,expires:Date.now()-1000,helperTabId:999,helperNonce:'0123456789abcdef0123456789abcdef'});
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000),'the Reader completes its refresh');
    assert.equal(unrelated.isClosed(),false,'a tab without the original Reddit helper lock must not be closed');
    assert(!app.store.get('HNewhere:reddit_shared_refresh')?.abandoned?.some(tab=>tab.nonce==='0123456789abcdef0123456789abcdef'),'the old-session helper is discarded after verification');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('a failed replacement keeps the old helper available for the next retry', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=freezeRedditWorker(source);
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    await owner.waitForFunction(()=>typeof window.__startOwnerRead==='function');
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000));
    const helper=opened.find(page=>page!==owner && !page.isClosed());assert(helper);
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function');
    await app.page.evaluate(()=>{window.__failNextOpen=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the failed replacement returns control');
    assert.equal(helper.isClosed(),false,'the first helper remains after the failed open');
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the retry finishes');
    assert(await waitFor(()=>helper.isClosed(),5000),'the retry retires the helper without user selection');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Reddit tab.*open/i);
  } finally {await app.browser.close()}
});

test('a failed caller close still retires a paused helper without an acknowledgement', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('timeout = 20000) {\n\t\tlet deadline = Math.min(batch.expires','timeout = 1200) {\n\t\tlet deadline = Math.min(batch.expires');
  source=source.replace('waitRedditReadReply(batch, "done", 2000)','waitRedditReadReply(batch, "done", 300)');
  source=freezeRedditWorker(source);
  source=source.replace('async function requestRedditReadWindow(path, batch) {','async function requestRedditReadWindow(path, batch) { if (globalThis.__holdReaderRequests) await new Promise(resolve => { globalThis.__unblockReaderRequests = resolve; });');
  source=source.replace('init().catch(console.error);',managerBridge);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__holdReaderRequests=true;window.__dropManagerClose=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.evaluate(()=>typeof window.__unblockReaderRequests==='function'),8000),'the helper connected before the read');
    const helper=opened.find(page=>!page.isClosed());assert(helper);
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function');
    await app.page.evaluate(()=>{window.__holdReaderRequests=false;window.__unblockReaderRequests()});
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the interrupted refresh finishes');
    assert(await waitFor(()=>helper.isClosed(),5000),'same-origin recovery closes it after the caller removal fails');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Reddit tab.*open/i);
    await app.page.evaluate(()=>{window.__dropManagerClose=false});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the next refresh finishes');
    assert.equal(helper.isClosed(),true,'the retired helper stays closed');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Reddit tab.*open/i);
  } finally {await app.browser.close()}
});

test('a suspended helper is retired and forgotten without a foreground recovery step', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=freezeRedditWorker(source);
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    await owner.waitForFunction(()=>typeof window.__startOwnerRead==='function');
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000));
    const helper=opened.find(page=>page!==owner && !page.isClosed());assert(helper);
    const oldNonce=app.store.get('HNewhere:reddit_shared_refresh')?.helperNonce;assert(oldNonce);
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function');
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the refresh finishes');
    assert(await waitFor(()=>helper.isClosed(),5000),'the suspended helper closes in the background');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Reddit tab.*open/i);
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000));
    assert(!app.store.get('HNewhere:reddit_shared_refresh')?.abandoned?.some(tab=>tab.nonce===oldNonce),'a later retry forgets the closed helper');
  } finally {await app.browser.close()}
});

test('an unresponsive Reddit helper briefly reports Partial sync', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const connectionTimeout=/const REDDIT_READ_CONNECT_TIMEOUT_MS = \d+;/;
  assert.match(source,connectionTimeout,'the helper connection timeout must be controlled by this fixture');
  source=source.replace(connectionTimeout,'const REDDIT_READ_CONNECT_TIMEOUT_MS = 1200;');
  source=source.replace('const TOAST_DISMISS_MS = 5200;','const TOAST_DISMISS_MS = 150;');
  source=source.replace('const TOAST_BRIEF_MS = 1800;','const TOAST_BRIEF_MS = 150;');
  source=freezeRedditWorker(source, false);
  source=source.replace('init().catch(console.error);',`if (location.hostname === "www.reddit.com") globalThis.__freezeRedditHelper = true; ${managerBridge}`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__dropManagerClose=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000),'the timed-out refresh finishes');
    assert(await waitFor(()=>opened.every(page=>page.isClosed()),5000),'the unresponsive helper is still cleaned up');
    await new Promise(resolve=>setTimeout(resolve,500));
    const toast=app.page.locator('#toast');
    assert.equal(await toast.textContent(),'Partial sync');
    assert.equal(await toast.evaluate(node=>node.classList.contains('is-showing')),false,'the incomplete result dismisses itself without user action');
  } finally {await app.browser.close()}
});

test('a live helper lock cannot make a stale tab ID safe to close', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=freezeRedditWorker(source, false);
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened,managerTabs}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    const unrelated=await app.context.newPage();await unrelated.goto(STORIES[1].url);
    managerTabs.set(999,unrelated);
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000));
    const helper=opened.find(page=>page!==owner && page!==unrelated && !page.isClosed());assert(helper);
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    const held=app.store.get('HNewhere:reddit_shared_refresh');app.store.set('HNewhere:reddit_shared_refresh',{...held,helperTabId:999});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000));
    assert.equal(unrelated.isClosed(),false,'a live lock cannot establish which tab owns it');
  } finally {await app.browser.close()}
});

test('a helper that responds to cleanup does not leave a stale warning', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000));
    const helper=opened.find(page=>page!==owner && !page.isClosed());assert(helper);
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000));
    assert(await waitFor(()=>helper.isClosed(),5000),'the helper responded to the cleanup request');
    const toast=app.page.locator('#toast');
    assert(!/Reddit tab.*open/i.test(await toast.textContent()) || !(await toast.evaluate(node=>node.classList.contains('is-showing'))),'a closed helper is not reported as open');
  } finally {await app.browser.close()}
});

test('a tab opened after its owner loses the lease is not left behind', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__delayOpen=true;window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>typeof window.__releaseOpen==='function'),6000),'the original tab opening is delayed');
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000),'the Reader takes over and finishes');
    await owner.evaluate(()=>{window.__delayOpen=false;window.__releaseOpen()});
    assert(await waitFor(()=>opened.filter(page=>page!==owner).length>=2,5000),'the delayed open resolves');
    assert(await waitFor(()=>opened.filter(page=>page!==owner).every(page=>page.isClosed()),5000),'the late helper is closed');
  } finally {await app.browser.close()}
});

test('an interrupted request cannot erase a cleanup signal', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  source=source.replace('const expires = () => Date.now() + 4000;','const expires = () => Date.now() + 1000;');
  source=source.replace('renewal = renewal.then(async () => {','if (globalThis.__pauseStageWrite) return; renewal = renewal.then(async () => {');
  const stageLine='const stage = await readBridgePayload(batch.nonce);';
  const first=source.indexOf(stageLine),second=source.indexOf(stageLine,first+stageLine.length);
  assert(second>first,'the request stage is available');
  source=source.slice(0,second)+source.slice(second).replace(stageLine,stageLine+' if (globalThis.__pauseStageWrite) { globalThis.__stageWritePaused = true; await new Promise(resolve => { globalThis.__resumeStageWrite = resolve; }); }');
  const write='await lease.commit(() => stageBridgePayload(batch.nonce, { ...stage, requests: [...(stage.requests || []), { id: requestId, path: safePath }] }));';
  assert(source.includes(write));
  source=source.replace(write,write+' globalThis.__stageWritten = true;');
  source=freezeRedditWorker(source);
  source=source.replace('init().catch(console.error);',managerBridge);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__startOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__ownerReady===true),6000));
    const helper=opened.find(page=>page!==owner && !page.isClosed());assert(helper);
    await helper.evaluate(()=>{window.__freezeRedditHelper=true});
    await helper.waitForFunction(()=>typeof window.__resumeRedditHelper==='function',null,{timeout:5000});
    const oldNonce=app.store.get('HNewhere:reddit_shared_refresh')?.helperNonce;assert(oldNonce);
    await owner.evaluate(()=>{window.__pauseStageWrite=true;window.__requestOldReddit().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__stageWritePaused===true),5000));
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000));
    await owner.evaluate(()=>{window.__pauseStageWrite=false;window.__resumeStageWrite()});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__stageWritten===true || window.__oldReadFinished===true),5000),JSON.stringify({stage:app.store.get('HNewhere:bridge_payload:'+oldNonce),flags:await owner.evaluate(()=>({paused:window.__pauseStageWrite,done:window.__oldReadFinished,stage:window.__stageWritten})),locks:[...app.store].filter(([key])=>key.includes('reddit-stage:'))}));
    assert(!app.store.get('HNewhere:bridge_payload:'+oldNonce)||app.store.get('HNewhere:bridge_payload:'+oldNonce).done,'the stale write cannot reactivate the retired session');
    assert(await waitFor(()=>helper.isClosed(),5000));
  } finally {await app.browser.close()}
});

test('a helper closes itself even if the manager never resolves its close request', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('async function requestRedditReadWindow(path, batch) {','async function requestRedditReadWindow(path, batch) { if (globalThis.__holdReaderRequests) await new Promise(resolve => { globalThis.__unblockReaderRequests = resolve; });');
  source=source.replace('init().catch(console.error);',managerBridge);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__holdReaderRequests=true;window.__hangManagerClose=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.evaluate(()=>typeof window.__unblockReaderRequests==='function'),8000));
    const helper=opened.find(page=>!page.isClosed());assert(helper);
    await helper.evaluate(()=>{window.__hangSelfClose=true});
    await app.page.evaluate(()=>{window.__holdReaderRequests=false;window.__unblockReaderRequests()});
    assert(await waitFor(async()=>await helper.evaluate(()=>window.__selfCloseStarted===true).catch(()=>false),8000),'the helper attempted its manager close');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000),'Sync does not wait indefinitely for a close');
    assert(await waitFor(()=>helper.isClosed(),5000),'the helper falls back to closing its own window');
  } finally {await app.browser.close()}
});

test('an old cleanup result cannot erase a newly opened late helper', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replaceAll('Date.now() + 120000','Date.now() + 2200');
  const cleanup='if (cleaned.some(Boolean)) await save';
  assert(source.includes(cleanup));
  source=source.replace(cleanup,'if (cleaned.some(Boolean) && globalThis.__pauseCleanup) { globalThis.__cleanupPaused = true; await new Promise(resolve => { globalThis.__resumeCleanup = resolve; }); }\n\t\t\t'+cleanup);
  source=source.replace('init().catch(console.error);',`if (location.hostname === "www.reddit.com") globalThis.__pauseCleanup = true; ${managerBridge}`);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com',new URL(article).hostname],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const owner=await app.context.newPage();await owner.goto(article);
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(()=>window.__reloadSettings());
    await owner.evaluate(()=>{window.__delayOpen=true;window.__startFiniteOwnerRead().catch(()=>{})});
    assert(await waitFor(async()=>await owner.evaluate(()=>typeof window.__releaseOpen==='function'),6000));
    const oldNonce=app.store.get('HNewhere:reddit_shared_refresh')?.helperNonce;assert(oldNonce);
    await app.page.locator('#app-list-sync').click();
    let replacement;
    assert(await waitFor(async()=>{for(const page of opened){if(page===owner||page.isClosed()||!page.url().startsWith('https://www.reddit.com/'))continue;if(await page.evaluate(()=>window.__cleanupPaused===true).catch(()=>false)){replacement=page;return true}}return false},10000),'the replacement checked the old helper before its delayed open');
    await owner.evaluate(()=>{window.__hangManagerClose=true;window.__delayOpen=false;window.__releaseOpen()});
    assert(await waitFor(async()=>await owner.evaluate(()=>window.__finiteOwnerFinished===true),6000),'the late owner finishes');
    await replacement.evaluate(()=>window.__resumeCleanup());
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',12000));
    const lateHelper=opened.find(page=>page.url().includes('nonce='+oldNonce));assert(lateHelper,'the old opening did create its helper');
    assert(lateHelper.isClosed()||app.store.get('HNewhere:reddit_shared_refresh')?.abandoned?.some(tab=>tab.nonce===oldNonce),'a still-open late helper must remain recorded for cleanup');
  } finally {await app.browser.close()}
});

test('a manager that opens a tab but never returns does not leave Sync waiting forever', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_OPEN_TIMEOUT_MS = 30000;','const REDDIT_OPEN_TIMEOUT_MS = 1200;');
  source=freezeRedditWorker(source, false);
  source=source.replace('init().catch(console.error);',`if (location.hostname === "www.reddit.com") globalThis.__freezeRedditHelper = true; ${managerBridge}`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__hangOpenAfterCreation=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.some(page=>!page.isClosed()),5000),'the manager opened a tab');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000),'Sync stops waiting for the missing manager response');
    const toast=app.page.locator('#toast');
    assert.equal(await toast.textContent(),'Partial sync');
    assert(await waitFor(async()=>!await toast.evaluate(node=>node.classList.contains('is-showing')),3000),'the partial result dismisses itself');
  } finally {await app.browser.close()}
});

test('a late manager opening response does not resurrect a retired helper', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_OPEN_TIMEOUT_MS = 30000;','const REDDIT_OPEN_TIMEOUT_MS = 1200;');
  source=freezeRedditWorker(source);
  source=source.replace('init().catch(console.error);',`if (location.hostname === "www.reddit.com") globalThis.__freezeRedditHelper = true; ${managerBridge}`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__delayOpenAfterCreation=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>opened.some(page=>!page.isClosed()) && await app.page.evaluate(()=>typeof window.__releaseOpenAfterCreation==='function'),5000));
    const helper=opened.find(page=>!page.isClosed());assert(helper);
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000),'the open times out');
    await app.page.evaluate(()=>{window.__delayOpenAfterCreation=false;window.__releaseOpenAfterCreation()});
    assert(await waitFor(()=>helper.isClosed(),5000),'background recovery does not wait for the late opening response');
  } finally {await app.browser.close()}
});

test('a tab navigated elsewhere is not closed when a late open resolves', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_OPEN_TIMEOUT_MS = 30000;','const REDDIT_OPEN_TIMEOUT_MS = 1200;');
  source=freezeRedditWorker(source, false);
  source=source.replace('init().catch(console.error);',`if (location.hostname === "www.reddit.com") globalThis.__freezeRedditHelper = true; ${managerBridge}`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__delayOpenAfterCreation=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>opened.some(page=>!page.isClosed()) && await app.page.evaluate(()=>typeof window.__releaseOpenAfterCreation==='function'),5000));
    const tab=opened.find(page=>!page.isClosed());assert(tab);
    await tab.waitForFunction(()=>Boolean(document.getElementById('backchannel-read-helper-banner')));
    await tab.goto(STORIES[1].url);
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    await app.page.evaluate(()=>{window.__delayOpenAfterCreation=false;window.__releaseOpenAfterCreation()});
    await new Promise(resolve=>setTimeout(resolve,1000));
    assert.equal(tab.isClosed(),false,'a late opening response cannot reclaim a tab after cleanup released it');
  } finally {await app.browser.close()}
});

test('an expired completed helper can close itself only with a matching stored request', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchExpiredReddit = dispatchRedditReadWindow; globalThis.__markExpiredReddit = markRedditReadDone;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchExpiredReddit==='function');
    const result=await app.page.evaluate(async nonce=>{
      const now=Date.now();
      const stage={kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now-2000,expires:now-1000,done:false,requests:[{id:1,path:'/search.json?q=private-article'}]};
      GM.closeTab=async()=>{window.__closeCalled=true};
      window.close=()=>{window.__windowCloseCalled=true};
      await GM.setValue('HNewhere:bridge_payload:'+nonce,stage);
      await window.__markExpiredReddit(nonce);
      const marked=await GM.getValue('HNewhere:bridge_payload:'+nonce,null);
      const matched=await window.__dispatchExpiredReddit();
      const closed=window.__closeCalled===true && window.__windowCloseCalled===true;
      window.__closeCalled=false;window.__windowCloseCalled=false;
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{...stage,done:true,nonce:'ffffffffffffffffffffffffffffffff'});
      const mismatched=await window.__dispatchExpiredReddit();
      return {matched,closed,mismatched,closedWrong:window.__closeCalled||window.__windowCloseCalled,retainedRequests:marked?.requests?.length};
    },nonce);
    assert.deepEqual(result,{matched:true,closed:true,mismatched:false,closedWrong:false,retainedRequests:0});
  } finally {await app.browser.close()}
});

test('a stored Reddit resume marker does not close a tab navigated to another Reddit page', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchNavigatedReddit = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchNavigatedReddit==='function');
    const result=await app.page.evaluate(async nonce=>{
      const now=Date.now();
      const stage={kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now-2000,expires:now-1000,done:true};
      GM.closeTab=async()=>{window.__closeCalled=true};
      window.close=()=>{window.__windowCloseCalled=true};
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce}));
      history.replaceState({},'', '/r/technology/');
      await GM.setValue('HNewhere:bridge_payload:'+nonce,stage);
      const expired=await window.__dispatchNavigatedReddit();
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce}));
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{...stage,ts:Date.now(),expires:Date.now()+10000});
      const active=await window.__dispatchNavigatedReddit();
      return {expired,active,closed:window.__closeCalled||window.__windowCloseCalled||false};
    },nonce);
    assert.deepEqual(result,{expired:false,active:false,closed:false});
  } finally {await app.browser.close()}
});

test('an active helper does not close the tab after navigation within Reddit', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchActiveReddit = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({status:200,contentType:path==='/api/me.json'?'application/json':'text/html',body:path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):'<title>Reddit fixture</title>'});
  });
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchActiveReddit==='function');
    await app.page.evaluate(async nonce=>{
      const now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000});
      GM.closeTab=async()=>{window.__closeCalled=true};
      window.close=()=>{window.__windowCloseCalled=true};
      await window.__dispatchActiveReddit();
    },nonce);
    assert(await waitFor(()=>app.store.get('HNewhere:bridge_result:'+nonce)?.phase==='ready',5000),'the helper started');
    await app.page.evaluate(async nonce=>{
      history.replaceState({},'', '/r/technology/');
      const key='HNewhere:bridge_payload:'+nonce;
      await GM.setValue(key,{...await GM.getValue(key),done:true});
    },nonce);
    await new Promise(resolve=>setTimeout(resolve,700));
    const closed=await app.page.evaluate(()=>window.__closeCalled||window.__windowCloseCalled||false);
    assert.equal(closed,false,'the user’s new Reddit page stays open');
  } finally {await app.browser.close()}
});

test('a pending login does not close an unmarked Reddit homepage', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchHomeReddit = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchHomeReddit==='function');
    const result=await app.page.evaluate(async nonce=>{
      const now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000,done:true});
      GM.closeTab=async()=>{window.__closeCalled=true};window.close=()=>{window.__windowCloseCalled=true};
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce,login:true}));
      history.replaceState({},'','/');
      const handled=await window.__dispatchHomeReddit();
      await new Promise(resolve=>setTimeout(resolve,300));
      const reply=await GM.getValue('HNewhere:bridge_result:'+nonce,null);
      return {handled,closed:window.__closeCalled||window.__windowCloseCalled||false,error:reply?.error};
    },nonce);
    assert.deepEqual(result,{handled:false,closed:false,error:'window-unavailable'});
  } finally {await app.browser.close()}
});

test('a sign-in return requires an explicit action before reusing the homepage as a helper', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchLoginReturn = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({status:200,contentType:path==='/api/me.json'?'application/json':'text/html',body:path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):'<title>Reddit fixture</title><body></body>'});
  });
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchLoginReturn==='function');
    const handled=await app.page.evaluate(async nonce=>{
      const now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000});
      GM.closeTab=async()=>{window.__closeCalled=true};window.close=()=>{window.__windowCloseCalled=true};
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce,login:true}));
      history.replaceState({},'','/');
      return window.__dispatchLoginReturn();
    },nonce);
    assert.equal(handled,true,'the login return offers a continuation');
    const note=app.page.locator('#hnewhere-sign-in-note');
    assert.match(await note.textContent(),/close this tab/i);
    assert.equal(await app.page.evaluate(()=>window.__closeCalled||window.__windowCloseCalled||false),false,'the homepage remains open without consent');
    await note.getByRole('button',{name:'Continue',exact:true}).click();
    assert(await waitFor(()=>app.store.get('HNewhere:bridge_result:'+nonce)?.phase==='ready',5000),'the explicit action resumes the helper');
    await app.page.evaluate(async nonce=>{const key='HNewhere:bridge_payload:'+nonce;await GM.setValue(key,{...await GM.getValue(key),done:true})},nonce);
    assert(await waitFor(async()=>await app.page.evaluate(()=>window.__closeCalled===true),5000),'the helper closes after the user agreed');
  } finally {await app.browser.close()}
});

test('cancelling the sign-in return leaves the Reddit homepage open', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchLoginReturn = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title><body></body>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchLoginReturn==='function');
    await app.page.evaluate(async nonce=>{
      const now=Date.now();
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000});
      GM.closeTab=async()=>{window.__closeCalled=true};window.close=()=>{window.__windowCloseCalled=true};
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce,login:true}));
      history.replaceState({},'','/');
      await window.__dispatchLoginReturn();
    },nonce);
    await app.page.locator('#hnewhere-sign-in-note').getByRole('button',{name:'Cancel',exact:true}).click();
    assert(await waitFor(()=>app.store.get('HNewhere:bridge_result:'+nonce)?.error==='cancelled',5000));
    assert.equal(await app.page.evaluate(()=>window.__closeCalled||window.__windowCloseCalled||false),false);
    assert.equal(await app.page.locator('#hnewhere-sign-in-note').count(),0);
  } finally {await app.browser.close()}
});

for(const action of ['Continue','Cancel']) test(`a stalled login update leaves ${action} recoverable`, {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_LOGIN_WRITE_TIMEOUT_MS = 3000;','const REDDIT_LOGIN_WRITE_TIMEOUT_MS = 150;');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchLoginReturn = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title><body></body>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchLoginReturn==='function');
    await app.page.evaluate(async nonce=>{
      const now=Date.now(),key='HNewhere:bridge_result:'+nonce;
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000});
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce,login:true}));
      history.replaceState({},'','/');
      GM.closeTab=async()=>{window.__closeCalled=true};window.close=()=>{window.__windowCloseCalled=true};
      const set=GM.setValue;
      GM.setValue=async (name,value)=>{if(name===key && value?.phase==='login' && window.__hangHeartbeat){window.__heartbeatBlocked=true;return new Promise(()=>{})}return set(name,value)};
      await window.__dispatchLoginReturn();window.__hangHeartbeat=true;
    },nonce);
    await app.page.waitForFunction(()=>window.__heartbeatBlocked===true,null,{timeout:5000});
    const note=app.page.locator('#hnewhere-sign-in-note');
    await note.getByRole('button',{name:action,exact:true}).click();
    await note.getByText(/return to backchannel.*sync again/i).waitFor({timeout:2000});
    assert.equal(await app.page.evaluate(()=>!!location.hash||!!window.__closeCalled||!!window.__windowCloseCalled),false);
    await note.getByRole('button',{name:'Dismiss',exact:true}).click();
    assert.equal(await note.count(),0);
  } finally {await app.browser.close()}
});

for(const action of ['Continue','Cancel']) test(`a delayed login update cannot overwrite ${action}`, {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchLoginReturn = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({status:200,contentType:path==='/api/me.json'?'application/json':'text/html',body:path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):'<title>Reddit fixture</title><body></body>'});
  });
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchLoginReturn==='function');
    await app.page.evaluate(async nonce=>{
      const now=Date.now(),key='HNewhere:bridge_result:'+nonce;
      await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+10000});
      sessionStorage.setItem('HNewhere:reddit_read_resume',JSON.stringify({nonce,login:true}));
      history.replaceState({},'','/');
      const set=GM.setValue;
      GM.setValue=async (name,value)=>{if(name===key && value?.phase==='login' && window.__delayHeartbeat){window.__heartbeatBlocked=true;await new Promise(resolve=>{window.__releaseHeartbeat=resolve});}return set(name,value)};
      await window.__dispatchLoginReturn();
      window.__delayHeartbeat=true;
    },nonce);
    await app.page.waitForFunction(()=>window.__heartbeatBlocked===true,null,{timeout:5000});
    await app.page.locator('#hnewhere-sign-in-note').getByRole('button',{name:action,exact:true}).click();
    await new Promise(resolve=>setTimeout(resolve,700));
    await app.page.evaluate(()=>{window.__delayHeartbeat=false;window.__releaseHeartbeat()});
    const expected=action==='Continue'?'ready':'cancelled';
    assert(await waitFor(()=>{const reply=app.store.get('HNewhere:bridge_result:'+nonce);return action==='Continue'?reply?.phase===expected:reply?.error===expected},5000),`${action} remains the latest result`);
    await new Promise(resolve=>setTimeout(resolve,250));
    const final=app.store.get('HNewhere:bridge_result:'+nonce);
    assert.equal(action==='Continue'?final?.phase:final?.error,expected);
  } finally {await app.browser.close()}
});

test('an expired helper does not close after its marker is removed during storage access', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__dispatchDelayedReddit = dispatchRedditReadWindow;');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'www.reddit.com',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>typeof window.__dispatchDelayedReddit==='function');
    await app.page.evaluate(async nonce=>{
      const now=Date.now(),key='HNewhere:bridge_payload:'+nonce;
      await GM.setValue(key,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now-2000,expires:now-1000,done:true});
      GM.closeTab=async()=>{window.__closeCalled=true};window.close=()=>{window.__windowCloseCalled=true};
      const get=GM.getValue;
      GM.getValue=async (...args)=>{if(args[0]===key){window.__stageReadStarted=true;await new Promise(resolve=>{window.__releaseStageRead=resolve})}return get(...args)};
      window.__dispatchResult=window.__dispatchDelayedReddit();
    },nonce);
    await app.page.waitForFunction(()=>window.__stageReadStarted===true);
    const result=await app.page.evaluate(async()=>{history.replaceState({},'','/');window.__releaseStageRead();return {handled:await window.__dispatchResult,closed:window.__closeCalled||window.__windowCloseCalled||false}});
    assert.deepEqual(result,{handled:false,closed:false});
  } finally {await app.browser.close()}
});

test('Reader cleanup does not close a helper tab navigated within Reddit', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('async function requestRedditReadWindow(path, batch) {','async function requestRedditReadWindow(path, batch) { if (globalThis.__holdReaderRequests) await new Promise(resolve => { globalThis.__unblockReaderRequests = resolve; });');
  source=source.replace('init().catch(console.error);',managerBridge);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const {opened}=await setupManager(app);
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,reddit:true}});
    await app.page.evaluate(async()=>{await window.__reloadSettings();window.__holdReaderRequests=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.evaluate(()=>typeof window.__unblockReaderRequests==='function'),8000),'the helper connected');
    const helper=opened.find(page=>!page.isClosed());assert(helper);
    await helper.evaluate(()=>history.replaceState({},'', '/r/technology/'));
    await app.page.evaluate(()=>{window.__holdReaderRequests=false;window.__unblockReaderRequests()});
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000),'Sync finishes');
    assert.equal(helper.isClosed(),false,'Reader must not close the page the user navigated to');
  } finally {await app.browser.close()}
});
