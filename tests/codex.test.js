import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CodexAI, CodexConnection, codexEnvironment, redact } from '../server/codex.js';
import { AI, Settings } from '../server/openai.js';
import { Store, atomicJson } from '../server/storage.js';
import { proseResponse } from '../server/schemas.js';
import { newProject } from '../shared/story.js';
import { png } from './fixtures.js';

class FakeConnection extends EventEmitter {
  constructor(options = {}) { super(); this.options = options; this.calls = []; this.number = 0; this.closed = false; }
  async start() { return this; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { type: this.options.authType || 'chatgpt', planType: 'pro', email: 'private-account@example.invalid', accessToken: 'private-token-must-not-escape' } };
    if (method === 'model/list') return { data: this.options.models || [{ model: 'gpt-5.5', isDefault: true, displayName: 'GPT-5.5', inputModalities: ['text', 'image'] }, { model: 'gpt-5.3-codex-spark', inputModalities: ['text'] }] };
    if (method === 'account/rateLimits/read') return { rateLimits: { limitId: 'codex', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1800000000 } } };
    if (method === 'thread/start') return { thread: { id: `thread-${++this.number}` }, model: params.model };
    if (method === 'turn/start') {
      const turnId = `turn-${this.number}`;
      if (!this.options.hang) setTimeout(() => {
        const item = this.options.image ? { id: 'image-1', type: 'imageGeneration', status: this.options.toolFailed ? 'failed' : 'completed', result: this.options.toolFailed ? '' : png.split(',')[1] } : { id: 'message-1', type: 'agentMessage', phase: 'final_answer', text: this.options.malformed ? '这不是 JSON' : JSON.stringify({ prose: '这是一份隔离测试生成的短篇，验证官方 Codex 通道能够返回完整结构，而不会将私有登录凭据写入故事。' }) };
        if (!this.options.finalItemsOnly) this.emit('notification', 'item/completed', { threadId: params.threadId, item });
        this.emit('notification', 'turn/completed', { threadId: params.threadId, turn: { id: turnId, items: [item], status: this.options.quota ? 'failed' : 'completed', error: this.options.quota ? { message: 'Limit reached', codexErrorInfo: 'usageLimitExceeded' } : null } });
      }, 5);
      return { turn: { id: turnId } };
    }
    return {};
  }
  close() { this.closed = true; }
}
async function harness(t, options) {
  const base = path.resolve('tests/.tmp'); await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'codex-test-'));
  const store = new Store(dir); await store.init(); const settings = new Settings(dir); await settings.init();
  const connection = new FakeConnection(options); let apiCalls = 0;
  const ai = new AI(settings, store, () => { apiCalls++; throw new Error('Must not call API'); }, { connectionFactory: () => connection, findExecutable: async () => 'test-codex', turnTimeout: 1000 });
  t.after(async () => { ai.close(); await ai.codex.diagnostics.pending; assert.equal(path.dirname(dir), base); await rm(dir, { recursive: true, force: true }); });
  return { dir, settings, ai, store, connection, apiCalls: () => apiCalls };
}

test('默认使用 ChatGPT；旧密钥保留为可选配置，不暴露凭据、不调用 API', async t => {
  const h = await harness(t);
  await atomicJson(h.settings.file, { textModel: 'gpt-5-mini', imageModel: 'gpt-image-2', encryptedKey: 'legacy-encrypted-value' });
  await h.settings.init(); assert.equal(h.settings.public().provider, 'codex');
  const status = await h.ai.test(); assert.equal(status.connected, true); assert.equal(status.plan, 'pro');
  assert.ok(!JSON.stringify(status).includes('private-')); assert.ok(!JSON.stringify(h.settings.public()).includes('encryptedKey'));
  const output = await h.ai.structured(proseResponse, 'prose', '写短篇', { idea: '小猫的灯塔' }, new AbortController().signal);
  assert.ok(output.data.prose.length > 30); assert.equal(h.apiCalls(), 0);
  const start = h.connection.calls.find(c => c.method === 'thread/start').params;
  assert.equal(start.model, 'gpt-5.5'); assert.equal(start.modelProvider, 'openai'); assert.equal(start.ephemeral, true); assert.equal(start.sandbox, 'read-only');
  assert.equal(start.config['features.shell_tool'], false); assert.equal(start.config['features.image_generation'], false);
  assert.ok(h.connection.calls.find(c => c.method === 'turn/start').params.outputSchema.required.includes('prose'));
  assert.deepEqual(await readdir(path.join(h.dir, 'codex-work')), []);
});

test('拒绝 API 登录与额度超限；不降级、不自动重新生成', async t => {
  const api = await harness(t, { authType: 'apiKey' });
  await assert.rejects(api.ai.structured(proseResponse, 'prose', '', {}, new AbortController().signal), error => error.status === 401);
  assert.ok(!api.connection.calls.some(c => c.method === 'turn/start')); assert.equal(api.apiCalls(), 0);
  const quota = await harness(t, { quota: true });
  await assert.rejects(quota.ai.structured(proseResponse, 'prose', '', {}, new AbortController().signal), error => error.status === 429);
  assert.equal(quota.connection.calls.filter(c => c.method === 'turn/start').length, 1); assert.equal(quota.apiCalls(), 0);
});

test('图片从官方事件落盘，参考图通过 localImage 传入；非 JSON 文稿拒绝', async t => {
  const h = await harness(t, { image: true }); const reference = await h.store.asset(png);
  const result = await h.ai.image('保持同一只猫，换成近景。', newProject(), [reference, reference], new AbortController().signal);
  assert.ok((await readFile(h.store.assetFile(result.image))).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(result.references, 1);
  const params = h.connection.calls.find(c => c.method === 'turn/start').params;
  assert.deepEqual(params.input[1], { type: 'localImage', path: h.store.assetFile(reference) });
  assert.equal(h.connection.calls.find(c => c.method === 'thread/start').params.config['features.image_generation'], true);
  assert.deepEqual(await readdir(path.join(h.dir, 'codex-work')), []);
  const malformed = await harness(t, { malformed: true });
  await assert.rejects(malformed.ai.structured(proseResponse, 'prose', '', {}, new AbortController().signal), /故事结构不完整/);
});

test('取消向官方 turn/interrupt 发信，清理监听器与临时目录', async t => {
  const h = await harness(t, { hang: true }); const controller = new AbortController();
  const running = h.ai.structured(proseResponse, 'prose', '', {}, controller.signal);
  const assertion = assert.rejects(running, error => error.name === 'AbortError');
  while (!h.connection.calls.some(c => c.method === 'turn/start')) await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort(); await assertion;
  assert.ok(h.connection.calls.some(c => c.method === 'turn/interrupt'));
  assert.equal(h.connection.listenerCount('notification'), 0); assert.deepEqual(await readdir(path.join(h.dir, 'codex-work')), []);
});

test('JSON-RPC 可处理分块消息，拒绝额外工具请求，关闭后回收待响应请求', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; child.unref = () => {};
  const writes = []; child.stdin.on('data', data => {
    const message = JSON.parse(data.toString()); writes.push(message);
    if (message.method === 'initialize') { const line = JSON.stringify({ id: message.id, result: {} }) + '\n'; child.stdout.write(line.slice(0, 7)); child.stdout.write(line.slice(7)); }
  });
  const conn = new CodexConnection({ executable: 'test', spawnImpl: (_file, _args, options) => { assert.equal(options.windowsHide, true); return child; } });
  await conn.start();
  child.stdout.write(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
  assert.equal(writes.at(-1).error.code, -32601);
  const waiting = assert.rejects(conn.request('account/read'), /连接已关闭/); conn.close(); await waiting; assert.equal(conn.pending.size, 0);
});

test('子进程剔除 API Key；错误信息隐藏 JWT、密钥和代理密码', () => {
  const env = codexEnvironment({ OPENAI_API_KEY: 'private', CODEX_API_KEY: 'private', ELECTRON_RUN_AS_NODE: '1', PATH: 'test', CODEX_HOME: 'local-auth-home' }, 'http://127.0.0.1:7890');
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_API_KEY, undefined); assert.equal(env.CODEX_HOME, 'local-auth-home'); assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  const safe = redact('sk-testsecret access_token=private-token eyJtest.payload.signature http://user:password@localhost:1');
  for (const secret of ['sk-testsecret', 'private-token', 'eyJtest', 'user:password']) assert.ok(!safe.includes(secret));
});

test('关闭窗口发生在 Codex 启动前时，不遗留后台进程', async t => {
  const h = await harness(t); let release; let spawned = false;
  const codex = new CodexAI(h.settings, h.store, { findExecutable: () => new Promise(resolve => { release = resolve; }), connectionFactory: () => { spawned = true; return new FakeConnection(); } });
  const connecting = codex.connect(); const assertion = assert.rejects(connecting, /工作室已关闭/);
  while (!release) await new Promise(resolve => setTimeout(resolve, 2));
  codex.close(); release('test-codex'); await assertion; assert.equal(spawned, false);
});

test('Spark 仅负责文字，图片独立路由；最终 turn items 也能接收真实图片', async t => {
  const h = await harness(t, { image: true, finalItemsOnly: true });
  h.settings.value.codexModel = 'gpt-5.3-codex-spark';
  const result = await h.ai.image('private-story-must-not-appear-in-logs', newProject(), [], new AbortController().signal);
  assert.equal(result.orchestratorModel, 'gpt-5.5');
  assert.equal(h.settings.value.codexModel, 'gpt-5.3-codex-spark');
  assert.equal(h.connection.calls.filter(c => c.method === 'turn/start').length, 1);
  const log = await h.ai.codex.diagnostics.snapshot();
  assert.ok(log.entries.some(e => e.stage === 'image_saved' && e.traceId === result.diagnosticId));
  for (const value of ['private-story', png.split(',')[1], 'private-account', 'private-token', h.dir]) assert.ok(!JSON.stringify(log).includes(value));
  h.connection.options.image = false;
  const text = await h.ai.structured(proseResponse, 'prose', '', {}, new AbortController().signal);
  assert.equal(text.model, 'gpt-5.3-codex-spark');
});

test('未调用图片工具与工具失败分别记录诊断；缺少图像模型时不消耗生成请求', async t => {
  for (const options of [{}, { image: true, toolFailed: true }]) {
    const h = await harness(t, options); let traceId;
    await assert.rejects(h.ai.image('private-story', newProject(), [], new AbortController().signal), error => {
      traceId = error.traceId;
      assert.match(error.message, /诊断编号/);
      assert.equal(error.diagnosticCode, options.image ? 'IMAGE_TOOL_NO_OUTPUT' : 'IMAGE_TOOL_NOT_CALLED');
      assert.equal(error.stopBatch, !options.image); return true;
    });
    const log = await h.ai.codex.diagnostics.snapshot();
    assert.ok(log.entries.some(e => e.stage === 'image_failed' && e.traceId === traceId));
    assert.equal(h.connection.calls.filter(c => c.method === 'turn/start').length, 1);
    assert.deepEqual(await readdir(path.join(h.dir, 'codex-work')), []);
  }
  const h = await harness(t, { models: [{ model: 'gpt-5.3-codex-spark', isDefault: true, inputModalities: ['text'] }] });
  await assert.rejects(h.ai.image('', newProject(), [], new AbortController().signal), e => e.diagnosticCode === 'NO_IMAGE_CAPABLE_MODEL' && e.stopBatch);
  assert.ok(!h.connection.calls.some(c => c.method === 'turn/start'));
});
