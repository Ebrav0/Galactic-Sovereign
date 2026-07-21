// Co-op host protocol helpers (Node). Re-exports shared bits + encode/decode.

export {
  PROTOCOL_VERSION,
  summaryFromState,
  welcomeMessage,
} from '../src/js/coop-protocol.js';

export function encode(msg) {
  return JSON.stringify(msg);
}

export function decode(raw) {
  const msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    throw new Error('Invalid message');
  }
  return msg;
}
