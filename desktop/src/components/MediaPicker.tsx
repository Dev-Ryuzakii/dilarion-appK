import { useEffect, useRef, useState } from 'react';
import { searchGifs, getTrendingGifs, GifResult } from '../services/api';
import { EMOJI_CATEGORIES, searchEmoji } from './emojiCatalog';
import { STICKERS } from './stickers';

type PickerTab = 'emoji' | 'gif' | 'sticker';

/**
 * Combined Emoji/GIF/Sticker picker for composing a message — distinct from
 * ReactionBar (the small fixed 6-emoji quick-react row on a message). Glass
 * (frosted, translucent) panel, floats above the composer.
 */
export default function MediaPicker({
  token,
  onPickEmoji,
  onPickGif,
  onPickSticker,
  onClose,
  anchorStyle,
}: {
  token: string;
  onPickEmoji: (emoji: string) => void;
  onPickGif: (gif: GifResult) => void;
  onPickSticker: (stickerId: string) => void;
  onClose: () => void;
  anchorStyle?: React.CSSProperties;
}) {
  const [tab, setTab] = useState<PickerTab>('emoji');
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [gifsLoading, setGifsLoading] = useState(false);
  const [gifsError, setGifsError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'gif') return;
    setGifsLoading(true);
    setGifsError(null);
    const fetcher = query.trim() ? searchGifs(token, query.trim()) : getTrendingGifs(token);
    fetcher
      .then(setGifs)
      .catch(err => setGifsError(err?.message || 'GIF search unavailable'))
      .finally(() => setGifsLoading(false));
  }, [tab, query, token]);

  const filteredEmoji = tab === 'emoji' && query.trim() ? searchEmoji(query) : null;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute', ...anchorStyle,
        width: 340, height: 380, display: 'flex', flexDirection: 'column',
        background: 'rgba(30, 30, 38, 0.55)',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 18,
        boxShadow: '0 16px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
        overflow: 'hidden',
        zIndex: 980,
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0' }}>
        {(['emoji', 'gif', 'sticker'] as PickerTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 700, textTransform: 'capitalize',
              background: tab === t ? 'rgba(255,255,255,0.18)' : 'transparent',
              color: tab === t ? '#fff' : 'rgba(255,255,255,0.6)',
              transition: 'background 0.15s',
            }}
          >
            {t === 'gif' ? 'GIFs' : t === 'sticker' ? 'Stickers' : 'Emoji'}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== 'sticker' && (
        <div style={{ padding: '10px 10px 6px' }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tab === 'gif' ? 'Search GIPHY…' : 'Search category…'}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, color: '#fff',
              fontSize: '0.8rem', padding: '7px 12px', outline: 'none',
            }}
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 10px' }}>
        {tab === 'emoji' && (
          filteredEmoji ? (
            <EmojiGrid emojis={filteredEmoji} onPick={onPickEmoji} />
          ) : (
            EMOJI_CATEGORIES.map(cat => (
              <div key={cat.label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 2px' }}>
                  {cat.label}
                </div>
                <EmojiGrid emojis={cat.emojis} onPick={onPickEmoji} />
              </div>
            ))
          )
        )}

        {tab === 'gif' && (
          gifsLoading ? (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', textAlign: 'center', marginTop: 30 }}>Loading…</div>
          ) : gifsError ? (
            <div style={{ color: '#fca5a5', fontSize: '0.78rem', textAlign: 'center', marginTop: 30, padding: '0 10px' }}>{gifsError}</div>
          ) : gifs.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', textAlign: 'center', marginTop: 30 }}>No GIFs found</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {gifs.map(g => (
                <button
                  key={g.id}
                  onClick={() => onPickGif(g)}
                  style={{ padding: 0, border: 'none', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', aspectRatio: '1' }}
                >
                  <img src={g.preview_url} alt={g.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          )
        )}

        {tab === 'sticker' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {STICKERS.map(s => (
              <button
                key={s.id}
                onClick={() => onPickSticker(s.id)}
                title={s.label}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 12,
                  padding: 8, cursor: 'pointer', aspectRatio: '1',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              >
                {s.render()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmojiGrid({ emojis, onPick }: { emojis: string[]; onPick: (e: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
      {emojis.map((e, i) => (
        <button
          key={`${e}-${i}`}
          onClick={() => onPick(e)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: 5, borderRadius: 8, lineHeight: 1 }}
          onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
