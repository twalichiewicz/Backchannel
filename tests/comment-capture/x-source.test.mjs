import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium, firefox, webkit} from 'playwright';

const browserType=({chromium,firefox,webkit}[process.env.ENGINE] || chromium);

test('X posts form a partial discussion with verified parent links', {timeout:30000}, async()=>{
  const source=await readFile(process.env.BC_SCRIPT || new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const regions=[...source.matchAll(/\/\/ #region hnewhere-test-export([\s\S]*?)\/\/ #endregion hnewhere-test-export/g)].map(m=>m[1]);
  const browser=await browserType.launch();
  try {
    const page=await browser.newPage();
    const result=await page.evaluate(code=>{
      const api=new Function(code+'\nreturn { collective:typeof xCollective === "function" ? xCollective : null, index:typeof xThreadIndex === "function" ? xThreadIndex : null };')();
      if(!api.collective || !api.index)return {available:false};
      const article='https://example.com/article?story=1';
      const posts=[
        {id:'101',author:'one',text:'A <script>bad</script> link',createdAt:100,permalink:'https://x.com/one/status/101',parentId:null},
        {id:'102',author:'two',text:'A reply',createdAt:110,permalink:'https://x.com/two/status/102',parentId:'101'},
        {id:'103',author:'three',text:'Unknown parent',createdAt:120,permalink:'https://x.com/three/status/103',parentId:'999'},
        {id:'101',author:'one',text:'duplicate',createdAt:100,permalink:'https://x.com/one/status/101',parentId:null},
      ];
      const discussion=api.collective(article,posts);
      const thread=api.index(discussion);
      return {available:true,source:discussion.source,article:discussion.articleURL,roots:thread.rootKeys,incomplete:thread.incomplete,
        parent:thread.byKey.get('x:102')?.parentKey,replies:thread.byKey.get('x:101')?.replyKeys,
        unknownParent:thread.byKey.get('x:103')?.parentKey,body:thread.byKey.get('x:101')?.bodyHTML};
    },regions.join('\n'));
    assert.equal(result.available,true,'X source normalization is available');
    assert.equal(result.source,'x');
    assert.equal(result.article,'https://example.com/article?story=1');
    assert.deepEqual(result.roots,['x:101','x:103']);
    assert.equal(result.incomplete,true,'bounded results must be disclosed as incomplete');
    assert.equal(result.parent,'x:101');
    assert.deepEqual(result.replies,['x:102']);
    assert.equal(result.unknownParent,null,'unknown parents cannot be invented');
    assert.doesNotMatch(result.body,/<script>/i,'post text cannot become executable markup');
  } finally {await browser.close()}
});

import {launchApp, STORIES, waitFor} from './harness.mjs';

const xSearchHTML=(article)=>`<!doctype html><html><body>
<a data-testid="AppTabBar_Profile_Link" href="/fixture">Profile</a>
<article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice</a></div>
<div data-testid="tweetText">A public post about this article <a href="${article}">article</a></div>
<a href="/alice/status/101"><time datetime="2026-01-02T03:04:05Z">date</time></a></article>
</body></html>`;

async function readerCheckFinished(app){
  assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').count()>0&&await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true'&&await app.page.locator('.discussion-progress-strip:not([aria-hidden="true"])').count()===0,15000),'the source checks finish');
}

test('enabled X shows a verified public post without partial-load diagnostics in Reader', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'alice'},text:'A public post about this article',entities:{urls:[{expanded_url:article}]}}}]});
  const opened=[];
  app.context.on('page',page=>opened.push(page));
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    assert(await app.page.locator('input[data-source="x"]').count(),'X is available in the source settings');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    const comment=app.page.locator('#comments-content .comment[data-comment-id="x:101"]');
    await comment.waitFor({timeout:20000});
    assert.match(await comment.innerText(),/A public post about this article/);
    assert(opened.length>0,'a first-party X helper was opened');
    const menu=app.page.locator('#app-discussion-meta .page-header-disclosure');
    await menu.click();
    assert.equal(await app.page.locator('#app-discussion-meta .source-menu .discussion-source-status').count(),0,'bounded search results are shown without an implementation diagnostic');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('X is opt-in and opens no helper when disabled', {timeout:30000}, async()=>{
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const checkbox=app.page.locator('input[data-source="x"]').first();
    assert.equal(await checkbox.count(),1,'X is offered in source settings');
    assert.equal(await checkbox.isChecked(),false,'existing users do not enable X automatically');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    assert(await waitFor(()=>app.page.locator('#comments-content .comment').count().then(n=>n>0)));
    assert.equal(opened.length,0,'disabled X makes no helper tab');
  } finally {await app.browser.close()}
});

test('a blocked X helper leaves the other sources readable without a search notice', {timeout:30000}, async()=>{
  const script=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const source=script.replace('init().catch(console.error);', 'if (location.hostname === "backchnnl.app") GM.openInTab = async () => null; init().catch(console.error);');
  const app=await launchApp({source,sharedStore:true,tabs:true,settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    await readerCheckFinished(app);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'an unsuccessful search does not add a source announcement');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('X does not display a search card that cannot be confirmed as a public post', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="x:101"]').count(),0,'unconfirmed X content is not displayed');
    await readerCheckFinished(app);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'unverified results are quietly omitted');
  } finally {await app.browser.close()}
});

test('X rejects a card when the public post author does not match its displayed author', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'someone_else'}}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="x:101"]').count(),0,'a mismatched public post cannot authenticate the card');
    await readerCheckFinished(app);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'an unmatched author does not add a source announcement');
  } finally {await app.browser.close()}
});

test('X verification finishes when a manager never calls its request callbacks', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const X_REQUEST_TIMEOUT_MS = 3000;', 'const X_REQUEST_TIMEOUT_MS = 60;');
  source=source.replace('init().catch(console.error);', 'globalThis.__xTimeoutTest = { xResolvedLink, xPublicPost };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(globalThis.__xTimeoutTest));
    const result=await app.page.evaluate(async()=>{
      GM.xmlHttpRequest=()=>({abort(){}});
      return Promise.race([
        Promise.all([__xTimeoutTest.xResolvedLink('https://t.co/example','https://example.com/article'),__xTimeoutTest.xPublicPost('101','alice')]),
        new Promise(resolve=>setTimeout(()=>resolve('hung'),500)),
      ]);
    });
    assert.deepEqual(result,[false,null],'verification must fail closed instead of hanging');
  } finally {await app.browser.close()}
});

test('turning X off while verification is pending prevents the helper publishing posts', {timeout:45000}, async()=>{
  const script=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const source=script.replace('init().catch(console.error);', `if (location.hostname === "x.com") { const original=GM.setValue; GM.setValue=async (key,value)=>{ if (/^HNewhere:bridge_result:[a-f0-9]{32}$/.test(key)) await original("test:x-publication",value); return original(key,value); }; } init().catch(console.error);`);
  const article=STORIES[0].url;
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),delay:900,status:200,json:{id_str:'101',user:{screen_name:'alice'}}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    assert(await waitFor(()=>app.requests.some(r=>r.url.startsWith('https://cdn.syndication.twimg.com/')),10000),'verification reached the public-post request');
    const settings=app.store.get('HNewhere:settings');app.store.set('HNewhere:settings',{...settings,sources:{...settings.sources,x:false}});
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor({timeout:15000});
    assert.equal(app.store.has('test:x-publication'),false,'the disabled source must not publish the collected post');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="x:101"]').count(),0);
  } finally {await app.browser.close()}
});

test('X post identities reject insecure or credential-bearing permalinks', {timeout:30000}, async()=>{
  const source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const regions=[...source.matchAll(/\/\/ #region hnewhere-test-export([\s\S]*?)\/\/ #endregion hnewhere-test-export/g)].map(m=>m[1]);
  const browser=await browserType.launch();
  try{
    const page=await browser.newPage();
    const result=await page.evaluate(code=>{
      const api=new Function(code+'\nreturn { xCollective };')();
      const post={id:'101',author:'alice',text:'post',createdAt:1,parentId:null};
      return ['http://x.com/alice/status/101','https://user:pass@x.com/alice/status/101','https://evil.example/alice/status/101'].map(permalink=>api.xCollective('https://example.com/a',[{...post,permalink}]));
    },regions.join('\n'));
    assert.deepEqual(result,[null,null,null]);
  }finally{await browser.close()}
});

test('X displays the public post text instead of unverified search-card text', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'alice'},text:'The verified public text',entities:{urls:[{expanded_url:article}]}}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    const comment=app.page.locator('#comments-content .comment[data-comment-id="x:101"]');
    await comment.waitFor({timeout:20000});
    assert.match(await comment.innerText(),/The verified public text/);
    assert.doesNotMatch(await comment.innerText(),/A public post about this article/);
  } finally {await app.browser.close()}
});

test('X is discovered in the article sidebar and refreshed by Sync', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const response={match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'alice'},text:'First public post',entities:{urls:[{expanded_url:article}]}}};
  const app=await launchApp({appHost:new URL(article).hostname,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},autoOpenSidebar:true,updateCheck:false},responses:[response]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto(article);
    const comment=app.page.locator('#comments-content .comment[data-comment-id="x:101"]');
    await comment.waitFor({timeout:20000});
    assert.match(await comment.innerText(),/First public post/);
    response.json.text='Updated public post';
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(async()=>/Updated public post/.test(await comment.innerText().catch(()=>'')),15000),'Sync refreshes the X post');
    assert.equal(await comment.count(),1,'refresh does not duplicate a post');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('X search finishes when the manager never resolves opening a tab', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const X_SEARCH_WAIT_MS = 10000;', 'const X_SEARCH_WAIT_MS = 100;');
  source=source.replace('init().catch(console.error);', 'globalThis.__xOpenTest = { xSearchWindow };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(globalThis.__xOpenTest));
    const result=await app.page.evaluate(async()=>{
      GM.openInTab=()=>new Promise(()=>{});
      return Promise.race([
        __xOpenTest.xSearchWindow('https://example.com/article'),
        new Promise(resolve=>setTimeout(()=>resolve('hung'),2000)),
      ]);
    });
    assert.equal(result.status,'unavailable','a stalled tab open must not hang discovery');
  } finally {await app.browser.close()}
});

test('X resolves shortened links but rejects a different destination', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);', 'globalThis.__xLinkTest = { xResolvedLink };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false},responses:[{match:url=>url==='https://t.co/example',status:200,text:'<meta http-equiv="refresh" content="0; URL=https://example.com/article?story=1">'}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(globalThis.__xLinkTest));
    const result=await app.page.evaluate(async()=>Promise.all([
      __xLinkTest.xResolvedLink('https://t.co/example','https://example.com/article?story=1'),
      __xLinkTest.xResolvedLink('https://t.co/example','https://example.com/article?story=2'),
      __xLinkTest.xResolvedLink('https://evil.example/example','https://example.com/article?story=1'),
    ]));
    assert.deepEqual(result,[true,false,false]);
  } finally {await app.browser.close()}
});

test('a failed X refresh quietly keeps the previously displayed post', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const response={match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'alice'},text:'Previously displayed post',entities:{urls:[{expanded_url:article}]}}};
  const app=await launchApp({appHost:new URL(article).hostname,sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},autoOpenSidebar:true,updateCheck:false},responses:[response]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto(article);
    const comment=app.page.locator('#comments-content .comment[data-comment-id="x:101"]');
    await comment.waitFor({timeout:20000});
    response.status=503;
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#browse-home-sync').getAttribute('aria-busy')!=='true',15000));
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'a partial refresh does not add a search diagnostic');
    assert.match(await comment.innerText(),/Previously displayed post/,'the existing discussion remains readable');
  } finally {await app.browser.close()}
});

test('an X login redirect reports that sign-in is needed', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);', 'globalThis.__xLoginTest = { dispatchXSearchWindow, stageBridgePayload, normalizeURL };');
  const nonce='0123456789abcdef0123456789abcdef';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false}});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>Sign in</body></html>'}));
  try {
    await app.page.goto('https://x.com/login#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>Boolean(globalThis.__xLoginTest));
    await app.page.evaluate(async(nonce)=>{
      const target='https://example.com/article';
      window.close=()=>{};
      await __xLoginTest.stageBridgePayload(nonce,{kind:'x-search',nonce,target,query:'url:'+__xLoginTest.normalizeURL(target),expires:Date.now()+10000});
      await __xLoginTest.dispatchXSearchWindow();
    },nonce);
    assert.equal(app.store.get('HNewhere:bridge_result:'+nonce)?.status,'signin');
  } finally {await app.browser.close()}
});

test('X rejects a search card when the public post no longer links the article', {timeout:45000}, async()=>{
  const article=STORIES[0].url;
  const app=await launchApp({sharedStore:true,tabs:true,topHosts:['x.com'],settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.startsWith('https://cdn.syndication.twimg.com/'),status:200,json:{id_str:'101',user:{screen_name:'alice'},text:'Edited post',entities:{urls:[{expanded_url:'https://example.com/other'}]}}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:xSearchHTML(article)}));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="x:101"]').count(),0);
    await readerCheckFinished(app);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0,'an unrelated result is quietly omitted');
  } finally {await app.browser.close()}
});

test('a failed X search uses the normal empty state when no source finds a discussion', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);', 'if (location.hostname === "unknown.example.com") GM.openInTab = async () => null; init().catch(console.error);');
  const app=await launchApp({source,appHost:'unknown.example.com',sharedStore:true,tabs:true,settings:{sources:{hn:true,x:true},frontPageMode:'sources',updateCheck:false}});
  await app.context.route('https://unknown.example.com/article',route=>route.fulfill({status:200,contentType:'text/html',body:'<html><head><title>No matches</title></head><body>test</body></html>'}));
  try {
    await app.page.goto('https://unknown.example.com/article');
    await app.page.locator('#hn-submit-button').click({timeout:15000});
    assert(await waitFor(async()=>await app.page.locator('#comments-content .no-discussion').count()===1,5000));
    assert.match(await app.page.locator('#comments-content .no-discussion').textContent(),/No discussion found for this page yet/);
    assert.equal(await app.page.locator('#comments-content .x-source-notice').count(),0);
  } finally {await app.browser.close()}
});
