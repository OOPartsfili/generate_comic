import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, X, KeyRound, ShieldCheck, Radio, ExternalLink } from 'lucide-react';
import { api } from './useStudio';

export function Button({ icon: Icon, children, variant = '', busy, ...props }) { return <button className={`btn ${variant}`} {...props}>{busy ? <Loader2 className="spin" size={16} /> : Icon && <Icon size={16} />}{children}</button>; }
export function Field({ label, hint, children, className = '' }) { return <label className={`field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Empty({ icon: Icon, title, children, action }) { return <div className="empty-state"><span className="empty-icon"><Icon size={32} strokeWidth={1.3} /></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
export function SettingsModal({ settings, onClose, onSaved, onConnection, disabled }) {
  const [form, setForm] = useState({ provider: settings?.provider || 'codex', codexModel: settings?.codexModel || '', codexPath: settings?.codexPath || '', textModel: settings?.textModel || 'gpt-5-mini', imageModel: settings?.imageModel || 'gpt-image-2', apiKey: '' });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [models, setModels] = useState([]);
  const [connection, setConnection] = useState(null), [authUrl, setAuthUrl] = useState('');
  const codex = form.provider === 'codex';
  useEffect(() => {
    if (!authUrl) return;
    let stopped = false;
    const interval = setInterval(() => {
      api('/connection').then(result => {
        if (!stopped && result.connected && result.authType === 'chatgpt') {
          setConnection(result); onConnection?.(result); setAuthUrl(''); setMessage('ChatGPT 登录成功，可以开始创作。');
        }
      }).catch(() => {});
    }, 3000);
    return () => { stopped = true; clearInterval(interval); };
  }, [authUrl, onConnection]);
  async function save(test = false) {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api('/settings', { method: 'PUT', body: form }); onSaved(saved); setForm({ ...form, apiKey: '' });
      if (test) {
        const result = await api('/settings/test', { method: 'POST' });
        if (codex) { setConnection(result); onConnection?.(result); setMessage(result.connected ? `ChatGPT 已连接 · ${result.plan?.toUpperCase() || '订阅账户'}。生成使用 Codex 套餐额度。检测连接不会生成文字或图片。` : '尚未登录，请点击「使用 ChatGPT 登录」。'); }
        else { setModels(result.models); setMessage(`OpenAI 连接成功。文字模型：${result.textAvailable ? '可见' : '未在账户列表中，请核对'}；图像模型：${result.imageAvailable ? '可见' : '未在账户列表中，请核对'}。模型可见不代表有余额或生成权限。`); }
      } else setMessage(codex ? '已保存。生成将通过官方 Codex 使用你的 ChatGPT 账号，不需要 API 密钥。' : saved.canPersistKey ? '设置已保存，密钥使用 Windows 账户加密。' : '模型设置已保存。浏览器开发模式的密钥仅保留到服务关闭，桌面版支持加密保存。');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function login() {
    setBusy(true); setError('');
    try {
      const saved = await api('/settings', { method: 'PUT', body: { ...form, provider: 'codex' } }); onSaved(saved);
      const result = await api('/codex/login', { method: 'POST' }); setAuthUrl(result.authUrl);
      window.open(result.authUrl, '_blank', 'noopener,noreferrer');
      setMessage('请在浏览器完成官方 ChatGPT 登录，本窗口会自动检查登录结果。');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="生成连接" onClose={onClose}><div className="settings-intro"><span><KeyRound size={24} /></span><div><strong>用你的 ChatGPT 账号创作</strong><p>墨格创作室 → 官方 Codex → ChatGPT</p></div></div><fieldset disabled={busy || disabled}>
    <Field label="生成方式"><select value={form.provider} onChange={e => { setForm({ ...form, provider: e.target.value }); setError(''); setMessage(''); setConnection(null); setAuthUrl(''); }}><option value="codex">ChatGPT 订阅 · 官方 Codex（推荐）</option><option value="api">OpenAI API · 单独按量计费</option></select></Field>
    {codex ? <>
      <div className="codex-account"><div><span className={`status-dot ${connection?.connected ? '' : 'pending'}`} /><strong>{connection?.connected ? `ChatGPT ${connection.plan?.toUpperCase() || ''} 已连接` : '复用本机官方 Codex 登录'}</strong></div><p>已在 Codex 登录过 ChatGPT，可直接检测连接。额度用尽时会停止，不会自动转用付费 API。</p><Button icon={ExternalLink} onClick={login}>使用 ChatGPT 登录</Button>{authUrl && <a className="login-link" href={authUrl} target="_blank" rel="noreferrer">浏览器未打开？点击继续官方登录</a>}</div>
      <Field label="Codex 文字模型" hint="留空使用当前 Codex 可用列表中的默认模型。检测连接后可选择。"><select value={form.codexModel} onChange={e => setForm({ ...form, codexModel: e.target.value })}><option value="">自动选择 Codex 默认模型</option>{[...new Set([form.codexModel, ...(connection?.models || []).map(m => m.id)].filter(Boolean))].map(model => <option key={model} value={model}>{model}</option>)}</select></Field>
      <p className="small-note">插画使用 Codex 内置图片生成。画幅和质量会作为绘制要求传入，实际输出以工具支持为准；出图会比纯文字更快消耗套餐额度。</p>
      {!!connection?.limits?.length && <div className="codex-limits">{connection.limits.map((bucket, index) => <div key={`${bucket.name}-${index}`}><strong>{bucket.name}</strong>{['primary', 'secondary'].map(key => { const limit = bucket[key]; return limit && typeof limit.usedPercent === 'number' ? <div className="quota-row" key={key}><span>{limit.windowDurationMins >= 1440 ? `${Math.round(limit.windowDurationMins / 1440)} 天窗口` : `${Math.round(limit.windowDurationMins / 60 * 10) / 10} 小时窗口`} · 剩余 {Math.max(0, Math.min(100, 100 - limit.usedPercent))}%</span><progress max="100" value={Math.max(0, 100 - limit.usedPercent)} />{limit.resetsAt && <small>重置：{new Date(limit.resetsAt * 1000).toLocaleString('zh-CN')}</small>}</div> : null; })}</div>)}</div>}
      <details className="connection-advanced"><summary>Codex 程序路径（可选）</summary><Field label="Codex 可执行文件" hint="通常自动发现；找不到时填写官方 codex.exe 的完整路径，也可用 MOGE_CODEX_PATH 环境变量。"><input value={form.codexPath} onChange={e => setForm({ ...form, codexPath: e.target.value })} placeholder="自动查找本机 Codex" /></Field><p className="small-note">首次安装：<code>npm install -g @openai/codex</code>。本程序不会读取、复制或导出 Codex 的登录凭据。</p></details>
    </> : <>
    <Field label="OpenAI API 密钥" hint={settings?.hasKey ? '已配置密钥。留空将保留现有密钥。' : 'API 与 ChatGPT 订阅独立计费；密钥可从环境变量读取。'}><input type="password" autoComplete="off" placeholder={settings?.hasKey ? '已保存 · 输入新密钥可替换' : 'sk-…'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} /></Field>
    <div className="field-grid"><Field label="文字模型" hint="需支持 Responses 与结构化输出"><input list="text-models" value={form.textModel} onChange={e => setForm({ ...form, textModel: e.target.value })} /><datalist id="text-models">{[...new Set(['gpt-5-mini', 'gpt-4.1', ...models.filter(m => !m.startsWith('gpt-image'))])].map(m => <option key={m} value={m} />)}</datalist></Field><Field label="图像模型" hint="支持生成与参考图编辑的 GPT Image"><input list="image-models" value={form.imageModel} onChange={e => setForm({ ...form, imageModel: e.target.value })} /><datalist id="image-models">{[...new Set(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', ...models.filter(m => m.startsWith('gpt-image'))])].map(m => <option key={m} value={m} />)}</datalist></Field></div>
    </>}
    <div className="privacy-note"><ShieldCheck size={18} /><p>{codex ? 'ChatGPT 登录凭据由官方 Codex 保存与刷新，墨格不接收登录 token。作品工程不包含账户设置。' : settings?.canPersistKey ? '桌面版用系统加密保存密钥；作品导出不包含密钥。' : '当前为浏览器开发模式；桌面版支持系统加密保存。'}故事与参考图仅在你点击生成时发送至 OpenAI。</p></div>
    {error && <div className="error-box" role="alert">{error}</div>}{message && <div className="success-box" role="status">{message}</div>}
    <div className="modal-footer"><a href={codex ? 'https://learn.chatgpt.com/docs/auth' : 'https://platform.openai.com/api-keys'} target="_blank" rel="noreferrer">{codex ? '官方登录说明' : '获取 API 密钥'} <ExternalLink size={13} /></a><Button icon={Radio} onClick={() => save(true)} busy={busy}>保存并检测连接</Button><Button variant="primary" icon={Check} onClick={() => save()}>保存设置</Button></div>
  </fieldset></Modal>;
}
