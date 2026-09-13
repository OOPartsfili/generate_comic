import { readFile } from 'node:fs/promises';
import { demoProject } from '../shared/story.js';
export const fixture = demoProject();
export const png = `data:image/png;base64,${(await readFile(new URL('../desktop/icon.png', import.meta.url))).toString('base64')}`;
export function fakeAI(_settings, store, options = {}) {
  let calls = 0;
  return { client() { return {}; }, async models() { return ['gpt-5-mini', 'gpt-image-2']; },
    async status() { return { connected: true, authType: 'chatgpt', plan: 'pro', version: '0.138.0', imageModel: 'gpt-5.5', models: [{ id: 'gpt-5.5', name: 'GPT-5.5', isDefault: true }], limits: [{ name: 'Codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: null }] }; },
    async test() { return _settings.value.provider === 'codex' ? { ...await this.status(), ok: true, provider: 'codex' } : { ok: true, provider: 'api', models: await this.models(), textAvailable: true, imageAvailable: true }; },
    async structured(_schema, name, _instructions, ctx, signal) {
      await new Promise(resolve => setTimeout(resolve, options.delay || 70)); signal.throwIfAborted();
      if (name === 'short_story_outline') return { data: { outline: fixture.outline, characters: fixture.characters.map(({ reference: _r, referenceHistory: _h, ...c }) => c) }, model: 'test-text', usage: { input_tokens: 200, output_tokens: 300 } };
      if (name === 'short_story_prose') return { data: { prose: '雨停了。小满抱着纸箱坐上最后一班车。车厢里只有一个老人，玻璃罐里的暖光映在窗上。她伸出手，一颗星星轻轻碰了碰她的指尖。手机亮了起来：留了灯，回来吃面。她忽然知道，今天还有一个地方在等她。' }, model: 'test-text' };
      return { data: { panels: Array.from({ length: options.wrongCount ? 3 : ctx.panelCount }, (_, i) => ({ title: fixture.outline.beats[i % 4].label, shot: ['远景', '中景', '特写', '远景'][i % 4], scene: fixture.outline.setting, action: fixture.outline.beats[i % 4].text, dialogue: ['今天，也有一颗星星在等你。', '它们来自哪里？', '来自没说出口的心愿。', '留了灯，回来吃面。'][i % 4], caption: `这是第 ${i + 1} 格的旁白。`, mood: '温暖、蓝灰夜色', characterIds: ['c1', 'c2'], prompt: '电影分镜，清晰动作，保持人物服装。' })) }, model: 'test-text' };
    },
    async image(prompt, _p, refs, signal) {
      calls++; await new Promise(resolve => setTimeout(resolve, options.delay || 75)); signal.throwIfAborted();
      if (options.failAt === calls) throw Object.assign(new Error('测试中的暂时绘图失败'), { stopBatch: !!options.stopBatch, traceId: options.stopBatch ? 'test-diagnostic-id' : undefined });
      return { image: await store.asset(png), model: 'test-image', usage: { total_tokens: 20 }, references: refs.length, prompt };
    }
  };
}
