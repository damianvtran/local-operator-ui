#!/usr/bin/env node
/**
 * The rendered-DOM audit: overlapping boxes, clipped text and chips as NUMBERS.
 *
 * THIS IS THE INSTRUMENT THE OPERATOR-REPORT PAIR (2026-10-04) WAS MEASURED
 * WITH, committed so a reviewer can re-run the readings rather than trust them.
 * The repository carries no browser-automation dependency, and the design-qa
 * skill's own `dom_audit.mjs` needs Playwright, which this repository
 * deliberately does not carry - so this rig is raw CDP against ONE private
 * headless Chrome, the same shape `scripts/cursor-audit.mjs` and
 * `scripts/chat-alignment-geometry.mjs` use, launched through the repo's own
 * `scripts/chrome-keychain.mjs` and killed by exact pid on exit.
 *
 * It reports, as NUMBERS: visible text-bearing elements whose boxes intersect
 * while neither contains the other (in-flow); the same for floaters (overlay,
 * informational); clipped text with the px of loss and the visible string;
 * large container boxes (aside/section/header/ul/nav/main/footer) whose rects
 * intersect while neither contains the other; and, per session chip, the
 * visible text box, the full string's width, `side` (the end the ellipsis
 * leaves visible) and `kept` (the longest head/tail substring that still fits
 * beside the ellipsis, canvas-measured, +-1 char - design round 1, D4: box and
 * full width alone are identical whichever end is kept, so the flip was
 * invisible to the metric). What it cannot do is decide whether an overlap is
 * a defect - a popped-up menu over rows is 12 overlay pairs in a correct frame
 * - so the reading is the number, and the judgment is the reader's.
 *
 * Usage:
 *   node rendered-dom-audit.mjs --story <id> [--story <id>...] [--label <name>]
 *     [--theme localOperatorDark] [--dpr 1] [--format webp] [--quality 88]
 *     [--width 1380] [--height 900] [--out <dir>]
 *     [--click <selector>]... (clicked in order, after settle)
 *     [--wait-for <selector>] (settle gate) [--shot]
 *     [--scroll panel-top|panel-bottom] (park the mesh panel's scroll, then
 *       audit again under the `scrolled-panel-bottom` step)
 *     [--require <selector>] (the state must carry this element after settle,
 *       or the run FAILS - a story that never rendered audits as zero overlaps,
 *       which reads as success; the settle also waits for a non-empty
 *       `#storybook-root`, so a spinner page cannot be photographed as a state)
 * Everything lands under --out/<label>/ as audit.json + optional frames.
 */


import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "/Users/damian/.local-operator/sessions/b9ae7bc2e5e2/scratchpad/loui-mesh";
const { withMockKeychain } = await import(`${REPO}/scripts/chrome-keychain.mjs`);

const ARGS = process.argv.slice(2);
/* Values may be spelled `--name=value` or `--name value`; both are read. */
const flag = (name, fallback = null) => {
	const eq = ARGS.find((a) => a.startsWith(`--${name}=`));
	if (eq) return eq.slice(name.length + 3);
	const at = ARGS.indexOf(`--${name}`);
	return at !== -1 && ARGS[at + 1] ? ARGS[at + 1] : fallback;
};
const flags = (name) => {
	const out = [];
	for (let i = 0; i < ARGS.length; i++) {
		if (ARGS[i].startsWith(`--${name}=`)) out.push(ARGS[i].slice(name.length + 3));
		else if (ARGS[i] === `--${name}` && ARGS[i + 1]) out.push(ARGS[i + 1]);
	}
	return out;
};

const ORIGIN = flag("origin", "http://localhost:6052");
const THEME = flag("theme", "localOperatorDark");
const DPR = Number(flag("dpr", "1"));
const FORMAT = flag("format", "png");
const QUALITY = flag("quality");
const WIDTH = Number(flag("width", "1380"));
const HEIGHT = Number(flag("height", "900"));
const LABEL = flag("label", "run");
const OUT = flag("out", join(process.cwd(), "rendered-dom-audit-out"));
const ONLY = flags("story");
const CLICKS = flags("click");
const WAIT_FOR = flags("wait-for");
const SCROLL = flag("scroll"); // "panel-top" | "panel-bottom"
const REQUIRE = flag("require"); // selector that must exist after settle, or the run fails
const SHOT = ARGS.includes("--shot");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVTOOLS_LISTENING = /DevTools listening on (ws:\/\/[^\s]+)/;

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
		ws.addEventListener("close", () => this.#failAll(new Error("socket closed")));
		ws.addEventListener("error", () => this.#failAll(new Error("socket errored")));
	}
	#failAll(err) {
		for (const { reject } of this.pending.values()) reject(err);
		this.pending.clear();
	}
	send(method, params = {}) {
		const id = ++this.next;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} did not answer within 30s`));
			}, 30000);
			this.pending.set(id, {
				resolve: (value) => { clearTimeout(timer); resolve(value); },
				reject: (err) => { clearTimeout(timer); reject(err); },
			});
			try {
				this.ws.send(JSON.stringify({ id, method, params }));
			} catch (err) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(err);
			}
		});
	}
}

/* ---------------- the in-page audit ---------------- */

const AUDIT = String.raw`(() => {
	const OVERLAY_SEL = '[role="menu"],[role="dialog"],[role="listbox"],[role="tooltip"],[data-radix-popper-content-wrapper],[data-radix-menu-content]';
	const isVisible = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		const cs = getComputedStyle(el);
		if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false;
		return true;
	};
	/* PAINTED, not merely laid out: an element scrolled out of an ancestor's
	   clip box has a geometric rect but no pixels - counting it produced
	   phantom overlaps in the scrolled states. Walk the scroll/clip ancestors
	   and require a non-empty intersection with every one of them. */
	const isPainted = (el) => {
		let r = el.getBoundingClientRect();
		let cur = el.parentElement;
		while (cur && cur !== document.documentElement) {
			const cs = getComputedStyle(cur);
			const overflow = cs.overflow + ' ' + cs.overflowX + ' ' + cs.overflowY;
			if (/hidden|clip|auto|scroll/.test(overflow) && cur.clientHeight > 0) {
				const c = cur.getBoundingClientRect();
				const bl = parseFloat(cs.borderLeftWidth) || 0;
				const bt = parseFloat(cs.borderTopWidth) || 0;
				const box = { left: c.left + bl, top: c.top + bt, right: c.left + bl + cur.clientWidth, bottom: c.top + bt + cur.clientHeight };
				const x = Math.max(r.left, box.left), y = Math.max(r.top, box.top);
				const rr = Math.min(r.right, box.right), bb = Math.min(r.bottom, box.bottom);
				if (rr - x <= 0.5 || bb - y <= 0.5) return false;
				r = { left: x, top: y, right: rr, bottom: bb, width: rr - x, height: bb - y };
			}
			cur = cur.parentElement;
		}
		return true;
	};
	const directText = (el) => {
		let t = '';
		for (const n of el.childNodes) {
			if (n.nodeType === 3) t += n.textContent;
		}
		return t.replace(/\s+/g, ' ').trim();
	};
	const rect = (el) => {
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x*10)/10, y: Math.round(r.y*10)/10, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10 };
	};
	const desc = (el) => {
		const attrs = ['data-mesh-panel','data-mesh-panel-session','data-mesh-session-menu','data-mesh-session','data-mesh-device','data-mesh-network','data-mesh-canvas','data-mesh-world'];
		const found = [];
		for (const a of attrs) { const v = el.getAttribute(a); if (v !== null) found.push(a + '=' + v.slice(0, 24)); }
		return {
			tag: el.tagName.toLowerCase(),
			cls: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 6).join(' '),
			attrs: found.join(' '),
		};
	};
	const inOverlay = (el) => {
		let cur = el;
		while (cur && cur !== document.body) {
			try { if (cur.matches && cur.matches(OVERLAY_SEL)) return cur; } catch (e) {}
			cur = cur.parentElement;
		}
		return null;
	};
	/* Pairs of overlapping text-bearing elements. Leaves: element with direct
	   text (after whitespace collapse) OR a control with an accessible name. */
	const els = [];
	for (const el of document.querySelectorAll('body *')) {
		if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
		if (!isVisible(el) || !isPainted(el)) continue;
		const t = directText(el);
		const interactive = el.matches('button,a[href],[role="menuitem"],input,select,textarea');
		if (!t && !interactive) continue;
		els.push({ el, t });
	}
	const pairs = [];
	for (let i = 0; i < els.length; i++) {
		for (let j = i + 1; j < els.length; j++) {
			const A = els[i].el, B = els[j].el;
			if (A.contains(B) || B.contains(A)) continue;
			const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
			const x = Math.max(ra.left, rb.left), y = Math.max(ra.top, rb.top);
			const r = Math.min(ra.right, rb.right), b = Math.min(ra.bottom, rb.bottom);
			const w = r - x, h = b - y;
			if (w <= 1 || h <= 1) continue;
			const area = Math.round(w * h);
			if (area < 24) continue;
			const oa = inOverlay(A), ob = inOverlay(B);
			const kind = (oa && ob) ? 'same-overlay' : (oa || ob) ? 'overlay' : 'in-flow';
			if (kind === 'same-overlay') continue;
			pairs.push({
				kind,
				area,
				inter: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
				a: { ...desc(A), text: (els[i].t || A.textContent || '').trim().slice(0, 64), rect: rect(A) },
				b: { ...desc(B), text: (els[j].t || B.textContent || '').trim().slice(0, 64), rect: rect(B) },
			});
		}
	}
	/* Clipped text: content wider than the box, with clipping overflow. */
	const clip = [];
	for (const el of document.querySelectorAll('body *')) {
		if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
		if (!isVisible(el)) continue;
		const cs = getComputedStyle(el);
		const ox = cs.overflowX, oy = cs.overflowY;
		const clippedX = (ox === 'hidden' || ox === 'clip') && el.scrollWidth - el.clientWidth >= 2;
		const clippedY = (oy === 'hidden' || oy === 'clip') && el.scrollHeight - el.clientHeight >= 2;
		if (!clippedX && !clippedY) continue;
		const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
		if (!t) continue;
		clip.push({
			...desc(el),
			lossX: el.scrollWidth - el.clientWidth,
			lossY: el.scrollHeight - el.clientHeight,
			clientW: el.clientWidth, scrollW: el.scrollWidth,
			clientH: el.clientHeight, scrollH: el.scrollHeight,
			textOverflow: cs.textOverflow, direction: cs.direction,
			text: t.slice(0, 80),
			rect: rect(el),
		});
	}
	/* Block-region overlaps: aside/section/ul/header containers that intersect. */
	const blocks = [];
	for (const el of document.querySelectorAll('aside,section,header,ul,nav,main,footer')) {
		if (!isVisible(el) || !isPainted(el)) continue;
		blocks.push(el);
	}
	const blockPairs = [];
	for (let i = 0; i < blocks.length; i++) {
		for (let j = i + 1; j < blocks.length; j++) {
			const A = blocks[i], B = blocks[j];
			if (A.contains(B) || B.contains(A)) continue;
			if (inOverlay(A) || inOverlay(B)) continue;
			const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
			const x = Math.max(ra.left, rb.left), y = Math.max(ra.top, rb.top);
			const r = Math.min(ra.right, rb.right), b = Math.min(ra.bottom, rb.bottom);
			const w = r - x, h = b - y;
			if (w <= 2 || h <= 2) continue;
			const area = Math.round(w * h);
			if (area < 200) continue;
			blockPairs.push({ area, a: desc(A), b: desc(B), inter: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } });
		}
	}
	/* Chip metrics: the text span's box against the string it holds. */
	const chips = [];
	for (const btn of document.querySelectorAll('button[data-mesh-session]')) {
		const span = btn.querySelector('span');
		const cs = span ? getComputedStyle(span) : null;
		let fullW = null;
		let kept = null, side = null;
		if (span && cs) {
			try {
				const c = document.createElement('canvas').getContext('2d');
				c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
				const text = span.textContent || '';
				fullW = Math.round(c.measureText(text).width * 10) / 10;
				/*
				 * WHICH END THE ELLIPSIS LEAVES VISIBLE (design round 1, D4): the box
				 * and the full-string width are identical whichever end is kept, so a
				 * reading built from those two numbers cannot see the change it was
				 * added to measure. 'side' names the end the CSS keeps; 'kept' is the
				 * longest head/tail substring that still fits beside the ellipsis,
				 * canvas-measured (+-1 char - the frame is the pixel evidence, this is
				 * the instrumentation).
				 */
				side = cs.direction === 'rtl' ? 'tail' : 'head';
				const ell = c.measureText('\u2026').width;
				const max = span.clientWidth;
				const measure = (n) => side === 'head'
					? c.measureText(text.slice(0, n)).width
					: c.measureText(text.slice(text.length - n)).width;
				if (measure(text.length) <= max) {
					kept = text;
				} else {
					let k = text.length;
					while (k > 0 && measure(k) + ell > max) k--;
					kept = side === 'head' ? text.slice(0, k) : text.slice(text.length - k);
				}
			} catch (e) {}
		}
		chips.push({
			id: btn.getAttribute('data-mesh-session'),
			text: (span && span.textContent) || '',
			visible: span ? span.clientWidth : null,
			fullTextWidth: fullW,
			side: side,
			kept: kept,
			chipW: Math.round(btn.getBoundingClientRect().width * 10) / 10,
		});
	}
	/* The open menu's surface, when there is one. */
	let menu = null;
	const m = document.querySelector('[role="menu"]');
	if (m) {
		const cs = getComputedStyle(m);
		menu = { bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 80), z: cs.zIndex, rect: rect(m), text: (m.textContent||'').replace(/\s+/g,' ').slice(0, 120) };
	}
	/* Panel geometry: the flex column's boxes, so an overlap can be traced to
	   the box that overflows rather than described. */
	const panel = document.querySelector('[data-mesh-panel]');
	let panelProbe = null;
	if (panel) {
		const sub = (el) => {
			const c = getComputedStyle(el);
			return {
				tag: el.tagName.toLowerCase(),
				cls: (el.getAttribute('class')||'').split(/\s+/).filter(Boolean).slice(0,5).join(' '),
				rect: rect(el),
				clientH: el.clientHeight, scrollH: el.scrollHeight,
				computedH: c.height, minH: c.minHeight, flexShrink: c.flexShrink,
				overflowY: c.overflowY,
			};
		};
		panelProbe = {
			aside: sub(panel),
			children: [...panel.children].map(sub),
			sections: [...panel.querySelectorAll('section')].map(sub),
			lists: [...panel.querySelectorAll('ul')].map(sub),
			listItemCount: panel.querySelectorAll('li').length,
			sessionRowCount: panel.querySelectorAll('[data-mesh-panel-session]').length,
		};
	}
	const count = (k) => pairs.filter((p) => p.kind === k).length;
	return {
		url: location.href,
		inFlow: pairs.filter((p) => p.kind === 'in-flow').sort((a, b) => b.area - a.area).slice(0, 40),
		overlay: pairs.filter((p) => p.kind === 'overlay').sort((a, b) => b.area - a.area).slice(0, 40),
		clipped: clip.sort((a, b) => (b.lossX + b.lossY) - (a.lossX + a.lossY)).slice(0, 60),
		blockPairs: blockPairs.sort((a, b) => b.area - a.area).slice(0, 20),
		menu,
		panel: panelProbe,
		chips,
		totals: { inFlow: count('in-flow'), overlay: count('overlay'), clipped: clip.length, blockPairs: blockPairs.length, elements: els.length },
	};
})()`;

/* ---------------- the driver ---------------- */

let chrome = null;
let dataDir = null;
const teardown = () => {
	if (chrome) { try { chrome.kill("SIGKILL"); } catch (e) {} chrome = null; }
	if (dataDir) {
		try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }); } catch (e) {}
		dataDir = null;
	}
};

const main = async () => {
	if (ONLY.length === 0) throw new Error("pass --story <id>");
	mkdirSync(OUT, { recursive: true });
	dataDir = join(tmpdir(), `lo-mesh-audit-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
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
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("Chrome did not report a debug port")), 30000);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_LISTENING);
			if (m) { clearTimeout(t); resolve(m[1]); }
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited early (${code})`)));
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: false,
	});
	/*
	 * Seed the persisted preferences store before any app script runs; the
	 * `args=theme:` URL alone leaves surfaces that read the store (rather than
	 * `data-theme`) on the previous frame's theme. Same key and shape as
	 * `scripts/capture-evidence.mjs` seeds, re-registered per document.
	 */
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `try { localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: "${THEME}" }, version: 0 })); } catch {}`,
	});

	const results = [];
	for (const story of ONLY) {
		const label = `${LABEL}`;
		const dir = join(OUT, label);
		mkdirSync(dir, { recursive: true });
		const url = `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${THEME}`;
		await cdp.send("Page.navigate", { url });
		/* settle: stable element count + optional wait-for selectors */
		let last = -1;
		let stable = 0;
		for (let i = 0; i < 240; i++) {
			await sleep(150);
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll('.sb-preparing-story,.sb-preparing-docs,.sb-nopreview,.sb-loader')].some((el) => el.getBoundingClientRect().height > 0);
					const n = document.body.querySelectorAll('*').length;
					const err = document.body.classList.contains('sb-show-errordisplay');
					/* A spinner page is count-stable, so a bare count settle can
					   photograph the PREPARING screen as if it were the state. Require
					   the rendered story (a non-empty #storybook-root) and, when given,
					   the --require element, as part of the settle. */
					const root = document.querySelector('#storybook-root');
					const rendered = !!root && root.children.length > 0;
					const req = ${REQUIRE ? `!!document.querySelector(${JSON.stringify(REQUIRE)})` : "true"};
					return { loading, n, err, rendered, req };
				})()`,
			});
			const v = result.value;
			if (v.err) throw new Error(`story errored: ${story}`);
			if (!v.loading && v.rendered && v.req && v.n === last) { stable += 1; } else { stable = 0; }
			last = v.n;
			if (stable >= 4) {
				if (WAIT_FOR.length === 0) break;
				const { result: found } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => ${JSON.stringify(WAIT_FOR)}.every((s) => document.querySelector(s) !== null))()`,
				});
				if (found.value) break;
			}
		}

		/* A PAGE THAT DID NOT RENDER IS NOT A PASS (the dead-instrument rule):
		   a story that fails to render audits as zero overlaps, which reads as
		   success. --require names an element the state must carry; its absence
		   fails the run rather than writing a clean-looking frame. */
		if (REQUIRE) {
			const { result: req } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `!!document.querySelector(${JSON.stringify(REQUIRE)})`,
			});
			if (req.value !== true)
				throw new Error(`${story} @ ${THEME}: --require selector \`${REQUIRE}\` matched nothing after settle`);
		}
		/* screenshots + audits: one before clicks, one after each click */
		const shots = [];
		const shortStory = story.replace(/[^\w-]/g, "_");
		const auditRun = async (name) => {
			const { result } = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: AUDIT });
			const shotPath = join(dir, `${shortStory}--${name}.${FORMAT}`);
			if (SHOT) {
				const { data } = await cdp.send("Page.captureScreenshot", {
					format: FORMAT,
					...(QUALITY ? { quality: Number(QUALITY) } : {}),
				});
				writeFileSync(shotPath, Buffer.from(data, "base64"));
				shots.push(shotPath);
			}
			results.push({ story, step: name, ...result.value, shot: SHOT ? shotPath : null });
			const t = result.value.totals;
			console.log(`[${story}] ${name}: inFlow=${t.inFlow} overlay=${t.overlay} clipped=${t.clipped} blockPairs=${t.blockPairs}; menu=${result.value.menu ? result.value.menu.bg : "none"}`);
		};
		await auditRun("closed");
		if (SCROLL) {
			await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression:
					SCROLL === "panel-bottom"
						? `(() => { const p = document.querySelector('[data-mesh-panel]'); if (p) p.scrollTop = p.scrollHeight; return p ? p.scrollTop : -1; })()`
						: `(() => { const p = document.querySelector('[data-mesh-panel]'); if (p) p.scrollTop = 0; return p ? p.scrollTop : -1; })()`,
			});
			await sleep(400);
			await auditRun(`scrolled-${SCROLL}`);
		}
		let idx = 0;
		for (const sel of CLICKS) {
			idx += 1;
			const { result: pos } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const el = document.querySelector(${JSON.stringify(sel)});
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
				})()`,
			});
			if (!pos.value) throw new Error(`--click target not found: ${sel}`);
			const { x, y } = pos.value;
			await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
			await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
			await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
			await sleep(500);
			await auditRun(`click${idx}`);
		}
	}
	writeFileSync(join(OUT, LABEL, "audit.json"), JSON.stringify(results, null, 2));
	console.log(`audit written: ${join(OUT, LABEL, "audit.json")}`);
};

let keepAlive = null;
main()
	.catch((err) => { console.error(err); process.exitCode = 1; })
	.finally(() => { if (keepAlive) clearInterval(keepAlive); teardown(); });
