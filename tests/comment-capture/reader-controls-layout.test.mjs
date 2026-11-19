import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,STORIES,waitFor} from './harness.mjs';

async function ready(app){
  await app.page.goto('https://backchnnl.app/');
  await app.page.locator('#app-list-body .browse-title-link').first().click();
  await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
  await app.page.locator('#app-article-body iframe').waitFor();
  assert(await waitFor(async()=>await app.page.locator('#panel').evaluate(panel=>getComputedStyle(panel).transform==='none'),2000),'pane entrance has settled before measuring its edge');
}

test('wide Reader Front Pages toggle overlaps its panel and pane controls remain reachable when collapsed',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1600,height:950},settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await ready(app);
    const edges=await app.page.locator('#app-reading').evaluate(reading=>{
      const root=reading.getRootNode(),list=root.querySelector('#app-list').getBoundingClientRect(),panel=root.querySelector('#panel').getBoundingClientRect();
      const b=id=>{const r=root.querySelector(id).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,center:r.x+r.width/2}};
      return{listRight:list.right,panelLeft:panel.left,syncRight:b('#app-list-sync').right,left:b('#app-toggle-list'),right:b('#app-toggle-discussion')};
    });
    assert(Math.abs(edges.left.center-edges.listRight)<=1,'the Front Pages toggle straddles the list edge');
    assert(edges.left.x-edges.syncRight>=4,`the pane toggle leaves the Sync button clear: ${JSON.stringify(edges)}`);
    assert.equal(await app.page.locator('#app-toggle-discussion').evaluate(node=>Boolean(node.closest('#app-chin'))),true,'Discussion is available in the desktop chin');
    for(const [id,hidden] of [['#app-toggle-list','list-hidden'],['#app-toggle-discussion','discussion-hidden']]){
      await app.page.locator(id).click();
      assert(await waitFor(async()=>await app.page.locator('#app').evaluate((n,c)=>n.classList.contains(c),hidden),2000));
      const hit=await app.page.locator(id).evaluate(button=>{const r=button.getBoundingClientRect();return button.getRootNode().elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button});
      assert(hit,'the collapsed panel toggle remains clickable');
      if(hidden==='list-hidden'){
        const whole=await app.page.locator('#app-toggle-discussion').evaluate(button=>{const r=button.getBoundingClientRect(),root=button.getRootNode();return [r.left+2,r.right-2].every(x=>root.elementFromPoint(x,r.y+r.height/2)?.closest('button')===button)});
        assert(whole,'hiding the list does not clip either half of the Discussion toggle');
      }
      await app.page.locator(id).click();
      assert(await waitFor(async()=>!await app.page.locator('#app').evaluate((n,c)=>n.classList.contains(c),hidden),2000));
    }
    assert.equal(await app.page.locator('#app-toggle-discussion rect').count(),0,'Discussion uses a chat bubble rather than a pane glyph');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('wide Reader keeps its real article actions together in the chin',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1600,height:950},votable:{[STORIES[0].id]:'updown'},settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await ready(app);
    const ids=['#app-article-actions [data-item-action="save"]','#app-view-toggle','#app-toggle-discussion'];
    const boxes=[];for(const id of ids)boxes.push(await app.page.locator(id).boundingBox());
    assert(boxes.every(Boolean),'all article controls are available');
    const chin=await app.page.locator('#app-chin').boundingBox();
    for(const box of boxes){assert(Math.abs(box.y+box.height/2-(boxes[0].y+boxes[0].height/2))<1,'controls align horizontally');assert(box.y>=chin.y&&box.y+box.height<=chin.y+chin.height,'controls fit inside the chin')}
    await app.page.locator('#app-view-toggle').click();
    const menu=app.page.locator('#app-view-menu');await menu.waitFor();
    const m=await menu.boundingBox();assert(m.y>=0&&m.y+m.height<=950,'the style menu opens fully inside the viewport');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.locator('#app-chin .vote-button').count(),0,'voting is absent from the chin');
    await app.page.locator('#app-article-actions [data-item-action="save"]').click();
    assert(await waitFor(async()=>/unsave/i.test(await app.page.locator('#app-article-actions [data-item-action="save"]').textContent()),3000),'the real save control still saves');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const width of [390])test(`${width}px Reader retains its bottom-right mobile-style action column`,{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width,height:900},votable:{[STORIES[0].id]:true},settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().click();
    const like=app.page.locator('#app-bar-like');
    await like.waitFor();
    const controls=app.page.locator('#app-bar > button:visible');
    const boxes=await controls.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}));
    assert(boxes.length>=3,'the action column has the available article actions');
    for(const box of boxes)assert(Math.abs(box.x+box.width/2-(boxes[0].x+boxes[0].width/2))<1,'controls share a vertical center line');
    const bounds=await app.page.locator(width===390?'#app':'#app-article').boundingBox();
    assert(bounds.x+bounds.width-boxes[0].x-boxes[0].width>=8&&bounds.x+bounds.width-boxes[0].x-boxes[0].width<=18,'the column stays at the right edge');
    const [vote]=await Promise.all([app.context.waitForEvent('page'),like.click()]);
    await vote.waitForURL(target=>target.hostname==='news.ycombinator.com'&&new URLSearchParams(target.hash.slice(1)).get('action')==='up');
    assert.equal(new URLSearchParams(new URL(vote.url()).hash.slice(1)).get('item'),String(STORIES[0].id));
    await vote.close();
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
