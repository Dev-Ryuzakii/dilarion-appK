// Org directory (name, job title, bio, photo flag) shared by the chat header
// and group bubbles. Loaded once per token; "profile_updated" WS events patch
// it in place so a bio change shows up without a reload.
import { useEffect, useState } from 'react';
import { Contact, getUsers } from './api';

let cache: Record<string, Contact> = {};
let loadedFor: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }

function load(token: string) {
  if (loadedFor === token || inflight) return;
  inflight = getUsers(token)
    .then(list => {
      const next: Record<string, Contact> = {};
      for (const u of list) next[u.username] = u;
      cache = next;
      loadedFor = token;
      emit();
    })
    .catch(() => {})
    .finally(() => { inflight = null; });
}

export function applyProfileUpdate(data: { username?: string; bio?: string | null; job_title?: string | null }) {
  if (!data?.username) return;
  const prev = cache[data.username] ?? ({ username: data.username, is_active: true } as Contact);
  cache = { ...cache, [data.username]: { ...prev, bio: data.bio ?? null, job_title: data.job_title ?? prev.job_title ?? null } };
  emit();
}

export function usePeople(token: string): Record<string, Contact> {
  const [people, setPeople] = useState(cache);
  useEffect(() => {
    const l = () => setPeople(cache);
    listeners.add(l);
    load(token);
    return () => { listeners.delete(l); };
  }, [token]);
  return people;
}

/** First word of the full name, falling back to the username. */
export function firstNameOf(person: Contact | undefined, username: string): string {
  const full = (person?.full_name || person?.display_name || '').trim();
  return full ? full.split(/\s+/)[0] : username;
}

/** Header line under a person's name: bio, else job title. */
export function aboutLineOf(person: Contact | undefined): string | null {
  return person?.bio?.trim() || person?.job_title?.trim() || null;
}
