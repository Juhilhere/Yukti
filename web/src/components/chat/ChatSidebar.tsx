import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, FolderInput } from 'lucide-react';
import { api, errMsg } from '../../lib/api';
import { qk } from '../../lib/queries';
import type { ChatSummary, Project } from '../../lib/types';
import { cx, timeAgo } from '../../lib/format';
import { ErrorBox, Kbd, Spinner, useClickOutside } from '../ui';
import { toast } from '../Toast';
import { Modal } from '../Modal';

type Menu = { chat: ChatSummary; x: number; y: number } | null;

export function ChatSidebar({ activeId, onNew }: { activeId?: string; onNew: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newProj, setNewProj] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<ChatSummary | null>(null);
  const menuRef = useClickOutside<HTMLDivElement>(!!menu, () => setMenu(null));

  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>('/api/projects') });
  const chats = useQuery({ queryKey: qk.chats, queryFn: () => api.get<ChatSummary[]>('/api/chats') });

  const invalidate = () => { qc.invalidateQueries({ queryKey: qk.chats }); qc.invalidateQueries({ queryKey: qk.projects }); };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/api/chats/${id}`, body),
    onSuccess: (_d, v) => { invalidate(); qc.invalidateQueries({ queryKey: qk.chat(v.id) }); },
    onError: (e) => toast.error('Update failed', errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/chats/${id}`),
    onSuccess: (_d, id) => { invalidate(); if (id === activeId) nav('/chat'); toast.success('Chat deleted'); },
    onError: (e) => toast.error('Delete failed', errMsg(e)),
  });
  const createProj = useMutation({
    mutationFn: (name: string) => api.post<Project>('/api/projects', { name }),
    onSuccess: () => { invalidate(); setNewProj(null); },
    onError: (e) => toast.error('Could not create folder', errMsg(e)),
  });

  const filtered = useMemo(() => {
    const list = [...(chats.data ?? [])].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    const s = q.trim().toLowerCase();
    return s ? list.filter((c) => (c.title || '').toLowerCase().includes(s)) : list;
  }, [chats.data, q]);
  const projList = projects.data ?? [];
  const projIds = new Set(projList.map((p) => p.id));
  const loose = filtered.filter((c) => !c.project_id || !projIds.has(c.project_id));

  const commitRename = () => {
    if (renaming && renaming.title.trim()) patch.mutate({ id: renaming.id, body: { title: renaming.title.trim() } });
    setRenaming(null);
  };

  const row = (c: ChatSummary, indent = false) => (
    <div key={c.id}
      onClick={() => renaming?.id !== c.id && nav(`/chat/${c.id}`)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ chat: c, x: e.clientX, y: e.clientY }); }}
      className={cx('group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]', indent && 'ml-3',
        activeId === c.id ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2 hover:text-text')}>
      <MessageSquare size={12} className="shrink-0 opacity-60" />
      {renaming?.id === c.id ? (
        <input autoFocus className="input !py-0 !px-1 text-[12.5px]" value={renaming.title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{c.title || 'Untitled chat'}</span>
          <span className="shrink-0 text-[10px] text-faint group-hover:hidden">{timeAgo(c.updated_at)}</span>
          <button className="hidden shrink-0 text-faint hover:text-text group-hover:block"
            onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ chat: c, x: r.left, y: r.bottom + 2 }); }}>
            <MoreHorizontal size={13} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="space-y-2 p-2.5">
        <div className="flex gap-1.5">
          <button className="btn btn-cyan flex-1 justify-center" onClick={onNew} title="New chat (Ctrl+N)">
            <Plus size={14} />New chat<Kbd>Ctrl+N</Kbd>
          </button>
          <button className="btn btn-icon" title="New folder" onClick={() => setNewProj('')}><FolderPlus size={14} /></button>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !pl-7 !py-1 text-[12px]" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {(chats.isLoading || projects.isLoading) && <div className="flex justify-center py-6"><Spinner /></div>}
        {chats.error ? <ErrorBox className="mx-1" error={chats.error} onRetry={() => chats.refetch()} /> : null}
        {projList.map((p) => {
          const items = filtered.filter((c) => c.project_id === p.id);
          if (q && items.length === 0) return null;
          const isC = collapsed[p.id];
          return (
            <div key={p.id} className="mb-1">
              <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-muted hover:text-text"
                onClick={() => setCollapsed((s) => ({ ...s, [p.id]: !s[p.id] }))}>
                {isC ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <Folder size={12} className="text-amber/80" />
                <span className="flex-1 truncate font-medium">{p.name}</span>
                <span className="font-mono text-[10px] text-faint">{items.length || p.chat_count || 0}</span>
              </button>
              {!isC && items.map((c) => row(c, true))}
              {!isC && items.length === 0 && <div className="ml-8 py-1 text-[11px] text-faint">Empty</div>}
            </div>
          );
        })}
        {loose.length > 0 && (
          <>
            {projList.length > 0 && <div className="label px-2 pb-1 pt-2">Chats</div>}
            {loose.map((c) => row(c))}
          </>
        )}
        {!chats.isLoading && !chats.error && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-faint">{q ? 'No chats match' : 'No chats yet'}</div>
        )}
      </div>

      {menu && (
        <div ref={menuRef} className="fixed z-[80] w-[190px] rounded-md border border-border bg-surface-2 py-1 shadow-2xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}>
          <MenuBtn icon={<Pencil size={12} />} onClick={() => { setRenaming({ id: menu.chat.id, title: menu.chat.title || '' }); setMenu(null); }}>Rename</MenuBtn>
          {projList.length > 0 && <div className="label px-3 pt-1.5 pb-0.5 !text-[10px]">Move to</div>}
          {menu.chat.project_id && (
            <MenuBtn icon={<FolderInput size={12} />} onClick={() => { patch.mutate({ id: menu.chat.id, body: { project_id: null } }); setMenu(null); }}>No folder</MenuBtn>
          )}
          {projList.filter((p) => p.id !== menu.chat.project_id).map((p) => (
            <MenuBtn key={p.id} icon={<Folder size={12} />} onClick={() => { patch.mutate({ id: menu.chat.id, body: { project_id: p.id } }); setMenu(null); }}>{p.name}</MenuBtn>
          ))}
          <div className="my-1 border-t border-border" />
          <MenuBtn danger icon={<Trash2 size={12} />} onClick={() => { setConfirmDel(menu.chat); setMenu(null); }}>Delete</MenuBtn>
        </div>
      )}

      <Modal open={newProj !== null} onClose={() => setNewProj(null)} title="New folder" width={380}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setNewProj(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={!newProj?.trim() || createProj.isPending} onClick={() => createProj.mutate(newProj!.trim())}>Create</button>
        </>}>
        <input autoFocus className="input" placeholder="e.g. CDU-1 turnaround" value={newProj ?? ''} onChange={(e) => setNewProj(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && newProj?.trim()) createProj.mutate(newProj.trim()); }} />
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete chat?" width={400}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => { if (confirmDel) del.mutate(confirmDel.id); setConfirmDel(null); }}>Delete</button>
        </>}>
        <p className="text-muted">“{confirmDel?.title || 'Untitled chat'}” and its messages will be removed. The audit log keeps a record.</p>
      </Modal>
    </aside>
  );
}

function MenuBtn({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-3', danger ? 'text-red-300' : 'text-text')}>
      <span className="text-muted">{icon}</span><span className="truncate">{children}</span>
    </button>
  );
}
