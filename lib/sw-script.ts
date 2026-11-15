/**
 * Registers public/sw.js from the document head as soon as the page has loaded (production only, so dev HMR is never
 * cached). Runs without waiting for hydration, so even a page whose scripts fail still gets the app shell for the next
 * launch. components/shared/Connectivity.tsx registers too (the same call twice is a no-op) in case this was blocked.
 */
export const swScript =
  process.env.NODE_ENV === "production"
    ? `try{if("serviceWorker"in navigator){var r=function(){navigator.serviceWorker.register("/sw.js").catch(function(){})};if(document.readyState==="complete")r();else window.addEventListener("load",r,{once:true})}}catch(e){}`
    : "";
