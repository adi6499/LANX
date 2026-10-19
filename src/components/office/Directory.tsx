import { useMemo, useState } from "react";
import { Cake, Mail, MessageSquare, Phone, Search } from "lucide-react";
import type { Peer, Profile, UserSettings } from "../../types";
import { Avatar } from "../Avatar";
import { effective, statusLine } from "../../lib/profile";
import { birthdayInfo } from "../../lib/office";
import { stagger } from "../../lib/motion";

/** LANX 1.8.0: the staff directory — everyone on the network with their job,
 *  department, phone, email and birthday, grouped by department. */
export function Directory({
  settings,
  peers,
  profiles,
  modeSwitch,
  onStartChat,
}: {
  settings: UserSettings;
  peers: Peer[];
  profiles: Record<string, Profile>;
  modeSwitch: React.ReactNode;
  onStartChat: (peerId: string) => void;
}) {
  const [q, setQ] = useState("");
  const people = useMemo(() => {
    const me = { id: "me", name: `${settings.display_name} (you)`, color: settings.avatar_color, online: true, profile: settings.profile };
    const list = [
      me,
      ...peers.filter((p) => p.trust_state !== "blocked").map((p) => ({ id: p.id, name: p.display_name, color: p.avatar_color, online: p.status === "online", profile: profiles[p.id] })),
    ];
    const needle = q.trim().toLowerCase();
    return list.filter((x) =>
      !needle ||
      [x.name, x.profile?.title, x.profile?.department, x.profile?.phone, x.profile?.email].some((v) => (v ?? "").toLowerCase().includes(needle))
    );
  }, [settings, peers, profiles, q]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof people>();
    for (const p of people) {
      const d = p.profile?.department?.trim() || "Other";
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])));
  }, [people]);

  return (
    <div data-directory className="flex-1 h-full flex flex-col overflow-hidden select-none lanx-screen-in">
      <div className="h-16 px-8 border-b lanx-line lanx-bar flex items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Directory</h2>
          {modeSwitch}
        </div>
        <div className="relative w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            data-directory-search
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, job, department, phone…"
            className="w-full rounded-xl lanx-field pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white select-text"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-6">
        <p className="text-[11.5px] text-slate-400">Everyone fills in their own details in Settings → Profile (job title, department, phone, email, birthday).</p>
        {groups.map(([dept, list]) => (
          <section key={dept}>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {dept} <span className="font-normal">· {list.length}</span>
            </h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {list.map((p, i) => {
                const prof = p.profile;
                const line = statusLine(effective(prof));
                const bday = birthdayInfo(prof?.birthday);
                return (
                  <div key={p.id} data-directory-person={p.id} style={stagger(i, 20)} className="rounded-2xl lanx-card p-3.5 lanx-item-in flex gap-3">
                    <Avatar name={p.name} color={p.color} profile={prof ?? null} size={44} showStatus />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{p.name}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${p.online ? "bg-emerald-500" : "bg-slate-400"}`} title={p.online ? "Online" : "Offline"} />
                      </div>
                      {prof?.title && <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">{prof.title}</div>}
                      {line && (
                        <div className="text-[11px] truncate" style={{ color: line.color }}>
                          {line.emoji} {line.text}
                        </div>
                      )}
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                        {prof?.phone && (
                          <div className="flex items-center gap-1.5 truncate select-text">
                            <Phone className="h-3 w-3 shrink-0 text-slate-400" /> {prof.phone}
                          </div>
                        )}
                        {prof?.email && (
                          <div className="flex items-center gap-1.5 truncate select-text">
                            <Mail className="h-3 w-3 shrink-0 text-slate-400" /> {prof.email}
                          </div>
                        )}
                        {bday && (
                          <div className="flex items-center gap-1.5">
                            <Cake className="h-3 w-3 shrink-0 text-pink-400" /> {bday.label}
                            {bday.days === 0 && <span className="font-semibold text-pink-600">— today! 🎉</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    {p.id !== "me" && (
                      <button type="button" title="Chat" onClick={() => onStartChat(p.id)} className="self-start lanx-tool p-1.5 text-sky-600">
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
