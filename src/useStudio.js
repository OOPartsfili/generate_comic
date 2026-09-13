import { useCallback, useEffect, useRef, useState } from 'react';
import { newProject, demoProject } from '../shared/story';

export async function api(url, options = {}) {
  let response;
  try { response = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) }); }
  catch { throw new Error('本地服务连接中断，请重新打开程序。尚未保存的编辑仍保留在界面中。'); }
  const data = await response.json().catch(() => ({ error: '服务返回了无法识别的内容' }));
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
const ongoing = job => job && ['queued', 'running', 'cancelling'].includes(job.status);
export function useStudio() {
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [connection, setConnection] = useState(null);
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('saved');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const current = useRef(null), dirty = useRef(false), timer = useRef(null), queue = useRef(Promise.resolve()), mutation = useRef(0);
  const accept = useCallback(p => { current.current = p; dirty.current = false; setProject(p); setSaving('saved'); if (p) localStorage.setItem('moge-last-project', p.id); }, []);
  const refresh = useCallback(async () => setProjects(await api('/projects')), []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const task = async () => {
      while (dirty.current && current.current) {
        const snapshot = current.current; const generation = mutation.current;
        setSaving('saving');
        try {
          const saved = await api(`/projects/${snapshot.id}`, { method: 'PUT', body: snapshot });
          if (current.current?.id === snapshot.id) {
            current.current = generation === mutation.current ? saved : { ...current.current, revision: saved.revision, updatedAt: saved.updatedAt };
            dirty.current = generation !== mutation.current;
            setProject(current.current);
          }
          setSaving(dirty.current ? 'dirty' : 'saved');
        } catch (e) { setSaving('error'); setError(e.message); throw e; }
      }
      return current.current;
    };
    const result = queue.current.catch(() => {}).then(task); queue.current = result;
    return result;
  }, []);
  const update = useCallback(patch => {
    if (!current.current) return;
    const p = typeof patch === 'function' ? patch(current.current) : { ...current.current, ...patch };
    current.current = p; dirty.current = true; mutation.current++; setProject(p); setSaving('dirty');
    clearTimeout(timer.current); timer.current = setTimeout(() => { flush().catch(() => {}); }, 650);
  }, [flush]);
  const open = useCallback(async id => {
    await flush();
    const [p, js] = await Promise.all([api(`/projects/${id}`), api(`/projects/${id}/jobs`)]);
    accept(p); setJobs(js); setJob(js.find(ongoing) || null); setError('');
    if (js[0]?.status === 'interrupted') setNotice(js[0].message);
  }, [accept, flush]);
  useEffect(() => {
    if (!settings) return;
    let stopped = false;
    api('/connection').then(value => { if (!stopped) setConnection(value); }).catch(() => { if (!stopped) setConnection(null); });
    return () => { stopped = true; };
  }, [settings]);
  useEffect(() => {
    let stopped = false;
    Promise.all([api('/settings'), api('/projects')]).then(async ([s, ps]) => {
      if (stopped) return; setSettings(s); setProjects(ps);
      const last = localStorage.getItem('moge-last-project');
      if (ps.some(p => p.id === last)) await open(last);
    }).catch(e => { if (!stopped) setError(e.message); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [open]);
  useEffect(() => {
    const handler = e => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const jobId = ongoing(job) ? job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false; let handle;
    const poll = async () => {
      try {
        const j = await api(`/jobs/${jobId}`);
        if (cancelled) return;
        if (!ongoing(j)) {
          const [p, history] = await Promise.all([api(`/projects/${j.projectId}`), api(`/projects/${j.projectId}/jobs`)]);
          if (cancelled) return;
          if (current.current?.id === p.id) accept(p);
          setJobs(history); setJob(j); await refresh();
          if (['failed', 'partial', 'interrupted'].includes(j.status)) setError(j.message); else setNotice(j.message);
          return;
        }
        setJob(j);
      } catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) handle = setTimeout(poll, 1200);
    };
    handle = setTimeout(poll, 600);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [jobId, accept, refresh]);
  async function create(demo = false) {
    await flush(); const p = await api('/projects', { method: 'POST', body: demo ? demoProject() : newProject() });
    accept(p); setJobs([]); setJob(null); setError(''); await refresh(); return p;
  }
  async function run(type, targetId, note = '') {
    setPending(true); setError(''); setNotice('');
    try { const p = await flush(); const j = await api(`/projects/${p.id}/jobs`, { method: 'POST', body: { type, targetId, note, revision: p.revision } }); setJob(j); }
    catch (e) { setError(e.message); throw e; }
    finally { setPending(false); }
  }
  async function importProject(data) { await flush(); const p = await api('/import', { method: 'POST', body: data }); accept(p); setJob(null); setJobs([]); await refresh(); }
  return { project, projects, settings, setSettings, connection, setConnection, job, jobs, error, setError, notice, setNotice, saving, loading, pending, busy: pending || !!ongoing(job), accept, refresh, flush, update, open, create, run, importProject, cancel: () => api(`/jobs/${job.id}/cancel`, { method: 'POST' }).then(setJob) };
}
