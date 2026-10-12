/* =========================================================
   Motor de líquido
   - Spring: mola física (todo movimento "aguado" do site)
   - LiquidHighlight: destaque gosmento que escorre entre itens
     (cabeça rápida + cauda lenta + gotas, fundidos pelo filtro #goo)
   - WaveTransition: onda em 3 camadas que sobe, cobre a tela e escoa
   - wobble: distorção aquosa temporária num elemento
   ========================================================= */
(() => {
  'use strict';

  const Aero = window.Aero;
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (a, b) => a + Math.random() * (b - a);
  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  /* ---------- mola ---------- */
  class Spring {
    constructor(value = 0, stiffness = 220, damping = 20) {
      this.x = value;
      this.v = 0;
      this.t = value;
      this.k = stiffness;
      this.c = damping;
    }
    get resting() {
      return this.v === 0 && this.x === this.t;
    }
    step(dt) {
      if (this.resting || dt <= 0) return;
      // sub-passos para estabilidade com molas rígidas
      const n = Math.ceil(dt / (1 / 120));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = (this.t - this.x) * this.k - this.v * this.c;
        this.v += a * h;
        this.x += this.v * h;
      }
      // dorme quando assenta: sem trabalho nem escrita no DOM enquanto parado
      if (Math.abs(this.v) < 0.01 && Math.abs(this.t - this.x) < 0.01) this.snap();
    }
    snap(v = this.t) {
      this.x = this.t = v;
      this.v = 0;
    }
  }
  Aero.Spring = Spring;

  /* ---------- destaque líquido ---------- */
  function setRect(el, cx, cy, w, h) {
    w = Math.max(0, w);
    h = Math.max(0, h);
    el.setAttribute('x', (cx - w / 2).toFixed(2));
    el.setAttribute('y', (cy - h / 2).toFixed(2));
    el.setAttribute('width', w.toFixed(2));
    el.setAttribute('height', h.toFixed(2));
    el.setAttribute('rx', (Math.min(w, h) / 2).toFixed(2));
  }

  class LiquidHighlight {
    constructor(svg, opts = {}) {
      this.svg = svg;
      this.g = svg.querySelector('.liquid-g');
      this.gloss = svg.querySelector('.liquid-gloss');
      this.opts = Object.assign({ droplets: 3, orbit: !Aero.reduceMotion }, opts);

      const S = (k, c) => new Spring(0, k, c);
      this.head = { x: S(330, 24), y: S(330, 24), w: S(260, 22), h: S(260, 20) };
      this.tail = { x: S(110, 14), y: S(110, 14), w: S(140, 16), h: S(140, 16) };
      this.drops = Array.from({ length: this.opts.droplets }, (_, i) => ({
        x: S(78 - i * 16, 9 + i * 1.6),
        y: S(78 - i * 16, 9 + i * 1.6),
        el: null,
      }));

      this.tailEl = svgEl('rect');
      this.g.appendChild(this.tailEl);
      this.drops.forEach((d) => {
        d.el = svgEl('circle');
        this.g.appendChild(d.el);
      });
      this.headEl = svgEl('rect');
      this.g.appendChild(this.headEl);
      this.orbitEl = svgEl('circle');
      if (this.opts.orbit) this.g.appendChild(this.orbitEl);

      this.ready = false;
      this.active = true;
      this.dirty = true;
      this.orbitAcc = 1;
      this.time = Math.random() * 10;
      this.all = [];
      for (const s of [this.head, this.tail]) this.all.push(s.x, s.y, s.w, s.h);
      for (const d of this.drops) this.all.push(d.x, d.y);
      Aero.onFrame((dt) => this.update(dt));
    }

    springs() {
      return this.all;
    }

    moveTo(r, instant = false) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      for (const s of [this.head, this.tail]) {
        s.x.t = cx; s.y.t = cy; s.w.t = r.w; s.h.t = r.h;
      }
      for (const d of this.drops) {
        d.x.t = cx; d.y.t = cy;
      }
      if (instant || !this.ready || Aero.reduceMotion) this.springs().forEach((s) => s.snap());
      this.ready = true;
      this.dirty = true;
      if (!this.active) this.update(0, true);
    }

    update(dt, force = false) {
      if ((!this.active && !force) || !this.ready) return;
      this.time += dt;
      let moving = false;
      for (const s of this.all) {
        s.step(dt);
        if (!moving && !s.resting) moving = true;
      }

      // gotinha que orbita a borda: a superfície "respira" (30 fps bastam)
      const H = this.head, T = this.tail;
      const base = Math.min(H.h.x, H.w.x);
      if (this.opts.orbit) {
        this.orbitAcc += dt;
        if (this.orbitAcc >= 1 / 30 || moving || force) {
          this.orbitAcc = 0;
          const a = this.time * 0.8;
          const ox = H.x.x + Math.cos(a) * (H.w.x / 2 + base * 0.08);
          const oy = H.y.x + Math.sin(a) * (H.h.x / 2 + base * 0.08);
          this.orbitEl.setAttribute('cx', ox.toFixed(2));
          this.orbitEl.setAttribute('cy', oy.toFixed(2));
          this.orbitEl.setAttribute('r', Math.max(0, base * (0.14 + 0.05 * Math.sin(this.time * 1.9))).toFixed(2));
        }
      }

      // corpo do líquido: só reescreve enquanto se move (+1 quadro para assentar)
      if (!moving && !this.dirty && !force) return;
      this.dirty = moving;

      // estica na direção do movimento, achata na outra (squash & stretch)
      const sy = clamp(Math.abs(H.y.v) / 2200, 0, 0.4);
      const sx = clamp(Math.abs(H.x.v) / 2600, 0, 0.35);
      const hw = H.w.x * (1 + sx - sy * 0.35);
      const hh = H.h.x * (1 + sy * 0.6 - sx * 0.3);
      setRect(this.headEl, H.x.x, H.y.x, hw, hh);
      setRect(this.tailEl, T.x.x, T.y.x, T.w.x * 0.82, T.h.x * 0.74);

      this.drops.forEach((d, i) => {
        d.el.setAttribute('cx', d.x.x.toFixed(2));
        d.el.setAttribute('cy', d.y.x.toFixed(2));
        d.el.setAttribute('r', Math.max(0, base * (0.36 - i * 0.05)).toFixed(2));
      });

      // reflexo de vidro por cima (não passa pelo filtro, fica nítido)
      if (this.gloss) {
        const gw = Math.max(0, hw - hh * 0.5);
        const gh = hh * 0.42;
        this.gloss.setAttribute('x', (H.x.x - gw / 2).toFixed(2));
        this.gloss.setAttribute('y', (H.y.x - hh / 2 + hh * 0.07).toFixed(2));
        this.gloss.setAttribute('width', gw.toFixed(2));
        this.gloss.setAttribute('height', gh.toFixed(2));
        this.gloss.setAttribute('rx', (gh / 2).toFixed(2));
      }
    }
  }
  Aero.LiquidHighlight = LiquidHighlight;

  /* ---------- transição em onda ---------- */
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  class WaveTransition {
    constructor(svg, caption) {
      this.svg = svg;
      this.caption = caption;
      this.layers = [0, 1, 2].map((i) =>
        svg.appendChild(svgEl('path', {
          fill: `url(#wave${i})`,
          stroke: i === 0 ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.5)',
          'stroke-width': i === 0 ? 3 : 2,
        }))
      );
      this.bubs = Array.from({ length: 18 }, () => svg.appendChild(svgEl('circle', { class: 'wave-bub', r: 0 })));
    }

    edge(y, amp, time, layer, W, flip) {
      const pts = [];
      const step = 28;
      const ph = layer * 1.9 + (flip ? 2.4 : 0);
      for (let x = -40; x <= W + 40; x += step) {
        const yy = y + amp * (
          Math.sin(x * 0.0075 + time * 2.6 + ph) * 0.68 +
          Math.sin(x * 0.0175 - time * 3.4 + ph * 1.7) * 0.32
        );
        pts.push([x, yy]);
      }
      if (pts[pts.length - 1][0] < W + 40) pts.push([W + 40, pts[pts.length - 1][1]]);
      return pts;
    }

    play({ onCovered, caption = '', skipRise = false } = {}) {
      return new Promise((resolve) => {
        const W = innerWidth, H = innerHeight;
        this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        this.svg.classList.add('is-on');

        const A = clamp(H * 0.06, 22, 48);
        const RISE = 560, DRAIN = 650, STAG = 95, HOLD = 70;
        const riseEnd = skipRise ? 0 : RISE + STAG * 2;
        const drainStart = riseEnd + HOLD;
        const total = drainStart + DRAIN + STAG * 2 + 20;

        const bubs = this.bubs.map(() => ({
          x: rand(0, W), r: rand(3, 13), sp: rand(500, 1100), dl: rand(0, 0.55),
        }));

        let covered = false;
        let captioned = !caption;
        if (skipRise) {
          covered = true;
          onCovered && onCovered();
        }

        const start = performance.now();
        const tick = (ms) => {
          const t = ms - start;
          const time = t / 1000;
          let deepTop = H, deepBot = H;

          for (let i = 0; i < 3; i++) {
            const pr = skipRise ? 1 : easeInOut(clamp((t - i * STAG) / RISE, 0, 1));
            const pd = easeInOut(clamp((t - drainStart - (2 - i) * STAG) / DRAIN, 0, 1));
            const top = lerp(H + A * 2.5, -A * 2.5, pr);
            const bot = lerp(H + A * 2.5, -A * 2.5, pd);
            if (i === 2) { deepTop = top; deepBot = bot; }

            const path = this.layers[i];
            if (bot <= top + 1 || pr <= 0) {
              path.setAttribute('d', '');
              continue;
            }
            // as bordas agitam mais no meio do movimento
            const ampTop = A * (0.3 + 0.7 * Math.sin(Math.PI * pr));
            const ampBot = A * (0.3 + 0.7 * Math.sin(Math.PI * pd));
            const topPts = this.edge(top, ampTop, time, i, W, false);
            const botPts = pd > 0 ? this.edge(bot, ampBot, time, i, W, true) : [[W + 40, H + 200], [-40, H + 200]];
            let d = `M${topPts[0][0]},${topPts[0][1].toFixed(1)}`;
            for (let k = 1; k < topPts.length; k++) d += `L${topPts[k][0]},${topPts[k][1].toFixed(1)}`;
            if (pd > 0) {
              for (let k = botPts.length - 1; k >= 0; k--) d += `L${botPts[k][0]},${botPts[k][1].toFixed(1)}`;
            } else {
              d += `L${W + 40},${H + 200}L-40,${H + 200}`;
            }
            path.setAttribute('d', d + 'Z');
          }

          // bolhas subindo dentro da camada mais funda
          bubs.forEach((b, k) => {
            const el = this.bubs[k];
            const y = H + b.r + 20 - b.sp * Math.max(0, time - b.dl);
            const inside = y > deepTop + b.r + 6 && y < deepBot - b.r - 6;
            if (inside) {
              el.setAttribute('cx', (b.x + Math.sin(time * 6 + k) * 6).toFixed(1));
              el.setAttribute('cy', y.toFixed(1));
              el.setAttribute('r', b.r.toFixed(1));
            } else {
              el.setAttribute('r', 0);
            }
          });

          if (!captioned && t >= riseEnd - 260) {
            captioned = true;
            const span = this.caption.querySelector('span');
            span.textContent = caption;
            this.caption.classList.remove('play');
            void this.caption.offsetWidth;
            this.caption.classList.add('play');
          }
          if (!covered && t >= riseEnd) {
            covered = true;
            onCovered && onCovered();
          }

          if (t < total) {
            requestAnimationFrame(tick);
          } else {
            this.layers.forEach((p) => p.setAttribute('d', ''));
            this.bubs.forEach((b) => b.setAttribute('r', 0));
            this.svg.classList.remove('is-on');
            resolve();
          }
        };
        requestAnimationFrame(tick);
      });
    }
  }
  Aero.WaveTransition = WaveTransition;

  /* ---------- distorção aquosa ---------- */
  Aero.wobble = (el, dur = 1150) => {
    if (Aero.reduceMotion || !el) return;
    const disp = document.getElementById('wobble-disp');
    const turb = document.getElementById('wobble-turb');
    if (!disp || !turb) return;
    turb.setAttribute('baseFrequency', '0.014 0.05');
    el.style.filter = 'url(#wobble)';
    const start = performance.now();
    const tick = (ms) => {
      const k = Math.min(1, (ms - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      disp.setAttribute('scale', ((1 - e) * 44).toFixed(2)); // só a escala anima; o ruído fica fixo (barato)
      if (k < 1) requestAnimationFrame(tick);
      else el.style.filter = '';
    };
    requestAnimationFrame(tick);
  };
})();
