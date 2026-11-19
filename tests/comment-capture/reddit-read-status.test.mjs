import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,waitFor,STORIES} from './harness.mjs';

for(const timing of ['during','after','shared']) test(`a completed Reddit feed refresh supersedes an older failure ${timing==='shared'?'after reusing another view’s success':'reported '+timing+' the new Sync'}`,{timeout:20000},async()=>{
  const original=await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const source=original.replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;')
    .replace('const TOAST_BRIEF_MS = 1800;','const TOAST_BRIEF_MS = 150;')
    .replace('async function readBridgePayload(nonce) {',`async function readBridgePayload(nonce) {
      if(nonce==='fixture-old'&&!window.__oldFailureWaiting){window.__oldFailureWaiting=true;await new Promise(resolve=>window.__releaseOldFailure=resolve)}
    `)
    .replace('init().catch(console.error);',`window.__finishOldRedditFailure=()=>finishRedditReadBatch({nonce:'fixture-old',sequence:0,unresponsive:true,feedOnly:true,actionId:redditReadActionId,created:Date.now(),startedSyncRun:syncRunId}).then(()=>{window.__oldFailureFinished=true});init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  let releaseFeed;
  let requestedFeed=false;
  const feedReady=new Promise(resolve=>{releaseFeed=resolve});
  const title='A newly synced Reddit article';
  const post={id:'fresh123',url:'https://framed.example.com/fresh-reddit',title,author:'fixture',subreddit:'news',permalink:'/r/news/comments/fresh123/article/',num_comments:12,created_utc:Math.floor(Date.now()/1000)-60,score:17};
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const feed=path==='/r/popular.json';
    if(feed){requestedFeed=true;await feedReady}
    const body=path==='/'?'<title>Reddit fixture</title>':path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):JSON.stringify({data:{children:feed?[{kind:'t3',data:post}]:[]}});
    await route.fulfill({status:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{window.__finishOldRedditFailure()});
    await app.page.waitForFunction(()=>window.__releaseOldFailure);
    if(timing==='shared'){
      const other=await app.context.newPage();await other.goto('https://backchnnl.app/');
      await other.locator('#app-list-body .browse-title-link').first().waitFor();
      await other.locator('#app-list-sync').click();
      assert(await waitFor(()=>requestedFeed,5000));releaseFeed();
      await other.locator('#app-list-body .browse-title-link',{hasText:title}).waitFor();
      assert(await waitFor(async()=>await other.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    }
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>requestedFeed,5000),'the new refresh is fetching Reddit');
    if(timing==='during'){
      await app.page.evaluate(()=>window.__releaseOldFailure());
      await app.page.waitForFunction(()=>window.__oldFailureFinished);
      assert.match(await app.page.locator('#toast').textContent(),/Syncing/,'the old error does not replace current progress');
    }
    releaseFeed();
    await app.page.locator('#app-list-body .browse-title-link',{hasText:title}).waitFor();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    if(timing!=='during'){
      await app.page.evaluate(()=>window.__releaseOldFailure());
      await app.page.waitForFunction(()=>window.__oldFailureFinished);
    }
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Partial sync/i,'fresh Reddit data must not be followed by a superseded partial result');
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'no obsolete persistent warning survives the success toast');
    if(timing==='shared')assert.equal(opened.filter(page=>page.url().includes('#backchannel_read=1')).length,1,'the current view reuses the other view’s successful Reddit refresh');
    assert.deepEqual(app.errors,[]);
  }finally{releaseFeed();await app.browser.close()}
});


for(const unrelatedToast of [false,true]) test(`a successful Reddit discussion check ${unrelatedToast?'preserves unrelated feedback':'clears its older transport failure'} without a full Sync`,{timeout:20000},async()=>{
  const source=(await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8'))
    .replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;')
    .replace('init().catch(console.error);',`window.__oldRedditFailure=()=>finishRedditReadBatch({nonce:'fixture-old',sequence:0,unresponsive:true,actionId:redditReadActionId,created:Date.now(),startedSyncRun:syncRunId});window.__unrelatedFeedback=()=>showToast('A different user action completed.',{persist:true});init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  const post={id:'fresh123',url:STORIES[0].url,title:STORIES[0].title,author:'fixture',subreddit:'news',permalink:'/r/news/comments/fresh123/article/',num_comments:1,created_utc:Math.floor(Date.now()/1000)-60,score:17};
  const opened=[];app.context.on('page',page=>opened.push(page));
  let releaseQueries;
  let queried=false;
  const ready=new Promise(resolve=>{releaseQueries=resolve});
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body;
    if(path==='/')body='<title>Reddit fixture</title>';
    else if(path==='/api/me.json')body=JSON.stringify({data:{name:'fixture'}});
    else if(path.includes('/comments/'))body=JSON.stringify([{data:{children:[{kind:'t3',data:post}]}},{data:{children:[{kind:'t1',data:{id:'freshcomment',body:'A freshly loaded Reddit comment',author:'fixture',parent_id:'t3_fresh123',link_id:'t3_fresh123',created_utc:post.created_utc,replies:''}}]}}]);
    else {queried=true;await ready;body=JSON.stringify({data:{children:[{kind:'t3',data:post}]}})}
    await route.fulfill({status:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__oldRedditFailure());
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    assert(await waitFor(()=>queried,5000));
    if(unrelatedToast)await app.page.evaluate(()=>window.__unrelatedFeedback());
    releaseQueries();
    await app.page.locator('#comments-content').getByText('A freshly loaded Reddit comment',{exact:true}).waitFor();
    assert(await waitFor(()=>opened.length>0&&opened.every(page=>page.isClosed()),5000),'the successful discussion finishes and closes its helper');
    if(unrelatedToast){
      assert.equal(await app.page.locator('#toast').textContent(),'A different user action completed.');
      assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),true);
    }else{
      assert(await waitFor(async()=>!await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),3000),'newly loaded Reddit comments resolve the old visible transport error');
    }
    assert.deepEqual(app.errors,[]);
  }finally{releaseQueries();await app.browser.close()}
});

for(const sourceName of ['Reddit','article','X']) test(`an old transport failure preserves the current ${sourceName} partial result`,{timeout:15000},async()=>{
  const source=(await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8')).replace('init().catch(console.error);',`window.__independentCleanup=()=>${sourceName==='X'?"(xHelpersAwaitingClose.add('fixture-x'),showXCleanupNotice())":sourceName==='article'?"(pendingReadHelpers.add('fixture-article'),showReadHelperCleanupNotice())":"window.__reportReadFailure(2,'cleanup')"};window.__reportReadFailure=(actionId,kind)=>reportRedditReadNotice({nonce:'fixture-'+actionId,actionId,startedSyncRun:syncRunId},kind);init().catch(console.error);`);
  const app=await launchApp({source,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{window.__independentCleanup();window.__reportReadFailure(1,'unresponsive')});
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert.equal(await app.page.locator('#toast .toast-action').count(),0,'another attempt uses the standard Sync control');
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),true);
  }finally{await app.browser.close()}
});

test('a genuine timeout after a successful Reddit refresh briefly reports Partial sync',{timeout:20000},async()=>{
  const source=(await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8'))
    .replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;')
    .replace('const REDDIT_READ_CONNECT_TIMEOUT_MS = 10000;','const REDDIT_READ_CONNECT_TIMEOUT_MS = 2500;');
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2}});
  let unavailable=false;
  let releaseIdentity;
  const identityGate=new Promise(resolve=>{releaseIdentity=resolve});
  const title='A saved Reddit article after a real later timeout';
  const post={id:'fresh123',url:'https://framed.example.com/reddit-saved',title,author:'fixture',subreddit:'news',permalink:'/r/news/comments/fresh123/article/',num_comments:1,created_utc:Math.floor(Date.now()/1000)-60,score:17};
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/me.json'&&unavailable)await identityGate;
    const body=path==='/'?'<title>Reddit fixture</title>':path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):JSON.stringify({data:{children:[{kind:'t3',data:post}]}});
    await route.fulfill({status:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.locator('#app-list-sync').click();
    await app.page.locator('#app-list-body .browse-title-link',{hasText:title}).waitFor();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    unavailable=true;
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',7000));
    assert.equal(await app.page.locator('#app-list-body .browse-title-link',{hasText:title}).count(),1,'saved data survives a genuine newer failure');
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),true,'a prior success must not dismiss a newer real timeout');
    assert(await waitFor(async()=>!await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),3000),'the partial result expires without user action');
    assert.deepEqual(app.errors,[]);
  }finally{releaseIdentity();await app.browser.close()}
});


for(const newerStatus of ['transport','article-cleanup','X-cleanup']) test(`an older Sync success cannot hide a newer ${newerStatus} failure`,{timeout:15000},async()=>{
  const source=(await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8'))
    .replace('async function readBridgePayload(nonce) {',`async function readBridgePayload(nonce) {if(nonce==='fixture-success'&&!window.__successHeld){window.__successHeld=true;await new Promise(resolve=>window.__releaseSuccess=resolve)}`)
    .replace('init().catch(console.error);',`window.__olderSuccess=()=>finishRedditReadBatch({nonce:'fixture-success',actionId:++redditReadActionId,created:Date.now(),sequence:0,reads:1,connected:true,closeAcknowledged:true,synced:true,syncRun:syncRunId,startedSyncRun:syncRunId}).then(()=>{window.__successFinished=true});window.__newerFailure=()=>${newerStatus==='article-cleanup'?"(pendingReadHelpers.add('fixture-article'),showReadHelperCleanupNotice())":newerStatus==='X-cleanup'?"(xHelpersAwaitingClose.add('fixture-x'),showXCleanupNotice())":"reportRedditReadNotice({nonce:'fixture-new',actionId:++redditReadActionId,startedSyncRun:syncRunId},'unresponsive')"};init().catch(console.error);`);
  const app=await launchApp({source,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{window.__olderSuccess()});
    await app.page.waitForFunction(()=>window.__releaseSuccess);
    await app.page.evaluate(()=>window.__newerFailure());
    const warning=await app.page.locator('#toast').textContent();
    assert.equal(warning,'Partial sync');
    await app.page.evaluate(()=>window.__releaseSuccess());
    await app.page.waitForFunction(()=>window.__successFinished);
    assert.equal(await app.page.locator('#toast').textContent(),warning,'an older completion does not acknowledge a newer unresolved error');
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),true);
    assert.equal(await app.page.locator('#toast .toast-action').count(),0);
  }finally{await app.browser.close()}
});

test('a successful archive recovery resolves an older Reddit transport error',{timeout:15000},async()=>{
  const post={id:'fresh123',url:STORIES[0].url,title:'Fresh archive metadata',author:'fixture',subreddit:'news',permalink:'/r/news/comments/fresh123/article/',num_comments:17,created_utc:Math.floor(Date.now()/1000)-60,score:17};
  const source=(await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8'))
    .replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;')
    .replace('init().catch(console.error);',`window.__oldReadError=()=>finishRedditReadBatch({nonce:'fixture-old',actionId:redditReadActionId,created:Date.now(),sequence:0,unresponsive:true,startedSyncRun:syncRunId});window.__recoverArchivedRead=()=>runRedditReadAction(async()=>{window.__recoveredRows=await recoverAppRowThreads([{source:'reddit',id:'fresh123',url:${JSON.stringify(STORIES[0].url)}}],[])});init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2},responses:[{match:url=>url.includes('/api/posts/ids?ids=fresh123'),json:{data:[post]}}]});
  await app.context.route('https://www.reddit.com/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const info=path==='/api/info.json';
    const body=path==='/'?'<title>Reddit fixture</title>':path==='/api/me.json'?JSON.stringify({data:{name:'fixture'}}):info?'{}':JSON.stringify({data:{children:[]}});
    return route.fulfill({status:info?403:200,contentType:path==='/'?'text/html':'application/json',body}).catch(()=>{});
  });
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__oldReadError());
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    await app.page.evaluate(()=>window.__recoverArchivedRead());
    const rows=await app.page.evaluate(()=>window.__recoveredRows);
    assert.equal(rows[0]?.key,'reddit:fresh123');assert.equal(rows[0]?.commentCount,17,'the archive returned actual fresh metadata');
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'successful fallback data also retires the obsolete transport warning');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
