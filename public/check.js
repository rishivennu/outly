/* Outlly phone check (1042). Runs on the phone, loads the dashboard the way the browser would, and
   reports each step. Reads nothing private: cookie NAMES only, response sizes and status codes. */
(function () {
  var list = document.getElementById("list"), out = document.getElementById("out"), lines = [];
  function row(label) {
    var li = document.createElement("li"), b = document.createElement("b"), s = document.createElement("span"), sm = document.createElement("small");
    b.textContent = label; s.textContent = "checking"; s.className = "wait";
    li.appendChild(b); li.appendChild(s); li.appendChild(sm); list.appendChild(li);
    return function (ok, verdict, detail) {
      s.textContent = verdict; s.className = ok ? "ok" : "bad"; sm.textContent = detail || "";
      lines.push((ok ? "OK   " : "FAIL ") + label + ": " + verdict + (detail ? " | " + detail : ""));
      out.textContent = lines.join("\n");
    };
  }
  function ms(t) { return Math.round(performance.now() - t) + " ms"; }
  async function load(path, opts) {
    var t = performance.now(), r = await fetch(path, Object.assign({ credentials: "same-origin", cache: "no-store" }, opts || {}));
    var text = "", err = null;
    try { text = await r.text(); } catch (e) { err = e; }
    return { r: r, text: text, err: err, time: ms(t) };
  }
  async function step(label, fn) {
    var done = row(label);
    try { await fn(done); } catch (e) { done(false, "failed", (e && (e.name + ": " + e.message)) || String(e)); }
  }
  async function run() {
    lines.push("Outlly check " + new Date().toISOString());
    lines.push("Browser: " + navigator.userAgent);
    lines.push("Screen: " + screen.width + "x" + screen.height + " @" + devicePixelRatio + ", online " + navigator.onLine);
    await step("Cookies on this phone", async function (done) {
      var names = document.cookie.split(";").map(function (c) { return c.split("=")[0].trim(); }).filter(Boolean);
      done(true, names.length + " readable", (names.join(", ") || "none") + " | total " + document.cookie.length + " chars");
    });
    await step("Offline helper", async function (done) {
      if (!("serviceWorker" in navigator)) return done(true, "not supported here", "this browser never runs it");
      var regs = await navigator.serviceWorker.getRegistrations();
      var keys = "caches" in self ? await caches.keys() : [];
      done(true, regs.length + " installed", "controller " + (navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : "none") + " | caches " + (keys.join(", ") || "none"));
    });
    await step("Signed in", async function (done) {
      var x = await load("/api/me");
      var j = null; try { j = JSON.parse(x.text); } catch (e) {}
      if (x.r.status === 200 && j && j.user) done(true, "yes", "as " + (j.user.email || "").replace(/^(.).*(@.*)$/, "$1…$2") + ", " + x.time);
      else done(x.r.status === 401, x.r.status === 401 ? "no (signed out)" : "error " + x.r.status, x.text.slice(0, 160));
    });
    await step("Landing page", async function (done) {
      var x = await load("/", { headers: { accept: "text/html" } });
      var whole = /<\/html>\s*$/.test(x.text);
      done(x.r.ok && whole && !x.err, x.r.status + (whole ? ", complete" : ", CUT OFF"), Math.round(x.text.length / 1024) + " KB, " + x.time + (x.err ? " | " + x.err.message : ""));
    });
    await step("Dashboard page (/home)", async function (done) {
      var x = await load("/home", { headers: { accept: "text/html" } });
      var whole = /<\/html>\s*$/.test(x.text);
      var where = new URL(x.r.url).pathname;
      done(x.r.ok && whole && !x.err, x.r.status + (where !== "/home" ? " → " + where : "") + (whole ? ", complete" : ", CUT OFF"), Math.round(x.text.length / 1024) + " KB, " + x.time + ", via " + (x.r.headers.get("x-vercel-id") || "?") + (x.err ? " | " + x.err.name + ": " + x.err.message : ""));
    });
    await step("Dashboard data (/home in-app)", async function (done) {
      var x = await load("/home?_rsc=check", { headers: { RSC: "1" } });
      done(x.r.ok && !x.err, String(x.r.status), Math.round(x.text.length / 1024) + " KB, " + x.time + (x.err ? " | " + x.err.message : ""));
    });
    await step("Dashboard scripts", async function (done) {
      var x = await load("/home", { headers: { accept: "text/html" } });
      var srcs = (x.text.match(/\/_next\/static\/[^"'\s]+\.js/g) || []).filter(function (s, i, a) { return a.indexOf(s) === i; });
      var bad = [];
      await Promise.all(srcs.map(function (s) { return fetch(s).then(function (r) { if (!r.ok) bad.push(r.status + " " + s.split("/").pop()); }, function (e) { bad.push("net " + s.split("/").pop()); }); }));
      done(!bad.length, bad.length ? bad.length + " of " + srcs.length + " failed" : srcs.length + " load", bad.slice(0, 4).join(", "));
    });
    lines.push("Done.");
    out.textContent = lines.join("\n");
  }
  document.getElementById("copy").addEventListener("click", function () {
    var t = out.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { document.getElementById("copy").textContent = "Copied"; }, function () {
      var r = document.createRange(); r.selectNodeContents(out); var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  });
  document.getElementById("reset").addEventListener("click", async function () {
    var b = this; b.disabled = true; b.textContent = "Clearing…";
    try {
      if ("serviceWorker" in navigator) { var regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function (r) { return r.unregister(); })); }
      if ("caches" in self) { var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); })); }
      try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
      b.textContent = "Cleared. Now open the dashboard";
    } catch (e) { b.textContent = "Couldn't clear: " + e.message; }
    b.disabled = false;
  });
  run();
})();
