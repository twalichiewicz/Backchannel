import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,waitFor} from './harness.mjs';

async function setup(lostOpen=false){
  const original=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const loop='if (!redditReadHelperLocation(nonce)) break;\n\t\t\t\t\tconst current = await readBridgePayload(nonce);';
  assert(original.includes(loop));
  let source=original.replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;')
    .replace('\t\tbatch.closing = true;','\t\tbatch.closing = true;\n\t\tif (globalThis.__holdHelperCleanup) await new Promise(resolve => { globalThis.__releaseHelperCleanup = resolve; });')
    .replace(loop,'if (!redditReadHelperLocation(nonce)) break;\n\t\t\t\t\tif (globalThis.__freezeRedditHelper) await new Promise(resolve => { globalThis.__resumeHelper = resolve; });\n\t\t\t\t\tconst current = await readBridgePayload(nonce);');
  if(lostOpen)source=source.replace('const REDDIT_OPEN_TIMEOUT_MS = 30000;','const REDDIT_OPEN_TIMEOUT_MS = 300;').replace('init().catch(console.error);',`if(location.hostname==='www.reddit.com')window.__freezeRedditHelper=true;else{const open=GM.openInTab;GM.openInTab=async(...args)=>{await open(...args);return new Promise(()=>{})}}init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const body=path==='/'?'<title>Reddit fixture</title>':path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):JSON.stringify({data:{children:[]}});
    await route.fulfill({status:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
  await app.page.evaluate(()=>{window.__holdHelperCleanup=true});await app.page.locator('#app-list-sync').click();
  assert(await waitFor(async()=>await app.page.evaluate(()=>typeof window.__releaseHelperCleanup==='function')&&opened.length===1,15000));
  const helper=opened[0];await helper.evaluate(()=>{window.__freezeRedditHelper=true});
  await helper.waitForFunction(()=>typeof window.__resumeHelper==='function');
  return {...app,helper};
}

test('a completed Reddit refresh closes its background helper with polling frozen',{timeout:30000},async()=>{
  const app=await setup();try{
    await app.page.evaluate(()=>window.__releaseHelperCleanup());
    assert(await waitFor(()=>app.helper.isClosed(),5000),'the manager removes the helper without the user selecting or resuming it');
    assert.equal(app.page.isClosed(),false,'the Reader stays open');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/tab.*(?:open|select)|select.*tab/i);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a paused helper closes even when the manager loses the opening response',{timeout:30000},async()=>{
  const app=await setup(true);try{
    await app.page.evaluate(()=>window.__releaseHelperCleanup());
    assert(await waitFor(()=>app.helper.isClosed(),10000),'nonce-bound cleanup retires the helper without an ID or foreground selection');
    assert.equal(app.page.isClosed(),false);
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    assert(!app.context.pages().some(page=>!page.isClosed()&&page.url().startsWith('https://www.reddit.com/')),'the temporary cleanup helper also closes');
  }finally{await app.browser.close()}
});

test('a helper explains its task in a top banner before it is selected',{timeout:30000},async()=>{
  const app=await setup();try{
    const banner=app.helper.locator('#backchannel-read-helper-banner');
    assert.equal(await banner.count(),1,'the explanation is present even while its worker is paused');
    assert.match(await banner.innerText(),/Backchannel.*Reddit/i);
    assert.match(await banner.innerText(),/close automatically/i);
    assert.equal(await banner.getAttribute('role'),'status');
    assert.equal(Math.round((await banner.boundingBox()).y),0,'the banner is at the top of the page');
    await app.page.evaluate(()=>window.__releaseHelperCleanup());
    assert(await waitFor(()=>app.helper.isClosed(),5000));
  }finally{await app.browser.close()}
});

test('cleanup relinquishes a paused helper after the user navigates within the tab',{timeout:30000},async()=>{
  const app=await setup();try{
    await app.helper.evaluate(()=>history.replaceState({},'','/r/user-chosen-page/'));
    await app.page.evaluate(()=>window.__releaseHelperCleanup());
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(app.helper.isClosed(),false,'the navigated page is no longer owned by the refresh');
    assert.equal(await app.helper.locator('#backchannel-read-helper-banner').count(),0,'the helper banner is removed from the ordinary page');
    assert.match(app.helper.url(),/user-chosen-page/);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('navigation during a delayed ownership read cannot close the repurposed tab',{timeout:30000},async()=>{
  const app=await setup();try{
    await app.page.evaluate(()=>{
      const get=GM.getValue;let held=false;
      GM.getValue=async(...args)=>{const value=await get(...args);if(!held&&args[0].endsWith(':helper')){held=true;window.__ownershipPaused=true;await new Promise(resolve=>window.__releaseOwnership=resolve)}return value};
      window.__releaseHelperCleanup();
    });
    await app.page.waitForFunction(()=>window.__ownershipPaused);
    await app.helper.evaluate(()=>history.replaceState({},'','/r/user-chosen-page/'));
    assert(await waitFor(()=>[...app.store.values()].some(value=>value?.source==='backchannel-read-helper'&&value.state==='released'),5000));
    await app.page.evaluate(()=>window.__releaseOwnership());
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(app.helper.isClosed(),false,'a stale ownership snapshot does not authorize native removal');
  }finally{await app.browser.close()}
});

test('invalid manager IDs cannot close the caller and live handles require observed closure',{timeout:15000},async()=>{
  const source=(await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8')).replace('init().catch(console.error);','globalThis.__helperClose={rememberReadHelperTab,closeManagedReadHelper,readHelperRecordKey};');
  const app=await launchApp({source,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__helperClose);
    const results=await app.page.evaluate(async()=>{
      const api=window.__helperClose;let calls=0;GM.closeTab=async()=>{calls++};const results=[];
      for(const id of [undefined,null,0,-1,NaN,Infinity,1.5,'123']){
        const nonce='bad-'+results.length,now=Date.now();await GM.setValue(api.readHelperRecordKey(nonce),{source:'backchannel-read-helper',nonce,kind:'reddit',document:nonce,ts:now,state:'owned'});
        api.rememberReadHelperTab(nonce,'reddit',{id},now);results.push(await api.closeManagedReadHelper(nonce));
      }
      const nonce='live',now=Date.now();await GM.setValue(api.readHelperRecordKey(nonce),{source:'backchannel-read-helper',nonce,kind:'reddit',document:nonce,ts:now,state:'owned'});
      api.rememberReadHelperTab(nonce,'reddit',{closed:false,close(){}},now);
      return {results,calls,live:await api.closeManagedReadHelper(nonce)};
    });
    assert.equal(results.calls,0,'falsy or malformed IDs must never reach the manager, whose default is the caller');
    assert(results.results.every(result=>result==='unsupported'));
    assert.equal(results.live,'failed','a live tab handle that remains open is not closure proof');
    assert.equal(app.page.isClosed(),false);
  }finally{await app.browser.close()}
});
