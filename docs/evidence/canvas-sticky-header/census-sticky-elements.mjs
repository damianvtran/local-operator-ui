/*
 * A CENSUS of every sticky element in the app, in the running app.
 *
 * "Do it as a system, not a patch" needs a complete inventory, and a grep for
 * the class name is not one: a sticky element can be produced by a utility
 * class, by a stylesheet, or by a component that no one thinks of as a
 * header. So this asks the RUNTIME, in every pane and on every route, which
 * elements are sticky and what each one paints.
 *
 * For each sticky element:
 *
 *   - the pane it is in
 *   - whether content scrolls UNDER it (a scrollable ancestor it sits
 *     inside, or a scroll container whose box it overlaps)
 *   - its computed background and backdrop-filter
 *   - its height
 *   - the clip offset against that scroll container
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rendererDriverApi } from "../../../scripts/renderer-driver.mjs";

const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	waitForPage,
	waitForBridge,
	verb,
	reapLiveBoots,
} = rendererDriverApi;

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const BACKEND = arg("--backend");
const SESSION = arg("--session");
const OUT = arg("--out");

if (!BACKEND || !SESSION || !OUT) {
	console.error("needs --backend --session --out");
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({ armed: true, logName: "app-census.log", tag: "census" });

const report = { session: SESSION, places: [] };
let code = 0;

try {
	for (let i = 0; i < 240; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).ok) break;
		} catch {
			/* not listening yet */
		}
		await sleep(250);
	}
	const cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	const until = async (expr, ms = 60_000) => {
		const t0 = Date.now();
		for (;;) {
			const v = await cdp.evaluate(expr).catch(() => null);
			if (v) return v;
			if (Date.now() - t0 > ms) return null;
			await sleep(250);
		}
	};

	await waitForPage(cdp);
	await waitForBridge(cdp);
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

	/*
	 * THE CENSUS, as one expression so every pane is read in a consistent
	 * frame of the app.
	 */
	const census = `(() => {
		const visible = (el) => {
			const cs = getComputedStyle(el);
			if (cs.display === "none" || cs.visibility === "hidden") return false;
			const r = el.getBoundingClientRect();
			return r.height > 2 && r.width > 2;
		};
		const scrollableAncestor = (el) => {
			let node = el.parentElement;
			while (node) {
				const cs = getComputedStyle(node);
				if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
				node = node.parentElement;
			}
			return null;
		};
		const out = [];
		for (const el of document.querySelectorAll("body *")) {
			const cs = getComputedStyle(el);
			if (!/(sticky|fixed)/.test(cs.position)) continue;
			if (!visible(el)) continue;
			const r = el.getBoundingClientRect();
			const inner = scrollableAncestor(el);
			const sr = inner ? inner.getBoundingClientRect() : null;
			out.push({
				tag: el.tagName.toLowerCase(),
				tour: el.getAttribute("data-tour-tag"),
				role: el.getAttribute("role"),
				cls: (el.getAttribute("class") || "").slice(0, 120),
				text: (el.textContent || "").trim().slice(0, 40),
				position: cs.position,
				zIndex: cs.zIndex,
				background: cs.backgroundColor,
				backdropFilter: cs.backdropFilter,
				height: Math.round(r.height),
				// The scroll container this header sits INSIDE: content scrolls
				// under it, and only its own paint hides it.
				insideScroller: inner
					? {
							tour: inner.getAttribute("data-tour-tag"),
							cls: (inner.getAttribute("class") || "").slice(0, 90),
							overflowY: getComputedStyle(inner).overflowY,
							clipTop: Math.round(sr.top),
							// NEGATIVE means the header's band lies inside the
							// scroller's clip region: content reaches it.
							bandInsideScroller: Math.round(r.bottom - sr.top),
						}
					: null,
			});
		}
		return out;
	})()`;

	const places = [
		{
			name: "chat",
			open: async () => {
				await verb(cdp, "navigate", `/chat/${SESSION}`);
				await until(
					`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
				);
				await sleep(1000);
			},
		},
		{
			name: "canvas-files",
			open: async () => {
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
				await sleep(1500);
			},
		},
		{
			name: "asks",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="ask-pane-trigger"]')?.click(); true`,
				);
				await sleep(1500);
			},
		},
		{
			name: "console",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="console-pane-trigger"]')?.click(); true`,
				);
				await sleep(1500);
			},
		},
		{
			name: "browser",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="browser-pane-trigger"]')?.click(); true`,
				);
				await sleep(1500);
			},
		},
		{
			name: "code-review",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="code-pane-trigger"]')?.click(); true`,
				);
				await sleep(1500);
			},
		},
		{
			name: "library",
			open: async () => {
				await verb(cdp, "navigate", "/library");
				await sleep(2500);
			},
		},
		{
			name: "projects",
			open: async () => {
				await verb(cdp, "navigate", "/projects");
				await sleep(2500);
			},
		},
	];

	for (const place of places) {
		await place.open();
		/*
		 * DISMISS THE SIGN-IN MODAL. It is a fixed overlay over the whole
		 * window: it is a `position: fixed` element in the census, and while it
		 * is up it also swallows the clicks that open a pane, so a pane the
		 * operator can open is a pane the census cannot see.
		 */
		await cdp.evaluate(`(() => {
			const skip = [...document.querySelectorAll("button")].find(
				(b) => (b.textContent || "").trim() === "Skip for now",
			);
			if (skip) { skip.click(); return true; }
			return false;
		})()`);
		await sleep(600);
		const found = await cdp.evaluate(census);
		report.places.push({ place: place.name, sticky: found });
		console.log(`[census/${place.name}] ${found.length} sticky elements`);
		for (const s of found) {
			console.log(
				`   ${s.tag}${s.tour ? `[${s.tour}]` : ""} pos=${s.position} bg=${s.background} backdrop=${s.backdropFilter} h=${s.height} insideScroller=${s.insideScroller ? s.insideScroller.tour || s.insideScroller.cls.slice(0, 26) : "none"} band=${s.insideScroller ? s.insideScroller.bandInsideScroller : "-"} text="${s.text}"`,
			);
		}
	}

	writeFileSync(join(OUT, "census.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[census] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
