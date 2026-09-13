import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
