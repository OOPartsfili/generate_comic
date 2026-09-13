import { projectMarkdown } from '../shared/story';

export function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name.replace(/[<>:"/\\|?*]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
function wrap(ctx, text, maxWidth) {
  const lines = []; let line = '';
  for (const char of String(text)) {
    if (char === '\n') { lines.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = char; } else line += char;
  }
  if (line) lines.push(line);
  return lines;
}
function textBox(ctx, text, x, y, width, { size = 23, color = '#222', lineHeight = 1.7 } = {}) {
  ctx.font = `${size}px ${font}`; ctx.fillStyle = color;
  const lines = wrap(ctx, text, width);
  lines.forEach((line, i) => ctx.fillText(line, x, y + size + i * size * lineHeight));
  return lines.length * size * lineHeight;
}
async function loadImage(url) {
  if (!url) return null;
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('有一张本地图片无法读取，请重新生成或导入该画格。')); image.src = url; });
}
export async function renderPages(project) {
  await document.fonts.ready;
  const images = await Promise.all(project.panels.map(p => loadImage(p.image)));
  const groups = project.layout === 'strip' ? [project.panels] : Array.from({ length: Math.ceil(project.panels.length / 4) }, (_, i) => project.panels.slice(i * 4, i * 4 + 4));
  return groups.map((group, groupIndex) => {
    const canvas = document.createElement('canvas'); canvas.width = project.layout === 'strip' ? 1200 : 1600;
    const ctx = canvas.getContext('2d'); const margin = 64, gap = 28, content = canvas.width - margin * 2;
    const ratio = project.size === '1024x1536' ? 2 / 3 : project.size === '1024x1024' ? 1 : 3 / 2;
    let y = 174; const rects = [];
    for (let i = 0; i < group.length;) {
      const single = project.layout === 'strip' || (project.layout === 'hero' && i === 0) || group.length - i === 1;
      const cols = single ? 1 : 2; const width = (content - (cols - 1) * gap) / cols;
      const height = width / ratio; let rowHeight = height;
      for (let j = 0; j < cols; j++) {
        const panel = group[i + j]; if (!panel) continue;
        ctx.font = `23px ${font}`;
        const captionHeight = project.lettering && panel.caption ? wrap(ctx, panel.caption, width - 36).length * 36 + 28 : 0;
        rects.push({ panel, x: margin + j * (width + gap), y, width, height, captionHeight }); rowHeight = Math.max(rowHeight, height + captionHeight);
      }
      y += rowHeight + gap; i += cols;
    }
    canvas.height = Math.ceil(y + 74); ctx.fillStyle = '#fffefb'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let titleSize = 44;
    do { ctx.font = `600 ${titleSize}px ${font}`; if (ctx.measureText(project.title).width <= content || titleSize <= 18) break; titleSize--; } while (titleSize > 18);
    ctx.fillStyle = '#222'; ctx.fillText(project.title, margin, 94, content);
    ctx.fillStyle = '#9a9389'; ctx.font = `16px ${font}`; ctx.fillText(`短篇漫画  /  ${groupIndex + 1}`, margin, 133);
    for (const r of rects) {
      const index = project.panels.indexOf(r.panel); const image = images[index];
      ctx.fillStyle = '#f0eee9'; ctx.fillRect(r.x, r.y, r.width, r.height);
      if (image) {
        const scale = Math.min(r.width / image.width, r.height / image.height);
        const w = image.width * scale, h = image.height * scale;
        ctx.drawImage(image, r.x + (r.width - w) / 2, r.y + (r.height - h) / 2, w, h);
      } else {
        textBox(ctx, `第 ${index + 1} 格 · ${r.panel.title}`, r.x + 30, r.y + 30, r.width - 60, { size: 30, color: '#777' });
        textBox(ctx, '画面尚未生成', r.x + 30, r.y + r.height / 2, r.width - 60, { color: '#888' });
      }
      if (project.lettering && r.panel.dialogue) {
        const maxWidth = r.width * .67; let size = 25, lines;
        do { ctx.font = `500 ${size}px ${font}`; lines = wrap(ctx, r.panel.dialogue, maxWidth - 40); if (lines.length * size * 1.45 + 36 <= r.height * .72 || size <= 15) break; size--; } while (size > 15);
        const width = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width)) + 40);
        const height = lines.length * size * 1.45 + 30;
        const bx = r.x + Math.min(r.width - width - 12, Math.max(12, r.width * (r.panel.bubbleX ?? 8) / 100));
        const by = r.y + Math.min(r.height - height - 18, Math.max(12, r.height * (r.panel.bubbleY ?? 8) / 100));
        ctx.beginPath(); ctx.roundRect(bx, by, width, height, 24); ctx.fillStyle = '#fffefb'; ctx.fill(); ctx.strokeStyle = '#262323'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx + 28, by + height - 1); ctx.lineTo(bx + 25, by + height + 14); ctx.lineTo(bx + 46, by + height - 1); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#171717'; lines.forEach((l, i) => ctx.fillText(l, bx + 20, by + 21 + size * .7 + i * size * 1.45));
      }
      if (r.captionHeight) { ctx.fillStyle = '#fffefb'; ctx.fillRect(r.x, r.y + r.height, r.width, r.captionHeight); textBox(ctx, r.panel.caption, r.x + 18, r.y + r.height + 10, r.width - 36); }
      ctx.strokeStyle = '#292729'; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.width, r.height + r.captionHeight);
    }
    ctx.fillStyle = '#8a8177'; ctx.font = `16px ${font}`; ctx.fillText(`${groupIndex + 1} / ${groups.length}`, canvas.width - margin - 60, canvas.height - 32);
    return canvas;
  });
}
export async function exportComic(p, type) {
  if (!p.panels.length) throw new Error('请先创建分镜。');
  if (p.panels.some(s => !s.image)) throw new Error('请先完成所有画格，才能导出漫画成品。文稿与工程仍可单独导出。');
  const pages = await renderPages(p);
  if (type === 'pdf') {
    const { jsPDF } = await import('jspdf');
    let doc;
    for (const page of pages) {
      const w = 210, h = page.height / page.width * w; const orientation = h >= w ? 'portrait' : 'landscape';
      if (!doc) doc = new jsPDF({ unit: 'mm', format: [w, h], orientation }); else doc.addPage([w, h], orientation);
      doc.addImage(page.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    }
    download(doc.output('blob'), `${p.title}.pdf`);
  } else if (pages.length === 1) download(await new Promise(resolve => pages[0].toBlob(resolve, 'image/png')), `${p.title}.png`);
  else {
    const { default: JSZip } = await import('jszip'); const zip = new JSZip();
    for (let i = 0; i < pages.length; i++) zip.file(`第${i + 1}页.png`, pages[i].toDataURL('image/png').split(',')[1], { base64: true });
    zip.file('故事与分镜.md', projectMarkdown(p));
    download(await zip.generateAsync({ type: 'blob' }), `${p.title}-漫画页.zip`);
  }
}
