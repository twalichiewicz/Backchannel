import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const original=await readFile(process.env.BC_SCRIPT || new URL('../../HNewhere.user.js',import.meta.url),'utf8');
const seam='init().catch(console.error);';
assert.equal(original.split(seam).length,2);
const instrument=setup=>original.replace(seam,`${setup}\n${seam}`);

for(const phase of ['root','reply'])test(`a slow lazy ${phase} cannot block another ready source`,{timeout:20000},async()=>{
  const setup=`{
    const hn=getSource('hn');for(const name of ['discover','recover']){const original=hn[name].bind(hn);hn[name]=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,300));const rows=await original(...args);window.__hnReady=true;return rows}};
    let release;const held=new Promise(resolve=>release=resolve);window.__releaseRoot=release;
    const slow=getSource('bsky');slow.discover=async target=>[{source:'bsky',id:'fixture',key:'bsky:fixture',label:'Bluesky fixture',title:'Fixture discussion',articleURL:target,commentCount:2,collective:true,rootKeys:['bsky:slow'],rootTimes:[]}];
    slow.loadThread=async()=>({rootKeys:['bsky:slow'],rootTimes:new Map(),getComment:async key=>{
      if(${JSON.stringify(phase)}==='reply'&&key==='bsky:slow')return {key,source:'bsky',id:'slow',author:'fixture',bodyHTML:'<p>Slow root</p>',replyKeys:['bsky:child'],createdAt:1};
      window.__slowRoot=true;await held;return null;
    }});
  }`;
  const app=await launchApp({source:instrument(setup),sharedStore:true,settings:{sources:{hn:true,bsky:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.waitForFunction(()=>window.__slowRoot&&window.__hnReady);
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,2500),'the ready source renders before the unrelated lazy comment resolves');
    await app.page.evaluate(()=>window.__releaseRoot());
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',10000));
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a large discussion yields to another source that becomes ready during rendering',{timeout:20000},async()=>{
  const app=await launchApp({source:instrument(`{
    const hn=getSource('hn');for(const name of ['discover','recover']){const original=hn[name].bind(hn);hn[name]=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,600));const rows=await original(...args);window.__hnReady=true;return rows}};
    const roots=Array.from({length:1600},(_,index)=>'bsky:large'+index);const slow=getSource('bsky');
    slow.discover=async target=>[{source:'bsky',id:'fixture',key:'bsky:fixture',label:'Bluesky fixture',title:'Large discussion',articleURL:target,commentCount:roots.length,collective:true,rootKeys:roots,rootTimes:roots.map(()=>1)}];
    slow.loadThread=async()=>({rootKeys:roots,rootTimes:new Map(roots.map(key=>[key,1])),getComment:async key=>({key,source:'bsky',id:key,author:'fixture',bodyHTML:'<p>Large discussion comment</p>',replyKeys:[],createdAt:1})});
  }`),sharedStore:true,settings:{sources:{hn:true,bsky:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.locator('#comments-content .comment[data-comment-id^="bsky:"]').first().waitFor();await app.page.waitForFunction(()=>window.__hnReady);
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,2500),'newly ready comments are visible before the large discussion finishes painting');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const phase of ['discovery','thread']) test(`Reader displays healthy comments while another ${phase} is pending`,{timeout:30000},async()=>{
  const setup=`{
    window.__checks=0;
    const hn=getSource('hn'), discover=hn.discover.bind(hn);
    hn.discover=async (...args)=>{window.__checks++;return discover(...args)};
    let release; const held=new Promise(resolve=>release=resolve);
    window.__releaseSlow=release;
    const slow=getSource('bsky');
    slow.discover=async target=>{
      if(${JSON.stringify(phase)}==='discovery'){window.__slowStarted=true;await held;return []}
      return [{source:'bsky',id:'fixture',key:'bsky:fixture',label:'Bluesky fixture',title:'Fixture discussion',articleURL:target,commentCount:0,rootKeys:[],rootTimes:[]}];
    };
    slow.loadThread=async()=>{window.__slowStarted=true;await held;return {rootKeys:[],rootTimes:new Map(),getComment:async()=>null}};
  }`;
  const app=await launchApp({source:instrument(setup),sharedStore:true,settings:{sources:{hn:true,bsky:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.waitForFunction(()=>window.__slowStarted,{timeout:10000});
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,2500),'healthy comments arrive before releasing the other source');
    assert.equal(await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy'),'true','the operation remains busy while another source is pending');
    await app.page.evaluate(()=>window.__releaseSlow());
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,10000));
    assert.deepEqual(app.errors,[]);
  } finally{await app.browser.close()}
});

test('stalled article and image manager requests finish without blocking queued resources',{timeout:15000},async()=>{
  const source=original.replace('const RESOURCE_REQUEST_TIMEOUT_MS = 15000;','const RESOURCE_REQUEST_TIMEOUT_MS = 100;')
    .replace(seam,'window.__resources={requestPage,requestCardImage};');
  const app=await launchApp({source,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>window.__resources);
    const result=await app.page.evaluate(async()=>{
      let aborted=0;GM.xmlHttpRequest=()=>({abort(){aborted++}});
      const completed={page:false,image:false};
      __resources.requestPage('https://example.com/stalled').then(()=>completed.page=true);
      __resources.requestCardImage('https://example.com/stalled.png').then(()=>completed.image=true);
      await new Promise(resolve=>setTimeout(resolve,300));
      return {...completed,aborted};
    });
    assert.deepEqual(result,{page:true,image:true,aborted:2});
  }finally{await app.browser.close()}
});

test('each Reader reopen checks discovery again while reusing saved comments',{timeout:30000},async()=>{
  const app=await launchApp({source:instrument(`{
    window.__checks=0;const hn=getSource('hn'),discover=hn.discover.bind(hn);
    hn.discover=async(...args)=>{window.__checks++;return discover(...args)};
  }`),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    const first=app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first();
    await first.click();
    await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').first().waitFor({timeout:10000});
    const checks=await app.page.evaluate(()=>window.__checks);
    const requests=app.requests.filter(request=>request.url.includes('hn.algolia.com/api/v1/search')).length;
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[1].title}).first().click();
    await app.page.locator('#comments-content .comment[data-story-id="9002"]').first().waitFor({timeout:10000});
    await first.click();
    await app.page.locator('#comments-content .comment[data-story-id="9001"]').first().waitFor({timeout:10000});
    assert((await app.page.evaluate(()=>window.__checks))>=checks+2,'each article open starts another discovery');
    assert(app.requests.filter(request=>request.url.includes('hn.algolia.com/api/v1/search')).length>=requests+2,'completed discovery cache cannot skip a new article check');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('Reader shows saved comments immediately when a reopened article is still being checked',{timeout:30000},async()=>{
  const app=await launchApp({source:instrument(`{
    const hn=getSource('hn'),discover=hn.discover.bind(hn),recover=hn.recover.bind(hn);
    window.__holdCheck=false;let release;const held=new Promise(resolve=>release=resolve);window.__releaseCheck=release;
    hn.discover=async(...args)=>{if(window.__holdCheck)await held;return discover(...args)};
    hn.recover=async(...args)=>{if(window.__holdCheck)await held;return recover(...args)};
  }`),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    const first=app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first();
    await first.click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-story-id="9001"]').count()===30,10000));
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[1].title}).first().click();
    await app.page.locator('#comments-content .comment[data-story-id="9002"]').first().waitFor({timeout:10000});
    await app.page.evaluate(()=>window.__holdCheck=true);
    await first.click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-story-id="9001"]').count()>0,2000),'saved comments render before new discovery/recovery completes');
    assert.equal(await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy'),'true');
    await app.page.evaluate(()=>window.__releaseCheck());
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(await app.page.locator('#comments-content .comment[data-story-id="9001"]').count(),30);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a healthy feed cannot report Synced when the discussion refresh failed',{timeout:30000},async()=>{
  const app=await launchApp({source:instrument(`{
    const hn=getSource('hn'),load=hn.loadThread.bind(hn);
    hn.loadThread=(...args)=>window.__failComments?Promise.resolve(emptyThreadReader()):load(...args);
  }`),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,10000));
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',10000));
    await app.page.evaluate(()=>window.__failComments=true);
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/^Synced$/,'completion reflects the discussion outcome too');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count(),30);
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    assert.equal(await app.page.locator('#app-discussion-meta .source-menu .discussion-source-status').count(),0,'the failed refresh preserves comments without a diagnostic announcement');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('Sidebar shows a healthy discussion before an unrelated discovery finishes',{timeout:30000},async()=>{
  const app=await launchApp({source:instrument(`{
    let release;const held=new Promise(resolve=>release=resolve);window.__releaseSlow=release;
    getSource('bsky').discover=async()=>{window.__slowStarted=true;await held;return []};
  }`),sharedStore:true,topHosts:[new URL(STORIES[0].url).hostname],settings:{sources:{hn:true,bsky:true},autoOpenSidebar:true,updateCheck:false}});
  try{
    await app.page.goto(STORIES[0].url);
    await app.page.waitForFunction(()=>window.__slowStarted,{timeout:10000});
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,2500),'Sidebar renders available comments while another source is still checking');
    await app.page.evaluate(()=>window.__releaseSlow());
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,10000));
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('cancelled source jobs cannot start work after cache clear and malformed responses are failures',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__jobs={sourceReadJob,clearCache};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.waitForFunction(()=>window.__jobs);
    const result=await app.page.evaluate(async()=>{
      let started=0;
      const pending=__jobs.sourceReadJob('hn','discover','fixture',async()=>{started++;return []});
      await __jobs.clearCache();
      const cancelled=await pending;
      const malformed=await __jobs.sourceReadJob('hn','discover','other',async()=>null);
      return {started,cancelled:cancelled.status,malformed:malformed.status};
    });
    assert.deepEqual(result,{started:0,cancelled:'cancelled',malformed:'unavailable'});
  }finally{await app.browser.close()}
});

test('matching source jobs share a deadline and reject late partial results',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__jobs={sourceReadJob};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__jobs);
    const result=await app.page.evaluate(async()=>{
      let release,publish,signal,calls=0;const observed=[];
      const work=options=>{calls++;publish=options.publish;signal=options.signal;return new Promise(resolve=>release=resolve)};
      const first=__jobs.sourceReadJob('hn','discover','fixture',work,{timeout:80,onPartial:rows=>observed.push(rows)});
      const joined=__jobs.sourceReadJob('hn','discover','fixture',work,{timeout:80});
      while(!publish)await Promise.resolve();publish(['available']);
      const results=await Promise.all([first,joined]);
      const next=await __jobs.sourceReadJob('hn','discover','fixture',async()=>['current']);
      publish(['late']);release(['old']);await Promise.resolve();
      return {calls,aborted:signal.aborted,statuses:results.map(entry=>entry.status),values:results.map(entry=>entry.value),observed,next:next.value};
    });
    assert.deepEqual(result,{calls:1,aborted:true,statuses:['timeout','timeout'],values:[['available'],['available']],observed:[['available']],next:['current']});
  }finally{await app.browser.close()}
});

test('clicking the currently open article checks its discussion again',{timeout:20000},async()=>{
  const app=await launchApp({source:instrument(`{window.__checks=0;const hn=getSource('hn'),discover=hn.discover.bind(hn);hn.discover=(...args)=>{window.__checks++;return discover(...args)}}`),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-rail [data-app-view="all"]').click();
    const link=app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first();
    await link.click();assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-story-id="9001"]').count()===30,10000));
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',10000));
    const before=await app.page.evaluate(()=>window.__checks);await link.click();
    assert(await waitFor(async()=>await app.page.evaluate(()=>window.__checks)>before,1500),'a click on the open link also requests a new check');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('disabling a source rejects its late discovery without cancelling the available source',{timeout:20000},async()=>{
  const app=await launchApp({source:instrument(`{
    let release;const held=new Promise(resolve=>release=resolve);window.__releaseDisabled=release;
    window.__disableSource=()=>saveSettings({sources:{hn:true,bsky:false}});
    getSource('bsky').discover=async target=>{await held;return [{source:'bsky',id:'late',key:'bsky:late',label:'Late disabled source',articleURL:target,commentCount:0,rootKeys:[]}]};
    getSource('bsky').loadThread=async()=>{window.__disabledThreadStarted=true;return {rootKeys:[],rootTimes:new Map(),getComment:async()=>null}};
  }`),sharedStore:true,settings:{sources:{hn:true,bsky:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,10000));
    await app.page.evaluate(async()=>{await window.__disableSource();window.__releaseDisabled()});
    await app.page.waitForTimeout(300);
    assert.equal(await app.page.evaluate(()=>Boolean(window.__disabledThreadStarted)),false,'no new disabled-source thread work starts');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count(),30);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a rate-limited source check preserves saved discussions and respects Retry-After',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__sourceCheck={discoverAll,beginSyncOperation};'),sharedStore:true,settings:{sources:{lemmy:true},updateCheck:false},responses:[{match:url=>url.includes('/api/v3/search'),status:429,headers:'Retry-After: 60',json:{error:'rate limited'}}]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__sourceCheck);
    const result=await app.page.evaluate(async()=>{
      const saved=[{source:'lemmy',id:321,key:'lemmy:321',articleURL:'https://example.com/article',label:'Saved discussion'}];
      const settings={sources:{lemmy:true}};
      const operation=__sourceCheck.beginSyncOperation('discussion');
      const first=await __sourceCheck.discoverAll(['https://example.com/article'],settings,{saved,operation});
      const second=await __sourceCheck.discoverAll(['https://example.com/article'],settings,{saved,operation});
      const status=operation.outcome();operation.finish();return {first:first.map(row=>row.key),second:second.map(row=>row.key),status};
    });
    assert.deepEqual(result,{first:['lemmy:321'],second:['lemmy:321'],status:'partial'});
    assert.equal(app.requests.filter(request=>request.url.includes('/api/v3/search')).length,1,'a repeat click cannot bypass provider cooldown');
  }finally{await app.browser.close()}
});

test('failed refresh does not advance the saved thread fetch timestamp',{timeout:20000},async()=>{
  const app=await launchApp({source:instrument(`{window.__threadCache=()=>threadCache.get('hn:9001')?.at;const hn=getSource('hn'),load=hn.loadThread.bind(hn);hn.loadThread=(...args)=>window.__fail?Promise.resolve(emptyThreadReader()):load(...args)}`),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,10000));
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',10000));
    const before=await app.page.evaluate(()=>window.__threadCache());
    await app.page.evaluate(()=>window.__fail=true);await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(await app.page.evaluate(()=>window.__threadCache()),before,'saved data keeps its real fetch time');
  }finally{await app.browser.close()}
});

test('thread requests retain a provider cooldown after the loader returns a failed reader',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__threads={loadThread};'),sharedStore:true,settings:{sources:{lemmy:true},updateCheck:false},responses:[{match:url=>url.includes('/api/v3/comment/list'),status:429,headers:'Retry-After: 60',json:{error:'limited'}}]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__threads);
    await app.page.evaluate(async()=>{const story={source:'lemmy',id:321,key:'lemmy:321',articleURL:'https://example.com/article'};await __threads.loadThread(story,{force:true});await __threads.loadThread(story,{force:true})});
    assert.equal(app.requests.filter(request=>request.url.includes('/api/v3/comment/list')).length,1,'thread Retry-After survives the timeout/error boundary');
  }finally{await app.browser.close()}
});

test('concurrent rate limits keep the longest provider Retry-After',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__jobs={sourceReadJob};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__jobs);
    const result=await app.page.evaluate(async()=>{
      const releases=[];const long=Date.now()+120000,short=Date.now()+30000;
      const limited=(target,retryAt)=>__jobs.sourceReadJob('hn','discover',target,()=>new Promise((resolve,reject)=>releases.push(()=>reject(Object.assign(new Error('limited'),{readStatus:'limited',retryAt})))));
      const one=limited('one',long),two=limited('two',short);
      while(releases.length<2)await Promise.resolve();releases[0]();await one;releases[1]();await two;
      let attempted=false;const next=await __jobs.sourceReadJob('hn','feed','later',async()=>{attempted=true;return []});
      return {attempted,status:next.status,retryAt:next.retryAt,expected:long};
    });
    assert.deepEqual(result,{attempted:false,status:'limited',retryAt:result.expected,expected:result.expected});
  }finally{await app.browser.close()}
});

test('disabling an unrelated source leaves a healthy pending discussion subscribed',{timeout:20000},async()=>{
  const app=await launchApp({source:instrument(`{
    let release;const held=new Promise(resolve=>release=resolve);window.__releaseHealthy=release;
    window.__disableUnrelated=()=>saveSettings({sources:{hn:true,bsky:false}});
    const hn=getSource('hn'),load=hn.loadThread.bind(hn);hn.loadThread=async(...args)=>{window.__healthyStarted=true;await held;return load(...args)};
    getSource('bsky').discover=async()=>[];
  }`),sharedStore:true,settings:{sources:{hn:true,bsky:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.waitForFunction(()=>window.__healthyStarted);
    await app.page.evaluate(async()=>{await window.__disableUnrelated();window.__releaseHealthy()});
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()===30,2500),'the still-enabled source finishes normally');
  }finally{await app.browser.close()}
});

test('known metadata failures and HN parent failures remain failures instead of confirmed empty',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__reads={recoverAppRowThreads,loadThread,beginSyncOperation};'),sharedStore:true,settings:{sources:{hn:true,lemmy:true},updateCheck:false},responses:[
    {match:url=>url.includes('/api/v3/post?id=321'),status:503,json:{}},
    {match:url=>url.endsWith('/v0/item/444.json'),status:503,json:null},
  ]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__reads);
    const result=await app.page.evaluate(async()=>{
      const recovery=__reads.beginSyncOperation('discussion');
      const rows=await __reads.recoverAppRowThreads([{source:'lemmy',id:321,url:'https://example.com/article',title:'Known feed story',descendants:10}],[],new Map(),null,recovery);
      const recoveryStatus=recovery.outcome();recovery.finish();
      const thread=__reads.beginSyncOperation('discussion');
      await __reads.loadThread({source:'hn',id:444,key:'hn:444',articleURL:'https://example.com/article',commentCount:30,rootKeys:[]},{force:true,operation:thread});
      const threadStatus=thread.outcome();thread.finish();return {keys:rows.map(row=>row.key),recoveryStatus,threadStatus};
    });
    assert.deepEqual(result,{keys:['lemmy:321'],recoveryStatus:'partial',threadStatus:'partial'});
  }finally{await app.browser.close()}
});

test('clearing caches prevents a cancelled HN item from reappearing after a late callback',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__reads={getItem,itemCache,sourceReadJob,clearCache};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__reads);
    const result=await app.page.evaluate(async()=>{
      let reply;GM.xmlHttpRequest=options=>{reply=options.onload;return {abort(){}}};
      const job=__reads.sourceReadJob('hn','recover','444',async()=>{await __reads.getItem(444);return []});
      while(!reply)await Promise.resolve();await __reads.clearCache();
      reply({status:200,responseText:JSON.stringify({id:444,type:'story',title:'Late story'})});await Promise.resolve();await Promise.resolve();
      return {status:(await job).status,cached:__reads.itemCache.has('444')};
    });
    assert.deepEqual(result,{status:'cancelled',cached:false});
  }finally{await app.browser.close()}
});

for(const action of ['clear','newer'])test(`a delayed shared thread read cannot overwrite ${action==='clear'?'Clear cache':'a newer forced thread'}`,{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__reads={loadThread,threadCache,clearCache,getSource};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__reads);
    const result=await app.page.evaluate(async(action)=>{
      const story={source:'hn',id:444,key:'hn:444',articleURL:'https://example.com/article',rootKeys:[]};let release;
      const get=GM.getValue;GM.getValue=(key,fallback)=>key==='HNewhere:thread_cache:hn:444'?new Promise(resolve=>release=()=>resolve({version:1,at:Date.now()-1000,rootKeys:['hn:old'],rootTimes:[['hn:old',1]],comments:{'hn:old':{key:'hn:old',text:'Old',replyKeys:[]}}})):get(key,fallback);
      const pending=__reads.loadThread(story);while(!release)await Promise.resolve();
      if(action==='clear')await __reads.clearCache();
      else{__reads.getSource('hn').loadThread=async()=>({rootKeys:['hn:new'],rootTimes:new Map(),getComment:async()=>null});await __reads.loadThread(story,{force:true})}
      release();await pending;return __reads.threadCache.get(story.key)?.reader.rootKeys||[];
    },action);
    assert.deepEqual(result,action==='clear'?[]:['hn:new']);
  }finally{await app.browser.close()}
});

for(const force of [false,true])test(`${force?'a cache-eligible caller joins an active forced thread':'compatible thread callers share the cache read and both receive the result'}`,{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__reads={loadThread,getSource};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__reads);
    const result=await app.page.evaluate(async(force)=>{
      let calls=0;__reads.getSource('hn').loadThread=async()=>{calls++;return {rootKeys:['hn:1'],rootTimes:new Map(),getComment:async()=>null}};
      const story={source:'hn',id:444,key:'hn:444',articleURL:'https://example.com/article',rootKeys:[]};
      const readers=await Promise.all([__reads.loadThread(story,{force}),__reads.loadThread(story)]);return {calls,roots:readers.map(reader=>reader.rootKeys)};
    },force);
    assert.deepEqual(result,{calls:1,roots:[['hn:1'],['hn:1']]});
  }finally{await app.browser.close()}
});

test('source jobs bound one provider while allowing another provider to run',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__jobs={sourceReadJob};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__jobs);
    const result=await app.page.evaluate(async()=>{
      let active=0,max=0,other=false;const releases=[];
      const jobs=Array.from({length:6},(_,index)=>__jobs.sourceReadJob('hn','discover',String(index),()=>new Promise(resolve=>{active++;max=Math.max(max,active);releases.push(()=>{active--;resolve([])})})));
      const independent=__jobs.sourceReadJob('lemmy','discover','other',async()=>{other=true;return []});
      for(let i=0;i<10;i++)await Promise.resolve();
      const before={active,other};while(releases.length||active){releases.splice(0).forEach(release=>release());for(let i=0;i<15;i++)await Promise.resolve()}
      await Promise.all([...jobs,independent]);return {max,before};
    });
    assert.deepEqual(result,{max:3,before:{active:3,other:true}});
  }finally{await app.browser.close()}
});

test('cancelling one view detaches its shared job while another subscriber completes',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__jobs={sourceReadJob,beginSyncOperation};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__jobs);
    const result=await app.page.evaluate(async()=>{
      const first=__jobs.beginSyncOperation('discussion','first'),second=__jobs.beginSyncOperation('discussion','second');let release,signal,calls=0;
      const work=options=>{calls++;signal=options.signal;return new Promise(resolve=>release=resolve)};
      const one=__jobs.sourceReadJob('hn','discover','shared',work,{operation:first});
      const two=__jobs.sourceReadJob('hn','discover','shared',work,{operation:second});
      while(!release)await Promise.resolve();first.finish('cancelled');const aborted=signal.aborted;
      release(['available']);const result={calls,aborted,one:(await one).status,two:(await two).value};second.finish();return result;
    });
    assert.deepEqual(result,{calls:1,aborted:false,one:'cancelled',two:['available']});
  }finally{await app.browser.close()}
});

test('a delayed shared-thread cache write cannot undo Clear cache',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__shared={rememberThread,threadCache,persistSharedThreads,clearCache,load};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__shared);
    const value=await app.page.evaluate(async()=>{
      const story={source:'hn',id:1,key:'hn:1',articleURL:'https://example.com/article'};
      __shared.rememberThread(__shared.threadCache,story.key,{rootKeys:[],rootTimes:new Map(),getComment:async()=>null},Date.now());
      const original=GM.getValue;let release,hold=true;
      GM.getValue=(key,fallback)=>key==='HNewhere:thread_cache:hn:1'&&hold?new Promise(resolve=>{release=()=>{hold=false;resolve(null)}}):original(key,fallback);
      const pending=__shared.persistSharedThreads([story]);while(!release)await Promise.resolve();
      await __shared.clearCache();release();await pending;return __shared.load('HNewhere:thread_cache:hn:1',null);
    });
    assert.equal(value,null,'a late snapshot remains invalidated');
  }finally{await app.browser.close()}
});

test('HTML feeds preserve Retry-After through the common source coordinator',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__feeds={frontPageFeedResult};'),sharedStore:true,settings:{sources:{hn:true},updateCheck:false},responses:[{match:url=>url==='https://news.ycombinator.com/news',status:429,headers:'Retry-After: 60',text:'Too many requests'}]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__feeds);
    const result=await app.page.evaluate(async()=>{const feed={kind:'front',source:'hn'};const one=await __feeds.frontPageFeedResult(feed,true);const two=await __feeds.frontPageFeedResult(feed,true);return {one:one.status,two:two.status,retry:one.retryAt>Date.now()+59000}});
    assert.deepEqual(result,{one:'limited',two:'limited',retry:true});
    assert.equal(app.requests.filter(request=>request.url==='https://news.ycombinator.com/news').length,1);
  }finally{await app.browser.close()}
});

test('a failed lazy Bluesky root marks its reader incomplete',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__source=getSource("bsky");'),sharedStore:true,settings:{sources:{bsky:true},updateCheck:false},responses:[{match:url=>url.includes('/app.bsky.feed.getPostThread'),status:503,json:{error:'unavailable'}}]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__source);
    const value=await app.page.evaluate(async()=>{const key='bsky:did:plc:fixture/post';const reader=await __source.loadThread({source:'bsky',id:'fixture',key:'bsky:fixture',rootKeys:[key],rootTimes:[]});await reader.getComment(key);return Boolean(reader.incomplete)});
    assert.equal(value,true,'missing network data cannot be reported as a complete discussion');
  }finally{await app.browser.close()}
});

test('federated recovery and Wikipedia page failures remain incomplete outcomes',{timeout:15000},async()=>{
  const app=await launchApp({source:original.replace(seam,'window.__adapters={getSource,recoverAppRowThreads,beginSyncOperation};'),sharedStore:true,settings:{sources:{mastodon:true,wikipedia:true},updateCheck:false},responses:[
    {match:url=>url.includes('/api/v1/timelines/link'),status:503,json:{}},
    {match:url=>url.includes('action=discussiontoolspageinfo'),status:503,json:{}},
  ]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__adapters);
    const value=await app.page.evaluate(async()=>{
      const op=__adapters.beginSyncOperation('discussion');await __adapters.recoverAppRowThreads([{source:'mastodon',id:'known',url:'https://example.com/article'}],[],new Map(),null,op);const recovered=op.outcome();op.finish();
      const reader=await __adapters.getSource('wikipedia').loadThread({source:'wikipedia',id:'fixture',key:'wikipedia:fixture',articleURL:'https://example.com/article',wikiPages:[{pageid:1,title:'Talk:Example',time:1}]});return {recovered,incomplete:Boolean(reader.incomplete)};
    });
    assert.deepEqual(value,{recovered:'partial',incomplete:true});
  }finally{await app.browser.close()}
});

test('an unavailable check for an external article does not claim no discussions were found',{timeout:15000},async()=>{
  const app=await launchApp({source:instrument('window.__openExternal=()=>openAppStory({url:"https://framed.example.com/post/unknown",title:"External article"});'),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},responses:[{match:url=>url.includes('hn.algolia.com/api/v1/search'),status:503,json:{error:'unavailable'}}]});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__openExternal());
    assert.match(await app.page.locator('#comments-content').innerText(),/couldn.t check.*sources/i);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
