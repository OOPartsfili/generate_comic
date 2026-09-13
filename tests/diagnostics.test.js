import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Diagnostics } from '../server/diagnostics.js';
import { startServer } from '../server/index.js';

test('诊断只记录允许的元数据，轮转有界；日志故障不阻塞业务', async t => {
  const base = path.resolve('tests/.tmp'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'diagnostics-'));
  t.after(async () => { assert.equal(path.dirname(dir), base); await rm(dir, { recursive: true, force: true }); });
  const log = new Diagnostics(dir, { maxBytes: 420 });
  for (let i = 0; i < 20; i++) await log.record({ stage: 'image_failed', traceId: 'test-trace', code: 'IMAGE_TOOL_NOT_CALLED', model: 'gpt-5.5', durationMs: i,
    prompt: 'PRIVATE STORY', error: 'Bearer PRIVATE TOKEN', stderr: 'SECRET', result: 'BASE64 SECRET', apiKey: 'sk-private', account: { email: 'private@example.invalid' }, savedPath: 'C:\\Private', plan: 'sk-secret' });
  const snapshot = await log.snapshot();
  assert.ok(snapshot.entries.length > 0 && snapshot.entries.length < 20);
  assert.equal(snapshot.entries.at(-1).durationMs, 19);
  assert.equal(snapshot.writeError, false);
  assert.ok(!/PRIVATE|SECRET|sk-secret|private@example/.test(JSON.stringify(snapshot)));
  assert.deepEqual((await readdir(log.directory)).sort(), ['codex.jsonl', 'codex.jsonl.1']);
  const blocked = new Diagnostics(path.join(dir, 'blocked')); await mkdir(path.join(dir, 'blocked'));
  await writeFile(blocked.directory, 'not a directory');
  await blocked.record({ stage: 'image_saved' }); assert.equal((await blocked.snapshot()).writeError, true);
});

test('导出诊断受本机令牌保护，导出不会连接模型或带出账户配置', async t => {
  const base = path.resolve('tests/.tmp'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'diagnostics-http-'));
  const service = await startServer({ port: 0, dataDir: dir, token: 'private-desktop-token' });
  t.after(async () => { await new Promise(resolve => service.server.close(resolve)); assert.equal(path.dirname(dir), base); await rm(dir, { recursive: true, force: true }); });
  await service.ai.codex.diagnostics.record({ stage: 'image_saved', traceId: 'test-trace' });
  assert.equal((await fetch(service.url + '/api/diagnostics')).status, 403);
  const response = await fetch(service.url + '/api/diagnostics', { headers: { 'x-studio-token': 'private-desktop-token' } });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.entries[0].traceId, 'test-trace'); assert.equal(service.ai.codex.connection, null);
  assert.ok(!JSON.stringify(data).includes('private-desktop-token'));
});
