'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getSupabase } from '@/lib/supabase';
import { projectInput, readableError } from '@/lib/project-input';
import { Icon, Logo } from './icon';

type Project = Database['public']['Tables']['projects']['Row'];
type Workspace = Database['public']['Tables']['workspaces']['Row'];
type Mode = 'login' | 'signup' | 'reset' | 'update';
const sampleWorkspace: Workspace = { id: '10000000-0000-4000-8000-000000000000', name: '我的内容工作空间', owner_id: 'preview', created_at: '2026-11-02T00:00:00Z' };
const samples: Project[] = [
  { id: '10000000-0000-4000-8000-000000000001', workspace_id: sampleWorkspace.id, name: '品牌内容月度复盘', brand_name: '示例品牌', description: '整理本月内容表现，理解读者反馈，为下一轮选题找到方向。', default_timezone: 'Asia/Shanghai', created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000002', workspace_id: sampleWorkspace.id, name: '短视频选题观察', brand_name: null, description: '按主题记录短视频内容，逐步建立自己的选题资料库。', default_timezone: 'Asia/Shanghai', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
];
const dateLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date(value));

function AuthPanel({ onPreview, recovery, onRecoveryDone, initialError }: { onPreview: () => void; recovery: boolean; onRecoveryDone: () => void; initialError: string }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = recovery ? 'update' : mode;
  const titles = { login: ['欢迎回来', '登录工作空间，继续你的内容探索。'], signup: ['开启你的洞察之旅', '创建账号，让每一次内容复盘都有据可依。'], reset: ['找回你的密码', '我们会向你的邮箱发送密码重置邮件。'], update: ['设置新密码', '为你的账号设置一个新的安全密码。'] };
  function changeMode(value: Mode) { setMode(value); setPassword(''); setError(''); setMessage(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setError(''); setMessage(''); setPending(true);
    try {
      const client = getSupabase();
      if (current === 'login') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error;
      } else if (current === 'signup') {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setMessage('确认邮件已发送。请打开邮箱完成确认，再回到这里登录。');
      } else if (current === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin }); if (error) throw error;
        setMessage('如果该邮箱已注册，你会收到密码重置邮件，请检查收件箱。');
      } else {
        const { error } = await client.auth.updateUser({ password }); if (error) throw error;
        onRecoveryDone();
      }
    } catch (error) { setError(readableError(error)); } finally { setPending(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story">
      <Logo />
      <div className="story-body"><span className="eyebrow"><span className="tiny-dot"/> CONTENT INTELLIGENCE</span>
        <h1>看见内容背后，<br/><span>真正的价值。</span></h1>
        <p>连接内容表现与用户反馈，<br/>让每一个下一步，都有清晰的依据。</p>
        <div className="story-visual" aria-hidden="true">
          <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
          <div className="visual-card visual-source"><span className="visual-icon lavender"><Icon name="layers"/></span><div><b>内容与数据</b><small>汇集每一次表达</small></div><span className="mini-bars"><i/><i/><i/><i/></span></div>
          <div className="visual-line"/>
          <div className="visual-card visual-insight"><span className="visual-icon mint"><Icon name="spark"/></span><div><b>从记录，到洞察</b><small>理解反馈，发现方向</small></div><span className="visual-check"><Icon name="check" size={15}/></span></div>
          <div className="visual-tag"><span className="tiny-dot"/> 让数据成为行动的起点</div>
        </div>
      </div>
      <div className="story-footer"><span>为认真创作与复盘的人而设计</span><span>清晰 · 可信 · 可追溯</span></div>
    </section>
    <section className="auth-form-side">
      <div className="auth-top">还想先了解一下？ <button className="text-link" onClick={onPreview}>浏览界面预览 <Icon name="arrow" size={15}/></button></div>
      <div className="auth-form-wrap"><span className="form-symbol"><Icon name={current === 'reset' ? 'mail' : 'lock'} size={24}/></span>
        <h2>{titles[current][0]}</h2><p className="muted auth-subtitle">{titles[current][1]}</p>
        {!recovery && (current === 'login' || current === 'signup') && <div className="auth-tabs"><button className={current === 'login' ? 'selected' : ''} onClick={() => changeMode('login')}>登录</button><button className={current === 'signup' ? 'selected' : ''} onClick={() => changeMode('signup')}>注册账号</button></div>}
        <form onSubmit={submit} className="stack-form" aria-busy={pending}>
          {current !== 'update' && <label>邮箱地址<div className="input-with-icon"><Icon name="mail" size={18}/><input type="email" name="email" autoComplete="username" required maxLength={254} placeholder="输入你的邮箱" value={email} onChange={e => setEmail(e.target.value)} disabled={pending}/></div></label>}
          {current !== 'reset' && <label><span className="label-line">{current === 'update' ? '新密码' : '密码'}{current === 'login' && <button type="button" className="text-link" onClick={() => changeMode('reset')}>忘记密码？</button>}</span><div className="input-with-icon"><Icon name="lock" size={18}/><input type={visible ? 'text' : 'password'} name="password" autoComplete={current === 'login' ? 'current-password' : 'new-password'} required minLength={current === 'login' ? 1 : 8} maxLength={128} placeholder={current === 'login' ? '输入你的密码' : '至少 8 位，建议组合字母和数字'} value={password} onChange={e => setPassword(e.target.value)} disabled={pending}/><button type="button" className="icon-button" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)} aria-pressed={visible}><Icon name="eye" size={18}/></button></div></label>}
          {(error || initialError) && <p className="notice error" role="alert">{error || initialError}</p>}
          {message && <p className="notice success" role="status">{message}</p>}
          <button className="primary-button auth-submit" disabled={pending}>{pending ? <><span className="spinner"/> 正在处理</> : <>{({ login: '登录工作空间', signup: '创建账号', reset: '发送重置邮件', update: '保存新密码' })[current]}<Icon name="arrow" size={18}/></>}</button>
          {current === 'reset' && <button type="button" className="text-link centered" onClick={() => changeMode('login')}>返回登录</button>}
        </form>
        <div className="auth-assurance"><Icon name="lock" size={14}/><span>项目仅对所属工作空间的成员可见</span></div>
      </div>
      <div className="auth-bottom">Content Intelligence <span>把内容，变成洞察。</span></div>
    </section>
  </main>;
}

function CreateProjectDialog({ workspace, onClose, onCreated }: { workspace: Workspace; onClose: () => void; onCreated: (project: Project) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(''); const [brand, setBrand] = useState(''); const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return; setError(''); setPending(true);
    try {
      const input = projectInput(name, brand, description);
      const { data, error } = await getSupabase().from('projects').insert({ ...input, workspace_id: workspace.id }).select().single();
      if (error) throw error; onCreated(data);
    } catch (error) { setError(readableError(error)); } finally { setPending(false); }
  }
  return <dialog ref={dialog} className="project-dialog" aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); if (!pending) onClose(); }} onClick={e => { if (e.target === dialog.current && !pending) onClose(); }}>
    <div className="dialog-heading"><span className="visual-icon lavender"><Icon name="folder" size={24}/></span><button className="icon-button" aria-label="关闭创建项目窗口" onClick={onClose} disabled={pending}><Icon name="close"/></button></div>
    <h2 id="dialog-title">给新的探索，建一个项目</h2><p className="muted">在「{workspace.name}」中整理一个品牌、账号或分析主题。</p>
    <form className="stack-form" onSubmit={submit} aria-busy={pending}>
      <label>项目名称 <span className="required">*</span><input name="name" autoFocus required maxLength={200} placeholder="例如：品牌内容月度复盘" value={name} onChange={e => setName(e.target.value)} disabled={pending}/></label>
      <label>品牌名称 <span className="optional">选填</span><input name="brand" maxLength={120} placeholder="这个项目关注哪个品牌？" value={brand} onChange={e => setBrand(e.target.value)} disabled={pending}/></label>
      <label>项目说明 <span className="optional">选填</span><textarea name="description" rows={3} maxLength={2000} placeholder="记录项目目标，方便下一次回来继续。" value={description} onChange={e => setDescription(e.target.value)} disabled={pending}/></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>取消</button><button className="primary-button" disabled={pending}>{pending ? <><span className="spinner"/>正在创建</> : <><Icon name="plus" size={17}/>创建项目</>}</button></div>
    </form>
  </dialog>;
}

export default function WorkspaceApp() {
  const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false); const [recovery, setRecovery] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [workspaceId, setWorkspaceId] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>({}); const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true); const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [error, setError] = useState(''); const [authError, setAuthError] = useState(''); const [toast, setToast] = useState('');
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('recent'); const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refresh, setRefresh] = useState(0); const userId = session?.user.id;
  useEffect(() => {
    setPreview(new URLSearchParams(window.location.search).get('preview') === '1');
    const readLocation = () => setSelectedId(new URLSearchParams(window.location.search).get('project') || '');
    readLocation(); window.addEventListener('popstate', readLocation);
    let alive = true;
    try {
      const client = getSupabase();
      const { data } = client.auth.onAuthStateChange((event, value) => {
        if (!alive) return; setSession(value);
        if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      });
      client.auth.getSession().then(({ data, error }) => {
        if (!alive) return; if (error) setAuthError(readableError(error)); else setSession(data.session); setReady(true);
      }).catch(error => { if (alive) { setAuthError(readableError(error)); setReady(true); } });
      return () => { alive = false; data.subscription.unsubscribe(); window.removeEventListener('popstate', readLocation); };
    } catch (error) { setAuthError(readableError(error)); setReady(true); }
    return () => { alive = false; window.removeEventListener('popstate', readLocation); };
  }, []);
  useEffect(() => {
    if (!userId || preview) return;
    let alive = true; setWorkspaceLoading(true); setLoading(true); setError(''); setWorkspaces([]); setWorkspaceId(''); setProjects([]);
    const client = getSupabase();
    Promise.all([
      client.from('workspaces').select('*').order('created_at', { ascending: true }),
      client.from('workspace_members').select('workspace_id,role').eq('user_id', userId),
    ]).then(([spaces, members]) => {
      if (!alive) return; if (spaces.error) throw spaces.error; if (members.error) throw members.error;
      setWorkspaces(spaces.data || []); setRoles(Object.fromEntries((members.data || []).map(m => [m.workspace_id, m.role])));
      const stored = window.localStorage.getItem(`ci-workspace-${userId}`);
      const selected = spaces.data?.find(w => w.id === stored) || spaces.data?.[0];
      setWorkspaceId(selected?.id || '');
    }).catch(error => { if (alive) setError(readableError(error)); }).finally(() => { if (alive) { setWorkspaceLoading(false); setLoading(false); } });
    return () => { alive = false; };
  }, [userId, preview]);
  useEffect(() => {
    if (preview || !workspaceId || !userId) return;
    let alive = true; setLoading(true); setError(''); setProjects([]);
    window.localStorage.setItem(`ci-workspace-${userId}`, workspaceId);
    getSupabase().from('projects').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (!alive) return; if (error) setError(readableError(error)); else setProjects(data || []); setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId, userId, preview, refresh]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  const activeWorkspace = preview ? sampleWorkspace : workspaces.find(w => w.id === workspaceId);
  const allProjects = preview ? samples : projects;
  const project = allProjects.find(p => p.id === selectedId);
  const canWrite = preview || (!!activeWorkspace && (activeWorkspace.owner_id === userId || roles[workspaceId] === 'editor'));
  const visibleProjects = allProjects.filter(p => `${p.name} ${p.brand_name || ''} ${p.description || ''}`.toLowerCase().includes(search.toLowerCase().trim()))
    .toSorted((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.created_at.localeCompare(a.created_at));
  const navigate = useCallback((id = '', isPreview = preview) => {
    const query = new URLSearchParams(); if (isPreview) query.set('preview', '1'); if (id) query.set('project', id);
    window.history.pushState(null, '', `/${query.size ? `?${query}` : ''}`); setSelectedId(id); setSidebarOpen(false);
  }, [preview]);
  function leavePreview() { setPreview(false); navigate('', false); }
  async function createWorkspace() {
    if (busy || error) return; setBusy(true); setError('');
    try {
      const { data, error } = await getSupabase().from('workspaces').insert({ name: '我的内容工作空间' }).select().single();
      if (error) throw error; setWorkspaces(previous => [...previous, data]); setRoles(previous => ({ ...previous, [data.id]: 'owner' })); setWorkspaceId(data.id);
      setToast('工作空间已创建，可以开始建立项目了。');
    } catch (error) { setError(readableError(error)); } finally { setBusy(false); }
  }
  async function signOut() {
    if (busy) return; setBusy(true);
    try { const { error } = await getSupabase().auth.signOut({ scope: 'local' }); if (error) throw error; setProjects([]); setWorkspaces([]); setWorkspaceId(''); setSearch(''); navigate('', false); }
    catch (error) { setToast(readableError(error)); } finally { setBusy(false); }
  }
  if (!ready) return <div className="loading-page"><Logo/><span className="spinner"/><p>正在打开你的工作空间…</p></div>;
  if ((!session && !preview) || recovery) return <AuthPanel recovery={recovery} initialError={authError} onRecoveryDone={() => { setRecovery(false); setToast('密码已更新。'); }} onPreview={() => { setPreview(true); navigate('', true); }}/>;
  return <div className="workspace-layout">
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"/>}
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}><Logo/>
      <div className="workspace-selector"><span className="workspace-avatar">{(activeWorkspace?.name || '我的空间').slice(0, 1)}</span><div><span className="small-label">当前工作空间</span><select aria-label="切换工作空间" value={preview ? sampleWorkspace.id : workspaceId} onChange={e => { setWorkspaceId(e.target.value); navigate(''); setSearch(''); }} disabled={preview || workspaces.length === 0}>{preview ? <option value={sampleWorkspace.id}>我的内容工作空间</option> : workspaces.length ? workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>) : <option value="">尚未创建工作空间</option>}</select></div></div>
      <div className="nav-heading">工作台</div><nav aria-label="主导航"><button className="nav-link active" onClick={() => navigate('')}><Icon name="grid"/>我的项目<span className="nav-count">{allProjects.length}</span></button><div className="nav-divider"/><div className="nav-heading">项目分析</div>{[['chart', '内容表现'], ['bubble', '评论洞察'], ['spark', 'AI 运营建议']].map(([icon, label]) => <div key={icon} className="nav-link upcoming"><Icon name={icon}/><span>{label}</span><span className="soon">后续开放</span></div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="visual-icon lavender"><Icon name="spark" size={18}/></span><b>从一个项目开始</b><p>为每一次内容复盘，<br/>留下清晰的记录。</p></div><a className="help-link" href="https://github.com/yangzha-spec/content-intelligence#readme" target="_blank" rel="noreferrer"><Icon name="help" size={17}/>使用与开发说明<Icon name="arrow" size={14}/></a><div className="sidebar-version">CONTENT INTELLIGENCE <span>第一阶段</span></div></div>
    </aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="打开导航"><Icon name="layers"/></button><button onClick={() => navigate('')}>工作台</button><Icon name="chevron" size={13}/><span>{selectedId ? project?.name || '项目详情' : '我的项目'}</span></div><div className="topbar-right"><span className="private-pill"><Icon name="lock" size={12}/>私有工作空间</span><span className="user-avatar">{preview ? '预' : (session?.user.email || 'U').slice(0, 1).toUpperCase()}</span>{preview ? <button className="text-link" onClick={leavePreview}>{session ? '返回真实工作空间' : '登录账号'}</button> : <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={signOut} disabled={busy}><Icon name="logout" size={18}/></button>}</div></header>
      {preview && <div className="preview-banner"><Icon name="eye" size={16}/><span><b>界面预览</b> · 以下为示例项目，不会写入数据库。</span><button onClick={leavePreview}>{session ? '返回工作空间' : '登录管理真实项目'} <Icon name="arrow" size={14}/></button></div>}
      <main className="main-content">
        {!selectedId ? <>
          <div className="page-heading"><div><div className="eyebrow section-eyebrow">YOUR CREATIVE WORKSPACE</div><h1>我的项目<span className="heading-dot">.</span></h1><p className="muted">把内容、数据和想法，放进同一个探索空间。</p></div><button className="primary-button" disabled={!canWrite || (!preview && loading) || !activeWorkspace} onClick={() => preview ? leavePreview() : setCreating(true)}><Icon name="plus" size={18}/>{preview ? '登录后创建项目' : '创建项目'}</button></div>
          <section className="welcome-banner"><div className="welcome-copy"><span className="banner-badge"><Icon name="spark" size={13}/> 让每次复盘更进一步</span><h2>好的洞察，从有序的记录开始。</h2><p>按品牌、账号或主题建立项目，为内容分析打好基础。</p></div><div className="banner-art" aria-hidden="true"><div className="art-sheet sheet-back"/><div className="art-sheet sheet-front"><span/><b/><i/><i/><i/></div><div className="art-spark"><Icon name="spark" size={25}/></div><span className="art-dot one"/><span className="art-dot two"/></div></section>
          {error && <div className="notice error" role="alert">{error}<button className="text-link" onClick={() => { if (workspaceId) setRefresh(n => n + 1); else window.location.reload(); }}>重试</button></div>}
          <section className="projects-section" aria-labelledby="projects-title"><div className="list-toolbar"><h2 id="projects-title">全部项目 <span>{allProjects.length}</span></h2><div className="list-controls"><label className="search-input"><Icon name="search" size={17}/><input aria-label="搜索项目" placeholder="搜索项目名称、品牌…" value={search} onChange={e => setSearch(e.target.value)}/></label><select className="sort-select" aria-label="项目排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近创建</option><option value="name">名称排序</option></select></div></div>
            {loading && !preview ? <div className="project-grid" aria-label="正在加载项目">{[1, 2, 3].map(n => <div className="skeleton-card" key={n}><i/><b/><p/><p/></div>)}</div> : !activeWorkspace && !workspaceLoading && !preview ? <div className="empty-state"><span className="empty-icon"><Icon name="layers" size={34}/></span><h3>先给内容洞察一个家</h3><p>创建你的工作空间，再按品牌或主题整理项目。</p><button className="primary-button" onClick={createWorkspace} disabled={busy}>{busy ? <span className="spinner"/> : <Icon name="plus" size={17}/>}创建我的工作空间</button></div> : allProjects.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="folder" size={34}/></span><h3>你的第一个项目，从这里开始</h3><p>为一个品牌、一个账号，或一次内容复盘建立项目。</p>{canWrite ? <button className="primary-button" onClick={() => setCreating(true)}><Icon name="plus" size={17}/>创建第一个项目</button> : <p className="small-label">你拥有只读权限，请联系空间所有者创建项目。</p>}</div> : visibleProjects.length === 0 ? <div className="empty-state compact-empty"><Icon name="search" size={32}/><h3>没有找到匹配的项目</h3><p>试试其他关键词，或清除搜索条件。</p><button className="secondary-button" onClick={() => setSearch('')}>清除搜索</button></div> : <div className="project-grid">{visibleProjects.map((p, i) => <button className="project-card" key={p.id} onClick={() => navigate(p.id)}><div className="card-top"><span className={`project-symbol color-${i % 3}`}><Icon name={i % 2 ? 'chart' : 'folder'} size={23}/></span><span className="project-status"><span/>项目已建立</span></div><h3>{p.name}</h3><p className="project-description">{p.description || '为这个项目导入数据，逐步建立属于你的内容洞察。'}</p><div className="project-tags"><span>{p.brand_name || '独立分析项目'}</span><span>{preview ? '示例项目' : '私有项目'}</span></div><div className="card-footer"><span>{dateLabel(p.created_at)}创建</span><span className="open-project">打开项目 <Icon name="arrow" size={16}/></span></div></button>)}{canWrite && <button className="new-project-card" onClick={() => preview ? leavePreview() : setCreating(true)}><span><Icon name="plus" size={23}/></span><b>开启一个新项目</b><p>{preview ? '登录后创建你的真实项目' : '给下一个想法，留一个空间'}</p></button>}</div>}
          </section><div className="workflow-note"><Icon name="lock" size={15}/><span>项目数据按工作空间隔离，仅成员可访问。</span></div>
        </> : loading && !preview ? <div className="empty-state"><span className="spinner"/><p>正在读取项目…</p></div> : project ? <>
          <button className="back-link" onClick={() => navigate('')}><Icon name="arrow" size={16} style={{ transform: 'rotate(180deg)' }}/>返回全部项目</button><div className="detail-header"><span className="project-symbol color-0"><Icon name="folder" size={27}/></span><div><span className="eyebrow section-eyebrow">PROJECT WORKSPACE</span><h1>{project.name}</h1><p className="muted">{project.description || '一个新的内容探索，已经开始。'}</p></div></div><div className="detail-meta"><span><Icon name="layers" size={16}/>{project.brand_name || '独立分析项目'}</span><span>{dateLabel(project.created_at)}创建</span><span><Icon name="lock" size={14}/>空间成员可见</span></div>
          <section className="detail-onboarding"><span className="onboarding-number">01</span><div><span className="small-label">第一步已完成</span><h2>项目准备好了，下一步让数据进来。</h2><p>这个空间将承载你的内容记录、用户反馈和分析结果。</p></div><span className="done-pill"><Icon name="check" size={14}/>项目已创建</span></section>
          <h2 className="next-section-heading">接下来，在这个项目里</h2><div className="feature-grid">{[['upload', '数据导入', '上传内容、指标和评论，查看字段映射与校验结果。', '下一阶段'], ['chart', '内容表现', '关注内容排名与变化趋势，让复盘有据可依。', '后续开放'], ['bubble', '评论洞察', '整理用户反馈，理解评论中的情感与主题。', '后续开放']].map(([icon, title, text, tag]) => <section className="feature-card" key={icon}><span className="feature-icon"><Icon name={icon} size={24}/></span><span className="stage-tag">{tag}</span><h3>{title}</h3><p>{text}</p></section>)}</div><p className="detail-limit">当前版本已支持项目管理。数据导入和分析将在后续阶段逐步开放。</p>
        </> : <div className="empty-state"><Icon name="folder" size={34}/><h2>暂时无法打开这个项目</h2><p>项目可能不属于当前工作空间，或你没有访问权限。</p><button className="secondary-button" onClick={() => navigate('')}>返回项目列表</button></div>}
      </main><footer className="workspace-footer"><span>Content Intelligence</span><span>每一份记录，都离洞察更近一步。</span></footer>
    </div>
    {creating && activeWorkspace && !preview && <CreateProjectDialog workspace={activeWorkspace} onClose={() => setCreating(false)} onCreated={p => { setProjects(previous => [p, ...previous]); setCreating(false); setToast('项目创建成功。'); navigate(p.id); }}/>}
    {toast && <div className="toast" role="status"><Icon name="check" size={18}/>{toast}<button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><Icon name="close" size={15}/></button></div>}
  </div>;
}


