/* Перспектива · герой-скраб, живые секции, интерактив, форма.
   Чистый JS без зависимостей. Факты берутся из assets/data.js (window.SITE). */
(() => {
  'use strict';

  const SITE = window.SITE || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smoothstep = (p, e0, e1) => {
    const t = clamp((p - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ============================================================
     1. Факты из data.js
     ============================================================ */
  const isMissing = (v) => v == null || String(v).trim() === '' || String(v).includes('[ВПИСАТЬ');
  const resolve = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), SITE);

  function fillFacts() {
    $$('[data-fact]').forEach((el) => {
      const v = resolve(el.dataset.fact);
      const missing = isMissing(v);
      if (el.dataset.kind === 'photo') {
        if (!missing) {
          const img = new Image();
          img.src = String(v);
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          el.replaceChildren(img);
          el.classList.remove('fact-missing');
        } else {
          el.classList.add('fact-missing');
          el.dataset.placeholder = v ? String(v) : '[ВПИСАТЬ: фото]';
        }
        return;
      }
      if (v != null) el.textContent = String(v);
      el.classList.toggle('fact-missing', missing);
    });
    $$('[data-list]').forEach((list) => {
      const items = resolve(list.dataset.list);
      if (!Array.isArray(items) || !items.length) return;
      list.replaceChildren(...items.map((t) => {
        const li = document.createElement('li');
        li.textContent = typeof t === 'string' ? t : (t && t.title) || ''; // практики: объекты {icon,title,text}
        return li;
      }));
    });
    $$('[data-tel]').forEach((a) => {
      const v = resolve(a.dataset.tel);
      if (!isMissing(v)) a.href = 'tel:' + String(v).replace(/[^\d+]/g, '');
    });
  }

  /* ============================================================
     2. Разбивка строк героя на слова (сид, одинаково на каждой загрузке)
     ============================================================ */
  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  }

  // drift: слова опускаются по порядку чтения; sift: буквы оседают зёрнами, каждая со своей высоты.
  // data-from задаёт, с какой доли --k строка начинает собираться (подстрока после заголовка).
  function splitText(el, index) {
    const mode = el.dataset.split;
    const from = Number(el.dataset.from || 0);
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    const r = rng(7001 + index * 131);
    const sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text;
    const vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    const words = text.split(' ');
    const n = words.length;
    const total = text.replace(/ /g, '').length;
    const span = (mode === 'sift' ? 0.68 : 0.64) - from; // последний элемент успевает собраться к k = 1
    let ci = 0;
    words.forEach((word, j) => {
      const w = document.createElement('span');
      w.className = 'w';
      if (mode === 'sift') {
        for (const ch of word) {
          const c = document.createElement('span');
          c.className = 'c';
          c.textContent = ch;
          const raw = clamp((ci / total) * 0.82 + r() * 0.18, 0, 1);
          c.style.setProperty('--th', (from + raw * span).toFixed(3));
          c.style.setProperty('--jy', `${-(6 + r() * 30).toFixed(1)}px`);
          w.append(c);
          ci++;
        }
      } else {
        w.textContent = word;
        const raw = clamp((j / Math.max(1, n - 1)) * 0.9 + r() * 0.1, 0, 1);
        w.style.setProperty('--th', (from + raw * span).toFixed(3));
      }
      vis.append(w);
      if (j < n - 1) vis.append(document.createTextNode(' '));
    });
    el.replaceChildren(sr, vis);
    // блик по готовому заголовку: копия текста поверх, видна только движущаяся полоса света
    if (el.hasAttribute('data-shimmer')) {
      const sh = document.createElement('span');
      sh.className = 'tshimmer';
      sh.setAttribute('aria-hidden', 'true');
      sh.textContent = text;
      sh.style.setProperty('--sp', `${Math.max(8, Math.round(text.length * 3))}px`);
      el.append(sh);
      // бегает только пока заголовок на экране
      new IntersectionObserver((es) => el.classList.toggle('tshimmer-run', es.some((e) => e.isIntersecting)), { threshold: 0.01 }).observe(el);
    }
  }

  /* ============================================================
     3. Общий загрузчик скраб-видео: весь файл в Blob (хосты без Range), поток с watchdog.
        onFrac(доля) зовётся не чаще 10 раз в секунду, последний вызов всегда доходит.
        Оборванный поток не выдаём за ролик. Используют герой и Фемида.
     ============================================================ */
  async function streamBlob(url, bytes, ctrl, onFrac) {
    let watchdog = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { priority: 'low', signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error('video ' + res.status);
      const total = Number(res.headers.get('Content-Length')) || bytes;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      let lastAt = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ctrl.abort(), 20000); // 20 с без новых байт: обрываем
        chunks.push(value);
        got += value.length;
        const frac = Math.min(1, got / total);
        const now = performance.now();
        if (onFrac && (now - lastAt > 100 || frac === 1)) { lastAt = now; onFrac(frac); }
      }
      if (got < total) throw new Error('video truncated ' + got + '/perspektiva/' + total);
      return new Blob(chunks, { type: 'video/mp4' });
    } finally {
      clearTimeout(watchdog);
    }
  }

  // Один seek в пути. Таймер освобождает гейт, если WebKit потерял seeked,
  // а действительно зависшую перемотку переводит в повторяемую загрузку.
  function makeSeekGate(v, isReady, onStall = () => {}) {
    let busy = false;
    let pending = null;
    let timer = null;
    const reset = () => { busy = false; pending = null; clearTimeout(timer); };
    const complete = () => {
      busy = false;
      clearTimeout(timer);
      if (pending !== null) { const t = pending; pending = null; req(t); }
    };
    const req = (t) => {
      if (!isReady() || !v.duration) return;
      t = clamp(t, 0, v.duration - 0.04);
      if (busy) { pending = t; return; }
      if (Math.abs(v.currentTime - t) < 0.001) return;
      busy = true;
      try {
        v.currentTime = t;
        timer = setTimeout(() => {
          if (!v.seeking) complete();
          else { reset(); onStall(); }
        }, 2000);
      } catch (error) { reset(); onStall(error); }
    };
    v.addEventListener('seeked', complete);
    v.addEventListener('timeupdate', () => { if (busy && !v.seeking) complete(); });
    v.addEventListener('error', reset);
    req.reset = reset;
    return req;
  }

  /* ============================================================
     3a. Часы: кадры прежнего ролика, JPEG + transform, без видеоплеера.
        Один механизм на телефоне и компьютере, прогресс задаётся прокруткой.
     ============================================================ */
  const PORTRAIT = '(orientation: portrait) and (max-width: 1024px)';
  const REDUCED = '(prefers-reduced-motion: reduce)';
  const frameSource = (kind, width, height) => ({
    width, height, count: 60, columns: 3, rows: 2, perSheet: 6,
    sheets: Array.from({ length: 10 }, (_, i) => `assets/hourglass-frames/${kind}-${String(i).padStart(2, '0')}.jpg`)
  });
  const SOURCES = {
    wide: { poster: 'assets/hourglass-poster.jpg', frames: frameSource('wide', 896, 506) },
    tall: { poster: 'assets/hourglass-poster-phone.jpg', frames: frameSource('tall', 432, 768) }
  };
  const root = document.documentElement;
  const hero = $('.hero');
  const stage = $('#stage');
  const framesElement = $('#hero-frames');
  const posterLayer = $('.poster');
  const ring = $('.ring');
  const cue = $('.cue');
  const motionControl = $('#motion-control');
  const motionStart = $('#motion-start');
  const motionHint = $('#motion-hint');
  const bands = $$('.band').map((el, i) => {
    const [a, b] = el.dataset.band.split(',').map(Number);
    return { el, i, a, b, ramp: el.dataset.ramp ? Number(el.dataset.ramp) : null, op: -1, k: -1, interactive: !!el.querySelector('a,button') };
  });
  const lastBand = bands.length - 1;
  let scrubOn = false;
  let framesFailed = false;
  let heroOnScreen = true;
  let target = 0;
  let shown = 0;
  let rafId = null;
  let lastTick = 0;
  let loadK = 0;
  let loadRampRunning = false;
  let cueGone = null;
  let srcKey = null;
  let loadToken = 0;
  let frameRenderer = null;
  let motionRequested = false;
  let savedP = 0;
  let lastW = innerWidth;
  let resizedAt = 0;

  function heroRange() { return hero.offsetHeight - stage.offsetHeight; }
  function heroProgress() {
    const range = heroRange();
    return range > 0 ? clamp(-hero.getBoundingClientRect().top / range, 0, 1) : 0;
  }
  function updateCaptions(p) {
    for (const b of bands) {
      const f = Math.min(0.02, (b.b - b.a) / 3);
      const fadeIn = b.i === 0 ? 1 : smoothstep(p, b.a, b.a + f);
      const fadeOut = b.i === lastBand ? 1 : 1 - smoothstep(p, b.b - f, b.b);
      const op = fadeIn * fadeOut;
      let k = clamp((p - b.a) / (b.ramp || Math.min(0.045, (b.b - b.a) * 0.35)), 0, 1);
      if (b.i === 0) k = Math.max(k, loadK);
      if (op !== b.op && (Math.abs(op - b.op) > 0.004 || op === 0 || op === 1)) {
        b.op = op;
        b.el.style.opacity = op.toFixed(3);
        if (b.interactive) b.el.inert = op < 0.05;
      }
      if (k !== b.k && (Math.abs(k - b.k) >= 0.008 || k === 0 || k === 1)) {
        b.k = k;
        b.el.style.setProperty('--k', k.toFixed(3));
      }
    }
    const gone = p > 0.03;
    if (gone !== cueGone) { cueGone = gone; cue.classList.toggle('gone', gone); }
  }
  function showMotionControl(label = 'Показывать движение', hint = 'На устройстве включено уменьшение движения.') {
    motionControl.hidden = false;
    motionStart.textContent = label;
    motionHint.textContent = hint;
    stage.classList.add('needs-motion-control');
  }
  function hideMotionControl() {
    motionControl.hidden = true;
    stage.classList.remove('needs-motion-control');
  }
  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    shown += (target - shown) * (1 - Math.pow(1 - 0.16, dt / 16.667));
    if (Math.abs(target - shown) < 0.0005) { shown = target; rafId = null; lastTick = 0; }
    else rafId = requestAnimationFrame(tick);
    if (frameRenderer) frameRenderer.seek(shown);
    updateCaptions(shown);
  }
  function onScroll() {
    if (!scrubOn) return;
    target = heroProgress();
    if (performance.now() - resizedAt > 400) savedP = target;
    if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
  }
  function onResize() {
    resizedAt = performance.now();
    if (frameRenderer) frameRenderer.resize();
    if (innerWidth === lastW) { onScroll(); return; }
    lastW = innerWidth;
    const p = savedP;
    requestAnimationFrame(() => {
      if (scrubOn && p > 0 && p < 1) {
        const top = hero.getBoundingClientRect().top + scrollY;
        scrollTo({ top: Math.round(top + p * heroRange()), behavior: 'instant' });
      }
      target = shown = savedP = heroProgress();
      bands.forEach((b) => { b.op = -1; b.k = -1; });
      updateCaptions(shown);
      if (frameRenderer) { frameRenderer.resize(); frameRenderer.seek(shown); }
    });
  }
  function runLoadRamp() {
    if (loadRampRunning || loadK >= 1) return;
    loadRampRunning = true;
    const t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / 650, 0, 1);
      loadK = 1 - Math.pow(1 - t, 3);
      if (scrubOn) updateCaptions(shown);
      if (t < 1 && scrubOn) requestAnimationFrame(step);
      else { loadRampRunning = false; if (t >= 1) loadK = 1; }
    };
    requestAnimationFrame(step);
  }
  function loadSource(key) {
    if (key === srcKey) return;
    srcKey = key;
    const token = ++loadToken;
    if (frameRenderer) frameRenderer.destroy();
    frameRenderer = null;
    stage.classList.remove('frames-ready', 'loaded');
    stage.dataset.heroRenderer = 'jpeg-frames';
    stage.dataset.motionState = 'loading';
    ring.style.setProperty('--ld', 126);
    hideMotionControl();
    const source = SOURCES[key];
    posterLayer.style.backgroundImage = `url('${source.poster}?v=sand-original-20261106-r4')`;
    if (typeof window.PSPFrameSequence !== 'function') { failFrames(); return; }
    frameRenderer = window.PSPFrameSequence(framesElement, source.frames, {
      onReady: () => {
        if (token !== loadToken || !scrubOn) return;
        stage.dataset.motionState = 'ready';
        stage.classList.add('loaded', 'frames-ready');
        ring.style.setProperty('--ld', 0);
        hideMotionControl();
        updateCaptions(shown);
      },
      onError: () => { if (token === loadToken && scrubOn) failFrames(); }
    });
    frameRenderer.seek(shown);
  }
  function failFrames() {
    if (framesFailed) return;
    framesFailed = true;
    stage.dataset.motionState = 'failed';
    stage.classList.remove('frames-ready');
    applyHeroMode();
    showMotionControl('Повторить загрузку', 'Не удалось загрузить изображение. Попробуйте ещё раз.');
  }
  new IntersectionObserver((entries) => {
    heroOnScreen = entries[0].isIntersecting;
    if (heroOnScreen) onScroll();
  }).observe(hero);

  /* ============================================================
     4. Статичный режим только по настройке уменьшения движения или ошибке.
     ============================================================ */
  const portraitMQ = matchMedia(PORTRAIT);
  const reducedMotion = matchMedia(REDUCED);
  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    bands.forEach((b) => { b.op = -1; b.k = -1; });
    cueGone = null;
    unpinFinalStates();
    target = shown = savedP = heroProgress();
    loadSource(portraitMQ.matches ? 'tall' : 'wide');
    updateCaptions(shown);
    onScroll();
    runLoadRamp();
  }
  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    ++loadToken;
    if (frameRenderer) frameRenderer.destroy();
    frameRenderer = null;
    srcKey = null;
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; lastTick = 0; }
    bands.forEach((b) => { if (b.interactive) b.el.inert = false; });
  }
  function applyHeroMode() {
    const makeStatic = (reducedMotion.matches && !motionRequested) || framesFailed;
    if (makeStatic === root.classList.contains('static-hero') && makeStatic === !scrubOn) return;
    const next = hero.nextElementSibling;
    const anchorTop = next ? next.getBoundingClientRect().top : 0;
    const below = anchorTop < innerHeight * 0.5;
    root.classList.toggle('static-hero', makeStatic);
    if (makeStatic) disableScrub(); else enableScrub();
    if (next && below) {
      const shift = next.getBoundingClientRect().top - anchorTop;
      if (Math.abs(shift) > 1) scrollBy({ top: shift, behavior: 'instant' });
    }
  }
  portraitMQ.addEventListener('change', () => {
    if (scrubOn) loadSource(portraitMQ.matches ? 'tall' : 'wide');
  });
  motionStart.addEventListener('click', () => {
    motionRequested = true;
    framesFailed = false;
    applyHeroMode();
  });

  /* ============================================================
     5. Линии, которые рисуются скроллом
     ============================================================ */
  let pinned = false;
  const activeDraws = new Set();
  let drawRaf = null;
  function updateDraws() {
    drawRaf = null;
    const vh = innerHeight;
    activeDraws.forEach((el) => {
      const r = el.getBoundingClientRect();
      const v = pinned ? 1 : clamp((vh * 0.95 - r.top) / (vh * 0.5), 0, 1);
      if (v !== el._draw && (Math.abs(v - (el._draw ?? -1)) > 0.004 || v === 0 || v === 1)) {
        el._draw = v;
        el.style.setProperty('--draw', v.toFixed(3));
        el.classList.toggle('drawn', v >= 1);
      }
    });
  }
  const scheduleDraw = () => { if (drawRaf === null) drawRaf = requestAnimationFrame(updateDraws); };
  const drawIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? activeDraws.add(e.target) : activeDraws.delete(e.target)));
    scheduleDraw();
  }, { rootMargin: '10% 0px' });
  addEventListener('scroll', () => { if (!pinned) scheduleDraw(); }, { passive: true });

  function setTrack() {
    $$('.steps-line').forEach((l) => l.style.setProperty('--track', l.offsetWidth + 'px'));
  }

  /* ============================================================
     6. Входы секций, живые элементы, пауза на скрытой вкладке
     ============================================================ */
  function setupReveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        io.unobserve(el);
        el.classList.add('in');
        const n = $$('.r', el).length;
        setTimeout(() => el.classList.add('done'), n * 110 + 1100);
        if (el.classList.contains('stats')) runCounters();
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal').forEach((el) => {
      $$('.r', el).forEach((r, i) => r.style.setProperty('--i', i));
      io.observe(el);
    });

    const liveIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle('live', e.isIntersecting));
    });
    $$('main > section, .divider').forEach((s) => liveIO.observe(s));

    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('paused', document.hidden);
    });
  }

  /* ============================================================
     7. Цифры: счётчик только для настоящего значения
     ============================================================ */
  let countersRun = false;
  function runCounters() {
    if (countersRun) return;
    countersRun = true;
    $$('[data-count]').forEach((el) => {
      const raw = resolve(el.dataset.fact);
      if (isMissing(raw)) return; // заглушка не анимируется
      const finalText = String(raw);
      const n = Number(finalText.replace(/[^\d]/g, ''));
      if (!n || pinned || reducedMotion.matches) { el.textContent = finalText; return; }
      const t0 = performance.now();
      let lastText = '';
      let lastAt = 0;
      const step = (now) => {
        const t = clamp((now - t0) / 1600, 0, 1);
        const v = Math.round(n * (1 - Math.pow(1 - t, 3)));
        const text = t >= 1 ? finalText : v.toLocaleString('ru-RU');
        if (text !== lastText && (now - lastAt > 100 || t >= 1)) {
          lastText = text;
          lastAt = now;
          el.textContent = text;
        }
        if (t < 1 && !pinned) requestAnimationFrame(step);
        else el.textContent = finalText;
      };
      requestAnimationFrame(step);
    });
  }

  /* ============================================================
     8. Навигация
     ============================================================ */
  function setupNav() {
    const nav = $('#nav');
    const burger = $('.burger');
    const links = $('#nav-links');
    let solid = null;
    const update = () => {
      const s = hero.getBoundingClientRect().bottom < 90;
      if (s !== solid) { solid = s; nav.classList.toggle('solid', s); }
    };
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    update();
    const close = () => {
      links.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Открыть меню');
    };
    burger.addEventListener('click', () => {
      const open = !links.classList.contains('open');
      links.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
    links.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ============================================================
     9. Практики: голограмма. Ядро, шесть узлов, провода с искрами.
        Данные: SITE.practices.{private,business} = [{icon,title,text}].
        Кольца и искры крутятся только под .live (секция на экране) и встают на body.paused.
     ============================================================ */
  const PH_ICONS = {
    gavel: '<path d="M8 40h20M14 34h8"/perspektiva/><path d="m19 22 14-14M15 18l8-8 8 8-8 8z"/perspektiva/><path d="m27 22 13 13"/>',
    family: '<circle cx="16" cy="14" r="5"/perspektiva/><circle cx="32" cy="14" r="5"/perspektiva/><path d="M6 38c0-8 4-13 10-13s10 5 10 13M22 38c0-8 4-13 10-13s10 5 10 13"/>',
    scroll: '<path d="M14 8h22v28a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-4h22v4"/perspektiva/><path d="M14 8a4 4 0 0 0-4 4v20M19 16h12M19 22h12M19 28h8"/>',
    house: '<path d="M6 22 24 8l18 14"/perspektiva/><path d="M11 19v21h26V19M20 40V28h8v12"/>',
    work: '<rect x="6" y="14" width="36" height="24" rx="3"/perspektiva/><path d="M18 14v-4h12v4M6 24h36"/>',
    shield: '<path d="M24 6 8 12v10c0 10 7 17 16 20 9-3 16-10 16-20V12z"/perspektiva/><path d="m17 24 5 5 9-10"/>',
    building: '<path d="M6 40h36M8 18h32L24 8z"/perspektiva/><path d="M12 18v20M20 18v20M28 18v20M36 18v20"/>',
    percent: '<path d="M12 6h18l8 8v28H12z"/perspektiva/><path d="M30 6v8h8M18 34l12-14"/perspektiva/><circle cx="19" cy="22" r="2"/perspektiva/><circle cx="29" cy="32" r="2"/>',
    broken: '<path d="M8 36 18 22l8 8 14-18"/perspektiva/><path d="M32 12h8v8"/perspektiva/><path d="M8 42h32"/>',
    contract: '<path d="M12 6h18l8 8v28H12z"/perspektiva/><path d="M30 6v8h8M18 22h14M18 28h14M18 36l4-3 3 3 4-4"/>',
    people: '<circle cx="14" cy="16" r="5"/perspektiva/><circle cx="34" cy="16" r="5"/perspektiva/><path d="M4 38c0-7 4-12 10-12s10 5 10 12M24 38c0-7 4-12 10-12s10 5 10 12"/perspektiva/><path d="M20 30h8"/>',
    search: '<circle cx="21" cy="21" r="12"/perspektiva/><path d="m30 30 10 10M16 21h10"/>'
  };
  // позиции узлов на схеме 1240x640: по три слева и справа от ядра
  const PH_POS = [[170, 110], [120, 320], [170, 530], [1070, 110], [1120, 320], [1070, 530]];
  const PH_CX = 620;
  const PH_CY = 320;
  const PH_IDLE = { title: 'Выберите направление', text: 'Нажмите на практику, и здесь появится, чем поможет адвокат.' };

  // ломаная провода: от узла вбок, наискосок к оси ядра, по оси до кольца
  function phWirePoints(p) {
    const left = p[0] < PH_CX;
    return [p, [left ? p[0] + 60 : p[0] - 60, p[1]], [left ? PH_CX - 200 : PH_CX + 200, PH_CY], [left ? PH_CX - 190 : PH_CX + 190, PH_CY]];
  }
  // искра бежит по проводу через transform (keyframes по длинам отрезков, скорость ровная)
  function phSparkKeyframes() {
    return PH_POS.map((p, i) => {
      const pts = phWirePoints(p);
      const seg = pts.slice(1).map((q, k) => Math.hypot(q[0] - pts[k][0], q[1] - pts[k][1]));
      const total = seg.reduce((a, b) => a + b, 0);
      let acc = 0;
      const frames = pts.map((q, k) => {
        if (k > 0) acc += seg[k - 1];
        return `${((acc / total) * 100).toFixed(2)}%{transform:translate(${q[0]}px,${q[1]}px)}`;
      });
      return `@keyframes ph-sp${i}{${frames.join('')}}`;
    }).join('\n');
  }

  function setupPractice() {
    const section = $('#practice');
    if (!section) return;
    const NS = 'http://www.w3.org/2000/svg';
    const tabs = $$('.seg [role="tab"]', section);
    const seg = $('.seg', section);
    const stageEl = $('.ph-stage', section);
    const nodesEl = $('.ph-nodes', section);
    const wires = $('.ph-wires', section);
    const grid = $('.ph-grid', section);
    const core = $('.ph-core', section);
    const title = $('.ph-title', section);
    const desc = $('.ph-desc', section);
    // страница практики: ссылка в ядре видна, только если страница опубликована (список .ph-pages собирает генератор)
    const pageLink = $('.ph-page', section);
    const published = new Set($$('.ph-pages a', section).map((a) => a.getAttribute('href')));
    const setPage = (it) => {
      if (!pageLink) return;
      const ok = !!(it && it.url && published.has(it.url));
      pageLink.hidden = !ok;
      if (ok) { pageLink.href = it.url; pageLink.textContent = 'Подробнее: ' + it.title; }
    };

    const style = document.createElement('style');
    style.textContent = phSparkKeyframes();
    document.head.append(style);

    for (let x = 40; x < 1240; x += 80) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', 0); l.setAttribute('y2', 640);
      grid.append(l);
    }
    for (let y = 40; y < 640; y += 80) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('y1', y); l.setAttribute('y2', y); l.setAttribute('x1', 0); l.setAttribute('x2', 1240);
      grid.append(l);
    }

    let list = [];
    let current = -1;
    let swapTimer = null;
    const setPanel = (t, d) => { title.textContent = t; desc.textContent = d; };

    function select(i) {
      if (current === i || !list[i]) return;
      current = i;
      $$('.ph-node', nodesEl).forEach((n, k) => {
        n.classList.toggle('on', k === i);
        n.setAttribute('aria-pressed', String(k === i));
      });
      $$('[data-wire]', wires).forEach((el) => el.classList.toggle('on', Number(el.dataset.wire) === i));
      setPage(list[i]);
      clearTimeout(swapTimer);
      if (reducedMotion.matches) {
        core.classList.remove('swap');
        setPanel(list[i].title, list[i].text);
        return;
      }
      core.classList.add('swap');
      swapTimer = setTimeout(() => {
        setPanel(list[i].title, list[i].text);
        core.classList.remove('swap');
      }, 220);
    }

    function build(set) {
      list = (SITE.practices && Array.isArray(SITE.practices[set]) ? SITE.practices[set] : [])
        .filter((it) => it && typeof it === 'object')
        .slice(0, PH_POS.length);
      current = -1;
      clearTimeout(swapTimer);
      core.classList.remove('swap');
      nodesEl.replaceChildren();
      wires.replaceChildren();
      list.forEach((it, i) => {
        const p = PH_POS[i];
        const d = phWirePoints(p).map((q, k) => (k ? 'L' : 'M') + q[0] + ' ' + q[1]).join(' ');
        const base = document.createElementNS(NS, 'path');
        base.setAttribute('d', d);
        base.setAttribute('class', 'ph-wire');
        const on = document.createElementNS(NS, 'path');
        on.setAttribute('d', d);
        on.setAttribute('class', 'ph-wire-on');
        on.dataset.wire = i;
        wires.append(base, on);
        const dur = 4 + i * 0.7;
        for (let s = 0; s < 3; s++) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('r', '2.4');
          c.setAttribute('class', 'ph-spark s' + s);
          c.style.transform = `translate(${p[0]}px,${p[1]}px)`;
          c.style.setProperty('--anim', `ph-sp${i} ${dur}s`);
          c.style.setProperty('--delay', `${(-dur * s) / 3}s`);
          if (s) c.dataset.wire = i; // вторая и третья искры видны только на выбранном проводе
          wires.append(c);
        }

        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ph-node';
        b.style.left = (p[0] / 1240) * 100 + '%';
        b.style.top = (p[1] / 640) * 100 + '%';
        b.setAttribute('aria-pressed', 'false');
        b.innerHTML = '<span class="ph-glow" aria-hidden="true"></span><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + (PH_ICONS[it.icon] || '') + '</svg><span class="ph-label"></span>';
        const label = $('.ph-label', b);
        label.textContent = it.title;
        label.dataset.t = it.title;
        const pick = () => select(i);
        b.addEventListener('mouseenter', pick);
        b.addEventListener('focus', pick);
        b.addEventListener('click', pick);
        nodesEl.append(b);
      });
      setPanel(PH_IDLE.title, PH_IDLE.text);
      setPage(null);
      if (reducedMotion.matches) select(0); // без движения: статично, первая практика выбрана
    }

    const selectTab = (idx, focus) => {
      tabs.forEach((t, i) => {
        const on = i === idx;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      seg.classList.toggle('second', idx === 1);
      stageEl.setAttribute('aria-labelledby', tabs[idx].id);
      build(tabs[idx].dataset.set);
      if (focus) tabs[idx].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { if (t.getAttribute('aria-selected') !== 'true') selectTab(i, false); });
      t.addEventListener('keydown', (e) => {
        let next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        selectTab(next, true);
      });
    });
    build(tabs[Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'))].dataset.set);
    reducedMotion.addEventListener('change', (e) => { if (e.matches && current < 0) select(0); });
  }

  /* ============================================================
     9a. «Три страха»: скролл-видео бронзовой Фемиды.
         Ролик грузится лениво, когда секция в экране от неё; до загрузки и при ошибке на месте постер.
         Reduced motion: статичный конечный кадр из CSS, ролик и постер не запрашиваются.
         Цикл rAF живёт, только пока секция на экране, и засыпает при сходимости.
     ============================================================ */
  const THEMIS = { video: 'assets/themis-scrub.mp4', bytes: 2641932, poster: 'assets/themis-poster.jpg' };

  function setupThemis() {
    const section = $('#promise');
    const tStage = $('#pr-stage');
    const tv = $('#themis-video');
    if (!section || !tStage || !tv) return;
    const tPoster = $('.pr-poster', section);
    const items = $$('.fear-col', section).map((el, i) => {
      const [a, b] = el.dataset.band.split(',').map(Number);
      return { el, i, a, b, k: -1, op: -1 };
    });
    const lastItem = items.length - 1;
    let armed = false;      // скраб включён (нет reduced motion)
    let near = false;       // секция ближе экрана от вьюпорта
    let onScreen = false;   // секция в экране
    let requested = false;  // ролик уже запрошен
    let ready = false;
    let failed = false;
    let tgt = 0;
    let cur = 0;
    let raf = null;
    let lastT = 0;
    const seek = makeSeekGate(tv, () => ready);

    const range = () => section.offsetHeight - tStage.offsetHeight;
    const progress = () => {
      const r = range();
      return r > 0 ? clamp(-section.getBoundingClientRect().top / r, 0, 1) : 0;
    };

    // Каждый страх владеет своей полосой [a,b]: появление, перечёркивание, ответ (--k 0..1), дальше плато.
    // Ноутбук: страхи копятся в колонке. Портрет: сменяют друг друга (--op гаснет после полосы).
    function paint(p) {
      const tall = portraitMQ.matches;
      const F = 0.04;
      for (const it of items) {
        const len = it.b - it.a;
        let k = clamp((p - it.a) / (len * (tall ? 0.35 : 0.62)), 0, 1);
        if (it.i === 0) k = Math.max(k, 0.25); // первый страх уже на месте, когда секция входит в экран
        let op = 1;
        if (tall) {
          const fadeIn = it.i === 0 ? 1 : smoothstep(p, it.a, it.a + F);
          const fadeOut = it.i === lastItem ? 1 : 1 - smoothstep(p, it.b, it.b + F);
          op = fadeIn * fadeOut;
        }
        if (k !== it.k && (Math.abs(k - it.k) >= 0.008 || k === 0 || k === 1)) {
          it.k = k;
          it.el.style.setProperty('--k', k.toFixed(3));
        }
        if (op !== it.op && (Math.abs(op - it.op) > 0.004 || op === 0 || op === 1)) {
          it.op = op;
          it.el.style.setProperty('--op', op.toFixed(3));
        }
      }
    }

    function tick(now) {
      const dt = Math.min(100, now - (lastT || now));
      lastT = now;
      cur += (tgt - cur) * (1 - Math.pow(1 - 0.16, dt / 16.667));
      if (Math.abs(tgt - cur) < 0.0005) {
        cur = tgt;
        raf = null;
        lastT = 0;
      } else {
        raf = requestAnimationFrame(tick);
      }
      seek(cur * (tv.duration || 0));
      paint(cur);
    }
    function stop() {
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; lastT = 0; }
    }
    function onScroll() {
      if (!armed || !onScreen) return;
      tgt = progress();
      if (raf === null) raf = requestAnimationFrame(tick);
    }

    function load() {
      if (requested || !armed) return;
      requested = true;
      tPoster.style.backgroundImage = `url('${THEMIS.poster}')`;
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        const ctrl = new AbortController();
        streamBlob(THEMIS.video, THEMIS.bytes, ctrl).then((blob) => {
          tv.addEventListener('loadeddata', () => {
            if (failed) return;
            ready = true;
            tStage.classList.add('video-ready');
            cur = tgt = progress();
            seek(cur * tv.duration);
            paint(cur);
          }, { once: true });
          tv.addEventListener('error', fail, { once: true });
          tv.preload = 'auto';
          tv.src = URL.createObjectURL(blob);
          tv.load();
          setTimeout(() => { if (!ready) fail(); }, 8000); // скачан, но не декодируется
        }).catch(fail);
      };
      const img = new Image();
      img.onload = start;
      img.onerror = start;
      img.src = THEMIS.poster;
      setTimeout(start, 4000);
    }
    function fail() {
      failed = true;
      ready = false;
      seek.reset();
      tStage.classList.remove('video-ready');
      tStage.classList.add('video-failed'); // постер остаётся, страхи по-прежнему идут по прокрутке
    }

    function apply() {
      const want = !reducedMotion.matches;
      if (want === armed) return;
      armed = want;
      if (!armed) {
        stop();
        removeEventListener('scroll', onScroll);
        return; // статичный кадр и все ответы держит CSS
      }
      addEventListener('scroll', onScroll, { passive: true });
      items.forEach((it) => { it.k = -1; it.op = -1; });
      cur = tgt = progress();
      paint(cur);
      seek(cur * (tv.duration || 0));
      if (near) load();
    }
    const relayout = () => {
      if (!armed) return;
      items.forEach((it) => { it.k = -1; it.op = -1; });
      cur = tgt = progress();
      paint(cur);
      seek(cur * (tv.duration || 0));
    };

    new IntersectionObserver((entries) => {
      near = entries[0].isIntersecting;
      if (near) load();
    }, { rootMargin: '100% 0px' }).observe(section);
    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      if (onScreen) onScroll();
      else stop();
    }).observe(section);
    let lastWidth = innerWidth;
    addEventListener('resize', () => {
      if (innerWidth === lastWidth) { onScroll(); return; } // адресная строка телефона: только высота
      lastWidth = innerWidth;
      relayout();
    });
    portraitMQ.addEventListener('change', relayout);
    reducedMotion.addEventListener('change', apply);
    apply();
  }

  /* ============================================================
     10. Интерактив «Рассейте туман»: удержание
     ============================================================ */
  const clarity = $('#clarity');
  const holdBtn = $('#hold');
  const holdStatus = $('#hold-status');
  let holdP = 0;
  let holding = false;
  let holdDone = false;
  let holdPinned = false;
  let holdRaf = null;
  let holdLast = 0;
  let holdLastStr = '';

  function setHoldP(v) {
    const s = v.toFixed(3);
    if (s !== holdLastStr) {
      holdLastStr = s;
      clarity.style.setProperty('--p', s);
    }
  }
  function holdFrame(now) {
    const dt = Math.min(64, now - (holdLast || now));
    holdLast = now;
    if (holding) holdP = Math.min(1, holdP + dt / 1600);
    else holdP = Math.max(0, holdP - (dt / 1000) * (0.35 + holdP * 0.9)); // плавный откат, без щелчка в ноль
    setHoldP(holdP);
    if (holdP >= 1) { holdRaf = null; holdLast = 0; completeHold(false); return; }
    if (holding || holdP > 0) holdRaf = requestAnimationFrame(holdFrame);
    else { holdRaf = null; holdLast = 0; }
  }
  function startHold() {
    if (holdDone) return;
    holding = true;
    holdBtn.classList.add('holding');
    if (holdRaf === null) { holdLast = 0; holdRaf = requestAnimationFrame(holdFrame); }
  }
  function stopHold() {
    holding = false;
    holdBtn.classList.remove('holding');
  }
  function completeHold(isPin) {
    const hadFocus = document.activeElement === holdBtn;
    holdDone = true;
    holdPinned = isPin;
    holding = false;
    holdP = 1;
    setHoldP(1);
    clarity.classList.add('done');
    holdStatus.textContent = 'Что с делом сейчас. Что можно сделать. Чем рискуете, если ничего не делать.';
    if (hadFocus) $('.clarity-after a').focus({ preventScroll: true });
  }
  function resetHold() {
    holdDone = false;
    holdPinned = false;
    holdP = 0;
    setHoldP(0);
    clarity.classList.remove('done');
    holdStatus.textContent = '';
  }
  function setupHold() {
    holdBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { holdBtn.setPointerCapture(e.pointerId); } catch (_) { /* захват не обязателен */ }
      startHold();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => holdBtn.addEventListener(ev, stopHold));
    holdBtn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) startHold();
      }
    });
    holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stopHold(); });
    holdBtn.addEventListener('blur', stopHold);
    holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    holdBtn.addEventListener('click', (e) => e.preventDefault());
  }

  /* ============================================================
     11. Уменьшение движения: живо, в обе стороны
     ============================================================ */
  function pinToFinalStates() {
    pinned = true;
    $$('.draw').forEach((el) => { el._draw = 1; el.style.setProperty('--draw', '1'); el.classList.add('drawn'); });
    $$('[data-count]').forEach((el) => {
      const raw = resolve(el.dataset.fact);
      if (!isMissing(raw)) el.textContent = String(raw);
    });
    countersRun = true;
    $$('.reveal').forEach((el) => el.classList.add('in', 'done'));
    if (clarity && !holdDone) completeHold(true);
    if (holdRaf !== null) { cancelAnimationFrame(holdRaf); holdRaf = null; }
  }
  function unpinFinalStates() {
    if (!pinned) return;
    pinned = false;
    $$('.draw').forEach((el) => { el._draw = undefined; el.classList.remove('drawn'); });
    scheduleDraw();
    if (clarity && holdPinned) resetHold(); // раскрытие, которое посетитель не заслужил удержанием, возвращается в туман
  }

  /* ============================================================
     12. Вопросы
     ============================================================ */
  function setupFaq() {
    $$('.qa button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qa = btn.closest('.qa');
        const open = !qa.classList.contains('open');
        qa.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* ============================================================
     13. Форма консультации: общая логика в assets/common.js (window.PSP.setupForm)
     ============================================================ */

  /* ============================================================
     Запуск
     ============================================================ */
  fillFacts();
  $$('[data-split]').forEach(splitText);
  setupNav();
  setupPractice();
  setupThemis();
  setupFaq();
  if (window.PSP) window.PSP.setupForm();
  if (clarity) setupHold();
  setupReveals();
  setTrack();
  addEventListener('resize', setTrack);
  $$('.draw').forEach((el) => drawIO.observe(el));

  reducedMotion.addEventListener('change', (e) => {
    motionRequested = false;
    if (e.matches) pinToFinalStates();
    else unpinFinalStates();
    applyHeroMode(); // скраб включается и выключается через тот же гейт
    if (e.matches) showMotionControl();
  });
  if (reducedMotion.matches) pinToFinalStates();
  applyHeroMode();
  if (reducedMotion.matches) showMotionControl();
})();
