/**
 * The Electron entry `window-guards-electron.test.mjs` drives: a hostile HTML
 * document framed the way the canvas preview frames it, BEFORE (the old
 * sandbox, no response policy, no guards) and AFTER (the shipped sandbox, the
 * shipped guards), with a loopback "daemon" that records every request that
 * actually reaches it. The server's log, not the page's own report, is the
 * ground truth for "was it blocked".
 *
 * Env: WG_BUNDLE (esbuild bundle of the shipped guards), WG_SANDBOX (the
 * sandbox attribute under test), WG_MODE (before|after), WG_USER_DATA,
 * WG_OUT. No window is shown (`show: false`), nothing touches the operator's
 * profile, and the only files written are under WG_USER_DATA / WG_OUT.
 */
const { app, BrowserWindow, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setPath("userData", process.env.WG_USER_DATA);
const mode = process.env.WG_MODE;
const sandbox = process.env.WG_SANDBOX;
const hits = [];
const opened = [];
const guardLog = [];

/** The hostile document: every escape the task names, each reported by name. */
const HOSTILE = (port) => `<!doctype html><html><body><script>
const out = {};
const rec = (k, v) => { out[k] = v; };
const attempt = async (name, fn) => { try { rec(name, await fn()); } catch (e) { rec(name, "THREW " + (e && e.name)); } };
(async () => {
  await attempt("parent.document", () => typeof parent.document.title);
  await attempt("top.document", () => typeof top.document.title);
  await attempt("frameElement (sandbox lift)", () => {
    const el = window.frameElement;
    if (!el) return "no frameElement";
    el.removeAttribute("sandbox");
    return "removed sandbox attr";
  });
  await attempt("read file via fetch(file:///etc/hosts)", async () => (await fetch("file:///etc/hosts")).status);
  await attempt("read file via XHR(file:///etc/hosts)", () => new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open("GET", "file:///etc/hosts"); x.onload = () => res(x.status + ":" + x.responseText.length); x.onerror = () => rej(new Error("xhr")); x.send();
  }));
  await attempt("fetch loopback daemon (http, cross-origin read)", async () => (await (await fetch("http://127.0.0.1:${port}/secret")).text()).slice(0, 20));
  await attempt("beacon to loopback daemon", async () => { navigator.sendBeacon("http://127.0.0.1:${port}/beacon?sendBeacon"); return "sent"; });
  await attempt("image GET to loopback daemon", () => new Promise((res) => { const i = new Image(); i.onload = i.onerror = () => res("settled"); i.src = "http://127.0.0.1:${port}/beacon?img"; }));
  await attempt("fetch https (allowed class)", async () => { await fetch("https://example.invalid/x"); return "ok"; });
  await attempt("localStorage", () => { localStorage.setItem("a", "b"); return "stored"; });
  await attempt("window.open", () => { const w = window.open("http://127.0.0.1:${port}/beacon?open"); return w ? "opened" : "null"; });
  parent.postMessage({ report: out }, "*");
  await attempt("form submit", () => { const f = document.createElement("form"); f.method = "POST"; f.action = "http://127.0.0.1:${port}/beacon?form"; document.body.appendChild(f); f.submit(); return "submitted"; });
  await attempt("nested iframe", () => { const f = document.createElement("iframe"); f.src = "http://127.0.0.1:${port}/beacon?iframe"; document.body.appendChild(f); return "appended"; });
  await attempt("top.location=", () => { top.location = "http://127.0.0.1:${port}/beacon?top"; return "assigned"; });
  setTimeout(() => { parent.postMessage({ report: out }, "*"); }, 400);
  setTimeout(() => { location = "http://127.0.0.1:${port}/beacon?self-nav"; }, 700);
})();
</script></body></html>`;

(async () => {
	const server = http.createServer((req, res) => {
		const u = new URL(req.url, "http://x");
		if (u.pathname === "/v1/static/html") {
			res.setHeader("content-type", "text/html; charset=utf-8");
			// The daemon serves this route BARE; the shipped policy is added by main.
			res.end(HOSTILE(server.address().port));
			return;
		}
		// Everything else is the daemon's other routes: CORS echoes any origin, the
		// way local_operator/server/app.py does when no allow-list is installed.
		res.setHeader("access-control-allow-origin", req.headers.origin || "*");
		if (u.pathname !== "/secret")
			hits.push(`${req.method} ${u.pathname}${u.search}`);
		else hits.push("GET /secret");
		res.end("DAEMON-SECRET-BODY");
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	await app.whenReady();
	const guards = await import(process.env.WG_BUNDLE);

	const parentFile = path.join(process.env.WG_USER_DATA, "parent.html");
	const docUrl = `http://127.0.0.1:${port}/v1/static/html?path=%2Ftmp%2Fx.html`;
	fs.writeFileSync(
		parentFile,
		`<!doctype html><html><head><title>app</title></head><body><iframe id="p" sandbox="${sandbox}" src="${docUrl}"></iframe><script>
    window.__report = null; addEventListener("message", (e) => { if (e.data && e.data.report) window.__report = e.data.report; });
    </script></body></html>`,
	);
	const parentUrl = pathToFileURL(parentFile).href;

	const win = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true },
	});
	if (mode === "after") {
		const trusted = () => [parentUrl];
		const log = (m) => guardLog.push(m);
		guards.guardNavigation(win.webContents, trusted, log);
		guards.guardWindowOpen(
			win.webContents,
			guards.popupVerdict,
			(url) =>
				guards.openVettedExternal(
					url,
					(u) => {
						opened.push(u);
					},
					log,
				),
			{ width: 800, height: 700, webPreferences: { sandbox: true } },
			log,
		);
		guards.guardPermissions(session.defaultSession, trusted, log);
		guards.guardPreviewResponses(session.defaultSession);
	} else {
		// The pre-change app: nothing installed, and a window.open reaches the OS raw.
		win.webContents.setWindowOpenHandler((d) => {
			opened.push(d.url);
			return { action: "deny" };
		});
	}
	await win.loadURL(parentUrl);
	await new Promise((r) => setTimeout(r, 2500));
	const report = await win.webContents.executeJavaScript("window.__report");
	const framedAttr = await win.webContents.executeJavaScript(
		"document.getElementById('p').getAttribute('sandbox')",
	);

	// Main-frame attacks, as a renderer-side script would issue them.
	const mainBefore = win.webContents.getURL();
	await win.webContents.executeJavaScript(
		`setTimeout(() => { location.href = 'http://127.0.0.1:${port}/beacon?main-nav'; }, 0); 1`,
	);
	await new Promise((r) => setTimeout(r, 800));
	const mainAfterNav = win.webContents.getURL();
	for (const url of [
		"file:///etc/passwd",
		"smb://attacker/share",
		"https://accounts.google.com.attacker.test/",
		"https://example.com/ok",
	]) {
		await win.webContents
			.executeJavaScript(`window.open(${JSON.stringify(url)}); 1`)
			.catch(() => {});
	}
	await new Promise((r) => setTimeout(r, 400));

	fs.writeFileSync(
		process.env.WG_OUT,
		JSON.stringify(
			{
				mode,
				sandbox: framedAttr,
				report,
				hits,
				opened,
				guardLog,
				mainBefore: mainBefore === parentUrl,
				mainStayedOnApp: mainAfterNav === parentUrl,
				mainAfterNav,
			},
			null,
			1,
		),
	);
	server.close();
	app.exit(0);
})().catch((e) => {
	console.error(e);
	app.exit(1);
});
