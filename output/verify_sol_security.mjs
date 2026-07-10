// Static and runtime-safe Sol boundary checks. No network request is made.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNewGame } from '../src/js/state.js';
import { buildRedactedSolSnapshot, createOfflineSolAdvice } from '../src/js/sol-commander.js';
import { serialize } from '../src/js/save.js';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const preload = read('electron/preload.js');
const rendererFiles = fs.readdirSync(path.join(root, 'src/js'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => read(`src/js/${file}`))
  .join('\n');
const main = read('electron/main.js');

check('OpenAI network call exists only in Electron main',
  main.includes('https://api.openai.com/v1/responses') && !rendererFiles.includes('api.openai.com'));
check('preload exposes bounded methods and never a key getter',
  preload.includes("ipcRenderer.invoke('sol:key:set'")
    && !/getKey|apiKey\s*:|OPENAI_API_KEY/.test(preload));
check('Electron disables renderer Node integration',
  main.includes('contextIsolation: true') && main.includes('nodeIntegration: false'));
check('key storage uses Electron safeStorage',
  main.includes('safeStorage.encryptString') && main.includes('safeStorage.decryptString'));

const secret = 'sk-test-super-secret-value-123456789';
const state = createNewGame(73);
state.debugApiKey = secret;
state.solCommander = {
  ...state.solCommander,
  history: [{ id: 'h1', role: 'user', text: secret, gameTimeMs: 0 }],
};
const snapshot = JSON.stringify(buildRedactedSolSnapshot(state));
const save = serialize(state);
const offline = JSON.stringify(createOfflineSolAdvice(state));
check('redacted snapshot excludes secret-like state and conversation', !snapshot.includes(secret));
check('offline advisor output excludes secret-like state', !offline.includes(secret));
check('serialized save defensively redacts credential-like values', !save.includes(secret));
check('Sol settings never define a key field', !/"(?:apiKey|key|secret|token)"\s*:/.test(JSON.stringify(state.solCommander.settings)));
// Saves retain arbitrary game debug fields by design, so security requires that
// the credential is never assigned to game state. Assert production source has
// no renderer assignment path instead of pretending serialization redacts state.
check('production renderer never assigns API key into game state',
  !/solCommander[^\n]{0,120}(?:apiKey|encryptedKey)/.test(rendererFiles)
    && !/state\.(?:apiKey|openaiKey)/.test(rendererFiles));
check('credential is not embedded in packaged source', !main.includes(secret) && !preload.includes(secret) && !save.includes('encryptedKey'));

const passed = results.filter((result) => result.pass).length;
console.log(`\nSol security: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
