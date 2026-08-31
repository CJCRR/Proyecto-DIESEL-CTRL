(function () {
  const STORAGE_KEY = 'nexa_app_updates_seen_id';
  const NOTICE_STORAGE_KEY = 'nexa_app_updates_notice_id';
  const STYLE_ID = 'app-updates-inline-styles';
  const ROOT_ID = 'app-updates-root';
  const PEEK_ID = 'app-updates-peek';
  const FEED_URL = '/config/app-updates.json';
  const AUTO_NOTICE_DELAY_MS = 1400;
  const DEFAULT_APP_UPDATES = [
    {
      id: '2026-08-29-pos-fluidez',
      tone: 'blue',
      icon: 'fa-mobile-screen-button',
      tag: 'POS movil',
      date: '29 Ago 2026',
      title: 'Flujo de venta mas agil en telefono',
      summary: 'El POS responde mejor al escribir, enfoca la cantidad al seleccionar y ahora acepta Enter para agregar mas rapido.',
      bullets: [
        'Busqueda con menos saltos y menos carga por tecla.',
        'Cantidad optimizada para teclado numerico.',
        'Atajo directo para agregar desde el campo de cantidad.'
      ],
      href: '/pos',
      cta: 'Probar en POS'
    },
    {
      id: '2026-08-29-sesion-segura',
      tone: 'emerald',
      icon: 'fa-shield-heart',
      tag: 'Sesion',
      date: '29 Ago 2026',
      title: 'Sesion mas estable y coherente',
      summary: 'La sesion larga ahora queda alineada entre base de datos, cookies y JWT, con renovacion solo cuando hace falta.',
      bullets: [
        'Login persistente sin expulsar al usuario al rato.',
        'Logout invalida mejor el acceso por token y JWT.',
        'Menos renovaciones innecesarias en segundo plano.'
      ],
      href: '/pos',
      cta: 'Ver en uso'
    },
    {
      id: '2026-08-29-clientes-inteligentes',
      tone: 'amber',
      icon: 'fa-address-card',
      tag: 'Clientes',
      date: '29 Ago 2026',
      title: 'Cedula y telefono con ayuda en vivo',
      summary: 'Los campos del cliente ahora autocompletan el guion y muestran avisos suaves cuando el dato va incompleto.',
      bullets: [
        'Formato automatico para cedula, RIF y telefono.',
        'Ayudas visuales discretas sin bloquear la venta.',
        'Mejor lectura al cargar clientes frecuentes.'
      ],
      href: '/pos',
      cta: 'Revisar cliente'
    },
    {
      id: '2026-08-29-marcas-y-metodos',
      tone: 'rose',
      icon: 'fa-layer-group',
      tag: 'Catalogo',
      date: '29 Ago 2026',
      title: 'Control mas claro de marca y metodo de pago',
      summary: 'Cuando un producto tiene varias marcas, el POS ahora lo deja mas visible y exige elegir la correcta antes de vender.',
      bullets: [
        'Selector de marca con alerta visual discreta.',
        'Nuevo metodo de pago Cambio Devolucion.',
        'Filtro de reportes alineado con el nuevo metodo.'
      ],
      href: '/reportes',
      cta: 'Ver reportes'
    }
  ];

  let appUpdatesCache = null;
  let autoNoticeTimer = null;
  let lastFocusedElement = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncateText(value, maxLength = 96) {
    const text = String(value || '').trim();
    if (!text || text.length <= maxLength) return text;
    const slice = text.slice(0, maxLength);
    const lastSpace = slice.lastIndexOf(' ');
    const safeSlice = lastSpace > 48 ? slice.slice(0, lastSpace) : slice;
    return `${safeSlice.trim()}...`;
  }

  function normalizeUpdateEntry(item, index) {
    if (!item || typeof item !== 'object') return null;
    const id = String(item.id || `update-${index}`).trim();
    if (!id) return null;
    return {
      id,
      tone: String(item.tone || 'blue').trim() || 'blue',
      icon: String(item.icon || 'fa-bell').trim() || 'fa-bell',
      tag: String(item.tag || 'Actualizacion').trim() || 'Actualizacion',
      date: String(item.date || '').trim(),
      title: String(item.title || 'Nueva actualizacion').trim() || 'Nueva actualizacion',
      summary: String(item.summary || '').trim(),
      bullets: Array.isArray(item.bullets)
        ? item.bullets.map((bullet) => String(bullet || '').trim()).filter(Boolean).slice(0, 5)
        : [],
      href: typeof item.href === 'string' ? item.href.trim() : '',
      cta: String(item.cta || 'Abrir').trim() || 'Abrir'
    };
  }

  function normalizeUpdatesFeed(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeUpdateEntry).filter(Boolean);
  }

  async function loadUpdatesFeed(forceRefresh = false) {
    if (!forceRefresh && Array.isArray(appUpdatesCache)) {
      return appUpdatesCache;
    }

    try {
      const response = await fetch(FEED_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      appUpdatesCache = normalizeUpdatesFeed(data);
    } catch (err) {
      console.warn('No se pudo cargar el feed editable de novedades, usando fallback local.', err);
      appUpdatesCache = normalizeUpdatesFeed(DEFAULT_APP_UPDATES);
    }

    return appUpdatesCache;
  }

  function getUpdates() {
    return Array.isArray(appUpdatesCache) ? appUpdatesCache : DEFAULT_APP_UPDATES;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.app-updates-open {
        overflow: hidden;
      }

      .app-updates-toggle {
        position: relative;
        height: 2.35rem;
        width: 2.35rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.24);
        transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
      }

      .app-updates-toggle:hover,
      .app-updates-toggle[aria-expanded="true"] {
        background: rgba(59, 130, 246, 0.18);
        border-color: rgba(96, 165, 250, 0.45);
        transform: translateY(-1px);
      }

      .app-updates-toggle__badge {
        position: absolute;
        top: -0.2rem;
        right: -0.15rem;
        min-width: 1.1rem;
        height: 1.1rem;
        padding: 0 0.28rem;
        border-radius: 999px;
        background: linear-gradient(135deg, #fb7185, #ef4444);
        color: #fff;
        font-size: 0.62rem;
        font-weight: 800;
        line-height: 1.1rem;
        text-align: center;
        box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.95);
      }

      .app-updates-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 80;
      }

      .app-updates-root.is-open {
        pointer-events: auto;
      }

      .app-updates-peek {
        position: fixed;
        top: calc(4.8rem + env(safe-area-inset-top, 0px));
        right: 1rem;
        width: min(23rem, calc(100vw - 1.25rem));
        z-index: 75;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-10px) scale(0.98);
        transition: opacity 0.22s ease, transform 0.22s ease;
      }

      .app-updates-peek.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .app-updates-peek__card {
        border-radius: 1.25rem;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.96));
        color: #fff;
        padding: 0.9rem;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.28);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .app-updates-peek__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .app-updates-peek__meta {
        min-width: 0;
      }

      .app-updates-peek__eyebrow {
        font-size: 0.66rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #93c5fd;
      }

      .app-updates-peek__title {
        margin-top: 0.2rem;
        font-size: 0.88rem;
        font-weight: 800;
        line-height: 1.3;
      }

      .app-updates-peek__summary {
        margin-top: 0.3rem;
        color: rgba(226, 232, 240, 0.88);
        font-size: 0.74rem;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .app-updates-peek__icon {
        width: 2.15rem;
        height: 2.15rem;
        border-radius: 0.8rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(59, 130, 246, 0.16);
        color: #93c5fd;
        flex: 0 0 2.15rem;
      }

      .app-updates-peek__close {
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        border: 0;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
      }

      .app-updates-peek__actions {
        margin-top: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .app-updates-peek__open,
      .app-updates-peek__later {
        border: 0;
        cursor: pointer;
        border-radius: 0.9rem;
        padding: 0.62rem 0.8rem;
        font-size: 0.72rem;
        font-weight: 800;
      }

      .app-updates-peek__open {
        background: #fff;
        color: #0f172a;
      }

      .app-updates-peek__later {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(226, 232, 240, 0.95);
      }

      .app-updates-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
        backdrop-filter: blur(10px);
        opacity: 0;
        transition: opacity 0.22s ease;
      }

      .app-updates-root.is-open .app-updates-backdrop {
        opacity: 1;
      }

      .app-updates-panel {
        position: absolute;
        top: 0;
        right: 0;
        width: min(30rem, 100vw);
        height: 100%;
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98));
        border-left: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: -24px 0 48px rgba(15, 23, 42, 0.18);
        transform: translateX(100%);
        transition: transform 0.24s cubic-bezier(.2, .8, .2, 1);
        display: flex;
        flex-direction: column;
      }

      .app-updates-root.is-open .app-updates-panel {
        transform: translateX(0);
      }

      .app-updates-panel__header {
        padding: calc(0.9rem + env(safe-area-inset-top, 0px)) 0.95rem 0.85rem;
        border-bottom: 1px solid rgba(226, 232, 240, 0.95);
        background:
          radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 34%),
          linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.96));
        color: #fff;
      }

      .app-updates-panel__eyebrow {
        font-size: 0.62rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: rgba(191, 219, 254, 0.9);
      }

      .app-updates-panel__title {
        margin-top: 0.35rem;
        font-size: 1.02rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }

      .app-updates-panel__summary {
        margin-top: 0.65rem;
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex-wrap: wrap;
      }

      .app-updates-panel__metric {
        border-radius: 999px;
        padding: 0.4rem 0.65rem;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .app-updates-panel__metric strong {
        display: inline;
        font-size: 0.78rem;
        font-weight: 800;
        color: #fff;
      }

      .app-updates-panel__metric span {
        display: inline;
        margin-top: 0;
        font-size: 0.64rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(226, 232, 240, 0.8);
      }

      .app-updates-panel__content {
        flex: 1;
        overflow-y: auto;
        padding: 0.8rem 0.8rem 0.95rem;
        display: flex;
        flex-direction: column;
        gap: 0.58rem;
        scroll-snap-type: y proximity;
        overscroll-behavior: contain;
      }

      .app-updates-card {
        position: relative;
        border-radius: 1rem;
        border: 1px solid rgba(226, 232, 240, 0.96);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.07);
        padding: 0.8rem 0.85rem;
        overflow: hidden;
        scroll-snap-align: start;
      }

      .app-updates-card::before {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 0.3rem;
        background: linear-gradient(180deg, var(--updates-accent, #3b82f6), transparent 90%);
      }

      .app-updates-card.is-unread {
        border-color: rgba(96, 165, 250, 0.3);
        box-shadow: 0 20px 40px rgba(37, 99, 235, 0.12);
      }

      .app-updates-card--blue { --updates-accent: #2563eb; }
      .app-updates-card--emerald { --updates-accent: #059669; }
      .app-updates-card--amber { --updates-accent: #d97706; }
      .app-updates-card--rose { --updates-accent: #e11d48; }

      .app-updates-card__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.65rem;
      }

      .app-updates-card__left {
        display: flex;
        gap: 0.7rem;
        min-width: 0;
        flex: 1;
      }

      .app-updates-card__icon {
        width: 2rem;
        height: 2rem;
        flex: 0 0 2rem;
        border-radius: 0.8rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--updates-accent, #3b82f6) 14%, white);
        color: var(--updates-accent, #3b82f6);
        font-size: 0.86rem;
      }

      .app-updates-card__meta {
        min-width: 0;
        flex: 1;
      }

      .app-updates-card__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-bottom: 0.25rem;
      }

      .app-updates-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        border-radius: 999px;
        padding: 0.22rem 0.55rem;
        font-size: 0.64rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .app-updates-chip--tone {
        background: color-mix(in srgb, var(--updates-accent, #3b82f6) 12%, white);
        color: var(--updates-accent, #3b82f6);
      }

      .app-updates-chip--new {
        background: #fee2e2;
        color: #b91c1c;
      }

      .app-updates-date {
        color: #64748b;
        font-size: 0.68rem;
        font-weight: 700;
      }

      .app-updates-card__title {
        margin-top: 0.12rem;
        font-size: 0.9rem;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.3;
      }

      .app-updates-card__summary {
        margin-top: 0.22rem;
        color: #475569;
        font-size: 0.78rem;
        line-height: 1.42;
        white-space: normal;
        word-break: break-word;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .app-updates-card.is-expanded .app-updates-card__summary {
        display: block;
        overflow: visible;
      }

      .app-updates-card.is-expanded {
        overflow: visible;
      }

      .app-updates-card__toggle {
        width: 100%;
        padding: 0;
        margin: 0;
        border: 0;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }

      .app-updates-card__toggle:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--updates-accent, #2563eb) 45%, white);
        outline-offset: 4px;
        border-radius: 0.8rem;
      }

      .app-updates-card__more {
        margin-top: 0.38rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        color: var(--updates-accent, #2563eb);
        font-size: 0.69rem;
        font-weight: 800;
      }

      .app-updates-card__more i {
        transition: transform 0.18s ease;
      }

      .app-updates-card.is-expanded .app-updates-card__more i {
        transform: rotate(180deg);
      }

      .app-updates-card__details {
        margin-top: 0.55rem;
        padding-top: 0.55rem;
        border-top: 1px dashed rgba(148, 163, 184, 0.35);
      }

      .app-updates-card__details[hidden] {
        display: none;
      }

      .app-updates-card__list {
        display: grid;
        gap: 0.38rem;
      }

      .app-updates-card__item {
        display: flex;
        gap: 0.48rem;
        color: #334155;
        font-size: 0.76rem;
        line-height: 1.42;
      }

      .app-updates-card__item i {
        margin-top: 0.08rem;
        color: var(--updates-accent, #3b82f6);
        font-size: 0.68rem;
      }

      .app-updates-card__footer {
        margin-top: 0.45rem;
        display: none;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      .app-updates-card.is-expanded .app-updates-card__footer {
        display: flex;
      }

      .app-updates-card__link,
      .app-updates-panel__action,
      .app-updates-panel__close {
        border: 0;
        cursor: pointer;
      }

      .app-updates-card__link {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.72rem;
        font-weight: 800;
        color: var(--updates-accent, #2563eb);
        text-decoration: none;
      }

      .app-updates-panel__footer {
        padding: 0.7rem 0.8rem calc(0.8rem + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid rgba(226, 232, 240, 0.95);
        background: rgba(255, 255, 255, 0.96);
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.6rem;
      }

      .app-updates-panel__action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.65rem 0.85rem;
        border-radius: 0.85rem;
        background: linear-gradient(135deg, #1d4ed8, #2563eb);
        color: #fff;
        font-size: 0.74rem;
        font-weight: 800;
        box-shadow: 0 14px 28px rgba(37, 99, 235, 0.18);
      }

      .app-updates-panel__close {
        width: 2.3rem;
        height: 2.3rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .app-updates-empty {
        border-radius: 1.2rem;
        padding: 1rem;
        border: 1px dashed #cbd5e1;
        color: #64748b;
        font-size: 0.84rem;
        background: rgba(255, 255, 255, 0.8);
      }

      @media (max-width: 640px) {
        .app-updates-toggle {
          width: 2.6rem;
          height: 2.6rem;
          border-radius: 1rem;
        }

        .app-updates-peek {
          top: auto;
          bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
          right: 0.75rem;
          left: 0.75rem;
          width: auto;
        }

        .app-updates-panel {
          width: 100vw;
        }

        .app-updates-panel__content {
          padding: 0.72rem;
          gap: 0.5rem;
        }

        .app-updates-card {
          min-height: calc((100dvh - 14.8rem) / 4);
        }

        .app-updates-card.is-expanded {
          min-height: auto;
        }

        .app-updates-card.is-expanded .app-updates-card__summary {
          font-size: 0.8rem;
          line-height: 1.48;
        }

        .app-updates-card.is-expanded .app-updates-card__item {
          font-size: 0.78rem;
          line-height: 1.48;
        }

        .app-updates-panel__footer {
          flex-direction: column;
          align-items: stretch;
        }

        .app-updates-card {
          padding: 0.74rem 0.76rem;
        }

        .app-updates-card__footer {
          justify-content: flex-start;
        }

        .app-updates-panel__action {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getSeenId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setSeenId(updateId) {
    if (!updateId) return;
    try {
      localStorage.setItem(STORAGE_KEY, updateId);
    } catch (_) {}
  }

  function getNoticeSeenId() {
    try {
      return localStorage.getItem(NOTICE_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setNoticeSeenId(updateId) {
    if (!updateId) return;
    try {
      localStorage.setItem(NOTICE_STORAGE_KEY, updateId);
    } catch (_) {}
  }

  function getSeenIndex() {
    const seenId = getSeenId();
    if (!seenId) return -1;
    return getUpdates().findIndex((item) => item.id === seenId);
  }

  function getUnreadCount() {
    const seenIndex = getSeenIndex();
    if (seenIndex < 0) return getUpdates().length;
    return seenIndex;
  }

  function isUnread(updateId) {
    const seenIndex = getSeenIndex();
    if (seenIndex < 0) return true;
    const idx = getUpdates().findIndex((item) => item.id === updateId);
    return idx > -1 && idx < seenIndex;
  }

  function getLatestUnreadUpdate() {
    return getUpdates().find((item) => isUnread(item.id)) || null;
  }

  function getHeaderActionsContainer() {
    const shellActions = document.querySelector('.app-shell-actions');
    if (shellActions) return shellActions;

    const navInner = document.querySelector('body > nav > div');
    if (!navInner || !navInner.children || navInner.children.length < 2) return null;
    return navInner.children[navInner.children.length - 1];
  }

  function ensureToggleButton() {
    const actions = getHeaderActionsContainer();
    if (!actions) return null;
    let btn = document.getElementById('app-updates-toggle');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'app-updates-toggle';
    btn.className = 'app-updates-toggle';
    btn.title = 'Novedades del sistema';
    btn.setAttribute('aria-label', 'Abrir novedades del sistema');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="fas fa-bell"></i><span id="app-updates-toggle-badge" class="app-updates-toggle__badge hidden"></span>';
    actions.insertBefore(btn, actions.firstChild || null);
    return btn;
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'app-updates-root';
    root.innerHTML = '<div id="app-updates-backdrop" class="app-updates-backdrop"></div><aside id="app-updates-panel" class="app-updates-panel" aria-hidden="true" inert role="dialog" aria-modal="true" aria-label="Centro de novedades"></aside>';
    document.body.appendChild(root);
    return root;
  }

  function ensurePeekHost() {
    let peek = document.getElementById(PEEK_ID);
    if (peek) return peek;

    peek = document.createElement('div');
    peek.id = PEEK_ID;
    peek.className = 'app-updates-peek';
    document.body.appendChild(peek);
    return peek;
  }

  function buildUpdateCardHtml(item) {
    const unread = isUnread(item.id);
    const detailBullets = Array.isArray(item.bullets) ? item.bullets.filter(Boolean) : [];
    const details = detailBullets.length
      ? `<div class="app-updates-card__details" data-update-details hidden>${detailBullets.map((bullet) => `<div class="app-updates-card__item"><i class="fas fa-sparkles"></i><span>${escapeHtml(bullet)}</span></div>`).join('')}</div>`
      : '';
    const hasExpandableDetails = details !== '';
    const link = item.href
      ? `<a class="app-updates-card__link" href="${escapeHtml(item.href)}">${escapeHtml(item.cta || 'Abrir')}<i class="fas fa-arrow-up-right-from-square"></i></a>`
      : '';

    return `
      <article class="app-updates-card app-updates-card--${escapeHtml(item.tone || 'blue')}${unread ? ' is-unread' : ''}" data-update-card>
        <button type="button" class="app-updates-card__toggle" data-update-toggle aria-expanded="false">
          <div class="app-updates-card__top">
            <div class="app-updates-card__left">
              <div class="app-updates-card__icon"><i class="fas ${escapeHtml(item.icon || 'fa-bell')}"></i></div>
              <div class="app-updates-card__meta">
                <div class="app-updates-card__chips">
                  <span class="app-updates-chip app-updates-chip--tone">${escapeHtml(item.tag || 'Actualizacion')}</span>
                  ${unread ? '<span class="app-updates-chip app-updates-chip--new">Nuevo</span>' : ''}
                </div>
                <div class="app-updates-date">${escapeHtml(item.date || '')}</div>
                <div class="app-updates-card__title">${escapeHtml(item.title || '')}</div>
                <div class="app-updates-card__summary">${escapeHtml(item.summary || '')}</div>
                ${hasExpandableDetails ? '<div class="app-updates-card__more"><span data-update-toggle-label>Ver detalles</span><i class="fas fa-chevron-down"></i></div>' : ''}
              </div>
            </div>
          </div>
        </button>
        ${details}
        ${link ? `<div class="app-updates-card__footer">${link}</div>` : ''}
      </article>
    `;
  }

  function renderPanel() {
    const panel = document.getElementById('app-updates-panel');
    if (!panel) return;
    const updates = getUpdates();
    const unreadCount = getUnreadCount();
    const novedadesHtml = updates.length
      ? updates.map(buildUpdateCardHtml).join('')
      : '<div class="app-updates-empty">No hay novedades publicadas todavia.</div>';

    panel.innerHTML = `
      <div class="app-updates-panel__header">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.8rem;">
          <div>
            <div class="app-updates-panel__eyebrow">Centro de novedades</div>
            <div class="app-updates-panel__title">Lo nuevo en tu sistema</div>
          </div>
          <button id="app-updates-close" class="app-updates-panel__close" type="button" aria-label="Cerrar novedades">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <div class="app-updates-panel__summary">
          <div class="app-updates-panel__metric">
            <strong>${updates.length}</strong>
            <span>Mejoras recientes</span>
          </div>
          <div class="app-updates-panel__metric">
            <strong>${unreadCount}</strong>
            <span>${unreadCount === 1 ? 'Novedad sin leer' : 'Novedades sin leer'}</span>
          </div>
        </div>
      </div>
      <div class="app-updates-panel__content">${novedadesHtml}</div>
      <div class="app-updates-panel__footer">
        <button id="app-updates-mark-read" class="app-updates-panel__action" type="button">
          <i class="fas fa-check"></i>
          Marcar revisado
        </button>
      </div>
    `;
  }

  function renderAutoNotice(updateItem) {
    const peek = ensurePeekHost();
    if (!updateItem) {
      peek.innerHTML = '';
      peek.classList.remove('is-visible');
      return;
    }

    const compactSummary = truncateText(updateItem.summary || '', 92);

    peek.innerHTML = `
      <div class="app-updates-peek__card">
        <div class="app-updates-peek__top">
          <div class="app-updates-peek__icon"><i class="fas ${escapeHtml(updateItem.icon || 'fa-bell')}"></i></div>
          <div class="app-updates-peek__meta">
            <div class="app-updates-peek__eyebrow">Nueva actualizacion</div>
            <div class="app-updates-peek__title">${escapeHtml(updateItem.title || '')}</div>
            <div class="app-updates-peek__summary">${escapeHtml(compactSummary)}</div>
          </div>
          <button id="app-updates-peek-close" type="button" class="app-updates-peek__close" aria-label="Cerrar aviso">
            <i class="fas fa-xmark"></i>
          </button>
        </div>
        <div class="app-updates-peek__actions">
          <button id="app-updates-peek-open" type="button" class="app-updates-peek__open">Abrir</button>
          <button id="app-updates-peek-later" type="button" class="app-updates-peek__later">Luego</button>
        </div>
      </div>
    `;
  }

  function toggleUpdateCard(button) {
    const card = button && button.closest ? button.closest('[data-update-card]') : null;
    if (!card) return;

    const details = card.querySelector('[data-update-details]');
    const label = card.querySelector('[data-update-toggle-label]');
    if (!details) return;

    const willExpand = details.hasAttribute('hidden');
    const panel = document.getElementById('app-updates-panel');
    if (panel) {
      panel.querySelectorAll('[data-update-card].is-expanded').forEach((openCard) => {
        if (openCard === card) return;
        openCard.classList.remove('is-expanded');
        const openButton = openCard.querySelector('[data-update-toggle]');
        if (openButton) openButton.setAttribute('aria-expanded', 'false');
        const openLabel = openCard.querySelector('[data-update-toggle-label]');
        if (openLabel) openLabel.textContent = 'Ver detalles';
        const openDetails = openCard.querySelector('[data-update-details]');
        if (openDetails) openDetails.setAttribute('hidden', 'hidden');
      });
    }

    card.classList.toggle('is-expanded', willExpand);
    button.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    if (label) label.textContent = willExpand ? 'Ocultar detalles' : 'Ver detalles';
    if (willExpand) {
      details.removeAttribute('hidden');
      if (typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    } else {
      details.setAttribute('hidden', 'hidden');
    }
  }

  function updateToggleBadge() {
    const badge = document.getElementById('app-updates-toggle-badge');
    const btn = document.getElementById('app-updates-toggle');
    if (!badge || !btn) return;
    const unreadCount = getUnreadCount();
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.classList.toggle('hidden', unreadCount <= 0);
    btn.title = unreadCount > 0
      ? `Novedades del sistema (${unreadCount} nuevas)`
      : 'Novedades del sistema';
  }

  function markAllSeen() {
    const updates = getUpdates();
    if (updates.length) {
      setSeenId(updates[0].id);
    }
    renderPanel();
    updateToggleBadge();
    closeAutoNotice();
  }

  function openPanel() {
    const root = ensureRoot();
    const activeElement = document.activeElement;
    lastFocusedElement = activeElement && activeElement instanceof HTMLElement ? activeElement : null;
    closeAutoNotice();
    renderPanel();
    root.classList.add('is-open');
    document.body.classList.add('app-updates-open');
    const btn = document.getElementById('app-updates-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const panel = document.getElementById('app-updates-panel');
    if (panel) {
      panel.removeAttribute('inert');
      panel.setAttribute('aria-hidden', 'false');
    }
    markAllSeen();
    wirePanelEvents();
    const closeBtn = document.getElementById('app-updates-close');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus();
    }
  }

  function closePanel() {
    const btn = document.getElementById('app-updates-toggle');
    const panel = document.getElementById('app-updates-panel');
    if (panel && panel.contains(document.activeElement) && btn && typeof btn.focus === 'function') {
      btn.focus();
    } else if (panel && panel.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const root = document.getElementById(ROOT_ID);
    if (root) root.classList.remove('is-open');
    document.body.classList.remove('app-updates-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (panel) {
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('inert', '');
    }

    if ((!btn || document.activeElement !== btn) && lastFocusedElement && typeof lastFocusedElement.focus === 'function' && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    }
  }

  function closeAutoNotice() {
    const peek = document.getElementById(PEEK_ID);
    if (!peek) return;
    peek.classList.remove('is-visible');
  }

  function wirePanelEvents() {
    const panel = document.getElementById('app-updates-panel');
    const closeBtn = document.getElementById('app-updates-close');
    const backdrop = document.getElementById('app-updates-backdrop');
    const markReadBtn = document.getElementById('app-updates-mark-read');
    if (closeBtn) closeBtn.onclick = closePanel;
    if (backdrop) backdrop.onclick = closePanel;
    if (markReadBtn) {
      markReadBtn.onclick = () => {
        markAllSeen();
        closePanel();
      };
    }
    if (panel) {
      panel.querySelectorAll('[data-update-toggle]').forEach((button) => {
        button.onclick = () => toggleUpdateCard(button);
      });
    }
  }

  function wireAutoNoticeEvents(updateItem) {
    const closeBtn = document.getElementById('app-updates-peek-close');
    const openBtn = document.getElementById('app-updates-peek-open');
    const laterBtn = document.getElementById('app-updates-peek-later');

    if (closeBtn) closeBtn.onclick = closeAutoNotice;
    if (laterBtn) laterBtn.onclick = closeAutoNotice;
    if (openBtn) {
      openBtn.onclick = () => {
        if (updateItem && updateItem.id) {
          setNoticeSeenId(updateItem.id);
        }
        openPanel();
      };
    }
  }

  function queueAutoNotice() {
    if (autoNoticeTimer) {
      clearTimeout(autoNoticeTimer);
      autoNoticeTimer = null;
    }

    const latestUnread = getLatestUnreadUpdate();
    if (!latestUnread) {
      closeAutoNotice();
      return;
    }

    if (getNoticeSeenId() === latestUnread.id) {
      return;
    }

    autoNoticeTimer = setTimeout(() => {
      const root = document.getElementById(ROOT_ID);
      if (root && root.classList.contains('is-open')) return;
      renderAutoNotice(latestUnread);
      wireAutoNoticeEvents(latestUnread);
      setNoticeSeenId(latestUnread.id);
      const peek = ensurePeekHost();
      peek.classList.add('is-visible');
    }, AUTO_NOTICE_DELAY_MS);
  }

  function wireEventsOnce() {
    if (document.body.dataset.appUpdatesBound === '1') return;
    document.body.dataset.appUpdatesBound = '1';

    document.addEventListener('click', (event) => {
      const toggle = event.target && event.target.closest ? event.target.closest('#app-updates-toggle') : null;
      if (!toggle) return;
      event.preventDefault();
      const root = document.getElementById(ROOT_ID);
      if (root && root.classList.contains('is-open')) {
        closePanel();
      } else {
        openPanel();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closePanel();
      }
    });
  }

  async function ensureMounted(options = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.location.pathname.startsWith('/login')) return;
    await loadUpdatesFeed(!!options.forceRefresh);
    ensureStyles();
    if (!getHeaderActionsContainer()) return;
    ensureToggleButton();
    ensureRoot();
    ensurePeekHost();
    renderPanel();
    updateToggleBadge();
    wireEventsOnce();
    wirePanelEvents();
    queueAutoNotice();
  }

  if (typeof window !== 'undefined') {
    window.AppUpdates = {
      ensureMounted,
      open: openPanel,
      close: closePanel,
      getUnreadCount
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureMounted);
    } else {
      ensureMounted();
    }
  }
})();