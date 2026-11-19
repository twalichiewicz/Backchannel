import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const DARK_STORY=STORIES[0];
const LIGHT_STORY=STORIES[7];
const READER_STORY=STORIES[1];
const UNKNOWN_STORY=STORIES[4];
const PALETTES={
  dark:{bg:'#172b3a',text:'#e5f4ff',heading:'#f5ac68'},
  light:{bg:'#f8ead3',text:'#352818',heading:'#725210'},
};

function articleHTML(palette){
  const prose=Array.from({length:16},(_,index)=>`<p>Paragraph ${index+1} describes a carefully measured article with enough readable content to exercise the full reader and discussion integration. Manual allocation avoids the pause entirely but transfers the burden onto every caller in the system.</p>`).join('');
  return `<!doctype html><html style="background:${palette.bg}"><head><meta charset="utf-8"><title>Distinctive article</title><style>body{margin:0;background:${palette.bg};color:${palette.text};font-family:Georgia,serif}h1{color:${palette.heading};font-family:Georgia,serif}main{padding:40px}</style></head><body><main><article><h1>Distinctive article</h1>${prose}</article></main></body></html>`;
}

const pages={
  [DARK_STORY.url]:{html:articleHTML(PALETTES.dark)},
  [LIGHT_STORY.url]:{html:articleHTML(PALETTES.light)},
  [READER_STORY.url]:{headers:{'x-frame-options':'DENY'},html:articleHTML(PALETTES.dark)},
  [UNKNOWN_STORY.url]:{html:articleHTML(PALETTES.dark)},
};

async function launch({sidebar=false,story=DARK_STORY,colorScheme='light',theme='auto'}={}){
  const app=await launchApp({pages,sharedStore:true,colorScheme,...(sidebar?{appHost:new URL(story.url).hostname}:{}),settings:{sources:{hn:true},frontPageMode:'sources',autoOpenSidebar:true,theme,updateCheck:false}});
  app.consoleMessages=[];
  app.page.on('console',message=>{if(message.type()==='error')app.consoleMessages.push({type:message.type(),text:message.text()})});
  await app.page.addInitScript(()=>{
    if(window.top!==window)return;
    window.__discussionThemeMessages=[];
    window.addEventListener('message',event=>{
      if(event.data?.type==='hi'){
        window.__discussionThemeLastEvent=event;
        window.__discussionThemeMessages.push({bc:event.data.bc,url:event.data.url,look:event.data.look});
      }
    });
  });
  await app.page.goto(sidebar?story.url:'https://backchnnl.app/');
  await app.page.locator(sidebar?'#panel':'#app-list-body .browse-title-link').first().waitFor();
  return app;
}

async function openStory(app,story,mode='frame-agent'){
  await app.page.locator('#app-list-body .browse-title-link',{hasText:story.title}).first().click();
  assert(await waitFor(async()=>await app.page.locator('#app-article-body').getAttribute('data-mode')===mode,10000),`the shipped article loader reaches ${mode}`);
  await app.page.locator('#comments-content .comment[data-comment-id] .text').first().waitFor();
}

async function surface(app){
  return app.page.locator('#panel').evaluate(panel=>{
    const style=getComputedStyle(panel);
    const comment=panel.querySelector('.comment .text');
    return {background:style.backgroundColor,text:comment?getComputedStyle(comment).color:style.color,meta:style.getPropertyValue('--meta').trim()};
  });
}

async function chrome(app){
  return app.page.evaluate(()=>{
    const host=document.querySelector('[data-hnewhere-app]');
    const root=host.shadowRoot;
    const styleOf=selector=>{
      const style=getComputedStyle(root.querySelector(selector));
      return {background:style.backgroundColor,text:style.color};
    };
    return {hostDark:host.classList.contains('hnewhere-dark'),rail:styleOf('#app-rail'),list:styleOf('#app-list'),settings:styleOf('#app-settings-modal'),chrome:document.documentElement.style.getPropertyValue('--backchannel-chrome'),stored:localStorage.getItem('backchannel:chrome')};
  });
}

async function sidebarSurface({story,colorScheme,theme='auto'}){
  const app=await launch({sidebar:true,story,colorScheme,theme});
  try{
    await app.page.locator('#comments-content .comment[data-comment-id] .text').first().waitFor();
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
    return await surface(app);
  }finally{await app.browser.close()}
}

for(const {story,colorScheme,name,bg} of [
  {story:DARK_STORY,colorScheme:'light',name:'dark article on a light system',bg:'rgb(23, 43, 58)'},
  {story:LIGHT_STORY,colorScheme:'dark',name:'light article on a dark system',bg:'rgb(248, 234, 211)'},
])test(`Reader Discussion Auto matches Sidebar for a ${name}`,{timeout:25000},async()=>{
  const expected=await sidebarSurface({story,colorScheme});
  const app=await launch({colorScheme});
  try{
    const before=await chrome(app);
    await openStory(app,story);
    const messages=await app.page.evaluate(()=>window.__discussionThemeMessages);
    assert(messages.some(message=>message.url===story.url&&message.look?.bg===bg),'the real article frame sends its computed page palette');
    assert.deepEqual(await surface(app),expected,'the visible Discussion uses the same palette as Sidebar');
    assert.deepEqual(await chrome(app),before,'article matching is local to Discussion; rail, list, Settings and page chrome keep their theme');
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
  }finally{await app.browser.close()}
});

for(const {theme,story,colorScheme} of [
  {theme:'light',story:DARK_STORY,colorScheme:'dark'},
  {theme:'dark',story:LIGHT_STORY,colorScheme:'light'},
])test(`explicit ${theme} Settings overrides the article palette in Reader and Sidebar`,{timeout:25000},async()=>{
  const expected=await sidebarSurface({story,colorScheme,theme});
  const app=await launch({colorScheme,theme});
  try{
    await openStory(app,story);
    assert.deepEqual(await surface(app),expected);
    await app.page.emulateMedia({colorScheme:colorScheme==='dark'?'light':'dark'});
    assert.deepEqual(await surface(app),expected,'an OS theme change cannot override an explicit Settings choice');
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
    await openStory(app,READER_STORY,'reader');
    await app.page.locator('#app-view-toggle').click();
    await app.page.locator(`[data-reader-page="${theme==='light'?'night':'paper'}"]`).click();
    assert.deepEqual(await surface(app),expected,'an explicit Settings choice also overrides the extracted article page color');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('Reader clears the previous article theme before loading another article and ignores a late old-frame greeting',{timeout:25000},async()=>{
  const app=await launch({colorScheme:'dark'});
  try{
    const fallback=await surface(app);
    await openStory(app,LIGHT_STORY);
    const light=await surface(app);
    const dark=await sidebarSurface({story:DARK_STORY,colorScheme:'dark'});
    assert.notEqual(light.background,dark.background,'the first article has its light palette before navigation');
    await app.context.route(DARK_STORY.url,async route=>{
      await new Promise(resolve=>{app.releaseArticle=resolve});
      await route.fulfill({status:200,contentType:'text/html',body:pages[DARK_STORY.url].html});
    });
    const provisional=await app.page.locator('#app-list-body .browse-title-link',{hasText:DARK_STORY.title}).first().evaluate(link=>{
      const root=link.getRootNode();
      const stale=window.__discussionThemeLastEvent;
      link.click();
      window.dispatchEvent(stale);
      const style=getComputedStyle(root.querySelector('#panel'));
      return {background:style.backgroundColor};
    });
    assert.equal(provisional.background,fallback.background,'the next article starts with the app fallback immediately, before any response');
    assert(await waitFor(()=>Boolean(app.releaseArticle),3000));
    app.releaseArticle();
    assert(await waitFor(async()=>await app.page.locator('#app-article-body').getAttribute('data-mode')==='frame-agent',10000));
    assert.deepEqual(await surface(app),dark,'the new active frame determines the final Discussion palette');
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
  }finally{app.releaseArticle?.();await app.browser.close()}
});

test('Reader Auto keeps following a known article when the OS theme changes',{timeout:20000},async()=>{
  const expected=await sidebarSurface({story:DARK_STORY,colorScheme:'light'});
  const app=await launch({colorScheme:'dark'});
  try{
    await openStory(app,DARK_STORY);
    assert.deepEqual(await surface(app),expected);
    await app.page.emulateMedia({colorScheme:'light'});
    assert(await waitFor(async()=>await app.page.evaluate(()=>!document.querySelector('[data-hnewhere-app]').classList.contains('hnewhere-dark')),3000),'the app theme responds to the OS change');
    assert.deepEqual(await surface(app),expected,'the Discussion continues matching the article while the rest of the app responds to the OS');
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
  }finally{await app.browser.close()}
});

test('fetched Reader article Discussion follows its displayed Paper and Night choices',{timeout:25000},async()=>{
  const dark=await sidebarSurface({story:DARK_STORY,colorScheme:'light'});
  const light=await sidebarSurface({story:LIGHT_STORY,colorScheme:'light'});
  const app=await launch({colorScheme:'light'});
  try{
    const before=await chrome(app);
    await openStory(app,READER_STORY,'reader');
    assert.equal(await app.page.locator('.bc-reader').count(),1,'the refused frame becomes the shipped extracted article reader');
    assert.deepEqual(await surface(app),light,'Auto Paper uses the light Sidebar palette');
    await app.page.locator('#app-view-toggle').click();
    await app.page.locator('[data-reader-page="night"]').click();
    assert.equal(await app.page.locator('.app-reader-scroll').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(18, 18, 18)','the article actually changes to Night');
    assert.deepEqual(await surface(app),dark,'Discussion follows the displayed Night page');
    await app.page.locator('[data-reader-page="paper"]').click();
    assert.deepEqual(await surface(app),light,'returning to Paper clears the dark Discussion palette');
    assert.deepEqual(await chrome(app),before);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a frame without the userscript uses the app fallback instead of the previous article palette',{timeout:25000},async()=>{
  const app=await launch({colorScheme:'dark'});
  try{
    const fallback=await surface(app);
    await openStory(app,LIGHT_STORY);
    await openStory(app,UNKNOWN_STORY,'frame');
    assert.deepEqual(await surface(app),fallback,'unknown source style falls back to the current app theme');
    assert.deepEqual(app.errors,[]);
    assert.deepEqual(app.consoleMessages,[]);
  }finally{await app.browser.close()}
});
