// Settings → Dilarion AI: full control, what agents may do, colleagues' agents,
// time zone and chat history. Full control is also on the AI page.
import { useEffect, useState } from 'react';
import { AiPreferences, clearAiConversations, errText, getAiPreferences, updateAiPreferences } from '../services/workspace';
import { Switch } from './AiPage';

const card: React.CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14,
};
const cardTitle: React.CSSProperties = { fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' };
const rowTitle: React.CSSProperties = { fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 600 };
const rowHint: React.CSSProperties = { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 };

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <span><span style={rowTitle}>{title}</span><span style={rowHint}>{hint}</span></span>
      {children}
    </div>
  );
}

export default function AiSettingsSection({ token }: { token: string }) {
  const [prefs, setPrefs] = useState<AiPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getAiPreferences(token).then(setPrefs).catch(e => setError(errText(e))); }, [token]);

  async function save(patch: Parameters<typeof updateAiPreferences>[1]) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...patch } as AiPreferences);
    setError(null);
    try { setPrefs(await updateAiPreferences(token, patch)); }
    catch (e) { setPrefs(before); setError(errText(e)); }
  }

  function toggleTool(id: string, allowed: boolean) {
    if (!prefs) return;
    const off = new Set(prefs.disabled_tools);
    if (allowed) off.delete(id); else off.add(id);
    save({ disabled_tools: [...off] });
  }

  async function clearHistory() {
    setBusy(true);
    try { await clearAiConversations(token); setCleared(true); setConfirmClear(false); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  }

  if (!prefs) {
    return <div style={card}><div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error ?? 'Loading AI settings…'}</div></div>;
  }

  return (<>
    {error && <div style={{ color: 'var(--danger, #ef4444)', fontSize: '0.82rem' }}>{error}</div>}

    <div style={card}>
      <div style={cardTitle}>Agents</div>
      <Row title="Full control" hint="Agents run their plans without asking you first. Off: you approve every plan in a pop-up.">
        <Switch on={prefs.auto_approve} onChange={v => save({ auto_approve: v })} />
      </Row>
    </div>

    <div style={card}>
      <div style={cardTitle}>Security & permissions</div>
      <Row title="Let colleagues' agents act for me" hint="Other members' agents can set reminders and assign tasks to you. Off: their agents are refused.">
        <Switch on={prefs.allow_from_others} onChange={v => save({ allow_from_others: v })} />
      </Row>
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
        <span style={rowTitle}>What agents may do for you</span>
        <span style={rowHint}>Turned-off actions are left out of plans and refused if someone's agent tries them. Your organization role still applies.</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {prefs.tools.map(t => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
              <span style={{ fontSize: '0.84rem', color: 'var(--text-primary)' }}>{t.label}</span>
              <Switch on={!prefs.disabled_tools.includes(t.id)} onChange={v => toggleTool(t.id, v)} />
            </label>
          ))}
        </div>
      </div>
    </div>

    <div style={card}>
      <div style={cardTitle}>Time zone</div>
      <Row title={prefs.timezone} hint={"Taken from this device. Agents read times like “Friday at 4pm” in this zone."}>
        <span />
      </Row>
    </div>

    <div style={card}>
      <div style={cardTitle}>Chat history</div>
      <Row title="Clear AI chat history" hint={cleared ? 'All your AI chats were deleted.' : 'Deletes every chat on the AI page. Agent runs and what they created stay.'}>
        {confirmClear ? (
          <span style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmClear(false)} disabled={busy} style={btn(false)}>Cancel</button>
            <button onClick={clearHistory} disabled={busy} style={btn(true)}>{busy ? 'Deleting…' : 'Delete all'}</button>
          </span>
        ) : (
          <button onClick={() => { setCleared(false); setConfirmClear(true); }} style={btn(false)}>Clear history</button>
        )}
      </Row>
    </div>
  </>);
}

function btn(danger: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 9, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: danger ? 'none' : '1px solid var(--border-color)', background: danger ? 'var(--accent)' : 'transparent',
    color: danger ? '#fff' : 'var(--text-primary)', whiteSpace: 'nowrap',
  };
}
