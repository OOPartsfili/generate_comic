import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, FileText, LayoutGrid, Rows3 } from 'lucide-react';
import { Button, Empty, Field } from './components';
import { renderPages, exportComic, download } from './export';
import { api } from './useStudio';
import { projectMarkdown } from '../shared/story';
export default function ExportEditor({ p, update, flush, report }) {
  const preview = useRef(null); const [working, setWorking] = useState(false), [selected, setSelected] = useState('');
  const panel = p.panels.find(s => s.id === selected) || p.panels[0];
  useEffect(() => {
    let stopped = false;
    if (p.panels.length) renderPages(p).then(pages => { if (!stopped && preview.current) preview.current.replaceChildren(...pages); }).catch(e => { if (!stopped) report(e.message); });
    return () => { stopped = true; };
  }, [p, report]);
  async function save(type) {
    setWorking(true);
    try { const current = await flush();
      if (type === 'project') download(new Blob([JSON.stringify(await api(`/projects/${p.id}/export`), null, 2)], { type: 'application/json' }), `${p.title}.moge.json`);
      else if (type === 'markdown') download(new Blob(['\ufeff' + projectMarkdown(current)], { type: 'text/markdown;charset=utf-8' }), `${p.title}.md`);
      else await exportComic(current, type);
    } catch (e) { report(e.message); } finally { setWorking(false); }
  }
  const editPanel = patch => update({ panels: p.panels.map(s => s.id === panel.id ? { ...s, ...patch } : s) });
  return <div className="export-layout"><section className="preview-desk">{p.panels.length ? <><div className="preview-label">成品预览 · 按当前排版导出</div><div className="page-previews" ref={preview} /></> : <Empty icon={LayoutGrid} title="这里将展示你的漫画成品">完成分镜后，可在这里排版，输出图片和 PDF。</Empty>}</section><aside className="aside-stack"><section className="paper"><span className="eyebrow">FINISHING TOUCHES</span><h3>让故事，成为作品</h3><Field label="页面布局"><select value={p.layout} onChange={e => update({ layout: e.target.value })}><option value="grid">双列漫画 · 每页最多四格</option><option value="hero">主视觉 · 首格横跨整页</option><option value="strip">长条漫画 · 连续阅读</option></select></Field><label className="check-field"><input type="checkbox" checked={p.lettering} onChange={e => update({ lettering: e.target.checked })} />显示中文对白与旁白</label><p className="small-note">对白独立排版，避免 AI 生成乱码。原图完整放入画框，保留构图。</p>{panel && <><div className="section-rule" /><Field label="调整画格"><select value={panel.id} onChange={e => setSelected(e.target.value)}>{p.panels.map((s, i) => <option key={s.id} value={s.id}>第 {i + 1} 格 · {s.title}</option>)}</select></Field><Field label="对白文字"><textarea rows={3} maxLength={200} value={panel.dialogue} onChange={e => editPanel({ dialogue: e.target.value })} /></Field><Field label="旁白文字"><textarea rows={2} maxLength={200} value={panel.caption} onChange={e => editPanel({ caption: e.target.value })} /></Field><Field label={`气泡横向位置 · ${panel.bubbleX ?? 8}%`}><input type="range" min="0" max="80" value={panel.bubbleX ?? 8} onChange={e => editPanel({ bubbleX: Number(e.target.value) })} /></Field><Field label={`气泡纵向位置 · ${panel.bubbleY ?? 8}%`}><input type="range" min="0" max="80" value={panel.bubbleY ?? 8} onChange={e => editPanel({ bubbleY: Number(e.target.value) })} /></Field></>}</section><section className="paper"><h3>导出与交付</h3><fieldset disabled={working}><div className="export-actions"><Button variant="primary full" icon={Download} disabled={!p.panels.length || p.panels.some(s => !s.image)} onClick={() => save('png')}>导出高清 PNG</Button><Button variant="full" icon={Rows3} disabled={!p.panels.length || p.panels.some(s => !s.image)} onClick={() => save('pdf')}>导出漫画 PDF</Button><Button variant="full" icon={FileText} onClick={() => save('markdown')}>导出故事与分镜文稿</Button><Button variant="full" icon={FileJson} onClick={() => save('project')}>导出可编辑工程</Button></div></fieldset><p className="small-note">多页 PNG 自动打包为 ZIP；PDF 保留中文排版。工程包含当前参考图与插画，可再次导入。</p>{working && <p role="status" className="inline-warning">正在准备导出，请稍候…</p>}</section></aside></div>;
}
