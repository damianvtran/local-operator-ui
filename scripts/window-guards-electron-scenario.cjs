/**
 * The Electron entry `window-guards-electron.test.mjs` drives: a hostile HTML
 * document framed the way the canvas preview frames it, BEFORE (the old
 * sandbox, no response policy, no guards) and AFTER (the shipped sandbox, the
 * shipped guards), with a loopback "daemon" that records every request that
 * actually reaches it AND the response headers of every document-serving
 * request it answers. The server's log, not the page's own report, is the
 * ground truth for "was it blocked".
 *
 * THE HOSTILE DOCUMENT IS WALKED THREE PHASES in both modes, because security
 * review S-1 showed the containment fails when the document leaves the
 * canonical path: the canonical `/v1/static/html` copy, the same handler
 * reached by its DECODED path (`/v1/static/htm%6c`), and a document-capable
 * sibling route (`/v1/static/images?path=...svg`). After the fix every
 * landing carries the preview CSP and reaches nothing; before it, the same
 * walk reads `/secret` from the daemon at every hop. The hops are driven from
 * the PARENT (setting the frame's `location`, the same navigation channel the
 * review's in-frame `location = ...` repro used) because in the before mode
 * the canonical copy's own form submit navigates the frame away and would
 * take any in-frame walk timers with it. The response-header capture
 * (`onCompleted`) is what shows the CSP travelling with the encoded and SVG
 * responses - the same stream the shipped `guardPreviewResponses` rewrites.
 *
 * THE POPUP PHASES (S-2, S-7). After the change the blank start mints no
 * window at all - `about:blank` and its resolved `window.open('javascript:…')`
 * form are refused at the door - and the relay-scheme popup the door still
 * creates cannot be steered off its door from the opener. Before the change
 * the rig's own old-style handler created the blank popup and the same steer
 * committed, so the pair is a difference.
 *
 * Env: WG_BUNDLE (esbuild bundle of the shipped guards), WG_SANDBOX (the
 * sandbox attribute under test), WG_MODE (before|after), WG_USER_DATA,
 * WG_OUT. No window is shown (`show: false` on every window), nothing touches
 * the operator's profile, nothing is downloaded or handed to the OS
 * (`openExternal` is stubbed and the rig cancels every download it sees), and
 * the only files written are under WG_USER_DATA / WG_OUT.
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
const loads = [];
const headers = [];
const opened = [];
const guardLog = [];
const downloads = [];

/** The hostile document: every escape the task names, each reported by name. */
const HOSTILE = (port) => `<!doctype html><html><body><script>
const out = {};
const rec = (k, v) => { out[k] = v; };
const attempt = async (name, fn) => { try { rec(name, await fn()); } catch (e) { rec(name, "THREW " + (e && e.name)); } };
const phase = location.pathname === "/v1/static/html" ? "canonical" : "encoded";
const filePath = new URLSearchParams(location.search).get("path");
(async () => {
  if (phase === "canonical") {
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
    parent.postMessage({ phase, report: out }, "*");
    await attempt("form submit", () => { const f = document.createElement("form"); f.method = "POST"; f.action = "http://127.0.0.1:${port}/beacon?form"; document.body.appendChild(f); f.submit(); return "submitted"; });
    await attempt("nested iframe", () => { const f = document.createElement("iframe"); f.src = "http://127.0.0.1:${port}/beacon?iframe"; document.body.appendChild(f); return "appended"; });
    await attempt("top.location=", () => { top.location = "http://127.0.0.1:${port}/beacon?top"; return "assigned"; });
    setTimeout(() => { parent.postMessage({ phase, report: out }, "*"); }, 400);
    } else {
    await attempt("encoded: fetch loopback daemon", async () => (await (await fetch("http://127.0.0.1:${port}/secret")).text()).slice(0, 20));
    await attempt("encoded: XHR loopback /secret", () => new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open("GET", "http://127.0.0.1:${port}/secret"); x.onload = () => res(x.status); x.onerror = () => rej(new Error("xhr")); x.send();
    }));
    parent.postMessage({ phase, report: out }, "*");
    }
  })();
</script></body></html>`;

/** The SVG the images route can serve: a navigated frame executes it (S-1). */
const SVG_DOC = (
	port,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script><![CDATA[
(async () => {
  const out = {};
  try {
    const r = await fetch("http://127.0.0.1:${port}/secret");
    out.read = (await r.text()).slice(0, 20);
  } catch (e) { out.read = "THREW " + (e && e.name); }
  try { parent.postMessage({ phase: "svg", report: out }, "*"); } catch (e) {}
  setTimeout(() => { try { location = "http://127.0.0.1:${port}/beacon?self-nav"; } catch (e) {} }, 300);
})();
]]></script></svg>`;

(async () => {
	const server = http.createServer((req, res) => {
		const u = new URL(req.url, "http://x");
		// The REAL core decodes percent-escapes before routing (uvicorn);
		// model it so `/v1/static/htm%6c` reaches the same handler.
		let decoded = u.pathname;
		try {
			decoded = decodeURIComponent(u.pathname);
		} catch {}
		if (decoded === "/v1/static/html") {
			res.setHeader("content-type", "text/html; charset=utf-8");
			// The daemon serves this route BARE; the shipped policy is added by main.
			loads.push(`${u.pathname}${u.search}`);
			res.end(HOSTILE(server.address().port));
			return;
		}
		if (decoded === "/v1/static/images") {
			res.setHeader("content-type", "image/svg+xml");
			loads.push(`${u.pathname}${u.search}`);
			res.end(SVG_DOC(server.address().port));
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

	/*
	 * Response-header capture for the static serve family (a different event
	 * from the shipped onHeadersReceived, so it observes rather than competes):
	 * the CSP travelling with the encoded and SVG responses is S-1's direct
	 * evidence.
	 */
	session.defaultSession.webRequest.onCompleted((details) => {
		const u = details.url;
		if (!u.includes("/v1/static/")) return;
		const h = details.responseHeaders || {};
		const key = Object.keys(h).find(
			(k) => k.toLowerCase() === "content-security-policy",
		);
		headers.push({
			path: u.replace(/^https?:\/\/[^/]+/, ""),
			csp: key ? h[key].join(" ") : null,
		});
	});

	const parentFile = path.join(process.env.WG_USER_DATA, "parent.html");
	const docUrl = `http://127.0.0.1:${port}/v1/static/html?path=%2Ftmp%2Fx.html`;
	fs.writeFileSync(
		parentFile,
		`<!doctype html><html><head><title>app</title></head><body><iframe id="p" sandbox="${sandbox}" src="${docUrl}"></iframe><script>
    window.__reports = []; addEventListener("message", (e) => { if (e.data && e.data.report) window.__reports.push(e.data); });
    window.__popup = null;
    </script></body></html>`,
	);
	const parentUrl = pathToFileURL(parentFile).href;

	const win = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true },
	});
	const popups = [];
	win.webContents.on("did-create-window", (window, details) => {
		popups.push({ url: details.url, contents: window.webContents });
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
			{
				width: 800,
				height: 700,
				show: false,
				webPreferences: { sandbox: true },
			},
			log,
		);
		guards.guardPermissions(session.defaultSession, trusted, log);
		guards.guardPreviewResponses(session.defaultSession);
		// Optional so this same scenario can also run against the PRE-CHANGE
		// bundle when the before/after evidence is captured (the function did
		// not exist then); a fixed tree always has it.
		guards.guardDownloads?.(session.defaultSession, trusted, log);
	} else {
		// The pre-change app: nothing installed, a window.open reaches the OS
		// raw, and a popup gets no navigation guard. The about:blank allowance
		// is the RIG's, not the old handler's - the point of this phase is the
		// MISSING navigation guard on the created window, which is what the
		// review observed, not the door's old creation filter.
		win.webContents.setWindowOpenHandler((d) => {
			if (d.url === "about:blank" || d.url.includes("storagerelay")) {
				return {
					action: "allow",
					overrideBrowserWindowOptions: {
						width: 800,
						height: 700,
						show: false,
						webPreferences: { sandbox: true },
					},
				};
			}
			opened.push(d.url);
			return { action: "deny" };
		});
	}

	/*
	 * The S-4 probe. Registered AFTER the shipped policy when the mode
	 * installs one, so `defaultPrevented` is that policy's verdict (listeners
	 * run in order); anything still live is cancelled here - this rig must
	 * never write a file or open a save dialog.
	 */
	session.defaultSession.on("will-download", (event, item) => {
		downloads.push({
			url: item.getURL(),
			policyCancelled: event.defaultPrevented === true,
		});
		event.preventDefault();
	});

	await win.loadURL(parentUrl);
	// The canonical document runs its attempt set and reports; hop 1 and hop 2
	// are driven FROM THE PARENT - see the header note. (The first draft drove
	// them in-frame; in the before mode the canonical form submit navigated the
	// frame away and both later phases were silently lost.)
	await new Promise((r) => setTimeout(r, 900));
	await win.webContents.executeJavaScript(
		`document.getElementById("p").contentWindow.location = "http://127.0.0.1:${port}/v1/static/htm%6c?path=" + encodeURIComponent("/tmp/x.html"); 1`,
	);
	await new Promise((r) => setTimeout(r, 900));
	await win.webContents.executeJavaScript(
		`document.getElementById("p").contentWindow.location = "http://127.0.0.1:${port}/v1/static/images?path=" + encodeURIComponent("/tmp/wg-preview.svg"); 1`,
	);
	await new Promise((r) => setTimeout(r, 1600));
	const reports = await win.webContents.executeJavaScript("window.__reports");
	const framedAttr = await win.webContents.executeJavaScript(
		"document.getElementById('p').getAttribute('sandbox')",
	);

	/*
	 * S-2 and S-7, the popup door. AFTER: `about:blank` - and therefore the
	 * `window.open('javascript:…')` form Electron resolves to exactly that URL -
	 * mints no window at all, and the relay-scheme popup the door still creates
	 * carries the travel guard, so the same opener-driven steer the review used
	 * must be blocked. BEFORE: the rig's old-style handler (see above) creates
	 * the blank popup and the steer commits - the pair is a difference.
	 */
	let popupAfterSteer = null;
	let blankPopupIsNull = null;
	let jsPopupIsNull = null;
	let blankOrJsWindows = null;
	let relayPopupExists = null;
	let relayAfterSteer = null;
	let beforePopup = null;
	if (mode === "after") {
		blankPopupIsNull = await win.webContents.executeJavaScript(
			`window.open("about:blank") === null`,
		);
		jsPopupIsNull = await win.webContents.executeJavaScript(
			`window.open('javascript:document.title="pwned"') === null`,
		);
		await new Promise((r) => setTimeout(r, 300));
		blankOrJsWindows = popups.filter((p) => p.url === "about:blank").length;
		await win.webContents.executeJavaScript(
			`window.__relay = window.open("storagerelay://https/localhost?id=auth1"); 1`,
		);
		await new Promise((r) => setTimeout(r, 400));
		const relay = popups.find((p) => p.url.includes("storagerelay"));
		relayPopupExists = Boolean(relay);
		if (relay) {
			await win.webContents
				.executeJavaScript(`window.__relay.location = "file:///etc/hosts"; 1`)
				.catch(() => {});
			await new Promise((r) => setTimeout(r, 400));
			relayAfterSteer = relay.contents.getURL();
		}
	} else {
		await win.webContents.executeJavaScript(
			`window.__popup = window.open("about:blank"); 1`,
		);
		await new Promise((r) => setTimeout(r, 300));
		beforePopup = popups.find((p) => p.url === "about:blank");
		if (beforePopup) {
			await win.webContents
				.executeJavaScript(`window.__popup.location = "file:///etc/hosts"; 1`)
				.catch(() => {});
			await new Promise((r) => setTimeout(r, 400));
			popupAfterSteer = beforePopup.contents.getURL();
		}
	}

	// S-4: two download attempts from the app document. data: is the class the
	// policy refuses; blob: is the app's own export class it keeps.
	await win.webContents.executeJavaScript(`
		(() => {
			const a = document.createElement("a");
			a.href = "data:text/plain,wg-download";
			a.download = "wg.bin";
			document.body.appendChild(a);
			a.click();
			a.remove();
		})(); 1
	`);
	await new Promise((r) => setTimeout(r, 300));
	await win.webContents.executeJavaScript(`
		(() => {
			const url = URL.createObjectURL(new Blob(["wg-export"], { type: "image/svg+xml" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = "wg-export.svg";
			document.body.appendChild(a);
			a.click();
			a.remove();
		})(); 1
	`);
	await new Promise((r) => setTimeout(r, 300));

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
		`http://127.0.0.1:${port}/beacon?os-door`,
	]) {
		await win.webContents
			.executeJavaScript(`window.open(${JSON.stringify(url)}); 1`)
			.catch(() => {});
	}
	await new Promise((r) => setTimeout(r, 400));
	if (beforePopup) popupAfterSteer = beforePopup.contents.getURL();

	fs.writeFileSync(
		process.env.WG_OUT,
		JSON.stringify(
			{
				mode,
				sandbox: framedAttr,
				reports,
				report: reports.find((r) => r.phase === "canonical")?.report ?? null,
				hits,
				loads,
				headers,
				opened,
				guardLog,
				downloads,
				popupAfterSteer,
				blankPopupIsNull,
				jsPopupIsNull,
				blankOrJsWindows,
				relayPopupExists,
				relayAfterSteer,
				mainBefore: mainBefore === parentUrl,
				mainStayedOnApp: mainAfterNav === parentUrl,
				mainAfterNav,
			},
			null,
			1,
		),
	);
	// Close every window this rig made, then exit; hidden means hidden.
	for (const w of BrowserWindow.getAllWindows()) w.destroy();
	server.close();
	app.exit(0);
})();
