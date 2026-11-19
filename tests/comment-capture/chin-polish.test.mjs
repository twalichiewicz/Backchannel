import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,STORIES,waitFor} from './harness.mjs';

const selectors=['#app-view-toggle','#app-article-actions [data-item-action="save"]','#app-toggle-discussion'];
async function ready(width=1600){
  const app=await launchApp({sharedStore:true,viewport:{width,height:950},votable:{[STORIES[0].id]:'updown',[STORIES[7].id]:'updown'},settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#app-chin [data-item-action="save"]').waitFor();
    return app;
  }catch(error){await app.browser.close();throw error}
}

for(const width of [701,1600])test(`${width}px chin shows just the brand mark and the requested action order`,{timeout:15000},async()=>{
  const app=await ready(width);
  try{
    assert.equal((await app.page.locator('#app-chin-brand').textContent()).trim(),'','the brand is a mark without copyright text');
    assert.equal(await app.page.locator('#app-chin button[aria-label="Settings"]').count(),0,'the chin does not duplicate Settings');
    assert.equal(await app.page.locator('#app-chin .vote-button').count(),0);
    const boxes=[];for(const selector of selectors)boxes.push(await app.page.locator(selector).boundingBox());
    for(let i=1;i<boxes.length;i++){
      assert(Math.abs(boxes[i].x-boxes[i-1].x-boxes[i-1].width-6)<.1,'Aa, save, and chat have 6px between controls');
    }
    assert(boxes.every(box=>box.y>=920&&box.y+box.height<=950),'the controls fit the existing chin');
    assert.equal(await app.page.locator('#settings-toggle').isVisible(),true,'Settings remains available in the rail');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('chin keyboard order follows the visible controls without replacing their handlers',{timeout:20000},async()=>{
  const app=await ready();
  try{
    await app.page.locator(selectors[0]).focus();
    for(const selector of selectors.slice(1)){
      await app.page.keyboard.press(process.env.ENGINE==='webkit'?'Alt+Tab':'Tab');
      assert.equal(await app.page.locator(selector).evaluate(node=>node.getRootNode().activeElement===node),true,`Tab reaches ${selector} in visible order`);
    }
    const save=app.page.locator(selectors[1]);
    await save.click();
    assert(await waitFor(async()=>/unsave/.test(await save.textContent()),3000));
    await app.page.locator('#app-list-body .browse-title-link').filter({hasText:STORIES[7].title}).first().click();
    await app.page.locator('#app-view-toggle').click();await app.page.locator('#app-view-menu').waitFor();
    assert.equal(await app.page.locator('#app-article-open').getAttribute('href'),STORIES[7].url,'the original-page control follows the new article');
    await app.page.keyboard.press('Escape');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
