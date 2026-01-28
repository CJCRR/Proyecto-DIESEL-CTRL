// Alertas Web: stock agotado y clientes morosos
// Se basa en polling liviano al backend y usa Notification API + SW cuando está disponible

const ALERT_INTERVAL_MS = 60 * 1000; // 1 minuto
let seenStock = new Set();
let seenMorosos = new Set();

// Icono inline (SVG) para evitar 404 si no existe /icons/icon-192.png
const NOTIF_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#0f172a"/><text x="50%" y="55%" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="56" text-anchor="middle" dominant-baseline="middle">DC</text></svg>`
);

function canNotify() {
  return 'Notification' in window;
}

async function ensurePermission() {
  if (!canNotify()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

async function showNotification(title, body) {
  if (!await ensurePermission()) return;
  const opts = { body, icon: NOTIF_ICON, tag: title };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.showNotification) {
        await reg.showNotification(title, opts);
        return;
      }
      // Fallback usando postMessage al SW
      if (reg.active) reg.active.postMessage({ type: 'SHOW_NOTIFICATION', payload: { title, options: opts } });
    }
    new Notification(title, opts);
  } catch (err) {
    console.warn('No se pudo mostrar notificación', err);
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    credentials: 'same-origin'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function pollStock() {
  try {
    const rows = await fetchJSON('/alertas/stock');
    rows.forEach(r => {
      const key = r.codigo;
      if (!seenStock.has(key)) {
        seenStock.add(key);
        showNotification('Stock agotado', `${r.codigo}: ${r.descripcion || ''}`);
      }
    });
  } catch (err) {
    if (err.message?.includes('HTTP 401')) return; // usuario no autenticado
    console.warn('No se pudo obtener alertas de stock', err.message);
  }
}

async function pollMorosos() {
  try {
    const rows = await fetchJSON('/alertas/morosos');
    rows.forEach(r => {
      const key = `${r.id}`;
      if (!seenMorosos.has(key)) {
        seenMorosos.add(key);
        showNotification('Cliente moroso', `${r.cliente_nombre || 'Cliente'} - vence ${r.fecha_vencimiento}`);
      }
    });
  } catch (err) {
    if (err.message?.includes('HTTP 401')) return; // usuario no autenticado
    console.warn('No se pudo obtener morosos', err.message);
  }
}

function startAlerts() {
  // Evitar correr en login
  if (window.location.pathname.includes('/pages/login.html')) return;
  pollStock();
  pollMorosos();
  setInterval(() => {
    pollStock();
    pollMorosos();
  }, ALERT_INTERVAL_MS);
}

startAlerts();
