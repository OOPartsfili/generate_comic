import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { outlineResponse, proseResponse, storyboardResponse } from './schemas.js';
import { friendlyError } from './openai.js';
import { styleText } from '../shared/story.js';

const labels = { outline: '生成故事纲要', prose: '生成小说文段', storyboard: '生成分镜脚本', character: '生成角色参考图', panel: '绘制单格', panels: '绘制缺失画格' };
export class Jobs {
  constructor(store, ai) { this.store = store; this.ai = ai; this.active = new Map(); this.jobs = new Map(); this.controllers = new Map(); this.writes = new Map(); }
  file(id) { return path.join(this.store.root, 'jobs', `${id}.json`); }
  async init() {
    const files = (await readdir(path.join(this.store.root, 'jobs'))).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const job = await readJson(path.join(this.store.root, 'jobs', file));
      if (['queued', 'running', 'cancelling'].includes(job.status)) { job.status = 'interrupted'; job.message = '上次运行被中断，已保存完成结果，可继续绘制缺失画格。'; await atomicJson(this.file(job.id), job); }
      this.jobs.set(job.id, job);
    }
  }
  async update(job, patch) {
    const previous = this.writes.get(job.id) || Promise.resolve();
    const writing = previous.catch(() => {}).then(async () => {
      if (['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(job.status) && ['queued', 'running', 'cancelling'].includes(patch.status)) return;
      const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
      await atomicJson(this.file(job.id), next);
      Object.assign(job, next);
    });
    this.writes.set(job.id, writing);
    try { await writing; } finally { if (this.writes.get(job.id) === writing) this.writes.delete(job.id); }
  }
  async start(projectId, type, targetId, note = '', revision) {
    if (!labels[type]) throw Object.assign(new Error('未知的生成任务'), { status: 400 });
    if (this.active.has(projectId)) throw Object.assign(new Error('这份作品仍有任务进行中'), { status: 409 });
    const id = randomUUID();
    this.active.set(projectId, id);
    try {
      const p = await this.store.get(projectId);
      if (revision !== p.revision) throw Object.assign(new Error('作品已更新，请重新打开后再生成'), { status: 409 });
      this.ai.client();
      if (type === 'outline' && p.idea.trim().length < 8) throw new Error('请先填写至少 8 个字的故事思路。');
      if (type !== 'outline' && (!p.outline || !p.outlineApproved)) throw new Error('请先确认故事纲要，再进行后续创作。');
      if (type === 'character' && !p.characters.some(c => c.id === targetId)) throw new Error('没有找到这个角色。');
      if (type === 'panel' && !p.panels.some(s => s.id === targetId)) throw new Error('没有找到这个画格。');
      if (type === 'panels' && !p.panels.some(s => !s.image)) throw new Error('所有画格都已完成；可选择单格重新绘制。');
      const job = { id, projectId, type, targetId, label: labels[type], status: 'queued', progress: 0, total: 1, message: '准备创作', createdAt: new Date().toISOString(), usage: [], errors: [] };
      this.jobs.set(id, job); await this.update(job, {});
      const controller = new AbortController(); this.controllers.set(id, controller);
      void this.run(job, p, note.slice(0, 4000), controller.signal);
      return job;
    } catch (e) { this.active.delete(projectId); throw e; }
  }
  async cancel(id) {
    const job = this.jobs.get(id); if (!job) throw new Error('任务不存在');
    const controller = this.controllers.get(id);
    if (controller) {
      const saving = this.update(job, { status: 'cancelling', message: '正在停止请求；已完成结果会保留。已提交的请求仍可能消耗额度或产生 API 费用。' });
      controller.abort(); await saving;
    }
    return job;
  }
  async run(job, p, note, signal) {
    try {
      await this.update(job, { status: 'running', message: labels[job.type] });
      await this.store.snapshot(p, `${labels[job.type]}之前`);
      const context = { idea: p.idea, genre: p.genre, tone: p.tone, audience: p.audience, panelCount: p.panelCount, wordCount: p.wordCount, style: styleText(p), outline: p.outline, characters: p.characters.map(({ id, name, role, appearance, personality }) => ({ id, name, role, appearance, personality })), revisionRequest: note };
      if (job.type === 'outline') {
        const r = await this.ai.structured(outlineResponse, 'short_story_outline', '先提出故事纲要，不写正文和分镜。起承转合 4 个节拍，以可视化事件描述；1—3 个核心角色、1—2 个场景、单一主要冲突，结尾必须兑现开场伏笔。角色 id 用 c1、c2、c3；外貌包含年龄、发型、服装色、标志道具。修改时继承已明确的创意。', context, signal);
        signal.throwIfAborted();
        p.title = r.data.outline.title.slice(0, 160); p.outline = r.data.outline; p.outlineApproved = false;
        p.characters = r.data.characters.map(c => ({ ...c, reference: '', referenceHistory: [] })); p.prose = ''; p.panels = [];
        job.usage.push({ model: r.model, usage: r.usage });
      } else if (job.type === 'prose') {
        const r = await this.ai.structured(proseResponse, 'short_story_prose', '根据已确认纲要写一篇完整短篇文段。正文长度接近 wordCount 个汉字。用动作、感官与对白推进，减少解释和形容词堆叠。段落之间用换行分隔。忠于纲要结尾和角色设定，不添加新支线。若有修改意见，只围绕意见修订正文。', { ...context, currentProse: p.prose }, signal);
        signal.throwIfAborted(); p.prose = r.data.prose; job.usage.push({ model: r.model, usage: r.usage });
      } else if (job.type === 'storyboard') {
        const r = await this.ai.structured(storyboardResponse, 'short_story_panels', `将已确认故事改编为恰好 ${p.panelCount} 格的连续漫画。每格只表现一个可绘制瞬间；安排远景交代空间，中近景推进动作，关键特写完成转折。最后一格必须收束故事。characterIds 只能使用提供的角色 id；只列入当前画面出场的人。每格对白简短不超过 60 个汉字，旁白不超过 40 字。prompt 描写视觉构图、人物位置、动作、视线、光线与道具连续性，不要求生成文字，不堆砌质量词。遵守时间、衣着和场景连续。`, { ...context, prose: p.prose }, signal);
        if (r.data.panels.length !== p.panelCount) throw new Error(`模型返回了 ${r.data.panels.length} 格，要求为 ${p.panelCount} 格，原分镜已保留，请重试。`);
        const ids = new Set(p.characters.map(c => c.id));
        if (r.data.panels.some(s => s.characterIds.some(id => !ids.has(id)))) throw new Error('分镜包含不在角色表中的角色，请重试。');
        signal.throwIfAborted(); p.panels = r.data.panels.map(s => ({ ...s, id: randomUUID(), image: '', history: [], status: 'idle', error: '', bubbleX: 8, bubbleY: 8 })); job.usage.push({ model: r.model, usage: r.usage });
      } else if (job.type === 'character') {
        const c = p.characters.find(c => c.id === job.targetId);
        const prompt = `为短篇漫画制作同一人物的角色设计参考图。统一风格：${styleText(p)}。人物：${c.name}，${c.role}。外貌不可变要素：${c.appearance}。气质：${c.personality}。干净中性色背景，正面全身、侧面半身、面部表情细节，三视图必须是同一个人，服装和配饰统一，不出现任何字、标注或水印。${note ? `本次调整：${note}` : ''}`;
        const r = await this.ai.image(prompt, { ...p, size: '1536x1024' }, [c.reference], signal);
        c.reference = r.image; c.referenceHistory = [...c.referenceHistory, { id: randomUUID(), image: r.image, createdAt: new Date().toISOString(), prompt, model: r.model }].slice(-30); job.usage.push({ model: r.model, usage: r.usage });
      } else {
        const targets = job.type === 'panel' ? p.panels.filter(s => s.id === job.targetId) : p.panels.filter(s => !s.image);
        await this.update(job, { total: targets.length });
        for (let i = 0; i < targets.length; i++) {
          signal.throwIfAborted();
          const s = targets[i]; const index = p.panels.indexOf(s);
          await this.update(job, { message: `正在绘制第 ${index + 1} 格 · ${s.title}`, progress: i });
          const cast = p.characters.filter(c => s.characterIds.includes(c.id));
          const refs = cast.map(c => c.reference).filter(Boolean);
          const continuityRef = p.panels.slice(0, index).reverse().find(x => x.image)?.image;
          if (continuityRef) refs.push(continuityRef);
          if (job.type === 'panel' && note && s.image) refs.unshift(s.image);
          const prompt = [`绘制一张完整单格漫画插画，禁止拼格。`, `统一画风：${styleText(p)}`, `故事环境：${p.outline.setting}`, `出场人物及必须保持的外貌：${cast.map(c => `${c.name}：${c.appearance}`).join('；') || '本格无人物'}`, `参考图用于保持人物身份、服装和画风；本格动作与构图以以下描述为准。`, `第 ${index + 1}/${p.panels.length} 格：${s.title}；镜头：${s.shot}`, `场景：${s.scene}；动作：${s.action}；情绪光线：${s.mood}`, `分镜视觉说明：${s.prompt}`, `前一格事件（仅用于保持连续，不要画入本格）：${p.panels[index - 1]?.action || '开场'}`, `对白语境（不要写在图上）：${s.dialogue}`, `不生成任何文字、对白气泡、边框或水印。中文对白之后由排版工具添加。为上方对白预留适当负空间，不要遮挡脸和关键动作。`, note ? `本次修改要求：${note}` : ''].filter(Boolean).join('\n');
          try {
            const r = await this.ai.image(prompt, p, refs, signal);
            s.image = r.image; s.status = 'ready'; s.error = ''; s.history = [...s.history, { id: randomUUID(), image: r.image, createdAt: new Date().toISOString(), prompt, model: r.model }].slice(-30);
            job.usage.push({ panelId: s.id, model: r.model, usage: r.usage, references: r.references });
          } catch (error) {
            if (signal.aborted) throw error;
            s.status = 'error'; s.error = friendlyError(error); job.errors.push({ panelId: s.id, error: s.error });
            if ([401, 403, 429].includes(error.status) || job.type === 'panel') { p = await this.store.save(p, p.revision); throw error; }
          }
          p = await this.store.save(p, p.revision);
          // Reconnect target objects after schema parsing in save().
          for (let j = i + 1; j < targets.length; j++) targets[j] = p.panels.find(x => x.id === targets[j].id);
          await this.update(job, { progress: i + 1 });
        }
      }
      if (!['panel', 'panels'].includes(job.type)) p = await this.store.save(p, p.revision);
      await this.update(job, { status: job.errors.length ? 'partial' : 'completed', progress: job.total, message: job.errors.length ? `完成 ${job.total - job.errors.length} 格，${job.errors.length} 格失败，可继续补绘。` : `${labels[job.type]}完成` });
    } catch (error) {
      await this.update(job, { status: signal.aborted ? 'cancelled' : 'failed', message: friendlyError(error) });
    } finally { this.active.delete(job.projectId); this.controllers.delete(job.id); }
  }
  list(projectId) { return [...this.jobs.values()].filter(j => j.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30); }
}
