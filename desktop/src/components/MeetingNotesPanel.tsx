import { useEffect, useMemo, useState } from 'react';
import { createActionTask, getMeetingNotes, MeetingNotes, shareNotesText, startMeetingNotes } from '../services/api';

export default function MeetingNotesPanel({ token, recordingId, onClose }: { token: string; recordingId: number; onClose: () => void }) {
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [tab, setTab] = useState<'summary' | 'actions' | 'transcript'>('summary');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try { setNotes(await getMeetingNotes(token, recordingId)); }
    catch (err: any) { setError(err?.message || 'Could not load notes'); }
  }

  useEffect(() => { load(); }, [token, recordingId]);

  const markdown = useMemo(() => {
    const body = notes?.notes;
    if (!body) return '';
    const lines = [body.summary || '', '', ...(body.key_points || []).map(p => `- ${p}`), '', ...(body.action_items || []).map(a => `- ${a.task}`)];
    return lines.filter(Boolean).join('\n');
  }, [notes]);

  const transcriptLines = (notes?.segments?.length ? notes.segments.map(seg => `${seg.speaker || 'Speaker'}: ${seg.text}`) : (notes?.transcript || '').split('\n')).filter(line => !query || line.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(640px, 94vw)', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '1.05rem' }}>Meeting notes</strong>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>
        {notes?.ai_status === 'processing' && <div style={{ marginTop: 12 }}>Preparing notes…</div>}
        {notes?.ai_status === 'failed' && (
          <div style={{ marginTop: 12 }}>
            <div>{notes.ai_error || 'Notes failed'}</div>
            <button onClick={() => startMeetingNotes(token, recordingId).then(load)} style={{ marginTop: 8 }}>Retry</button>
          </div>
        )}
        {!notes?.ai_status && <button onClick={() => startMeetingNotes(token, recordingId).then(load)}>Generate notes</button>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {(['summary', 'actions', 'transcript'] as const).map(name => (
            <button key={name} onClick={() => setTab(name)} style={{ background: tab === name ? 'var(--accent)' : 'transparent', color: tab === name ? '#fff' : 'var(--text-primary)', border: tab === name ? '1px solid var(--accent)' : '1px solid var(--border-color)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit' }}>{name}</button>
          ))}
          <button onClick={() => navigator.clipboard.writeText(markdown)} style={{ marginLeft: 'auto', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '4px 8px', cursor: 'pointer' }}>Copy</button>
          <button onClick={() => { const blob = new Blob([markdown], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'meeting-notes.md'; a.click(); URL.revokeObjectURL(url); }} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '4px 8px', cursor: 'pointer' }}>Export</button>
        </div>
        {tab === 'summary' && <p style={{ whiteSpace: 'pre-wrap' }}>{notes?.notes?.summary || 'No summary yet.'}</p>}
        {tab === 'actions' && (notes?.notes?.action_items || []).map((item, index) => (
          <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span>{item.task}{item.owner ? ` · ${item.owner}` : ''}</span>
            <button onClick={() => createActionTask(token, recordingId, index).catch(err => setError(err.message))} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>Create task</button>
          </div>
        ))}
        {tab === 'transcript' && (
          <>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transcript" style={{ width: '100%', margin: '8px 0', padding: 8, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            {transcriptLines.map((line, i) => <div key={i} style={{ fontSize: '0.85rem', marginBottom: 6 }}>{line}</div>)}
          </>
        )}
        <button onClick={() => shareNotesText(token, recordingId).then(share => navigator.clipboard.writeText(share.text)).catch(err => setError(err.message))} style={{ marginTop: 12, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '6px 10px', cursor: 'pointer' }}>Copy summary to share</button>
        {error && <div style={{ color: 'var(--accent)', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
