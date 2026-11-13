// Real-path rig for the ask card's suggested command (ask-suggested-commands PR).
// Built app (stock main/preload/renderer, real node-pty console) attached to a
// loopback fixture whose open ask carries `command`. Run from the worktree root.
// Env: ASKCMD_OUT (frames dir), ASKCMD_COMMAND, ASKCMD_TARGET.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.env.ASKCMD_OUT;
const RIG = process.env.ASKCMD_RIG;
mkdirSync(OUT, { recursive: true });
const token = "askcmd-rig-token-0123456789abcdef0123456789abcdef";
process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = token;
process.env.LOCAL_OPERATOR_UI_TELEMETRY = "off";
process.env.LOCAL_OPERATOR_NO_NOTIFICATIONS = "1";
process.argv.push("--backend", "http://127.0.0.1:8080", "--out", OUT, "--window-size", "1380x900");
const { startAsksAppFixture, ASK_SESSION_IDS } = await import(
	pathToFileURL(join(RIG, "fixture.mjs")).href
);
const fixtureRoot = join(OUT, "fixture-root");
mkdirSync(fixtureRoot, { recursive: true });
const fixture = await startAsksAppFixture({ root: fixtureRoot, port: 8080, token });
process.argv.push("--backend-records", fixture.records ?? join(fixtureRoot, "run", "serve"));
const { rendererDriverApi: api } = await import(
	pathToFileURL(join(process.cwd(), "scripts/renderer-driver.mjs")).href
);
const log = [];
const note = (k, v) => {
	log.push({ k, v });
	console.log(k, typeof v === "string" ? v : JSON.stringify(v));
	writeFileSync(join(OUT, "rig-log.json"), JSON.stringify(log, null, 2));
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let cdp;
let rc = 1;
try {
	api.prepareDriverContext({ apiUrl: "http://127.0.0.1:8080" });
	const app = await api.launchApp({ armed: true, apiUrl: "http://127.0.0.1:8080", tag: "askcmd" });
	note("app", { pid: app.pid, port: app.port });
	await api.waitForDevtools(app);
	cdp = await api.CdpClient.attach(app.port, "out/renderer/index.html");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await api.waitForPage(cdp);
	await api.waitForBridge(cdp);
	const ev = (expr) => cdp.evaluate(expr);
	const wait = async (expr, label, ms = 20000) => {
		const t = Date.now();
		while (Date.now() - t < ms) {
			if (await ev(expr)) return;
			await pause(150);
		}
		throw new Error(`timeout: ${label}`);
	};
	const press = (sel) => api.verb(cdp, "press", sel);
	const sid = ASK_SESSION_IDS[0];
	if (process.env.ASKCMD_MODE === "fleet") {
		// The fleet drawer: from the catalogue (no conversation open), the rail's asks item.
		for (const route of ["/agents", "/settings", "/notifications", "/chat"]) {
			await api.verb(cdp, "navigate", route);
			await pause(1500);
			const trig = await ev(`(()=>{const t=document.querySelector('[data-tour-tag="ask-pane-trigger"]');return t?t.getAttribute('aria-label'):null})()`);
			note("route trigger", { route, trig });
			if (trig && !/This conversation/.test(trig)) break;
		}
		note("state before", await api.verb(cdp, "state"));
		for (let attempt = 1; attempt <= 4; attempt++) {
			note("press rail", await press('[data-tour-tag="ask-pane-trigger"]'));
			await pause(1200);
			if (await ev(`!!document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-insert]')`)) break;
			if (await ev(`!!document.querySelector('[data-ask-drawer="session"]')`)) {
				// The rail item opens the session scope inside a conversation; the drawer's own
				// "All" tab is the fleet scope.
				const tab = await ev(`(()=>{const t=[...document.querySelectorAll('[data-ask-drawer] [role=tab],[data-ask-drawer] button')].find(b=>/^All/.test(b.textContent.trim()));if(t){t.setAttribute('data-askcmd-all','');return true}return false})()`);
				if (tab) await press("[data-askcmd-all]");
				await pause(1200);
				if (await ev(`!!document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-insert]')`)) break;
			}
		}
		note("fleet drawer", await ev(`(()=>{const d=document.querySelector('[data-ask-drawer]');return d?{scope:d.getAttribute('data-ask-drawer'),insert:!!d.querySelector('[data-ask-command-insert]'),run:!!d.querySelector('[data-ask-command-run]')}:null})()`));
		note("frame fleet", await api.capture(cdp, "fleet-card-dark", { assertPalette: false }));
		await press('[data-ask-drawer="fleet"] [data-ask-command-insert]');
		await wait(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.some(x=>x.session_id===${JSON.stringify(sid)}))`, "fleet insert surface");
		await pause(3500);
		const st = await api.verb(cdp, "state");
		note("state after fleet insert", st);
		const surf = await ev(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).map(x=>x.surface))`);
		const bytes = await ev(`window.api.console.subscribe(${JSON.stringify(surf[0])},0).then(r=>{const b=atob(r.replay_base64);return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)))})`);
		note("fleet insert surfaces (target conversation)", surf);
		note("fleet insert pty replay", bytes);
		note("other conversation surfaces", await ev(`window.api.console.state("fa1107000002").then(s=>s.surfaces.filter(x=>x.session_id==="fa1107000002").length)`));
		note("frame fleet after insert", await api.capture(cdp, "fleet-after-insert", { assertPalette: false }));
		rc = 0;
		throw new Error("done (fleet mode)");
	}
	await api.verb(cdp, "navigate", `/chat/${sid}`);
	await wait(`!!document.querySelector('[data-lo-ask-item-toggle]')`, "ask chip");
	note("console.available", await ev(`window.api.console.state(${JSON.stringify(sid)}).then(s=>({available:s.available,reason:s.reason,detail:s.detail}))`));
	const openDrawer = async (selector) => {
		for (let attempt = 1; attempt <= 4; attempt++) {
			await pause(500);
			note("press chip", { attempt, hit: await press("[data-lo-ask-item-toggle]") });
			try {
				await wait(`!!document.querySelector(${JSON.stringify(selector)})`, selector, 5000);
				return;
			} catch {}
		}
		throw new Error(`drawer never showed ${selector}`);
	};
	if (process.env.ASKCMD_MODE === "before" || process.env.ASKCMD_MODE === "remote") {
		await openDrawer("[data-lo-ask-question]");
		await pause(400);
		note("row", await ev(`(()=>{const r=document.querySelector('[data-ask-command]');return r?{text:r.querySelector('[data-ask-command-text]').textContent,insert:!!r.querySelector('[data-ask-command-insert]'),run:!!r.querySelector('[data-ask-command-run]'),notice:r.querySelector('[data-ask-command-notice]')?.textContent??null}:null})()`));
		for (const theme of ["localOperatorDark", "localOperatorLight"]) {
			await api.verb(cdp, "setTheme", theme);
			await pause(250);
			note(`frame card ${theme}`, await api.capture(cdp, `${process.env.ASKCMD_MODE}-card-${theme === "localOperatorDark" ? "dark" : "light"}`, { assertPalette: false }));
		}
		rc = 0;
		throw new Error("done (capture-only mode)");
	}
	await openDrawer("[data-ask-command]");
	note("row", await ev(`(()=>{const r=document.querySelector('[data-ask-command]');return {text:r.querySelector('[data-ask-command-text]').textContent,insert:!!r.querySelector('[data-ask-command-insert]'),run:!!r.querySelector('[data-ask-command-run]'),notice:r.querySelector('[data-ask-command-notice]')?.textContent??null,box:r.getBoundingClientRect().toJSON()}})()`));
	for (const theme of ["localOperatorDark", "localOperatorLight"]) {
		await api.verb(cdp, "setTheme", theme);
		await pause(250);
		note(`frame card ${theme}`, await api.capture(cdp, `card-${theme === "localOperatorDark" ? "dark" : "light"}`, { assertPalette: false }));
	}
	await api.verb(cdp, "setTheme", "localOperatorDark");
	const surfaces = () => ev(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).map(x=>x.surface))`);
	const replay = (surface) => ev(`window.api.console.subscribe(${JSON.stringify(surface)},0).then(r=>{const b=atob(r.replay_base64);return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)))})`);
	// ---- Insert: types, never runs.
	const before = await surfaces();
	note("surfaces before insert", before);
	await press("[data-ask-command-insert]");
	await wait(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).length>${before.length})`, "insert surface");
	const afterInsert = await surfaces();
	const insertSurface = afterInsert.find((s) => !before.includes(s));
	await pause(4000);
	const insertBytes = await replay(insertSurface);
	note("insert surface", insertSurface);
	note("insert pty replay", insertBytes);
	note("insert typed command present", insertBytes.includes(process.env.ASKCMD_COMMAND));
	note("insert executed (marker output present)", insertBytes.includes("ASKCMD-42"));
	note("frame console after insert", await api.capture(cdp, "console-after-insert", { assertPalette: false }));
	// ---- Run…: back to the card via the chip, confirm required.
	await openDrawer("[data-ask-command-run]");
	await press("[data-ask-command-run]");
	await wait(`!!document.querySelector('[data-ask-command-dialog]')`, "dialog");
	note("dialog", await ev(`(()=>{const d=document.querySelector('[role=dialog]');return {text:d.innerText,focused:document.activeElement?.hasAttribute('data-cancel-action'),focusedText:document.activeElement?.textContent}})()`));
	const whileOpen = await surfaces();
	note("surfaces while dialog open (no new one)", whileOpen.length === afterInsert.length);
	for (const theme of ["localOperatorDark", "localOperatorLight"]) {
		await api.verb(cdp, "setTheme", theme);
		await pause(250);
		note(`frame dialog ${theme}`, await api.capture(cdp, `dialog-${theme === "localOperatorDark" ? "dark" : "light"}`, { assertPalette: false }));
	}
	await api.verb(cdp, "setTheme", "localOperatorDark");
	await press("[data-confirm-action]");
	await wait(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).length>${whileOpen.length})`, "run surface");
	const afterRun = await surfaces();
	const runSurface = afterRun.find((s) => !whileOpen.includes(s));
	await pause(4000);
	const runBytes = await replay(runSurface);
	note("run surface", runSurface);
	note("run pty replay", runBytes);
	note("run executed (marker output present)", runBytes.includes("ASKCMD-42"));
	note("frame console after run", await api.capture(cdp, "console-after-run", { assertPalette: false }));
	rc = 0;
} catch (error) {
	note("error", String(error?.stack ?? error));
	try {
		note("error frame", await api.capture(cdp, "error", { assertPalette: false }));
		note("error dom", await cdp.evaluate(`({drawer:!!document.querySelector('[data-ask-drawer]'),panel:!!document.querySelector('[data-lo-ask-panel]'),rows:document.querySelectorAll('[data-lo-ask-row]').length,q:[...document.querySelectorAll('[data-lo-ask-question]')].map(e=>e.textContent.slice(0,80))})`));
	} catch (e) {
		note("error diag failed", String(e));
	}
} finally {
	try {
		cdp?.close();
	} catch {}
	note("fixture requests (non-GET)", (fixture.requests ?? []).filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`));
	await api.drainLiveBoots({ why: "askcmd rig done", strict: false }).catch((e) => note("drain error", String(e)));
	await fixture.close?.();
	process.exit(rc);
}
