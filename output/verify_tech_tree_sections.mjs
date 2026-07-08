// Verify every advertised tech-tree section is backed by a real cluster band.

import { TECH_CLUSTERS } from '../src/js/tech-web-ui.js';
import { allTechNodes } from '../src/js/tech-web.js';
import {
  CLUSTER_BAND,
  TECH_CLUSTER_ORDER,
  layoutHorizontalTree,
} from '../src/js/tech-web-layout.js';

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

const nodes = allTechNodes();
const clusterIds = new Set(nodes.map((node) => node.cluster));
const advertised = Object.keys(TECH_CLUSTERS);
const bands = advertised.map((clusterId) => CLUSTER_BAND[clusterId]);

check('every advertised chip has a band', advertised.every((id) => Number.isInteger(CLUSTER_BAND[id])));
check('every advertised chip has nodes', advertised.every((id) => clusterIds.has(id)));
check('every node cluster is advertised', [...clusterIds].every((id) => advertised.includes(id)));
check('every node cluster has a layout band', [...clusterIds].every((id) => Number.isInteger(CLUSTER_BAND[id])));
check('advertised bands are unique', new Set(bands).size === bands.length, bands.join(','));
check('cluster order covers advertised chips', TECH_CLUSTER_ORDER.length === advertised.length
  && advertised.every((id) => TECH_CLUSTER_ORDER.includes(id)));

const { positions, bandCenters } = layoutHorizontalTree(nodes);
for (const clusterId of advertised) {
  const clusterNodes = nodes.filter((node) => node.cluster === clusterId);
  const yValues = clusterNodes.map((node) => positions.get(node.id)?.y).filter(Number.isFinite);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const center = bandCenters.get(CLUSTER_BAND[clusterId]);
  check(`${clusterId} nodes land near their own band`, Number.isFinite(center)
    && minY >= center - 260
    && maxY <= center + 260,
  `center=${Math.round(center)}, range=${Math.round(minY)}-${Math.round(maxY)}`);
}

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} tech-tree section checks failed.`);
  process.exit(1);
}

console.log(`\n${results.length}/${results.length} tech-tree section checks passed.`);
