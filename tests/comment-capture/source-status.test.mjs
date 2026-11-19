import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, waitFor} from './harness.mjs';

function feedFixture() {
  let healthy=false;
  const response={match:url=>url.includes('lemmy.world/api/v3/post/list'),get status(){return healthy?200:503},get json(){return healthy?{posts:[]}:{error:'fixture outage'}}};
  const hn={source:'hn',id:String(STORIES[0].id),url:STORIES[0].url,title:STORIES[0].title,by:STORIES[0].by,score:STORIES[0].points,time:STORIES[0].time,descendants:STORIES[0].comments};
  const lemmy={source:'lemmy',id:'765',url:'https://framed.example.com/probe-lemmy',title:'Saved Lemmy article',by:'reader',score:9,time:STORIES[0].time,descendants:3};
  return {
    response,
    recover(){healthy=true},
    cache:{timestamp:Date.now()-600000,rows:[{story:hn,also:[]},{story:lemmy,also:[]}],sources:['hn','lemmy'],topics:[]},
  };
}

test('Reader shows a source failure only in that source view and clears it after recovery', {timeout:30000}, async()=>{
  const fixture=feedFixture();
  const app=await launchApp({sharedStore:true,settings:{sources:{hn:true,lemmy:true},frontPageMode:'sources',updateCheck:false},
    values:{'HNewhere:frontpage_cache:hn,lemmy':fixture.cache},responses:[fixture.response]});
  try {
    await app.page.goto('https://backchnnl.app/');
    const list=app.page.locator('#app-list-body');
    await list.locator('.browse-title-link',{hasText:STORIES[0].title}).first().waitFor({timeout:10000});
    assert.equal(await list.locator('.browse-feed-status').count(),0,'the combined list does not headline a single source failure');
    assert(await list.locator('.browse-title-link',{hasText:'Saved Lemmy article'}).count(),'saved articles remain available');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    assert(await waitFor(async()=>await app.page.locator('#app-rail [data-app-view="all"]').getAttribute('aria-pressed')==='true',5000));
    assert.equal(await list.locator('.browse-feed-status').count(),0,'the All view also stays free of individual source warnings');

    await app.page.locator('#app-rail [data-app-view="source:lemmy"]').click();
    await list.locator('.browse-title-link',{hasText:'Saved Lemmy article'}).first().waitFor({timeout:10000});
    assert.match(await list.locator('.browse-feed-status').textContent(),/Lemmy.*unavailable.*Showing saved articles/i);

    await app.page.locator('#app-rail [data-app-view="source:hn"]').click();
    await list.locator('.browse-title-link',{hasText:STORIES[0].title}).first().waitFor({timeout:10000});
    assert.equal(await list.locator('.browse-feed-status').count(),0,'a healthy source view does not show another source failure');

    await app.page.locator('#app-rail [data-app-view="source:lemmy"]').click();
    await list.locator('.browse-feed-status').waitFor({timeout:10000});
    fixture.recover();
    await app.page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+60000});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',10000));
    assert.equal(await list.locator('.browse-feed-status').count(),0,'a successful empty refresh clears the old failure');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('an entirely unavailable front page still explains why no articles are shown', {timeout:20000}, async()=>{
  const app=await launchApp({sharedStore:true,settings:{sources:{lemmy:true},frontPageMode:'sources',updateCheck:false},
    responses:[{match:url=>url.includes('lemmy.world/api/v3/post/list'),status:503,json:{error:'fixture outage'}}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    const list=app.page.locator('#app-list-body');
    assert(await waitFor(async()=>/could not load front pages/i.test(await list.innerText()),10000));
    assert.equal(await list.locator('.browse-title-link').count(),0);
    await app.page.locator('#app-rail [data-app-view="source:lemmy"]').click();
    assert(await waitFor(async()=>/lemmy.*unavailable/i.test(await list.innerText()),10000),'the selected source explains its failure');
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('Reader does not report a complete outage when one source returns a valid empty feed', {timeout:20000}, async()=>{
  const app=await launchApp({sharedStore:true,settings:{sources:{lobsters:true,lemmy:true},frontPageMode:'sources',updateCheck:false},
    responses:[
      {match:url=>url.includes('lobste.rs/hottest.json'),status:200,json:[]},
      {match:url=>url.includes('lemmy.world/api/v3/post/list'),status:503,json:{error:'fixture outage'}},
    ]});
  try {
    await app.page.goto('https://backchnnl.app/');
    const list=app.page.locator('#app-list-body');
    assert(await waitFor(async()=>/could not load front pages|nothing here right now/i.test(await list.innerText()),10000));
    assert.match(await list.innerText(),/nothing here right now/i,'one successful feed is not a complete outage');
    await app.page.locator('#app-rail [data-app-view="source:lemmy"]').click();
    assert(await waitFor(async()=>/lemmy.*unavailable/i.test(await list.innerText()),10000));
    await app.page.locator('#app-rail [data-app-view="source:lobsters"]').click();
    assert(await waitFor(async()=>/nothing here right now/i.test(await list.innerText()),10000));
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('a topic containing a failed source does not headline that source in the topic view', {timeout:20000}, async()=>{
  const app=await launchApp({sharedStore:true,settings:{sources:{hn:true,lemmy:true},frontPageMode:'topics',frontPageTopics:['technology'],updateCheck:false},
    responses:[{match:url=>url.includes('lemmy.world/api/v3/post/list'),status:503,json:{error:'fixture outage'}}]});
  try {
    await app.page.goto('https://backchnnl.app/');
    const list=app.page.locator('#app-list-body');
    await list.locator('.browse-title-link',{hasText:STORIES[0].title}).first().waitFor({timeout:10000});
    await app.page.locator('#app-rail [data-app-view="topic:technology"]').click();
    assert(await waitFor(async()=>await app.page.locator('#app-rail [data-app-view="topic:technology"]').getAttribute('aria-pressed')==='true',5000));
    assert.equal(await list.locator('.browse-feed-status').count(),0);
    await app.page.locator('#app-rail [data-app-view="source:lemmy"]').click();
    assert(await waitFor(async()=>/lemmy.*unavailable/i.test(await list.innerText()),10000));
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('Sidebar confines feed failure notices to the selected source', {timeout:30000}, async()=>{
  const fixture=feedFixture();
  const url=STORIES[0].url;
  const app=await launchApp({sharedStore:true,topHosts:[new URL(url).hostname],settings:{sources:{hn:true,lemmy:true},
    autoOpenSidebar:true,frontPageMode:'sources',updateCheck:false},
    values:{'HNewhere:frontpage_cache:hn,lemmy':fixture.cache},responses:[fixture.response]});
  try {
    await app.page.goto(url);
    await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').first().waitFor({timeout:15000});
    await app.page.locator('#browse-toggle .wordmark-root').click();
    const list=app.page.locator('#browse-list');
    await list.locator('.browse-title-link',{hasText:'Saved Lemmy article'}).first().waitFor({timeout:10000});
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Lemmy.*unavailable/i,'the combined view does not show a source failure toast');
    assert.equal(await list.locator('.browse-feed-status').count(),0);

    await app.page.locator('#browse-tab-all').click();
    await app.page.locator('#browse-home-filters [data-browse-view="source:lemmy"]').click();
    await list.locator('.browse-feed-status').waitFor({timeout:10000});
    assert.match(await list.locator('.browse-feed-status').textContent(),/Lemmy.*unavailable.*Showing saved articles/i);

    await app.page.locator('#browse-tab-all').click();
    assert(await waitFor(async()=>await list.locator('.browse-title-link',{hasText:STORIES[0].title}).count()>0,10000));
    assert.equal(await list.locator('.browse-feed-status').count(),0,'the message clears when leaving the source view');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/Lemmy.*unavailable/i);
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});

test('Sidebar explains when every front-page source is unavailable', {timeout:30000}, async()=>{
  const url=STORIES[0].url;
  const app=await launchApp({sharedStore:true,topHosts:[new URL(url).hostname],settings:{sources:{hn:true,lemmy:true},
    autoOpenSidebar:true,frontPageMode:'sources',updateCheck:false},responses:[
      {match:address=>address==='https://news.ycombinator.com/news',status:503,text:''},
      {match:address=>address.includes('lemmy.world/api/v3/post/list'),status:503,json:{error:'fixture outage'}},
    ]});
  try {
    await app.page.goto(url);
    await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').first().waitFor({timeout:15000});
    await app.page.locator('#browse-toggle .wordmark-root').click();
    const list=app.page.locator('#browse-list');
    assert(await waitFor(async()=>/could not load front pages/i.test(await list.innerText()),10000));
    assert.equal(await list.locator('.browse-title-link').count(),0);
    assert.deepEqual(app.errors,[]);
  } finally {await app.browser.close()}
});
