import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('the update checker recognizes installed alpha versions', async()=>{
  const source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  const start=source.indexOf('\tfunction compareVersions(');
  const end=source.indexOf('\n\tfunction releaseNotesHTML(',start);
  assert(start>=0 && end>start,'version functions are available');
  const api=new Function(source.slice(start,end)+'\nreturn { compareVersions, releaseVersion, newerReleases };')();
  const releases=[
    {tag_name:'v1.6.18.5',html_url:'https://example.com/older'},
    {tag_name:'v1.6.19',html_url:'https://example.com/stable'},
    {tag_name:'v1.6.20-alpha',html_url:'https://example.com/prerelease',prerelease:true},
  ];
  assert.equal(api.compareVersions('1.6.19','1.6.19-alpha'),1);
  assert.equal(api.compareVersions('1.6.18.5','1.6.19-alpha'),-1);
  assert.equal(api.compareVersions('1.6.19-alpha.2','1.6.19-alpha.10'),-1);
  assert.deepEqual(api.newerReleases(releases,'1.6.19-alpha').map(release=>release.version),['1.6.19']);
  assert.equal(api.releaseVersion('v1.6.19-alpha'),'','prerelease tags remain excluded');
  assert.deepEqual(api.newerReleases(releases,'invalid'),[]);
});
