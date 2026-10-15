/*
 * Photograph the canvas FILES view for a session of generated media, headless.
 *
 * Run from a UI tree's root (the driver resolves Electron and the built `out/`
 * from `process.cwd()`), once per tree and per window size, against an ISOLATED
 * daemon this run's caller owns (seeded by `seed_generated_artifacts.py`):
 *
 *   LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node <this file> \
 *     --backend http://127.0.0.1:<port> --session <id> --out <dir> \
 *     --window-size 1380x900 --label wide
 *
 * It drives the same machinery as `scripts/renderer-driver.mjs` (the importable
 * facade: boot lifecycle, CDP client, dev-driver verbs, `capture`), in
 * `headless` window mode, so no window is ever shown or focused. For each of the
 * two palettes it opens the session, opens the canvas, switches to the Files
 * view, waits for the list to settle, captures the frame and writes the
 * geometry the frame is the symptom of: how many rows, which carry a decoded
 * thumbnail (an <img> that has `complete` and a real `naturalWidth`), each
 * row's box, and whether anything sticks out of the pane.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rendererDriverApi } from "../../../scripts/renderer-driver.mjs";

const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	verb,
	capture,
	reapLiveBoots,
} = rendererDriverApi;

const arg = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? null : process.argv[at + 1];
};
const BACKEND = arg("--backend");
const SESSION = arg("--session");
const OUT = arg("--out");
const LABEL = arg("--label") ?? "run";
if (!BACKEND || !SESSION || !OUT || !process.env.LOCAL_OPERATOR_DESKTOP_TOKEN) {
	console.error(
		"needs --backend --session --out and LOCAL_OPERATOR_DESKTOP_TOKEN",
	);
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({
	armed: true,
	logName: `app-${LABEL}.log`,
	tag: LABEL,
});
const report = {
	label: LABEL,
	session: SESSION,
	window: null,
	themes: {},
};
let code = 0;
try {
	// The driver's own wait for its devtools port is not in the facade; poll it.
	for (let i = 0; i < 240; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).ok)
				break;
		} catch {
			/* not listening yet */
		}
		await sleep(250);
	}
	const cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	for (let i = 0; i < 360; i += 1) {
		const ok = await cdp
			.evaluate("typeof window.__loDevDriver?.verbs === 'function'")
			.catch(() => false);
		if (ok) break;
		await sleep(250);
	}
	// An existing user, not a first-run one: the wizard would otherwise own the window.
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(2500);
	for (let i = 0; i < 360; i += 1) {
		const ok = await cdp
			.evaluate("typeof window.__loDevDriver?.verbs === 'function'")
			.catch(() => false);
		if (ok) break;
		await sleep(250);
	}
	const facts = await cdp
		.evaluate(
			"window.__loDevDriver.facts ? window.__loDevDriver.facts() : null",
		)
		.catch(() => null);
	report.facts = facts;
	report.window = facts?.windowSize ?? arg("--window-size");

	for (const [theme, name] of [
		["dark", "localOperatorDark"],
		["light", "localOperatorLight"],
	]) {
		await verb(cdp, "setTheme", name);
		await verb(cdp, "navigate", "/chat/new");
		await sleep(200);
		await verb(cdp, "navigate", `/chat/${SESSION}`);
		// Open the canvas and the Files view the way a user does.
		const until = async (expr, ms = 45_000) => {
			const t0 = Date.now();
			for (;;) {
				const v = await cdp.evaluate(expr).catch(() => null);
				if (v) return v;
				if (Date.now() - t0 > ms) return null;
				await sleep(300);
			}
		};
		await until(
			`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
		);
		if (
			!(await cdp.evaluate(
				`document.querySelector('[data-tour-tag="canvas-dock"]') ? true : false`,
			))
		) {
			await cdp.evaluate(
				`document.querySelector('[data-tour-tag="open-canvas-button"]').click(); true`,
			);
		}
		await until(
			`document.querySelector('button[aria-label^="Files"][aria-pressed]') ? true : null`,
		);
		await cdp.evaluate(
			`document.querySelector('button[aria-label^="Files"][aria-pressed]').click(); true`,
		);
		// The list is settled when the row count has been the same for ~2.4 s and, for
		// any row that is going to paint a thumbnail, the <img> has decoded or failed.
		let last = -1;
		let stable = 0;
		for (let i = 0; i < 60 && stable < 8; i += 1) {
			const n = await cdp.evaluate(
				`document.querySelectorAll('[data-tour-tag="file-row"]').length`,
			);
			stable = n === last ? stable + 1 : 0;
			last = n;
			await sleep(300);
		}
		// The thumbnail retry (2 s, then 6 s) means a digest that is gone shows its
		// skeleton for ~8 s before settling on the glyph. `--states` photographs that
		// window, then waits it out so every settled frame is deterministic rather
		// than a race against the timer.
		if (process.argv.includes("--states")) {
			const early = await capture(cdp, `files-${LABEL}-retrying-${theme}`, {
				assertPalette: false,
			});
			report.themes[theme] = { earlyFrame: early.path ?? early };
		}
		await sleep(2500);
		if (process.argv.includes("--probe-loading")) {
			report.themes[theme] = {
				loadingFrame: (await capture(cdp, `finder-${LABEL}-loading-${theme}`))
					.path,
			};
			await sleep(10000);
		}
		if (
			process.argv.includes("--scale") ||
			process.argv.includes("--open-working")
		) {
			await cdp.evaluate(
				`(() => {const b = [...document.querySelectorAll('[data-tour-tag="files-scroller"] h3 button')].find(x => x.innerText.startsWith('Working files')); if(b?.getAttribute('aria-expanded')==='false') b.click();})()`,
			);
			await sleep(1000);
		}
		const reading = await cdp.evaluate(`(() => {
			const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
			const rows = [...document.querySelectorAll('[data-tour-tag="file-row"]')];
			const dock = document.querySelector('[data-tour-tag="canvas-dock"]');
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			const dockBox = box(dock);
			return {
				innerWidth: window.innerWidth, innerHeight: window.innerHeight,
				dock: dockBox, dockMode: dock ? dock.getAttribute('data-canvas-mode') : null,
				scroller: box(scroller),
				rowCount: rows.length,
				rows: rows.map((row) => {
					const img = row.querySelector('img');
					const text = (row.innerText || '').replace(/\\s+/g, ' ').trim();
					const rb = row.getBoundingClientRect();
					return {
						text, box: box(row),
						insideDock: dockBox ? rb.right <= dockBox.x + dockBox.w + 0.5 && rb.left >= dockBox.x - 0.5 : null,
						thumb: img ? { decoded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, srcScheme: (img.getAttribute('src') || '').split(':')[0], box: box(img) } : null,
					};
				}),
				header: (document.querySelector('[data-tour-tag="files-scroller"]')?.parentElement?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
			};
		})()`);
		const frame = await capture(cdp, `files-${LABEL}-${theme}`);
		report.themes[theme] = {
			...(report.themes[theme] ?? {}),
			frame: frame.path ?? frame,
			reading,
		};
		if (process.argv.includes("--scale")) {
			const probe = () =>
				cdp.evaluate(`(() => {
				const s = document.querySelector('[data-tour-tag="files-scroller"]');
				const r = s.getBoundingClientRect();
				const rows = [...s.querySelectorAll('[data-tour-tag="file-row"]')];
				const visible = rows.filter((x) => { const b = x.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom; });
				return { mounted: rows.length, domNodes: document.querySelectorAll("*").length, heapBytes: performance.memory?.usedJSHeapSize ?? null, visible: visible.length, scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, clientWidth: s.clientWidth, scrollWidth: s.scrollWidth, tabStops: [...s.querySelectorAll('button')].filter(b => b.tabIndex === 0).length, lastVisible: visible.at(-1)?.innerText, lastBottom: visible.at(-1)?.getBoundingClientRect().bottom, scrollerBottom: r.bottom };
			})()`);
			report.themes[theme].scale = {
				first: await probe(),
				resourcesFirst: await verb(cdp, "filesFacts"),
			};
			await cdp.evaluate(
				`(() => {const s = document.querySelector('[data-tour-tag="files-scroller"]'); s.scrollTop=s.scrollHeight/2; s.dispatchEvent(new Event('scroll'));})()`,
			);
			await sleep(1500);
			report.themes[theme].scale.middle = await probe();
			await cdp.evaluate(
				`(() => {const s = document.querySelector('[data-tour-tag="files-scroller"]'); s.scrollTop=s.scrollHeight; s.dispatchEvent(new Event('scroll'));})()`,
			);
			await sleep(1500);
			report.themes[theme].scale.end = await probe();
			report.themes[theme].scale.resourcesEnd = await verb(cdp, "filesFacts");
			report.themes[theme].scale.endFrame = (
				await capture(cdp, `finder-${LABEL}-end-${theme}`)
			).path;
			await cdp.evaluate(
				`(() => {const s = document.querySelector('[data-tour-tag="files-scroller"]'); s.scrollTop=0; s.dispatchEvent(new Event('scroll'));})()`,
			);
			await sleep(600);
		}
		if (process.argv.includes("--delta-controls")) {
			const { finderDelta } = await import("./delta-controls.mjs");
			report.themes[theme].delta = await finderDelta({
				cdp,
				capture,
				sleep,
				label: LABEL,
				theme,
				expectOld: process.argv.includes("--expect-old"),
			});
		}
		console.log(
			`[${LABEL}/${theme}] rows=${reading.rowCount} thumbs-decoded=${reading.rows.filter((r) => r.thumb?.decoded).length} dock=${JSON.stringify(reading.dock)} mode=${reading.dockMode}`,
		);
	}
	if (process.argv.includes("--child-flow")) {
		await verb(cdp, "setTheme", "localOperatorLight");
		await cdp.evaluate(
			`document.querySelector('[data-tour-tag="files-scanner-head"] input').focus()`,
		);
		await cdp.send("Input.insertText", { text: "child-portrait" });
		await sleep(1800);
		report.child = await cdp.evaluate(
			`(() => { const row=document.querySelector('[data-tour-tag="file-row"]'); const img=row?.querySelector('img'); return {rows:document.querySelectorAll('[data-tour-tag="file-row"]').length,text:row?.innerText,naturalWidth:img?.naturalWidth,naturalHeight:img?.naturalHeight,decoded:img?.complete && img?.naturalWidth>0};})()`,
		);
		if (report.child.rows !== 1 || !report.child.decoded)
			throw new Error("Child image did not render through its family scope");
		if (process.argv.includes("--materialise-flow")) {
			await cdp.evaluate(
				`(() => {window.__copiedPath=null; navigator.clipboard.writeText=async text=>{window.__copiedPath=text;};document.querySelector('[data-tour-tag="file-row"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));})()`,
			);
			await sleep(500);
			await cdp.evaluate(
				`([...document.querySelectorAll('[role="menuitem"]')]).find(x=>x.innerText==='Copy file path').click()`,
			);
			await sleep(1200);
			report.child.materialisedPath = await cdp.evaluate("window.__copiedPath");
			if (
				!report.child.materialisedPath?.includes(
					"/scratchpad/generated/child-portrait",
				)
			)
				throw new Error("Path gesture did not materialise the child artifact");
		}
		report.child.listFrame = (
			await capture(cdp, `finder-${LABEL}-child-list-light`)
		).path;
		await cdp.evaluate(
			`document.querySelector('[data-tour-tag="file-row"] > button').click()`,
		);
		await sleep(1800);
		report.child.viewer = await cdp.evaluate(
			`(() => {const img=document.querySelector('img[alt="child-portrait.png"]');return {label:document.querySelector('[data-tour-tag="canvas-dock"]')?.innerText,width:img?.naturalWidth,height:img?.naturalHeight,decoded:img?.complete&&img?.naturalWidth>0};})()`,
		);
		if (!report.child.viewer.decoded)
			throw new Error("Child canvas image did not render");
		report.child.viewerFrame = (
			await capture(cdp, `finder-${LABEL}-child-viewer-light`)
		).path;
	}
	if (process.argv.includes("--keyboard-flow")) {
		const key = async (name, shift = false) => {
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key: name,
				code: name,
				modifiers: shift ? 8 : 0,
			});
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key: name,
				code: name,
				modifiers: shift ? 8 : 0,
			});
			await sleep(250);
		};
		await cdp.evaluate(
			`document.querySelector('[data-tour-tag="file-row"] > button').focus()`,
		);
		report.keyboard = [];
		for (const k of [
			"ArrowDown",
			"ArrowDown",
			"ArrowRight",
			"ArrowDown",
			"ArrowDown",
			"ArrowRight",
		]) {
			await key(k);
			report.keyboard.push({
				key: k,
				active: await cdp.evaluate("document.activeElement?.innerText"),
			});
		}
		await key("F10", true);
		report.keyboardMenu = await cdp.evaluate(
			`([...document.querySelectorAll('[role="menuitem"]')]).map(x=>x.innerText)`,
		);
		if (!report.keyboardMenu.includes("Expand image"))
			throw new Error("Keyboard menu omitted image expansion");
		report.keyboardFrame = (
			await capture(cdp, `finder-${LABEL}-keyboard-menu-light`)
		).path;
		await key("Escape");
		await key("/");
		report.slashSearch = await cdp.evaluate(
			`document.activeElement?.getAttribute('placeholder')`,
		);
		if (!report.slashSearch?.startsWith("Search files"))
			throw new Error("Slash did not reach the scoped search");
	}
	writeFileSync(
		join(OUT, `report-${LABEL}.json`),
		JSON.stringify(report, null, 2),
	);
} catch (error) {
	console.error(`FAILED: ${error?.stack ?? error}`);
	code = 1;
} finally {
	await reapLiveBoots({ code, why: "capture done" });
}
