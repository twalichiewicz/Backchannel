import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, NOW, waitFor} from './harness.mjs';
import {discussionFixture} from './fixtures.mjs';

const url=STORIES[0].url;
const redditValues={'HNewhere:reddit_tier':{tier:'archive',timestamp:Date.now()}};

async function settled(app){
  assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id]').count()>0&&await app.page.locator('#comments-content .discussion-loading').count()===0&&await app.page.locator('.discussion-progress-strip:not([aria-hidden="true"])').count()===0,15000),'the discussion finishes rendering');
}

test('Reader removes its single-discussion banner when a second source arrives',{timeout:30000},async()=>{
  const fixture=discussionFixture(url,{rootCount:2,replyRoots:0});
  const app=await launchApp({sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:true,reddit:true},frontPageMode:'sources',updateCheck:false},values:redditValues,responses:fixture.responses});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>{
      const request=window.__gmXHR;
      window.__gmXHR=async options=>{
        if(options.url.includes('/api/posts/search')&&!window.__releaseRedditDiscovery)await new Promise(resolve=>window.__releaseRedditDiscovery=resolve);
        return request(options);
      };
    });
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').first().waitFor();
    assert(await waitFor(async()=>await app.page.locator('#filter-banner.app-pinned:not(.hidden)').count()===1,5000),'the first source initially has its single-discussion banner');
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    assert.equal(await app.page.locator('#app-discussion-meta .source-menu').isVisible(),true);
    await app.page.waitForFunction(()=>window.__releaseRedditDiscovery);
    await app.page.evaluate(()=>window.__releaseRedditDiscovery());
    await app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]').waitFor();
    await settled(app);
    assert.equal(await app.page.locator('#app-discussion-meta [data-select-all] input').isChecked(),true,'All sources is selected when the stale pinned banner appears');
    assert(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]:not(.comment-filter-hidden)').count()>0);
    assert.equal(await app.page.locator('#filter-banner:not(.hidden)').count(),0,'an unfiltered discussion with multiple sources has no focus banner');
    assert(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0);
    assert.equal(await app.page.locator('#app-discussion-meta .source-menu').isVisible(),true,'the open Sources menu stays open when the discussion choices update');
    const menu = app.page.locator('#app-discussion-meta .source-menu');
    const all = menu.getByRole('checkbox', {name:'All sources',exact:true});
    await all.uncheck();
    assert(await app.page.locator('#filter-banner').innerText().then(text=>text.includes('No discussions selected.')));
    const first = menu.locator('[data-discussion-key="reddit:fixture0"] input');
    await first.check();
    assert(await waitFor(async()=>await app.page.locator('#filter-banner:not(.hidden)').count()===1,3000),'choosing a discussion deliberately still shows focus');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]:not(.comment-filter-hidden)').count(),0,'a focused discussion actually filters the other source');
    const group = menu.locator('.choice-sub').filter({has:app.page.locator('[data-discussion-key="reddit:fixture0"]')}).locator('[data-source-group] input');
    assert(await all.evaluate(input=>input.indeterminate),'All sources marks a partial selection');
    assert(await group.evaluate(input=>input.indeterminate),'the Reddit group marks a partial selection');
    await group.click();
    assert(await group.isChecked(),'checking a group selects its discussions');
    assert(await app.page.locator('#comments-content .comment[data-comment-id="reddit:root1"]').isVisible());
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]:not(.comment-filter-hidden)').count(),0,'checking a group leaves other sources excluded');
    assert(await menu.isVisible(),'checkbox changes leave the menu open');
    await all.click();
    assert(await waitFor(async()=>await app.page.locator('#filter-banner:not(.hidden)').count()===0,3000),'All sources clears the focus banner');
    assert(await all.isChecked());
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const pendingFocus of [false,true])test(`Reader clears ${pendingFocus?'a pending comment focus':'the previous focus banner'} as soon as another article is selected`,{timeout:25000},async()=>{
  const app=await launchApp({sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await settled(app);
    assert.equal(await app.page.locator('#filter-banner:not(.hidden)').count(),1);
    await app.page.evaluate(()=>{
      const request=window.__gmXHR;
      window.__gmXHR=async options=>{
        await new Promise(resolve=>{(window.__releaseNextRequests||=[]).push(resolve)});
        return request(options);
      };
    });
    if(pendingFocus){
      await app.page.locator('#comments-content .focus-link').first().evaluate((element,title)=>{
        element.click();
        [...element.getRootNode().querySelectorAll('#app-list-body .browse-title-link')].find(link=>link.textContent.trim()===title).click();
      },STORIES[1].title);
    }else await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[1].title}).first().click();
    await app.page.waitForFunction(()=>window.__releaseNextRequests?.length>0);
    assert.equal(await app.page.locator('#filter-banner:not(.hidden)').count(),0,'the previous banner cannot return in the provisional header while the next story loads');
    assert.equal(await app.page.locator('#filter-banner-quote').textContent(),'','old attribution is reset with the article');
    if(pendingFocus){
      await new Promise(resolve=>setTimeout(resolve,250));
      assert.equal(await app.page.locator('#filter-banner:not(.hidden)').count(),0,'the previous article’s queued animation cannot repaint its focus banner');
      assert.equal(await app.page.locator('#filter-banner-quote').textContent(),'');
      assert.equal(await app.page.locator('#comments-content').evaluate(node=>node.classList.contains('comments-transitioning')),false);
    }
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const mode of ['Sidebar','Reader'])test(`${mode} Sources shows a single reported count without partial-refresh diagnostics`,{timeout:30000},async()=>{
  const fixture=discussionFixture(url,{rootCount:2,replyRoots:0});
  const tree=fixture.responses.find(response=>response.match('https://fixture/api/comments/tree?link_id=t3_fixture0'));
  const sidebar=mode==='Sidebar';
  const app=await launchApp({...(sidebar?{appHost:new URL(url).hostname}:{}),sharedStore:true,handler:'Tampermonkey',settings:{sources:{hn:!sidebar,reddit:true},autoOpenSidebar:sidebar,frontPageMode:'sources',updateCheck:false},values:redditValues,responses:fixture.responses});
  try{
    await app.page.goto(sidebar?url:'https://backchnnl.app/');
    if(!sidebar)await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]').waitFor();
    await settled(app);
    const disclosure=app.page.locator(sidebar?'#comments-content .page-header-disclosure':'#app-discussion-meta .page-header-disclosure');
    await disclosure.click();
    const menu=app.page.locator(sidebar?'#comments-content .source-menu':'#app-discussion-meta .source-menu');
    const entry=menu.locator('.source-menu-entry').filter({has:app.page.locator('[data-discussion-key="reddit:fixture0"]')});
    assert.equal((await entry.locator('.source-menu-hint').innerText()).trim(),'2156 comments','only the source comment total is presented');
    assert.equal(await menu.locator('.discussion-source-status').count(),0,'partial load diagnostics are not displayed');
    await disclosure.click();
    tree.json={data:fixture.trees.get('fixture0').slice(0,1)};
    await app.page.locator(sidebar?'#browse-home-sync':'#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator(sidebar?'#browse-home-sync':'#app-list-sync').getAttribute('aria-busy')!=='true',15000));
    await settled(app);
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:root1"]').count(),1,'comments omitted by the partial refresh stay available');
    await disclosure.click();
    assert.equal(await menu.locator('.discussion-source-status').count(),0,'retaining saved comments does not add a partial-refresh announcement');
    assert.doesNotMatch(await menu.innerText(),/loaded|refresh|retry/i);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const commentsAvailable of [false,true])test(`Sources ${commentsAvailable?'keeps real comments despite a zero metadata count':'omits a discussion with no comments'}`,{timeout:20000},async()=>{
  const now=new Date().toISOString();
  const post={post:{id:71,name:'A matching article',url,published:now,creator_id:4},creator:{name:'reader',actor_id:'https://lemmy.world/u/reader'},community:{name:'empty',actor_id:'https://lemmy.world/c/empty'},counts:{comments:0,score:1}};
  const comments=commentsAvailable?[{comment:{id:72,post_id:71,creator_id:4,content:'A real comment despite stale counts',published:now,path:'0.72'},creator:post.creator,counts:{score:1}}]:[];
  const app=await launchApp({sharedStore:true,settings:{sources:{hn:true,lemmy:true},frontPageMode:'sources',updateCheck:false},responses:[
    {match:path=>path.includes('lemmy.world/api/v3/search'),json:{posts:[post]}},
    {match:path=>path.includes('lemmy.world/api/v3/comment/list'),json:{comments}},
  ]});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link',{hasText:STORIES[0].title}).first().click();
    await settled(app);
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    const entry=app.page.locator('#app-discussion-meta .source-menu-entry').filter({has:app.page.locator('[data-discussion-key="lemmy:71"]')});
    assert.equal(await entry.count(),commentsAvailable?1:0,'only a discussion that can contribute comments is selectable');
    if(commentsAvailable){
      assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="lemmy:72"]').count(),1);
      assert.equal((await entry.locator('.source-menu-hint').innerText()).trim(),'1 comment');
      await app.page.locator('#app-discussion-meta [data-select-all] input').uncheck();
      await entry.locator('input').check();
      assert(await waitFor(async()=>await app.page.locator('#filter-banner:not(.hidden)').count()===1,3000));
      assert.match(await app.page.locator('#filter-banner-quote').textContent(),/\b1 comment\b/,'focusing the source uses the same meaningful comment count');
    }else{
      assert.equal(await app.page.locator('#filter-banner-open').isVisible(),true,'the single remaining discussion can still be opened at its source');
      assert.equal(await app.page.locator('#filter-banner-open').getAttribute('href'),'https://news.ycombinator.com/item?id=9001');
    }
    assert.doesNotMatch(await app.page.locator('#app-discussion-meta .source-menu').innerText(),/\b0 comments\b/);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('Sidebar shows the remaining discussion details when an empty source is omitted',{timeout:20000},async()=>{
  const post={post:{id:71,name:'An empty match',url,published:new Date().toISOString()},creator:{name:'reader'},community:{name:'empty'},counts:{comments:0}};
  const app=await launchApp({appHost:new URL(url).hostname,sharedStore:true,settings:{sources:{hn:true,lemmy:true},autoOpenSidebar:true,updateCheck:false},responses:[
    {match:path=>path.includes('lemmy.world/api/v3/search'),json:{posts:[post]}},
    {match:path=>path.includes('lemmy.world/api/v3/comment/list'),json:{comments:[]}},
  ]});
  try{
    await app.page.goto(url);
    await settled(app);
    assert.equal(await app.page.locator('#comments-content .source-menu [data-discussion-key="lemmy:71"]').count(),0);
    assert.equal(await app.page.locator('#comments-content .submission-detail[data-discussion-key="hn:9001"]').isVisible(),true,'the source post details stay visible without an extra filter selection');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('correcting a stale source count preserves the unread sorting control',{timeout:20000},async()=>{
  const now=new Date().toISOString();
  const creator={name:'reader',actor_id:'https://lemmy.world/u/reader'};
  const post={post:{id:71,name:'A matching article',url,published:now},creator,community:{name:'stale'},counts:{comments:0}};
  const app=await launchApp({appHost:new URL(url).hostname,sharedStore:true,settings:{sources:{hn:true,lemmy:true},autoOpenSidebar:true,newCommentsFirst:true,updateCheck:false},values:{'HNewhere:seen_comments':{'hn:9001':NOW-3600,'lemmy:71':NOW-3600}},responses:[
    {match:path=>path.includes('lemmy.world/api/v3/search'),json:{posts:[post]}},
    {match:path=>path.includes('lemmy.world/api/v3/comment/list'),json:{comments:[{comment:{id:72,post_id:71,content:'A new comment',published:now,path:'0.72'},creator,counts:{score:1}}]}},
  ]});
  try{
    await app.page.goto(url);
    await app.page.locator('#comments-content .comment[data-comment-id="lemmy:72"]').waitFor();
    await settled(app);
    const control=app.page.locator('#sort-new-first');
    assert.equal(await control.isVisible(),true,'count reconciliation cannot remove the available unread control');
    assert.equal(await control.getAttribute('aria-pressed'),'true');
    assert.equal(await control.evaluate(node=>node.classList.contains('is-on')),true);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
