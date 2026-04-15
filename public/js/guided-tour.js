(function () {
    const STORAGE_PREFIX = 'nexa_tour_';
    let overlayEl = null;
    let highlightEl = null;
    let tooltipEl = null;
    let titleEl = null;
    let textEl = null;
    let counterEl = null;
    let prevBtn = null;
    let nextBtn = null;
    let closeBtn = null;
    let currentTour = null;

    function hasSeen(id) {
        try {
            return localStorage.getItem(STORAGE_PREFIX + id) === '1';
        } catch {
            return false;
        }
    }

    function markSeen(id) {
        try {
            localStorage.setItem(STORAGE_PREFIX + id, '1');
        } catch {
            /* ignore */
        }
    }

    function ensureOverlay() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.style.position = 'fixed';
        overlayEl.style.inset = '0';
        overlayEl.style.background = 'rgba(52, 71, 116, 0.01)';
        overlayEl.style.backdropFilter = 'blur(1px)';
        overlayEl.style.zIndex = '9999';
        overlayEl.style.display = 'none';
        overlayEl.style.opacity = '0';
        overlayEl.style.transition = 'opacity 0.2s ease-out';

        // contenedor general para poder posicionar tooltip y highlight
        overlayEl.style.pointerEvents = 'auto';

        highlightEl = document.createElement('div');
        highlightEl.style.position = 'fixed';
        highlightEl.style.borderRadius = '12px';
        highlightEl.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.9), 0 18px 40px rgba(15,23,42,0.9)';
        highlightEl.style.background = 'rgba(52, 71, 116, 0.14)';
        highlightEl.style.pointerEvents = 'none';

        tooltipEl = document.createElement('div');
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.maxWidth = '320px';
        tooltipEl.style.background = '#0F172A';
        tooltipEl.style.color = '#E5E7EB';
        tooltipEl.style.borderRadius = '14px';
        tooltipEl.style.boxShadow = '0 20px 40px rgba(15,23,42,0.9)';
        tooltipEl.style.padding = '14px 16px 12px 16px';
        tooltipEl.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        tooltipEl.style.fontSize = '13px';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '4px';

        titleEl = document.createElement('div');
        titleEl.style.fontWeight = '700';
        titleEl.style.fontSize = '13px';

        counterEl = document.createElement('div');
        counterEl.style.fontSize = '11px';
        counterEl.style.opacity = '0.7';

        header.appendChild(titleEl);
        header.appendChild(counterEl);

        textEl = document.createElement('div');
        textEl.style.fontSize = '12px';
        textEl.style.lineHeight = '1.5';
        textEl.style.marginBottom = '10px';

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.gap = '8px';

        const leftControls = document.createElement('div');
        leftControls.style.display = 'flex';
        leftControls.style.gap = '6px';

        prevBtn = document.createElement('button');
        prevBtn.textContent = 'Anterior';
        styleSecondaryButton(prevBtn);

        nextBtn = document.createElement('button');
        nextBtn.textContent = 'Siguiente';
        stylePrimaryButton(nextBtn);

        leftControls.appendChild(prevBtn);
        leftControls.appendChild(nextBtn);

        closeBtn = document.createElement('button');
        closeBtn.textContent = 'Cerrar';
        styleLinkButton(closeBtn);

        footer.appendChild(leftControls);
        footer.appendChild(closeBtn);

        tooltipEl.appendChild(header);
        tooltipEl.appendChild(textEl);
        tooltipEl.appendChild(footer);

        overlayEl.appendChild(highlightEl);
        overlayEl.appendChild(tooltipEl);

        document.body.appendChild(overlayEl);

        prevBtn.addEventListener('click', () => {
            if (!currentTour) return;
            const idx = Math.max(0, currentTour.index - 1);
            showStep(idx);
        });

        nextBtn.addEventListener('click', () => {
            if (!currentTour) return;
            const idx = currentTour.index + 1;
            if (idx >= currentTour.steps.length) {
                endTour(true);
            } else {
                showStep(idx);
            }
        });

        closeBtn.addEventListener('click', () => {
            if (!currentTour) return;
            endTour(true);
        });
    }

    function stylePrimaryButton(btn) {
        btn.style.background = '#2563EB';
        btn.style.color = '#F9FAFB';
        btn.style.border = 'none';
        btn.style.borderRadius = '999px';
        btn.style.padding = '6px 14px';
        btn.style.fontSize = '11px';
        btn.style.fontWeight = '600';
        btn.style.cursor = 'pointer';
        btn.style.whiteSpace = 'nowrap';
    }

    function styleSecondaryButton(btn) {
        btn.style.background = 'rgba(15,23,42,0.75)';
        btn.style.color = '#E5E7EB';
        btn.style.border = '1px solid rgba(148,163,184,0.5)';
        btn.style.borderRadius = '999px';
        btn.style.padding = '6px 10px';
        btn.style.fontSize = '11px';
        btn.style.fontWeight = '500';
        btn.style.cursor = 'pointer';
        btn.style.whiteSpace = 'nowrap';
    }

    function styleLinkButton(btn) {
        btn.style.background = 'transparent';
        btn.style.border = 'none';
        btn.style.color = '#9CA3AF';
        btn.style.fontSize = '11px';
        btn.style.cursor = 'pointer';
        btn.style.whiteSpace = 'nowrap';
    }

    function endTour(mark) {
        if (!overlayEl || !currentTour) return;
        overlayEl.style.opacity = '0';
        setTimeout(() => {
            overlayEl.style.display = 'none';
        }, 180);
        if (mark && currentTour.id) markSeen(currentTour.id);
        currentTour = null;
        try {
            document.body.style.overflow = '';
        } catch { }
    }

    function showStep(index) {
        if (!currentTour) return;
        const steps = currentTour.steps || [];
        if (!steps.length) return endTour(false);

        if (index < 0) index = 0;
        if (index >= steps.length) return endTour(true);

        const step = steps[index];
        if (step && typeof step.onEnter === 'function') {
            try {
                step.onEnter();
            } catch (e) {
                console.warn('Error en onEnter de paso del tour:', e);
            }
        }
        const el = step && step.selector ? document.querySelector(step.selector) : null;
        if (!el) {
            // Si no existe el elemento, saltar al siguiente paso
            if (index + 1 < steps.length) {
                return showStep(index + 1);
            }
            return endTour(true);
        }

        currentTour.index = index;

        // Asegurar que el elemento esté visible ANTES de medir su posición
        try {
            el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        } catch { }

        const rect = el.getBoundingClientRect();
        const padding = 8;

        highlightEl.style.top = Math.max(8, rect.top - padding) + 'px';
        highlightEl.style.left = Math.max(8, rect.left - padding) + 'px';
        highlightEl.style.width = Math.max(40, rect.width + padding * 2) + 'px';
        highlightEl.style.height = Math.max(40, rect.height + padding * 2) + 'px';

        titleEl.textContent = step.title || '';
        textEl.textContent = step.text || '';
        counterEl.textContent = (index + 1) + ' / ' + steps.length;

        // Posicionar tooltip cerca del elemento
        positionTooltip(rect, step.placement || 'bottom');

        prevBtn.disabled = index === 0;
        prevBtn.style.opacity = index === 0 ? '0.4' : '1';
        const isLast = index === steps.length - 1;
        nextBtn.textContent = isLast ? 'Finalizar' : 'Siguiente';
    }

    function positionTooltip(targetRect, placement) {
        const margin = 12;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        // Mostrar tooltip para medir tamaño
        tooltipEl.style.visibility = 'hidden';
        tooltipEl.style.display = 'block';

        const ttRect = tooltipEl.getBoundingClientRect();
        let top = 0;
        let left = 0;

        if (placement === 'left') {
            top = targetRect.top + (targetRect.height - ttRect.height) / 2;
            left = targetRect.left - ttRect.width - margin;
        } else if (placement === 'right') {
            top = targetRect.top + (targetRect.height - ttRect.height) / 2;
            left = targetRect.right + margin;
        } else if (placement === 'top') {
            top = targetRect.top - ttRect.height - margin;
            left = targetRect.left + (targetRect.width - ttRect.width) / 2;
        } else { // bottom
            top = targetRect.bottom + margin;
            left = targetRect.left + (targetRect.width - ttRect.width) / 2;
        }

        // Ajustar para que no se salga de la pantalla
        if (left < margin) left = margin;
        if (left + ttRect.width > viewportWidth - margin) left = viewportWidth - ttRect.width - margin;
        if (top < margin) top = margin;
        if (top + ttRect.height > viewportHeight - margin) top = viewportHeight - ttRect.height - margin;

        tooltipEl.style.top = top + 'px';
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.visibility = 'visible';
    }

    function startTour(config) {
        if (!config || !Array.isArray(config.steps) || !config.steps.length) return;
        const id = config.id || 'default';

        if (config.autoStart && hasSeen(id)) {
            return; // no iniciar automáticamente si ya fue visto
        }

        ensureOverlay();

        currentTour = {
            id,
            steps: config.steps,
            index: 0,
        };

        overlayEl.style.display = 'block';
        // Pequeño delay para que la transición funcione
        requestAnimationFrame(() => {
            overlayEl.style.opacity = '1';
        });
        try {
            document.body.style.overflow = 'hidden';
        } catch { }

        showStep(0);
    }

    window.GuidedTour = {
        start(config) {
            startTour(config || {});
        },
        hasSeen,
        reset(id) {
            try {
                localStorage.removeItem(STORAGE_PREFIX + id);
            } catch { }
        },
    };
})();
