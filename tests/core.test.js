import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { Store } from '../server/storage.js';
import { AI, Settings } from '../server/openai.js';
import { proseResponse } from '../server/schemas.js';
import { newProject, demoProject } from '../shared/story.js';
import { fakeAI, png } from './fixtures.js';

const tempBase = path.resolve('tests/.tmp');
async function temp(t) { await mkdir(tempBase, { recursive: true }); const dir = await mkdtemp(path.join(tempBase, 'core-')); t.after(async () => { assert.ok(path.resolve(dir).startsWith(tempBase + path.sep)); await rm(dir, { recursive: true, force: true }); }); return dir; }
async function harness(t, options = {}) {
  const dir = await temp(t); const service = await startServer({ port: 0, dataDir: dir, aiFactory: (s, store) => fakeAI(s, store, options) });
  t.after(() => new Promise(resolve => service.server.close(resolve)));
  async function req(url, method = 'GET', body, headers = {}) { const response = await fetch(service.url + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; }
  async function done(job) { for (let i = 0; i < 200; i++) { const j = (await req('/jobs/' + job.id)).data; if (!['queued', 'running', 'cancelling'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 20)); } throw new Error('任务未结束'); }
  return { ...service, req, done, dir };
}

test('完整工作流：纲要确认、文稿、角色、批量绘图、历史、导出导入', async t => {
  const h = await harness(t); let p = (await h.req('/projects', 'POST', { ...newProject(), idea: '一个女孩在末班公交遇见装着星星的玻璃罐。' })).data;
  const run = async (type, targetId) => { const r = await h.req(`/projects/${p.id}/jobs`, 'POST', { type, targetId, revision: p.revision }); assert.equal(r.status, 202, JSON.stringify(r.data)); const job = await h.done(r.data); p = (await h.req(`/projects/${p.id}`)).data; return job; };
  assert.equal((await run('outline')).status, 'completed'); assert.ok(p.outline); assert.equal(p.outlineApproved, false);
  assert.notEqual((await h.req(`/projects/${p.id}/jobs`, 'POST', { type: 'prose', revision: p.revision })).status, 202);
  p = (await h.req(`/projects/${p.id}`, 'PUT', { ...p, outlineApproved: true })).data;
  assert.equal((await run('prose')).status, 'completed'); assert.ok(p.prose.length > 30);
  assert.equal((await run('character', 'c1')).status, 'completed'); assert.match(p.characters[0].reference, /^\/assets\//);
  assert.equal((await run('storyboard')).status, 'completed'); assert.equal(p.panels.length, 4);
  assert.equal((await run('panels')).status, 'completed'); assert.equal(p.panels.filter(s => s.image).length, 4);
  const previous = p.panels[0].image; assert.equal((await run('panel', p.panels[0].id)).status, 'completed'); assert.equal(p.panels[0].history.length, 2); assert.notEqual(p.panels[0].image, previous);
  const exported = (await h.req(`/projects/${p.id}/export`)).data; assert.match(exported.project.panels[0].image, /^data:image\/png/); assert.ok(!JSON.stringify(exported).includes('apiKey'));
  const imported = await h.req('/import', 'POST', exported); assert.equal(imported.status, 201); assert.notEqual(imported.data.id, p.id); assert.equal(imported.data.panels.length, 4);
  const versions = (await h.req(`/projects/${p.id}/versions`)).data; assert.ok(versions.length >= 6);
  const restored = (await h.req(`/projects/${p.id}/restore/${versions.at(-1).id}`, 'POST')).data; assert.equal(restored.outline, null); assert.ok(restored.revision > p.revision);
});

test('并发与失效纲要：旧修订号、任务期间写入、重新确认', async t => {
  const h = await harness(t, { delay: 130 }); let p = (await h.req('/projects', 'POST', demoProject())).data;
  const old = p; p = (await h.req(`/projects/${p.id}`, 'PUT', { ...p, outlineApproved: true })).data;
  assert.equal((await h.req(`/projects/${p.id}`, 'PUT', old)).status, 409);
  const job = await h.req(`/projects/${p.id}/jobs`, 'POST', { type: 'prose', revision: p.revision });
  assert.equal((await h.req(`/projects/${p.id}/jobs`, 'POST', { type: 'prose', revision: p.revision })).status, 409);
  assert.equal((await h.req(`/projects/${p.id}`, 'PUT', p)).status, 409);
  await h.done(job.data); p = (await h.req(`/projects/${p.id}`)).data;
  p = (await h.req(`/projects/${p.id}`, 'PUT', { ...p, outline: { ...p.outline, ending: '新的结尾' }, outlineApproved: true })).data;
  assert.equal(p.outlineApproved, false); assert.ok(p.prose);
});

test('批量部分失败后补绘只请求缺失画格，取消任务保留作品', async t => {
  const h = await harness(t, { failAt: 2 }); let p = (await h.req('/projects', 'POST', { ...demoProject(), outlineApproved: true })).data;
  async function run(type) { const r = await h.req(`/projects/${p.id}/jobs`, 'POST', { type, revision: p.revision }); const j = await h.done(r.data); p = (await h.req(`/projects/${p.id}`)).data; return j; }
  await run('storyboard'); const j = await run('panels'); assert.equal(j.status, 'partial'); assert.equal(p.panels.filter(s => s.image).length, 3);
  const images = p.panels.map(s => s.image); const retry = await run('panels'); assert.equal(retry.total, 1); assert.equal(p.panels.filter(s => s.image).length, 4); assert.equal(p.panels[0].image, images[0]);
  const running = await h.req(`/projects/${p.id}/jobs`, 'POST', { type: 'prose', revision: p.revision }); await h.req(`/jobs/${running.data.id}/cancel`, 'POST'); assert.equal((await h.done(running.data)).status, 'cancelled');
});

test('错误分镜数量拒绝落盘；跨站、路径与无效图片拒绝', async t => {
  const h = await harness(t, { wrongCount: true }); const p = (await h.req('/projects', 'POST', { ...demoProject(), outlineApproved: true })).data;
  const j = await h.req(`/projects/${p.id}/jobs`, 'POST', { type: 'storyboard', revision: p.revision }); assert.equal((await h.done(j.data)).status, 'failed'); assert.equal((await h.req(`/projects/${p.id}`)).data.panels.length, 0);
  assert.equal((await h.req('/settings', 'GET', undefined, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await h.req('/assets', 'POST', { data: 'data:image/png;base64,ZmFrZSBpbWFnZSBkYXRh' })).status, 400);
  assert.throws(() => h.store.assetFile('/assets/../../settings.json'));
});

test('OpenAI 官方传输参数：结构化输出、PNG 生成与多参考图编辑、429 不自动重试', async t => {
  const dir = await temp(t); const store = new Store(dir); await store.init(); const settings = new Settings(dir); await settings.init();
  await settings.save({ provider: 'api', textModel: 'gpt-5-mini', imageModel: 'gpt-image-2', apiKey: 'test-key-not-a-real-secret' });
  const captured = []; let fail = false;
  const transport = async (url, init) => {
    if (url === 'data:,') return new Response('');
    captured.push({ url, init });
    if (fail) return new Response(JSON.stringify({ error: { message: 'quota', type: 'rate_limit_error', code: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/responses')) return Response.json({ id: 'resp_test', status: 'completed', output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ prose: '这是一份用于验证 OpenAI 结构化返回格式的测试文稿，不代表实际调用模型生成的结果。' }), annotations: [] }] }] });
    return Response.json({ data: [{ b64_json: png.split(',')[1] }] });
  };
  const ai = new AI(settings, store, transport); const signal = new AbortController().signal;
  const response = await ai.structured(proseResponse, 'prose', '编写短篇', {}, signal); assert.ok(response.data.prose.length > 30);
  const body = JSON.parse(captured[0].init.body); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true); assert.equal(body.store, false);
  const p = newProject(); const generated = await ai.image('测试提示', p, [], signal); const generation = JSON.parse(captured[1].init.body); assert.equal(generation.output_format, 'png'); assert.equal(generation.response_format, undefined);
  await ai.image('保持人物一致', p, [generated.image], signal); const form = captured[2].init.body; assert.equal(form.get('model'), 'gpt-image-2'); assert.equal(form.get('input_fidelity'), null); assert.ok([...form.keys()].some(k => k.startsWith('image')));
  fail = true; const before = captured.length; await assert.rejects(ai.image('测试', p, [], signal)); assert.equal(captured.length - before, 1);
  assert.ok(!(await readFile(settings.file, 'utf8')).includes('test-key-not-a-real-secret'));
});
