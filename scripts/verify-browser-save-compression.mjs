#!/usr/bin/env node

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const projectRequire = createRequire(path.join(ROOT, 'package.json'));

function loadChromium() {
  try {
    return projectRequire('playwright').chromium;
  } catch {
    const skillRequire = createRequire(path.join(
      homedir(),
      '.codex/skills/develop-web-game/scripts/web_game_playwright_client.js',
    ));
    return skillRequire('playwright').chromium;
  }
}

const chromium = loadChromium();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    typeof window.__newGame === 'function'
      && typeof window.__saveSlot === 'function'
      && typeof window.__loadSlot === 'function'
  ));

  const result = await page.evaluate(async () => {
    async function decodeGzipEnvelope(wrapper) {
      const binary = atob(wrapper.payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const decompressed = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      return new Response(decompressed).text();
    }

    localStorage.clear();
    window.__newGame(54, {
      mode: 'sandbox',
      victoryType: 'sandbox',
      aiDifficulty: 'normal',
    });
    const state = window.__getGameState();
    state.paused = true;
    const faction = state.factions?.list?.[0] ?? state.factions?.ai;
    const systemId = faction?.homeSystemId ?? state.stronghold;
    const galaxyId = state.activeGalaxyId;
    state.aiShips = Array.from({ length: 4_000 }, (_, index) => ({
      id: `compression-ai-${index}`,
      factionId: faction?.id ?? 'ai-0',
      galaxyId,
      systemId,
      hull: 'corvette',
      hp: 120,
      maxHp: 120,
      x: index % 40,
      y: Math.floor(index / 40),
      vx: 0,
      vy: 0,
      heading: 0,
      transit: null,
      buildCompleteAt: 0,
      weaponProfile: 'kinetic',
      strategicOrder: {
        kind: 'hold',
        systemId,
        issuedAt: index,
        deterministicLabel: `Compression regression ship ${index}`,
      },
    }));

    const compressedSave = await window.__saveSlot('slot-1');
    const compressedStored = localStorage.getItem('gs-save-slot-1');
    const wrapper = compressedStored ? JSON.parse(compressedStored) : null;
    const rawEnvelope = wrapper?.storageFormat === 'gzip-base64-v1'
      ? await decodeGzipEnvelope(wrapper)
      : null;
    const decodedEnvelope = rawEnvelope ? JSON.parse(rawEnvelope) : null;
    const saveModule = await import('/js/save.js');
    const canListSlots = typeof saveModule.listSlots === 'function';

    const beforeLoadCount = state.aiShips.length;
    state.aiShips = [];
    const compressedLoad = await window.__loadSlot('slot-1');
    const compressedLoadCount = window.__getGameState().aiShips?.length ?? 0;

    // Browser saves were raw JSON before gzip-at-rest was introduced. Preserve
    // that exact storage shape in a separate valid slot and load it through the
    // public game hook, rather than calling the serializer directly.
    if (rawEnvelope) localStorage.setItem('gs-save-slot-2', rawEnvelope);
    window.__getGameState().aiShips = [];
    const legacyRawLoad = await window.__loadSlot('slot-2');
    const legacyRawLoadCount = window.__getGameState().aiShips?.length ?? 0;

    const listed = canListSlots
      ? await saveModule.listSlots()
      : { ok: false, saves: [], unavailable: true };
    const compressedMetadata = listed.saves?.find((entry) => entry.slot === 'slot-1') ?? null;
    const legacyRawMetadata = listed.saves?.find((entry) => entry.slot === 'slot-2') ?? null;

    return {
      compressedSave,
      compressedLoad: {
        ok: !!compressedLoad?.ok,
        error: compressedLoad?.error ?? null,
        shipCount: compressedLoadCount,
      },
      legacyRawLoad: {
        ok: !!legacyRawLoad?.ok,
        error: legacyRawLoad?.error ?? null,
        shipCount: legacyRawLoadCount,
      },
      storageFormat: wrapper?.storageFormat ?? 'json',
      storedCharacters: compressedStored?.length ?? 0,
      uncompressedBytes: wrapper?.uncompressedBytes ?? compressedStored?.length ?? 0,
      compressionRatio: compressedStored && wrapper?.uncompressedBytes
        ? compressedStored.length / wrapper.uncompressedBytes
        : 1,
      decodedEnvelope: decodedEnvelope ? {
        saveVersion: decodedEnvelope.saveVersion ?? null,
        savedAt: decodedEnvelope.savedAt ?? null,
        hasChecksum: typeof decodedEnvelope.checksum === 'string',
        shipCount: decodedEnvelope.state?.aiShips?.length ?? 0,
      } : null,
      slotListing: {
        exposed: canListSlots,
        ok: !!listed.ok,
        compressed: compressedMetadata,
        legacyRaw: legacyRawMetadata,
      },
      beforeLoadCount,
    };
  });

  const checks = [
    ['large browser save succeeds', result.compressedSave?.ok],
    ['new browser save uses the gzip wrapper', result.storageFormat === 'gzip-base64-v1'],
    ['raw fixture envelope is larger than 2.5 MiB', result.uncompressedBytes > 2.5 * 1024 * 1024],
    ['stored payload is materially smaller', result.compressionRatio < 0.5],
    ['gzip payload decodes to a checksummed save envelope', result.decodedEnvelope?.hasChecksum],
    ['decoded gzip payload contains every AI ship', result.decodedEnvelope?.shipCount === result.beforeLoadCount],
    ['compressed save reloads successfully', result.compressedLoad?.ok],
    ['all AI ships survive the compressed round trip', result.compressedLoad?.shipCount === result.beforeLoadCount],
    ['legacy raw JSON save reloads successfully', result.legacyRawLoad?.ok],
    ['all AI ships survive the legacy raw JSON round trip', result.legacyRawLoad?.shipCount === result.beforeLoadCount],
    ['slot listing API is exposed', result.slotListing?.exposed],
    ['slot listing succeeds', result.slotListing?.ok],
    ['compressed slot metadata identifies gzip storage', (
      result.slotListing?.compressed?.storageFormat === 'gzip-base64-v1'
        && result.slotListing.compressed.saveVersion === result.decodedEnvelope?.saveVersion
        && result.slotListing.compressed.savedAt === result.decodedEnvelope?.savedAt
        && result.slotListing.compressed.uncompressedBytes === result.uncompressedBytes
    )],
    ['legacy slot metadata identifies raw JSON storage', (
      result.slotListing?.legacyRaw?.storageFormat === 'json'
        && result.slotListing.legacyRaw.saveVersion === result.decodedEnvelope?.saveVersion
        && result.slotListing.legacyRaw.savedAt === result.decodedEnvelope?.savedAt
        && result.slotListing.legacyRaw.uncompressedBytes === result.uncompressedBytes
    )],
  ];
  for (const [label, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
} finally {
  await browser.close();
}
