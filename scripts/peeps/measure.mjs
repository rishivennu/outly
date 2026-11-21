import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Peep from "react-peeps";
import fs from "node:fs";
import { CAST } from "./cast.mjs";
// Huge viewBox so nothing is clipped; the browser measures the real bbox.
let html = `<!doctype html><meta charset=utf-8><body>`;
for (const [k, c] of Object.entries(CAST)) {
  const svg = renderToStaticMarkup(React.createElement(Peep, { ...c, strokeColor: "#000", backgroundColor: "#fff", viewBox: { x: "-2000", y: "-2000", width: "6000", height: "6000" } }));
  html += `<div data-k="${k}" style="width:600px;height:600px">${svg.replace("<svg", '<svg width="600" height="600"')}</div>`;
}
fs.writeFileSync("measure.html", html + "</body>");
