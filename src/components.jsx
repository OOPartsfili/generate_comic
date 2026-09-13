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
export function SettingsModal({ settings, onClose, onSaved, disabled }) {
  const [form, setForm] = useState({ textModel: settings?.textModel || 'gpt-5-mini', imageModel: settings?.imageModel || 'gpt-image-2', apiKey: '' });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [models, setModels] = useState([]);
  async function save(test = false) {
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api('/settings', { method: 'PUT', body: form }); onSaved(saved); setForm({ ...form, apiKey: '' });
      if (test) { const result = await api('/settings/test', { method: 'POST' }); setModels(result.models); setMessage(`OpenAI 连接成功。文字模型：${result.textAvailable ? '可见' : '未在账户列表中，请核对'}；图像模型：${result.imageAvailable ? '可见' : '未在账户列表中，请核对'}。模型可见不代表有余额或生成权限。`); }
      else setMessage(saved.canPersistKey ? '设置已保存，密钥使用 Windows 账户加密。' : '模型设置已保存。浏览器开发模式的密钥仅保留到服务关闭，桌面版支持加密保存。');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="连接你的 OpenAI" onClose={onClose}><div className="settings-intro"><span><KeyRound size={24} /></span><div><strong>让灵感成为故事与画面</strong><p>小说与分镜使用 GPT，插画使用 GPT Image。按实际 API 用量计费。</p></div></div><fieldset disabled={busy || disabled}>
    <Field label="OpenAI API 密钥" hint={settings?.hasKey ? '已配置密钥。留空将保留现有密钥。' : '在此粘贴 API 密钥，仅交给本机服务调用 OpenAI。'}><input type="password" autoComplete="off" placeholder={settings?.hasKey ? '已保存 · 输入新密钥可替换' : 'sk-…'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} /></Field>
    <div className="field-grid"><Field label="文字模型" hint="需支持 Responses 与结构化输出"><input list="text-models" value={form.textModel} onChange={e => setForm({ ...form, textModel: e.target.value })} /><datalist id="text-models">{[...new Set(['gpt-5-mini', 'gpt-4.1', ...models.filter(m => !m.startsWith('gpt-image'))])].map(m => <option key={m} value={m} />)}</datalist></Field><Field label="图像模型" hint="支持生成与参考图编辑的 GPT Image"><input list="image-models" value={form.imageModel} onChange={e => setForm({ ...form, imageModel: e.target.value })} /><datalist id="image-models">{[...new Set(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', ...models.filter(m => m.startsWith('gpt-image'))])].map(m => <option key={m} value={m} />)}</datalist></Field></div>
    <div className="privacy-note"><ShieldCheck size={18} /><p>{settings?.canPersistKey ? '桌面版用系统加密保存密钥；作品导出不包含密钥。' : '当前为浏览器开发模式；桌面版支持系统加密保存。'}故事与参考图仅在你点击生成时发送至 OpenAI。</p></div>
    {error && <div className="error-box" role="alert">{error}</div>}{message && <div className="success-box" role="status">{message}</div>}
    <div className="modal-footer"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">获取 API 密钥 <ExternalLink size={13} /></a><Button icon={Radio} onClick={() => save(true)}>保存并检测连接</Button><Button variant="primary" icon={Check} onClick={() => save()} busy={busy}>保存设置</Button></div>
  </fieldset></Modal>;
}
