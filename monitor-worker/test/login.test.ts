import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLoginEmail, validateLoginEvent } from '../src/login';

const event = {
  version: 1 as const,
  type: 'user.login' as const,
  eventId: '4eaa42d1-1597-46c8-a03c-67e6a87127fa',
  timestamp: 2_000_000_000,
  user: { id: 'user-1', username: 'pilot', displayName: 'Pilot <One>', role: 'player' },
};

test('validates a complete login event', () => assert.deepEqual(validateLoginEvent(event), event));
test('validates solo and multiplayer activity events', () => {
  const solo = {
    ...event,
    type: 'solo.enter' as const,
    context: { mode: 'solo', reason: 'new_game' },
  };
  const multiplayer = {
    ...event,
    type: 'multiplayer.join' as const,
    context: { mode: 'multiplayer' },
  };
  assert.deepEqual(validateLoginEvent(solo), solo);
  assert.deepEqual(validateLoginEvent(multiplayer), multiplayer);
});
test('rejects malformed and oversized login events', () => {
  assert.equal(validateLoginEvent({ ...event, eventId: 'not-a-uuid' }), null);
  assert.equal(validateLoginEvent({ ...event, type: 'user.logout' }), null);
  assert.equal(validateLoginEvent({ ...event, user: { ...event.user, username: 'x'.repeat(33) } }), null);
});
test('formats text and escapes HTML fields', () => {
  const message = formatLoginEmail(event);
  assert.match(message.subject, /^LOGIN: .*pilot/);
  assert.match(message.text, /Pilot <One>/);
  assert.match(message.html, /Pilot &lt;One&gt;/);
  assert.doesNotMatch(message.html, /Pilot <One>/);
});
test('formats solo and multiplayer subjects', () => {
  assert.match(formatLoginEmail({ ...event, type: 'solo.enter' }).subject, /^SOLO:/);
  assert.match(formatLoginEmail({ ...event, type: 'multiplayer.join' }).subject, /^MULTIPLAYER:/);
});
