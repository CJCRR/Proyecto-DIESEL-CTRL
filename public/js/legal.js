document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('[data-legal-tab]');
  const sections = document.querySelectorAll('[data-legal-section]');
  if (!tabs.length || !sections.length) return;

  const activate = (key) => {
    tabs.forEach(btn => {
      const active = btn.getAttribute('data-legal-tab') === key;
      btn.classList.toggle('active-tab', active);
      btn.classList.toggle('text-slate-500', !active);
    });
    sections.forEach(sec => {
      const active = sec.getAttribute('data-legal-section') === key;
      sec.classList.toggle('hidden', !active);
    });
  };

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-legal-tab');
      if (!key) return;
      activate(key);
    });
  });

  // Activar pestaña por defecto
  activate('terminos');
});
