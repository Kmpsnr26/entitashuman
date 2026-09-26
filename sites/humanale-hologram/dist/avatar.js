(function exposeAvatarEngine(global) {
  const R = global.FaceRig;
  const TAU = Math.PI * 2;
  const { clamp, smooth, depthAt, normalAt, EYE_X, EYE_Y, EYE_HALF, EYE_UPPER, EYE_LOWER, MOUTH_Y } = R;
  const lerp = (a, b, t) => a + (b - a) * t;
  const seeded = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const PALETTES = {
    black: { hue: 0, sat: 0, light: 4, name: 'BLACK' },
    cyan: { hue: 192, sat: 72, light: 77, name: 'CYAN' },
    violet: { hue: 266, sat: 66, light: 76, name: 'VIOLET' },
    emerald: { hue: 153, sat: 62, light: 69, name: 'EMERALD' },
    amber: { hue: 40, sat: 82, light: 71, name: 'AMBER' }
  };
  const EMOTIONS = {
    neutral: { smile: 0, eye: 1, brow: 0, energy: 0.4 },
    angry: { smile: -0.18, eye: 0.82, brow: 0.022, energy: 0.55 },
    annoyed: { smile: -0.14, eye: 0.90, brow: 0.012, energy: 0.42 },
    happy: { smile: 0.8, eye: 0.82, brow: -0.015, energy: 0.7 },
    sad: { smile: -0.55, eye: 0.86, brow: 0.022, energy: 0.3 },
    surprised: { smile: 0, eye: 1.18, brow: -0.03, energy: 0.85 },
    thinking: { smile: 0.1, eye: 0.91, brow: -0.01, energy: 0.45 }
  };

  class NeuralAvatar {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      // Present a complete frame: low-latency desynchronized canvases can show
      // the clear before all of the face's glyphs have been drawn.
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.popup = Boolean(options.popup);
      this.animate = true;
      this.flow = true;
      this.externalSpeech = null;
      this.paused = Boolean(options.paused);
      this.disposed = false;
      this.listeners = new AbortController();
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.environmentQuery = matchMedia('(prefers-color-scheme: light)');
      this.environment = 'auto';
      this.accent = 'cyan';
      this.material = 'hybrid';
      this.emotionName = 'neutral';
      this.emotion = { ...EMOTIONS.neutral };
      this.targetEmotion = { ...this.emotion };
      this.density = 1;
      this.speaking = false;
      this.speechEnergy = 0;
      this.presence = 0;
      this.visibleTarget = false;
      this.presenceTransition = null;
      this.pointer = { x: 0, y: 0, active: false, magnet: false };
      this.gaze = { x: 0, y: 0 };
      this.headPose = { yaw: 0, pitch: 0, roll: 0 };
      this.neckPose = { yaw: 0, pitch: 0 };
      this.poseVelocity = { yaw: 0, pitch: 0, roll: 0 };
      this.neckVelocity = { yaw: 0, pitch: 0 };
      this.breath = 0;
      this.currentBlink = 0;
      this.nextBlink = performance.now() + 3100;
      this.blinkStart = -1;
      this.random = seeded(240926);
      this.last = performance.now();
      this.fps = 60;
      this.frame = 0;
      this.running = !this.paused;
      this.frameRequest = null;
      this.streams = Array.from({ length: 46 }, () => ({
        x: (this.random() > 0.5 ? 1 : -1) * (0.46 + this.random() * 0.21),
        phase: this.random() * TAU, speed: 0.012 + this.random() * 0.008,
        digit: this.random() > 0.5 ? '1' : '0'
      }));
      this.glyphCache = null;
      this.zoom = 1; this.zoomTarget = 1;
      this.backdrop = null;
      this.neuralCore = global.NeuralCore.create();
      this.brainState = { selectedRegion:'NARA_CORE', regions:{} };
      this.sensoryState = {
        hearing:{active:false,energy:0,low:0,mid:0,high:0},
        vision:{active:false,activity:0,frameId:null},
        speech:{active:false,energy:0}
      };
      this.dataSpineState={version:1,lanes:{},packets:[],updatedAt:0};
      this.brainRegionScreen = [];
      this.facePoints = this.buildFallback();
      this.setVisible(true, { initial: true });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
      if (options.bindPointer !== false) this.bindPointer();
      this.environmentQuery.addEventListener('change', () => this.updateCssAccent(), { signal: this.listeners.signal });
      document.addEventListener('visibilitychange', () => {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = null;
        this.running = !document.hidden && !this.paused && !this.disposed;
        if (this.running) {
          this.last = performance.now();
          this.frameRequest = requestAnimationFrame((t) => this.render(t));
        }
      });
      this.updateCssAccent();
      this.frameRequest = requestAnimationFrame((t) => this.render(t));
    }

    makePoint(x, y, intensity, hash, feature = '', extra = {}) {
      // Lips inherit the face lattice and material, never a separate overlay.
      const mouth = R.mouthWeights(x,y);
      if (!feature && Math.abs(x) < 0.20 && mouth.influence > 0.22) {
        feature = y < mouth.seam ? 'lip-upper' : 'lip-lower';
        const body = Math.max(mouth.upper, mouth.lower);
        intensity = lerp(intensity, 0.24 + body * 0.055, mouth.influence * 0.88);
      }
      return {
        mouthWeight: mouth.influence,
        x, y, z: depthAt(x, y), intensity, normal: normalAt(x, y),
        phase: hash() * TAU, type: hash(), keep: hash(), digit: hash() > 0.5 ? 1 : 0,
        feature, baseX: x, baseY: y, ...extra
      };
    }

    addFacialCode(points, hash) {
      const add = (x, y, intensity, feature, extra = {}) => {
        points.push(this.makePoint(x, y, intensity, hash, feature, { keep: hash() * 0.22, ...extra }));
      };
      for (const side of [-1, 1]) {
        const cx = side * EYE_X, cy = EYE_Y;
        const socket = depthAt(cx, cy);
        for (let i = 0; i <= 36; i++) {
          const t = i / 18 - 1, a = Math.sqrt(Math.max(0, 1 - t*t));
          for (let band = 0; band < 4; band++) {
            const f = (band + hash()*0.4)/4;
            const x = cx + t*(EYE_HALF+f*0.008);
            const upperY = cy - a*(EYE_UPPER+f*0.020);
            const lowerY = cy + a*(EYE_LOWER+f*0.017);
            const feather = (0.60+a*0.40)*(0.9-f*0.35);
            add(x,upperY,0.33*feather,'eye-upper',{eyeSide:side,lidWeight:1-f*0.74,z:depthAt(x,upperY)+0.004,size:0.77});
            add(x,lowerY,0.28*feather,'eye-lower',{eyeSide:side,lidWeight:1-f*0.74,z:depthAt(x,lowerY)+0.003,size:0.77});
          }
        }
        // A curved binary eyeball sits INSIDE the recess, with no pupil dot.
        for (let row = -5; row <= 5; row++) for (let col = -15; col <= 15; col++) {
          const dx = col*0.0055, dy = row*0.0047;
          const a = Math.sqrt(Math.max(0,1-(dx/EYE_HALF)**2));
          if (dy < -a*EYE_UPPER || dy > a*EYE_LOWER) continue;
          const sphere = Math.sqrt(Math.max(0,1-(dx/0.092)**2-(dy/0.085)**2));
          const z = socket - 0.020 + sphere*0.048;
          add(cx+dx,cy+dy,0.34+sphere*0.18,'eye-surface',{
            eyeSide:side,z,size:0.83,binary:true,
            normal:{x:dx/0.092,y:dy/0.085,z:sphere}
          });
        }
      }
      // A few low-energy code fragments suggest the oral cavity without a drawn line.
      for (let i = 0; i < 80; i++) {
        const x = (hash() - 0.5) * 0.28;
        const y = MOUTH_Y + (hash() - 0.5) * 0.012;
        add(x, y, 0.08, 'mouth-cavity', { z: depthAt(x, y) - 0.048, size: 0.62 });
      }
      // Discrete binary ear shells: no continuous path or image asset.
      for (const side of [-1, 1]) {
        const cx = side * 0.418, cy = 0.015;
        for (let ring = 0; ring < 2; ring++) {
          const rx = 0.038 - ring * 0.012, ry = 0.105 - ring * 0.026;
          for (let i = 0; i < 28; i++) {
            const angle = i / 28 * TAU;
            const x = cx + Math.cos(angle) * rx;
            const y = cy + Math.sin(angle) * ry;
            const rim = 0.5 + Math.cos(angle) * 0.5;
            add(x, y, 0.18 + rim * 0.11, 'ear-shell', {
              earSide: side,
              z: 0.105 + rim * 0.026 - ring * 0.008,
              size: ring ? 0.58 : 0.68,
              binary: true,
              normal: { x: side * 0.34, y: Math.sin(angle) * 0.18, z: 0.92 }
            });
          }
        }
      }
    }

    buildFallback() {
      const points = [], hash = seeded(529);
      for (let y = -0.68; y < 0.74; y += 0.009) {
        for (let x = -0.44; x < 0.44; x += 0.009) {
          if ((x / 0.405) ** 2 + ((y + 0.085) / 0.63) ** 2 > 1) continue;
          const eye = [-1, 1].some((s) => ((x - s * EYE_X) / (EYE_HALF+0.004)) ** 2 + ((y - EYE_Y) / (EYE_UPPER+0.006)) ** 2 < 1);
          if (eye) continue;
          points.push(this.makePoint(x, y, 0.3 + hash() * 0.38, hash));
        }
      }
      this.addFacialCode(points, hash);
      return points.sort((a, b) => a.z - b.z);
    }

    setVisible(visible, options = {}) {
      if (this.presenceTransition) this.presenceTransition.resolve(false);
      this.visibleTarget = Boolean(visible);
      if (options.initial) this.presence = visible ? 0 : 1;
      const duration = Number(options.duration) || (this.reducedMotion ? 700 : (visible ? 1650 : 1250));
      return new Promise((resolve) => {
        this.presenceTransition = { from: this.presence, to: visible ? 1 : 0, start: performance.now(), duration, resolve };
      });
    }
    pointPresence(point) {
      const delay = (point.keep || 0) * 0.19;
      return clamp((this.presence - delay) / (1 - delay), 0, 1);
    }
    setPointer(x, y, active = true, magnet = true) {
      this.pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), active, magnet };
    }
    bindPointer() {
      this.canvas.addEventListener('pointermove', (event) => {
        const rect = this.canvas.getBoundingClientRect();
        this.setPointer((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
      });
      this.canvas.addEventListener('wheel', event => {
        event.preventDefault();
        this.setZoom(this.zoomTarget * Math.exp(-clamp(event.deltaY, -120, 120) * 0.0018));
      }, { passive: false });
      this.canvas.addEventListener('dblclick', () => this.setZoom(1));
      this.canvas.addEventListener('pointerleave', () => {
        this.pointer.magnet = false;
        if (!global.naraDesktop) this.pointer.active = false;
      });
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * this.dpr));
      const height = Math.max(1, Math.round(rect.height * this.dpr));
      // Assigning either canvas dimension clears it, even when unchanged.
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.width = rect.width; this.height = rect.height;
      this.scale = Math.min(rect.width / 1.32, rect.height / 1.78);
      this.cx = rect.width / 2; this.cy = rect.height * 0.48;
    }
    setPaused(value = false) {
      if (this.disposed) return;
      this.paused = Boolean(value);
      this.running = !this.paused && !document.hidden;
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
      if (this.running) { this.last = performance.now(); this.frameRequest = requestAnimationFrame(t=>this.render(t)); }
    }
    destroy() {
      this.disposed = true; this.running = false;
      cancelAnimationFrame(this.frameRequest); this.frameRequest = null;
      this.resizeObserver.disconnect(); this.listeners.abort();
      if (this.presenceTransition) this.presenceTransition.resolve(false);
    }
    setEmotion(name) { if (EMOTIONS[name]) { this.emotionName = name; this.targetEmotion = { ...EMOTIONS[name] }; } }
    setMaterial(value) { if (['hybrid', 'binary', 'neural', 'cubes'].includes(value)) this.material = value; }
    setDensity(value) { this.density = clamp(Number(value) / 100, 0.3, 1); }
    setEnvironment(value = 'auto') { this.environment = value; this.updateCssAccent(); }
    setAccent(value = 'cyan') { this.accent = value; this.updateCssAccent(); }
    setZoom(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      this.zoomTarget = clamp(n, 1, 3.8);
      this.onZoom?.(this.zoomTarget);
    }
    setBrainState(snapshot = {}) {
      const next = {};
      for (const region of this.neuralCore.regions || []) {
        const source = snapshot?.regions?.[region.id] || {};
        next[region.id] = {
          id: region.id,
          status: String(source.status || 'idle').slice(0, 40),
          activity: clamp(source.activity),
          message: String(source.message || '').slice(0, 160),
          lastEvent: String(source.lastEvent || '').slice(0, 100),
          updatedAt: Number(source.updatedAt) || 0
        };
      }
      const selected = this.neuralCore.regionIndex?.[snapshot?.selectedRegion] !== undefined
        ? snapshot.selectedRegion
        : this.brainState?.selectedRegion || 'NARA_CORE';
      const hearing=snapshot?.sensory?.hearing||{},vision=snapshot?.sensory?.vision||{},speech=snapshot?.sensory?.speech||{};
      this.sensoryState={
        hearing:{
          active:Boolean(hearing.active),energy:clamp(hearing.energy),
          low:clamp(hearing.low),mid:clamp(hearing.mid),high:clamp(hearing.high)
        },
        vision:{active:Boolean(vision.active),activity:clamp(vision.activity),frameId:vision.frameId??null},
        speech:{active:Boolean(speech.active),energy:clamp(speech.energy)}
      };
      this.brainState = { selectedRegion:selected, regions:next };
      this.onBrainState?.(this.brainState);
    }
    setDataSpineState(snapshot = {}) {
      const laneIds=new Set((this.neuralCore.spineLanes||[]).map(lane=>lane.id));
      const lanes={};
      for(const meta of this.neuralCore.spineLanes||[]){
        const source=snapshot?.lanes?.[meta.id]||{};
        lanes[meta.id]={
          id:meta.id,region:meta.region,label:meta.label,
          status:String(source.status||'idle').slice(0,40),
          activity:clamp(source.activity),
          lastEvent:String(source.lastEvent||'').slice(0,100),
          updatedAt:Number(source.updatedAt)||0,
          packetCount:Math.max(0,Math.min(160,Number(source.packetCount)||0))
        };
      }
      const packets=(Array.isArray(snapshot?.packets)?snapshot.packets:[])
        .filter(packet=>laneIds.has(packet?.laneId))
        .slice(-160)
        .map(packet=>({
          id:Number(packet.id)||0,
          laneId:String(packet.laneId),
          event:String(packet.event||'').slice(0,120),
          glyph:String(packet.glyph||'01').slice(0,3),
          direction:packet.direction==='down'?'down':'up',
          bornAt:Number(packet.bornAt)||0,
          ttl:Math.max(400,Math.min(6000,Number(packet.ttl)||2200))
        }));
      this.dataSpineState={version:1,lanes,packets,updatedAt:Number(snapshot?.updatedAt)||0};
      this.onDataSpineState?.(this.dataSpineState);
    }
    selectBrainRegion(id = '') {
      if (this.neuralCore.regionIndex?.[id] === undefined) return false;
      this.brainState = { ...(this.brainState || {}), selectedRegion:id };
      this.onBrainRegionSelect?.(id);
      return true;
    }
    brainRegionState(id = '') {
      return this.brainState?.regions?.[id] || { id, status:'idle', activity:0, message:'', lastEvent:'' };
    }
    brainStatusColor(status, point, alpha = 1, time = 0) {
      const base = this.palette(time);
      const hues = {
        active:188, processing:196, thinking:204, connected:150, complete:136,
        syncing:278, login_required:42, error:8, bug:334, disconnected:220,
        offline:220, listening:174, seeing:202, speaking:266, ready:188, paused:38
      };
      const hue = hues[status] ?? base.hue;
      const saturation = ['offline','disconnected','idle'].includes(status) ? 18 : Math.max(48, base.sat);
      const lightness = this.lightAt(point.x,point.y) ? 24 : (status==='error'||status==='bug' ? 67 : 74);
      return 'hsla('+hue+' '+saturation+'% '+lightness+'% / '+clamp(alpha,0,1)+')';
    }
    pickBrainRegion(clientX, clientY) {
      if (Math.max(this.zoom,this.zoomTarget) < 2.25 || !this.brainRegionScreen?.length) return null;
      const rect = this.canvas.getBoundingClientRect();
      const x = Number(clientX) - rect.left, y = Number(clientY) - rect.top;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      let best = null, distance = Infinity;
      for (const region of this.brainRegionScreen) {
        const d = Math.hypot(x-region.x,y-region.y);
        if (d < distance && d <= region.hitRadius) { best = region; distance = d; }
      }
      return best?.id || null;
    }
    setBackdrop(grid) {
      if (!grid || !Number.isInteger(grid.columns) || !Number.isInteger(grid.rows) ||
          grid.columns < 1 || grid.rows < 1 || grid.columns > 64 || grid.rows > 64 ||
          grid.values?.length !== grid.columns * grid.rows ||
          grid.values.some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))) return;
      const old = this.backdrop;
      this.backdrop = { columns: grid.columns, rows: grid.rows, values: grid.values.map((value, i) => {
        const v = value ?? (this.environmentQuery.matches ? 1 : 0);
        return old?.values.length === grid.values.length ? lerp(old.values[i], v, 0.72) : v;
      }), received: performance.now() };
    }
    lightAt(x = this.width / 2, y = this.height / 2) {
      if (this.environment !== 'auto' || !this.backdrop || performance.now() - this.backdrop.received > 5500)
        return this.isLightEnvironment();
      const g = this.backdrop;
      const gx = clamp(x / this.width * g.columns - 0.5, 0, g.columns - 1);
      const gy = clamp(y / this.height * g.rows - 0.5, 0, g.rows - 1);
      const ix = Math.floor(gx), iy = Math.floor(gy), jx = Math.min(ix + 1, g.columns - 1), jy = Math.min(iy + 1, g.rows - 1);
      const v = lerp(lerp(g.values[iy*g.columns+ix], g.values[iy*g.columns+jx], gx-ix),
        lerp(g.values[jy*g.columns+ix], g.values[jy*g.columns+jx], gx-ix), gy-iy);
      return v >= 0.53;
    }
    setSpeaking(active) { this.speaking = Boolean(active); }
    isLightEnvironment() { return this.environment === 'light' || this.environment === 'auto' && this.environmentQuery.matches; }
    palette(time = 0) {
      const base = PALETTES[this.accent] || PALETTES.cyan;
      return this.accent === 'adaptive' ? { ...base, hue: (192 + Math.sin(time * 0.000065) * 115 + 360) % 360, name: 'ADAPTIVE' } : base;
    }
    color(alpha, lightness = null, time = 0) {
      const p = this.palette(time);
      return 'hsla(' + p.hue + ' ' + p.sat + '% ' + (lightness ?? (this.isLightEnvironment() ? 25 : p.light)) + '% / ' + clamp(alpha, 0, 1) + ')';
    }
    updateCssAccent() {
      const p = this.palette();
      document.documentElement.style.setProperty('--accent', this.color(1, p.light));
      document.documentElement.style.setProperty('--accent-rgb', this.accent === 'violet' ? '185, 160, 244' : this.accent === 'emerald' ? '124, 227, 181' : this.accent === 'amber' ? '242, 209, 119' : '142, 225, 244');
      this.glyphCache = null;
    }
    blinkValue(time) {
      if (this.blinkStart < 0 && time >= this.nextBlink) this.blinkStart = time;
      if (this.blinkStart < 0) return 0;
      const age = time - this.blinkStart;
      if (age > 480) {
        this.blinkStart = -1;
        this.nextBlink = time + 3600 + this.random() * 3400;
        return 0;
      }
      return age < 145 ? smooth(0, 145, age) : 1 - smooth(175, 480, age);
    }
    update(time, dt) {
      const ease = 1 - Math.exp(-dt * 6);
      this.zoom = lerp(this.zoom, this.zoomTarget, 1 - Math.exp(-dt * 5));
      for (const key of Object.keys(this.emotion)) this.emotion[key] = lerp(this.emotion[key], this.targetEmotion[key], ease);
      const speech = this.externalSpeech !== null ? this.externalSpeech : this.speaking ? Math.max(0, Math.sin(time * 0.010) * 0.52 + Math.sin(time * 0.016) * 0.26 + 0.22) : 0;
      this.speechEnergy = lerp(this.speechEnergy, speech, 1 - Math.exp(-dt * 11));
      const idle = this.animate ? (this.reducedMotion ? 0.18 : 1) : 0;
      // A slow breath and uncorrelated micro-turn continue even while looking
      // at a stationary pointer. No sharp oscillation or random frame jitter.
      const yawTarget = (this.pointer.active ? this.pointer.x*(Math.PI/6) : 0) +
        (Math.sin(time*0.00031)*0.020 + Math.sin(time*0.000137)*0.010)*idle + (this.gestureYaw || 0);
      const pitchTarget = (this.pointer.active ? -this.pointer.y*0.14 : 0) +
        (Math.sin(time*0.00043)*0.012 + Math.sin(time*0.00019)*0.006)*idle + (this.gesturePitch || 0);
      const motionScale = this.reducedMotion ? 0.3 : 1;
      const targets = { yaw: yawTarget * motionScale, pitch: pitchTarget * motionScale, roll: (-yawTarget * 0.055 + Math.sin(time*0.00027)*0.009*idle) * motionScale };
      for (const axis of ['yaw', 'pitch', 'roll']) {
        const step = R.spring(this.headPose[axis], this.poseVelocity[axis], targets[axis], axis === 'roll' ? 5 : 7, dt);
        this.headPose[axis] = step.value; this.poseVelocity[axis] = step.velocity;
      }
      for (const axis of ['yaw', 'pitch']) {
        const step = R.spring(this.neckPose[axis], this.neckVelocity[axis], this.headPose[axis] * 0.18, 3.5, dt);
        this.neckPose[axis] = step.value; this.neckVelocity[axis] = step.velocity;
      }
      this.breath = Math.sin(time * 0.00105) * 0.0058 * idle;
      this.gaze.x = lerp(this.gaze.x, this.pointer.active ? this.pointer.x * 0.019 : 0, 1 - Math.exp(-dt * 12));
      this.gaze.y = lerp(this.gaze.y, this.pointer.active ? this.pointer.y * 0.010 : 0, 1 - Math.exp(-dt * 12));
      if (this.presenceTransition) {
        const tr = this.presenceTransition;
        const phase = clamp((time - tr.start) / tr.duration, 0, 1);
        this.presence = lerp(tr.from, tr.to, smooth(0, 1, phase));
        if (phase === 1) { this.presenceTransition = null; tr.resolve(true); }
      }
    }
    project(x, y, z = 0, time = 0, rotateHead = false) {
      if (!rotateHead) return { x: this.cx + x * this.scale, y: this.cy + y * this.scale, depth: z, scale: 1 };
      const p = R.deform(x, y, z, this.headPose, this.neckPose, this.breath);
      const camera = 2.9 - smooth(1, 3.8, this.zoom) * 1.65;
      const perspective = camera / Math.max(0.25, camera - (p.z - 0.24));
      const focus = smooth(1.1, 2.8, this.zoom) * 0.257;
      const scale = perspective * this.zoom;
      return { x: this.cx + p.x * scale * this.scale, y: this.cy + (p.y + focus) * scale * this.scale, depth: p.z, scale };
    }
    prepareGlyphs(time) {
      const palette = this.palette(time);
      const key = Math.round(palette.hue / 3) + ':' + this.accent;
      if (this.glyphCache?.key === key) return;
      const create = light => {
        const atlas = document.createElement('canvas');
        atlas.width = 16 * 24; atlas.height = 32 * 2;
        const c = atlas.getContext('2d');
        c.font = '24px "Cascadia Mono", Consolas, monospace';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const colors = [];
        for (let shade = 0; shade < 16; shade++) {
          // Light backdrops use genuine black/graphite code, including neural.
          const l = light || this.accent === 'black' ? 2 + (15 - shade) * 0.9 : 14 + shade * 5.25;
          colors[shade] = 'hsl(' + palette.hue + ' ' + (light ? 0 : palette.sat) + '% ' + l + '%)';
          c.fillStyle = colors[shade];
          for (let digit = 0; digit < 2; digit++) c.fillText(String(digit), shade * 24 + 12, digit * 32 + 16);
        }
        return { atlas, colors };
      };
      this.glyphCache = { key, dark: create(false), light: create(true) };
    }
    drawCore(c, time) {
      const visibility = smooth(1.18, 2.35, this.zoom) * this.presence;
      if (visibility < 0.002) { this.brainRegionScreen = []; return; }
      const graph = this.neuralCore, runtime = this.brainState?.regions || {};
      const selectedId = this.brainState?.selectedRegion || 'NARA_CORE';
      const chaos = 1 - this.presence;
      const projected = graph.nodes.map((p, i) => {
        const phase = i * 2.39996 + time * 0.0004;
        const spread = chaos * (0.12 + (i % 19) * 0.021);
        return this.project(p.x + Math.cos(phase) * spread, p.y + Math.sin(phase * 1.17) * spread,
          p.z - spread * 0.3, time, true);
      });
      const color = (p, shade = 12) => this.glyphCache[this.lightAt(p.x, p.y) ? 'light' : 'dark'].colors[shade];
      const stateForNode = node => runtime[node?.region === 'stem' ? node.targetRegion : node?.region] || {status:'idle',activity:0};
      c.lineWidth = Math.max(0.6, this.scale * 0.0013);
      for (const link of graph.links) {
        const a = projected[link.a], b = projected[link.b];
        const midpoint = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
        const activity = Math.max(stateForNode(graph.nodes[link.a]).activity||0,stateForNode(graph.nodes[link.b]).activity||0);
        c.globalAlpha = visibility * (0.10 + (a.depth + 0.05) * 0.28 + activity * 0.14);
        c.strokeStyle = color(midpoint, activity > .45 ? 13 : 10);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i], node = graph.nodes[i];
        if (node.region === 'stem') continue;
        const state = stateForNode(node), activity = clamp(state.activity);
        const selected = node.region === selectedId;
        const size = Math.max(1.3, this.scale * 0.0041 * p.scale) * (1 + activity*.22 + (selected ? .12 : 0));
        c.globalAlpha = visibility * clamp(0.28 + clamp(p.depth,0,.4) + activity*.32 + (selected ? .12 : 0),.16,.95);
        c.fillStyle = state.status && state.status !== 'idle'
          ? this.brainStatusColor(state.status,p,1,time)
          : color(p, 14);
        c.fillRect(p.x-size/2, p.y-size/2, size, size);
        if (i % 7 === 0) {
          const glyph = this.glyphCache[this.lightAt(p.x, p.y) ? 'light' : 'dark'];
          const h = Math.min(13, this.scale * 0.014 * p.scale);
          c.globalAlpha = visibility * (0.40 + activity*.28);
          c.drawImage(glyph.atlas, 12*24, node.digit*32, 24, 32, p.x+size, p.y-h/2, h*.75, h);
        }
      }

      // Phase 7 Data Spine: lanes glow from real BrainState status, while moving
      // packets exist only when the event-driven Data Spine engine emits them.
      const spine=this.dataSpineState||{lanes:{},packets:[]};
      for(let laneIndex=0;laneIndex<graph.paths.length;laneIndex++){
        const ids=graph.paths[laneIndex],meta=graph.spineLanes?.[laneIndex];
        if(!meta||!ids?.length)continue;
        const laneState=spine.lanes?.[meta.id]||{};
        const targetState=runtime[meta.region]||{status:'idle',activity:0};
        const lanePackets=(spine.packets||[]).filter(packet=>packet.laneId===meta.id);
        let packetActivity=0;
        for(const packet of lanePackets){
          const age=time-packet.bornAt;
          if(age>=0&&age<=packet.ttl)packetActivity=Math.max(packetActivity,1-age/packet.ttl);
        }
        const activity=Math.max(clamp(targetState.activity),packetActivity);
        const status=laneState.status||targetState.status||'idle';

        c.save();
        c.globalCompositeOperation=this.isLightEnvironment()?'source-over':'lighter';
        c.lineWidth=Math.max(.65,this.scale*(.00105+activity*.0015));
        c.strokeStyle=this.brainStatusColor(status,{x:this.cx,y:this.cy},1,time);
        c.globalAlpha=visibility*(.045+activity*.30+((status==='connected'||status==='syncing') ? .10 : 0));
        c.beginPath();
        for(let j=0;j<ids.length;j++){
          const node=graph.nodes[ids[j]],p=this.project(node.x,node.y,node.z,time,true);
          if(j)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);
        }
        c.stroke();

        for(const packet of lanePackets){
          const age=time-packet.bornAt;
          if(age<0||age>packet.ttl)continue;
          let phase=clamp(age/packet.ttl);
          if(packet.direction==='down')phase=1-phase;
          const index=phase*(ids.length-1),segment=Math.min(ids.length-2,Math.max(0,Math.floor(index)));
          const mix=index-segment;
          const aNode=graph.nodes[ids[segment]],bNode=graph.nodes[ids[segment+1]];
          const p=this.project(
            lerp(aNode.x,bNode.x,mix),
            lerp(aNode.y,bNode.y,mix),
            lerp(aNode.z,bNode.z,mix),
            time,true
          );
          const fade=smooth(0,.08,age/packet.ttl)*(1-smooth(.80,1,age/packet.ttl));
          const fontSize=Math.max(6,Math.min(12,this.scale*.013*p.scale));
          c.globalCompositeOperation='source-over';
          c.font='700 '+fontSize+'px "Cascadia Mono", Consolas, monospace';
          c.textAlign='center';c.textBaseline='middle';
          c.fillStyle=this.brainStatusColor(status,p,1,time);
          c.globalAlpha=visibility*fade*(.58+activity*.36);
          c.fillText(packet.glyph,p.x,p.y);
          c.globalCompositeOperation=this.isLightEnvironment()?'source-over':'lighter';
        }

        if(this.zoom>1.72){
          const baseNode=graph.nodes[ids[0]],base=this.project(baseNode.x,baseNode.y,baseNode.z,time,true);
          c.globalCompositeOperation='source-over';
          c.font='600 '+Math.max(6,Math.min(9,this.scale*.010))+'px "Cascadia Mono", Consolas, monospace';
          c.textAlign='center';c.textBaseline='top';
          c.fillStyle=this.brainStatusColor(status,base,1,time);
          c.globalAlpha=visibility*(.28+activity*.42);
          c.fillText(meta.label,base.x,base.y+5,58);
        }
        c.restore();
      }

      // Cortical signals now move only across regions that are actually active or selected.
      for (let i = 0; i < graph.links.length; i += 13) {
        const edge = graph.links[i];
        if (edge.a >= graph.brainCount || edge.b >= graph.brainCount) continue;
        const aNode=graph.nodes[edge.a],bNode=graph.nodes[edge.b];
        const sa=stateForNode(aNode),sb=stateForNode(bNode);
        const active=Math.max(clamp(sa.activity),clamp(sb.activity));
        const selected=aNode.region===selectedId||bNode.region===selectedId;
        if(active<.08&&!selected)continue;
        const a = projected[edge.a], b = projected[edge.b];
        const t = ((this.reducedMotion ? 0 : time*0.00016) + i*0.071) % 1;
        const p = {x:lerp(a.x,b.x,t), y:lerp(a.y,b.y,t)};
        c.globalAlpha = visibility * (.32+active*.50+(selected ? .12 : 0));
        c.fillStyle=this.brainStatusColor(active>=clamp(sb.activity)?sa.status:sb.status,p,1,time);
        c.fillRect(p.x-1,p.y-1,2,2);
      }

      // Deep zoom exposes the semantic NARA map. These anchors correspond to
      // real BrainState regions, while the surrounding cortex remains artistic.
      const deep = smooth(2.15,2.85,this.zoom) * this.presence;
      if (deep > .002 && graph.regions?.length) {
        const regionProjected = graph.regions.map(region => ({
          region,
          point:this.project(region.x,region.y,region.z,time,true)
        }));
        this.brainRegionScreen = regionProjected.map(({region,point})=>({
          id:region.id,x:point.x,y:point.y,depth:point.depth,
          hitRadius:Math.max(11,this.scale*.032*point.scale)
        }));

        c.save();
        c.globalCompositeOperation = this.isLightEnvironment() ? 'source-over' : 'lighter';
        c.lineWidth=Math.max(.8,this.scale*.00155);
        for (const edge of graph.semanticLinks || []) {
          const a=regionProjected[edge.a],b=regionProjected[edge.b];
          if(!a||!b)continue;
          const sa=runtime[a.region.id]||{activity:0,status:'idle'},sb=runtime[b.region.id]||{activity:0,status:'idle'};
          const active=Math.max(clamp(sa.activity),clamp(sb.activity));
          const selected=a.region.id===selectedId||b.region.id===selectedId;
          c.globalAlpha=deep*(.16+active*.34+(selected ? .20 : 0));
          c.strokeStyle=this.brainStatusColor(active>=clamp(sb.activity)?sa.status:sb.status,{x:(a.point.x+b.point.x)/2,y:(a.point.y+b.point.y)/2},1,time);
          c.beginPath();c.moveTo(a.point.x,a.point.y);c.lineTo(b.point.x,b.point.y);c.stroke();

          if(active>.08||selected){
            const phase=((this.reducedMotion?0:time*.00012)+edge.a*.071+edge.b*.037)%1;
            const x=lerp(a.point.x,b.point.x,phase),y=lerp(a.point.y,b.point.y,phase);
            const packet=Math.max(1.4,this.scale*.0035);
            c.globalAlpha=deep*(.52+active*.42);
            c.fillStyle=this.brainStatusColor(active>=clamp(sb.activity)?sa.status:sb.status,{x,y},1,time);
            c.fillRect(x-packet/2,y-packet/2,packet,packet);
          }
        }

        for (const {region,point} of regionProjected) {
          const state=runtime[region.id]||{status:'idle',activity:0,message:''};
          const activity=clamp(state.activity),selected=region.id===selectedId;
          const pulse=this.reducedMotion?1:.82+.18*Math.sin(time*.004+graph.regionIndex[region.id]);
          const size=Math.max(4.5,this.scale*.0105*point.scale)*(1+activity*.55+(selected ? .45 : 0))*pulse;
          c.save();
          c.translate(point.x,point.y);c.rotate(Math.PI/4);
          c.globalAlpha=deep*(.48+activity*.42+(selected ? .10 : 0));
          c.fillStyle=this.brainStatusColor(state.status,point,1,time);
          c.fillRect(-size/2,-size/2,size,size);
          if(selected){
            c.globalAlpha=deep*.92;c.lineWidth=Math.max(1,this.scale*.0022);
            c.strokeStyle=this.brainStatusColor(state.status,point,1,time);
            c.strokeRect(-size*.86,-size*.86,size*1.72,size*1.72);
          }
          c.restore();

          if (this.zoom > 2.68 || selected) {
            c.globalCompositeOperation='source-over';
            c.textAlign='center';c.textBaseline='top';
            const fontSize=Math.max(7,Math.min(12,this.scale*.016*point.scale));
            c.font='600 '+fontSize+'px "Cascadia Mono", Consolas, monospace';
            c.globalAlpha=deep*(selected ? .95 : .72);
            c.fillStyle=this.brainStatusColor(state.status,point,1,time);
            c.fillText(region.label,point.x,point.y+size*.82,Math.max(54,this.scale*.22));
            if(selected&&this.zoom>2.82){
              c.font=Math.max(6,fontSize*.72)+'px "Cascadia Mono", Consolas, monospace';
              c.globalAlpha=deep*.68;
              c.fillText(String(state.status||'idle').toUpperCase(),point.x,point.y+size*.82+fontSize+2,Math.max(54,this.scale*.22));
            }
            c.globalCompositeOperation=this.isLightEnvironment()?'source-over':'lighter';
          }
        }
        c.restore();
      } else this.brainRegionScreen = [];
      c.globalAlpha = 1;
    }
    render(time) {
      if (!this.running || this.disposed) return;
      const elapsed = Math.min(50, Math.max(1, time - this.last));
      this.last = time;
      this.fps = lerp(this.fps, 1000 / elapsed, 0.07);
      this.frame++;
      this.update(time, elapsed / 1000);
      this.currentBlink = this.blinkValue(time);
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.width, this.height);
      // Sparse ambient code stays quiet. Surface particles use normal alpha for volume.
      c.globalCompositeOperation = this.isLightEnvironment() ? 'source-over' : 'lighter';
      this.drawStreams(c, time);
      c.globalCompositeOperation = 'source-over';
      this.prepareGlyphs(time);
      this.drawCore(c, time);
      this.drawFace(c, time);
      this.drawSensorSignals(c,time);
      this.drawConvergingCode(c, time);
      this.onRender?.(c,time);
      c.globalAlpha = 1;
      if (this.onFrame && this.frame % 20 === 0) this.onFrame({ fps: Math.round(this.fps), palette: this.palette(time).name, points: this.facePoints.length });
      this.frameRequest = requestAnimationFrame((t) => this.render(t));
    }
    drawStreams(c, time) {
      c.globalCompositeOperation = 'source-over';
      c.font = '7px "Cascadia Mono", monospace';
      for (const s of this.streams) {
        const y = this.reducedMotion ? s.phase / TAU * 1.5 - 0.75 : ((time * s.speed * 0.0002 + s.phase) % 1.75) - 0.85;
        const p = this.project(s.x, y);
        c.fillStyle = this.lightAt(p.x, p.y) ? 'rgba(0,0,0,.17)' : this.color(0.13);
        c.globalAlpha = this.presence * (1 - smooth(1.1, 2.5, this.zoom));
        c.fillText(s.digit, p.x, p.y);
      }
    }
    flowPosition(lane, phase) {
      const startY = 0.76, endY = -0.35;
      const side = lane % 2 ? 1 : -1;
      const envelope = Math.sin(phase*Math.PI);
      const x = side*(0.10 + lane%5*0.058)*(1-phase) + Math.sin(phase*TAU+lane)*0.024*envelope;
      const y = lerp(startY,endY,phase);
      const z = depthAt(x,y) + 0.008 - smooth(0.74,1,phase)*0.26;
      return {x,y,z};
    }
    drawSensorSignals(c,time) {
      const shell=1-smooth(1.35,2.78,this.zoom);
      if(shell<.003)return;
      const hearing=this.sensoryState?.hearing||{},vision=this.sensoryState?.vision||{},speech=this.sensoryState?.speech||{};
      c.save();
      c.globalCompositeOperation=this.isLightEnvironment()?'source-over':'lighter';
      c.lineCap='round';

      if(hearing.active&&hearing.energy>.006){
        const bands=[clamp(hearing.low),clamp(hearing.mid),clamp(hearing.high)];
        for(const side of [-1,1]){
          const center=this.project(side*.355,-.105,.045,time,true);
          for(let band=0;band<3;band++){
            const energy=bands[band]||hearing.energy;
            const phase=this.reducedMotion?0:Math.sin(time*(.0022+band*.0005)+side*band);
            const radius=Math.max(8,this.scale*(.030+band*.017))*center.scale*(1+energy*.28+phase*.035);
            c.globalAlpha=shell*(.12+energy*.58);
            c.lineWidth=Math.max(.8,this.scale*(.0014+energy*.0016));
            c.strokeStyle=this.brainStatusColor('listening',center,1,time);
            c.beginPath();
            const start=side<0?Math.PI*.62:-Math.PI*.38;
            const end=side<0?Math.PI*1.38:Math.PI*.38;
            c.arc(center.x,center.y,radius,start,end,side>0);
            c.stroke();
          }
        }
      }

      if(vision.active){
        const activity=clamp(vision.activity);
        for(const side of [-1,1]){
          const eye=this.project(side*EYE_X,EYE_Y,.19,time,true);
          const radius=Math.max(5,this.scale*.016*eye.scale)*(1+activity*.28);
          c.globalAlpha=shell*(.28+activity*.52);
          c.lineWidth=Math.max(.7,this.scale*.0014);
          c.strokeStyle=this.brainStatusColor('seeing',eye,1,time);
          c.beginPath();c.arc(eye.x,eye.y,radius,0,TAU);c.stroke();
          const sweep=this.reducedMotion?0:Math.sin(time*.004+side);
          c.beginPath();c.moveTo(eye.x-radius,eye.y+sweep*radius*.45);c.lineTo(eye.x+radius,eye.y-sweep*radius*.45);c.stroke();
        }
      }

      if(speech.active||this.speaking){
        const energy=Math.max(clamp(speech.energy),this.speechEnergy);
        if(energy>.01){
          const mouth=this.project(0,MOUTH_Y+.035,.15,time,true);
          for(let ring=0;ring<2;ring++){
            const phase=this.reducedMotion?.5:((time*.00042+ring*.5)%1);
            const radius=Math.max(7,this.scale*.018)*(1+phase*2.2)*(1+energy*.38);
            c.globalAlpha=shell*(1-phase)*(.12+energy*.38);
            c.lineWidth=Math.max(.7,this.scale*.00125);
            c.strokeStyle=this.brainStatusColor('speaking',mouth,1,time);
            c.beginPath();c.arc(mouth.x,mouth.y,radius,Math.PI*.16,Math.PI*.84);c.stroke();
          }
        }
      }
      c.restore();
    }
    drawConvergingCode(c,time) {
      if (!this.flow || !this.animate) return;
      const shell = 1-smooth(1.3,2.65,this.zoom);
      const clock = time * (this.reducedMotion ? 0.000009 : 0.000032) * (this.flowEnergy || 1);
      for (let lane=0;lane<14;lane++) for(let packet=0;packet<4;packet++) {
        const phase = (clock+packet/4+lane*0.071)%1;
        const q = this.flowPosition(lane,phase), p = this.project(q.x,q.y,q.z,time,true);
        const glyph = this.glyphCache[this.lightAt(p.x,p.y)?'light':'dark'];
        const h = Math.max(4,Math.min(12,this.scale*0.016*p.scale));
        const fade = smooth(0,.12,phase)*(1-smooth(.86,1,phase));
        const anatomical = R.bump(q.x,q.y,0,MOUTH_Y,.25,.10) +
          R.bump(q.x,q.y,-EYE_X,EYE_Y,.12,.07) + R.bump(q.x,q.y,EYE_X,EYE_Y,.12,.07);
        c.globalAlpha = this.presence*shell*fade*(0.34-Math.min(.22,anatomical*.22));
        c.drawImage(glyph.atlas,12*24,((packet+lane)%2)*32,24,32,p.x-h*.375,p.y-h/2,h*.75,h);
      }
      c.globalAlpha=1;
    }
    transformFacePoint(point) {
      return point;
    }
    faceVisualTuning() {
      return { lightIntensity:1, particleScale:1 };
    }
    drawFace(c, time) {
      const points = this.facePoints;
      const visual = this.faceVisualTuning?.() || {};
      const lightIntensity = clamp(Number(visual.lightIntensity) || 1, .7, 1.3);
      const particleScale = clamp(Number(visual.particleScale) || 1, .75, 1.25);
      const shell = 1 - smooth(1.28, 2.65, this.zoom);
      if (shell < 0.003) return;
      const cosYaw = Math.cos(this.headPose.yaw), sinYaw = Math.sin(this.headPose.yaw);
      const cosPitch = Math.cos(this.headPose.pitch), sinPitch = Math.sin(this.headPose.pitch);
      const pointerFaceX = this.pointer.x * this.width / (2 * this.scale);
      const pointerFaceY = (this.pointer.y * this.height / 2 + this.height / 2 - this.cy) / this.scale;
      for (const pt of points) {
        if (pt.keep > this.density) continue;
        const localPresence = this.pointPresence(pt);
        if (localPresence < 0.015) continue;
        let x = pt.x, y = pt.y, z = pt.z, opacity = 1;
        const feature = pt.feature;
        const open = this.emotion.eye;
        if (feature.startsWith('eye-')) {
          opacity *= feature === 'eye-surface' ? 0.90 : 0.60;
          const cx = pt.eyeSide * EYE_X;
          if (feature === 'eye-surface') { x += this.gaze.x * 0.22; y += this.gaze.y * 0.14; }
          const t = clamp((x - cx) / EYE_HALF, -1, 1), a = Math.sqrt(Math.max(0, 1 - t * t));
          const seam = EYE_Y + a * 0.007;
          const upper = lerp(EYE_Y - a * EYE_UPPER * open, seam, this.currentBlink);
          const lower = lerp(EYE_Y + a * EYE_LOWER * open, seam, this.currentBlink);
          if (feature === 'eye-upper' || feature === 'eye-lower') {
            const base = EYE_Y + (pt.y - EYE_Y) * open;
            const factor = feature === 'eye-upper' ? 1 : 0.86;
            y = lerp(base, seam + (pt.y - EYE_Y) * 0.035, this.currentBlink * factor * (pt.lidWeight ?? 1));
            z += this.currentBlink * 0.009;
          } else {
            // Clip the eyeball at the animated eyelids instead of flattening its sphere.
            if (y < upper || y > lower || this.currentBlink > 0.97) continue;
            opacity *= smooth(0, 0.005, y - upper) * smooth(0, 0.005, lower - y);
          }
        } else if (feature.startsWith('lip-') || feature === 'mouth-cavity') {
          const t = clamp(x / 0.20, -1, 1), a = 1 - t*t;
          const weights = R.mouthWeights(pt.baseX,pt.baseY);
          const jaw = this.speechEnergy*0.047 + (this.emotionName==='surprised'?0.021:0);
          // The same continuous skinning field deforms lips, muzzle and chin.
          const lower = smooth(weights.seam-0.008,weights.seam+0.008,pt.baseY);
          y += jaw*weights.influence*(lower*0.86-0.16);
          z -= this.speechEnergy*weights.influence*lower*0.007;
          x *= 1-this.speechEnergy*0.018*weights.influence;
          y -= this.emotion.smile*Math.abs(t)**1.7*0.024*weights.influence;
          if(feature==='mouth-cavity') opacity=0.20;
        } else {
          for (const side of [-1, 1]) {
            const d = ((x - side * EYE_X) / 0.15) ** 2 + ((y - EYE_Y) / 0.10) ** 2;
            if (d < 1) y += (y < EYE_Y ? 0.015 : -0.007) * this.currentBlink * (1 - d) ** 2;
          }
          const jawWeight = R.bump(x, y, 0, 0.405, 0.25, 0.17);
          y += this.speechEnergy * 0.019 * jawWeight;
          z -= this.speechEnergy * 0.007 * jawWeight;
        }
        const chaos = 1 - localPresence;
        if (chaos > 0.002) {
          const orbit = pt.phase + time * (0.0003 + pt.type * 0.0008);
          const d = (0.2 + pt.type * 0.8) * chaos ** 0.75 * (this.reducedMotion ? 0.45 : 1);
          x += Math.cos(orbit) * d; y += Math.sin(orbit * 1.19) * d * 0.75; z -= chaos * 0.16;
          const glitchBand = Math.sin(pt.y * 43 + time * 0.002 + pt.phase);
          if (glitchBand > 0.7) x += glitchBand * chaos * 0.12;
        }
        const useBinary = pt.binary || this.material === 'binary' || this.material === 'hybrid' && pt.type < 0.3;
        if (useBinary && !pt.feature && this.pointer.magnet && localPresence > 0.9) {
          const dx = pointerFaceX - x, dy = pointerFaceY - y, d = Math.hypot(dx, dy);
          const anatomyGuard = Math.abs(y - EYE_Y) < 0.10 || Math.abs(y - MOUTH_Y) < 0.10 ? 0.15 : 1;
          if (d > 0.001 && d < 0.2) {
            const magnet = (1 - d / 0.2) ** 2 * 0.022 * anatomyGuard;
            x += dx / d * magnet; y += dy / d * magnet;
          }
        }
        const tuned = this.transformFacePoint({
          x, y, z, feature,
          baseX: pt.baseX, baseY: pt.baseY,
          eyeSide: pt.eyeSide, earSide: pt.earSide
        }) || { x, y, z };
        x = Number.isFinite(tuned.x) ? tuned.x : x;
        y = Number.isFinite(tuned.y) ? tuned.y : y;
        z = Number.isFinite(tuned.z) ? tuned.z : z;
        const p = this.project(x, y, z, time, true);
        const light = this.lightAt(p.x, p.y);
        const glyph = this.glyphCache[light ? 'light' : 'dark'];
        const n = pt.normal;
        const nx = n.x * cosYaw + n.z * sinYaw;
        const nz = -n.x * sinYaw + n.z * cosYaw;
        const ny = n.y * cosPitch - nz * sinPitch;
        const front = n.y * sinPitch + nz * cosPitch;
        const diffuse = clamp(nx * -0.32 + ny * -0.42 + front * 0.85, 0, 1);
        const lighting = 0.36 + diffuse * 0.64;
        const intensity = pt.intensity;
        let shade = clamp(Math.round(4 + intensity * 8 + diffuse * 3), 0, 15);
        let alpha = (0.17 + intensity * 0.82) * lighting * localPresence * opacity * lightIntensity;
        if (pt.outer) alpha *= 0.34;
        if (y > 0.52) alpha *= 1 - smooth(0.52, 0.81, y) * 0.53;
        if (feature === 'mouth-cavity') { shade = light ? 15 : 0; alpha = 0.22; }
        const depthScale = p.scale * (pt.size || 1) * particleScale;
        c.globalAlpha = clamp(alpha * shell * localPresence * (light && !pt.outer ? 1.55 : 1), 0, 0.97);
        if (useBinary) {
          const size = clamp(this.scale * 0.0175 * depthScale, feature ? 2.1 : 3.6, 11.4);
          c.drawImage(glyph.atlas, shade * 24, pt.digit * 32, 24, 32, p.x - size * 0.375, p.y - size * 0.5, size * 0.75, size);
        } else if (this.material === 'cubes' || this.material === 'hybrid' && pt.type > 0.8) {
          const size = Math.max(0.7, this.scale * 0.0053 * depthScale);
          c.fillStyle = glyph.colors[shade];
          c.fillRect(p.x - size / 2, p.y - size / 2, size, size);
          if (size > 2 && intensity > 0.58) {
            c.fillStyle = glyph.colors[Math.max(0, shade - 4)];
            c.fillRect(p.x + size / 2, p.y - size / 2 + 0.4, size * 0.28, size);
          }
        } else {
          const size = Math.max(0.58, this.scale * 0.0038 * depthScale);
          c.fillStyle = glyph.colors[shade];
          c.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        }
      }
      c.globalAlpha = 1;
    }
  }
  global.NeuralAvatar = NeuralAvatar;
  global.NEURAL_AVATAR_EMOTIONS = Object.keys(EMOTIONS);
})(typeof window === 'undefined' ? globalThis : window);
