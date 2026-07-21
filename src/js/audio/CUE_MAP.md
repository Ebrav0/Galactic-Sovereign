# Proposed SFX cue map

These are source candidates, not final mix decisions. Several cinematic cues should
layer two or more files and apply filtering, pitch, gain envelopes, and randomized
variants at runtime.

| Logical cue | Source candidates |
| --- | --- |
| `ui.select` | `interface/select_001.ogg` through `select_008.ogg` |
| `ui.confirm` | `interface/confirmation_001.ogg` through `confirmation_004.ogg` |
| `ui.cancel` | `interface/back_001.ogg` through `back_004.ogg` |
| `ui.error` | `interface/error_001.ogg` through `error_008.ogg` |
| `ui.panel_open` | `interface/open_001.ogg` through `open_004.ogg` |
| `ui.panel_close` | `interface/close_001.ogg` through `close_004.ogg` |
| `ui.pause` | `ui/switch10.ogg`, `ui/switch14.ogg`, `interface/toggle_001.ogg` |
| `notification.info` | `digital/twoTone1.ogg`, `digital/threeTone1.ogg` |
| `notification.success` | `digital/highUp.ogg`, `digital/zapThreeToneUp.ogg` |
| `notification.warning` | `digital/lowThreeTone.ogg`, `digital/zapThreeToneDown.ogg` |
| `navigation.fleet_arrival` | `digital/phaseJump1.ogg` plus `sci-fi/spaceEngineSmall_000.ogg` |
| `navigation.warp_depart` | `digital/phaserUp1.ogg` through `phaserUp7.ogg` |
| `navigation.warp_arrive` | `digital/phaseJump1.ogg` through `phaseJump5.ogg` |
| `navigation.wormhole` | layered `digital/powerUp*.ogg`, `sci-fi/forceField_*.ogg`, and `sci-fi/spaceEngineLow_*.ogg` |
| `combat.kinetic` | `impact/impactMetal_medium_*.ogg` plus `impact/impactPunch_heavy_*.ogg` |
| `combat.point_defense` | `digital/laser1.ogg` through `laser9.ogg`, pitched short |
| `combat.torpedo_launch` | `sci-fi/thrusterFire_*.ogg` |
| `combat.torpedo_impact` | `sci-fi/explosionCrunch_*.ogg` plus `impact/impactMetal_heavy_*.ogg` |
| `combat.beam_lance` | `sci-fi/laserLarge_*.ogg` plus `digital/powerUp*.ogg` |
| `combat.ion` | `digital/zap1.ogg`, `digital/zap2.ogg`, and `sci-fi/forceField_*.ogg` |
| `combat.shield_hit` | `sci-fi/forceField_*.ogg` plus `impact/impactGlass_light_*.ogg` |
| `combat.hull_hit` | `sci-fi/impactMetal_*.ogg` and `impact/impactPlate_*.ogg` |
| `combat.fighter_launch` | `sci-fi/thrusterFire_*.ogg` plus `ui/switch*.ogg` |
| `combat.small_kill` | `sci-fi/explosionCrunch_*.ogg` |
| `combat.capital_kill` | layered `sci-fi/explosionCrunch_*.ogg`, `sci-fi/lowFrequency_explosion_*.ogg`, and `impact/impactMetal_heavy_*.ogg` |
| `dyson.launcher` | `digital/powerUp*.ogg` into `sci-fi/laserLarge_*.ogg` |
| `dyson.reactor_loop` | looped and filtered `sci-fi/spaceEngineLow_*.ogg` or `spaceEngineLarge_*.ogg` |
| `dyson.crackle` | randomized short segments of `digital/zap*.ogg` and `sci-fi/forceField_*.ogg` |
| `dyson.heartbeat` | filtered `sci-fi/lowFrequency_explosion_*.ogg` with a double-pulse envelope |
| `dyson.shell_complete` | layered `impact/impactBell_heavy_*.ogg`, `sci-fi/lowFrequency_explosion_*.ogg`, and `digital/powerUp*.ogg` |
| `helioclast.charge` | staged `digital/powerUp1.ogg` through `powerUp12.ogg` over `sci-fi/engineCircular_*.ogg` |
| `helioclast.target_lock` | `digital/threeTone2.ogg` or `digital/zapThreeToneUp.ogg` |
| `helioclast.fire` | layered `sci-fi/laserLarge_*.ogg`, `digital/phaserDown*.ogg`, and `sci-fi/lowFrequency_explosion_*.ogg` |
| `helioclast.impact` | layered `sci-fi/explosionCrunch_*.ogg`, `impact/impactBell_heavy_*.ogg`, and `impact/impactMetal_heavy_*.ogg` |
| `ambience.command` | looped `sci-fi/computerNoise_*.ogg` at low gain |
| `ambience.system` | looped `sci-fi/spaceEngineLow_*.ogg` with sparse `digital/tone1.ogg` telemetry |

