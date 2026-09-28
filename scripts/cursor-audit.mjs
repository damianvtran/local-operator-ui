#!/usr/bin/env node
/**
 * Walk every story and measure the pointer affordance of every interactive
 * element: what cursor does each control actually compute?
 *
 *     node scripts/cursor-audit.mjs [storybook-origin] [--json] [--out=<file>]
 *     node scripts/cursor-audit.mjs --only=design-system-primitives --assert-clean
 *
 * ## Why this exists
 *
 * The operator's report was "many buttons and clickable elements do not update
 * the mouse cursor - no pointer affordance - across the app". That is a claim
 * about COMPUTED STYLE, and no screenshot can carry it: a cursor is not a
 * pixel in any capture, and the difference between a button that shows
 * `pointer` and one that shows the platform's default arrow is invisible in a
 * still. So the evidence is a measurement, taken from the same rendered DOM
 * the evidence frames come from, and this file is the command that produces
 * it - a reviewer re-runs it rather than trusting a table someone typed.
 *
 * It reads a Storybook because Storybook is this repo's verification surface
 * for every component state (the same one `capture-evidence.mjs` photographs),
 * and it walks ALL stories rather than a hand-picked list so the claim can be
 * "every rendered surface", not "the surfaces someone remembered". The
 * cascade it measures is the product's own: `.storybook/preview.tsx` imports
 * the same `styles/index.css` the app does, under the same Tailwind v4
 * pipeline, so a rule that fixes a story fixes the app the same way.
 *
 * ## What it asserts, per element
 *
 * - a control - `button`, `a[href]`, `summary`, `select`, a checkbox/radio/
 *   file/button-like `input`, or anything with an interactive role
 *   (`menuitem`, `tab`, `switch`, `checkbox`, `radio`, `option`, `slider`...)
 *   - must compute `cursor: pointer`. A control that is ALSO a text surface (a
 *   `textarea` or text `input` carrying `role="combobox"`, which is how every
 *   type-to-filter field in this app is built) is a text entry first: the
 *   I-beam is what a person needs there, and the combobox role does not
 *   change that;
 * - the same control in a disabled state (`:disabled`, `aria-disabled="true"`
 *   or `data-disabled`, and NOT `data-disabled="false"` - react-hot-toast
 *   spells absence that way on its close button, measured) must compute
 *   `not-allowed` - the base layer's rule - or `default`, the withdrawal
 *   convention several components document for a control whose affordance is
 *   deliberately gone (the dead-directory chip, the removed-session link).
 *   What it must never compute is `pointer`: a disabled control advertising a
 *   click is the one contradiction this arm exists to catch;
 * - a text-entry element (`input` of a text-like type, `textarea`,
 *   `[contenteditable="true"]`) must NOT compute `pointer` - the text cursor
 *   is the platform's to give and this audit's job is to leave it alone;
 * - a `label` whose control is a choice control (the `sr-only` radios behind a
 *   segmented control, a checkbox a settings row toggles) IS the click target,
 *   so it must compute `pointer` too - a label is not in the base layer's
 *   semantic list, so this arm is what keeps those click targets from silently
 *   keeping the wrong cursor;
 * - a focusable separator widget (`role="separator"` with `aria-valuenow`)
 *   must compute its own resize cursor (`col-resize` or `row-resize`), which
 *   is the convention `resizable-divider.tsx` already follows;
 * - an element that declares an HTML5 drag must compute `grab`/`grabbing`;
 * - anything ELSE that computes `pointer` without an interactive ancestor is
 *   reported as an "unattributed pointer" - a click affordance promised to
 *   the user that this audit cannot tie to a semantic control, so a human has
 *   to look at it. (An element inside a control inherits its cursor, which is
 *   what makes the icon inside a button correct without its own rule.)
 *
 * ## How it walks the stories, and why that way
 *
 * Stories are switched IN PLACE, through Storybook's own channel
 * (`setCurrentStory`), which is what clicking the sidebar does - a full
 * navigation per story costs ~1.2s of preview boot for every one of the
 * thousand stories in `index.json`, and pays it twice over a before/after
 * pair. `storyRendered` on the same channel is the readiness signal, so a
 * story is never scanned mid-mount (a count-threshold gate alone measures the
 * preview shell as "drawn" about 17ms after navigation - measured, and the
 * reason the channel event is load-bearing here rather than decorative).
 * `--reload` forces a real navigation for every story instead: the fast path
 * and the reload path are regularly checked against each other on a story
 * slice (`--only=` plus `--reload`, diff the two JSON reports) because the
 * fast path is a claim that in-place switching and a fresh load agree about
 * every cursor value on the page.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach
 * as `chat-alignment-geometry.mjs` and `capture-evidence.mjs` (fresh
 * user-data-dir under the OS temp root, killed on exit, no browser-automation
 * dependency added to the repo). Duplicating that driver here rather than
 * importing it is the same smaller evil the geometry probe records: this scan
 * walks a story list of its own and measures instead of shooting, and
 * threading a third mode through the evidence sweep would complicate the one
 * script in this repo that must stay boring, for the benefit of a probe.
 *
 * A story that fails to render is REPORTED - the SKIP line, the summary and
 * the JSON - and not asserted: story health belongs to the evidence gates
 * and to whoever changed the story, and a gate that cannot pass on a tree
 * with one broken story is a gate nobody runs. This run's claim is about the
 * cursors of the stories that do render, and the printed `scanned N/M` line
 * is the size of that claim.
 *
 * One theme is deliberately enough. Cursor is not a palette token - no theme
 * in `themes.generated.css` sets a cursor - so a defect this audit exists for
 * cannot hide in the eleven themes it does not visit; the theme arg below is
 * pinned only so every run measures the same page.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const flag = (name) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : null;
};
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");
const ASSERT_CLEAN = ARGS.includes("--assert-clean");
const RELOAD = ARGS.includes("--reload");
const ONLY = flag("only")
	?.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const OUT = flag("out");

const THEME = "localOperatorDark";
const VIEWPORT = { width: 1380, height: 900 };

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The line Chromium prints on stderr with the DevTools socket, hoisted so the
 *  probe does not recompile it per data event. */
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
		/*
		 * A closed socket must reject whatever is in flight. Measured on
		 * 2026-09-28: when the page under the socket went away mid-walk, the
		 * pending `send` promise never settled, nothing else held the event
		 * loop open, and Node EXITED 0 with no summary and no JSON - a gate
		 * that silently passed because the process drained. Rejecting here
		 * turns exactly that into a loud, non-zero failure; the interval kept
		 * alive in `main` is the belt to this pair of braces.
		 */
		ws.addEventListener("close", () =>
			this.#failAll(new Error("the devtools socket closed")),
		);
		ws.addEventListener("error", () =>
			this.#failAll(new Error("the devtools socket errored")),
		);
	}
	#failAll(err) {
		for (const { reject } of this.pending.values()) reject(err);
		this.pending.clear();
	}
	send(method, params = {}) {
		const id = ++this.next;
		return new Promise((resolve, reject) => {
			/* Every call is bounded: a hung CDP request is otherwise
			   indistinguishable from a slow story and stalls the walk. */
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} did not answer within 30s`));
			}, 30_000);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				},
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

/*
 * The channel hook, installed on every new document BEFORE any page script
 * (via Page.addScriptToEvaluateOnNewDocument) so it can subscribe before the
 * preview renders its first story. The channel object appears a few hundred
 * milliseconds into the preview's boot, so the subscription is retried on a
 * 5ms interval until it lands; once subscribed it never unsubscribes.
 *
 * It carries the readiness signal (`rendered`/`lastId`) and the one command
 * this audit needs (`emitSetStory`). Everything else the page does is read
 * from the live DOM - no generic eval surface, matching why the app's own dev
 * driver is a verb list.
 */
const HOOK = `(() => {
	window.__loAudit = { rendered: 0, lastId: null, missing: 0, threw: 0 };
	const hook = () => {
		const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
		if (!ch || typeof ch.on !== 'function' || typeof ch.emit !== 'function') return false;
		ch.on('storyRendered', (id) => { window.__loAudit.rendered++; window.__loAudit.lastId = id; });
		ch.on('storyMissing', () => { window.__loAudit.missing++; });
		ch.on('storyThrewException', () => { window.__loAudit.threw++; });
		window.__loAudit.emitSetStory = (id) => ch.emit('setCurrentStory', { storyId: id });
		return true;
	};
	if (!hook()) {
		const timer = setInterval(() => { if (hook()) clearInterval(timer); }, 5);
	}
})()`;

/*
 * The scan, evaluated in the page after two settled frames.
 *
 * Written as a string handed to `Runtime.evaluate` rather than as a function
 * serialised across, so what runs in the browser is exactly what is read here.
 * No backticks below: the whole thing is a template literal.
 */
const SCAN = `(() => {
	/* The controls whose affordance this audit has an opinion about. Kept as
	   one selector so the forward scan, the reverse scan's ancestry test and
	   the disabled arm cannot drift apart - they are three readings of one
	   definition. */
	const CONTROLS = [
		'button', 'a[href]', 'summary', 'select',
		'input[type="checkbox"]', 'input[type="radio"]',
		'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
		'input[type="file"]',
		'[role="button"]', '[role="link"]', '[role="menuitem"]',
		'[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="tab"]',
		'[role="switch"]', '[role="checkbox"]', '[role="radio"]',
		'[role="option"]', '[role="combobox"]', '[role="slider"]',
		'[role="treeitem"]',
	].join(',');

	/* Text-entry inputs, by the type attribute they carry. An input with no
	   type attribute IS a text input, which is why the empty string is here. */
	const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel',
		'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
	const inputType = (el) => (el.getAttribute('type') || '').toLowerCase();
	const isTextEntry = (el) =>
		el.tagName === 'TEXTAREA' ||
		el.getAttribute('contenteditable') === 'true' ||
		(el.tagName === 'INPUT' && TEXT_TYPES.has(inputType(el)));

	const isDisabled = (el) => {
		if (el.matches(':disabled')) return true;
		if (el.getAttribute('aria-disabled') === 'true') return true;
		/* data-disabled is a boolean-attribute convention: Radix emits it as
		   an empty string, but react-hot-toast writes data-disabled="false"
		   on its close button when it is NOT disabled - presence alone is not
		   the fact, the value has to be read. */
		const dd = el.getAttribute('data-disabled');
		return dd !== null && dd !== 'false';
	};

	/* What an element looks like to a person: rendered, not display:none. */
	const isVisible = (el) => el.getClientRects().length > 0;

	const desc = (el) => {
		const cs = getComputedStyle(el);
		return {
			tag: el.tagName.toLowerCase(),
			type: el.tagName === 'INPUT' ? inputType(el) : null,
			role: el.getAttribute('role') || null,
			disabled: isDisabled(el),
			pointerEvents: cs.pointerEvents,
			visible: isVisible(el),
			ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 60) || null,
			text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
			classSample: (el.getAttribute('class') || '').split(/\\s+/)
				.filter((t) => t).slice(0, 8).join(' '),
		};
	};
	const record = (el, actual) => ({ ...desc(el), cursor: actual });

	const wrong = [];
	const byCategory = {};
	const bump = (category, actual, expected) => {
		const c = byCategory[category] = byCategory[category] || { totals: {}, wrong: 0, expected };
		c.totals[actual] = (c.totals[actual] || 0) + 1;
	};
	const check = (el, category, expected, matches) => {
		const actual = getComputedStyle(el).cursor;
		bump(category, actual, expected);
		if (matches !== undefined && !matches(actual)) {
			byCategory[category].wrong += 1;
			wrong.push({ category, expected: expected.join(' | '), ...record(el, actual) });
		}
	};

	/* The forward scan. Text surfaces are skipped here and asserted in their
	   own arm below: a combobox textarea is a text entry FIRST. */
	for (const el of document.querySelectorAll(CONTROLS)) {
		if (el.matches('[role="separator"]')) continue;
		if (isTextEntry(el)) continue;
		const disabled = isDisabled(el);
		if (disabled) {
			/* default is allowed on purpose: it is the withdrawal convention
			   for a disabled control whose affordance is deliberately gone (see
			   the docstring). pointer is not - that is the contradiction. */
			check(el, 'disabled-control', ['not-allowed', 'default'], (c) => c === 'not-allowed' || c === 'default');
			continue;
		}
		check(el, 'control', ['pointer'], (c) => c === 'pointer');
	}

	/* Choice labels: the label IS the target a person clicks (the control it
	   names is often sr-only), so it is held to the pointer the same way. */
	const choiceLabel = (el) => {
		if (el.tagName !== 'LABEL') return false;
		const ctl = el.control;
		return Boolean(ctl && (ctl.type === 'checkbox' || ctl.type === 'radio'));
	};
	for (const el of document.querySelectorAll('label')) {
		if (!choiceLabel(el)) continue;
		check(el, 'control-label', ['pointer'], (c) => c === 'pointer');
	}

	/* Separator widgets: the resize handles. A NON-widget separator (a
	   decorative rule) has no cursor opinion and is not counted. Keep the
	   attribute spelled in quotes below - a backtick in this template string
	   would end it, which is the one trap this whole file shares with its
	   sibling probes. */
	for (const el of document.querySelectorAll('[role="separator"]')) {
		const widget = el.hasAttribute('aria-valuenow') || el.tabIndex >= 0;
		if (!widget) continue;
		const expected = ['col-resize', 'row-resize'];
		check(el, 'separator-widget', expected, (c) => expected.includes(c));
	}

	/* Text entry: recorded, and asserted only to not CLAIM a click. */
	for (const el of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
		if (!isTextEntry(el)) continue;
		const actual = getComputedStyle(el).cursor;
		bump('text-entry', actual, ['platform text cursor']);
		if (actual === 'pointer') {
			byCategory['text-entry'].wrong += 1;
			wrong.push({ category: 'text-entry', expected: 'platform text cursor', ...record(el, actual) });
		}
	}

	/* Elements that declare an HTML5 drag: expected to say so with a cursor. */
	for (const el of document.querySelectorAll('[draggable="true"]')) {
		const actual = getComputedStyle(el).cursor;
		bump('draggable', actual, ['grab', 'grabbing']);
		if (!['grab', 'grabbing'].includes(actual)) {
			byCategory.draggable.wrong += 1;
			wrong.push({ category: 'draggable', expected: 'grab | grabbing', ...record(el, actual) });
		}
	}

	/* Everything else: a pointer with no control above it is an affordance
	   this audit cannot attribute, so it is reported rather than counted
	   wrong - the reader decides whether it is a missing role or a stray
	   class. Only the ROOT of a pointer region is reported (a child whose
	   parent already computes pointer is the same affordance seen again), and
	   SVG children are skipped: a shape inside an icon inherits its button's
	   cursor, and standalone path-level hits are noise. */
	const unattributed = [];
	for (const el of document.querySelectorAll('*')) {
		if (el instanceof SVGElement) continue;
		if (getComputedStyle(el).cursor !== 'pointer') continue;
		if (el.matches(CONTROLS)) continue;
		if (el.parentElement && el.parentElement.closest(CONTROLS)) continue;
		if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
		if (el.closest('[contenteditable="true"]')) continue;
		/* A choice label's pointer is this audit's own expectation above, not an
		   unattributed surprise. */
		if (choiceLabel(el)) continue;
		unattributed.push(desc(el));
	}

	/* The whole document's cursor histogram, so the report can show every
	   value in play rather than only the bucket it asserts on. */
	const hist = {};
	for (const el of document.querySelectorAll('*')) {
		const c = getComputedStyle(el).cursor;
		hist[c] = (hist[c] || 0) + 1;
	}

	return { byCategory, wrong, unattributed, hist };
})()`;

/*
 * One poll of "is the requested story rendered and nothing still moving".
 * `drawn` is deliberately a conjunction: the channel says WHICH story
 * rendered, the element count over a floor says it was not an empty frame,
 * and the fonts check says glyphs are not mid-swap (a story whose layout
 * depends on a web face can still be reflowing after the render event).
 */
const READY = `(() => {
	const a = window.__loAudit || {};
	const loading = [...document.querySelectorAll(
		'.sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader',
	)].some((el) => el.getBoundingClientRect().height > 0);
	const errorDisplay = document.querySelector('.sb-errordisplay');
	const errored = document.body.classList.contains('sb-show-errordisplay') ||
		Boolean(errorDisplay && errorDisplay.getBoundingClientRect().height > 0);
	const INERT = ['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT'];
	const root = document.getElementById('storybook-root');
	let n = root ? root.querySelectorAll('*').length : 0;
	for (const child of document.body.children) {
		if (child === root) continue;
		if (INERT.includes(child.tagName)) continue;
		if (child.classList.contains('sb-preparing-story') || child.classList.contains('sb-errordisplay')) continue;
		n += child.querySelectorAll('*').length + 1;
	}
	return {
		rendered: a.rendered || 0,
		lastId: a.lastId || null,
		missing: a.missing || 0,
		threw: a.threw || 0,
		loading,
		fonts: document.fonts.status,
		errored,
		counted: n,
		drawn: !loading && !errored && document.fonts.status === 'loaded' && n >= 9,
	};
})()`;

const fetchStoryIds = async () => {
	const res = await fetch(`${ORIGIN}/index.json`);
	if (!res.ok) throw new Error(`index.json answered ${res.status}`);
	const index = await res.json();
	let ids = Object.values(index.entries ?? {})
		.filter((e) => e.type === "story")
		.map((e) => e.id);
	if (ONLY) ids = ids.filter((id) => ONLY.some((s) => id.includes(s)));
	ids.sort();
	return ids;
};

let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const main = async () => {
	const ids = await fetchStoryIds();
	if (ids.length === 0) throw new Error("no stories matched");
	console.log(`cursor audit: ${ids.length} stories against ${ORIGIN}`);

	/*
	 * The walk must never end by draining. Measured 2026-09-28: with the
	 * socket closed mid-run and this interval absent, the process left with
	 * exit 0 and wrote nothing - no summary, no JSON - which a caller would
	 * read as a pass. The interval keeps the loop alive whenever work is in
	 * flight, so a hung walk HANGS VISIBLY, and the watchdog turns that hang
	 * into a non-zero failure naming the state instead of silence. Both are
	 * cleared in the same finally that tears the browser down.
	 */
	keepAlive = setInterval(() => {}, 1000);
	watchdog = setTimeout(() => {
		console.error(
			"cursor audit: no progress for 45 minutes - aborting rather than reporting a partial walk as a pass",
		);
		teardown();
		process.exit(1);
	}, 45 * 60_000);

	dataDir = join(tmpdir(), `lo-cursor-audit-${process.pid}`);
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
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_LISTENING);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
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
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...VIEWPORT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });

	const storyUrl = (id) =>
		`${ORIGIN}/iframe.html?id=${id}&viewMode=story&args=theme:${THEME}`;

	/*
	 * Poll until the story in `id` has rendered and the page is still. Two
	 * consecutive equal element counts is the "still" half: the render event
	 * lands when React has committed, and a story that mounts further content
	 * afterwards (ag-grid's rows, a chart's SVG) grows the count until it is
	 * done. 36s is the give-up bound; a story still moving after it is
	 * recorded as unrendered rather than measured mid-mount.
	 */
	const settle = async (id) => {
		let lastCount = -1;
		let last = null;
		for (let i = 0; i < 300; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: READY,
			});
			last = result.value;
			if (!last) return null;
			if (last.errored) return last;
			const mine = last.lastId === id && last.rendered >= 1;
			if (mine && last.drawn) {
				if (last.counted === lastCount) return last;
				lastCount = last.counted;
			} else {
				lastCount = -1;
			}
			await sleep(120);
		}
		return last;
	};

	const stories = [];
	const summary = {
		stories: 0,
		unrendered: [],
		interactive: 0,
		interactiveWrong: 0,
		controlLabels: 0,
		controlLabelWrong: 0,
		textEntry: 0,
		textEntryWrong: 0,
		draggable: 0,
		draggableWrong: 0,
		separators: 0,
		separatorWrong: 0,
		unattributedPointers: 0,
		byCursor: {},
		byCategory: {},
	};

	const started = Date.now();
	let first = true;
	for (const id of ids) {
		let probe = null;
		let navigated = false;
		if (first || RELOAD) {
			if (!first) {
				await cdp.send("Page.navigate", { url: "about:blank" });
				await sleep(60);
			}
			await cdp.send("Page.navigate", { url: storyUrl(id) });
			navigated = true;
		} else {
			await cdp.send("Runtime.evaluate", {
				expression: `window.__loAudit.emitSetStory(${JSON.stringify(id)})`,
			});
		}
		probe = await settle(id);
		if ((!probe || !probe.drawn || probe.errored) && !navigated) {
			/*
			 * The in-place switch did not land - either the channel refused it
			 * or the story could not render without a fresh document. Fall back
			 * to a real navigation exactly once, which is also the path
			 * `--reload` takes for every story.
			 */
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(60);
			await cdp.send("Page.navigate", { url: storyUrl(id) });
			probe = await settle(id);
		}
		first = false;
		if (!probe || !probe.drawn || probe.errored) {
			summary.unrendered.push({ id, probe });
			summary.stories += 1;
			console.log(`SKIP ${id} ${JSON.stringify(probe)}`);
			continue;
		}
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: SCAN,
		});
		const scan = result.value;
		const wrongCount = scan.wrong.length;
		const interactive = Object.entries(scan.byCategory)
			.filter(
				([k]) =>
					![
						"control-label",
						"text-entry",
						"draggable",
						"separator-widget",
					].includes(k),
			)
			.reduce(
				(n, [, v]) => n + Object.values(v.totals).reduce((a, b) => a + b, 0),
				0,
			);
		summary.stories += 1;
		summary.interactive += interactive;
		summary.interactiveWrong += scan.wrong.filter(
			(w) => w.category === "control" || w.category === "disabled-control",
		).length;
		summary.controlLabels += scan.byCategory["control-label"]
			? Object.values(scan.byCategory["control-label"].totals).reduce(
					(a, b) => a + b,
					0,
				)
			: 0;
		summary.controlLabelWrong += scan.wrong.filter(
			(w) => w.category === "control-label",
		).length;
		summary.textEntry += scan.byCategory["text-entry"]
			? Object.values(scan.byCategory["text-entry"].totals).reduce(
					(a, b) => a + b,
					0,
				)
			: 0;
		summary.textEntryWrong += scan.wrong.filter(
			(w) => w.category === "text-entry",
		).length;
		summary.draggable += scan.byCategory.draggable
			? Object.values(scan.byCategory.draggable.totals).reduce(
					(a, b) => a + b,
					0,
				)
			: 0;
		summary.draggableWrong += scan.wrong.filter(
			(w) => w.category === "draggable",
		).length;
		summary.separators += scan.byCategory["separator-widget"]
			? Object.values(scan.byCategory["separator-widget"].totals).reduce(
					(a, b) => a + b,
					0,
				)
			: 0;
		summary.separatorWrong += scan.wrong.filter(
			(w) => w.category === "separator-widget",
		).length;
		summary.unattributedPointers += scan.unattributed.length;
		for (const [c, n] of Object.entries(scan.hist)) {
			summary.byCursor[c] = (summary.byCursor[c] || 0) + n;
		}
		for (const [cat, v] of Object.entries(scan.byCategory)) {
			let agg = summary.byCategory[cat];
			if (!agg) {
				agg = { totals: {}, wrong: 0 };
				summary.byCategory[cat] = agg;
			}
			for (const [c, n] of Object.entries(v.totals)) {
				agg.totals[c] = (agg.totals[c] || 0) + n;
			}
			agg.wrong += v.wrong;
		}
		stories.push({
			id,
			interactive,
			wrong: scan.wrong,
			unattributed: scan.unattributed,
			byCategory: scan.byCategory,
			hist: scan.hist,
		});
		const mark = wrongCount > 0 ? "WRONG" : "ok";
		console.log(
			`${mark}  ${id}  interactive=${interactive} wrong=${wrongCount} unattributed=${scan.unattributed.length}`,
		);
	}

	const elapsedS = Math.round((Date.now() - started) / 1000);
	if (summary.stories !== ids.length) {
		throw new Error(
			`the walk recorded ${summary.stories} of ${ids.length} stories - refusing to report a truncated run`,
		);
	}
	const report = {
		origin: ORIGIN,
		mode: RELOAD ? "reload" : "in-place",
		theme: THEME,
		viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
		capturedAt: new Date().toISOString(),
		elapsedSeconds: elapsedS,
		summary,
		stories,
	};
	if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
	if (AS_JSON) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log("\nsummary");
		console.log(JSON.stringify(summary, null, 2));
		console.log(
			`scanned ${summary.stories - summary.unrendered.length}/${summary.stories} stories in ${elapsedS}s`,
		);
		/* Story health is REPORTED, not asserted: a story that fails to render
		   is storybook's problem (capture-evidence's gates own it) or a real
		   finding for whoever changed it - it is not a cursor value, and a gate
		   that cannot pass on a tree with one broken story is a gate nobody
		   runs. The list stays in the JSON and here. */
		if (summary.unrendered.length > 0) {
			console.log(
				`note: ${summary.unrendered.length} stories did not render (listed above, not asserted): ${summary.unrendered.map((u) => u.id).join(", ")}`,
			);
		}
	}

	if (ASSERT_CLEAN) {
		const problems = [];
		if (summary.interactiveWrong > 0)
			problems.push(
				`${summary.interactiveWrong} interactive elements with the wrong cursor`,
			);
		if (summary.controlLabelWrong > 0)
			problems.push(
				`${summary.controlLabelWrong} choice labels without a pointer`,
			);
		if (summary.textEntryWrong > 0)
			problems.push(
				`${summary.textEntryWrong} text entries claiming a pointer`,
			);
		if (summary.draggableWrong > 0)
			problems.push(
				`${summary.draggableWrong} draggable elements without a grab cursor`,
			);
		if (summary.separatorWrong > 0)
			problems.push(
				`${summary.separatorWrong} separator widgets without a resize cursor`,
			);
		if (problems.length > 0) {
			console.error(`cursor audit failed: ${problems.join("; ")}`);
			process.exitCode = 1;
		}
	}
};

let keepAlive = null;
let watchdog = null;

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => {
		clearInterval(keepAlive);
		clearTimeout(watchdog);
		teardown();
	});
