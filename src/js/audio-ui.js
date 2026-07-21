// Self-contained audio settings UI and restrained global button feedback.

const $ = (id) => document.getElementById(id);

export function initAudioUi(engine, { preloadCues = [] } = {}) {
  const panel = $('audio-settings-panel');
  const backdrop = $('audio-settings-backdrop');
  const openButton = $('audio-settings-btn');
  const closeButton = $('audio-settings-close');
  if (!panel || !backdrop || !openButton || !closeButton) return { open() {}, close() {} };

  const rangeIds = {
    master: 'audio-master-volume',
    ui: 'audio-ui-volume',
    combat: 'audio-combat-volume',
    world: 'audio-world-volume',
    ambience: 'audio-ambience-volume',
  };

  const refresh = (snapshot = engine.snapshot(true)) => {
    const settings = snapshot.settings;
    for (const [key, id] of Object.entries(rangeIds)) {
      const input = $(id);
      const output = $(`${id}-value`);
      if (input && document.activeElement !== input) input.value = String(Math.round(settings[key] * 100));
      if (output) output.textContent = `${Math.round(settings[key] * 100)}%`;
    }
    if ($('audio-muted')) $('audio-muted').checked = settings.muted;
    if ($('audio-reduced-dynamics')) $('audio-reduced-dynamics').checked = settings.reducedDynamics;
    const status = $('audio-settings-status');
    if (status) {
      if (!snapshot.unlocked) {
        status.textContent = 'Audio unlocks on your next click or keypress';
      } else if (snapshot.lastError) {
        status.textContent = `Audio issue · ${snapshot.lastError.status}: ${snapshot.lastError.error ?? snapshot.lastError.cueId}`;
      } else {
        status.textContent = `Audio ready · ${snapshot.decodedBuffers} decoded · ${snapshot.activeVoices} active`;
      }
      status.classList.toggle('is-ready', snapshot.unlocked && !snapshot.lastError);
      status.classList.toggle('is-error', !!snapshot.lastError);
    }
    openButton.setAttribute('aria-label', settings.muted ? 'Open audio settings, muted' : 'Open audio settings');
    openButton.classList.toggle('is-muted', settings.muted);
  };

  const open = () => {
    panel.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    engine.unlock().then(() => engine.preload(preloadCues));
    refresh();
  };
  const close = () => {
    panel.classList.add('hidden');
    backdrop.classList.add('hidden');
  };

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  $('title-audio-btn')?.addEventListener('click', open);

  for (const [key, id] of Object.entries(rangeIds)) {
    $(id)?.addEventListener('input', (event) => engine.setSettings({ [key]: Number(event.target.value) / 100 }));
  }
  $('audio-muted')?.addEventListener('change', (event) => engine.setSettings({ muted: event.target.checked }));
  $('audio-reduced-dynamics')?.addEventListener('change', (event) => engine.setSettings({ reducedDynamics: event.target.checked }));
  $('audio-test-ui')?.addEventListener('click', () => engine.playCue('ui.confirm', { force: true }));
  $('audio-test-combat')?.addEventListener('click', () => engine.playCue('combat.beam_lance', { force: true }));
  $('audio-test-cinematic')?.addEventListener('click', () => engine.playCue('helioclast.fire', { force: true, gain: 0.7 }));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.classList.contains('hidden')) close();
  });

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button');
    if (!button || button.disabled || button.id.startsWith('audio-test-')) return;
    if (button.id === 'audio-settings-btn' || button.id === 'title-audio-btn') return engine.playCue('ui.panel_open');
    if (button.id === 'audio-settings-close' || /(?:close|cancel|back)/i.test(button.id)) return engine.playCue('ui.cancel');
    if (/pause/i.test(button.id)) return engine.playCue('ui.pause');
    if (/save|confirm|build|queue|start|new-campaign|tutorial/i.test(button.id)) return engine.playCue('ui.confirm');
    engine.playCue('ui.select');
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('select') && !panel.contains(event.target)) engine.playCue('ui.select');
  }, true);

  engine.subscribe(refresh);
  refresh();
  return { open, close, refresh };
}

