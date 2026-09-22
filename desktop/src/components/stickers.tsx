// Small built-in sticker set — original flat-illustration SVGs (same style as
// MeetingsIllustration elsewhere in this codebase), not bitmap art, so there's
// nothing to license/host. A sticker message just carries its id
// ("sticker:thumbs_up" etc.) through the normal E2EE pipeline; every client
// renders the matching SVG from this same catalog.

export interface StickerDef {
  id: string;
  label: string;
  render: () => React.ReactNode;
}

function ThumbsUpSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <path d="M8 28h10v28H8a4 4 0 0 1-4-4V32a4 4 0 0 1 4-4Z" fill="#6d5efc" />
      <path d="M22 28l8-18a5 5 0 0 1 9 3v11h13a5 5 0 0 1 4.8 6.4l-5 18A6 6 0 0 1 46 53H22V28Z" fill="#6d5efc" fillOpacity="0.85" />
    </svg>
  );
}
function HeartSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <path d="M32 56S8 42 8 24a13 13 0 0 1 24-6 13 13 0 0 1 24 6c0 18-24 32-24 32Z" fill="#ef4444" />
    </svg>
  );
}
function FireSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <path d="M32 4c4 10-6 12-6 20a6 6 0 0 0 12 0c4 4 6 10 6 16a20 20 0 1 1-40 0c0-14 10-18 10-28 4 2 6 6 6 10 4-6 8-10 12-18Z" fill="#f59e0b" />
      <path d="M32 34c2 4-2 6-2 10a4 4 0 0 0 8 0c2 3 3 6 3 9a9 9 0 1 1-18 0c0-8 5-12 9-19Z" fill="#fde047" />
    </svg>
  );
}
function PartyPopperSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <path d="M10 54 26 22l16 16Z" fill="#6d5efc" />
      <circle cx="46" cy="12" r="3" fill="#f59e0b" /><circle cx="54" cy="24" r="3" fill="#ef4444" />
      <circle cx="40" cy="24" r="2.5" fill="#25d366" /><circle cx="52" cy="10" r="2" fill="#0ea5e9" />
      <path d="M34 14l4-4M44 20l4-4M38 30l4-4" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
function ClapSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <path d="M20 30l-6-14a4 4 0 0 1 7.4-3l5 11" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M44 30l6-14a4 4 0 0 0-7.4-3l-5 11" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx="32" cy="42" rx="20" ry="14" fill="#f59e0b" fillOpacity="0.85" />
    </svg>
  );
}
function LaughSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="26" fill="#fde047" />
      <path d="M18 26q2-4 6 0M40 26q2-4 6 0" stroke="#111827" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 36q16 14 32 0" stroke="#111827" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function SadSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="26" fill="#60a5fa" />
      <circle cx="22" cy="28" r="3" fill="#111827" /><circle cx="42" cy="28" r="3" fill="#111827" />
      <path d="M20 42q12-8 24 0" stroke="#111827" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M24 34c-1 4-3 6-3 10M40 34c1 4 3 6 3 10" stroke="#bfdbfe" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function LoveEyesSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="26" fill="#fde047" />
      <path d="M17 24l3.5 3.5L24 24M40 24l3.5 3.5L47 24" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M16 36q16 14 32 0" stroke="#111827" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function WaveSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <circle cx="26" cy="20" r="12" fill="#fde047" />
      <path d="M14 40c0-4 4-6 8-6h8c4 0 8 2 8 6v10a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4Z" fill="#6d5efc" fillOpacity="0.85" />
      <path d="M40 20c2-4 4-8 4-12M40 20c4-1 8-2 11-5M40 20c4 1 7 4 9 8" stroke="#fde047" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
function OkSticker() {
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" fill="none">
      <circle cx="20" cy="30" r="11" fill="none" stroke="#25d366" strokeWidth="5" />
      <path d="M30 30c6-2 12-10 8-22M30 30c8 2 14-2 18-8M30 30c6 4 8 12 4 20" stroke="#25d366" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export const STICKERS: StickerDef[] = [
  { id: 'thumbs_up', label: 'Thumbs up', render: ThumbsUpSticker },
  { id: 'heart', label: 'Heart', render: HeartSticker },
  { id: 'fire', label: 'Fire', render: FireSticker },
  { id: 'party', label: 'Party', render: PartyPopperSticker },
  { id: 'clap', label: 'Clap', render: ClapSticker },
  { id: 'laugh', label: 'Laughing', render: LaughSticker },
  { id: 'sad', label: 'Sad', render: SadSticker },
  { id: 'love_eyes', label: 'Love it', render: LoveEyesSticker },
  { id: 'wave', label: 'Wave', render: WaveSticker },
  { id: 'ok', label: 'OK', render: OkSticker },
];

export function getSticker(id: string): StickerDef | undefined {
  return STICKERS.find(s => s.id === id);
}
