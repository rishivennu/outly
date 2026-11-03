/**
 * Runs inline in <head> before paint: applies the saved theme (dark when nothing is saved) so there is no flash.
 * 1105: it also sets the status bar colour (meta theme-color, emitted above this script) to the page background
 * of that theme, so a light user never launches the Home Screen app under a black strip. The wanted colour sits on
 * html[data-tc] and a small observer holds every theme-color tag to it, because Next adds a second one after
 * hydration (it carries the server's dark default and would otherwise be a second, wrong answer).
 * 1108: the public pages have their own light background (THEME_COLOR.lightSky): the server marks them by sending
 * that colour, and once the body exists the script checks for .sky-host itself. Inside the Android app it also
 * sets the system bar icons (Capacitor SystemBars: DARK = light icons for the dark theme, LIGHT = dark icons).
 */
import { THEME_COLOR, THEME_COOKIE, THEME_COOKIE_AGE } from "./colors";

export const THEME_KEY = "outly-theme";
export const CONTRAST_KEY = "outly-contrast";
export const themeScript = `(function(){document.documentElement.classList.add('js');try{var k='${THEME_KEY}',t=localStorage.getItem(k)||'dark',d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),e=document.documentElement;e.classList.toggle('dark',d);e.dataset.theme=t;if(document.cookie.split('; ').indexOf('${THEME_COOKIE}='+t)<0)document.cookie='${THEME_COOKIE}='+t+';path=/;max-age=${THEME_COOKIE_AGE};samesite=lax'+(location.protocol==='https:'?';secure':'');var q=function(){return document.querySelectorAll('meta[name="theme-color"]')},sky=[].some.call(q(),function(m){return m.getAttribute('content')==='${THEME_COLOR.lightSky}'}),pick=function(s){e.dataset.tc=d?'${THEME_COLOR.dark}':s?'${THEME_COLOR.lightSky}':'${THEME_COLOR.light}'};pick(sky);var tc=function(){q().forEach(function(m){if(m.getAttribute('content')!==e.dataset.tc)m.setAttribute('content',e.dataset.tc)})};tc();new MutationObserver(tc).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']});document.addEventListener('DOMContentLoaded',function(){pick(!!document.querySelector('.sky-host'));tc()});var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()&&C.nativePromise)C.nativePromise('SystemBars','setStyle',{style:d?'DARK':'LIGHT'})['catch'](function(){});if(localStorage.getItem('${CONTRAST_KEY}')==='more')e.dataset.contrast='more';}catch(_){document.documentElement.classList.add('dark')}})()`;
