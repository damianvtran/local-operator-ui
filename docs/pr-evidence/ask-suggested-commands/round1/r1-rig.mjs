// Round-1 remediation rig, PR #1902 (ask suggested commands). Derived from QA's
// qa-rig.mjs (same fixture + pushUpdate) and the UX rig's real-CDP-input method.
// cwd = scratch app root (symlink farm over the worktree + scratch-built out/).
// Env: R1_OUT, R1_MODE, R1_SIZE, R1_RIG, R1_PORT, ASKCMD_*.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.env.R1_OUT;
const MODE = process.env.R1_MODE;
const SIZE = process.env.R1_SIZE || "1380x900";
const SIDE = join(tmpdir(), `lo-renderer-driver-${process.pid}`, "home", "qa-side.log");
mkdirSync(OUT, { recursive: true });
const token = "r1-askcmd-token-0123456789abcdef0123456789abcdef";
process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = token;
process.env.LOCAL_OPERATOR_UI_TELEMETRY = "off";
process.env.LOCAL_OPERATOR_NO_NOTIFICATIONS = "1";
const PORT = Number(process.env.R1_PORT || 18981);
const API = `http://127.0.0.1:${PORT}`;
process.argv.push("--backend", API, "--out", OUT, "--window-size", SIZE);
const { startAsksAppFixture, ASK_SESSION_IDS } = await import(
	pathToFileURL(join(process.env.R1_RIG, "fixture.mjs")).href
);
const fixtureRoot = join(OUT, "fixture-root");
mkdirSync(fixtureRoot, { recursive: true });
const fixture = await startAsksAppFixture({ root: fixtureRoot, port: PORT, token });
process.argv.push("--backend-records", fixture.records);
const { rendererDriverApi: api } = await import(
	pathToFileURL(join(process.cwd(), "scripts/renderer-driver.mjs")).href
);
const log = [];
const results = [];
const note = (k, v) => {
	log.push({ k, v });
	console.log(k, typeof v === "string" ? v : JSON.stringify(v).slice(0, 700));
	writeFileSync(join(OUT, "rig-log.json"), JSON.stringify(log, null, 2));
};
const check = (id, pass, actual) => {
	results.push({ id, pass, actual });
	note(`CHECK ${id} ${pass ? "PASS" : "FAIL"}`, actual);
	writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
};
const sideLines = () =>
	existsSync(SIDE) ? readFileSync(SIDE, "utf8").split("\n").filter(Boolean) : [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let cdp;
let rc = 1;
let app;
try {
	api.prepareDriverContext({ apiUrl: API });
	app = await api.launchApp({ armed: true, apiUrl: API, tag: `r1-${MODE}` });
	note("app", { pid: app.pid, port: app.port });
	writeFileSync(join(OUT, "app.pid"), String(app.pid));
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
			if (await ev(expr)) return true;
			await pause(100);
		}
		throw new Error(`timeout: ${label}`);
	};
	const waitSoft = (expr, label, ms) => wait(expr, label, ms).then(() => true, () => false);
	const press = (sel) => api.verb(cdp, "press", sel);
	// Real keyboard input (CDP), so focus, Tab and Escape behave as a user's.
	const KEYS = { Enter: ["Enter", 13], Escape: ["Escape", 27], Tab: ["Tab", 9] };
	const key = async (k) => {
		const [code, vk] = KEYS[k];
		await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk });
		if (k === "Enter") await cdp.send("Input.dispatchKeyEvent", { type: "char", key: k, code, text: "\r", windowsVirtualKeyCode: vk });
		await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
		await pause(250);
	};
	// Real mouse input at an element's centre.
	const mouse = async (sel) => {
		const box = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		if (!box) throw new Error(`no ${sel}`);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
		await pause(250);
	};
	const active = () =>
		ev(`(()=>{const a=document.activeElement;if(!a)return null;return {tag:a.tagName,text:(a.textContent||'').trim().slice(0,40),run:a.hasAttribute('data-ask-command-run'),insert:a.hasAttribute('data-ask-command-insert'),inCommandRow:!!a.closest('[data-ask-command]'),cancel:a.hasAttribute('data-cancel-action'),aria:a.getAttribute('aria-label')}})()`);
	// Frames: Page.captureScreenshot (the UX stream measured api.capture returning stale
	// paint in headless mode), optionally clipped to an element with padding.
	const shot = async (label, sel = null, pad = 12) => {
		await pause(500);
		// Full frame first (a clipped Page.captureScreenshot times out headless here);
		// the crop is cut in the page with a canvas, at the device pixel ratio.
		const r = await cdp.send("Page.captureScreenshot", { format: "png" });
		if (!r.result?.data) throw new Error(`capture ${label}: ${r.error?.message}`);
		let data = r.result.data;
		if (sel) {
			const cropped = await ev(`(async()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();const img=new Image();img.src='data:image/png;base64,${data}';await img.decode();const k=img.naturalWidth/window.innerWidth;const x=Math.max(0,b.x-${pad}),y=Math.max(0,b.y-${pad});const w=Math.min(window.innerWidth-x,b.width+2*${pad}),h=Math.min(window.innerHeight-y,b.height+2*${pad});const c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(img,x*k,y*k,w*k,h*k,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]})()`);
			if (cropped) data = cropped;
		}
		const path = join(OUT, `${label}.png`);
		writeFileSync(path, Buffer.from(data, "base64"));
		note(`frame ${label}`, path);
		return path;
	};
	const setTheme = async (theme) => {
		await api.verb(cdp, "setTheme", theme === "dark" ? "localOperatorDark" : "localOperatorLight");
		await pause(300);
	};
	const sid = ASK_SESSION_IDS[0];
	const other = ASK_SESSION_IDS[1];
	const surfacesOf = (id) =>
		ev(`window.api.console.state(${JSON.stringify(id)}).then(s=>(s.surfaces||[]).filter(x=>x.session_id===${JSON.stringify(id)}).map(x=>x.surface))`);
	const allSurfaces = () =>
		ev(`window.api.console.state(null).then(s=>(s.surfaces||[]).map(x=>({surface:x.surface,session:x.session_id})))`);
	const replay = (surface) =>
		ev(`window.api.console.subscribe(${JSON.stringify(surface)},0).then(r=>{const b=atob(r.replay_base64);return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)))})`);
	const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
	const count = (hay, needle) => strip(hay).split(needle).length - 1;
	const CMD = process.env.ASKCMD_COMMAND;
	const MARK = "ASKCMD-42";
	const rowInfo = () =>
		ev(`(()=>{const r=document.querySelector('[data-ask-command]');if(!r)return null;const desc=(b)=>b?(b.getAttribute('aria-describedby')||'').split(' ').filter(Boolean).map(id=>document.getElementById(id)?.textContent):null;const ins=r.querySelector('[data-ask-command-insert]'),run=r.querySelector('[data-ask-command-run]'),copy=[...r.querySelectorAll('button')].find(b=>!b.hasAttribute('data-ask-command-insert')&&!b.hasAttribute('data-ask-command-run'));const rect=r.getBoundingClientRect();return {text:r.querySelector('[data-ask-command-text]')?.textContent,labels:[...r.querySelectorAll('button')].map(b=>b.textContent.trim()),insert:!!ins,run:!!run,notice:r.querySelector('[data-ask-command-notice]')?.textContent??null,insertDesc:desc(ins),runDesc:desc(run),copyDesc:desc(copy),fieldsetDesc:desc(r),rowHeight:Math.round(rect.height*10)/10,rowScrollW:r.scrollWidth,rowClientW:r.clientWidth,noticeLeft:r.querySelector('[data-ask-command-notice]')?Math.round(r.querySelector('[data-ask-command-notice]').getBoundingClientRect().left+parseFloat(getComputedStyle(r.querySelector('[data-ask-command-notice]')).paddingLeft)):null,textLeft:Math.round(r.querySelector('[data-ask-command-text]').getBoundingClientRect().left)}})()`);
	const dialogInfo = () =>
		ev(`(()=>{const d=document.querySelector('[role=dialog],[role=alertdialog]');if(!d)return null;const c=d.querySelector('[data-confirm-action]');const box=d.querySelector('[data-ask-command-text]')?.parentElement;const r=d.getBoundingClientRect();return {text:d.innerText,cancelFocused:!!document.activeElement?.hasAttribute('data-cancel-action'),confirmDisabled:c?c.disabled:null,closed:!!d.querySelector('[data-ask-command-closed]'),refused:!!d.querySelector('[data-ask-command-refused]'),box:box?{scrollH:box.scrollHeight,clientH:box.clientHeight,h:Math.round(box.getBoundingClientRect().height)}:null,panel:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom)},viewport:{w:innerWidth,h:innerHeight},bodyScroll:(()=>{const s=[...d.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+1&&getComputedStyle(e).overflowY!=='visible');return s.map(e=>({cls:String(e.className).slice(0,60),sh:e.scrollHeight,ch:e.clientHeight}))})(),caution:(()=>{const p=d.querySelector('[data-ask-command-caution]');return p?{color:getComputedStyle(p).color,glyph:!!p.querySelector('svg'),glyphColor:p.querySelector('svg')?getComputedStyle(p.querySelector('svg')).color:null,device:getComputedStyle(d.querySelector('[data-ask-command-device]')).color}:null})()}})()`);
	const dialogOpen = `!!document.querySelector('[data-ask-command-dialog]')`;
	const openDrawer = async (selector) => {
		for (let attempt = 1; attempt <= 5; attempt++) {
			if (await ev(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
			await pause(400);
			note("press chip", { attempt, hit: (await press("[data-lo-ask-item-toggle]"))?.hit });
			if (await waitSoft(`!!document.querySelector(${JSON.stringify(selector)})`, selector, 4000)) return;
		}
		throw new Error(`drawer never showed ${selector}`);
	};
	const openFleet = async () => {
		await api.verb(cdp, "navigate", "/notifications");
		await pause(1500);
		for (let attempt = 1; attempt <= 4; attempt++) {
			note("press rail", (await press('[data-tour-tag="ask-pane-trigger"]'))?.hit);
			if (await waitSoft(`!!document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-insert]')`, "fleet", 4000)) return;
		}
		throw new Error("fleet drawer never opened");
	};
	if (MODE !== "fleet" && MODE !== "fleetlat") {
		await api.verb(cdp, "navigate", `/chat/${sid}`);
		await wait(`!!document.querySelector('[data-lo-ask-item-toggle]')`, "ask chip");
	}

	if (MODE === "frames") {
		// Card + dialog stills, dark and light, at R1_SIZE; plus row geometry.
		await openDrawer("[data-ask-command]");
		await pause(600);
		const tag = `${process.env.ASKCMD_REMOTE === "1" ? "remote" : "local"}-${SIZE}`;
		note("row", await rowInfo());
		for (const theme of ["dark", "light"]) {
			await setTheme(theme);
			await shot(`card-${tag}-${theme}`, "[data-lo-ask-row]", 8);
		}
		if (await ev(`!!document.querySelector('[data-ask-command-run]')`)) {
			await setTheme("dark");
			await ev(`document.querySelector('[data-ask-command-run]').focus()`);
			await key("Enter");
			await wait(dialogOpen, "dialog");
			for (const theme of ["dark", "light"]) {
				await setTheme(theme);
				const d = await dialogInfo();
				note(`dialog ${theme}`, d);
				check(`D1 ${tag} ${theme}: whole command visible, no inner scroll, panel inside the window`, d.box && d.box.scrollH <= d.box.clientH && d.bodyScroll.length === 0 && d.panel.bottom <= d.viewport.h && d.panel.y >= 0, { box: d.box, bodyScroll: d.bodyScroll, panel: d.panel, viewport: d.viewport });
				await shot(`dialog-${tag}-${theme}`);
			}
			await key("Escape");
		}
		rc = 0;
		throw new Error("done");
	}

	if (MODE === "focus") {
		// U2: the drawer's entry landing; U1: focus after Escape / Enter-on-Cancel / mouse Cancel.
		await openDrawer("[data-ask-command]");
		await pause(800);
		// The drawer auto-opened (the composer keeps the keyboard by design). U2 is the
		// DOOR's landing: close it with the chip, then press the chip again (real mouse).
		await mouse("[data-lo-ask-item-toggle]");
		await waitSoft(`!document.querySelector('[data-ask-command]')`, "closed", 4000);
		note("drawer closed by chip", !(await ev(`!!document.querySelector('[data-ask-command]')`)));
		await openDrawer("[data-ask-command]");
		await pause(800);
		const landing = await active();
		check("U2 entry landing is not in the command row", landing && !landing.inCommandRow && landing.aria !== "Message", landing);
		const row = await rowInfo();
		check("U4 labels Copy / Open in terminal / Run…", JSON.stringify(row.labels) === JSON.stringify(["Copy", "Open in terminal", "Run…"]), row.labels);
		check("U5/D4 tooltips scope-neutral", row.insertDesc?.[0] === "Type it into a new terminal without running it" && row.runDesc?.[0] === "Type it into a new terminal and run it, after you confirm", { insert: row.insertDesc, run: row.runDesc });
		note("row geometry", { rowHeight: row.rowHeight, scrollW: row.rowScrollW, clientW: row.rowClientW });
		const s0 = await surfacesOf(sid);
		for (const how of ["Escape", "EnterOnCancel", "MouseCancel"]) {
			await ev(`document.querySelector('[data-ask-command-run]').focus()`);
			await key("Enter");
			await wait(dialogOpen, `dialog ${how}`);
			await pause(300);
			const inDialog = await active();
			if (how === "Escape") await key("Escape");
			else if (how === "EnterOnCancel") await key("Enter");
			else await mouse("[data-cancel-action]");
			await pause(500);
			const after = await active();
			check(`U1 ${how}: focus returns to Run…`, inDialog?.cancel && !(await ev(dialogOpen)) && after?.run, { inDialog, after });
		}
		check("no surface while backing out", (await surfacesOf(sid)).length === s0.length, { before: s0.length, after: (await surfacesOf(sid)).length });
		// Confirm (keyboard): Enter, Tab to confirm, Enter -> runs exactly once.
		await ev(`document.querySelector('[data-ask-command-run]').focus()`);
		await key("Enter");
		await wait(dialogOpen, "dialog confirm");
		await key("Tab");
		const onConfirm = await active();
		await key("Enter");
		await wait(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).length>${s0.length})`, "run surface");
		await pause(5000);
		const s1 = await surfacesOf(sid);
		const fresh = s1.filter((s) => !s0.includes(s));
		const bytes = fresh[0] ? await replay(fresh[0]) : "";
		const focusAfter = await active();
		check("R confirm runs exactly once", fresh.length === 1 && sideLines().length === 1 && count(bytes, MARK) >= 1, { onConfirm: onConfirm?.text, fresh, side: sideLines(), markCount: count(bytes, MARK), focusAfter });
		await shot("console-after-run");
		rc = 0;
		throw new Error("done");
	}

	if (MODE === "insert") {
		await openDrawer("[data-ask-command-insert]");
		const s0 = await surfacesOf(sid);
		await ev(`document.querySelector('[data-ask-command-insert]').focus()`);
		await key("Enter");
		await wait(`window.api.console.state(${JSON.stringify(sid)}).then(s=>s.surfaces.filter(x=>x.session_id===${JSON.stringify(sid)}).length>${s0.length})`, "insert surface");
		await pause(4000);
		const fresh = (await surfacesOf(sid)).filter((s) => !s0.includes(s));
		const bytes = fresh[0] ? await replay(fresh[0]) : "";
		check("I Open in terminal types once, runs nothing", fresh.length === 1 && count(bytes, CMD) === 1 && !strip(bytes).includes(MARK) && sideLines().length === 0, { fresh, replay: bytes, side: sideLines(), focus: await active() });
		await shot("console-after-insert");
		rc = 0;
		throw new Error("done");
	}

	if (MODE === "stale") {
		// QA's Q1 repro, unchanged: confirm, switch conversation in the same task,
		// the ask closes meanwhile, then come back.
		await openDrawer("[data-ask-command-run]");
		await press("[data-ask-command-run]");
		await wait(dialogOpen, "dialog");
		await pause(400);
		await ev(`(()=>{document.querySelector('[data-confirm-action]').click();return true})()`);
		await api.verb(cdp, "navigate", `/chat/${other}`);
		await pause(6000);
		const away = { side: sideLines().length, s1: (await surfacesOf(sid)).length, s2: (await surfacesOf(other)).length, active: (await api.verb(cdp, "state")).activeSessionId };
		note("after confirm+leave", away);
		fixture.ask.status = "answered";
		fixture.pushUpdate();
		await pause(1500);
		await api.verb(cdp, "navigate", `/chat/${sid}`);
		await pause(8000);
		const back = { side: sideLines().length, s1: (await surfacesOf(sid)).length, active: (await api.verb(cdp, "state")).activeSessionId };
		note("after return", back);
		await shot("stale-after-return");
		check("Q1 confirm, leave at once, ask closes, return: nothing runs, no surface", away.side === 0 && back.side === 0 && back.s1 === 0 && away.s2 === 0, { away, back });
		// Variant: stay away past the pickup bound while the ask is STILL OPEN, then return.
		fixture.ask.status = "open";
		fixture.pushUpdate();
		await pause(2000);
		await openDrawer("[data-ask-command-run]");
		await press("[data-ask-command-run]");
		await wait(dialogOpen, "dialog 2");
		await pause(400);
		await ev(`(()=>{document.querySelector('[data-confirm-action]').click();return true})()`);
		await api.verb(cdp, "navigate", `/chat/${other}`);
		const away2 = { s1: (await surfacesOf(sid)).length, side: sideLines().length };
		await pause(7000);
		await api.verb(cdp, "navigate", `/chat/${sid}`);
		await pause(8000);
		const s1list = await surfacesOf(sid);
		const back2 = { side: sideLines().length, s1: s1list.length, replays: await Promise.all(s1list.map((x) => replay(x))), sinceFirst: away2 };
		// If the pane took the press before the switch (its effect can run between the
		// click and the navigate), a surface may exist; what must never happen is the
		// command being typed or run after the user left.
		check("Q1b confirm, leave, return while the ask is still open: nothing typed or run after leaving", back2.side === 0 && back2.replays.every((r) => !r.includes("ASKCMD")), back2);
		rc = 0;
		throw new Error("done");
	}

	if (MODE === "latency") {
		// Pickup latency, conservatively bounded: press -> the new surface is LISTED by main.
		// Pickup (the pane taking the intent) happens before its create call, so this
		// reading is an upper bound on pickup. Insert only (runs nothing).
		const N = Number(process.env.R1_N || 10);
		const samples = [];
		for (let i = 0; i < N; i++) {
			await openDrawer("[data-ask-command-insert]");
			await pause(500);
			const s0 = (await surfacesOf(sid)).length;
			const ms = await ev(`(async()=>{const id=${JSON.stringify(sid)};const t0=performance.now();document.querySelector('[data-ask-command-insert]').click();for(;;){const s=await window.api.console.state(id);if(s.surfaces.filter(x=>x.session_id===id).length>${s0})return performance.now()-t0;await new Promise(r=>setTimeout(r,2))}})()`);
			samples.push(Math.round(ms * 10) / 10);
			note("sample", { i, ms });
			await pause(1500);
		}
		writeFileSync(join(OUT, "latency.json"), JSON.stringify(samples));
		note("latency", samples);
		rc = 0;
		throw new Error("done");
	}

	if (MODE === "fleet" || MODE === "fleetlat") {
		await openFleet();
		if (MODE === "fleetlat") {
			// Cross-conversation pickup: the press opens the ask's conversation first,
			// so its pane mounts and loads before it can take the intent.
			const before = (await surfacesOf(sid)).length;
			const ms = await ev(`(async()=>{const id=${JSON.stringify(sid)};const t0=performance.now();document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-insert]').click();for(;;){const s=await window.api.console.state(id);if(s.surfaces.filter(x=>x.session_id===id).length>${before})return performance.now()-t0;await new Promise(r=>setTimeout(r,2))}})()`);
			note("fleet sample", { ms });
			writeFileSync(join(OUT, "latency.json"), JSON.stringify([Math.round(ms * 10) / 10]));
			rc = 0;
			throw new Error("done");
		}
		// U1 in the fleet drawer, then a confirmed Run lands once in the ask's conversation.
		await ev(`document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-run]').focus()`);
		await key("Enter");
		await wait(dialogOpen, "fleet dialog");
		await key("Escape");
		const after = await active();
		check("U1 fleet Escape: focus returns to Run…", after?.run && !(await ev(dialogOpen)), after);
		await shot("fleet-card-dark", '[data-ask-drawer="fleet"] [data-lo-ask-row]', 8);
		const before = await allSurfaces();
		await ev(`document.querySelector('[data-ask-drawer="fleet"] [data-ask-command-run]').focus()`);
		await key("Enter");
		await wait(dialogOpen, "fleet dialog 2");
		await key("Tab");
		await key("Enter");
		await wait(`window.api.console.state(null).then(s=>(s.surfaces||[]).length>${before.length})`, "fleet run surface");
		await pause(5000);
		const fresh = (await allSurfaces()).filter((s) => !before.some((b) => b.surface === s.surface));
		const st = await api.verb(cdp, "state");
		check("F2 fleet confirmed Run runs once in the ask's conversation", fresh.length === 1 && fresh[0].session === sid && sideLines().length === 1 && st.activeSessionId === sid, { fresh, side: sideLines(), active: st.activeSessionId });
		await shot("fleet-after-run");
		rc = 0;
		throw new Error("done");
	}
	throw new Error(`unknown mode ${MODE}`);
} catch (error) {
	if (!String(error?.message).startsWith("done")) {
		rc = 1;
		note("error", String(error?.stack ?? error));
		try {
			const r = await cdp.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(join(OUT, "error.png"), Buffer.from(r.result.data, "base64"));
		} catch {}
	}
} finally {
	try {
		await cdp?.evaluate(`(async()=>{const s=await window.api.console.state(null);for(const x of s.surfaces||[])await window.api.console.close?.(x.surface).catch(()=>{});return true})()`);
	} catch {}
	try {
		cdp?.close();
	} catch {}
	await api.drainLiveBoots({ why: "r1 rig done", strict: false }).catch((e) => note("drain error", String(e)));
	await fixture.close?.();
	note("results", results.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.id}`));
	process.exit(results.some((r) => !r.pass) ? 2 : rc);
}
