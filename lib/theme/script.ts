/**
 * Runs inline in <head> before paint: applies the saved theme (dark when nothing is saved) so there is no flash.
 * 1105: it also sets the status bar colour (meta theme-color, emitted above this script) to the page background
 * of that theme, so a light user never launches the Home Screen app under a black strip. The wanted colour sits on
 * html[data-tc] and a small observer holds every theme-color tag to it, because Next adds a second one after
 * hydration (it carries the server's dark default and would otherwise be a second, wrong answer).
 */
import { THEME_COLOR } from "./colors";

export const THEME_KEY = "outly-theme";
export const CONTRAST_KEY = "outly-contrast";
export const themeScript = `(function(){document.documentElement.classList.add('js');try{var k='${THEME_KEY}',t=localStorage.getItem(k)||'dark',d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),e=document.documentElement;e.classList.toggle('dark',d);e.dataset.theme=t;e.dataset.tc=d?'${THEME_COLOR.dark}':'${THEME_COLOR.light}';var tc=function(){document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){if(m.getAttribute('content')!==e.dataset.tc)m.setAttribute('content',e.dataset.tc)})};tc();new MutationObserver(tc).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']});if(localStorage.getItem('${CONTRAST_KEY}')==='more')e.dataset.contrast='more';}catch(_){document.documentElement.classList.add('dark')}})()`;
