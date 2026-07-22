// Co-op host protocol helpers (Node). Re-exports shared bits + encode/decode.

export {
  PROTOCOL_VERSION,
  summaryFromState,
  welcomeMessage,
} from '../src/js/coop-protocol.js';

const ALLOWED_TYPES = new Set(['ping', 'hello', 'command']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_MESSAGE_CHARS = 256 * 1024;
const MAX_NAME = 32;
const MAX_PASSWORD = 256;
const MAX_TOKEN = 128;
const MAX_COMMAND_NAME = 64;
const MAX_REQUEST_ID = 128;
const MAX_DEPTH = 10;

function assertNoForbiddenKeys(value, depth = 0) {
  if (value == null || typeof value !== 'object') return;
  if (depth > MAX_DEPTH) throw new Error('Message nesting too deep');
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('Forbidden message key');
    assertNoForbiddenKeys(value[key], depth + 1);
  }
}

export function encode(msg) {
  return JSON.stringify(msg);
}

/**
 * Parse and lightly validate an inbound WebSocket JSON message.
 * @param {string | Buffer} raw
 * @param {{ maxBytes?: number }} [opts]
 */
export function decode(raw, { maxBytes = MAX_MESSAGE_CHARS } = {}) {
  const text = typeof raw === 'string' ? raw : String(raw);
  if (text.length > maxBytes) throw new Error('Message too large');
  let msg;
  try {
    msg = JSON.parse(text, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('Forbidden message key');
      return value;
    });
  } catch (error) {
    if (String(error?.message || error).includes('Forbidden message key')) throw error;
    if (String(error?.message || error).includes('nesting')) throw error;
    throw new Error('Invalid JSON message');
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    throw new Error('Invalid message');
  }
  if (typeof msg.type !== 'string' || !ALLOWED_TYPES.has(msg.type)) {
    throw new Error('Invalid message type');
  }
  assertNoForbiddenKeys(msg);

  if (msg.type === 'hello') {
    if (msg.playerName != null && String(msg.playerName).length > MAX_NAME) {
      throw new Error('playerName too long');
    }
    if (msg.password != null && String(msg.password).length > MAX_PASSWORD) {
      throw new Error('password too long');
    }
    if (msg.reconnectToken != null && String(msg.reconnectToken).length > MAX_TOKEN) {
      throw new Error('reconnectToken too long');
    }
    if (msg.playerId != null && String(msg.playerId).length > 64) {
      throw new Error('playerId too long');
    }
  }

  if (msg.type === 'command') {
    if (typeof msg.command !== 'string' || !msg.command || msg.command.length > MAX_COMMAND_NAME) {
      throw new Error('Invalid command name');
    }
    if (msg.requestId != null && String(msg.requestId).length > MAX_REQUEST_ID) {
      throw new Error('requestId too long');
    }
    if (msg.payload != null && (typeof msg.payload !== 'object' || Array.isArray(msg.payload))) {
      throw new Error('Invalid command payload');
    }
  }

  return msg;
}
