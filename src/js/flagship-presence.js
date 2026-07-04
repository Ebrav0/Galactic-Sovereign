// Shared flagship presence checks for build orders and drone work.

export function flagshipInSystem(state, systemId) {
  const f = state.flagship;
  return f.galaxyId === state.activeGalaxyId
    && f.systemId === systemId
    && !f.transit
    && !f.wormholeTransit;
}

export function flagshipPresentForDrones(state) {
  const f = state.flagship;
  if (!f.systemId || f.transit || f.wormholeTransit) return null;
  if (f.galaxyId !== state.activeGalaxyId) return null;
  return f.systemId;
}
