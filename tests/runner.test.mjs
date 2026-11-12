import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function isolatedRunner(run, html = '<!doctype html><script>throw new Error("suite boot failed")</script>') {
  const root = await mkdtemp(join(tmpdir(), 'backchannel-runner-'));
  const tests = join(root, 'tests');
  try {
    await mkdir(tests);
    await copyFile(join(here, 'run.mjs'), join(tests, 'run.mjs'));
    await symlink(join(here, 'node_modules'), join(tests, 'node_modules'), 'dir');
    await writeFile(join(tests, 'thread-cache.html'), html);
    return await run(tests);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('a test page with a passing summary succeeds', { timeout: 15000 }, async () => {
  await isolatedRunner((tests) => {
    const result = spawnSync(process.execPath, ['run.mjs'], { cwd: tests, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /1 assertions across 1 suites/);
  }, '<!doctype html><div id="summary">all 1 passed</div>');
});

test('a test page that fails before reporting a summary fails the run', { timeout: 45000 }, async () => {
  await isolatedRunner((tests) => {
    const result = spawnSync(process.execPath, ['run.mjs'], { cwd: tests, encoding: 'utf8', timeout: 40000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
});

test('an uncaught error fails even if the page reports a passing summary', { timeout: 15000 }, async () => {
  await isolatedRunner((tests) => {
    const result = spawnSync(process.execPath, ['run.mjs'], { cwd: tests, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /suite boot failed/);
  }, '<!doctype html><div id="summary">all 1 passed</div><script>throw new Error("suite boot failed")</script>');
});

test('a summary with no assertions fails the run', { timeout: 15000 }, async () => {
  await isolatedRunner((tests) => {
    const result = spawnSync(process.execPath, ['run.mjs'], { cwd: tests, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }, '<!doctype html><div id="summary">all 0 passed</div>');
});

test('an HTML test selection matching no suites fails', { timeout: 15000 }, async () => {
  await isolatedRunner((tests) => {
    const result = spawnSync(process.execPath, ['run.mjs', 'no-such-suite'], { cwd: tests, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
});

test('an empty browser selection fails instead of running no tests', { timeout: 10000 }, () => {
  const result = spawnSync(process.execPath, [join(here, 'comment-capture', 'run.mjs')], { cwd: here, encoding: 'utf8', timeout: 5000, env: { ...process.env, CAPTURE_ENGINES: '' } });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
});
