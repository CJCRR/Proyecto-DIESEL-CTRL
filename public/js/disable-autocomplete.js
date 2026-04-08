// Desactiva el autocompletado nativo del navegador en todos los inputs
// Se ejecuta en todas las páginas que incluyan este script.
(function () {
  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', function () {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(function (el) {
      try {
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('spellcheck', 'false');
      } catch (e) {
        // Ignorar errores silenciosamente
      }
    });
  });
})();
