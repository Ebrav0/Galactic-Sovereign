# Runtime SFX cue map

These logical cues are implemented in `src/js/audio-catalog.js`. The mixer randomly
selects variants, applies gain and pitch variation, and layers the cinematic cues
shown below. Gameplay code uses cue IDs rather than source filenames.

Primary palette: **Mixkit** (modern sci-fi / UI). Secondary: **rubberduck** ambient
loops. Physical combat layers still use **Kenney** sci-fi / impact.

| Logical cue | Source candidates |
| --- | --- |
| `ui.select` | `mixkit/ui_click_*.mp3` |
| `ui.confirm` | `mixkit/ui_confirm_*.mp3` |
| `ui.cancel` | `mixkit/ui_reject_a.mp3`, `mixkit/ui_zoom_a.mp3` |
| `ui.error` | `mixkit/ui_reject_a.mp3`, `mixkit/notify_alarm_scan.mp3` |
| `ui.panel_open` / `ui.panel_close` | `mixkit/ui_expand_a.mp3`, `ui_zoom_a.mp3`, `ui_glitch_small.mp3`, `ui_gear.mp3` |
| `ui.pause` / `ui.resume` | `mixkit/ui_gear.mp3`, `ui_glitch_small.mp3`, `ui_confirm_b.mp3` |
| `notification.*` | `mixkit/notify_hint.mp3`, `notify_positive.mp3`, `notify_alarm_scan.mp3` |
| `navigation.view` | `mixkit/trans_sweep_*.mp3` |
| `navigation.fleet_arrival` | `mixkit/trans_passby.mp3` + Kenney `spaceEngineSmall_*` |
| `navigation.warp_*` / `wormhole` | `mixkit/trans_warp_*.mp3`, `space_intro.mp3`, Kenney force fields |
| `combat.point_defense` / `beam_lance` / `ion` | `mixkit/weapon_laser.mp3`, `weapon_plasma_power.mp3` (+ Kenney laserLarge for beams) |
| `combat.kinetic` / impacts / kills | Kenney impact + sci-fi explosion / thruster layers |
| `dyson.*` | Mixkit plasma / glitch + Kenney low-frequency / bell layers |
| `helioclast.*` | Mixkit plasma / laser / notify + Kenney explosion / impact layers |
| `ambience.title` | `mixkit/ambience_drone_dark.mp3`, `ambience_bass_suspense.mp3` |
| `ambience.command` | `mixkit/ambience_high_tech.mp3`, `ambience_engine_hum.mp3` |
| `ambience.system` | `mixkit/ambience_engine_hum.mp3`, `rubberduck/sfx_19*.mp3` |
| `ambience.dyson` | `mixkit/ambience_bass_suspense.mp3`, `ambience_drone_dark.mp3` |
| `intro.awakening` / `ignition` / `breach` / `translation` / `arrival` | Mixkit cinematic whoosh / tunnel / impact layers synced to warp-intro phases |
