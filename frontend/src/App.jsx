import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Cloud, Folder, RefreshCw, Trash2, LogOut, Plus, HardDrive,
  CheckCircle, XCircle, Loader2, Settings as SettingsIcon, Bell,
  LayoutDashboard, Activity as ActivityIcon, AlertTriangle,
  FileText, FolderOpen, ExternalLink, Power, RotateCw, Search,
  Filter, ChevronRight, Clock, ArrowRight, X, Sun, Moon, Languages
} from 'lucide-react';
import { t, useT, setLang as setI18nLang, getLang, fmtRelI18n } from './i18n';
import { useShortcuts, SHORTCUTS_HELP } from './shortcuts';

const TOKEN_KEY = 'tmc_token';
const USER_KEY = 'tmc_user';

function auth() { const t = localStorage.getItem(TOKEN_KEY); return t ? { Authorization: `Bearer ${t}` } : {}; }
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...auth(), ...(opts.headers || {}) } });
  if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); throw new Error('auth'); }
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${r.status}`); }
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}

function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${u[i]}`;
}
function fmtRel(iso) {
  if (!iso) return '—';
  const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff/60)} phút`;
  if (diff < 86400) return `${Math.floor(diff/3600)} giờ`;
  return `${Math.floor(diff/86400)} ngày`;
}

// Theme
const THEME_KEY = 'tmc_theme';
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    try {
      document.documentElement.classList.toggle('light', theme === 'light');
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);
  return [theme, setTheme];
}

// ── Root ─────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => localStorage.getItem(USER_KEY));
  if (!token) return <SetupOrLogin onAuth={(t, u) => { localStorage.setItem(TOKEN_KEY, t); localStorage.setItem(USER_KEY, u); setToken(t); setUser(u); }} />;
  return <Shell user={user} onLogout={() => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setToken(null); setUser(null); }} />;
}

function SetupOrLogin({ onAuth }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/auto', { method: 'POST' });
        const j = await r.json();
        if (!cancelled && r.ok) onAuth(j.token, j.username);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [onAuth]);
  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-[#0c0e12] via-[#11141a] to-[#0c0e12]">
      <div className="flex flex-col items-center gap-3">
        <Cloud size={48} className="text-[#0078d4]"/>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin"/>
          TM Cloud đang khởi động…
        </div>
      </div>
    </div>
  );
}

// ── Shell: CRM layout ─────────────────────────────────────────────────
function Shell({ user, onLogout }) {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('dashboard');
  const [providers, setProviders] = useState([]);
  const [activities, setActivities] = useState([]);
  const [quotas, setQuotas] = useState({});
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  // Mount-only side-effects: refresh + keyboard shortcuts
  useEffect(() => {
    const onAdd = () => setShowAdd(true);
    const onSettings = () => setTab('settings');
    window.addEventListener('tmc-shortcut-add', onAdd);
    window.addEventListener('tmc-shortcut-settings', onSettings);
    return () => {
      window.removeEventListener('tmc-shortcut-add', onAdd);
      window.removeEventListener('tmc-shortcut-settings', onSettings);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [plist, jobs] = await Promise.all([
        api('/api/providers'),
        api('/api/sync/jobs').catch(() => []),
      ]);
      setProviders(plist);
      setActivities(jobs.map(j => ({
        id: `sync-${j.id}`,
        type: j.status === 'ok' ? 'sync_ok' : j.status === 'error' ? 'sync_error' : 'sync_run',
        provider: j.label,
        msg: `Sync ${j.status} — ${j.kind} @ ${j.started_at?.slice(0,16)}`,
        time: j.started_at,
      })));
      const q = {};
      for (const p of plist) {
        try { q[p.id] = await api(`/api/providers/${p.id}/quota`); } catch {}
      }
      setQuotas(q);
    } catch (e) { console.error(e); }
  }, []);

  // Initial fetch only — một lần duy nhất, không có dependency để loop
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  // Stable callbacks cho children — tránh tạo arrow function mới mỗi render
  const onAddClick = useCallback(() => setShowAdd(true), []);
  const onSettingsClick = useCallback(() => setTab('settings'), []);
  const onNotifClick = useCallback(() => setShowNotif(true), []);
  const onSelect = useCallback((p) => setSelected(p), []);
  const onClose = useCallback(() => setShowAdd(false), []);
  const onAdded = useCallback(() => { setShowAdd(false); refresh(); }, [refresh]);

  const filtered = useMemo(() => providers.filter(p => {
    if (search && !p.label.toLowerCase().includes(search.toLowerCase()) &&
        !(p.account_email || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'mounted' && !p.status.mounted) return false;
    if (filter === 'unmounted' && p.status.mounted) return false;
    if (filter === 'error' && !p.status.last_error) return false;
    return true;
  }), [providers, search, filter]);

  const mountedCount = useMemo(() => providers.filter(p => p.status.mounted).length, [providers]);
  const totalUsed = useMemo(() => Object.values(quotas).reduce((s, q) => s + (q.used || 0), 0), [quotas]);
  const totalCap = useMemo(() => Object.values(quotas).reduce((s, q) => s + (q.total || 0), 0), [quotas]);
  const last24hSyncs = useMemo(() => {
    const cutoff = Date.now() - 86400000;
    return activities.filter(a => a.type.startsWith('sync_') && new Date(a.time).getTime() > cutoff).length;
  }, [activities]);
  const recentNotif = useMemo(() => {
    const cutoff = Date.now() - 60000;
    return activities.filter(a => new Date(a.time).getTime() > cutoff).length;
  }, [activities]);

  return (
    <div className="h-full flex bg-[#0c0e12] text-slate-200">
      <aside className="w-56 bg-panel border-r border-line flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-line">
          <Cloud size={20} className="text-[#0078d4]"/>
          <span className="ml-2 font-semibold">TM Cloud</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <NavItem icon={<LayoutDashboard size={16}/>} label="Dashboard" active={tab==='dashboard'} onClick={() => setTab('dashboard')}/>
          <NavItem icon={<HardDrive size={16}/>} label="Accounts" active={tab==='accounts'} onClick={() => setTab('accounts')}
                   badge={mountedCount > 0 ? `${mountedCount}/${providers.length}` : null}/>
          <NavItem icon={<ActivityIcon size={16}/>} label="Hoạt động" active={tab==='activities'} onClick={() => setTab('activities')}
                   badge={recentNotif || null}/>
          <NavItem icon={<AlertTriangle size={16}/>} label="Xung đột" active={tab==='conflicts'} onClick={() => setTab('conflicts')} disabled hint="sắp có"/>
          <NavItem icon={<FileText size={16}/>} label="Logs" active={tab==='logs'} onClick={() => setTab('logs')}/>
          <NavItem icon={<SettingsIcon size={16}/>} label="Cài đặt" active={tab==='settings'} onClick={onSettingsClick}/>
        </nav>
        <div className="p-3 border-t border-line">
          <button onClick={onLogout} className="w-full px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded flex items-center gap-2">
            <LogOut size={12}/> Đăng xuất ({user})
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-line bg-panel/50 flex items-center px-6 shrink-0">
          <h1 className="text-base font-semibold capitalize">{tab}</h1>
          {tab === 'dashboard' && (
            <span className="ml-3 text-xs text-slate-500">{providers.length} accounts · {activities.length} activities</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm account…"
                     className="bg-[#0c0e12] border border-line rounded pl-8 pr-3 py-1.5 text-sm w-56 focus:border-[#0078d4] outline-none"/>
            </div>
            <button onClick={() => setI18nLang(getLang() === 'vi' ? 'en' : 'vi')}
                    title={getLang() === 'vi' ? 'English' : 'Tiếng Việt'}
                    className="px-2 py-1.5 rounded hover:bg-[#11141a] text-xs flex items-center gap-1 text-slate-400">
              <Languages size={14}/> {getLang().toUpperCase()}
            </button>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    title={theme === 'dark' ? 'Light' : 'Dark'}
                    className="p-2 rounded hover:bg-[#11141a] text-slate-400">
              {theme === 'dark' ? <Sun size={14}/> : <Moon size={14}/>}
            </button>
            <button onClick={onNotifClick} className="relative p-2 rounded hover:bg-[#11141a]">
              <Bell size={16} className="text-slate-400"/>
              {recentNotif > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-[#0078d4] rounded-full"/>}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {tab === 'dashboard' && (
            <DashboardTab providers={providers} quotas={quotas}
                          activities={activities} onSelect={onSelect} onAdd={onAddClick} onMount={refresh}
                          totalUsed={totalUsed} totalCap={totalCap}
                          mountedCount={mountedCount} last24hSyncs={last24hSyncs}/>
          )}
          {tab === 'accounts' && (
            <AccountsTab providers={filtered} quotas={quotas}
                         filter={filter} setFilter={setFilter}
                         onSelect={onSelect} onMount={refresh} onAdd={onAddClick}/>
          )}
          {tab === 'activities' && <ActivitiesTab activities={activities}/>}
          {tab === 'logs' && <LogsTab/>}
          {tab === 'settings' && <SettingsTab user={user} onLogout={onLogout}/>}
        </div>

        {selected && tab === 'accounts' && (
          <ProviderDetailPanel provider={selected} quota={quotas[selected.id]}
                              onClose={() => setSelected(null)} onAction={refresh}
                              onDeleted={refresh}/>
        )}
      </main>

      {showAdd && <AddProviderDialog onClose={onClose} onAdded={onAdded}/>}
      {showNotif && <NotificationPanel activities={activities} onClose={() => setShowNotif(false)}/>}
    </div>
  );
}

function NavItem({ icon, label, active, onClick, badge, disabled, hint }) {
  return (
    <button onClick={onClick} disabled={disabled}
            className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
              active ? 'bg-[#0078d4]/15 text-[#0078d4]' :
              disabled ? 'text-slate-600 cursor-not-allowed' :
              'text-slate-300 hover:bg-[#11141a]'
            }`}>
      {icon}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
      {badge != null && badge !== false && (
        <span className="text-[10px] bg-[#0078d4]/20 text-[#0078d4] px-1.5 py-0.5 rounded">{badge}</span>
      )}
    </button>
  );
}

// ── Dashboard tab ────────────────────────────────────────────────────
function DashboardTab({ providers, quotas, activities, onSelect, onAdd, onMount,
                       totalUsed, totalCap, mountedCount, last24hSyncs }) {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={<HardDrive size={18}/>} label="Providers" value={providers.length} sub={`${mountedCount} mounted`} color="blue"/>
        <StatCard icon={<Cloud size={18}/>} label="Storage dùng" value={fmtSize(totalUsed)} sub={totalCap ? `trên ${fmtSize(totalCap)}` : '—'} color="purple"/>
        <StatCard icon={<RefreshCw size={18}/>} label="Sync 24h" value={last24hSyncs} sub="job đã chạy" color="green"/>
        <StatCard icon={<Clock size={18}/>} label="Recent" value={activities.length} sub="activities" color="amber"/>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">Cloud accounts</h2>
          <span className="text-xs text-slate-500">{providers.length} total</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {providers.map(p => (
            <ProviderCard key={p.id} provider={p} quota={quotas[p.id]}
                          onClick={() => onSelect(p)} onAction={onMount}/>
          ))}
          <button onClick={onAdd}
                  className="p-5 border-2 border-dashed border-line rounded-lg hover:border-[#0078d4] hover:bg-[#0078d4]/5 transition text-slate-500 hover:text-[#0078d4] flex flex-col items-center justify-center gap-2 min-h-[140px]">
            <Plus size={32}/>
            <span className="text-sm font-medium">Thêm cloud account</span>
            <span className="text-xs">OneDrive, Google Drive, Dropbox, S3…</span>
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent activity</h2>
        <div className="bg-panel border border-line rounded-lg divide-y divide-line/40">
          {activities.length === 0 ?
            <div className="p-6 text-center text-sm text-slate-500">Chưa có hoạt động nào</div> :
            activities.slice(0, 10).map(a => <ActivityRow key={a.id} a={a}/>)
          }
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  const colors = {
    blue: 'text-[#0078d4] bg-[#0078d4]/10',
    purple: 'text-purple-400 bg-purple-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    green: 'text-green-400 bg-green-500/10',
  };
  return (
    <div className="bg-panel border border-line rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-slate-400 uppercase">{label}</span>
        <div className={`w-8 h-8 rounded flex items-center justify-center ${colors[color]}`}>{icon}</div>
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function ProviderCard({ provider, quota, onClick, onAction }) {
  const used = quota?.used || 0;
  const total = quota?.total || 1;
  const pct = Math.min(100, Math.round(used / total * 100));
  const isMounted = provider.status.mounted;
  return (
    <div onClick={onClick} className="bg-panel border border-line rounded-lg p-4 hover:border-[#0078d4] cursor-pointer transition group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <ProviderIcon kind={provider.kind} size={32}/>
          <div className="min-w-0">
            <div className="font-semibold truncate">{provider.label}</div>
            <div className="text-xs text-slate-500 truncate">{provider.account_email || provider.kind}</div>
          </div>
        </div>
        <StatusPill mounted={isMounted} error={provider.status.last_error}/>
      </div>
      {quota && quota.total ? (
        <>
          <div className="flex items-baseline justify-between text-xs text-slate-400 mb-1">
            <span>{fmtSize(used)} / {fmtSize(total)}</span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-1.5 bg-[#0c0e12] rounded overflow-hidden">
            <div className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-[#0078d4]'}`} style={{ width: pct + '%' }}/>
          </div>
        </>
      ) : (
        <div className="text-xs text-slate-600">Quota chưa load</div>
      )}
      <div className="flex gap-2 mt-3">
        {isMounted ? (
          <>
            <ActionBtn icon={<RefreshCw size={11}/>} onClick={(e) => { e.stopPropagation(); onAction(); }}>
              Sync
            </ActionBtn>
            <ActionBtn icon={<ExternalLink size={11}/>} onClick={(e) => { e.stopPropagation();
              window.open('file://' + (provider.status.mount_path || ''), '_blank');
            }}>Mở Files</ActionBtn>
          </>
        ) : (
          <ActionBtn icon={<Power size={11}/>} onClick={(e) => { e.stopPropagation(); onAction(); }}>
            Mount
          </ActionBtn>
        )}
      </div>
    </div>
  );
}

function ProviderIcon({ kind, size = 32 }) {
  const c = kind === 'onedrive' ? '#0078d4' : kind === 'gdrive' ? '#fbbc04' : '#64748b';
  return (
    <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: size, height: size, background: c + '20' }}>
      <HardDrive size={size * 0.55} style={{ color: c }}/>
    </div>
  );
}

function StatusPill({ mounted, error }) {
  if (error) return <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full shrink-0">error</span>;
  if (mounted) return <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full shrink-0">● mounted</span>;
  return <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full shrink-0">○ unmounted</span>;
}

function ActionBtn({ icon, onClick, children }) {
  return (
    <button onClick={onClick} className="px-2 py-1 text-[11px] rounded flex items-center gap-1 text-slate-300 hover:bg-[#0c0e12]">
      {icon}{children}
    </button>
  );
}

function ActivityRow({ a }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 text-xs">
      {a.type === 'sync_ok' ? <CheckCircle size={14} className="text-green-400"/> :
       a.type === 'sync_error' ? <XCircle size={14} className="text-red-400"/> :
       <RefreshCw size={14} className="text-slate-500"/>}
      <span className="flex-1 truncate">{a.msg}</span>
      <span className="text-slate-500">{a.provider}</span>
      <span className="text-slate-600 font-mono w-16 text-right">{fmtRel(a.time)}</span>
    </div>
  );
}

// ── Accounts tab ─────────────────────────────────────────────────────
function AccountsTab({ providers, quotas, filter, setFilter, onSelect, onMount, onAdd }) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)}
                  className="bg-panel border border-line rounded px-2 py-1.5 text-sm">
            <option value="all">Tất cả</option>
            <option value="mounted">Mounted</option>
            <option value="unmounted">Unmounted</option>
            <option value="error">Lỗi</option>
          </select>
          <span className="text-xs text-slate-500">{providers.length}</span>
        </div>
        <button onClick={onAdd} className="bg-[#0078d4] hover:bg-[#106ebe] text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1">
          <Plus size={14}/> Thêm cloud
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="bg-panel border border-dashed border-line rounded-lg p-12 text-center">
          <Cloud size={48} className="mx-auto text-slate-700 mb-3"/>
          <div className="text-sm text-slate-400 mb-3">Chưa có cloud account nào</div>
          <button onClick={onAdd} className="bg-[#0078d4] text-white px-4 py-2 rounded text-sm">Thêm OneDrive / Google Drive</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map(p => (
            <ProviderCard key={p.id} provider={p} quota={quotas[p.id]}
                          onClick={() => onSelect(p)} onAction={onMount}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Provider detail panel ────────────────────────────────────────────
function ProviderDetailPanel({ provider, quota, onClose, onAction, onDeleted }) {
  const [details, setDetails] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [newLabel, setNewLabel] = useState(provider.label);
  const [busy, setBusy] = useState(null); // mount | unmount | sync | test | rename | delete | refresh
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState('');

  async function loadDetails() {
    try { setDetails(await api(`/api/providers/${provider.id}/details`)); } catch (e) { console.error(e); }
  }
  useEffect(() => { loadDetails(); }, [provider.id]);

  async function doAction(kind, fn) {
    setBusy(kind); setMsg(''); setTestResult(null);
    try {
      const r = await fn();
      setMsg({ kind: 'ok', text: `${kind}: OK` });
      if (kind === 'test') setTestResult(r);
      await loadDetails();
      onAction();
      return r;
    } catch (e) {
      setMsg({ kind: 'err', text: `${kind}: ${e.message}` });
      if (kind === 'test') setTestResult({ ok: false, error: e.message });
      throw e;
    } finally {
      setBusy(null);
    }
  }

  async function handleMount() { return doAction('mount', () => api(`/api/providers/${provider.id}/mount`, { method: 'POST' })); }
  async function handleUnmount() { return doAction('unmount', () => api(`/api/providers/${provider.id}/unmount`, { method: 'POST' })); }
  async function handleSync() { return doAction('sync', () => api(`/api/providers/${provider.id}/sync`, { method: 'POST' })); }
  async function handleTest() { return doAction('test', () => api(`/api/providers/${provider.id}/test`, { method: 'POST' })); }
  async function handleRefreshQuota() { return doAction('refresh', () => api(`/api/providers/${provider.id}/refresh-quota`, { method: 'POST' })); }
  async function handleRename() {
    if (!newLabel.trim()) return;
    await doAction('rename', () => api(`/api/providers/${provider.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newLabel.trim() }) }));
    setRenaming(false);
  }
  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await doAction('delete', () => api(`/api/providers/${provider.id}`, { method: 'DELETE' }));
    onDeleted?.();
    onClose();
  }

  const isMounted = provider.status.mounted;
  return (
    <div className="fixed inset-y-0 right-0 w-[28rem] bg-panel border-l border-line shadow-2xl z-40 flex flex-col">
      <div className="h-14 border-b border-line flex items-center px-4 shrink-0">
        <ProviderIcon kind={provider.kind} size={28}/>
        <div className="ml-3 flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-1">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                     className="flex-1 bg-[#0c0e12] border border-line rounded px-2 py-0.5 text-sm"
                     onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}/>
              <button onClick={handleRename} disabled={busy === 'rename'}
                      className="text-green-400 text-xs px-2 py-0.5 hover:bg-green-500/10 rounded">OK</button>
              <button onClick={() => { setRenaming(false); setNewLabel(provider.label); }}
                      className="text-slate-400 text-xs px-2 py-0.5 hover:bg-[#11141a] rounded">X</button>
            </div>
          ) : (
            <>
              <div className="font-semibold truncate flex items-center gap-2">
                <span>{provider.label}</span>
                <button onClick={() => setRenaming(true)} title="Đổi tên"
                        className="text-slate-500 hover:text-[#0078d4]"><RotateCw size={11}/></button>
              </div>
              <div className="text-xs text-slate-500 truncate">{provider.account_email || provider.kind} · {provider.rclone_remote}</div>
            </>
          )}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={16}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {msg && (
          <div className={`text-xs p-2 rounded ${msg.kind === 'err' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
            {msg.text}
          </div>
        )}

        {/* Status */}
        <div>
          <div className="text-xs text-slate-400 mb-1">Trạng thái</div>
          <StatusPill mounted={isMounted} error={provider.status.last_error}/>
        </div>

        {/* Mount path */}
        <div>
          <div className="text-xs text-slate-400 mb-1">Mount path</div>
          <code className="text-xs bg-[#0c0e12] px-2 py-1 rounded block break-all">{provider.status.mount_path || '—'}</code>
          {isMounted && (
            <button onClick={() => window.open('file://' + (provider.status.mount_path || ''), '_blank')}
                    className="text-xs text-[#0078d4] hover:underline mt-1">
              ↗ Mở trong file manager
            </button>
          )}
        </div>

        {/* Quota */}
        {quota && quota.total ? (
          <div>
            <div className="text-xs text-slate-400 mb-1 flex items-center justify-between">
              <span>Dung lượng</span>
              <button onClick={handleRefreshQuota} disabled={busy === 'refresh'}
                      className="text-[10px] text-[#0078d4] hover:underline disabled:text-slate-600">
                {busy === 'refresh' ? 'đang tải…' : '↻ refresh'}
              </button>
            </div>
            <div className="text-xs text-slate-300">
              {fmtSize(quota.used)} / {fmtSize(quota.total)} ({Math.round(quota.used / quota.total * 100)}%)
            </div>
            <div className="h-1.5 bg-[#0c0e12] rounded overflow-hidden mt-1">
              <div className={`h-full ${(quota.used / quota.total) > 0.9 ? 'bg-red-500' : 'bg-[#0078d4]'}`}
                   style={{ width: Math.min(100, quota.used / quota.total * 100) + '%' }}/>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              free: {fmtSize(quota.remaining || 0)} · deleted: {fmtSize(quota.deleted || 0)}
            </div>
          </div>
        ) : (
          <button onClick={handleRefreshQuota} disabled={busy === 'refresh'}
                  className="text-xs text-[#0078d4] hover:underline disabled:text-slate-600">
            {busy === 'refresh' ? 'đang tải quota…' : '↻ Load quota'}
          </button>
        )}

        {/* Primary actions */}
        <div className="flex gap-2">
          {isMounted ? (
            <>
              <button onClick={handleSync} disabled={busy !== null}
                      className="flex-1 bg-[#0078d4] hover:bg-[#106ebe] disabled:bg-slate-700 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-1">
                <RefreshCw size={13} className={busy === 'sync' ? 'animate-spin' : ''}/> Sync
              </button>
              <button onClick={handleUnmount} disabled={busy !== null}
                      className="flex-1 bg-[#0c0e12] hover:bg-[#11141a] disabled:bg-slate-700 text-slate-200 py-2 rounded text-sm">
                Unmount
              </button>
            </>
          ) : (
            <button onClick={handleMount} disabled={busy !== null}
                    className="flex-1 bg-[#0078d4] hover:bg-[#106ebe] disabled:bg-slate-700 text-white py-2 rounded text-sm font-medium flex items-center justify-center gap-1">
              <Power size={13} className={busy === 'mount' ? 'animate-spin' : ''}/> {busy === 'mount' ? 'đang mount…' : 'Mount'}
            </button>
          )}
        </div>

        {/* Test connection */}
        <div>
          <button onClick={handleTest} disabled={busy !== null}
                  className="w-full bg-[#0c0e12] hover:bg-[#11141a] disabled:bg-slate-700 text-slate-300 py-1.5 rounded text-xs flex items-center justify-center gap-1 border border-line">
            {busy === 'test' ? <Loader2 size={11} className="animate-spin"/> : <ActivityIcon size={11}/>}
            Test connection (rclone lsd)
          </button>
          {testResult && (
            <div className={`text-xs mt-2 p-2 rounded ${testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {testResult.ok ? (
                <>
                  ✓ {testResult.entries} entries
                  <pre className="text-[10px] mt-1 text-slate-400 max-h-32 overflow-y-auto">{testResult.sample?.join('\n')}</pre>
                </>
              ) : (
                <>✗ {testResult.error}</>
              )}
            </div>
          )}
        </div>

        {/* Mount details */}
        {details && (
          <div>
            <div className="text-xs text-slate-400 mb-1">Mount info</div>
            <div className="bg-[#0c0e12] rounded p-2 text-[11px] space-y-0.5 font-mono">
              <div>pid: <span className="text-slate-300">{details.mount.pid || '—'}</span></div>
              <div>started: <span className="text-slate-300">{(details.mount.started_at || '').slice(0, 19) || '—'}</span></div>
              <div>jobs run: <span className="text-slate-300">{details.sync.jobs_count}</span></div>
            </div>
            {details.rclone_config && (
              <details className="mt-2">
                <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
                  rclone config
                </summary>
                <pre className="text-[10px] mt-1 bg-[#0c0e12] rounded p-2 text-slate-400 overflow-x-auto">
{Object.entries(details.rclone_config).map(([k, v]) => `${k} = ${v}`).join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Danger zone */}
        <div className="pt-4 border-t border-line/40">
          <div className="text-[10px] uppercase text-slate-500 mb-1">Danger zone</div>
          {confirmDelete ? (
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={busy !== null}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 py-1.5 rounded text-xs font-medium">
                {busy === 'delete' ? 'đang xoá…' : 'Xác nhận xoá?'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                      className="flex-1 bg-[#0c0e12] text-slate-400 py-1.5 rounded text-xs">
                Huỷ
              </button>
            </div>
          ) : (
            <button onClick={handleDelete} disabled={busy !== null}
                    className="w-full text-red-400 hover:bg-red-500/10 py-1.5 rounded text-xs border border-red-500/30">
              Xoá provider (xoá oauth + unmount)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activities tab ───────────────────────────────────────────────────
function ActivitiesTab({ activities }) {
  const grouped = {};
  for (const a of activities) {
    const day = (a.time || '').slice(0, 10);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(a);
  }
  const days = Object.keys(grouped).sort().reverse();
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-sm font-semibold mb-3">Activity log ({activities.length})</h2>
      {days.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-12">Chưa có hoạt động</div>
      ) : days.map(d => (
        <div key={d} className="mb-6">
          <div className="text-xs text-slate-500 mb-1.5 font-mono">{d}</div>
          <div className="bg-panel border border-line rounded-lg divide-y divide-line/40">
            {grouped[d].map(a => <ActivityRow key={a.id} a={a}/>)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Logs tab ─────────────────────────────────────────────────────────
function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api('/api/sync/jobs').then(j => {
      if (cancelled) return;
      setLogs(j);
      if (j[0]) setSelected(j[0].log);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="flex h-full">
      <aside className="w-72 border-r border-line bg-panel overflow-y-auto">
        {logs.map(l => (
          <div key={l.id} onClick={() => setSelected(l.log)}
               className={`px-3 py-2 cursor-pointer border-b border-line/40 text-xs ${
                 selected === l.log ? 'bg-[#0078d4]/15 text-[#0078d4]' : 'hover:bg-[#11141a]'
               }`}>
            <div className="font-medium">{l.label} #{l.id}</div>
            <div className="text-slate-500 mt-0.5">{l.kind} · {l.status} · {(l.started_at || '').slice(0,16)}</div>
          </div>
        ))}
      </aside>
      <div className="flex-1 p-4 overflow-auto bg-[#0c0e12]">
        {selected ? (
          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">{selected}</pre>
        ) : (
          <div className="text-sm text-slate-500 text-center py-12">Chọn 1 log ở bên trái</div>
        )}
      </div>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────
function SettingsTab({ user, onLogout }) {
  const [settings, setSettings] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [currentPw, setCurrentPw] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    api('/api/settings').then(d => { if (!cancelled) setSettings(d); }).catch(() => {});
    api('/api/auth/current-password').then(d => { if (!cancelled) setCurrentPw(d.password); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function cleanupStaleMounts() {
    setCleanupMsg('đang quét...');
    try {
      const r = await api('/api/providers/cleanup-mounts', { method: 'POST' });
      setCleanupMsg(`Đã xoá ${r.cleaned.length} stale mount point: ${r.cleaned.join(', ') || '(không có)'}`);
    } catch (e) {
      setCleanupMsg('lỗi: ' + e.message);
    }
  }

  const changePw = async (e) => {
    e.preventDefault();
    setPwMsg('');
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPw }),
      });
      setPwMsg('✓ Đổi mật khẩu thành công');
      const d = await api('/api/auth/current-password');
      setCurrentPw(d.password);
      setNewPw('');
    } catch (e) { setPwMsg('✗ ' + e.message); }
  };

  if (!settings) {
    return <div className="p-6 text-sm text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-sm font-semibold mb-4">Settings</h2>
      <div className="space-y-3">
        <div className="p-3 bg-[#0c0e12] rounded">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0078d4] flex items-center justify-center font-semibold">{user[0]?.toUpperCase()}</div>
            <div className="flex-1">
              <div className="font-medium">{user}</div>
              <div className="text-xs text-slate-500">Tài khoản admin local (auto-login)</div>
            </div>
            <button onClick={onLogout} className="text-xs text-red-400 hover:bg-red-500/10 px-3 py-1 rounded">Đăng xuất</button>
          </div>
        </div>

        <div className="p-3 bg-[#0c0e12] rounded">
          <div className="text-xs text-slate-400 mb-2">Password hiện tại (lưu trong settings)</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-[#0c0e12] border border-line rounded px-2 py-1.5">
              {showPw ? (currentPw || '—') : '••••••••••••' + (currentPw ? currentPw.slice(-4) : '')}
            </code>
            <button onClick={() => setShowPw(s => !s)} className="px-2 py-1.5 text-xs border border-line rounded hover:bg-[#11141a]">
              {showPw ? 'Ẩn' : 'Hiện'}
            </button>
            {currentPw && (
              <button onClick={() => navigator.clipboard.writeText(currentPw)}
                      className="px-2 py-1.5 text-xs border border-line rounded hover:bg-[#11141a] text-[#0078d4]">
                Copy
              </button>
            )}
          </div>
        </div>

        <form onSubmit={changePw} className="p-3 bg-[#0c0e12] rounded space-y-2">
          <div className="text-xs text-slate-400 mb-2">Đổi mật khẩu</div>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
                 className="w-full bg-[#0c0e12] border border-line rounded px-3 py-1.5 text-sm"/>
          <button type="submit" className="bg-[#0078d4] text-white px-3 py-1 rounded text-sm">Đổi mật khẩu</button>
          {pwMsg && <div className={'text-xs ' + (pwMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{pwMsg}</div>}
        </form>

        <div className="p-3 bg-[#0c0e12] rounded text-xs space-y-1">
          <div className="text-slate-400 mb-2">System info</div>
          <div className="flex justify-between"><span className="text-slate-500">Version</span><span>0.1.0</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Theme</span><span>{settings.theme}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Auto-mount</span><span>{settings.auto_mount_on_startup ? 'On' : 'Off'}</span></div>
        </div>

        <div className="p-3 bg-[#0c0e12] rounded">
          <div className="text-xs text-slate-400 mb-2">Maintenance</div>
          <button onClick={cleanupStaleMounts}
                  className="w-full bg-[#0c0e12] hover:bg-[#11141a] text-slate-300 py-1.5 rounded text-xs border border-line">
            Cleanup stale mount points
          </button>
          {cleanupMsg && <div className="text-[10px] text-slate-500 mt-2">{cleanupMsg}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Notification panel ───────────────────────────────────────────────
function NotificationPanel({ activities, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-end z-50 pt-14 pr-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-96 bg-panel border border-line rounded-lg shadow-2xl">
        <div className="h-10 border-b border-line flex items-center px-4">
          <span className="text-sm font-semibold flex-1">Thông báo</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={14}/></button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {activities.length === 0 ?
            <div className="text-center text-slate-500 text-sm p-8">Chưa có thông báo</div> :
            activities.slice(0, 20).map(a => <ActivityRow key={a.id} a={a}/>)
          }
        </div>
      </div>
    </div>
  );
}

// ── AddProviderDialog — OAuth 1-click flow ───────────────────────────
function AddProviderDialog({ onClose, onAdded }) {
  const [step, setStep] = useState('config');
  const [kind, setKind] = useState('onedrive');
  const [label, setLabel] = useState('OneDrive');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [state, setState] = useState('pending');
  const [message, setMessage] = useState('Đang khởi động...');
  const [result, setResult] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startOAuth() {
    setStep('oauth');
    setMessage('Đang khởi động helper...');
    try {
      const body = { kind, label, client_id: clientId || null, client_secret: clientSecret || null };
      const j = await api('/api/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setSessionId(j.session_id);
      setState(j.state);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api('/api/oauth/status/' + j.session_id);
          setState(s.state); setMessage(s.message || '');
          if (s.state === 'done') {
            clearInterval(pollRef.current);
            const r = await api('/api/oauth/' + j.session_id + '/complete', { method: 'POST' });
            setResult(r); setStep('done');
          } else if (s.state === 'error' || s.state === 'cancelled') {
            clearInterval(pollRef.current);
            setStep('error');
          }
        } catch (e) {
          clearInterval(pollRef.current);
          setStep('error'); setMessage(e.message);
        }
      }, 1500);
    } catch (e) {
      setStep('error'); setMessage(e.message);
    }
  }

  async function cancel() {
    if (sessionId) await api('/api/oauth/cancel/' + sessionId, { method: 'DELETE' }).catch(() => {});
    if (pollRef.current) clearInterval(pollRef.current);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[28rem] bg-panel border border-line rounded-lg shadow-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">Thêm cloud account</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X size={14}/></button>
        </div>
        {step === 'config' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button onClick={() => { setKind('onedrive'); setLabel('OneDrive'); }}
                      className={`flex-1 py-2 rounded border ${kind==='onedrive' ? 'border-[#0078d4] bg-[#0078d4]/10' : 'border-line'}`}>
                OneDrive
              </button>
              <button onClick={() => { setKind('gdrive'); setLabel('Google Drive'); }}
                      className={`flex-1 py-2 rounded border ${kind==='gdrive' ? 'border-[#fbbc04] bg-[#fbbc04]/10' : 'border-line'}`}>
                Google Drive
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-400">Tên hiển thị</label>
              <input value={label} onChange={e => setLabel(e.target.value)}
                     className="w-full bg-[#0c0e12] border border-line rounded px-3 py-1.5 text-sm mt-1"/>
            </div>
            {kind === 'gdrive' && (
              <>
                <div>
                  <label className="text-xs text-slate-400">Google OAuth client_id</label>
                  <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="...apps.googleusercontent.com"
                         className="w-full bg-[#0c0e12] border border-line rounded px-3 py-1.5 text-sm mt-1 font-mono"/>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Google OAuth client_secret</label>
                  <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                         className="w-full bg-[#0c0e12] border border-line rounded px-3 py-1.5 text-sm mt-1 font-mono"/>
                </div>
              </>
            )}
            <div className="text-xs text-slate-500 bg-[#0c0e12] rounded p-3">
              {kind === 'onedrive'
                ? 'App sẽ tự mở trình duyệt Microsoft login. Không cần client_id.'
                : 'Cần OAuth Desktop app riêng. Tạo tại Google Cloud Console → copy client_id + client_secret.'}
            </div>
            <button onClick={startOAuth} className="w-full bg-[#0078d4] hover:bg-[#106ebe] text-white py-2 rounded text-sm font-medium">
              {kind === 'onedrive' ? 'Kết nối OneDrive' : 'Kết nối Google Drive →'}
            </button>
          </div>
        )}
        {step === 'oauth' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-amber-400"/>
              <span className="text-sm">{message}</span>
            </div>
            <div className="text-xs text-slate-500">
              State: <code className="text-[#0078d4]">{state}</code>
            </div>
            <button onClick={cancel} className="w-full bg-[#0c0e12] hover:bg-[#11141a] text-slate-300 py-2 rounded text-sm">
              Huỷ
            </button>
          </div>
        )}
        {step === 'done' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle size={16}/>
              <span className="text-sm font-medium">Hoàn tất</span>
            </div>
            <div className="text-xs text-slate-400 bg-[#0c0e12] rounded p-3">
              <code>{result?.label || kind}</code> đã kết nối!
            </div>
            <button onClick={onAdded} className="w-full bg-[#0078d4] hover:bg-[#106ebe] text-white py-2 rounded text-sm">
              OK
            </button>
          </div>
        )}
        {step === 'error' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={16}/>
              <span className="text-sm font-medium">Lỗi</span>
            </div>
            <div className="text-xs text-slate-400 bg-[#0c0e12] rounded p-3 break-all">
              {message}
            </div>
            <button onClick={() => setStep('config')} className="w-full bg-[#0078d4] hover:bg-[#106ebe] text-white py-2 rounded text-sm">
              Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
