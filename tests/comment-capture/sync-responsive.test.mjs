import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES, waitFor} from './harness.mjs';

test('a manager that never calls network callbacks cannot stall source requests', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const NETWORK_REQUEST_TIMEOUT_MS = 10000;','const NETWORK_REQUEST_TIMEOUT_MS = 150;');
  source=source.replace('init().catch(console.error);','globalThis.__networkTimeoutTest = { request, requestWithMeta, requestText };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__networkTimeoutTest));
    const result=await app.page.evaluate(async()=>{
      window.__aborts=0;
      GM.xmlHttpRequest=()=>({abort(){window.__aborts++}});
      const replies=await Promise.race([Promise.all([__networkTimeoutTest.request('https://example.com/data'),__networkTimeoutTest.requestWithMeta('https://example.com/data'),__networkTimeoutTest.requestText('https://example.com/data')]),new Promise(resolve=>setTimeout(()=>resolve('hung'),1200))]);
      return {replies,aborts:window.__aborts};
    });
    assert.notEqual(result.replies,'hung','both requests must settle even when the manager never calls back');
    assert.equal(result.replies[0],null);
    assert.equal(result.replies[1].ok,false);
    assert.equal(result.replies[2],'');
    assert.equal(result.aborts,3,'timed-out network requests are aborted when possible');
  } finally {await app.browser.close()}
});

test('Reader Sync finishes if the manager never answers the Hacker News feed', {timeout:20000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const NETWORK_REQUEST_TIMEOUT_MS = 10000;','const NETWORK_REQUEST_TIMEOUT_MS = 150;');
  source=source.replace('init().catch(console.error);',`{ const request=GM.xmlHttpRequest; GM.xmlHttpRequest=(options)=>{if(window.__pauseHNFeed && options.url==='https://news.ycombinator.com/news') return {abort(){}}; return request(options)}; } init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{window.__pauseHNFeed=true});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',4000),'the button must not spin forever');
    assert(await app.page.locator('#app-list-body .browse-title-link').count()>0,'saved stories remain visible');
  } finally {await app.browser.close()}
});

test('an older Reddit warning waits for a newer Reader Sync to finish', {timeout:20000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('async function readBridgePayload(nonce) {','async function readBridgePayload(nonce) { if (nonce === "fixture-old" && !window.__oldBatchRead) { window.__oldBatchRead = true; await new Promise(resolve => { window.__resumeOldBatch = resolve; }); }');
  source=source.replace('init().catch(console.error);',`globalThis.__oldBatchFinish = () => finishRedditReadBatch({nonce:'fixture-old', sequence:0, unresponsive:true, startedSyncRun:syncRunId}); { const request=GM.xmlHttpRequest; GM.xmlHttpRequest=(options)=>{if(window.__pauseHNFeed && options.url==='https://news.ycombinator.com/news') {window.__resumeHNFeed=()=>request(options);return {abort(){}};} return request(options)}; } init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{window.__oldBatchFinish();window.__pauseHNFeed=true});
    await app.page.waitForFunction(()=>typeof window.__resumeOldBatch==='function');
    await app.page.locator('#app-list-sync').click();
    await app.page.waitForFunction(()=>typeof window.__resumeHNFeed==='function');
    assert.match(await app.page.locator('#toast').textContent(),/Syncing/);
    await app.page.evaluate(()=>window.__resumeOldBatch());
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(await app.page.locator('#app-list-sync').getAttribute('aria-busy'),'true');
    assert.match(await app.page.locator('#toast').textContent(),/Syncing/,'an earlier warning must not replace the active sync status');
    await app.page.evaluate(()=>window.__resumeHNFeed());
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync','a current incomplete outcome is reported after Sync finishes');
  } finally {await app.browser.close()}
});

test('a stalled source recovery does not discard another recovered discussion', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const RECOVER_CEILING_MS = 30000;','const RECOVER_CEILING_MS = 200;');
  source=source.replace('init().catch(console.error);','globalThis.__recoverTimeoutTest = { recoverAppRowThreads, getSource };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__recoverTimeoutTest));
    const result=await app.page.evaluate(async()=>{
      __recoverTimeoutTest.getSource('reddit').recover=()=>new Promise(()=>{});
      __recoverTimeoutTest.getSource('hn').recover=async()=>[{source:'hn',id:'123',key:'hn:123'}];
      return Promise.race([__recoverTimeoutTest.recoverAppRowThreads([{source:'reddit',id:'slow'},{source:'hn',id:'123'}],[]),new Promise(resolve=>setTimeout(()=>resolve('hung'),1200))]);
    });
    assert.notEqual(result,'hung','recovery must not leave discovery waiting forever');
    assert.deepEqual(result,[{source:'hn',id:'123',key:'hn:123'}]);
  } finally {await app.browser.close()}
});

test('a slow Reddit response followed by a successful archive recovery is retained', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const NETWORK_REQUEST_TIMEOUT_MS = 10000;','const NETWORK_REQUEST_TIMEOUT_MS = 1000;');
  source=source.replace('const DISCOVER_CEILING_MS = 12000;','const DISCOVER_CEILING_MS = 250;');
  source=source.replace('const RECOVER_CEILING_MS = 30000;','const RECOVER_CEILING_MS = 1500;');
  source=source.replace('init().catch(console.error);','globalThis.__recoverTimeoutTest = { recoverAppRowThreads };');
  const post={id:'large123',title:'A Reddit discussion',url:'https://example.com/article',permalink:'/r/news/comments/large123/article/',subreddit:'news',num_comments:4000};
  const app=await launchApp({source,sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},updateCheck:false},responses:[
    {match:url=>url.startsWith('https://www.reddit.com/api/info.json'),delay:300,status:403,json:{}},
    {match:url=>url.includes('/api/posts/ids?ids=large123'),delay:300,status:200,json:{data:[post]}},
  ]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__recoverTimeoutTest));
    const result=await app.page.evaluate(()=>__recoverTimeoutTest.recoverAppRowThreads([{source:'reddit',id:'large123'}],[]));
    assert.equal(result[0]?.key,'reddit:large123','both legitimate requests must be allowed to complete');
    assert(app.requests.some(request=>request.url.includes('/api/info.json')));
    assert(app.requests.some(request=>request.url.includes('/api/posts/ids?ids=large123')));
    assert.equal(result[0]?.commentCount,4000);
  } finally {await app.browser.close()}
});

test('a suspended Reddit helper does not hold up an available Hacker News discussion', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_READ_CONNECT_TIMEOUT_MS = 10000;','const REDDIT_READ_CONNECT_TIMEOUT_MS = 500;');
  source=source.replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;');
  const seam='const identity = await fetchJSON("/api/me.json");';
  assert(source.includes(seam));
  source=source.replace(seam,'if (globalThis.__pauseRedditIdentity) await new Promise(resolve => { globalThis.__resumeRedditIdentity = resolve; }); '+seam);
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'www.reddit.com') globalThis.__pauseRedditIdentity = true; init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2},responses:[{match:url=>url.includes('/api/posts/search'),json:{data:[]}}]});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('/api/')?'application/json':'text/html',body:route.request().url().includes('/api/me.json')?'{"data":{"name":"fixture"}}':route.request().url().includes('/api/')?'{"data":{"children":[]}}':'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', {hasText:STORIES[0].title}).first().click();
    assert(await waitFor(()=>opened.length>0,5000),'the Reddit helper opens');
    const helper=opened[0];
    await helper.waitForFunction(()=>typeof window.__resumeRedditIdentity==='function',null,{timeout:5000});
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,5000),'Hacker News comments render while the Reddit helper is paused');
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync','the stalled helper has the standard incomplete result');
    assert(await waitFor(()=>helper.isClosed(),5000),'the timed-out helper closes without foreground resumption');
  } finally {await app.browser.close()}
});

test('an automatic Reddit refresh shows the Reader sync activity while it is running', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const seam='const identity = await fetchJSON("/api/me.json");';
  assert(source.includes(seam));
  source=source.replace(seam,'if (globalThis.__pauseRedditIdentity) await new Promise(resolve => { globalThis.__resumeRedditIdentity = resolve; }); '+seam);
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'www.reddit.com') globalThis.__pauseRedditIdentity = true; init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('/api/')?'application/json':'text/html',body:route.request().url().includes('/api/me.json')?'{"data":{"name":"fixture"}}':route.request().url().includes('/api/')?'{"data":{"children":[]}}':'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    assert(await waitFor(()=>opened.length>0,8000),'the automatic refresh opens Reddit');
    const helper=opened[0];
    await helper.waitForFunction(()=>typeof window.__resumeRedditIdentity==='function',null,{timeout:5000});
    assert.equal(await app.page.locator('#app-list-sync').getAttribute('aria-busy'),'true','the Sync button indicates the background work');
    assert.match(await app.page.locator('#toast').textContent(),/Syncing/i);
    await helper.evaluate(()=>window.__resumeRedditIdentity());
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true'&&helper.isClosed(),15000),'the indicator clears after the helper closes');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('a manual Reader Sync requested during an automatic refresh runs afterward', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const seam='const identity = await fetchJSON("/api/me.json");';
  assert(source.includes(seam));
  source=source.replace(seam,'if (globalThis.__pauseRedditIdentity) await new Promise(resolve => { globalThis.__resumeRedditIdentity = resolve; }); '+seam);
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'www.reddit.com') globalThis.__pauseRedditIdentity = true; init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('/api/')?'application/json':'text/html',body:route.request().url().includes('/api/me.json')?'{"data":{"name":"fixture"}}':route.request().url().includes('/api/')?'{"data":{"children":[]}}':'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    assert(await waitFor(()=>opened.length>0,8000));
    const helper=opened[0];
    await helper.waitForFunction(()=>typeof window.__resumeRedditIdentity==='function',null,{timeout:5000});
    const before=app.requests.filter(request=>request.url==='https://news.ycombinator.com/news').length;
    await app.page.locator('#app-list-sync').click();
    await helper.evaluate(()=>window.__resumeRedditIdentity());
    assert(await waitFor(async()=>{
      for(const tab of opened.slice(1)) if(!tab.isClosed()) await tab.evaluate(()=>{window.__pauseRedditIdentity=false;window.__resumeRedditIdentity?.()}).catch(()=>{});
      return app.requests.filter(request=>request.url==='https://news.ycombinator.com/news').length>=before+2;
    },12000),'both the automatic refresh and the requested Sync fetch the feed');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',15000));
  } finally {await app.browser.close()}
});

test('an automatic Reddit timeout shows a transient Partial sync result', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const REDDIT_READ_CONNECT_TIMEOUT_MS = 10000;','const REDDIT_READ_CONNECT_TIMEOUT_MS = 500;');
  const seam='const identity = await fetchJSON("/api/me.json");';
  assert(source.includes(seam));
  source=source.replace(seam,'if (globalThis.__pauseRedditIdentity) await new Promise(resolve => { globalThis.__resumeRedditIdentity = resolve; }); '+seam);
  source=source.replace('init().catch(console.error);',`if (location.hostname === 'www.reddit.com') globalThis.__pauseRedditIdentity = true; init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  await app.context.route('https://www.reddit.com/**',route=>route.fulfill({status:200,contentType:route.request().url().includes('/api/')?'application/json':'text/html',body:route.request().url().includes('/api/me.json')?'{"data":{"name":"fixture"}}':route.request().url().includes('/api/')?'{"data":{"children":[]}}':'<title>Reddit fixture</title>'}));
  try {
    await app.page.goto('https://backchnnl.app/');
    assert(await waitFor(()=>opened.length>0,8000));
    const helper=opened[0];
    await helper.waitForFunction(()=>typeof window.__resumeRedditIdentity==='function',null,{timeout:5000});
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    await new Promise(resolve=>setTimeout(resolve,1000));
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync','the result is not replaced by Synced');
    assert(await waitFor(async()=>!await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),3000),'the partial result dismisses itself');
    assert(await waitFor(()=>helper.isClosed(),5000),'timeout cleanup does not require resuming the helper');
  } finally {await app.browser.close()}
});
