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
			`document.querySelector('button[aria-label^="Files view"]') ? true : null`,
		);
		await cdp.evaluate(
			`document.querySelector('button[aria-label^="Files view"]').click(); true`,
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
		await sleep(process.argv.includes("--states") ? 11_000 : 1500);
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
		console.log(
			`[${LABEL}/${theme}] rows=${reading.rowCount} thumbs-decoded=${reading.rows.filter((r) => r.thumb?.decoded).length} dock=${JSON.stringify(reading.dock)} mode=${reading.dockMode}`,
		);
	}
	if (process.argv.includes("--interact")) {
		// The real flows, in the dark palette: the row menu, then an image row, then
		// the video row, each opened by a click the way a user does it.
		await verb(cdp, "setTheme", "localOperatorDark");
		const clickRow = (needle) =>
			cdp.evaluate(
				`(() => { const rows = [...document.querySelectorAll('[data-tour-tag="file-row"]')]; const row = rows.find((r) => r.innerText.includes(${JSON.stringify(needle)})); const open = row?.querySelector('button'); if (!open) return false; open.click(); return true; })()`,
			);
		// 1. the row's actions menu, opened on the video row (no Copy image) and an image row.
		const menuOf = async (needle) => {
			await cdp.evaluate(
				`(() => { const rows = [...document.querySelectorAll('[data-tour-tag="file-row"]')]; const row = rows.find((r) => r.innerText.includes(${JSON.stringify(needle)})); row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const t = row?.querySelector('button[aria-label="File actions"]'); if (t) { t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); t.click(); } return Boolean(t); })()`,
			);
			await sleep(700);
			return cdp.evaluate(
				`[...document.querySelectorAll('[role="menuitem"]')].map((i) => i.innerText.trim())`,
			);
		};
		report.interact = {};
		report.interact.imageMenu = await menuOf("0466de15");
		report.interact.imageMenuFrame = (
			await capture(cdp, `files-${LABEL}-menu-image`, { assertPalette: false })
		).path;
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await sleep(500);
		report.interact.videoMenu = await menuOf("Video f07be5f5");
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await sleep(500);
		// 2. open the image row in the canvas.
		report.interact.clickedImage = await clickRow("0466de15");
		await sleep(2500);
		report.interact.imageViewer = await cdp.evaluate(`(() => {
			const panel = document.querySelector('#canvas-document-panel') ?? document.querySelector('[data-tour-tag="canvas-container"]');
			const img = panel ? panel.querySelector('img') : null;
			const tab = document.querySelector('[role="tab"][aria-selected="true"]');
			return { tab: tab ? tab.textContent.trim() : null, tabTitle: tab ? tab.getAttribute('title') : null, img: img ? { decoded: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight, scheme: (img.getAttribute('src') || '').split(':')[0] } : null, freshnessBar: Boolean(document.querySelector('[data-tour-tag="canvas-document-freshness"]')), noLongerOnDisk: document.body.innerText.includes('No longer on disk') };
		})()`);
		report.interact.imageViewerFrame = (
			await capture(cdp, `files-${LABEL}-viewer-image`, {
				assertPalette: false,
			})
		).path;
		// 3. back to Files, then the video row.
		await cdp.evaluate(
			`document.querySelector('button[aria-label^="Files view"]')?.click(); true`,
		);
		await sleep(900);
		report.interact.clickedVideo = await clickRow("Video f07be5f5");
		await sleep(3500);
		report.interact.videoViewer = await cdp.evaluate(`(() => {
			const panel = document.querySelector('#canvas-document-panel') ?? document.querySelector('[data-tour-tag="canvas-container"]');
			const video = panel ? panel.querySelector('video') : null;
			return { video: video ? { readyState: video.readyState, w: video.videoWidth, h: video.videoHeight, duration: video.duration, scheme: (video.getAttribute('src') || '').split(':')[0], error: video.error ? video.error.code : null } : null, noLongerOnDisk: document.body.innerText.includes('No longer on disk') };
		})()`);
		report.interact.videoViewerFrame = (
			await capture(cdp, `files-${LABEL}-viewer-video`, {
				assertPalette: false,
			})
		).path;
	}
	if (process.argv.includes("--states")) {
		report.states = {};
		const open = (needle) =>
			cdp.evaluate(
				`(() => { const row = [...document.querySelectorAll('[data-tour-tag="file-row"]')].find((r) => r.innerText.includes(${JSON.stringify(needle)})); const b = row?.querySelector('button'); if (!b) return false; b.click(); return true; })()`,
			);
		const toFiles = async () => {
			await cdp.evaluate(
				`document.querySelector('button[aria-label^="Files view"]')?.click(); true`,
			);
			await sleep(900);
		};
		await verb(cdp, "setTheme", "localOperatorDark");
		await toFiles();
		report.states.goneOpened = await open("gone.png");
		await sleep(2500);
		report.states.goneViewer = await cdp.evaluate(
			`(document.querySelector('#canvas-document-panel') ?? document.body).innerText.replace(/\\s+/g, ' ').trim().slice(0, 160)`,
		);
		report.states.goneFrame = (
			await capture(cdp, `files-${LABEL}-viewer-gone-dark`)
		).path;
		// The tall picture in the viewer, in light: design D1's crop is measured
		// against the pane's bottom edge rather than eyeballed.
		await toFiles();
		await verb(cdp, "setTheme", "localOperatorLight");
		await open("0466de15");
		await sleep(2500);
		report.states.tallViewer = await cdp.evaluate(`(() => {
			const dock = document.querySelector('[data-tour-tag="canvas-dock"]').getBoundingClientRect();
			const img = document.querySelector('#canvas-document-panel img');
			const r = img ? img.getBoundingClientRect() : null;
			return { dockBottom: Math.round(dock.bottom), imgTop: r && Math.round(r.top), imgBottom: r && Math.round(r.bottom), imgInsideDock: r ? r.bottom <= dock.bottom + 0.5 : null, innerHeight: window.innerHeight };
		})()`);
		report.states.tallViewerFrame = (
			await capture(cdp, `files-${LABEL}-viewer-image-light`)
		).path;
		// Same-name tabs: both pictures that share a producer name, open at once.
		await toFiles();
		await open("412b2a3d");
		await sleep(1500);
		report.states.tabs = await cdp.evaluate(
			`[...document.querySelectorAll('[role="tab"]')].map((t) => ({ label: t.textContent.trim(), title: t.getAttribute('title') }))`,
		);
		report.states.tabsFrame = (
			await capture(cdp, `files-${LABEL}-tabs-light`)
		).path;
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
