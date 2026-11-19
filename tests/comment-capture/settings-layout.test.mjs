import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp} from './harness.mjs';

for(const theme of ['light','dark'])test(`Settings use aligned actions and theme colors in ${theme} mode`,{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,version:'1.6.19-alpha',settings:{sources:{hn:true},frontPageMode:'sources',theme,annotations:true,updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#settings-toggle').click();
    const colors=await app.page.locator('a[href="https://mozilla.github.io/pdf.js/"]').evaluate(link=>{
      const probe=document.createElement('span');probe.style.color='var(--accent)';link.after(probe);
      const result={link:getComputedStyle(link).color,accent:getComputedStyle(probe).color};probe.remove();return result;
    });
    assert.equal(colors.link,colors.accent,'pdf.js uses the theme accent');
    const layout=await app.page.locator('#settings-cache-clear').evaluate(button=>{
      const row=button.closest('.appearance-row');if(!row)return null;
      const b=button.getBoundingClientRect(),r=row.getBoundingClientRect(),l=row.querySelector('.appearance-row-label').getBoundingClientRect();
      return{right:r.right-b.right,gap:b.left-l.right,top:Math.abs(b.top-l.top)};
    });
    assert(layout,'cache actions share the label/control row');assert(layout.right<2&&layout.gap>=12&&layout.top<3);
    const left=await app.page.locator('.app-settings-nav').evaluate(nav=>{
      const report=nav.querySelector('a[href$="/issues"] svg'),tab=nav.querySelector('[data-settings-section="general"] svg');
      return Math.abs(report.getBoundingClientRect().left-tab.getBoundingClientRect().left);
    });assert(left<1,'the bug icon lines up with navigation icons');
    await app.page.locator('[data-settings-section="sources"]').click();
    assert.equal(await app.page.locator('.settings-sync-schedule').evaluate(row=>getComputedStyle(row).borderTopWidth),'0px','Front Pages and Sync schedule share one subsection');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
