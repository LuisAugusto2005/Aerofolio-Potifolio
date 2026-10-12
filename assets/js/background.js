/* =========================================================
   Fundo aquático
   - shader WebGL: céu/água, aurora estilo Vista, raios de luz,
     cáusticas e ondulações que reagem ao cursor e aos cliques
   - canvas 2D: bolhas de sabão que sobem, fogem do cursor e estouram
   - Aero.onFrame: um único requestAnimationFrame para o site todo
   ========================================================= */
(() => {
  'use strict';

  const Aero = (window.Aero = window.Aero || {});
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  Aero.reduceMotion = reduceMotion;

  const TAU = Math.PI * 2;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  Aero.now = now;

  /* ---------- qualidade adaptativa ----------
     Começa no máximo (ou num degrau abaixo em hardware modesto) e,
     se o FPS real ficar baixo por alguns segundos, desce um degrau.
     Em máquinas boas nada muda. */
  const TIERS = [
    { name: 'high', water: 0.6, dpr: 2, bubbles: 1, waterEvery: 1 },
    { name: 'mid', water: 0.45, dpr: 1.25, bubbles: 0.8, waterEvery: 1 },
    { name: 'low', water: 0.34, dpr: 1, bubbles: 0.6, waterEvery: 2 },
  ];
  let tier = (() => {
    let t = 0;
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    if (cores <= 4 || mem <= 4 || innerWidth < 760) t = 1;
    if (cores <= 2 || mem <= 2) t = 2;
    try {
      const saved = TIERS.findIndex((x) => x.name === sessionStorage.getItem('aero-quality'));
      if (saved > t) t = saved;
    } catch (e) { /* sem storage */ }
    return t;
  })();
  const Q = () => TIERS[tier];
  document.documentElement.dataset.quality = Q().name;
  Aero.quality = () => Q().name;

  const mon = { sum: 0, n: 0, since: performance.now() + 3500 };
  function monitor(rawMs) {
    const nowMs = performance.now();
    if (rawMs > 250) { mon.sum = 0; mon.n = 0; mon.since = nowMs; return; } // aba trocada etc.
    if (nowMs < mon.since) return;
    mon.sum += rawMs;
    mon.n++;
    if (nowMs - mon.since < 2500 || mon.n < 20) return;
    const avg = mon.sum / mon.n;
    mon.sum = 0;
    mon.n = 0;
    mon.since = nowMs;
    if (avg > 23 && tier < TIERS.length - 1) setTier(tier + 1);
  }
  function setTier(t) {
    tier = t;
    document.documentElement.dataset.quality = Q().name;
    try { sessionStorage.setItem('aero-quality', Q().name); } catch (e) { /* sem storage */ }
    mon.since = performance.now() + 1500; // dá tempo de estabilizar antes de medir de novo
    resize();
  }

  /* ---------- ticker compartilhado ---------- */
  const frameFns = new Set();
  Aero.onFrame = (fn) => {
    frameFns.add(fn);
    return () => frameFns.delete(fn);
  };

  /* ---------- ponteiro ---------- */
  const pointer = (Aero.pointer = {
    x: innerWidth / 2, y: innerHeight / 2,
    sx: 0.5, sy: 0.5,          // posição suavizada (0..1) para o shader
    active: false,
    lastRipple: 0, rx: -999, ry: -999,
    tx: -999, ty: -999,        // último ponto onde nasceu bolha de rastro
  });

  /* =========================================================
     Shader de água
     ========================================================= */
  const MAX_RIPPLES = 10;
  const ripples = new Float32Array(MAX_RIPPLES * 4);
  let rippleIdx = 0;

  Aero.ripple = (x, y, strength = 1) => {
    if (reduceMotion) return;
    const o = rippleIdx * 4;
    ripples[o] = x / innerWidth;
    ripples[o + 1] = 1 - y / innerHeight;
    ripples[o + 2] = now();
    ripples[o + 3] = strength;
    rippleIdx = (rippleIdx + 1) % MAX_RIPPLES;
  };

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif

    uniform vec2 uRes;
    uniform float uTime;
    uniform vec2 uMouse;
    uniform vec4 uRip[${MAX_RIPPLES}];

    #define TAU 6.28318530718

    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

    // cáusticas tileáveis (iterativas)
    float caustic(vec2 uv, float t) {
      vec2 p = mod(uv * TAU, TAU) - 250.0;
      vec2 i = p;
      float c = 1.0;
      float inten = 0.005;
      for (int n = 0; n < 4; n++) {
        float tt = t * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
      }
      c /= 4.0;
      c = 1.17 - pow(c, 1.4);
      return clamp(pow(abs(c), 8.0), 0.0, 1.6);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2(uv.x * aspect, uv.y);
      float t = uTime;

      // --- ondulações (cursor e cliques)
      vec2 disp = vec2(0.0);
      float rl = 0.0;
      for (int k = 0; k < ${MAX_RIPPLES}; k++) {
        vec4 r = uRip[k];
        float age = t - r.z;
        if (r.w > 0.0 && age > 0.0 && age < 5.0) {
          vec2 d = p - vec2(r.x * aspect, r.y);
          float dist = length(d);
          float rad = age * 0.32;
          float env = exp(-pow((dist - rad) * 9.0, 2.0)) * exp(-age * 1.15) * r.w;
          float w = sin((dist - rad) * 55.0) * env;
          disp += (d / max(dist, 1e-4)) * w * 0.018;
          rl += w;
        }
      }
      vec2 q = p + disp;
      float gy = q.y;

      // --- céu
      vec3 low = vec3(0.07, 0.58, 0.88);
      vec3 mid = vec3(0.05, 0.46, 0.86);
      vec3 top = vec3(0.015, 0.19, 0.47);
      vec3 col = mix(low, mid, smoothstep(0.0, 0.55, gy));
      col = mix(col, top, smoothstep(0.5, 1.05, gy));

      // brilho do horizonte + gramado ao fundo
      col += vec3(0.55, 0.95, 1.0) * 0.16 * exp(-pow((gy - 0.27) * 4.0, 2.0));
      float meadow = smoothstep(0.30, 0.0, gy) * (0.55 + 0.45 * sin(q.x * 2.2 + t * 0.15));
      col = mix(col, vec3(0.45, 0.83, 0.30), meadow * 0.38);

      // --- raios de luz vindos do canto superior
      vec2 src = vec2(aspect * 0.16, 1.28);
      vec2 rd = q - src;
      float ang = atan(rd.x, -rd.y);
      float rays = 0.5 + 0.5 * sin(ang * 22.0 + sin(ang * 9.0 - t * 0.25) * 1.6 + t * 0.12);
      rays = pow(rays, 3.0) * smoothstep(1.7, 0.1, length(rd));
      col += vec3(0.75, 0.95, 1.0) * rays * 0.15;

      // --- aurora (as faixas de luz do Vista)
      float cx = q.x - aspect * 0.5;
      float c1 = 0.60 - 0.20 * cx + 0.07 * sin(q.x * 1.7 + t * 0.23) + 0.03 * sin(q.x * 3.9 - t * 0.31 + 1.7);
      float d1 = q.y - c1;
      col += vec3(0.70, 0.96, 1.0) * (exp(-d1 * d1 * 60.0) * 0.26 + exp(-d1 * d1 * 2600.0) * 0.42);
      col += vec3(0.85, 1.0, 1.0) * pow(0.5 + 0.5 * sin(d1 * 150.0 + q.x * 5.0 - t * 0.6), 6.0) * exp(-d1 * d1 * 140.0) * 0.10;

      float c2 = 0.42 - 0.12 * cx + 0.06 * sin(q.x * 2.3 - t * 0.19 + 2.0) + 0.025 * sin(q.x * 5.1 + t * 0.27);
      float d2 = q.y - c2;
      col += vec3(0.62, 0.95, 0.45) * (exp(-d2 * d2 * 90.0) * 0.20 + exp(-d2 * d2 * 3200.0) * 0.32);

      float c3 = 0.80 - 0.30 * cx + 0.05 * sin(q.x * 1.2 + t * 0.17 + 4.0);
      float d3 = q.y - c3;
      col += vec3(0.55, 0.80, 1.0) * exp(-d3 * d3 * 40.0) * 0.15;

      // --- cáusticas (mais fortes embaixo, como luz no fundo d'água)
      float cs = caustic(q * vec2(0.85, 1.1) + vec2(t * 0.012, -t * 0.02), t * 0.35 + 23.0);
      col += vec3(0.80, 0.97, 1.0) * cs * mix(0.08, 0.30, smoothstep(0.95, 0.0, gy));

      // --- luz do cursor
      vec2 m = vec2(uMouse.x * aspect, uMouse.y);
      float md = length(q - m);
      col += vec3(0.6, 0.95, 1.0) * exp(-md * md * 9.0) * 0.10;

      // crista das ondulações
      col += vec3(0.8, 1.0, 1.0) * rl * 0.12;

      // vinheta + dithering
      float vig = smoothstep(1.25, 0.35, length((uv - vec2(0.5, 0.55)) * vec2(1.0, 1.15)));
      col *= mix(0.72, 1.0, vig);
      col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const water = document.getElementById('water');
  let gl = null;
  let uni = {};

  function initGL(canvas) {
    const g = canvas.getContext('webgl', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, powerPreference: 'high-performance',
    });
    if (!g) return null;

    const compile = (type, src) => {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
        console.warn('[aero] shader:', g.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, VERT);
    const fs = compile(g.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;

    const prog = g.createProgram();
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
      console.warn('[aero] link:', g.getProgramInfoLog(prog));
      return null;
    }
    g.useProgram(prog);

    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, 'aPos');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

    uni = {
      res: g.getUniformLocation(prog, 'uRes'),
      time: g.getUniformLocation(prog, 'uTime'),
      mouse: g.getUniformLocation(prog, 'uMouse'),
      rip: g.getUniformLocation(prog, 'uRip'),
    };
    return g;
  }

  try { gl = initGL(water); } catch (e) { gl = null; }
  if (!gl) water.style.display = 'none';

  water.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    gl = null;
    water.style.display = 'none';
  });

  function renderWater(t) {
    if (!gl) return;
    gl.uniform2f(uni.res, water.width, water.height);
    gl.uniform1f(uni.time, t);
    gl.uniform2f(uni.mouse, pointer.sx, pointer.sy);
    gl.uniform4fv(uni.rip, ripples);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* =========================================================
     Bolhas
     ========================================================= */
  const bc = document.getElementById('bubbles');
  const ctx = bc.getContext('2d');
  let W = innerWidth, H = innerHeight, DPR = 1;

  // sprite pré-renderizado: muito mais leve que desenhar gradientes por bolha
  const sprite = (() => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const cx = S / 2, cy = S / 2, r = S / 2 - 3;

    const body = g.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.05, cx, cy, r);
    body.addColorStop(0, 'rgba(255,255,255,0.10)');
    body.addColorStop(0.55, 'rgba(190,240,255,0.05)');
    body.addColorStop(0.84, 'rgba(170,235,255,0.20)');
    body.addColorStop(1, 'rgba(240,253,255,0.80)');
    g.fillStyle = body;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();

    // iridescência
    g.globalCompositeOperation = 'source-atop';
    const ir = g.createLinearGradient(0, 0, S, S);
    ir.addColorStop(0, 'rgba(255,120,220,0.20)');
    ir.addColorStop(0.35, 'rgba(120,230,255,0.0)');
    ir.addColorStop(0.62, 'rgba(160,255,170,0.15)');
    ir.addColorStop(1, 'rgba(255,230,120,0.22)');
    g.fillStyle = ir;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';

    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r - 1.5, 0, TAU); g.stroke();

    // reflexo principal
    g.save();
    g.translate(cx - r * 0.36, cy - r * 0.44);
    g.rotate(-0.65);
    const hl = g.createLinearGradient(0, -r * 0.2, 0, r * 0.2);
    hl.addColorStop(0, 'rgba(255,255,255,0.95)');
    hl.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = hl;
    g.beginPath(); g.ellipse(0, 0, r * 0.36, r * 0.19, 0, 0, TAU); g.fill();
    g.restore();

    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(cx + r * 0.05, cy - r * 0.7, r * 0.05, 0, TAU); g.fill();

    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = r * 0.07;
    g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r * 0.78, 0.15 * Math.PI, 0.55 * Math.PI); g.stroke();
    return c;
  })();

  const bubbles = [];
  const drops = [];   // gotículas de estouro
  const rings = [];   // anel de estouro

  function makeAmbient(initial) {
    const r = 5 + Math.pow(Math.random(), 2.4) * 44;
    return {
      kind: 'ambient',
      x: rand(0, W), y: initial ? rand(0, H) : H + r + rand(0, 120),
      r, vy: -(16 + r * 1.1 + rand(0, 22)), vx: 0, ox: 0,
      ph: rand(0, TAU), ws: rand(0.5, 1.4), wa: rand(6, 24),
      alpha: rand(0.5, 0.95), age: initial ? 5 : 0, life: Infinity,
    };
  }

  function ambientTarget() {
    return Math.round(clamp((W * H) / 36000, 12, 48) * (reduceMotion ? 0.5 : 1) * Q().bubbles);
  }

  function ensureAmbient() {
    const want = ambientTarget();
    let have = bubbles.filter((b) => b.kind === 'ambient').length;
    while (have < want) { bubbles.push(makeAmbient(true)); have++; }
    if (have > want) {
      for (let i = bubbles.length - 1; i >= 0 && have > want; i--) {
        if (bubbles[i].kind === 'ambient') { bubbles.splice(i, 1); have--; }
      }
    }
  }

  function spawnTrail(x, y, dx, dy) {
    let n = 0;
    for (const b of bubbles) if (b.kind === 'trail') n++;
    if (n > 70 * Q().bubbles) return;
    const count = Math.random() < 0.55 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      bubbles.push({
        kind: 'trail',
        x: x + rand(-8, 8), y: y + rand(-8, 8),
        r: rand(2.5, 8.5), vy: rand(-80, -35), vx: clamp(dx * 6, -220, 220) * 0.3, ox: 0,
        ph: rand(0, TAU), ws: rand(1.5, 3), wa: rand(2, 6),
        alpha: rand(0.6, 0.95), age: 0, life: rand(1.4, 2.6),
      });
    }
  }

  // jorro de bolhas (usado nas transições e botões)
  function burst(x, y, n = 20, spread = 120) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      bubbles.push({
        kind: 'burst',
        x: x + rand(-spread, spread), y: y + rand(-20, 30),
        r: 3 + Math.pow(Math.random(), 1.8) * 17,
        vy: rand(-320, -140), vx: rand(-60, 60), ox: 0,
        ph: rand(0, TAU), ws: rand(1, 2.4), wa: rand(4, 14),
        alpha: rand(0.6, 0.95), age: 0, life: rand(2.2, 3.8),
      });
    }
  }

  function bubbleX(b) {
    return b.x + b.ox + Math.sin(b.ph) * b.wa;
  }

  function popBubble(i) {
    const b = bubbles[i];
    const x = bubbleX(b), y = b.y;
    bubbles.splice(i, 1);
    const n = 8 + Math.round(b.r / 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rand(-0.2, 0.2);
      const sp = rand(70, 190) * (0.6 + b.r / 40);
      drops.push({ x: x + Math.cos(a) * b.r, y: y + Math.sin(a) * b.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1, 2.4), age: 0, life: rand(0.35, 0.6) });
    }
    rings.push({ x, y, r: b.r, age: 0, life: 0.42 });
    Aero.ripple(x, y, 0.7);
  }

  function popAt(x, y) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const dx = bubbleX(b) - x, dy = b.y - y;
      const hit = b.r + 8;
      if (dx * dx + dy * dy < hit * hit) {
        popBubble(i);
        return true;
      }
    }
    return false;
  }

  Aero.bubbles = { burst, popAt };

  function stepBubbles(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.age += dt;
      b.ph += b.ws * dt;
      if (b.kind === 'burst') b.vy += (-60 - b.vy) * (1 - Math.exp(-dt * 1.3));
      b.y += b.vy * dt;

      // o cursor empurra as bolhas como se fosse um dedo na água
      if (pointer.active) {
        const bx = bubbleX(b);
        const dx = bx - pointer.x, dy = b.y - pointer.y;
        const R = b.r + 90;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / R) * 950;
          b.vx += (dx / d) * f * dt;
          b.y += (dy / d) * f * dt * 0.22;
        }
      }
      b.vx *= Math.exp(-dt * 2.2);
      b.ox += b.vx * dt;
      if (b.kind === 'ambient') b.ox *= Math.exp(-dt * 0.18);

      const dead = b.age > b.life || b.y < -b.r - 30;
      if (dead) {
        if (b.kind === 'ambient') bubbles[i] = makeAmbient(false);
        else bubbles.splice(i, 1);
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      d.vy += 380 * dt;
      d.vx *= Math.exp(-dt * 3);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.age > d.life) drops.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].age += dt;
      if (rings[i].age > rings[i].life) rings.splice(i, 1);
    }
  }

  function drawBubbles() {
    ctx.clearRect(0, 0, W, H);
    for (const b of bubbles) {
      let a = b.alpha;
      if (b.life !== Infinity) {
        const k = b.age / b.life;
        if (k > 0.6) a *= 1 - (k - 0.6) / 0.4;
      }
      if (b.age < 0.35) a *= b.age / 0.35;
      if (a <= 0.01) continue;
      const s = 1 + Math.sin(b.ph * 2.3) * 0.045;
      const x = bubbleX(b);
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, x - b.r * s, b.y - b.r / s, b.r * 2 * s, (b.r * 2) / s);
    }
    ctx.fillStyle = '#ffffff';
    for (const d of drops) {
      ctx.globalAlpha = 0.9 * (1 - d.age / d.life);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    for (const r of rings) {
      const k = r.age / r.life;
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (1 + k * 1.6), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- tamanho ---------- */
  function resize() {
    W = innerWidth;
    H = innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, Q().dpr);

    const q = Math.min(Q().water, W < 760 ? 0.45 : 0.6); // o shader é suave, resolução reduzida basta
    water.width = Math.max(2, Math.round(W * q));
    water.height = Math.max(2, Math.round(H * q));
    if (gl) gl.viewport(0, 0, water.width, water.height);

    bc.width = Math.round(W * DPR);
    bc.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    ensureAmbient();
    if (reduceMotion) {
      renderWater(14);
      drawBubbles();
    }
  }
  addEventListener('resize', resize);
  resize();

  /* ---------- eventos do ponteiro ---------- */
  addEventListener('pointermove', (e) => {
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    if (reduceMotion) return;

    if (e.pointerType === 'mouse' && Math.hypot(e.clientX - pointer.tx, e.clientY - pointer.ty) > 28) {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      spawnTrail(e.clientX, e.clientY, dx, dy);
    }
    const t = now();
    if (t - pointer.lastRipple > 0.28 && Math.hypot(e.clientX - pointer.rx, e.clientY - pointer.ry) > 120) {
      pointer.lastRipple = t;
      pointer.rx = e.clientX;
      pointer.ry = e.clientY;
      Aero.ripple(e.clientX, e.clientY, 0.22);
    }
  }, { passive: true });

  addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) pointer.active = false;
  });

  addEventListener('pointerdown', (e) => {
    if (reduceMotion) return;
    Aero.ripple(e.clientX, e.clientY, 0.9);
    const onUI = e.target.closest('a, button, input, textarea, select, label, .glass, .p-menu, .tabbar');
    if (!onUI && popAt(e.clientX, e.clientY)) Aero.sound && Aero.sound.pop();
  });

  /* ---------- loop ---------- */
  let last = performance.now();
  let frameNo = 0;
  function frame(ms) {
    const raw = ms - last;
    const dt = Math.min(0.05, Math.max(0, raw / 1000));
    last = ms;
    if (!document.hidden) {
      const t = now();
      frameNo++;
      if (!reduceMotion) monitor(raw);
      const k = 1 - Math.exp(-dt * 3);
      pointer.sx += (pointer.x / W - pointer.sx) * k;
      pointer.sy += (1 - pointer.y / H - pointer.sy) * k;
      if (!reduceMotion) {
        if (frameNo % Q().waterEvery === 0) renderWater(t);
        stepBubbles(dt);
        drawBubbles();
      }
      frameFns.forEach((fn) => fn(dt, t));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
