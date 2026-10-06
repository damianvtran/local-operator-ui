import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";
const ORIGIN = process.argv[2] ?? "http://localhost:5311";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "asks-escape-"));
const chrome = spawn(
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
);
let exited = false;
chrome.on("exit", () => {
	exited = true;
});
/**
 * Chrome announces its own debug port on stderr; the pattern is module scope so the
 * listener does not rebuild it per chunk.
 */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const wsUrl = await new Promise((res, rej) => {
	let b = "";
	const t = setTimeout(() => rej(new Error("no port")), 30000);
	chrome.stderr.on("data", (d) => {
		b += d;
		const m = b.match(DEVTOOLS_URL);
		if (m) {
			clearTimeout(t);
			res(m[1]);
		}
	});
});
const browser = new WebSocket(wsUrl);
await new Promise((r) => {
	browser.onopen = r;
});
let id = 1;
const pend = new Map();
browser.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pend.has(m.id)) {
		const { res, rej } = pend.get(m.id);
		pend.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
};
const raw = (method, params, sid) =>
	new Promise((res, rej) => {
		const i = id++;
		pend.set(i, { res, rej });
		browser.send(
			JSON.stringify({
				id: i,
				method,
				params: params ?? {},
				...(sid ? { sessionId: sid } : {}),
			}),
		);
	});
const t = await raw("Target.createTarget", { url: "about:blank" });
const at = await raw("Target.attachToTarget", {
	targetId: t.targetId,
	flatten: true,
});
const sid = at.sessionId;
const send = (m, p = {}) => raw(m, p, sid);
const ev = async (x) => {
	const r = await send("Runtime.evaluate", {
		expression: x,
		awaitPromise: true,
		returnByValue: true,
	});
	if (r.exceptionDetails)
		throw new Error(r.exceptionDetails.exception?.description);
	return r.result.value;
};
const waitFor = async (x, label, ms = 20000) => {
	const s = Date.now();
	for (;;) {
		const v = await ev(x);
		if (v) return v;
		if (Date.now() - s > ms) throw new Error(`timeout ${label}`);
		await wait(150);
	}
};
const clickAt = async (x, y) => {
	for (const [type, button] of [
		["mouseMoved", "none"],
		["mousePressed", "left"],
		["mouseReleased", "left"],
	]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button,
			clickCount: 1,
		});
	}
};
const esc = async () => {
	for (const type of ["rawKeyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 53,
		});
	}
};
const slot = () =>
	ev(`!!document.querySelector('[data-tour-tag="ask-drawer-slot"]')`);
const active = () =>
	ev(
		`(()=>{const a=document.activeElement;return a?{tag:a.tagName,label:a.getAttribute('aria-label')||null}:null;})()`,
	);
const report = {};
const shot = async (name) => {
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(
		join(process.env.OUT_DIR || "shots/00-before-fix", name),
		Buffer.from(data, "base64"),
	);
};
try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1380,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try{localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));}catch(e){}',
	});
	await send("Page.navigate", { url: `${ORIGIN}/#/chat/aaaa11112222` });
	await waitFor(
		`document.querySelector('[data-lo-ask-item-toggle]')!==null`,
		"chip",
	);
	await wait(500);
	const chip = await ev(
		`(()=>{const r=document.querySelector('[data-lo-ask-item-toggle]').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
	);
	await clickAt(chip.x, chip.y);
	await waitFor(
		`document.querySelector('[data-ask-drawer="session"]')!==null`,
		"drawer",
	);
	const row = await ev(
		`(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>/Notes/.test(x.innerText)&&/(last active|Ready|Open|Scheduled)/.test(x.innerText)); b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
	);
	await wait(300);
	await clickAt(row.x, row.y);
	await waitFor(`location.hash.includes('bbbb11112222')`, "switch");
	await wait(1200);
	report.afterSwitch = { slot: await slot(), active: await active() };
	// ARM 1: explicit focus into the composer textarea, then Escape.
	report.focusA = await ev(
		`(()=>{const t=document.querySelector('textarea'); if(!t) return null; t.focus(); return {tag:document.activeElement.tagName};})()`,
	);
	await wait(200);
	await esc();
	await wait(800);
	report.afterComposerEscape = { slot: await slot(), active: await active() };
	await shot("05-after-composer-focus-escape.png");
	// ARM 2 (reload-ish): switch back to A, reopen, switch again, click void, Escape.
	await ev(`location.hash='#/chat/aaaa11112222'`);
	await waitFor(
		`document.querySelector('[data-lo-ask-item-toggle]')!==null`,
		"chip2",
	);
	await wait(500);
	const chip2 = await ev(
		`(()=>{const r=document.querySelector('[data-lo-ask-item-toggle]').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
	);
	await clickAt(chip2.x, chip2.y);
	await waitFor(
		`document.querySelector('[data-ask-drawer="session"]')!==null`,
		"drawer2",
	);
	const row2 = await ev(
		`(()=>{const b=[...document.querySelectorAll('nav button')].find(x=>/Notes/.test(x.innerText)&&/(last active|Ready|Open|Scheduled)/.test(x.innerText)); b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
	);
	await wait(300);
	await clickAt(row2.x, row2.y);
	await waitFor(`location.hash.includes('bbbb11112222')`, "switch2");
	await wait(1200);
	// click the void, then Escape from wherever focus landed
	await clickAt(1050, 380);
	await wait(300);
	report.voidFocus = await active();
	await esc();
	await wait(800);
	report.afterVoidEscape = { slot: await slot(), active: await active() };
	await shot("04-after-void-click-escape.png");
	report.ok = true;
} catch (e) {
	report.ok = false;
	report.error = String(e);
} finally {
	console.log(JSON.stringify(report, null, 2));
	try {
		await raw("Browser.close");
	} catch {}
	if (!exited) chrome.kill();
	await wait(400);
	rmSync(dataDir, { recursive: true, force: true });
}
