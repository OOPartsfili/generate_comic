import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Store, atomicJson } from '../server/storage.js';
import { Jobs } from '../server/jobs.js';
import { demoProject } from '../shared/story.js';
import { fakeAI, png } from './fixtures.js';
test('程序中断后标记未完成任务，保留已完成素材，不自动追加付费请求', async () => {
  const root = path.resolve('tests/.tmp'); await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, 'recovery-'));
  try {
    const store = new Store(dir); await store.init(); const p = demoProject(); p.characters[0].reference = await store.asset(png);
    const saved = await store.save(p, null, { create: true });
    await atomicJson(path.join(dir, 'jobs', 'interrupted-job.json'), { id: 'interrupted-job', projectId: saved.id, status: 'running', progress: 1, total: 4, type: 'panels', createdAt: new Date().toISOString() });
    const jobs = new Jobs(store, fakeAI(null, store)); await jobs.init();
    assert.equal(jobs.list(saved.id)[0].status, 'interrupted'); assert.equal(jobs.controllers.size, 0); assert.equal(jobs.active.size, 0);
    assert.equal((await store.get(saved.id)).characters[0].reference, p.characters[0].reference);
  } finally { assert.ok(path.resolve(dir).startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); }
});

test('任务完成与停止同时发生：先落盘再公开状态，完成后不回退到停止中', async () => {
  const root = path.resolve('tests/.tmp'); await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, 'job-race-'));
  try {
    const store = new Store(dir); await store.init(); const jobs = new Jobs(store, fakeAI(null, store));
    const job = { id: 'race-job', status: 'running', message: '生成中' }; jobs.jobs.set(job.id, job); jobs.controllers.set(job.id, new AbortController());
    const completing = jobs.update(job, { status: 'completed', message: '生成完成' });
    assert.equal(job.status, 'running', 'Do not expose a terminal state before atomic persistence completes.');
    const cancelling = jobs.cancel(job.id);
    await Promise.all([completing, cancelling]);
    assert.equal(job.status, 'completed'); assert.equal(JSON.parse(await readFile(jobs.file(job.id), 'utf8')).status, 'completed');
    assert.equal(jobs.writes.size, 0);
  } finally { assert.equal(path.dirname(dir), root); await rm(dir, { recursive: true, force: true }); }
});
