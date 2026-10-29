/** LANX 3.x phone page: the screens around a chat — the chat list, Who's in,
 *  Files, groups, search results, the forward picker and the About sheet. */
import { useState } from "react";
import { ArrowLeft, Check, Download, Eye, EyeOff, FileText, Info, Lock, LogOut, Megaphone, Pencil, Search, Star, Timer, UserPlus, Users, X } from "lucide-react";
import type { Conversation, GroupInfo, Peer, Profile } from "../types";
import { Avatar } from "../components/Avatar";
import { formatSize } from "../lib/format";
import { statusLine } from "../lib/profile";
import type { Hit, LockInfo, Me, PhoneClient, PhoneTransfer, Progress } from "./client";
import { Sheet, fileName, transferState, whenShort, whereabouts } from "./parts";

// -------------------------------------------------------------------- chats

export function ChatsScreen({
  me,
  conversations,
  profiles,
  query,
  onQuery,
  onOpen,
  onAbout,
  onNewGroup,
  onSearchMessages,
  onStarred,
  lock,
  onBroadcast,
  onHiddenChats,
}: {
  me: Me | null;
  conversations: Conversation[];
  profiles: Record<string, Profile>;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onAbout: () => void;
  onNewGroup: () => void;
  onSearchMessages: (q: string) => void;
  onStarred: () => void;
  /** 3.3: the PIN lock (hidden chats shown?) */
  lock: LockInfo | null;
  onBroadcast: () => void;
  onHiddenChats: () => void;
}) {
  const q = query.trim().toLowerCase();
  const list = conversations.filter((c) => !c.archived && (!q || c.peer_name.toLowerCase().includes(q)));
  return (
    <>
      <header className="shrink-0 px-4 pt-3 pb-2 lanx-bar border-b lanx-line">
        <div className="flex items-center gap-3">
          <button type="button" data-ph-about onClick={onAbout} className="shrink-0 rounded-full">
            {me ? <Avatar name={me.name} color={me.color} profile={me.profile} size={34} /> : <span className="block h-[34px] w-[34px] rounded-full bg-slate-300" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">Chats</div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{me ? `${me.name} · through your PC` : "…"}</div>
          </div>
          {lock?.pin_set && (
            <button type="button" data-ph-hidden-chats={lock.hidden_unlocked ? "shown" : "hidden"} onClick={onHiddenChats} className={`lanx-tool p-2 ${lock.hidden_unlocked ? "text-violet-500" : "text-slate-400"}`} aria-label={lock.hidden_unlocked ? "Hide hidden chats" : "Show hidden chats"}>
              {lock.hidden_unlocked ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
          )}
          <button type="button" data-ph-broadcast onClick={onBroadcast} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Message everyone">
            <Megaphone className="h-5 w-5" />
          </button>
          <button type="button" data-ph-starred onClick={onStarred} className="lanx-tool p-2 text-amber-500" aria-label="Starred messages">
            <Star className="h-5 w-5" />
          </button>
          <button type="button" data-ph-new-group onClick={onNewGroup} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="New group">
            <Users className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-xl lanx-field px-3 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            data-ph-search
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) onSearchMessages(query.trim());
            }}
            placeholder="Search"
            className="w-full bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white ph-select"
          />
          {query && (
            <button type="button" onClick={() => onQuery("")} className="lanx-tool p-1" aria-label="Clear">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>
      <div className="ph-scroll px-2 py-2">
        {query.trim() && (
          <button type="button" data-ph-search-messages onClick={() => onSearchMessages(query.trim())} className="mb-1 flex w-full items-center gap-2 rounded-[14px] px-3 py-2 text-left text-[13px] text-sky-600 active:bg-[var(--lanx-fill)] dark:text-sky-400">
            <Search className="h-4 w-4" /> Search messages for “{query.trim()}”
          </button>
        )}
        {list.length === 0 && !query && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No chats yet. Find a colleague under “Who's in”.</div>}
        {list.map((c) => {
          const group = c.kind === "group";
          const online = c.peer_status === "online";
          return (
            <button key={c.id} type="button" data-ph-chat={c.id} onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left active:bg-[var(--lanx-fill)]">
              <span className="relative shrink-0">
                <Avatar name={c.peer_name} color={c.peer_avatar_color} profile={group ? null : profiles[c.peer_id]} size={46} square={group} />
                {!group && <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-[#1c1e24] ${online ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600"}`} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14.5px] font-semibold text-slate-900 dark:text-white">{c.peer_name}</span>
                    {c.is_hidden && <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 text-[9.5px] font-bold uppercase text-violet-600 dark:text-violet-300" data-ph-chat-hidden>Hidden</span>}
                    {c.secret_ttl > 0 && <Timer className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-slate-400">{whenShort(c.last_message_time)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">{c.last_message_preview || (group ? `${c.member_count} members` : "Say hello")}</span>
                  {c.unread_count > 0 && (
                    <span className="min-w-[18px] shrink-0 rounded-full bg-sky-500 px-1.5 py-[2px] text-center text-[10px] font-bold text-white" data-ph-chat-unread>
                      {c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- people

export function PeopleScreen({ me, peers, profiles, onOpen, onInfo }: { me: Me | null; peers: Peer[]; profiles: Record<string, Profile>; onOpen: (peerId: string) => void; onInfo?: (peerId: string) => void }) {
  const rows = [
    ...(me ? [{ id: me.id, name: `${me.name} (you)`, color: me.color, online: true, profile: me.profile, mine: true }] : []),
    ...peers.filter((p) => p.trust_state !== "blocked").map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online", profile: profiles[p.id] ?? null, mine: false })),
  ].map((r) => ({ ...r, w: whereabouts(r.profile, r.online) }));
  const groups = [
    { key: "in", title: "In the office", of: rows.filter((r) => r.w.group === "in") },
    { key: "wfh", title: "Working from home", of: rows.filter((r) => r.w.group === "wfh") },
    { key: "away", title: "Away", of: rows.filter((r) => r.w.group === "away") },
    { key: "off", title: "Offline", of: rows.filter((r) => r.w.group === "off") },
  ];
  const working = rows.filter((r) => r.w.group === "in" || r.w.group === "wfh").length;
  return (
    <>
      <header className="shrink-0 px-4 py-3 lanx-bar border-b lanx-line">
        <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">Who's in</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          <b>{working}</b> of {rows.length} working right now · {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </header>
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-people>
        {groups.map((g) =>
          g.of.length === 0 ? null : (
            <div key={g.key} data-ph-people-group={g.key}>
              <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {g.title} · {g.of.length}
              </div>
              <div className="space-y-0.5">
                {g.of.map((r) => {
                  const line = statusLine(r.profile, { until: true });
                  return (
                    <div key={r.id} className="flex items-center gap-1">
                      <button type="button" data-ph-person={r.name} disabled={r.mine} onClick={() => onOpen(r.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-2 py-2 text-left active:bg-[var(--lanx-fill)]">
                        <Avatar name={r.name} color={r.color} profile={r.profile} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-white">{r.name}</span>
                          <span className="block truncate text-[11.5px]" style={{ color: r.w.color }}>
                            {r.w.emoji} {line ? line.text : r.w.label}
                          </span>
                        </span>
                      </button>
                      {!r.mine && onInfo && (
                        <button type="button" data-ph-person-info={r.name} onClick={() => onInfo(r.id)} className="lanx-tool p-2 text-slate-400" aria-label="Details">
                          <Info className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}

// -------------------------------------------------------------------- files

export function FilesScreen({
  transfers,
  progress,
  conversations,
  client,
  onAccept,
  onCancel,
  onRetry,
}: {
  transfers: PhoneTransfer[];
  progress: Record<string, Progress>;
  conversations: Conversation[];
  client: PhoneClient;
  onAccept: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const chatName = (t: PhoneTransfer) => conversations.find((c) => c.id === t.conversation_id)?.peer_name ?? t.peer_name ?? "";
  const list = [...transfers].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  const active = list.filter((t) => ["queued", "pending", "transferring"].includes(t.status));
  const done = list.filter((t) => t.status === "completed");
  const other = list.filter((t) => !active.includes(t) && !done.includes(t));
  const section = (title: string, of: PhoneTransfer[], hook: string) =>
    of.length === 0 ? null : (
      <div key={hook} data-ph-files-group={hook}>
        <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {title} · {of.length}
        </div>
        <div className="space-y-1">
          {of.map((t) => {
            const p = progress[t.id];
            const pct = p ? Math.round((p.transferred_bytes / Math.max(1, p.file_size)) * 100) : t.file_size > 0 ? Math.round((t.transferred_bytes / t.file_size) * 100) : 0;
            return (
              <div key={t.id} data-ph-file={t.id} data-ph-file-status={t.status} className="rounded-[14px] lanx-card px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <FileText className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{t.file_name}</div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {formatSize(t.file_size)} · {t.direction === "incoming" ? "from" : "to"} {chatName(t)} · {transferState(t, pct)}
                      {t.completed_at ? ` · ${whenShort(t.completed_at)}` : ""}
                    </div>
                  </div>
                  {t.ready && (
                    <a href={client.fileUrl(t.id)} download={t.file_name} className="lanx-tool p-1.5 text-sky-600" aria-label="Download" data-ph-file-download>
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                </div>
                {t.status === "transferring" && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {(t.status === "pending" && t.direction === "incoming") || t.status === "transferring" || t.status === "failed" ? (
                  <div className="mt-2 flex gap-2">
                    {t.status === "pending" && t.direction === "incoming" && (
                      <>
                        <button type="button" data-ph-file-accept onClick={() => onAccept(t.id)} className="rounded-full bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white">
                          Accept
                        </button>
                        <button type="button" data-ph-file-decline onClick={() => onCancel(t.id)} className="rounded-full lanx-group px-3 py-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                          Decline
                        </button>
                      </>
                    )}
                    {t.status === "transferring" && (
                      <button type="button" data-ph-file-cancel onClick={() => onCancel(t.id)} className="rounded-full lanx-group px-3 py-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                        Cancel
                      </button>
                    )}
                    {t.status === "failed" && (
                      <button type="button" data-ph-file-retry onClick={() => onRetry(t.id)} className="rounded-full bg-sky-500 px-3 py-1 text-[12px] font-semibold text-white">
                        Try again
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  return (
    <>
      <header className="shrink-0 px-4 py-3 lanx-bar border-b lanx-line">
        <div className="text-[18px] font-bold tracking-[-0.02em] text-slate-900 dark:text-white">Files</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">Everything sent and received on your PC</div>
      </header>
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-files>
        {list.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No files yet.</div>}
        {section("In progress", active, "active")}
        {section("Done", done, "done")}
        {section("Other", other, "other")}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- groups

function PeoplePicker({ peers, profiles, picked, onToggle, exclude }: { peers: Peer[]; profiles: Record<string, Profile>; picked: Set<string>; onToggle: (id: string) => void; exclude?: Set<string> }) {
  const list = peers.filter((p) => p.trust_state !== "blocked" && !exclude?.has(p.id));
  if (list.length === 0) return <div className="px-3 py-6 text-center text-[13px] text-slate-400">Nobody else to add.</div>;
  return (
    <div className="space-y-0.5">
      {list.map((p) => (
        <button key={p.id} type="button" data-ph-pick={p.display_name} aria-pressed={picked.has(p.id)} onClick={() => onToggle(p.id)} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left active:bg-[var(--lanx-fill)]">
          <Avatar name={p.display_name} color={p.avatar_color} profile={profiles[p.id]} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-white">{p.display_name}</span>
            <span className="block text-[11px] text-slate-400">{p.status === "online" ? "Online" : "Offline"}</span>
          </span>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full ${picked.has(p.id) ? "bg-sky-500 text-white" : "ring-1 ring-slate-300 dark:ring-slate-600"}`}>{picked.has(p.id) && <Check className="h-3.5 w-3.5" />}</span>
        </button>
      ))}
    </div>
  );
}

export function GroupCreateScreen({ peers, profiles, onBack, onCreate }: { peers: Peer[]; profiles: Record<string, Profile>; onBack: () => void; onCreate: (name: string, ids: string[]) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
        <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">New group</div>
        <button
          type="button"
          data-ph-group-create
          disabled={!name.trim() || picked.size === 0}
          onClick={() => onCreate(name.trim(), [...picked])}
          className="rounded-full bg-sky-500 px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
        >
          Create
        </button>
      </header>
      <div className="ph-scroll px-3 py-3" data-ph-screen-group-new>
        <input data-ph-group-name value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" className="mb-3 w-full rounded-xl lanx-field px-3.5 py-2.5 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:text-white" />
        <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Members · {picked.size}</div>
        <PeoplePicker peers={peers} profiles={profiles} picked={picked} onToggle={toggle} />
      </div>
    </>
  );
}

export function GroupInfoScreen({
  group,
  me,
  peers,
  profiles,
  onBack,
  onRename,
  onAdd,
  onRemove,
  onLeave,
}: {
  group: GroupInfo;
  me: Me | null;
  peers: Peer[];
  profiles: Record<string, Profile>;
  onBack: () => void;
  onRename: (name: string) => void;
  onAdd: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onLeave: () => void;
}) {
  const admin = group.admin_id === me?.id;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmLeave, setConfirmLeave] = useState(false);
  const inGroup = new Set(group.members.map((m) => m.device_id));
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
        <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">Group</div>
      </header>
      <div className="ph-scroll px-3 py-3 space-y-4" data-ph-screen-group-info>
        <div className="flex items-center gap-3 rounded-[14px] lanx-group p-3">
          <Avatar name={group.name} color={group.avatar_color} size={48} square />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input data-ph-group-rename value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-xl lanx-field px-3 py-1.5 text-[15px] text-slate-900 dark:text-white" />
                <button
                  type="button"
                  data-ph-group-rename-save
                  onClick={() => {
                    setRenaming(false);
                    if (name.trim() && name.trim() !== group.name) onRename(name.trim());
                  }}
                  className="rounded-full bg-sky-500 px-3 py-1.5 text-[12px] font-semibold text-white"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="truncate text-[16px] font-bold text-slate-900 dark:text-white" data-ph-group-title>
                {group.name}
              </div>
            )}
            <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
              {group.members.length} members · {group.membership === "member" ? (admin ? "you run this group" : "you are a member") : `you ${group.membership}`}
            </div>
          </div>
          {admin && !renaming && (
            <button type="button" onClick={() => setRenaming(true)} className="lanx-tool p-2 text-slate-500" aria-label="Rename" data-ph-group-rename-start>
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Members</span>
            {admin && group.membership === "member" && (
              <button type="button" data-ph-group-add onClick={() => setAdding((a) => !a)} className="flex items-center gap-1 text-[12px] font-semibold text-sky-600 dark:text-sky-400">
                <UserPlus className="h-3.5 w-3.5" /> Add
              </button>
            )}
          </div>
          {adding && (
            <div className="mb-3 rounded-[14px] lanx-group p-2">
              <PeoplePicker
                peers={peers}
                profiles={profiles}
                picked={picked}
                exclude={inGroup}
                onToggle={(id) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
              />
              <button
                type="button"
                data-ph-group-add-go
                disabled={picked.size === 0}
                onClick={() => {
                  onAdd([...picked]);
                  setPicked(new Set());
                  setAdding(false);
                }}
                className="mt-2 w-full rounded-full bg-sky-500 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
              >
                Add {picked.size || ""} to the group
              </button>
            </div>
          )}
          <div className="space-y-0.5">
            {group.members.map((m) => {
              const peer = peers.find((p) => p.id === m.device_id);
              return (
                <div key={m.device_id} data-ph-member={m.display_name} className="flex items-center gap-3 rounded-[14px] px-2 py-2">
                  <Avatar name={m.display_name} color={peer?.avatar_color ?? (m.is_me ? me?.color ?? "#0ea5e9" : "#64748b")} profile={m.is_me ? me?.profile : profiles[m.device_id]} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-white">
                      {m.display_name}
                      {m.is_me ? " (you)" : ""}
                    </span>
                    <span className="block text-[11px] text-slate-400">{m.is_admin ? "Runs the group" : m.status === "online" ? "Online" : "Offline"}</span>
                  </span>
                  {admin && !m.is_me && (
                    <button type="button" data-ph-member-remove={m.display_name} onClick={() => onRemove(m.device_id)} className="lanx-tool p-1.5 text-rose-500" aria-label="Remove">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {group.membership === "member" &&
          (confirmLeave ? (
            <div className="flex items-center gap-2 rounded-[14px] lanx-group p-3 text-[13px]">
              <span className="flex-1 text-slate-700 dark:text-slate-200">Leave this group?</span>
              <button type="button" data-ph-group-leave-yes onClick={onLeave} className="rounded-full bg-rose-500 px-3 py-1.5 text-[12px] font-semibold text-white">
                Leave
              </button>
              <button type="button" onClick={() => setConfirmLeave(false)} className="rounded-full lanx-card px-3 py-1.5 text-[12px] font-semibold">
                No
              </button>
            </div>
          ) : (
            <button type="button" data-ph-group-leave onClick={() => setConfirmLeave(true)} className="flex w-full items-center gap-2 rounded-[14px] lanx-group px-3 py-2.5 text-[13.5px] font-semibold text-rose-600 dark:text-rose-400">
              <LogOut className="h-4 w-4" /> Leave group
            </button>
          ))}
      </div>
    </>
  );
}

// ------------------------------------------------------ search and starred

export function HitsScreen({ title, hits, loading, onBack, onOpen }: { title: string; hits: Hit[]; loading: boolean; onBack: () => void; onOpen: (conv: string, messageId: string) => void }) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-2 py-2 lanx-bar border-b lanx-line">
        <button type="button" data-ph-back onClick={onBack} className="lanx-tool p-2 text-sky-600 dark:text-sky-400" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">{title}</div>
      </header>
      <div className="ph-scroll px-3 py-2" data-ph-hits={hits.length}>
        {loading && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Looking…</div>}
        {!loading && hits.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-slate-400">Nothing found.</div>}
        {hits.map((h) => (
          <button key={h.message.id} type="button" data-ph-hit={h.message.id} onClick={() => onOpen(h.message.conversation_id, h.message.id)} className="flex w-full items-start gap-3 rounded-[14px] px-2 py-2 text-left active:bg-[var(--lanx-fill)]">
            <Avatar name={h.peer_name} color={h.peer_avatar_color} size={38} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{h.peer_name}</span>
                <span className="shrink-0 text-[10.5px] text-slate-400">{whenShort(h.message.timestamp)}</span>
              </span>
              <span className="line-clamp-2 text-[12.5px] text-slate-600 dark:text-slate-300">{h.message.message_type === "file" ? fileName(h.message) : h.message.content}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ forward

export function ForwardPicker({
  conversations,
  profiles,
  title = "Forward to…",
  single = false,
  onClose,
  onPick,
}: {
  conversations: Conversation[];
  profiles: Record<string, Profile>;
  title?: string;
  /** One chat only (picking one finishes). */
  single?: boolean;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return (
    <Sheet title={title} onClose={onClose} hook="forward">
      <div className="max-h-[50dvh] space-y-0.5 overflow-y-auto">
        {conversations
          .filter((c) => !c.archived && (c.kind !== "group" || c.membership === "member"))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              data-ph-forward-to={c.id}
              aria-pressed={picked.has(c.id)}
              onClick={() => {
                if (single) {
                  onPick([c.id]);
                  return;
                }
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                });
              }}
              className="flex w-full items-center gap-3 rounded-[14px] px-2 py-1.5 text-left active:bg-[var(--lanx-fill)]"
            >
              <Avatar name={c.peer_name} color={c.peer_avatar_color} profile={c.kind === "group" ? null : profiles[c.peer_id]} size={36} square={c.kind === "group"} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900 dark:text-white">{c.peer_name}</span>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full ${picked.has(c.id) ? "bg-sky-500 text-white" : "ring-1 ring-slate-300 dark:ring-slate-600"}`}>{picked.has(c.id) && <Check className="h-3.5 w-3.5" />}</span>
            </button>
          ))}
      </div>
      {!single && (
        <button type="button" data-ph-forward-go disabled={picked.size === 0} onClick={() => onPick([...picked])} className="mt-3 w-full rounded-full bg-sky-500 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
          Forward to {picked.size || ""} chat{picked.size === 1 ? "" : "s"}
        </button>
      )}
    </Sheet>
  );
}

// -------------------------------------------------------------------- about

export function AboutSheet({ me, device, version, lock, onLockPc, onClose, onForget }: { me: Me; device: string; version: string; lock?: LockInfo | null; onLockPc?: () => void; onClose: () => void; onForget: () => void }) {
  return (
    <Sheet title="This phone" onClose={onClose} hook="about">
      <div className="space-y-2 rounded-xl lanx-group p-3 text-[12.5px] text-slate-700 dark:text-slate-200" data-ph-about-sheet>
        <div>
          Connected to <b>{me.name}</b>'s LANX on <b>{me.hostname || "the PC"}</b>.
        </div>
        <div>
          Your PC calls this phone <b>{device || "your phone"}</b>. LANX {version}.
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
        <b>Tip:</b> add this page to your Home Screen (Share → Add to Home Screen) to open it like an app. A Home Screen copy asks for the code once more; the PC asks “Allow?” again.
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">New messages show while this page is open. When your PC is off, or you leave the office Wi-Fi, the page waits.</p>
      {lock?.pin_set && onLockPc && (
        <button type="button" data-ph-lock-pc onClick={onLockPc} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full lanx-btn py-2.5 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
          <Lock className="h-4 w-4" /> Lock LANX on my PC
        </button>
      )}
      <button type="button" data-ph-forget onClick={onForget} className="mt-4 w-full rounded-full lanx-btn py-2.5 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">
        Disconnect this phone
      </button>
      <p className="mt-2 text-center text-[10.5px] text-slate-400">To remove it from the PC too: Settings → Phone there.</p>
    </Sheet>
  );
}

