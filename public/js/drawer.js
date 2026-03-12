
// Drawer navigation
(() => {
	const drawer = document.getElementById('drawer');
	const backdrop = document.getElementById('drawer-backdrop');
	const btnMenu = document.getElementById('btn-menu');
	const burgerCheckbox = document.getElementById('nav-burger');
	const btnClose = document.getElementById('drawer-close');
	const openDrawer = () => {
		drawer.classList.remove('-translate-x-full');
		backdrop.classList.remove('hidden');
		if (burgerCheckbox) burgerCheckbox.checked = true;
	};
	const closeDrawer = () => {
		drawer.classList.add('-translate-x-full');
		backdrop.classList.add('hidden');
		if (burgerCheckbox) burgerCheckbox.checked = false;
	};
	if (btnMenu) btnMenu.addEventListener('click', openDrawer);
	if (btnClose) btnClose.addEventListener('click', closeDrawer);
	if (backdrop) backdrop.addEventListener('click', closeDrawer);
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
})();
