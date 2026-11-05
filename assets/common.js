/* Перспектива · общий JS для всех страниц.
   Главная: выпадающий список практик в шапке и форма (app.js вызывает window.PSP.setupForm()).
   Внутренние страницы (body.inner): плюс мобильное меню, мягкие входы, линия горизонта, вопросы.
   Чистый JS без зависимостей. Тексты и факты уже в HTML (генератор tools/build.mjs). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const inner = document.body.classList.contains('inner');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ============================================================
     1. Шапка: выпадающий список «Практики» (мышь, клавиатура, тач)
     ============================================================ */
  function setupDropdown() {
    const dd = $('.nav-dd');
    if (!dd) return;
    const btn = $('.nav-dd-btn', dd);
    const set = (open) => {
      dd.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => set(!dd.classList.contains('open')));
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) set(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dd.classList.contains('open')) { set(false); btn.focus(); }
    });
    dd.addEventListener('focusout', (e) => { if (!dd.contains(e.relatedTarget)) set(false); });
  }

  /* ============================================================
     2. Мобильное меню (на главной им управляет app.js)
     ============================================================ */
  function setupBurger() {
    const burger = $('.burger');
    const links = $('#nav-links');
    if (!burger || !links) return;
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
     3. Мягкие входы секций и линия горизонта (рисуется при появлении)
     ============================================================ */
  function setupReveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        e.target.classList.add('in');
        if (e.target.classList.contains('draw')) e.target.style.setProperty('--draw', '1');
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    $$('.reveal').forEach((el) => {
      $$('.r', el).forEach((r, i) => r.style.setProperty('--i', Math.min(i, 6)));
      io.observe(el);
    });
    $$('.draw').forEach((el) => io.observe(el));
    const liveIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.target.classList.toggle('live', e.isIntersecting));
    });
    $$('main > section').forEach((s) => liveIO.observe(s));
    document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));
    void reducedMotion;
  }

  /* ============================================================
     4. Вопросы: аккордеон (ответы уже в HTML, видны роботу)
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
     5. Форма консультации (главная и все внутренние страницы)
     ============================================================ */

  /**
   * submitLead(payload) -> Promise<{ok:boolean}>
   * Единственное место будущей отправки заявки.
   * СЕЙЧАС ДЕМО: заявка НИКУДА НЕ ОТПРАВЛЯЕТСЯ, функция только отвечает успехом.
   * Подключение: замените тело на запрос к обработчику на сервере в РФ (152-ФЗ, локализация ПДн),
   * например: return fetch('/perspektiva/lead', {method:'POST', headers:{'Content-Type':'application/json'},
   *   body: JSON.stringify(payload)}).then(r => ({ ok: r.ok })).catch(() => ({ ok: false }));
   * payload: { name, phone, topic, message, consent: true, page }
   */
  function submitLead(payload) {
    void payload;
    return new Promise((resolveLead) => setTimeout(() => resolveLead({ ok: true }), 700));
  }
  window.submitLead = submitLead;

  function setupForm() {
    const form = $('#lead-form');
    if (!form) return;
    const success = $('#lead-success');
    const name = $('#f-name');
    const phone = $('#f-phone');
    const consent = $('#f-consent');
    const submit = $('#f-submit');
    const wrap = $('.submit-wrap');
    const shown = new Set();
    let sending = false;
    const status = $('#lead-status');

    const phoneOk = (v) => {
      const d = v.replace(/\D/g, '');
      return (d.length === 11 && /^[78]/.test(d)) || (d.length === 10 && d[0] === '9');
    };
    const rules = [
      { input: name, ok: () => name.value.trim().length >= 2 },
      { input: phone, ok: () => phoneOk(phone.value) },
      { input: consent, ok: () => consent.checked }
    ];
    const errFor = (input) => document.getElementById(input.getAttribute('aria-describedby'));
    const setErr = (rule, on) => {
      const el = errFor(rule.input);
      if (on) {
        el.textContent = el.dataset.msg;
        requestAnimationFrame(() => el.classList.add('on'));
        rule.input.setAttribute('aria-invalid', 'true');
        shown.add(rule.input);
      } else {
        el.classList.remove('on');
        el.textContent = '';
        rule.input.removeAttribute('aria-invalid');
        shown.delete(rule.input);
      }
    };
    const validate = () => {
      let first = null;
      rules.forEach((rule) => {
        const ok = rule.ok();
        setErr(rule, !ok);
        if (!ok && !first) first = rule.input;
      });
      if (first) first.focus();
      return !first;
    };
    const syncSubmit = () => {
      submit.disabled = sending || !consent.checked;
      wrap.classList.toggle('ready', consent.checked);
    };

    rules.forEach((rule) => {
      const ev = rule.input.type === 'checkbox' ? 'change' : 'input';
      rule.input.addEventListener(ev, () => { if (shown.has(rule.input) && rule.ok()) setErr(rule, false); });
    });
    consent.addEventListener('change', syncSubmit);

    phone.addEventListener('blur', () => { if (phone.value.trim() === '+7') phone.value = ''; });

    // кнопка неактивна до согласия: клик по ней показывает, чего не хватает
    wrap.addEventListener('click', () => { if (submit.disabled) validate(); });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && submit.disabled) {
        e.preventDefault();
        validate();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending || !validate()) return; // введённое не стирается
      sending = true;
      syncSubmit();
      if (status) status.textContent = '';
      try {
      submit.classList.add('sending');
      const topic = form.querySelector('input[name="topic"]:checked');
      const res = await submitLead({
        name: name.value.trim(),
        phone: phone.value.trim(),
        topic: topic ? topic.value : '',
        message: $('#f-msg').value.trim(),
        consent: true,
        page: location.pathname
      });
      if (!res || !res.ok) throw new Error('send-failed');
      if (res && res.ok) {
        form.hidden = true;
        success.hidden = false;
        success.focus();
      }
      } catch (_) {
        if (status) status.textContent = 'Не удалось отправить заявку. Данные сохранены в форме. Попробуйте ещё раз или свяжитесь с коллегией по электронной почте.';
      } finally {
        sending = false;
        submit.classList.remove('sending');
        syncSubmit();
      }
    });
    syncSubmit();
  }

  window.PSP = { submitLead, setupForm };

  setupDropdown();
  if (inner) {
    setupBurger();
    setupReveals();
    setupFaq();
    setupForm();
  }
})();
