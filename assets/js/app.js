/* =========================================================
   App: navegação estilo Persona 3 Reload + interações
   ========================================================= */
(() => {
  'use strict';

  const Aero = window.Aero;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;
  const reduce = Aero.reduceMotion;

  /* =========================================================
     Idiomas (textos em assets/js/i18n.js)
     ========================================================= */
  const I18N = window.AERO_I18N;
  const PROFILE = window.AERO_PROFILE;
  const LANGS = Object.keys(I18N.languages);
  let lang = (() => {
    try {
      const saved = localStorage.getItem('aero-lang');
      if (LANGS.includes(saved)) return saved;
    } catch (e) { /* sem storage */ }
    const nav = (navigator.language || 'pt').slice(0, 2).toLowerCase();
    return LANGS.includes(nav) ? nav : 'pt';
  })();
  const escapeHTML = (str) => str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (key, html = false) => {
    const v = I18N.strings[lang][key] ?? I18N.strings.pt[key] ?? key;
    const name = html ? escapeHTML(PROFILE.name) : PROFILE.name;
    return v.replace(/\{name\}/g, name).replace(/\{year\}/g, String(new Date().getFullYear()));
  };

  /* =========================================================
     Sons (sintetizados — sem arquivos)
     ========================================================= */
  const Sound = {
    ctx: null,
    on: false,
    init() {
      try { this.on = localStorage.getItem('aero-sound') === '1'; } catch (e) { this.on = false; }
    },
    save() {
      try { localStorage.setItem('aero-sound', this.on ? '1' : '0'); } catch (e) { /* sem storage */ }
    },
    ac() {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        this.ctx = new C();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(f0, f1, dur, vol = 0.08, type = 'sine', delay = 0) {
      if (!this.on) return;
      const c = this.ac();
      if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    },
    blip(p = 1) { this.tone(430 * p, 920 * p, 0.11, 0.06); },
    pop() { this.tone(1300, 380, 0.07, 0.08); this.tone(2600, 1900, 0.03, 0.025, 'triangle'); },
    select() { this.tone(520, 1040, 0.16, 0.07); this.tone(780, 1560, 0.2, 0.045, 'sine', 0.05); },
    splash() {
      if (!this.on) return;
      const c = this.ac();
      if (!c) return;
      const t = c.currentTime, len = 1.1;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(380, t);
      f.frequency.exponentialRampToValueAtTime(1700, t + 0.35);
      f.frequency.exponentialRampToValueAtTime(480, t + len);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t);
      for (let i = 0; i < 5; i++) this.tone(rand(300, 800), rand(900, 1800), 0.08, 0.03, 'sine', 0.25 + i * 0.09 + rand(0, 0.05));
    },
  };
  Sound.init();
  Aero.sound = Sound;

  const soundBtn = $('#sound-toggle');
  const syncSoundBtn = () => {
    soundBtn.setAttribute('aria-pressed', String(Sound.on));
    soundBtn.setAttribute('aria-label', t(Sound.on ? 'ui.soundOff' : 'ui.soundOn'));
  };
  syncSoundBtn();
  soundBtn.addEventListener('click', () => {
    Sound.on = !Sound.on;
    Sound.save();
    syncSoundBtn();
    if (Sound.on) Sound.select();
  });

  /* =========================================================
     Texto dividido em letras (para as ondas nas letras)
     ========================================================= */
  function splitText(el, text) {
    el.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.appendChild(sr);
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch';
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--c', i);
      s.textContent = ch === ' ' ? ' ' : ch;
      el.appendChild(s);
    });
  }
  $$('[data-split]').forEach((el) => splitText(el, el.textContent.trim()));

  /* =========================================================
     Views & rotas
     ========================================================= */
  const SECTIONS = ['sobre', 'projetos', 'habilidades', 'contato'];
  const views = Object.fromEntries($$('.view').map((v) => [v.dataset.view, v]));
  const wave = new Aero.WaveTransition($('.wave-svg'), $('.wave-caption'));
  let current = null;
  let busy = false;
  let pending = null;

  const viewFromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    return views[h] && h !== 'home' ? h : 'home';
  };

  function go(name) {
    if (!views[name]) return;
    if (busy) { pending = name; return; }
    if (name === current) return;
    const url = name === 'home' ? location.pathname + location.search : '#' + name;
    try {
      history.pushState({ view: name }, '', url);
    } catch (e) {
      /* alguns navegadores bloqueiam pushState em file:// */
    }
    transitionTo(name);
  }

  function flushPending() {
    const p = pending;
    pending = null;
    if (!p || p === current) return;
    if (viewFromHash() === p) transitionTo(p); // veio do botão voltar do navegador
    else go(p);
  }

  async function transitionTo(name) {
    busy = true;
    Sound.splash();
    const from = views[current];
    if (from) from.classList.add('is-leaving');
    if (reduce) {
      swap(name);
    } else {
      const caption = name === 'home' ? t('ui.menu') : views[name].dataset.title || '';
      await wave.play({ caption, onCovered: () => swap(name) });
    }
    busy = false;
    flushPending();
  }

  function swap(name) {
    const prev = views[current];
    if (prev) prev.classList.remove('is-active', 'is-leaving', 'is-entered');
    current = name;
    const v = views[name];
    document.body.dataset.view = name;
    v.classList.add('is-active');
    v.scrollTop = 0;
    v.classList.remove('is-entered');
    void v.offsetWidth; // reinicia as animações de entrada
    v.classList.add('is-entered');

    const home = name === 'home';
    menuHL.active = home;
    tabHL.active = !home;
    field.stop();

    if (home) {
      parDirty = true;
      requestAnimationFrame(() => positionMenu(true));
    } else {
      setTab(SECTIONS.indexOf(name), true);
      select(SECTIONS.indexOf(name), { silent: true }); // ao voltar, o menu lembra onde você estava
      const title = $('.page-title', v);
      title.focus({ preventScroll: true });
      setTimeout(() => Aero.wobble(title), 220);
      if (name === 'sobre') countUp(v);
      if (name === 'habilidades') requestAnimationFrame(() => field.start());
    }
    updateTitle();
    if (Aero.bubbles) Aero.bubbles.burst(innerWidth / 2, innerHeight + 30, 26, innerWidth * 0.45);
  }

  function updateTitle() {
    document.title = !current || current === 'home'
      ? `${PROFILE.name} · ${t('meta.portfolio')}`
      : `${views[current].dataset.title} · ${PROFILE.name}`;
  }

  addEventListener('popstate', () => {
    const n = viewFromHash();
    if (busy) { pending = n; return; }
    if (n !== current) transitionTo(n);
  });

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.preventDefault();
      go(nav.dataset.nav);
      return;
    }
    if (e.target.closest('[data-back]')) go('home');
  });

  /* =========================================================
     Menu principal (P3R)
     ========================================================= */
  const menu = $('.p-menu');
  const items = $$('.p-item', menu);
  const menuHL = new Aero.LiquidHighlight($('.liquid-layer', menu), { droplets: 3 });
  const band = $('.p-band', menu);
  const bandY = new Aero.Spring(0, 70, 13);
  const bandH = new Aero.Spring(90, 70, 13);
  const watermark = $('.watermark');
  const desc = $('.p-desc', menu);
  const descText = $('.p-desc-text', desc);
  let sel = 0;

  // posição relativa a um ancestral, somando offsets — durante as animações
  // de entrada o <li> (com transform/filter) vira offsetParent no Chromium
  function offsetWithin(el, root) {
    let x = 0, y = 0;
    while (el && el !== root) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return { x, y };
  }

  function itemRect(i) {
    const a = items[i];
    const o = offsetWithin(a, menu);
    const shift = parseFloat(getComputedStyle(menu).getPropertyValue('--shift')) || 0;
    const padX = a.offsetHeight * 0.16;
    return {
      x: o.x + shift - padX,
      y: o.y + a.offsetHeight * 0.04,
      w: a.offsetWidth + padX * 2,
      h: a.offsetHeight * 0.92,
    };
  }

  // diminui a fonte do menu se o item mais longo não couber na coluna
  // (assim o texto nunca passa por baixo do card de apresentação)
  function fitMenu() {
    const list = $('.p-list', menu);
    list.style.removeProperty('--menu-fs');
    const avail = menu.parentElement.clientWidth;
    if (!avail) return;
    const shift = parseFloat(getComputedStyle(menu).getPropertyValue('--shift')) || 0;
    for (let pass = 0; pass < 3; pass++) {
      let need = 0;
      items.forEach((a) => {
        const o = offsetWithin(a, menu);
        need = Math.max(need, o.x + a.offsetWidth + shift + a.offsetHeight * 0.2);
      });
      if (need <= avail) break;
      const fs = parseFloat(getComputedStyle(items[0]).fontSize);
      list.style.setProperty('--menu-fs', `${Math.max(18, fs * (avail / need) * 0.98).toFixed(1)}px`);
    }
  }

  function updateMenuText(animate = false) {
    $('span', watermark).textContent = $('.sr-only', items[sel]).textContent;
    descText.textContent = $('.p-sub', items[sel]).textContent;
    if (!animate) return;
    for (const el of [watermark, desc]) {
      el.classList.remove('swap');
      void el.offsetWidth;
      el.classList.add('swap');
    }
  }

  function positionMenu(instant = false) {
    const r = itemRect(sel);
    menuHL.moveTo(r, instant);
    bandY.t = r.y + r.h / 2;
    bandH.t = r.h * 1.7;
    band.dataset.dirty = '1';
    if (instant) { bandY.snap(); bandH.snap(); }
  }

  Aero.onFrame((dt) => {
    if (current !== 'home' || (bandY.resting && bandH.resting && !band.dataset.dirty)) return;
    bandY.step(dt);
    bandH.step(dt);
    band.dataset.dirty = bandY.resting && bandH.resting ? '' : '1';
    band.style.setProperty('--bh', `${bandH.x.toFixed(1)}px`);
    band.style.setProperty('--by', `${(bandY.x - bandH.x / 2).toFixed(1)}px`);
  });

  function select(i, { silent = false } = {}) {
    i = (i + items.length) % items.length;
    if (i === sel && items[i].classList.contains('is-selected')) return;
    items.forEach((it, k) => it.classList.toggle('is-selected', k === i));
    sel = i;
    positionMenu();
    updateMenuText(true);
    if (!silent) {
      Sound.blip(1 + i * 0.09);
      const r = items[i].getBoundingClientRect();
      Aero.ripple(r.left + r.width * 0.3, r.top + r.height / 2, 0.35);
    }
  }

  items.forEach((it, i) => {
    it.addEventListener('pointerenter', () => {
      select(i);
      if (document.activeElement && document.activeElement.classList.contains('p-item')) it.focus({ preventScroll: true });
    });
    it.addEventListener('focus', () => select(i, { silent: true }));
  });

  /* =========================================================
     Abas (dentro das seções)
     ========================================================= */
  const tabs = $$('.tab');
  const tabHL = new Aero.LiquidHighlight($('.tabbar .liquid-layer'), { droplets: 2, orbit: false });
  tabHL.active = false;
  let tabIndex = 0;

  function tabRect(i) {
    const t = tabs[i];
    const o = offsetWithin(t, t.parentElement);
    return { x: o.x, y: o.y, w: t.offsetWidth, h: t.offsetHeight };
  }
  function lightTab(i) {
    tabs.forEach((t, k) => t.classList.toggle('is-lit', k === i));
  }
  function setTab(i, instant = false) {
    if (i < 0) return;
    tabIndex = i;
    tabs.forEach((t, k) => (k === i ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
    lightTab(i);
    tabHL.moveTo(tabRect(i), instant);
    const bar = tabs[i].parentElement;
    if (bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: tabs[i].offsetLeft - (bar.clientWidth - tabs[i].offsetWidth) / 2, behavior: instant ? 'auto' : 'smooth' });
    }
  }
  tabs.forEach((t, i) => {
    t.addEventListener('pointerenter', () => {
      if (current === 'home') return;
      tabHL.moveTo(tabRect(i));
      lightTab(i);
      Sound.blip(1.2 + i * 0.08);
    });
  });
  $('.tabbar').addEventListener('pointerleave', () => {
    if (current === 'home') return;
    tabHL.moveTo(tabRect(tabIndex));
    lightTab(tabIndex);
  });

  /* =========================================================
     Teclado (↑ ↓ Enter Esc, Q/E ou ← → entre abas)
     ========================================================= */
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const typing = e.target.matches('input, textarea, select, [contenteditable]');
    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (current === 'home') {
      if (k === 'arrowdown' || k === 's') { e.preventDefault(); select(sel + 1); items[sel].focus({ preventScroll: true }); }
      else if (k === 'arrowup' || k === 'w') { e.preventDefault(); select(sel - 1); items[sel].focus({ preventScroll: true }); }
      else if ((k === 'enter' || k === ' ') && (document.activeElement === document.body || !document.activeElement)) {
        e.preventDefault();
        Sound.select();
        go(SECTIONS[sel]);
      }
    } else {
      if (k === 'escape' || k === 'backspace') { e.preventDefault(); go('home'); }
      else if (k === 'e' || k === 'arrowright') { e.preventDefault(); go(SECTIONS[(tabIndex + 1) % SECTIONS.length]); }
      else if (k === 'q' || k === 'arrowleft') { e.preventDefault(); go(SECTIONS[(tabIndex - 1 + SECTIONS.length) % SECTIONS.length]); }
    }
  });

  /* =========================================================
     Parallax da home (com mola, bem "flutuante")
     ========================================================= */
  const depthEls = $$('[data-depth]', views.home);
  const par = { x: new Aero.Spring(0, 30, 9), y: new Aero.Spring(0, 30, 9) };
  let parDirty = true;
  if (!reduce) {
    Aero.onFrame((dt) => {
      if (current !== 'home') return;
      par.x.t = Aero.pointer.x / innerWidth - 0.5;
      par.y.t = Aero.pointer.y / innerHeight - 0.5;
      if (par.x.resting && par.y.resting && !parDirty) return; // mouse parado: nada a mover
      parDirty = false;
      par.x.step(dt);
      par.y.step(dt);
      for (const el of depthEls) {
        const d = +el.dataset.depth;
        el.style.transform = `translate3d(${(par.x.x * d).toFixed(2)}px, ${(par.y.x * d).toFixed(2)}px, 0)`;
      }
    });
  }

  /* =========================================================
     Contadores (Sobre)
     ========================================================= */
  function countUp(root) {
    $$('[data-count]', root).forEach((el, i) => {
      const end = +el.dataset.count;
      if (reduce) { el.textContent = end; return; }
      const start = performance.now() + 550 + i * 130;
      const dur = 1500;
      el.textContent = '0';
      const tick = (ms) => {
        const k = clamp((ms - start) / dur, 0, 1);
        const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
        el.textContent = Math.round(end * e);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* =========================================================
     Cards de projeto: inclinação 3D + reflexo seguindo o mouse
     ========================================================= */
  $$('.project').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || reduce) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.classList.add('is-tilting');
      card.style.setProperty('--ry', `${((px - 0.5) * 14).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${((0.5 - py) * 11).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerenter', () => Sound.blip(1.5));
    card.addEventListener('pointerleave', () => {
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });

  /* =========================================================
     Aquário de habilidades (física de bolhas)
     ========================================================= */
  class BubbleField {
    constructor(el) {
      this.el = el;
      this.running = false;
      this.p = null;
      this.W = 0;
      this.H = 0;
      this.nodes = $$('.skill-bubble', el).map((n) => ({ el: n, r: 0, x: 0, y: 0, vx: 0, vy: 0, ph: Math.random() * TAU }));

      el.addEventListener('pointermove', (e) => {
        const b = el.getBoundingClientRect();
        this.p = { x: e.clientX - b.left, y: e.clientY - b.top };
      });
      el.addEventListener('pointerleave', () => (this.p = null));
      this.nodes.forEach((n) => {
        n.el.addEventListener('click', () => {
          n.vy -= 420;
          n.vx += rand(-220, 220);
          Sound.pop();
          const r = n.el.getBoundingClientRect();
          Aero.ripple(r.left + r.width / 2, r.top + r.height / 2, 0.6);
        });
        n.el.addEventListener('pointerenter', () => Sound.blip(0.8 + 120 / (n.el.offsetWidth || 100)));
      });
      addEventListener('resize', () => this.measure());
      Aero.onFrame((dt) => this.step(dt));
    }
    measure() {
      this.W = this.el.clientWidth;
      this.H = this.el.clientHeight;
      this.nodes.forEach((n) => (n.r = n.el.offsetWidth / 2));
    }
    start() {
      this.measure();
      const { W, H } = this;
      // entram subindo do fundo
      this.nodes.forEach((n, i) => {
        n.x = rand(n.r, Math.max(n.r, W - n.r));
        n.y = H + n.r + i * 26;
        n.vx = rand(-60, 60);
        n.vy = -rand(260, 460);
      });
      this.running = true;
      if (reduce) {
        this.settle();
        this.running = false;
      }
    }
    settle() {
      for (let i = 0; i < 240; i++) this.step(1 / 60, true);
    }
    stop() { this.running = false; }
    step(dt, force = false) {
      if (!this.running && !force) return;
      const { W, H } = this;
      const N = this.nodes;
      if (!W || !H) return;

      for (const n of N) {
        n.ph += dt;
        n.vx += Math.sin(n.ph * 0.7 + n.r) * 16 * dt;
        n.vy += (Math.cos(n.ph * 0.9 + n.r * 0.3) * 16 - (n.y - H * 0.5) * 0.6) * dt;
        if (this.p) {
          const dx = n.x - this.p.x, dy = n.y - this.p.y;
          const d = Math.hypot(dx, dy) || 1;
          const R = n.r + 70;
          if (d < R) {
            const f = (1 - d / R) * 2600;
            n.vx += (dx / d) * f * dt;
            n.vy += (dy / d) * f * dt;
          }
        }
      }
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const min = a.r + b.r + 6;
          if (d < min) {
            const o = ((min - d) / d) * 0.5;
            a.x -= dx * o; a.y -= dy * o;
            b.x += dx * o; b.y += dy * o;
            const nx = dx / d, ny = dy / d;
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = rel * 0.9;
              a.vx += imp * nx; a.vy += imp * ny;
              b.vx -= imp * nx; b.vy -= imp * ny;
            }
          }
        }
      }
      const damp = Math.exp(-dt * 1.6);
      for (const n of N) {
        n.vx *= damp;
        n.vy *= damp;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < n.r) { n.x = n.r; n.vx = Math.abs(n.vx) * 0.6; }
        if (n.x > W - n.r) { n.x = W - n.r; n.vx = -Math.abs(n.vx) * 0.6; }
        if (n.y < n.r) { n.y = n.r; n.vy = Math.abs(n.vy) * 0.6; }
        if (n.y > H - n.r && n.vy > 0) { n.y = H - n.r; n.vy = -Math.abs(n.vy) * 0.6; }

        // estica na direção da velocidade e "treme" de leve, como gelatina
        const sp = Math.min(Math.hypot(n.vx, n.vy) / 900, 0.18);
        const ang = Math.atan2(n.vy, n.vx);
        const wob = Math.sin(n.ph * 3.1) * 0.025;
        n.el.style.transform =
          `translate(${(n.x - n.r).toFixed(1)}px, ${(n.y - n.r).toFixed(1)}px) ` +
          `rotate(${ang.toFixed(3)}rad) scale(${(1 + sp + wob).toFixed(3)}, ${(1 - sp * 0.7 - wob).toFixed(3)}) rotate(${(-ang).toFixed(3)}rad)`;
      }
    }
  }
  const field = new BubbleField($('.bubble-field'));

  /* =========================================================
     Formulário de contato (abre o app de e-mail)
     ========================================================= */
  const form = $('#contact-form');
  const toastEl = $('.toast');
  function toast(msg) {
    $('.toast-msg', toastEl).textContent = msg;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toast.tm);
    toast.tm = setTimeout(() => toastEl.classList.remove('show'), 3800);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = $$('.input', form);
    let firstBad = null;
    fields.forEach((f) => {
      const bad = !f.checkValidity() || !f.value.trim();
      f.classList.toggle('is-invalid', bad);
      if (bad && !firstBad) firstBad = f;
    });
    if (firstBad) {
      firstBad.focus();
      toast(t('contact.invalid'));
      return;
    }
    const name = form.nome.value.trim();
    const email = form.email.value.trim();
    const msg = form.mensagem.value.trim();
    const to = PROFILE.email;
    const subject = encodeURIComponent(`${t('contact.subject')} — ${name}`);
    const body = encodeURIComponent(`${msg}\n\n— ${name} (${email})`);
    const btn = $('button[type="submit"]', form).getBoundingClientRect();
    if (Aero.bubbles) Aero.bubbles.burst(btn.left + btn.width / 2, btn.top + btn.height / 2, 30, btn.width / 2);
    Sound.select();
    toast(t('contact.opening'));
    setTimeout(() => { location.href = `mailto:${to}?subject=${subject}&body=${body}`; }, 650);
  });
  $$('.input', form).forEach((f) => f.addEventListener('input', () => f.classList.remove('is-invalid')));

  /* =========================================================
     Gadget de relógio (Vista sidebar)
     ========================================================= */
  const ticks = $('.clock-ticks');
  for (let i = 0; i < 12; i++) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const big = i % 3 === 0;
    l.setAttribute('x1', 50); l.setAttribute('y1', 7);
    l.setAttribute('x2', 50); l.setAttribute('y2', big ? 15 : 12);
    l.setAttribute('stroke', big ? '#063b74' : '#4a86b8');
    l.setAttribute('stroke-width', big ? 3 : 1.6);
    l.setAttribute('stroke-linecap', 'round');
    l.setAttribute('transform', `rotate(${i * 30} 50 50)`);
    ticks.appendChild(l);
  }
  const hHour = $('#h-hour'), hMin = $('#h-min'), hSec = $('#h-sec');
  const clockTime = $('#clock-time'), clockDate = $('#clock-date');
  let fmtTime, fmtDate;
  let lastMinute = -1;
  function setClockLocale(locale) {
    fmtTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    fmtDate = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short' });
    lastMinute = -1;
  }
  setClockLocale(I18N.languages[lang].locale);
  let lastSecDeg = -1;
  Aero.onFrame(() => {
    const d = new Date();
    const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const secDeg = s * 6;
    if (Math.abs(secDeg - lastSecDeg) < 0.6 && d.getMinutes() === lastMinute) return; // ~10 atualizações/s bastam
    lastSecDeg = secDeg;
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    hSec.setAttribute('transform', `rotate(${(s * 6).toFixed(2)} 50 50)`);
    hMin.setAttribute('transform', `rotate(${(m * 6).toFixed(2)} 50 50)`);
    hHour.setAttribute('transform', `rotate(${(h * 30).toFixed(2)} 50 50)`);
    if (d.getMinutes() !== lastMinute) {
      lastMinute = d.getMinutes();
      clockTime.textContent = fmtTime.format(d);
      const ds = fmtDate.format(d).replace(/\./g, '');
      clockDate.textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
    }
  });

  /* =========================================================
     Início
     ========================================================= */
  /* =========================================================
     Seletor de idioma (PT · EN · 日本)
     ========================================================= */
  const langBox = $('.lang-switch');
  const langBtns = $$('.lang-opt', langBox);
  const langHL = new Aero.LiquidHighlight($('.liquid-layer', langBox), { droplets: 2, orbit: false });

  function langRect(b) {
    const o = offsetWithin(b, langBox);
    return { x: o.x, y: o.y, w: b.offsetWidth, h: b.offsetHeight };
  }
  function lightLang(code) {
    langBtns.forEach((b) => b.classList.toggle('is-lit', b.dataset.lang === code));
  }
  function syncLangUI(instant = false) {
    const active = langBtns.find((b) => b.dataset.lang === lang) || langBtns[0];
    langBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === active)));
    lightLang(lang);
    langHL.moveTo(langRect(active), instant);
  }
  langBtns.forEach((b) => {
    b.addEventListener('pointerenter', () => {
      langHL.moveTo(langRect(b));
      lightLang(b.dataset.lang);
      Sound.blip(1.6);
    });
    b.addEventListener('click', () => switchLang(b.dataset.lang));
  });
  langBox.addEventListener('pointerleave', () => syncLangUI());

  function applyLang() {
    document.documentElement.lang = I18N.languages[lang].html;
    $$('[data-i18n]').forEach((el) => {
      const v = t(el.dataset.i18n);
      if (el.hasAttribute('data-split')) splitText(el, v);
      else el.textContent = v;
    });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml, true); });
    $$('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, t(key));
      });
    });
    $$('[data-name]').forEach((el) => { el.textContent = PROFILE.name; });
    $$('[data-initials]').forEach((el) => { el.textContent = PROFILE.initials; });
    $$('[data-email-text]').forEach((el) => { el.textContent = PROFILE.email; });
    toastEl.classList.remove('show'); // um aviso no idioma antigo não deve ficar na tela
    $$('[data-email-link]').forEach((el) => { el.href = `mailto:${PROFILE.email}`; });
    SECTIONS.forEach((s) => { views[s].dataset.title = t(`nav.${s}`); });
    setClockLocale(I18N.languages[lang].locale);
    syncSoundBtn();
    updateTitle();
    updateMenuText();
    relayout();
  }

  async function switchLang(code) {
    if (!I18N.strings[code] || code === lang) { syncLangUI(); return; }
    if (busy) return;
    busy = true;
    lang = code;
    try { localStorage.setItem('aero-lang', code); } catch (e) { /* sem storage */ }
    syncLangUI();
    Sound.splash();
    if (reduce) applyLang();
    else await wave.play({ caption: t('lang.name'), onCovered: applyLang });
    busy = false;
    flushPending();
  }

  function relayout() {
    fitMenu();
    positionMenu(true);
    tabHL.moveTo(tabRect(tabIndex), true);
    syncLangUI(true);
  }
  addEventListener('resize', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

  applyLang();
  select(0, { silent: true });
  const first = viewFromHash();
  history.replaceState({ view: first }, '', location.href);
  busy = true;
  if (reduce) {
    swap(first);
    busy = false;
  } else {
    // a página "emerge" da água
    wave.play({ skipRise: true, onCovered: () => swap(first) }).then(() => {
      busy = false;
      flushPending();
    });
  }
})();
