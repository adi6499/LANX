export interface UserSettings {
  device_id: string;
  display_name: string;
  hostname: string;
  avatar_color: string;
  theme: "system" | "dark" | "light";
  udp_discovery_port: number;
  tcp_messaging_port: number;
  discovery_interval_secs: number;
  notifications_enabled: boolean;
  /** Auto-accept files from peers marked as trusted. */
  auto_download_transfers: boolean;
  default_download_dir: string;
  onboarding_completed: boolean;
  launch_at_startup: boolean;
  close_to_tray: boolean;
  /** Send "Seen" receipts and show "typing…". */
  read_receipts: boolean;
  /** Download images under 10 MB without asking. */
  auto_download_images: boolean;
  /** Minutes before LANX locks itself (0 = never). Needs a PIN. */
  auto_lock_minutes: number;
  /** Read-only: a PIN is set. */
  pin_enabled: boolean;
  sound_enabled: boolean;
  sound_choice: string;
  custom_sound_path: string;
  sound_volume: number;
  /** Window background: "default", a preset id or "#rrggbb" (see lib/background.ts). */
  chat_background: string;
  /** Accent colour: "default", a preset id or "#rrggbb" (see lib/background.ts). */
  accent_color: string;
  /** How see-through the glass panels are: 0 (solid) – 100 (clear). */
  glass_level: number;
  /** How frosted (blurred) the glass is: 0 (clear) – 100 (heavy frost). */
  frost_level: number;
  /** Animations off (for slower computers). */
  reduce_motion: boolean;
  /** The cartoon cat that asks you to accept incoming files. */
  cat_alerts: boolean;
  /** LANX 1.5.0: ready-made answers ("/" in the message box). */
  quick_replies: string[];
  /** LANX 1.7.0 */
  quiet_hours?: QuietHours;
  chat_folders?: ChatFolder[];
  /** "Send to → LANX" in Explorer's right-click menu. */
  send_to_menu?: boolean;
  /** Ctrl + Alt + S takes a screenshot anywhere. */
  screenshot_hotkey?: boolean;
  /** LANX 1.2.9: avatar, status and "about me" (what colleagues see). */
  profile: Profile;
}

/** LANX 1.2.9: what colleagues see besides the name and colour. */
export interface Profile {
  /** "initials", "emoji:<character>" or "photo". */
  avatar: string;
  /** data:image/...;base64 when avatar is "photo". */
  photo: string;
  /** "" | "available" | "busy" | "meeting" | "lunch" | "wfh" | "road" | "leave" | "dnd" */
  status: string;
  status_text: string;
  /** Unix seconds when the status clears itself (0 = never). */
  status_until: number;
  title: string;
  department: string;
  phone: string;
  email: string;
  bio: string;
}

export type TrustState = "unverified" | "trusted" | "blocked";

export interface Peer {
  id: string;
  display_name: string;
  hostname: string;
  last_ip: string;
  tcp_port: number;
  public_key?: string | null;
  trust_state: TrustState;
  status: "online" | "offline";
  last_seen: number;
  avatar_color: string;
}

export interface Conversation {
  id: string;
  /** Empty for group chats. */
  peer_id: string;
  /** Contact name, or the group name. */
  peer_name: string;
  peer_status: "online" | "offline";
  peer_avatar_color: string;
  peer_ip: string;
  last_message_preview?: string | null;
  last_message_time: number;
  unread_count: number;
  is_pinned: boolean;
  created_at: number;
  kind: "direct" | "group";
  is_hidden: boolean;
  /** Secret messages: seconds after reading before they disappear (0 = off). */
  secret_ttl: number;
  member_count: number;
  /** Groups: "member" | "left" | "removed". */
  membership: string;
  /** LANX 1.7.0: muted until (unix seconds); -1 = always; 0 = not muted. */
  muted_until?: number;
  /** LANX 1.7.0: moved out of the main chat list. */
  archived?: boolean;
  /** LANX 1.7.0: the chat folders it is in (folder ids). */
  folders?: string[];
}

/** LANX 1.7.0: a folder in the chat list. */
export interface ChatFolder {
  id: string;
  name: string;
}

/** LANX 1.7.0: hours without sounds or pop-ups. */
export interface QuietHours {
  enabled: boolean;
  /** Minutes after midnight. */
  start: number;
  end: number;
  /** 0 = Sunday … 6 = Saturday (the day the quiet time starts). */
  days: number[];
}

/** LANX 1.7.0: search filters. */
export interface SearchFilter {
  conversation_id?: string | null;
  /** A colleague's device id, or "me". */
  sender?: string | null;
  kind?: "all" | "text" | "files" | "links" | "cards";
  since?: number | null;
}

export interface Sticker {
  id: string;
  emoji: string;
  words: string;
}

/** LANX 1.7.0: a folder you share (colleagues' copies stay up to date). */
export interface SyncShare {
  id: string;
  name: string;
  path: string;
  conversation_id: string;
  created_at: number;
  active: boolean;
  subscribers: string[];
  /** Files still waiting to go out. */
  waiting: number;
}

/** LANX 1.7.0: a colleague's folder you get. */
export interface SyncSubscription {
  share_id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  dest_path: string;
  conversation_id: string;
  since: number;
  files: number;
  bytes: number;
  last_at: number;
  status: "active" | "stopped";
}

export interface SyncOverview {
  shares: SyncShare[];
  subscriptions: SyncSubscription[];
}

export interface ToolsStatus {
  hotkey: string;
  hotkey_working: boolean;
}

export type MessageStatus = "sending" | "queued" | "delivered" | "failed" | "read";

export interface DeliverySummary {
  total: number;
  delivered: number;
  read: number;
  queued: number;
  failed: number;
  read_by: string[];
  waiting_for: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: "text" | "file" | "system" | "secret_setting" | "ring" | "call" | "meeting" | "recording" | "card" | "sticker";
  /** LANX 1.6.0 cards: votes, ticks, decisions… */
  card_state?: CardEntry[];
  // ---- LANX 1.5.0
  /** The message this one answers. */
  reply_to?: string | null;
  /** "Asha: the text…" of that message. */
  reply_preview?: string | null;
  /** Device ids @mentioned (group chats). */
  mentions?: string[];
  edited_at?: number | null;
  /** Deleted for everyone. */
  deleted?: boolean;
  pinned_at?: number | null;
  pinned_by?: string | null;
  /** Starred on this computer. */
  starred?: boolean;
  reactions?: Reaction[];
  /** "Remind me" time set on this computer. */
  remind_at?: number | null;
  timestamp: number;
  status: MessageStatus;
  error_reason?: string | null;
  is_outgoing: boolean;
  transfer_id?: string | null;
  ttl_secs?: number | null;
  expire_at?: number | null;
  deliveries?: DeliverySummary | null;
}

export type TransferStatus =
  | "queued"
  | "pending"
  | "transferring"
  | "completed"
  | "declined"
  | "cancelled"
  | "failed";

export interface TransferRecord {
  id: string;
  peer_id: string;
  peer_name?: string | null;
  conversation_id?: string | null;
  file_name: string;
  file_size: number;
  file_hash: string;
  direction: "incoming" | "outgoing";
  status: TransferStatus;
  transferred_bytes: number;
  local_path?: string | null;
  error_reason?: string | null;
  created_at: number;
  completed_at?: number | null;
  /** Group files: shared key of the per-member copies. */
  parent_id?: string | null;
  /** "file" | "folder" (LANX 1.2.3, sent as a zip) | "update". */
  kind?: string;
  /** LANX 1.2.7: how long the transfer took (last run, if it was resumed). */
  duration_ms?: number | null;
  /** LANX 1.2.7: bytes already there when that run started. */
  started_bytes?: number | null;
}

export interface TransferProgress {
  transferred_bytes: number;
  file_size: number;
  bytes_per_sec: number;
}

export interface SentFile {
  transfers: TransferRecord[];
  message: Message;
}

export interface SearchHit {
  message: Message;
  peer_name: string;
  peer_avatar_color: string;
}

export interface GroupMember {
  device_id: string;
  display_name: string;
  public_key?: string | null;
  status: "online" | "offline";
  is_admin: boolean;
  is_me: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  admin_id: string;
  version: number;
  avatar_color: string;
  membership: string;
  created_at: number;
  members: GroupMember[];
}

export interface LockStatus {
  pin_set: boolean;
  locked: boolean;
  hidden_unlocked: boolean;
  retry_after_secs: number;
}

export interface BroadcastResult {
  sent_to: number;
  problems: string[];
}

export interface SystemInfo {
  device_id: string;
  hostname: string;
  local_ips: string[];
  database_path: string;
  database_size_bytes: number;
  os: string;
  app_version: string;
  fingerprint: string;
  tcp_listening: boolean;
  udp_listening: boolean;
}

export interface ConnectionTestResult {
  reachable: boolean;
  ip: string;
  port: number;
  latency_ms?: number | null;
  message: string;
}

/** A newer LANX this PC can install ("Share LANX update"). */
export interface AvailableUpdate {
  version: string;
  state: "available" | "downloading" | "ready" | "failed" | "installing";
  /** Colleague offering it; empty when it is the installer this PC shares. */
  from_name: string;
  from_online: boolean;
  file_size: number;
  transfer_id?: string | null;
  transferred_bytes: number;
  error?: string | null;
}

/** The official installer this PC passes on to colleagues. */
export interface SharedInstaller {
  path: string;
  file_name: string;
  version: string;
  sha256: string;
  size: number;
}

export type ColleagueUpdateState =
  | "up_to_date"
  | "behind"
  | "unknown"
  | "old_version"
  | "chat_sent"
  | "waiting"
  | "offered"
  | "downloading"
  | "received"
  | "failed"
  | "declined"
  | "not_offered";

export interface ColleagueUpdate {
  peer_id: string;
  display_name: string;
  online: boolean;
  app_version?: string | null;
  /** Their LANX is older than the newest one on the network. */
  behind: boolean;
  state: ColleagueUpdateState;
  detail?: string | null;
}

export interface UpdateStatus {
  current_version: string;
  /** Newest LANX seen on the network. */
  latest_version: string;
  available?: AvailableUpdate | null;
  sharing?: SharedInstaller | null;
  colleagues: ColleagueUpdate[];
  /** "Remind me tomorrow": the banner is hidden until then (unix seconds). */
  snoozed_until?: number | null;
  /** Send the shared installer once as a chat file to colleagues on LANX 1.1. */
  auto_chat: boolean;
}

export type NavTab = "messages" | "people" | "transfers" | "history";

/** Actions on a file transfer, shared by the chat bubbles and the Files tab. */
export interface TransferActions {
  accept: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  open: (id: string) => void;
  reveal: (id: string) => void;
}

export const SECRET_TIMERS: { secs: number; label: string }[] = [
  { secs: 30, label: "30 seconds" },
  { secs: 300, label: "5 minutes" },
  { secs: 3600, label: "1 hour" },
  { secs: 86400, label: "1 day" },
  { secs: 604800, label: "1 week" },
];

export function secretLabel(secs: number): string {
  return SECRET_TIMERS.find((t) => t.secs === secs)?.label ?? `${secs} seconds`;
}

// ------------------------------------------------------------------ backups
export interface BackupInfo {
  file_name: string;
  path: string;
  /** auto | manual | before-restore | imported | file */
  kind: string;
  created_at: number;
  size_bytes: number;
  conversations: number;
  messages: number;
  display_name: string;
  app_version: string;
}

export interface BackupOverview {
  auto_enabled: boolean;
  folder: string;
  backups: BackupInfo[];
}

export interface PickedBackup {
  path: string;
  encrypted: boolean;
  info: BackupInfo | null;
}

export interface RestoreNotice {
  ok: boolean;
  text: string;
}

// -------------------------------------------------------------------- calls
export interface SpeedTestResult {
  /** MB/s over one connection. */
  single_mbps: number;
  /** MB/s over several connections at once. */
  multi_mbps: number;
  connections: number;
}

export interface CallInfo {
  call_id: string;
  conversation_id: string;
  peer_id: string;
  peer_name: string;
  avatar_color: string;
  video: boolean;
  outgoing: boolean;
  phase: "ringing" | "active";
  started_at: number;
  answered_at: number | null;
  /** Hidden chat or LANX locked: don't show the name. */
  private: boolean;
}

export interface CallEvent {
  action: "incoming" | "accepted" | "media" | "ended";
  call: CallInfo;
  sdp: string | null;
  video: boolean | null;
  muted: boolean | null;
  screen: boolean | null;
  reason: string | null;
  /** LANX 1.4.0: the other side started / stopped recording. */
  recording?: boolean | null;
}

/** LANX 1.6.0: one entry of a card's state ("vote:<id>" → [1]). */
export interface CardEntry {
  key: string;
  peer_id: string;
  name: string;
  value: unknown;
  at: number;
}

/** LANX 1.5.0: an emoji under a message. */
export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

/** LANX 1.5.0: a message waiting to be sent later. */
export interface ScheduledMessage {
  id: string;
  conversation_id: string;
  content: string;
  reply_to: string | null;
  mentions: string[];
  send_at: number;
  created_at: number;
}

/** LANX 1.4.0: someone in a meeting. */
export interface MeetingPerson {
  device_id: string;
  name: string;
  avatar_color: string;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  hand: boolean;
  recording: boolean;
  is_me: boolean;
}

/** A meeting chat line (`from` is empty for LANX's notes: "Bharat joined"). */
export interface MeetingChatLine {
  from: string;
  name: string;
  text: string;
  at: number;
}

export interface MeetingInfo {
  meeting_id: string;
  title: string;
  conversation_id: string;
  group_id: string | null;
  host_id: string;
  host_name: string;
  inviter_id: string;
  inviter_name: string;
  inviter_color: string;
  video: boolean;
  phase: "invited" | "joined";
  started_at: number;
  joined_at: number | null;
  people: MeetingPerson[];
  chat: MeetingChatLine[];
  /** Hidden chat or LANX locked: the invitation shows no names. */
  private: boolean;
  my_id: string;
}

export interface MeetingEvent {
  action: "invited" | "joined" | "person-joined" | "person-left" | "signal" | "media" | "chat" | "declined" | "notice" | "ended";
  meeting: MeetingInfo | null;
  from: string | null;
  person: MeetingPerson | null;
  kind: "offer" | "answer" | null;
  sdp: string | null;
  text: string | null;
  reason: string | null;
}
