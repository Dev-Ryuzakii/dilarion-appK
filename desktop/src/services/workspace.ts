// Client for the workspace endpoints: reminders, roles/permissions,
// whiteboards and the AI page (conversations + agents).
import { apiFetch } from './apiTransport';
import { userMessage } from './errors';

const BASE = import.meta.env.VITE_API_BASE || 'https://apidilarion.eibstratoc.com';

/** A refusal the server explained (permission, validation). Safe to show as-is. */
class WorkspaceError extends Error {}

/** Message for the UI: the server's own explanation when there is one. */
export function errText(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof WorkspaceError) return e.message;
  return userMessage(e, fallback);
}

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(`${BASE}${path}`, {
    method,
    // X-Timezone lets the AI read times like "4pm" in the user's own zone.
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Timezone': localZone() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
    if (res.status >= 500) throw Object.assign(new Error(`server ${res.status}`), { status: res.status });
    let detail = 'That did not work. Please try again.';
    try { const b = await res.json(); if (typeof b.detail === 'string') detail = b.detail; } catch { /* no body */ }
    throw new WorkspaceError(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Reminders ────────────────────────────────────────────────────────────────

export type Recurrence = null | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface Reminder {
  id: number;
  title: string;
  note: string | null;
  remind_at: string;
  recurrence: Recurrence;
  status: 'scheduled' | 'fired' | 'dismissed' | 'done';
  source: 'user' | 'ai_agent';
  created_by_id: number | null;
  user_id: number;
  snooze_count: number;
  fired_at: string | null;
}

export const listReminders = (token: string, status?: string) =>
  call<{ reminders: Reminder[] }>(token, 'GET', `/reminders${status ? `?status=${encodeURIComponent(status)}` : ''}`).then(r => r.reminders);
export const createReminder = (token: string, body: { title: string; remind_at: string; note?: string | null; recurrence?: Recurrence }) =>
  call<Reminder>(token, 'POST', '/reminders', body);
export const updateReminder = (token: string, id: number, body: { title?: string; remind_at?: string; note?: string; recurrence?: Recurrence; clear_recurrence?: boolean }) =>
  call<Reminder>(token, 'PATCH', `/reminders/${id}`, body);
export const snoozeReminder = (token: string, id: number, minutes: number) =>
  call<Reminder>(token, 'POST', `/reminders/${id}/snooze`, { minutes });
export const completeReminder = (token: string, id: number) => call<Reminder>(token, 'POST', `/reminders/${id}/done`);
export const dismissReminder = (token: string, id: number) => call<Reminder>(token, 'POST', `/reminders/${id}/dismiss`);
export const deleteReminder = (token: string, id: number) => call<void>(token, 'DELETE', `/reminders/${id}`);

// ── Whiteboards ──────────────────────────────────────────────────────────────

export type ElementType = 'sticky' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'pen' | 'arrow' | 'line'
  | 'connector' | 'frame' | 'image' | 'task' | 'mindmap' | 'comment';

export interface BoardElement {
  id: string;
  type: ElementType;
  x: number; y: number; w?: number; h?: number;
  x2?: number; y2?: number;
  points?: number[];          // pen: flat [x0,y0,x1,y1,...]
  text?: string;
  color?: string;
  stroke?: string;
  done?: boolean;             // task cards
  updated_by?: number;
  [k: string]: unknown;
}

export interface BoardSummary {
  id: number; scope: 'org' | 'group'; group_id: number | null; group_name?: string | null;
  title: string; version: number; locked: boolean; archived: boolean; element_count: number;
  favorite: boolean; updated_at: string | null; created_by_id: number | null;
}
export interface Board extends BoardSummary {
  elements: BoardElement[];
  viewport: { x: number; y: number; zoom: number } | null;
  can_edit: boolean;
}
export type BoardOp = { op: 'upsert'; id: string; element: Partial<BoardElement> } | { op: 'delete'; id: string };

export interface BoardList {
  org: BoardSummary | null;
  groups: BoardSummary[];
  organization_id: number;
  /** Only for Dilarion admins: every organization, for the switcher. */
  organizations: { id: number; name: string }[] | null;
}
export const listBoards = (token: string, orgId?: number | null) =>
  call<BoardList>(token, 'GET', `/whiteboards${orgId ? `?org_id=${orgId}` : ''}`);
export const getBoard = (token: string, id: number) => call<Board>(token, 'GET', `/whiteboards/${id}`);
export const createGroupBoard = (token: string, groupId: number, title: string) =>
  call<Board>(token, 'POST', `/groups/${groupId}/whiteboards`, { title });
export const updateBoard = (token: string, id: number, body: { title?: string; locked?: boolean; archived?: boolean; viewport?: Record<string, number> }) =>
  call<BoardSummary>(token, 'PATCH', `/whiteboards/${id}`, body);
export const deleteBoard = (token: string, id: number) => call<void>(token, 'DELETE', `/whiteboards/${id}`);
export const sendBoardOps = (token: string, id: number, ops: BoardOp[], baseVersion?: number) =>
  call<{ version: number; applied: BoardOp[]; stale: boolean }>(token, 'POST', `/whiteboards/${id}/ops`, { ops, base_version: baseVersion });
export const favoriteBoard = (token: string, id: number, favorite: boolean) =>
  call<unknown>(token, 'PUT', `/whiteboards/${id}/favorite?favorite=${favorite}`);
export const sendBoardCursor = (token: string, id: number, x: number, y: number) =>
  call<unknown>(token, 'POST', `/whiteboards/${id}/cursor?x=${x.toFixed(1)}&y=${y.toFixed(1)}`);

// ── AI page ──────────────────────────────────────────────────────────────────

export interface AiStep { tool: string; args: Record<string, unknown>; why?: string; status?: 'done' | 'failed'; result?: unknown; error?: string }
export interface AgentRun {
  id: number; title: string | null; instruction: string;
  status: 'planning' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled';
  for_user_id: number | null; conversation_id: number | null; require_approval: boolean;
  plan: AiStep[]; steps: AiStep[]; summary: string | null; error: string | null;
  created_at: string | null; finished_at: string | null;
}
export interface AiMessage { id: number; role: 'user' | 'assistant'; content: string; agent_run_id: number | null; created_at: string | null }
export interface AiConversation { id: number; title: string; updated_at?: string | null; messages?: AiMessage[] }

export const listConversations = (token: string) =>
  call<{ conversations: AiConversation[] }>(token, 'GET', '/ai/conversations').then(r => r.conversations);
export const createConversation = (token: string, title?: string) => call<AiConversation>(token, 'POST', '/ai/conversations', { title });
export const getConversation = (token: string, id: number) => call<AiConversation>(token, 'GET', `/ai/conversations/${id}`);
export const deleteConversation = (token: string, id: number) => call<void>(token, 'DELETE', `/ai/conversations/${id}`);
export const sendAiMessage = (token: string, id: number, text: string) =>
  call<{ user_message: AiMessage; assistant_message: AiMessage; agent_run: AgentRun | null; title: string }>(
    token, 'POST', `/ai/conversations/${id}/messages`, { text });

export interface AiPreferences {
  /** Full control: agents run their plans without asking first. */
  auto_approve: boolean;
  /** Other members' agents may set reminders / assign tasks to me. */
  allow_from_others: boolean;
  /** Tools agents may not use for me. */
  disabled_tools: string[];
  timezone: string;
  tools: { id: string; label: string }[];
}
const DEFAULT_AI_TOOLS = [
  { id: 'create_reminder', label: 'Set reminders' },
  { id: 'create_task', label: 'Create and assign tasks' },
  { id: 'add_whiteboard_note', label: 'Add whiteboard notes' },
  { id: 'draft_meeting', label: 'Draft meetings' },
  { id: 'find_people', label: 'Find people' },
];
/** Older servers return only auto_approve; fill in the rest. */
function withPrefDefaults(p: Partial<AiPreferences>): AiPreferences {
  return {
    auto_approve: !!p.auto_approve,
    allow_from_others: p.allow_from_others ?? true,
    disabled_tools: p.disabled_tools ?? [],
    timezone: p.timezone ?? localZone(),
    tools: p.tools?.length ? p.tools : DEFAULT_AI_TOOLS,
  };
}
export const getAiPreferences = (token: string) =>
  call<Partial<AiPreferences>>(token, 'GET', '/ai/preferences').then(withPrefDefaults);
export const updateAiPreferences = (token: string, patch: Partial<Pick<AiPreferences, 'auto_approve' | 'allow_from_others' | 'disabled_tools' | 'timezone'>>) =>
  call<Partial<AiPreferences>>(token, 'PUT', '/ai/preferences', patch).then(withPrefDefaults);
export const setAiPreferences = (token: string, autoApprove: boolean) => updateAiPreferences(token, { auto_approve: autoApprove });
export const clearAiConversations = (token: string) => call<void>(token, 'DELETE', '/ai/conversations');
export const listAgentRuns = (token: string) => call<{ runs: AgentRun[] }>(token, 'GET', '/ai/agents').then(r => r.runs);
export const startAgent = (token: string, instruction: string, requireApproval = true, forUserId?: number) =>
  call<AgentRun>(token, 'POST', '/ai/agents', { instruction, require_approval: requireApproval, for_user_id: forUserId });
export const getAgentRun = (token: string, id: number) => call<AgentRun>(token, 'GET', `/ai/agents/${id}`);
export const editAgentPlan = (token: string, id: number, plan: AiStep[]) => call<AgentRun>(token, 'PUT', `/ai/agents/${id}/plan`, { plan });
export const approveAgent = (token: string, id: number) => call<AgentRun>(token, 'POST', `/ai/agents/${id}/approve`);
export const cancelAgent = (token: string, id: number) => call<AgentRun>(token, 'POST', `/ai/agents/${id}/cancel`);
