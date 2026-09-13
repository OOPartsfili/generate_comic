import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Store } from './storage.js';
import { Settings, AI, friendlyError } from './openai.js';
import { Jobs } from './jobs.js';
import { newProject, projectMarkdown } from '../shared/story.js';
import { projectSchema } from './schemas.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

export async function createApplication({ dataDir = process.env.MOGE_DATA_DIR || path.join(root, 'data'), vault, fetchImpl, aiFactory, token, proxyProvider } = {}) {
  const store = new Store(dataDir); await store.init();
  const settings = new Settings(dataDir, vault); await settings.init();
  const ai = aiFactory ? aiFactory(settings, store) : new AI(settings, store, fetchImpl, { proxyProvider });
  const jobs = new Jobs(store, ai); await jobs.init();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return res.status(403).json({ error: '仅允许本机访问' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && !(process.env.NODE_ENV !== 'production' && origin === 'http://127.0.0.1:5173')) return res.status(403).json({ error: '不允许跨站请求' });
    if (token && req.get('x-studio-token') !== token) return res.status(403).json({ error: '请从桌面程序打开工作室' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '180mb' }));
  const exclusive = async (id, fn) => { if (jobs.active.has(id)) throw Object.assign(new Error('作品正在生成，请等待完成或停止任务后再编辑'), { status: 409 }); jobs.active.set(id, 'editing'); try { return await fn(); } finally { jobs.active.delete(id); } };
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'moge-studio', version: '2.1.0' }));
  app.get('/api/settings', (_req, res) => res.json(settings.public()));
  app.put('/api/settings', async (req, res) => { if (jobs.controllers.size) return res.status(409).json({ error: '请先等待当前生成结束再修改连接或模型' }); const oldPath = settings.value.codexPath; const saved = await settings.save(req.body); if (oldPath !== settings.value.codexPath) await ai.codex?.reset(); res.json(saved); });
  app.get('/api/connection', async (_req, res) => res.json(await ai.status()));
  app.post('/api/settings/test', async (_req, res) => res.json(await ai.test()));
  app.post('/api/codex/login', async (_req, res) => { if (jobs.controllers.size) return res.status(409).json({ error: '请先停止当前生成再登录。' }); if (!ai.codex) return res.status(400).json({ error: '当前服务不提供登录。' }); res.json(await ai.codex.login()); });
  app.get('/api/projects', async (_req, res) => res.json(await store.list()));
  app.post('/api/projects', async (req, res) => {
    const p = projectSchema.parse({ ...req.body, id: randomUUID(), version: 2, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    res.status(201).json(await store.save(p, null, { create: true }));
  });
  app.post('/api/import', async (req, res) => {
    let p = req.body.project || req.body;
    if (p.version !== 2) {
      if (!Array.isArray(p.panels) || !Array.isArray(p.characters)) throw Object.assign(new Error('这不是可识别的墨格或旧版漫画工程文件'), { status: 400 });
      const old = p; p = { ...newProject(), title: old.projectTitle || old.title || '导入的作品', idea: old.premise || '', customStyle: old.style || '', characters: (old.characters || []).map(c => ({ id: c.id || randomUUID(), name: c.name || '角色', role: c.role || '配角', appearance: c.look || c.appearance || '', personality: c.personality || '', reference: '', referenceHistory: [] })), panels: (old.panels || []).map(s => ({ id: s.id || randomUUID(), title: s.title || '画格', shot: s.shot || '中景', scene: s.scene || '', action: s.action || '', dialogue: s.dialogue || '', mood: s.mood || '', caption: '', prompt: '', characterIds: [], image: s.image || '', history: [], status: s.image ? 'ready' : 'idle', error: '', bubbleX: 8, bubbleY: 8 })) };
      p.panelCount = Math.max(1, Math.min(12, p.panels.length || 4));
    }
    if (!Array.isArray(p.characters) || p.characters.length > 6 || !Array.isArray(p.panels) || p.panels.length > 12) throw Object.assign(new Error('工程内容不完整，最多支持 6 位角色和 12 格漫画'), { status: 400 });
    p.id = randomUUID(); p.revision = 0;
    p.createdAt = p.updatedAt = new Date().toISOString();
    for (const c of p.characters) { c.referenceHistory = []; if (c.reference?.startsWith('data:image/svg')) throw new Error('旧版占位参考图无法导入，请改用 PNG/JPEG/WebP。'); c.reference = c.reference ? await store.asset(c.reference) : ''; }
    for (const s of p.panels) { s.history = []; s.error = ''; if (s.image?.startsWith('data:image/svg')) s.image = ''; s.image = s.image ? await store.asset(s.image) : ''; s.status = s.image ? 'ready' : 'idle'; }
    res.status(201).json(await store.save(p, null, { create: true }));
  });
  app.get('/api/projects/:id', async (req, res) => res.json(await store.get(req.params.id)));
  app.put('/api/projects/:id', async (req, res) => res.json(await exclusive(req.params.id, async () => {
    if (req.body.id !== req.params.id) throw Object.assign(new Error('作品编号不匹配'), { status: 400 });
    const p = projectSchema.parse(req.body);
    const old = await store.get(p.id);
    if (JSON.stringify(p.outline) !== JSON.stringify(old.outline) || p.idea !== old.idea) p.outlineApproved = false;
    return store.save(p, p.revision);
  })));
  app.get('/api/projects/:id/export', async (req, res) => { const p = await store.get(req.params.id); res.attachment(`${encodeURIComponent(p.title)}.moge.json`).json(await store.exportProject(p)); });
  app.get('/api/projects/:id/markdown', async (req, res) => res.type('text/plain').send(projectMarkdown(await store.get(req.params.id))));
  app.post('/api/assets', async (req, res) => res.json({ image: await store.asset(req.body.data) }));
  app.get('/api/projects/:id/versions', async (req, res) => res.json(await store.versions(req.params.id)));
  app.post('/api/projects/:id/versions', async (req, res) => res.json(await exclusive(req.params.id, async () => ({ id: await store.snapshot(await store.get(req.params.id), String(req.body.label || '手动保存版本').slice(0, 100)) }))));
  app.post('/api/projects/:id/restore/:version', async (req, res) => res.json(await exclusive(req.params.id, async () => {
    const old = await store.get(req.params.id); const v = await store.version(req.params.id, req.params.version);
    await store.snapshot(old, '恢复历史版本之前');
    return store.save({ ...v.project, id: old.id, revision: old.revision }, old.revision);
  })));
  app.get('/api/projects/:id/jobs', (req, res) => res.json(jobs.list(req.params.id)));
  app.post('/api/projects/:id/jobs', async (req, res) => res.status(202).json(await jobs.start(req.params.id, req.body.type, req.body.targetId, String(req.body.note || ''), req.body.revision)));
  app.get('/api/jobs/:id', (req, res) => { const job = jobs.jobs.get(req.params.id); res.status(job ? 200 : 404).json(job || { error: '任务不存在' }); });
  app.post('/api/jobs/:id/cancel', async (req, res) => res.json(await jobs.cancel(req.params.id)));
  app.use('/assets', express.static(path.join(dataDir, 'assets'), { immutable: true, maxAge: '1y', dotfiles: 'deny' }));
  app.use(express.static(path.join(root, 'dist')));
  app.get('/', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError) return res.status(400).json({ error: `内容格式不正确：${error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join('；')}` });
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : error.status >= 400 && error.status <= 599 ? error.status : 500;
    res.status(status).json({ error: error.type === 'entity.too.large' ? '工程文件太大，请减少图片数量后再导入。' : error.type === 'entity.parse.failed' ? '文件不是有效的 JSON 工程。' : friendlyError(error) });
  });
  return { app, store, settings, jobs, ai };
}

export async function startServer(options = {}) {
  const application = await createApplication(options);
  const server = await new Promise((resolve, reject) => { const s = application.app.listen(options.port ?? Number(process.env.PORT || 8787), '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  server.once('close', () => application.ai.close?.());
  return { ...application, server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer().then(({ url }) => console.log(`墨格创作室已启动：${url}`)).catch(e => { console.error(friendlyError(e)); process.exitCode = 1; });
}
