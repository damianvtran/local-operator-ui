#!/usr/bin/env node
/**
 * The row states' before/after frames, captured from a BUILT Storybook.
 *
 *     node row-states-capture.mjs --serve <storybook-static> --out <dir> \
 *          --half before|after --themes a,b,c [--states rest,neighbour-hovered]
 *
 * This is the local-operator evidence rig's own path, driven directly rather
 * than through `scripts/capture-evidence.mjs`, for one reason: a before/after
 * PAIR has to come from two TREES (this branch's and `origin/main`'s), and the
 * committed rig captures from the tree it lives in. Everything it does that
 * matters is reproduced here rather than re-invented:
 *
 *   - a PRIVATE headless Chrome over raw CDP: scratch `--user-data-dir`, the
 *     mock-keychain switch taken from `scripts/chrome-keychain.mjs` (which is
 *     what a scratch HOME needs, or macOS raises a Keychain dialog on the
 *     operator's screen), `--no-first-run`, `--remote-debugging-port=0`,
 *     `--headless=new`.
 *     Nothing raises a window and the process is killed by exact pid on exit.
 *     No `screencapture`, no downloaded browser engine;
 *   - the theme is driven the way the committed rig drives it - `args=theme:<id>`
 *     on the iframe URL plus a seeded `ui-preferences-storage` before the
 *     document's scripts run - and EVERY frame asserts
 *     `documentElement.dataset.theme` equals the palette it is named for before
 *     the shutter;
 *   - the hover is a REAL POINTER, an `Input.dispatchMouseEvent` `mouseMoved`
 *     left on the row above the current one, addressed by the selector
 *     `scripts/capture-evidence.mjs` uses for the same state
 *     (`div:has(+ div > [data-chat-row][aria-current="page"]) > [data-chat-row]`);
 *   - the frame is `Page.captureScreenshot` clipped to the row list's own
 *     bounding box at device scale factor 2, converted to WebP at the
 *     repository's own quality;
 *   - the page's own `getComputedStyle` readback per frame (both row fills, the
 *     two role variables, every row's rect and label) is printed and written
 *     beside the run, so a frame can be checked against its palette rather than
 *     trusted.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";
import { loadPalettes } from "../../../../scripts/palette-source.mjs";

const ARGS = process.argv.slice(2);
/* Both spellings, because the committed rig's own flags take `--name=value` and a
   reader copying its commands would otherwise pass a flag this one ignores. */
const flag = (n, d = null) => {
	const inline = ARGS.find((a) => a.startsWith(`--${n}=`));
	if (inline !== undefined) return inline.slice(n.length + 3);
	const i = ARGS.indexOf(`--${n}`);
	return i === -1 ? d : ARGS[i + 1];
};
const OUT = flag("out");
const SERVE = flag("serve");
const HALF = flag("half", "after");
const THEMES = flag("themes").split(",");
const STATES = (flag("states") ?? "rest,neighbour-hovered").split(",");
/*
 * A SCENE is one surface this rig photographs, and each one names the four
 * selectors that make it a surface: the story that renders it, the CURRENT row
 * (the element the two row roles are painted on), the element that paints the
 * GROUND the row sits on, and the box the frame is cropped to.
 *
 * It exists because the row states are painted on seven surfaces now and only
 * one of them is the chat sidebar: the app rail and the agent-hub categories rail
 * are the two whose ground the remediation round changed, and "the fill is a step
 * of the panel" is a claim about the GROUND — which a frame of the row list alone
 * cannot settle. Hence `assertGround`: on the after half the painted ancestor's
 * computed background is compared to `var(--lo-surface)` and the run FAILS if it
 * differs, so the frame's ground is asserted rather than eyeballed. The before
 * half is never asked that question — its ground is the state being photographed.
 *
 * `crop` is either a single element or the UNION of every match (`cropIsUnion`),
 * which is how the chat sidebar's frames are the row list's own bounding box.
 */
/*
 * THE PLATE'S OWN SELECTOR, named once (design review D14, review M1). The `after/`
 * half of this set is the evidence for a change whose whole pixel is a 1px
 * `border-control` ring on the avatar plate inside a row state, and two of the
 * three surfaces a row state is photographed on — the app rail's expanded and
 * collapsed frames — contain it. The ring was NOT the change the frames were
 * first taken for, which is exactly why it went unphotographed for a round: the
 * committed rail frames were a picture of a tree from before the ring existed.
 *
 * The selector is the account row's own disc, addressed by the ring itself:
 * `border-control` is the class the plate is the only wearer of inside the rail's
 * `<nav>` (`shared/components/navigation/user-profile-sidebar.tsx`), and the run
 * FAILS unless it matches exactly one element, so a second one appearing — or the
 * selector matching nothing on a tree where the ring does — is a failure rather
 * than a frame taken of something else. Measured on the rail, expanded and
 * collapsed: 28x28, `border: 1px <that palette's borderControl>`.
 */
const PLATE_SELECTOR = "nav button span.border-control";
/*
 * The disc's own box, asserted rather than reported (review round 4, R4-2): the
 * frames are evidence `alucard` 0.44 -> 4.35 for a 28px avatar, and the number
 * was printed in the readback for a reader to compare by eye - so a run that
 * photographed an 8x8 sliver with the same 1px ring would have committed it under
 * a README table that says 28x28. Measured on every rail frame of the re-shoot:
 * 28x28 at device scale factor 2, i.e. 56 device pixels.
 */
const PLATE_BOX = "28x28";
const SCENES = {
	"chat-sidebar": {
		story: "chat-sidebar-current-row--selected-row",
		row: '[data-chat-row][aria-current="page"]',
		hover:
			'div:has(+ div > [data-chat-row][aria-current="page"]) > [data-chat-row]',
		crop: "[data-chat-row]",
		cropIsUnion: true,
		assertGround: null,
		plate: null,
	},
	"rail-expanded": {
		story: "shell-app-shell--agents",
		row: 'nav [aria-current="page"]',
		hover: null,
		crop: "nav",
		cropIsUnion: false,
		assertGround: "surface",
		plate: PLATE_SELECTOR,
	},
	"rail-collapsed": {
		story: "shell-app-shell--rail-collapsed",
		row: 'nav [aria-current="page"]',
		hover: null,
		crop: "nav",
		cropIsUnion: false,
		assertGround: "surface",
		plate: PLATE_SELECTOR,
	},
	"categories-rail": {
		story: "agent-hub-page--grid",
		row: '[data-tour-tag="agent-hub-sidebar-container"] [aria-pressed="true"]',
		hover: null,
		/*
		 * The ROWS, not the column, with a small pad. The column is `h-full` of a
		 * ~5900px page, so a frame of the column would be 99% empty ground; what the
		 * frame has to show is the row's fill AGAINST the ground it sits on, and
		 * 10px of the ground on every side does that. The readback asserts the
		 * ground itself, so the crop is free to be the useful one.
		 */
		crop: '[data-tour-tag="agent-hub-sidebar-container"] button',
		cropIsUnion: true,
		cropPad: 10,
		assertGround: "surface",
		plate: null,
	},
};
const SCENE = SCENES[flag("scene", "chat-sidebar")];
if (!SCENE) throw new Error(`no such scene: ${flag("scene")}`);
const STORY = flag("story", SCENE.story);
const W = Number(flag("width", "780"));
const H = Number(flag("height", "560"));
const SCALE = Number(flag("scale", "2"));
const READINGS = flag(
	"readings",
	join(tmpdir(), `lo-row-states-readings-${HALF}.json`),
);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".css": "text/css",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".map": "application/json",
	".ico": "image/x-icon",
	".wasm": "application/wasm",
	".txt": "text/plain",
};

const server = createServer((req, res) => {
	const url = new URL(req.url, "http://x");
	const p = normalize(decodeURIComponent(url.pathname)).replace(
		/^(\.\.[/\\])+/,
		"",
	);
	const file = join(SERVE, p === "/" ? "/index.html" : p);
	try {
		const body = readFileSync(file);
		res.writeHead(200, {
			"content-type": MIME[extname(file)] ?? "application/octet-stream",
			"cache-control": "no-store",
		});
		res.end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
});

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		ws.addEventListener("message", (e) => {
			const m = JSON.parse(e.data);
			if (m.id && this.pending.has(m.id)) {
				this.pending.get(m.id)(m);
				this.pending.delete(m.id);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.id;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}
	async eval(expression) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.error) throw new Error(JSON.stringify(r.error));
		return r.result?.result?.value;
	}
}

/** The committed rig's own quality, so a frame here is the size of its peers. */
const toWebp = (pngPath, webpPath) => {
	execFileSync("magick", [
		pngPath,
		"-quality",
		"82",
		"-define",
		"webp:method=6",
		webpPath,
	]);
};

const main = async () => {
	mkdirSync(OUT, { recursive: true });
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const ORIGIN = `http://127.0.0.1:${server.address().port}`;

	const dataDir = mkdtempSync(join(tmpdir(), "lo-rowstates-"));
	const chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			"--no-first-run",
			"--no-default-browser-check",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
		{ stdio: ["ignore", "ignore", "pipe"] },
	);

	let stderr = "";
	const wsUrl = await new Promise((resolve, reject) => {
		const t = setTimeout(
			() => reject(new Error(`Chrome gave no debug port\n${stderr}`)),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			stderr += d.toString();
			const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (c) =>
			reject(new Error(`Chrome exited early (${c})\n${stderr}`)),
		);
	});

	const { host } = new URL(wsUrl);
	const targets = await fetch(`http://${host}/json`).then((r) => r.json());
	const page = targets.find((t) => t.type === "page");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: W,
		height: H,
		deviceScaleFactor: SCALE,
		mobile: false,
	});

	const report = [];
	let seed = null;
	try {
		for (const theme of THEMES) {
			for (const state of STATES) {
				if (seed)
					await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
						identifier: seed,
					});
				({ identifier: seed } = await cdp.send(
					"Page.addScriptToEvaluateOnNewDocument",
					{
						source: `try{localStorage.setItem("ui-preferences-storage",JSON.stringify({state:{themeName:${JSON.stringify(theme)}},version:0}));localStorage.removeItem("conversation-input-store");}catch{}`,
					},
				));
				/* Park the pointer away from the list before the document loads, so a
				   frame is a function of its own story and not of the one before it. */
				await cdp.send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: W - 4,
					y: H - 4,
					button: "none",
					buttons: 0,
					clickCount: 0,
					modifiers: 0,
					pointerType: "mouse",
				});
				await cdp.send("Page.navigate", {
					url: `${ORIGIN}/iframe.html?id=${STORY}&viewMode=story&args=theme:${theme}`,
				});
				await sleep(700);
				let applied = "";
				for (let i = 0; i < 60 && applied !== theme; i++) {
					applied = await cdp.eval(
						"document.documentElement.dataset.theme||''",
					);
					if (applied !== theme) await sleep(150);
				}
				if (applied !== theme) {
					throw new Error(`${theme}: theme never applied (got ${applied})`);
				}
				await sleep(500);

				const neighbour =
					state === "neighbour-hovered" && SCENE.hover !== null
						? await cdp.eval(
								`(()=>{const e=document.querySelector(${JSON.stringify(SCENE.hover)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
							)
						: null;
				if (state === "neighbour-hovered" && SCENE.hover !== null) {
					if (!neighbour) {
						throw new Error(`${theme}/${state}: hover target not found`);
					}
					await cdp.send("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						x: Math.round(neighbour.x),
						y: Math.round(neighbour.y),
						button: "none",
						buttons: 0,
						clickCount: 0,
						modifiers: 0,
						pointerType: "mouse",
					});
					await sleep(350);
				}

				const pad = SCENE.cropPad ?? 0;
				const rect = await cdp.eval(
					SCENE.cropIsUnion
						? `(()=>{const a=document.querySelectorAll(${JSON.stringify(SCENE.crop)});if(!a.length)return null;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;a.forEach(e=>{const r=e.getBoundingClientRect();x0=Math.min(x0,r.left);y0=Math.min(y0,r.top);x1=Math.max(x1,r.right);y1=Math.max(y1,r.bottom);});return {x:x0-${pad},y:y0-${pad},w:x1-x0+2*${pad},h:y1-y0+2*${pad}};})()`
						: `(()=>{const e=document.querySelector(${JSON.stringify(SCENE.crop)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left-${pad},y:r.top-${pad},w:r.width+2*${pad},h:r.height+2*${pad}};})()`,
				);
				if (!rect) throw new Error(`${theme}/${state}: no rows on screen`);

				const shot = await cdp.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
					clip: {
						x: rect.x,
						y: rect.y,
						width: rect.w,
						height: rect.h,
						scale: 1,
					},
				});
				const dir = join(OUT, state);
				mkdirSync(dir, { recursive: true });
				const png = join(tmpdir(), `lo-rowstates-${theme}-${state}.png`);
				writeFileSync(png, Buffer.from(shot.result.data, "base64"));
				toWebp(png, join(dir, `${theme}.webp`));
				rmSync(png, { force: true });

				/*
				 * The DOM READBACK, and it is the instrument the rail's 0.44 was read with:
				 * the current row's own computed background, the element that actually
				 * PAINTS the ground under it (the nearest ancestor with a non-transparent
				 * one), that element's colour, and the page's ground variables. A frame
				 * with a readback beside it can be checked against its palette; a frame
				 * alone has to be trusted.
				 */
				const read = await cdp.eval(
					`(()=>{const row=document.querySelector(${JSON.stringify(SCENE.row)});const plateEls=${JSON.stringify(SCENE.plate)}?[...document.querySelectorAll(${JSON.stringify(SCENE.plate)})]:[];const plateEl=plateEls[0]??null;const borderProbe=document.createElement('div');borderProbe.style.borderColor='var(--lo-border-control)';document.body.appendChild(borderProbe);const borderControlRgb=getComputedStyle(borderProbe).borderColor;borderProbe.remove();const painted=(el)=>{let n=el.parentElement;while(n&&n!==document.documentElement){const bg=getComputedStyle(n).backgroundColor;if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')return {tag:n.tagName.toLowerCase(),cls:String(n.className).slice(0,140),bg};n=n.parentElement;}return null;};const s=getComputedStyle(document.documentElement);const v=(n)=>s.getPropertyValue(n).trim();const probe=document.createElement('div');probe.style.backgroundColor='var(--lo-surface)';document.body.appendChild(probe);const surfaceRgb=getComputedStyle(probe).backgroundColor;probe.remove();const rows=[...document.querySelectorAll('[data-chat-row]')].map((e)=>{const r=e.getBoundingClientRect();return {label:e.textContent.trim().slice(0,32),bg:getComputedStyle(e).backgroundColor,w:Math.round(r.width),h:Math.round(r.height)};});/* THE BOUNDARY, read rather than assumed: the rail's own border-r has to be the only one on that seam, or two rules double into a 2px line where the design asks for one. */const rail=row?row.closest('nav'):null;const next=rail?rail.nextElementSibling:null;const boundary= rail?{railBorderRight:getComputedStyle(rail).borderRightWidth+' '+getComputedStyle(rail).borderRightColor,nextTag:next?next.tagName.toLowerCase():null,nextBorderLeft:next?getComputedStyle(next).borderLeftWidth+' '+getComputedStyle(next).borderLeftColor:null}:null;return {borderControl:v('--lo-border-control'),plateMatches:plateEls.length,plate: plateEl?{tag:plateEl.tagName.toLowerCase(),cls:String(plateEl.className).slice(0,140),bg:getComputedStyle(plateEl).backgroundColor,border:getComputedStyle(plateEl).borderTopWidth+' '+getComputedStyle(plateEl).borderTopColor,box:(r=>Math.round(r.width)+'x'+Math.round(r.height))(plateEl.getBoundingClientRect())}:null,borderControlRgb,row: row?getComputedStyle(row).backgroundColor:null,rowLabel: row?row.textContent.trim().slice(0,40):null,painted: row?painted(row):null,surfaceRgb,surface:v('--lo-surface'),sunken:v('--lo-sunken'),canvas:v('--lo-canvas'),varSel:v('--lo-row-selected'),varHov:v('--lo-row-hover'),boundary,rows};})()`,
				);
				if (read.row === null) {
					throw new Error(
						`${theme}/${state}: no current row matched ${SCENE.row}`,
					);
				}
				if (HALF === "after" && SCENE.assertGround === "surface") {
					/*
					 * THE GROUND IS ASSERTED, not left to the eye: a surface that paints
					 * `rowCurrent`/`hover:bg-row-hover` wears `surface`, so the element the
					 * row is actually painted on has to resolve to `var(--lo-surface)`.
					 * On the app rail this is the check that reads 0.44 when it is wrong.
					 */
					if (read.painted === null || read.painted.bg !== read.surfaceRgb) {
						throw new Error(
							`${theme}/${state}: the row is painted on ${JSON.stringify(read.painted)}, not on var(--lo-surface) = ${read.surfaceRgb} (surface ${read.surface}, sunken ${read.sunken}, canvas ${read.canvas})`,
						);
					}
				}
				if (HALF === "after" && SCENE.plate !== null) {
					/*
					 * THE RING IS READ, not left to the eye — the same discipline as the
					 * ground: the plate under the row's own state has to resolve to a 1px
					 * `border-control` that this palette's variable carries, or the frame
					 * is not a picture of the shipping state. A selector that matches
					 * nothing fails here rather than reporting a plate of `null`.
					 */
					if (read.plateMatches !== 1 || read.plate === null) {
						throw new Error(
							`${theme}/${state}: ${read.plateMatches} element(s) matched ${JSON.stringify(SCENE.plate)}, and the plate this set is evidence for is exactly one — a second ring, or none, means the frame is not a picture of the state under review`,
						);
					}
					const [width, ...colour] = read.plate.border.split(" ");
					/*
					 * AND THE BOX IS ASSERTED, not reported (review round 4, R4-2). The size is
					 * what makes the ring a ring on a 28px disc rather than a hairline on a
					 * sliver: every clause above would have passed on an 8x8 image with a 1px
					 * `border-control` edge, and the readback that carried this number was
					 * only ever printed for a reader to notice.
					 */
					if (read.plate.box !== PLATE_BOX) {
						throw new Error(
							`${theme}/${state}: the plate is ${read.plate.box}, not the ${PLATE_BOX} disc this set is evidence for (${read.plate.bg}, border ${read.plate.border}) - the ring and the box are one object, and a size the frames are not pictures of is the thing the re-shoot exists to prevent`,
						);
					}
					if (width !== "1px") {
						throw new Error(
							`${theme}/${state}: the plate's edge is ${width}, not the 1px border-control ring this set is evidence for (${read.plate.box}, ${read.plate.bg})`,
						);
					}
					if (colour.join(" ") !== read.borderControlRgb) {
						throw new Error(
							`${theme}/${state}: the plate edge is ${colour.join(" ")}, not var(--lo-border-control) = ${read.borderControl} (${read.borderControlRgb})`,
						);
					}
				}
				if (HALF === "after" && SCENE.assertGround === null) {
					/* The ONE thing the before half cannot be asked: that the page is showing
					   the SHIPPED role variables rather than whatever a proposal left
					   behind. Read from the same parser the contrast gate reads, so a frame
					   cannot be named for one value and painted with another. */
					const want = loadPalettes().find(
						(entry) => entry.id === theme,
					)?.palette;
					if (!want) throw new Error(`${theme}: no palette by that name`);
					if (
						read.varHov.toLowerCase() !== want.rowHover.toLowerCase() ||
						read.varSel.toLowerCase() !== want.rowSelected.toLowerCase()
					) {
						throw new Error(
							`${theme}: the page's role variables are ${read.varHov}/${read.varSel}, not the shipped ${want.rowHover}/${want.rowSelected}`,
						);
					}
				}
				report.push({ theme, state, half: HALF, rect, read });
				process.stdout.write(
					`  ${HALF} ${theme}/${state} -> ${join(dir, `${theme}.webp`)}\n`,
				);
			}
		}
	} finally {
		writeFileSync(READINGS, JSON.stringify(report, null, 1));
		try {
			ws.close();
		} catch {}
		/* Killed by exact pid, and the profile is reaped rather than left behind: a
		   scratch Chrome profile on this machine is a directory the operator finds
		   later, and an abandoned one also re-attempts the keychain for minutes
		   after its run ends. The retry is because SIGKILL is asynchronous - Chrome
		   can still be writing into its own profile when the walk starts - and a
		   cleanup that fails must not turn a run that captured its frames into a
		   non-zero exit. */
		chrome.kill("SIGKILL");
		server.close();
		for (const wait of [0, 250, 1000]) {
			await sleep(wait);
			try {
				rmSync(dataDir, { recursive: true, force: true });
				break;
			} catch (error) {
				process.stderr.write(
					`  profile reap failed (${error?.code}); retrying\n`,
				);
			}
		}
	}
	console.log(`${report.length} frames -> ${OUT} (readings: ${READINGS})`);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
