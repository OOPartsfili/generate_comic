import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectSchema } from './schemas.js';

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export class Store {
  constructor(root) { this.root = root; }
  valid(id) { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Object.assign(new Error('无效的作品编号'), { status: 400 }); return id; }
  file(id) { return path.join(this.root, 'projects', `${this.valid(id)}.json`); }
  async init() { await Promise.all(['projects', 'assets', 'history', 'jobs'].map(d => mkdir(path.join(this.root, d), { recursive: true }))); }
  async get(id) { try { return projectSchema.parse(await readJson(this.file(id))); } catch (e) { if (e.code === 'ENOENT') throw Object.assign(new Error('作品不存在'), { status: 404 }); throw e; } }
  async list() {
    const files = (await readdir(path.join(this.root, 'projects'))).filter(f => f.endsWith('.json'));
    const rows = await Promise.all(files.map(async f => { try { const p = await readJson(path.join(this.root, 'projects', f)); return { id: p.id, title: p.title, updatedAt: p.updatedAt, panelCount: p.panels.length, ready: p.panels.filter(s => s.image).length, hasOutline: !!p.outline, cover: p.panels.find(s => s.image)?.image || '' }; } catch { return null; } }));
    return rows.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(raw, expected, { create = false } = {}) {
    const p = projectSchema.parse(raw);
    const current = await readJson(this.file(p.id), null);
    if (create && current) throw Object.assign(new Error('作品编号已经存在'), { status: 409 });
    if (!create && (!current || current.revision !== expected)) throw Object.assign(new Error('作品已有更新，请重新打开作品后继续。当前修改仍保留在编辑器中。'), { status: 409 });
    p.revision = (current?.revision || 0) + 1;
    p.updatedAt = new Date().toISOString();
    await atomicJson(this.file(p.id), p);
    return p;
  }
  async snapshot(p, label) {
    const id = randomUUID();
    await atomicJson(path.join(this.root, 'history', p.id, `${id}.json`), { id, label, createdAt: new Date().toISOString(), project: p });
    return id;
  }
  async versions(id) {
    this.valid(id);
    let files; try { files = await readdir(path.join(this.root, 'history', id)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const versions = await Promise.all(files.filter(f => f.endsWith('.json')).map(async f => { const v = await readJson(path.join(this.root, 'history', id, f)); return { id: v.id, label: v.label, createdAt: v.createdAt }; }));
    return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async version(id, versionId) { return readJson(path.join(this.root, 'history', this.valid(id), `${this.valid(versionId)}.json`)); }
  async asset(data) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(data || '');
    if (!match) throw Object.assign(new Error('请使用 PNG、JPEG 或 WebP 图片'), { status: 400 });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 12 * 1024 * 1024 || buffer.length < 12) throw Object.assign(new Error('参考图大小须在 12 MB 以内，且为有效图片'), { status: 400 });
    const valid = match[1] === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : match[1] === 'jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw Object.assign(new Error('图片内容与格式不匹配'), { status: 400 });
    const name = `${randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    await writeFile(path.join(this.root, 'assets', name), buffer);
    return `/assets/${name}`;
  }
  assetFile(url) {
    if (!/^\/assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(url)) throw new Error('无效的素材路径');
    return path.join(this.root, 'assets', path.basename(url));
  }
  async assetData(url) { const ext = path.extname(url).slice(1); return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${(await readFile(this.assetFile(url))).toString('base64')}`; }
  async exportProject(p) {
    const copy = structuredClone(p);
    for (const c of copy.characters) { if (c.reference) c.reference = await this.assetData(c.reference); c.referenceHistory = []; }
    for (const s of copy.panels) { if (s.image) s.image = await this.assetData(s.image); s.history = []; }
    return { format: 'moge-project', version: 2, exportedAt: new Date().toISOString(), project: copy };
  }
}
