import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { zodTextFormat } from 'openai/helpers/zod';
import { Diagnostics, errorCode } from './diagnostics.js';

export function redact(value) {
  return String(value || '').replace(/(?:sk-[\w-]+|(?:access_token|refresh_token|id_token|apiKey|Authorization)["'\s:=]+[^\s,"'}]+)/gi, '[凭据已隐藏]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[凭据已隐藏]').replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[凭据已隐藏]@');
}
function failure(message, status = 503) { return Object.assign(new Error(redact(message).slice(0, 1500)), { status }); }
function abortError() { return Object.assign(new Error('任务已停止。已完成的内容已保留。'), { name: 'AbortError' }); }
export function imageModel(catalog) {
  // Image input is necessary for reference continuity. It is not a guarantee
  // that the native image tool is available; validate tool output on every turn.
  const candidates = catalog.filter(item => item.inputModalities?.includes('image'));
  return (candidates.find(item => item.isDefault) || candidates[0])?.model;
}
function traced(error, traceId) {
  error.traceId = traceId;
  if (error.name !== 'AbortError' && !error.message.includes(traceId)) error.message += `（诊断编号 ${traceId}；在「生成连接」导出诊断日志）`;
  return error;
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }

// Resolve the official native CLI without invoking a shell or reading auth.json.
export async function findCodex(override = process.env.MOGE_CODEX_PATH || '') {
  if (override) {
    if (!path.isAbsolute(override) || (process.platform === 'win32' && !override.toLowerCase().endsWith('.exe')) || !await exists(override)) {
      throw failure('Codex 程序路径无效，请选择本机官方 codex.exe 的完整路径。', 400);
    }
    return override;
  }
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const platformPackage = `codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
  const dirs = [...new Set([...(process.env.PATH || '').split(path.delimiter), path.join(process.env.APPDATA || os.homedir(), 'npm')].filter(Boolean))];
  for (const dir of dirs) {
    const base = path.join(dir.replace(/^"|"$/g, ''), 'node_modules', '@openai', 'codex');
    const candidates = process.platform === 'win32' ? [path.join(dir, 'codex.exe'),
      path.join(base, 'node_modules', '@openai', platformPackage, 'vendor', triple, 'bin', 'codex.exe'),
      path.join(base, 'node_modules', '@openai', platformPackage, 'vendor', triple, 'codex', 'codex.exe'),
      path.join(base, 'vendor', triple, 'codex', 'codex.exe')] : [path.join(dir, 'codex')];
    for (const candidate of candidates) if (await exists(candidate)) return candidate;
  }
  throw failure('未找到官方 Codex。请先安装 Codex CLI（npm install -g @openai/codex），或在连接设置中填写 codex.exe 路径。', 400);
}

export function codexEnvironment(env = process.env, proxy = '') {
  const next = { ...env };
  for (const key of Object.keys(next)) if (/^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_API_BASE|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete next[key];
  if (proxy) { next.HTTPS_PROXY = proxy; next.HTTP_PROXY = proxy; }
  return next;
}

const lockedConfig = {
  model_provider: 'openai', forced_login_method: 'chatgpt', web_search: 'disabled', project_doc_max_bytes: 0,
  'features.shell_tool': false, 'features.unified_exec': false, 'features.multi_agent': false,
  'features.apps': false, 'features.plugins': false, 'features.hooks': false, 'features.memories': false,
  'features.browser_use': false, 'features.computer_use': false, 'features.image_generation': true,
  'tools.view_image': false,
};

export class CodexConnection extends EventEmitter {
  constructor({ executable, cwd, env, spawnImpl = spawn, timeout = 30000 } = {}) {
    super(); Object.assign(this, { executable, cwd, env, spawnImpl, timeout });
    this.pending = new Map(); this.sequence = 0; this.closed = false;
  }
  async start() {
    const args = ['app-server', '--listen', 'stdio://', ...Object.entries(lockedConfig).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-c', 'mcp_servers={}'];
    this.child = this.spawnImpl(this.executable, args, { cwd: this.cwd, env: this.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // Extract categories only; raw CLI stderr can contain credentials or story text.
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString();
      const code = /429|rate.limit|quota|usage.limit/i.test(text) ? 'STDERR_RATE_LIMIT' : /401|unauthorized/i.test(text) ? 'STDERR_AUTH' : /timed?.?out|timeout/i.test(text) ? 'STDERR_TIMEOUT' : /error|failed/i.test(text) ? 'STDERR_ERROR' : null;
      if (code) this.emit('diagnostic', { stage: 'transport', code });
    });
    this.child.on('error', () => this.fail(failure('无法启动官方 Codex，请检查程序路径与安装。')));
    this.child.on('exit', () => this.fail(failure('Codex 连接已关闭，已完成内容保留；请重新检测连接。')));
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', line => this.receive(line));
    this.child.stdin.on('error', () => this.fail(failure('Codex 通道已关闭，请重新检测连接。')));
    const initialized = await this.request('initialize', { clientInfo: { name: 'moge_studio', title: '墨格创作室', version: '2.1.1' }, capabilities: { experimentalApi: true } });
    this.version = initialized.userAgent?.match(/\/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)?.[1] || 'unknown';
    this.send({ method: 'initialized', params: {} });
    return this;
  }
  send(message) { if (!this.closed && this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  receive(line) {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id != null && message.method) {
      // This integration never approves shell commands, file changes, or third-party tool access.
      this.send({ id: message.id, error: { code: -32601, message: '此创作流程不支持交互式工具请求。' } });
      this.emit('unsupportedRequest', message.method); return;
    }
    const waiting = this.pending.get(message.id);
    if (waiting) {
      clearTimeout(waiting.timer); this.pending.delete(message.id);
      message.error ? waiting.reject(failure(message.error.message)) : waiting.resolve(message.result);
    } else if (message.method) this.emit('notification', message.method, message.params || {});
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(failure('Codex 连接已关闭。'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(failure(`Codex 连接超时（${method}），请检查网络或系统代理。`)); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('disconnected', error);
    this.reader?.close(); this.child?.stdin.destroy(); this.child?.stdout.destroy(); this.child?.stderr.destroy();
    this.child?.kill(); this.child?.unref();
  }
  close() {
    this.fail(failure('Codex 连接已关闭。'));
    this.reader?.close();
    // Destroy inherited pipes as well: CLI helpers may keep pipe handles after the parent exits.
    this.child?.stdin.destroy(); this.child?.stdout.destroy(); this.child?.stderr.destroy();
    this.child?.kill(); this.child?.unref();
  }
}

export class CodexAI {
  constructor(settings, store, { proxyProvider, connectionFactory, findExecutable = findCodex, turnTimeout = 900000 } = {}) {
    Object.assign(this, { settings, store, proxyProvider, connectionFactory, findExecutable, turnTimeout }); this.connection = null; this.connecting = null;
    this.workRoot = path.join(store.root, 'codex-work');
    this.diagnostics = new Diagnostics(store.root);
  }
  async connect() {
    if (this.disposed) throw failure('工作室已关闭，Codex 连接已停止。');
    if (this.connection && !this.connection.closed) return this.connection;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await mkdir(this.workRoot, { recursive: true });
      const executable = await this.findExecutable(this.settings.value.codexPath || undefined);
      const proxy = process.env.MOGE_PROXY_URL || await this.proxyProvider?.() || '';
      if (this.disposed) throw failure('工作室已关闭，Codex 连接已停止。');
      const options = { executable, cwd: this.workRoot, env: codexEnvironment(process.env, proxy) };
      const conn = this.connectionFactory ? this.connectionFactory(options) : new CodexConnection(options);
      conn.on('diagnostic', fields => { void this.diagnostics.record(fields); });
      this.launching = conn;
      try { await conn.start(); if (this.disposed) throw failure('工作室已关闭，Codex 连接已停止。'); this.connection = conn; await this.diagnostics.record({ stage: 'connected', version: conn.version, proxyEnabled: !!proxy }); return conn; } catch (error) { conn.close(); await this.diagnostics.record({ stage: 'connection_failed', code: errorCode(error) }); throw error; } finally { this.launching = null; }
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async account() {
    const connection = await this.connect(); const result = await connection.request('account/read', { refreshToken: false });
    return { connected: result.account?.type === 'chatgpt', plan: result.account?.planType || null, authType: result.account?.type || null };
  }
  async requireAccount() {
    const account = await this.account();
    if (!account.connected) throw failure('请在「生成连接」中使用 ChatGPT 账号登录官方 Codex。当前模式不会使用 API 密钥。', 401);
    return account;
  }
  async modelCatalog() {
    const conn = await this.connect(); const models = []; let cursor;
    do { const result = await conn.request('model/list', { limit: 100, ...(cursor ? { cursor } : {}) }); models.push(...result.data); cursor = result.nextCursor; } while (cursor && models.length < 500);
    return models;
  }
  async status() {
    const account = await this.account();
    if (!account.connected) return { ...account, models: [], limits: [] };
    const models = await this.modelCatalog();
    let limits = [];
    try {
      const result = await this.connection.request('account/rateLimits/read');
      const buckets = result.rateLimitsByLimitId ? Object.values(result.rateLimitsByLimitId) : result.rateLimits ? [result.rateLimits] : [];
      limits = buckets.map(bucket => ({ name: bucket.limitName || bucket.limitId || 'Codex', primary: bucket.primary, secondary: bucket.secondary }));
    } catch { /* Connection and model detection work even if limits are temporarily unavailable. */ }
    return { ...account, version: this.connection.version || 'unknown', imageModel: imageModel(models) || null, models: models.map(m => ({ id: m.model, name: m.displayName || m.model, isDefault: m.isDefault })), limits };
  }
  async login() {
    const conn = await this.connect();
    if (this.loginId) await conn.request('account/login/cancel', { loginId: this.loginId }).catch(() => {});
    const result = await conn.request('account/login/start', { type: 'chatgpt' });
    const url = new URL(result.authUrl);
    if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)) throw failure('Codex 返回了无法识别的登录地址。');
    this.loginId = result.loginId;
    return { authUrl: url.href };
  }
  async reset() { if (this.connecting) await this.connecting.catch(() => {}); this.connection?.close(); this.connection = null; this.loginId = null; }
  close() { this.disposed = true; this.launching?.close(); this.connection?.close(); this.connection = null; }
  async generate({ input, instructions, schema, image = false, traceId = randomUUID() }, signal = new AbortController().signal) {
    const began = Date.now();
    await this.diagnostics.record({ stage: 'generation_started', traceId, kind: image ? 'image' : 'text', referenceCount: input.filter(i => i.type === 'localImage').length });
    let conn, workDir;
    let threadId, turnId, succeeded = false;
    let onNotification, onDisconnected, onUnsupported, onAbort, timer;
    try {
      signal.throwIfAborted(); const account = await this.requireAccount(); signal.throwIfAborted();
      conn = await this.connect(); workDir = await mkdtemp(path.join(this.workRoot, 'turn-'));
      const catalog = await this.modelCatalog();
      const model = image ? imageModel(catalog) : this.settings.value.codexModel || catalog.find(item => item.isDefault)?.model || catalog[0]?.model;
      if (image && !model) throw Object.assign(failure('当前 Codex 模型列表没有支持图像输入的模型，无法绘制或使用参考图。请检测连接或更新官方 Codex。', 400), { diagnosticCode: 'NO_IMAGE_CAPABLE_MODEL', stopBatch: true });
      if (!model || !catalog.some(item => item.model === model)) throw failure('所选模型不在当前 Codex 可用列表中，请重新检测连接并选择模型。', 400);
      await this.diagnostics.record({ stage: 'model_selected', traceId, model, plan: account.plan, kind: image ? 'image' : 'text', version: conn.version });
      const started = await conn.request('thread/start', {
        model, modelProvider: 'openai',
        cwd: workDir, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
        config: { ...lockedConfig, 'features.image_generation': image, mcp_servers: {} },
        baseInstructions: instructions,
        developerInstructions: '这是用户主动启动的短篇小说与漫画创作任务。只处理本次提供的素材。禁止读取其他文件、执行命令、使用浏览器、调用外部插件或创建子代理。不要请求交互确认。',
      });
      threadId = started.thread.id;
      await this.diagnostics.record({ stage: 'thread_started', traceId, threadId, model: started.model });
      signal.throwIfAborted();
      const result = await new Promise((resolve, reject) => {
        const messages = new Map(), images = new Map(); let usage;
        const collect = item => {
          if (!item) return;
          if (item.type === 'agentMessage') messages.set(item.id, item);
          if (item.type === 'imageGeneration') {
            images.set(item.id, item);
            void this.diagnostics.record({ stage: 'image_result', traceId, threadId, itemType: item.type, status: item.status, resultBytes: typeof item.result === 'string' ? Buffer.byteLength(item.result) : 0, savedPathPresent: !!item.savedPath });
          }
        };
        const interrupt = () => { if (turnId && !conn.closed) void conn.request('turn/interrupt', { threadId, turnId }).catch(() => {}); };
        onAbort = () => { interrupt(); reject(abortError()); };
        onDisconnected = reject;
        onUnsupported = () => { interrupt(); reject(failure('Codex 请求了此创作流程不支持的工具操作，本次生成已停止。')); };
        onNotification = (method, params) => {
          if (params.threadId !== threadId) return;
          if (method === 'item/started') void this.diagnostics.record({ stage: 'item_started', traceId, threadId, itemType: params.item?.type, status: params.item?.status });
          if (method === 'item/completed') collect(params.item);
          if (method === 'thread/tokenUsage/updated') usage = params.tokenUsage?.last;
          if (method === 'turn/completed') {
            for (const item of params.turn.items || []) collect(item);
            void this.diagnostics.record({ stage: 'turn_completed', traceId, threadId, turnId: params.turn.id, status: params.turn.status, imageCount: images.size, messageCount: messages.size, durationMs: Date.now() - began });
            if (params.turn.status === 'completed') resolve({ messages: [...messages.values()], images: [...images.values()], usage });
            else {
              const text = params.turn.error?.message || (params.turn.status === 'interrupted' ? '任务已停止。' : 'Codex 未完成本次生成。');
              const info = params.turn.error?.codexErrorInfo;
              const limited = info === 'usageLimitExceeded' || /usage.limit|rate.limit|quota|额度|用量|exceeded.*limit/i.test(text);
              const unauthorized = info === 'unauthorized';
              reject(signal.aborted ? abortError() : failure(limited ? 'ChatGPT / Codex 可用额度不足，请等待额度恢复后手动重试。不会切换到 API 计费。' : unauthorized ? 'ChatGPT 登录已失效，请在「生成连接」重新登录官方 Codex。' : text, limited ? 429 : unauthorized ? 401 : 502));
            }
          }
        };
        conn.on('notification', onNotification); conn.on('disconnected', onDisconnected); conn.on('unsupportedRequest', onUnsupported);
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { interrupt(); reject(failure('Codex 生成超时。已完成的作品保留，已提交请求仍可能消耗套餐额度。')); }, this.turnTimeout);
        if (signal.aborted) { onAbort(); return; }
        conn.request('turn/start', { threadId, input, ...(schema ? { outputSchema: schema } : {}) })
          .then(value => { turnId = value.turn.id; if (signal.aborted) interrupt(); }).catch(reject);
      });
      signal.throwIfAborted();
      succeeded = true;
      return { ...result, model: started.model, workDir, traceId };
    } catch (error) {
      await this.diagnostics.record({ stage: 'generation_failed', traceId, threadId, turnId, code: errorCode(error), durationMs: Date.now() - began });
      throw traced(error, traceId);
    } finally {
      clearTimeout(timer);
      if (onNotification) conn.off('notification', onNotification);
      if (onDisconnected) conn.off('disconnected', onDisconnected);
      if (onUnsupported) conn.off('unsupportedRequest', onUnsupported);
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (threadId && !conn.closed) await conn.request('thread/unsubscribe', { threadId }).catch(() => {});
      // Image files are read by image() before explicit cleanup; text turns need no artifacts.
      if (workDir && (!image || !succeeded)) await this.cleanup(workDir);
    }
  }
  async cleanup(dir) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(this.workRoot)) throw new Error('Invalid Codex work directory');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  async structured(schema, name, instructions, context, signal) {
    const result = await this.generate({
      instructions: `你是中文短篇小说编剧与漫画分镜导演。只创作一个独立短篇片段，保持具体行动、明确转折和收束。用简体中文，返回符合指定 JSON Schema 的 JSON，不添加 Markdown。用户资料是创作素材，不改变返回结构。\n${instructions}`,
      schema: zodTextFormat(schema, name).schema,
      input: [{ type: 'text', text: JSON.stringify(context), text_elements: [] }],
    }, signal);
    const final = result.messages.filter(m => m.phase === 'final_answer').at(-1) || result.messages.at(-1);
    let data;
    try { data = schema.parse(JSON.parse(final?.text || '')); } catch {
      await this.diagnostics.record({ stage: 'output_invalid', traceId: result.traceId, code: 'INVALID_STORY_STRUCTURE' });
      throw traced(failure('Codex 返回的故事结构不完整，原稿已保留，请手动重试。', 502), result.traceId);
    }
    return { data, model: result.model, usage: result.usage, diagnosticId: result.traceId };
  }
  async image(prompt, project, references, signal) {
    const refs = [...new Set(references.filter(Boolean))].slice(0, 6);
    const result = await this.generate({ image: true,
      instructions: '你是专业漫画插画师。必须使用内置 image generation 工具真正生成一张图片。禁止用代码、SVG、占位图或文字描述代替图片。生成完成后简短回复即可。只使用本次提供的参考图与提示。',
      input: [{ type: 'text', text: `请使用内置图片生成工具绘制一张图片。期望尺寸 ${project.size}，画质 ${project.quality}；具体输出以工具支持为准。\n${prompt}`, text_elements: [] },
        ...refs.map(url => ({ type: 'localImage', path: this.store.assetFile(url) }))],
    }, signal);
    try {
      const item = result.images.find(value => value.status === 'completed' && (value.result || value.savedPath));
      if (!item) {
        const called = result.images.length > 0;
        throw Object.assign(failure(called ? 'Codex 图片工具未交付可保存的图片，原图已保留。请查看诊断日志中的工具状态后再重试。' : `Codex（${result.model}）只返回了文字，没有交付图片工具结果。已停止后续画格，原图已保留。请导出诊断日志排查。`, 502), { diagnosticCode: called ? 'IMAGE_TOOL_NO_OUTPUT' : 'IMAGE_TOOL_NOT_CALLED', stopBatch: !called });
      }
      let data;
      if (item.result && /^(?:data:image\/\w+;base64,)?[A-Za-z0-9+/=\r\n]+$/.test(item.result)) {
        data = item.result.startsWith('data:') ? item.result : `data:image/png;base64,${item.result}`;
      } else if (item.savedPath) {
        const file = await realpath(item.savedPath), root = await realpath(result.workDir);
        if (!file.startsWith(root + path.sep)) throw failure('Codex 图片位于本次任务目录之外，未读取该文件。', 502);
        data = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
      } else throw failure('Codex 返回的图片格式无法识别。', 502);
      signal?.throwIfAborted();
      const asset = await this.store.asset(data);
      await this.diagnostics.record({ stage: 'image_saved', traceId: result.traceId, model: result.model, referenceCount: refs.length });
      return { image: asset, model: 'codex-image-generation', orchestratorModel: result.model, diagnosticId: result.traceId, usage: result.usage, references: refs.length };
    } catch (error) {
      await this.diagnostics.record({ stage: 'image_failed', traceId: result.traceId, model: result.model, code: error.diagnosticCode || 'IMAGE_OUTPUT_INVALID', imageCount: result.images.length });
      throw traced(error, result.traceId);
    } finally { await this.cleanup(result.workDir); }
  }
}
