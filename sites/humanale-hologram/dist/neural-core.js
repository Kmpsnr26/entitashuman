(function exposeNeuralCore(global) {
  // A deterministic, connected 3D graph. This is an artistic data visualization
  // of HumanALE/NARA runtime state, not an anatomical scan or medical dataset.
  const REGION_DEFINITIONS = [
    ['NARA_CORE','NARA Core','core',0,0.08,0.18,['REASONER','PLANNER','MEMORY','AGENT_MANAGER','SAFETY','FOLLOW_UP']],
    ['REASONER','Reasoner','cognitive',-0.34,0.02,0.10,['NARA_CORE','BUG_HUNTER','MEMORY']],
    ['PLANNER','Planner','cognitive',0.34,0.02,0.10,['NARA_CORE','AGENT_MANAGER','FOLLOW_UP']],
    ['MEMORY','Memory','cognitive',-0.42,-0.18,0.02,['NARA_CORE','REASONER','DRIVE']],
    ['BUG_HUNTER','Bug Hunter','cognitive',-0.18,-0.28,0.16,['REASONER','ERROR_MONITOR','PROGRAM','REPORTING']],
    ['AGENT_MANAGER','Agent Manager','cognitive',0.18,-0.28,0.16,['NARA_CORE','TOOLS','PROGRAM','TEAM']],
    ['TOOLS','Tools','execution',0.46,-0.16,0.02,['AGENT_MANAGER','TERMINAL','WEB','DRIVE']],
    ['TERMINAL','Terminal','execution',0.54,-0.38,-0.02,['TOOLS','PROGRAM','ERROR_MONITOR']],
    ['PROGRAM','Program','execution',0.24,-0.48,0.04,['TERMINAL','BUG_HUNTER','FOLLOW_UP','REPORTING']],
    ['ERROR_MONITOR','Error Monitor','execution',-0.12,-0.50,0.02,['BUG_HUNTER','TERMINAL','REPORTING']],
    ['GITHUB','GitHub','connection',-0.60,0.16,-0.04,['PR','SYNC','COPILOT','TEAM']],
    ['COPILOT','Copilot','connection',-0.58,-0.06,-0.05,['GITHUB','AGENT_MANAGER','PROGRAM']],
    ['WEB','Web','connection',0.60,0.18,-0.05,['TOOLS','ONLINE','NARA_CORE']],
    ['TEAM','Team','connection',-0.52,0.38,-0.10,['GITHUB','PR','AGENT_MANAGER']],
    ['PR','Pull Request','connection',-0.30,0.46,-0.12,['GITHUB','TEAM','REPORTING']],
    ['SYNC','Synchronization','connection',0,0.50,-0.13,['GITHUB','DRIVE','MEMORY','ONLINE']],
    ['ONLINE','Online','connection',0.30,0.46,-0.12,['WEB','SYNC','NARA_CORE']],
    ['OWNER_EMAIL','Email Pemilik','connection',0.56,0.38,-0.10,['FOLLOW_UP','REPORTING','NARA_CORE']],
    ['DRIVE','Drive','connection',0.62,-0.04,-0.06,['MEMORY','SYNC','TOOLS','REPORTING']],
    ['REPORTING','Laporan','workflow',-0.34,-0.46,-0.04,['BUG_HUNTER','PROGRAM','FOLLOW_UP','OWNER_EMAIL']],
    ['FOLLOW_UP','Tindak Lanjut','workflow',0,-0.38,0.24,['NARA_CORE','PLANNER','PROGRAM','REPORTING','OWNER_EMAIL']],
    ['SAFETY','Safety','safety',0,0.28,-0.20,['NARA_CORE','TOOLS','TERMINAL','GITHUB','OWNER_EMAIL']]
  ];

  const toBrainSpace = (x, y, z) => ({
    x: x * 0.37,
    y: -0.30 - y * 0.18,
    z: 0.135 + z * 0.28
  });

  function create() {
    const nodes = [], links = [], paths = [], seen = new Set();
    const connect = (a, b) => {
      const key = [a, b].sort((x, y) => x - y).join(':');
      if (a !== b && !seen.has(key)) { links.push({ a, b }); seen.add(key); }
    };

    for (const side of [-1, 1]) {
      for (let i = 0; i < 144; i++) {
        const v = 1 - 2 * (i + 0.5) / 144, r = Math.sqrt(1 - v * v);
        const angle = i * 2.3999632297, layer = i % 4 === 0 ? 0.62 : 1;
        nodes.push({
          x: side * 0.145 + Math.cos(angle) * r * 0.167 * layer,
          y: -0.30 + v * 0.205 * layer,
          z: 0.135 + Math.sin(angle) * r * 0.153 * layer,
          region: '',
          digit: i % 2
        });
      }
    }

    const brainCount = nodes.length;
    const regions = REGION_DEFINITIONS.map(([id,label,group,x,y,z,connections]) => ({
      id,label,group,...toBrainSpace(x,y,z),connections:[...connections],nodeIds:[]
    }));
    const regionIndex = Object.fromEntries(regions.map((region,index)=>[region.id,index]));

    // Give every visible cortical point a semantic NARA owner. The geometry stays
    // deterministic; only its runtime meaning changes.
    for (let i = 0; i < brainCount; i++) {
      const node = nodes[i];
      let best = regions[0], bestDistance = Infinity;
      for (const region of regions) {
        const distance = Math.hypot(
          (node.x-region.x) * 1.12,
          (node.y-region.y) * 1.05,
          (node.z-region.z) * 0.86
        );
        if (distance < bestDistance) { best = region; bestDistance = distance; }
      }
      node.region = best.id;
      best.nodeIds.push(i);
    }

    for (let i = 0; i < brainCount; i++) {
      const p = nodes[i];
      const nearest = nodes.slice(0, brainCount)
        .map((q, j) => ({ j, d: Math.hypot(p.x-q.x, p.y-q.y, p.z-q.z) }))
        .filter(q => q.j !== i).sort((a, b) => a.d - b.d).slice(0, 3);
      for (const q of nearest) connect(i, q.j);
    }

    // A spanning tree guarantees every cortical node participates in one network.
    for (let i = 1; i < brainCount; i++) {
      let nearest = 0, distance = Infinity;
      for (let j = 0; j < i; j++) {
        const p = nodes[i], q = nodes[j], d = Math.hypot(p.x-q.x, p.y-q.y, p.z-q.z);
        if (d < distance) { nearest = j; distance = d; }
      }
      connect(i, nearest);
    }

    // Semantic links are separate from the dense artistic cortex links. They are
    // used by the renderer for meaningful NARA region-to-region traffic.
    const semanticLinks = [], semanticSeen = new Set();
    for (const region of regions) for (const targetId of region.connections) {
      if (!(targetId in regionIndex)) continue;
      const a = regionIndex[region.id], b = regionIndex[targetId];
      const key = [a,b].sort((x,y)=>x-y).join(':');
      if (!semanticSeen.has(key)) {
        semanticSeen.add(key);
        semanticLinks.push({a,b,from:region.id,to:targetId});
      }
    }

    const nearestBrainNode = region => {
      let best = 0, bestDistance = Infinity;
      for (let i = 0; i < brainCount; i++) {
        const node = nodes[i];
        const d = Math.hypot(node.x-region.x,node.y-region.y,node.z-region.z);
        if (d < bestDistance) { best = i; bestDistance = d; }
      }
      return best;
    };
    for (const region of regions) region.anchorNode = nearestBrainNode(region);

    // Nine visible data-spine lanes now terminate at meaningful NARA regions
    // instead of arbitrary cortical points.
    const stemTargets = ['NARA_CORE','REASONER','PLANNER','MEMORY','BUG_HUNTER','AGENT_MANAGER','TOOLS','SYNC','ONLINE'];
    for (let lane = 0; lane < stemTargets.length; lane++) {
      const ids = [], region = regions[regionIndex[stemTargets[lane]]];
      const targetIndex = region.anchorNode, target = nodes[targetIndex];
      for (let i = 0; i <= 18; i++) {
        const t = i / 18, spread = (lane - 4) * 0.028;
        const x = spread * (1 - t) + target.x * t * t + Math.sin(t * Math.PI * 2 + lane) * 0.012 * Math.sin(t * Math.PI);
        const id = nodes.push({
          x,
          y: 0.75 * (1 - t) + target.y * t,
          z: 0.07 * (1 - t) + target.z * t,
          region:'stem',
          targetRegion:region.id,
          digit:(i + lane) % 2
        }) - 1;
        ids.push(id);
        if (i) connect(ids[i - 1], id);
      }
      connect(ids.at(-1), targetIndex);
      paths.push(ids);
    }

    return {
      nodes,links,paths,brainCount,regions,semanticLinks,regionIndex,
      regionIds:regions.map(region=>region.id)
    };
  }

  global.NeuralCore = {
    create,
    regionIds:REGION_DEFINITIONS.map(item=>item[0])
  };
})(typeof window === 'undefined' ? globalThis : window);
