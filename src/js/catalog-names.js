// Stable public catalog identities. Internal ids remain unchanged.

function numericSuffix(value, fallback = 0) {
  const match = String(value ?? '').match(/(\d+)$/);
  return match ? Number(match[1]) : fallback;
}

export function galaxyCatalogCode(galaxyId) {
  return `G${String(numericSuffix(galaxyId) + 1).padStart(3, '0')}`;
}

export function starCatalogCode(galaxyId, star) {
  if (!star || star.id === 'core' || star.kind === 'blackhole') return `${galaxyCatalogCode(galaxyId)}-CORE`;
  const number = Number.isInteger(star.catalogNumber)
    ? star.catalogNumber
    : numericSuffix(star.id) + 1;
  return `${galaxyCatalogCode(galaxyId)}-S${String(number).padStart(3, '0')}`;
}

export function planetCatalogCode(starCode, planetOrId) {
  const id = typeof planetOrId === 'string' ? planetOrId : planetOrId?.id;
  return `${starCode}-P${String(numericSuffix(id, 1)).padStart(2, '0')}`;
}

export function moonCatalogCode(starCode, planetOrId, moonOrId) {
  const planetCode = planetCatalogCode(starCode, planetOrId);
  const id = typeof moonOrId === 'string' ? moonOrId : moonOrId?.id;
  return `${planetCode}-M${String(numericSuffix(id, 1)).padStart(2, '0')}`;
}

export function catalogLabel(catalogId, alias) {
  const cleanAlias = String(alias ?? '').replace(/^G\d{3}-(?:S\d{3}|CORE)(?:-P\d{2})?(?:-M\d{2})?\s*·\s*/, '');
  return cleanAlias ? `${catalogId} · ${cleanAlias}` : catalogId;
}

export function applyBodyCatalogIdentity(bodies, starCode) {
  for (const planet of bodies ?? []) {
    planet.alias ??= planet.name;
    planet.catalogId = planetCatalogCode(starCode, planet);
    planet.name = catalogLabel(planet.catalogId, planet.alias);
    for (const moon of planet.moons ?? []) {
      moon.alias ??= moon.name;
      moon.catalogId = moonCatalogCode(starCode, planet, moon);
      moon.name = catalogLabel(moon.catalogId, moon.alias);
    }
  }
  return bodies;
}

export function applySystemCatalogIdentity(system, graphStar, galaxyId, aliasOverride = null) {
  if (!system) return system;
  const catalogId = starCatalogCode(galaxyId, graphStar ?? system);
  system.alias = aliasOverride ?? system.alias ?? system.name;
  system.catalogId = catalogId;
  system.name = catalogLabel(catalogId, system.alias);
  applyBodyCatalogIdentity(system.bodies, catalogId);
  return system;
}

export function applyGraphCatalogIdentity(graph, galaxyId) {
  for (const star of graph?.stars ?? []) {
    star.alias ??= star.name;
    star.catalogId = starCatalogCode(galaxyId, star);
    star.name = catalogLabel(star.catalogId, star.alias);
  }
  if (graph?.blackHole) {
    graph.blackHole.alias ??= graph.blackHole.name;
    graph.blackHole.catalogId = starCatalogCode(galaxyId, graph.blackHole);
    graph.blackHole.name = catalogLabel(graph.blackHole.catalogId, graph.blackHole.alias);
  }
  return graph;
}

export function applyStateCatalogIdentities(state) {
  for (const [galaxyId, galaxy] of Object.entries(state?.galaxies ?? {})) {
    applyGraphCatalogIdentity(galaxy.graph, galaxyId);
    const byId = new Map((galaxy.graph?.stars ?? []).map((star) => [star.id, star]));
    if (galaxy.graph?.blackHole) byId.set(galaxy.graph.blackHole.id, galaxy.graph.blackHole);
    for (const [systemId, system] of Object.entries(galaxy.systems ?? {})) {
      applySystemCatalogIdentity(system, byId.get(systemId), galaxyId);
    }
    for (const [systemId, overlay] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) {
      applySystemCatalogIdentity(overlay, byId.get(systemId), galaxyId);
    }
  }
  return state;
}
