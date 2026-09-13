export const STYLES = [
  { id: 'cinema', name: '电影感国漫', note: '细腻光影 · 叙事构图', color: '#c69568', prompt: '精致彩色国漫，电影级光影，克制配色，细腻人物表情，清晰的叙事构图' },
  { id: 'ink', name: '黑白悬疑', note: '钢笔线条 · 强烈明暗', color: '#55545a', prompt: '黑白青年漫画，精细钢笔线稿，黑白网点，强烈明暗，电影分镜，无彩色' },
  { id: 'watercolor', name: '水彩绘本', note: '柔和笔触 · 温暖留白', color: '#87a79b', prompt: '温柔水彩绘本，纸张质感，淡雅低饱和配色，手绘线条，柔和自然光' },
  { id: 'anime', name: '日系彩漫', note: '清透色彩 · 生动表情', color: '#a29cc9', prompt: '日系彩色漫画，干净流畅线稿，赛璐璐上色，清透自然光，生动表情，精致背景' },
  { id: 'noir', name: '复古美漫', note: '粗犷墨线 · 印刷颗粒', color: '#ba776b', prompt: '复古美式漫画，粗细变化的墨线，有限色版，半调印刷网点，大胆构图，强烈阴影' },
  { id: 'oriental', name: '东方水墨', note: '墨色层次 · 诗意空间', color: '#92a0b2', prompt: '东方水墨叙事插画，宣纸纹理，墨色层次，少量朱砂点色，诗意留白，细致人物' },
];
export const uid = () => crypto.randomUUID();
export function newProject() {
  return { id: uid(), version: 2, revision: 0, title: '未命名短篇', idea: '', genre: '温暖治愈', tone: '克制、细腻，有余韵', audience: '大众读者', panelCount: 4, wordCount: 800, styleId: 'cinema', customStyle: '', size: '1536x1024', quality: 'medium', layout: 'grid', lettering: true, outline: null, outlineApproved: false, prose: '', characters: [], panels: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
export function demoProject() {
  const p = newProject();
  p.title = '末班车上的星星';
  p.idea = '深夜，疲惫的女孩坐上末班公交。一个提着玻璃罐的老人说，他每天收集一颗被人遗忘的星星。女孩发现，罐子里的光来自乘客们没有说出口的心愿。用一个温柔的小反转收尾。';
  p.styleId = 'watercolor';
  p.outline = { title: p.title, logline: '一个想离开城市的女孩，在末班车上遇见替人收集心愿的老人，重新发现自己仍有被等待的理由。', setting: '初秋深夜，开往郊区的末班公交；蓝灰车厢与暖黄玻璃罐形成色彩呼应。', conflict: '女孩以为自己无人在意，玻璃罐却有一颗专为她而亮的星星。', ending: '星光变成母亲发来的那句“留了灯，回来吃面”。女孩提前一站下车，跑向家。', beats: [ { label: '起 · 上车', text: '女孩抱着纸箱坐上空荡的末班车，手机屏幕停在未发送的辞职消息。' }, { label: '承 · 相遇', text: '老人提着玻璃罐坐到对面，里面的星点随经过的灯火闪烁。他说，这是没人说出口的心愿。' }, { label: '转 · 认出', text: '一颗星光贴到女孩指尖，映出家中厨房的灯。手机此时亮起，母亲问她回不回来吃面。' }, { label: '合 · 回家', text: '女孩按下下车铃，回头时老人已不在座位。她走进夜色，纸箱上落着一点暖光。' } ] };
  p.characters = [ { id: 'c1', name: '小满', role: '主角', appearance: '24岁，黑色齐肩短发，圆脸，穿浅米色风衣、深蓝长裤，白色帆布鞋，怀抱牛皮纸箱', personality: '疲惫却敏感，习惯把失落藏起来', reference: '', referenceHistory: [] }, { id: 'c2', name: '拾星老人', role: '引路人', appearance: '70岁，银白短发，圆框眼镜，深绿色针织开衫，棕色布鞋，始终提着一只装有暖黄光点的玻璃罐', personality: '温和寡言，像与城市相识很久', reference: '', referenceHistory: [] } ];
  return p;
}
export function styleText(p) { return [STYLES.find(s => s.id === p.styleId)?.prompt || STYLES[0].prompt, p.customStyle].filter(Boolean).join('；'); }
export function projectMarkdown(p) {
  const lines = [`# ${p.title}`, '', '## 创作思路', p.idea, '', '## 故事纲要'];
  if (p.outline) lines.push(p.outline.logline, '', `背景：${p.outline.setting}`, `冲突：${p.outline.conflict}`, ...p.outline.beats.map(b => `\n### ${b.label}\n${b.text}`), `\n结尾：${p.outline.ending}`);
  lines.push('', '## 角色', ...p.characters.map(c => `\n### ${c.name} · ${c.role}\n${c.appearance}\n${c.personality}`), '', '## 小说文段', p.prose || '尚未生成', '', '## 分镜');
  p.panels.forEach((s, i) => lines.push(`\n### ${i + 1}. ${s.title}`, `镜头：${s.shot}`, `场景：${s.scene}`, `动作：${s.action}`, `情绪与光影：${s.mood}`, `对白：${s.dialogue}`, `旁白：${s.caption}`, `画面提示：${s.prompt || ''}`));
  return lines.join('\n');
}
