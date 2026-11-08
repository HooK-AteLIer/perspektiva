/* Прокрутка кадров через обычные JPEG и transform, без HTMLVideoElement. */
(function (root) {
  'use strict';
  function createFrameSequence(container, source, options = {}) {
    const crop = container.querySelector('.frame-crop');
    const createImage = options.createImage || (() => new root.Image());
    const later = options.setTimeout || root.setTimeout.bind(root);
    const cancel = options.clearTimeout || root.clearTimeout.bind(root);
    const cache = new Map();
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    let disposed = false;
    let ready = false;
    let wanted = 0;
    let direction = 1;
    let nextSheet = 0;
    let displayed = -1;
    let displayedSheet = -1;
    let frameWidth = 0;
    let frameHeight = 0;
    container.hidden = false;

    function forget(index, entry) {
      cancel(entry.timer);
      entry.image.onload = null;
      entry.image.onerror = null;
      entry.image.src = '';
      cache.delete(index);
    }
    function prune() {
      const current = Math.floor(wanted / source.perSheet);
      for (const [index, entry] of cache) {
        if (index !== current && index !== nextSheet && index !== displayedSheet) forget(index, entry);
      }
      container.dataset.cachedSheets = String(cache.size);
    }
    function paint(force = false) {
      if (disposed || (!force && displayed === wanted)) return;
      const index = Math.floor(wanted / source.perSheet);
      const entry = cache.get(index);
      if (!entry || entry.status !== 'ready') return;
      const image = entry.image;
      const cell = wanted % source.perSheet;
      const column = cell % source.columns;
      const row = Math.floor(cell / source.columns);
      image.alt = '';
      image.draggable = false;
      image.style.width = (frameWidth * source.columns) + 'px';
      image.style.height = (frameHeight * source.rows) + 'px';
      image.style.transform = `translate3d(${-column * frameWidth}px, ${-row * frameHeight}px, 0)`;
      if (crop.firstChild !== image) crop.replaceChildren(image);
      displayed = wanted;
      displayedSheet = index;
      container.dataset.frame = String(displayed);
      container.dataset.sheet = String(index);
      prune();
      if (!ready) {
        ready = true;
        if (options.onReady) options.onReady();
      }
    }
    function request(index) {
      if (disposed || cache.has(index)) return;
      const image = createImage();
      const entry = { image, status: 'loading', timer: null };
      cache.set(index, entry);
      const fail = () => {
        if (disposed || cache.get(index) !== entry) return;
        cancel(entry.timer);
        entry.status = 'error';
        if (index === Math.floor(wanted / source.perSheet)) {
          if (options.onError) options.onError(new Error('Frame sheet could not be loaded'));
        } else forget(index, entry);
      };
      image.onload = () => {
        if (disposed || cache.get(index) !== entry) return;
        if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
        cancel(entry.timer);
        entry.status = 'ready';
        paint();
      };
      image.onerror = fail;
      image.decoding = 'async';
      image.fetchPriority = index === Math.floor(wanted / source.perSheet) ? 'high' : 'low';
      entry.timer = later(fail, 15000);
      image.src = source.sheets[index];
    }
    function seek(progress) {
      if (disposed) return;
      const p = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
      const frame = Math.round(p * (source.count - 1));
      if (frame !== wanted) direction = frame > wanted ? 1 : -1;
      wanted = frame;
      const current = Math.floor(wanted / source.perSheet);
      nextSheet = clamp(current + direction, 0, source.sheets.length - 1);
      request(current);
      paint();
      request(nextSheet);
      prune();
    }
    function resize() {
      if (disposed) return;
      const scale = Math.max(container.clientWidth / source.width, container.clientHeight / source.height);
      frameWidth = Math.max(1, Math.ceil(source.width * scale));
      frameHeight = Math.max(1, Math.ceil(source.height * scale));
      crop.style.width = frameWidth + 'px';
      crop.style.height = frameHeight + 'px';
      paint(true);
    }
    resize();
    return {
      seek,
      resize,
      getState: () => ({ frame: displayed, desired: wanted, cached: cache.size, ready }),
      destroy() {
        disposed = true;
        for (const [index, entry] of cache) forget(index, entry);
        crop.replaceChildren();
        container.hidden = true;
        delete container.dataset.frame;
        delete container.dataset.sheet;
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = createFrameSequence;
  else root.PSPFrameSequence = createFrameSequence;
})(typeof window !== 'undefined' ? window : globalThis);
