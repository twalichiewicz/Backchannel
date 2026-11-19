import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES, waitFor} from './harness.mjs';

for (const commentsAvailable of [true,false]) test(`a known large Reddit discussion is ${commentsAvailable?'loaded':'reported unavailable'} when its metadata lookup fails`, {timeout:45000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;');
  const url=STORIES[0].url,id='large123',now=Math.floor(Date.now()/1000);
  const post={id,url,title:STORIES[0].title,author:'reader',subreddit:'news',subreddit_name_prefixed:'r/news',permalink:`/r/news/comments/${id}/article/`,num_comments:4028,created_utc:now-3600,score:100};
  const redditStory={source:'reddit',id,url,title:post.title,by:post.author,score:post.score,time:post.created_utc,descendants:post.num_comments,site:'r/news',permalink:'https://www.reddit.com'+post.permalink};
  const hnStory={source:'hn',id:String(STORIES[0].id),url,title:STORIES[0].title,by:STORIES[0].by,score:STORIES[0].points,time:STORIES[0].time,descendants:STORIES[0].comments};
  const cache={timestamp:Date.now(),rows:[{story:redditStory,also:[hnStory]}],sources:['hn','reddit'],topics:[]};
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2,'HNewhere:frontpage_cache:hn,reddit':cache}});
  const paths=[];
  await app.context.route('https://www.reddit.com/**',async route=>{
    const request=new URL(route.request().url()),path=request.pathname;paths.push(path+request.search);
    if(path==='/')return route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'});
    if(path==='/api/me.json')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{name:'fixture'}})});
    if(path==='/api/info.json' && request.searchParams.has('id'))return route.fulfill({status:403,contentType:'application/json',body:'{"reason":"private"}'});
    if(path.includes('/comments/')) {
      if(!commentsAvailable)return route.fulfill({status:403,contentType:'application/json',body:'{"reason":"private"}'});
      const comment={kind:'t1',data:{id:'knowncomment',body:'A comment from the known Reddit discussion',author:'reader',parent_id:'t3_'+id,link_id:'t3_'+id,created_utc:now-60,replies:''}};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{children:[{kind:'t3',data:post}]}},{data:{children:[comment]}}])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{"data":{"children":[]}}'});
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:post.title}).first().click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,20000),'another source remains available');
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').count()>0 && await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',20000),'all source checks settle after the first comments appear');
    const disclosure=app.page.locator('#app-discussion-meta .page-header-disclosure');
    await disclosure.click();
    const menu=app.page.locator('#app-discussion-meta .source-menu');
    assert.match(await menu.innerText(),/r\/news/i,'the known Reddit discussion remains listed');
    assert(paths.some(path=>path.includes('/comments/large123/')),'the actual Reddit thread was attempted');
    if(commentsAvailable) {
      assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id="reddit:knowncomment"]').count()===1,10000),'the available Reddit comment appears');
      assert.equal(await menu.locator('.discussion-source-status').count(),0,'a smaller response does not add a load diagnostic');
      assert.doesNotMatch(await menu.innerText(),/\d+ loaded/i,'only the reported comment total is shown');
    }
    else assert.equal(await menu.locator('.discussion-source-status').count(),0,'an unavailable thread does not add a load diagnostic');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('a known Reddit fallback only accepts the matching safe discussion URL', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__redditFeedFallback = redditDiscussionFromFeed;');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditFeedFallback));
    const result=await app.page.evaluate(()=>{
      const story={id:'large123',url:'https://example.com/article',permalink:'https://www.reddit.com/r/news/comments/large123/article/',descendants:4028,site:'r/news'};
      return [story,{...story,permalink:'https://www.reddit.com/r/news/comments/other/article/'},{...story,permalink:'https://evil.example/r/news/comments/large123/article/'},{...story,permalink:'https://www.reddit.com/r/news/comments/large123/article/?x=1'},{...story,url:'https://user:pass@example.com/article'}].map(item=>__redditFeedFallback(item));
    });
    assert.equal(result[0]?.key,'reddit:large123');
    assert.equal(result[0]?.commentCount,4028);
    assert.deepEqual(result.slice(1),[null,null,null,null]);
  } finally {await app.browser.close()}
});

test('a successful empty Reddit metadata response does not restore an old feed post', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__redditSource = getSource("reddit");');
  const app=await launchApp({source,sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},updateCheck:false},responses:[{match:url=>url.startsWith('https://www.reddit.com/api/info.json'),status:200,json:{data:{children:[]}}}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditSource));
    const result=await app.page.evaluate(()=>__redditSource.recover({id:'large123',url:'https://example.com/article',permalink:'https://www.reddit.com/r/news/comments/large123/article/',descendants:4028}));
    assert.deepEqual(result,[]);
  } finally {await app.browser.close()}
});

test('Reader does not restore a stale feed post after an authoritative empty Reddit lookup', {timeout:30000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('let redditReadInitialAttempted = false;','let redditReadInitialAttempted = true;');
  const url=STORIES[0].url,id='large123';
  const redditStory={source:'reddit',id,url,title:STORIES[0].title,by:'reader',score:100,time:Math.floor(Date.now()/1000)-3600,descendants:4028,site:'r/news',permalink:`https://www.reddit.com/r/news/comments/${id}/article/`};
  const hnStory={source:'hn',id:String(STORIES[0].id),url,title:STORIES[0].title,by:STORIES[0].by,score:STORIES[0].points,time:STORIES[0].time,descendants:STORIES[0].comments};
  const cache={timestamp:Date.now(),rows:[{story:redditStory,also:[hnStory]}],sources:['hn','reddit'],topics:[]};
  const app=await launchApp({source,sharedStore:true,handler:'Userscripts',tabs:true,topHosts:['www.reddit.com'],settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:reddit_read_window_notice':2,'HNewhere:frontpage_cache:hn,reddit':cache}});
  let lookups=0,threads=0;
  await app.context.route('https://www.reddit.com/**',route=>{
    const request=new URL(route.request().url()),path=request.pathname;
    if(path==='/')return route.fulfill({status:200,contentType:'text/html',body:'<title>Reddit fixture</title>'});
    if(path==='/api/me.json')return route.fulfill({status:200,contentType:'application/json',body:'{"data":{"name":"fixture"}}'});
    if(path==='/api/info.json' && request.searchParams.has('id')) {lookups++;return route.fulfill({status:lookups===1?200:403,contentType:'application/json',body:lookups===1?'{"data":{"children":[]}}':'{"reason":"private"}'});}
    if(path.includes('/comments/'))threads++;
    return route.fulfill({status:200,contentType:'application/json',body:'{"data":{"children":[]}}'});
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:redditStory.title}).first().click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,20000));
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').count()>0 && await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',20000));
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    assert.doesNotMatch(await app.page.locator('#app-discussion-meta .source-menu').innerText(),/r\/news/i);
    assert.equal(lookups,1,'Reader does not repeat the already completed metadata lookup');
    assert.equal(threads,0);
  } finally {await app.browser.close()}
});

test('malformed Reddit metadata retains a valid known feed discussion', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__redditSource = getSource("reddit");');
  const app=await launchApp({source,sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},updateCheck:false},responses:[{match:url=>url.startsWith('https://www.reddit.com/api/info.json'),status:200,json:{}}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditSource));
    const result=await app.page.evaluate(()=>__redditSource.recover({id:'large123',url:'https://example.com/article',permalink:'https://www.reddit.com/r/news/comments/large123/article/',descendants:4028}));
    assert.equal(result[0]?.key,'reddit:large123');
  } finally {await app.browser.close()}
});

for (const wrongURL of [false,true]) test(`a matching Reddit metadata item with ${wrongURL?'a different article URL':'missing required fields'} is handled safely`, {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__redditSource = getSource("reddit");');
  const post=wrongURL?{id:'large123',url:'https://example.com/different',permalink:'/r/news/comments/large123/article/',num_comments:4028}:{id:'large123'};
  const app=await launchApp({source,sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},updateCheck:false},responses:[{match:url=>url.startsWith('https://www.reddit.com/api/info.json'),status:200,json:{data:{children:[{kind:'t3',data:post}]}}}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditSource));
    const result=await app.page.evaluate(()=>__redditSource.recover({id:'large123',url:'https://example.com/article',permalink:'https://www.reddit.com/r/news/comments/large123/article/',descendants:4028}));
    if(wrongURL)assert.deepEqual(result,[],'a confirmed different destination is not restored');
    else {assert.equal(result[0]?.key,'reddit:large123');assert.equal(result[0]?.permalink,'https://www.reddit.com/r/news/comments/large123/article/');assert.equal(result[0]?.articleURL,'https://example.com/article');}
  } finally {await app.browser.close()}
});

test('a timed-out Reddit metadata lookup retains a valid known feed discussion', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('const RECOVER_CEILING_MS = 30000;','const RECOVER_CEILING_MS = 200;');
  source=source.replace('init().catch(console.error);','globalThis.__redditRecoveryTest = { recoverAppRowThreads, getSource };');
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditRecoveryTest));
    const result=await app.page.evaluate(async()=>{
      __redditRecoveryTest.getSource('reddit').recover=()=>new Promise(()=>{});
      return __redditRecoveryTest.recoverAppRowThreads([{source:'reddit',id:'large123',url:'https://example.com/article',permalink:'https://www.reddit.com/r/news/comments/large123/article/',descendants:4028}],[]);
    });
    assert.equal(result[0]?.key,'reddit:large123');
  } finally {await app.browser.close()}
});

for (const moreMode of ['complete','partial','none']) test(`a short Reddit response with ${moreMode} expandable coverage reports completeness`, {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__redditSource = getSource("reddit");');
  const comment={kind:'t1',data:{id:'one',body:'A comment',author:'reader',parent_id:'t3_large123',link_id:'t3_large123',created_utc:1,replies:''}};
  const children=[comment,...(moreMode!=='none'?[{kind:'more',data:{children:['two','three'],count:moreMode==='complete'?4027:2}}]:[])];
  const app=await launchApp({source,sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},updateCheck:false},responses:[{match:url=>url.includes('/r/news/comments/large123/article/.json'),status:200,json:[{data:{children:[]}},{data:{children}}]}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>Boolean(window.__redditSource));
    const result=await app.page.evaluate(async()=>{
      const thread=await __redditSource.loadThread({source:'reddit',key:'reddit:large123',id:'large123',commentCount:4028,permalink:'https://www.reddit.com/r/news/comments/large123/article/'});
      return {incomplete:thread.incomplete,more:thread.rootMore?.ids||[]};
    });
    assert.equal(result.incomplete,moreMode!=='complete');
    assert.deepEqual(result.more,moreMode!=='none'?['two','three']:[]);
  } finally {await app.browser.close()}
});
