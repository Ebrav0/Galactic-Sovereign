// Co-op ownership / control ACL (browser + Node host).
//
// Three tiers (see plan "per-player capitals, shareable fleets, one superweapon"):
// - Personal capitals (piloted flagship, hero flagships): owner-only, never grantable.
// - Shareable assets (playerShips, scouts, battleGroups): owner + grantedControllers[].
// - Team assets (credits, research, structures, the one superweapon): any pilot.
//
// Assets with no ownerPlayerId are legacy/team assets — anyone may command them.
// A null playerId means "local / solo player" and always passes.

/** Stamp ownership fields on a newly created shareable asset. */
export function stampOwnership(asset, ownerPlayerId = null) {
  if (!asset) return asset;
  asset.ownerPlayerId = ownerPlayerId ?? asset.ownerPlayerId ?? null;
  if (!Array.isArray(asset.grantedControllers)) asset.grantedControllers = [];
  return asset;
}

export function isOwner(playerId, asset) {
  if (!playerId || !asset?.ownerPlayerId) return true;
  return asset.ownerPlayerId === playerId;
}

/** Owner or explicitly granted controller (or team asset / solo context). */
export function canControl(playerId, asset) {
  if (!playerId || !asset) return true;
  if (!asset.ownerPlayerId) return true;
  if (asset.ownerPlayerId === playerId) return true;
  return Array.isArray(asset.grantedControllers)
    && asset.grantedControllers.includes(playerId);
}

/** Uniform failure result for command dispatch. */
export function assertControl(playerId, asset, label = 'asset') {
  if (canControl(playerId, asset)) return { ok: true };
  return {
    ok: false,
    reason: `${label} is controlled by ${asset?.ownerPlayerId ?? 'another pilot'} — request control or ask them to grant it`,
  };
}

export function grantControl(asset, targetPlayerId) {
  if (!asset) return { ok: false, reason: 'No such asset' };
  if (!targetPlayerId) return { ok: false, reason: 'targetPlayerId required' };
  stampOwnership(asset);
  if (asset.ownerPlayerId === targetPlayerId) {
    return { ok: false, reason: 'Pilot already owns this asset' };
  }
  if (asset.grantedControllers.includes(targetPlayerId)) {
    return { ok: true, already: true, grantedControllers: [...asset.grantedControllers] };
  }
  asset.grantedControllers.push(targetPlayerId);
  return { ok: true, grantedControllers: [...asset.grantedControllers] };
}

export function revokeControl(asset, targetPlayerId) {
  if (!asset) return { ok: false, reason: 'No such asset' };
  stampOwnership(asset);
  const idx = asset.grantedControllers.indexOf(targetPlayerId);
  if (idx < 0) return { ok: false, reason: 'Pilot does not have granted control' };
  asset.grantedControllers.splice(idx, 1);
  return { ok: true, grantedControllers: [...asset.grantedControllers] };
}

/** Controller drops their own grant (owner must revoke others). */
export function releaseControl(asset, playerId) {
  if (!asset) return { ok: false, reason: 'No such asset' };
  if (!playerId) return { ok: false, reason: 'playerId required' };
  stampOwnership(asset);
  if (asset.ownerPlayerId === playerId) {
    return { ok: false, reason: 'Owners cannot release control — transfer ownership instead' };
  }
  return revokeControl(asset, playerId);
}

/** Hand ownership to another pilot; clears all grants. */
export function transferOwnership(asset, targetPlayerId) {
  if (!asset) return { ok: false, reason: 'No such asset' };
  if (!targetPlayerId) return { ok: false, reason: 'targetPlayerId required' };
  stampOwnership(asset);
  if (!asset.ownerPlayerId) {
    return { ok: false, reason: 'Team asset — ownership cannot be transferred' };
  }
  if (asset.ownerPlayerId === targetPlayerId) {
    return { ok: true, already: true, ownerPlayerId: targetPlayerId };
  }
  asset.ownerPlayerId = targetPlayerId;
  asset.grantedControllers = [];
  return { ok: true, ownerPlayerId: targetPlayerId, grantedControllers: [] };
}

/** Compact description for UI rows ("Owner: Ada · Shared: Kai"). */
export function controlSummary(asset) {
  return {
    ownerPlayerId: asset?.ownerPlayerId ?? null,
    grantedControllers: Array.isArray(asset?.grantedControllers)
      ? [...asset.grantedControllers]
      : [],
  };
}

/** Resolve a shareable asset by kind + id (used by grant/revoke/order commands). */
export function findShareableAsset(state, assetKind, assetId) {
  if (assetKind === 'ship') return (state.playerShips ?? []).find((s) => s.id === assetId) ?? null;
  if (assetKind === 'scout') return (state.scouts ?? []).find((s) => s.id === assetId) ?? null;
  if (assetKind === 'battleGroup') return (state.battleGroups ?? []).find((g) => g.id === assetId) ?? null;
  return null;
}

export const SHAREABLE_KINDS = Object.freeze(['ship', 'scout', 'battleGroup']);

export function assetKindLabel(assetKind) {
  if (assetKind === 'ship') return 'Ship';
  if (assetKind === 'scout') return 'Scout';
  if (assetKind === 'battleGroup') return 'Fleet';
  return 'Asset';
}
