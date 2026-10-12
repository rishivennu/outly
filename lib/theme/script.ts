/** Runs inline in <head> before paint: applies the saved theme (or the OS one) so there is no flash. */
export const THEME_KEY = "outly-theme";
export const CONTRAST_KEY = "outly-contrast";
export const themeScript = `(function(){document.documentElement.classList.add('js');try{var k='${THEME_KEY}',t=localStorage.getItem(k)||'system',d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),e=document.documentElement;e.classList.toggle('dark',d);e.dataset.theme=t;if(localStorage.getItem('outly-contrast')==='more')e.dataset.contrast='more';}catch(_){document.documentElement.classList.add('dark')}})()`;
