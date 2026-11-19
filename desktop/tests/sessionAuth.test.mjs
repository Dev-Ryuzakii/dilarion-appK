import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionRetirementReason } from '../src/services/sessionAuth.ts';

const response = (status, detail) => new Response(JSON.stringify({ detail }), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

test('replaced and expired app sessions request sign-in', async () => {
  assert.match(await sessionRetirementReason(response(401, 'Session replaced by another login')), /replaced by a newer sign-in/);
  assert.match(await sessionRetirementReason(response(401, 'Invalid or expired session')), /session expired/);
  assert.match(await sessionRetirementReason(response(403, 'Not authenticated')), /session expired/);
});

test('other authentication and permission errors preserve the current session', async () => {
  assert.equal(await sessionRetirementReason(response(401, 'Invalid username, token, or password')), null);
  assert.equal(await sessionRetirementReason(response(401, 'Master token rejected')), null);
  assert.equal(await sessionRetirementReason(response(403, 'You are not a member of this group')), null);
  assert.equal(await sessionRetirementReason(new Response('not JSON', { status: 401 })), null);
});
