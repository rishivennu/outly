/**
 * Pulse rail width (1100), kept per device. Read in <head> (railScript) so the first paint has the right width.
 * Its own icon-free module: the root layout imports it, and must not pull the nav's icons into every page.
 */
export const RAIL_KEY = "outlly:rail";
export const railScript = `try{if(localStorage.getItem("${RAIL_KEY}")==="open")document.documentElement.setAttribute("data-rail","open")}catch(e){}`;
