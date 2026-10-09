/**
 * The shared half of the right-slot-memory rig: one headless Chrome, one page per
 * case, and the page-side readers both drivers use (#894).
 *
 * WHY THIS IS A MODULE AND NOT A COPY IN EACH DRIVER. Two scripts photograph and
 * measure the same surface - `drive-slot.mjs` walks the six cases,
 * `probe-hop.mjs` samples ONE hop frame by frame - and the thing they must not
 * disagree about is what "the slot's occupant" IS. That answer is three readings
 * of one page (which pane is mounted, which rail item is lit, what the store's own
 * verb says), so it is written once here.
 *
 * THE CHROME IS THE RIG'S OWN, launched through the repository's
 * `scripts/chrome-keychain.mjs` switch: a scratch `--user-data-dir` under a
 * scratch `HOME` has no login keychain, so without the mock-keychain switch Chrome
 * asks macOS to CREATE one - a dialog on the operator's screen (AGENTS.md, "A
 * rig's Chrome does not touch the keychain either"). It is launched ONCE and
 * reaped by exact pid, and every case gets its own browser CONTEXT inside it
 * rather than its own browser: the slot's memory is `localStorage`, so a case that
 * shared a profile with the one before it would inherit its memories and
 * photograph a state nobody drove - and a fresh launch per case is the measured
 * fleet problem (152 Chrome profile copies in 14 minutes) this shape avoids.
 *
 * WHICH AXES THE PAGE IS DRIVEN ON. Everything goes through the real app: the
 * conversation is switched by pressing its sidebar row, a pane is opened by
 * pressing its rail item, the asks drawer by pressing its chip. No scene helper
 * writes a store field, so a frame is never a picture of a state only a rig can
 * reach. The one exception is the THEME and the FIRST-RUN SEED, both written to
 * `localStorage` BEFORE the app boots (the mechanism the other live sets use for
 * light frames) - and the frame's own filename names the palette, so a
 * mis-seeded theme fails the evidence guard rather than passing as the wrong one.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";
import { pinnedEvidenceEnv } from "../../../../scripts/evidence-tz.mjs";

export const CHROME =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Chrome announces its own debug port on stderr; module scope so the listener does not rebuild it per chunk. */
export const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The conversations this rig owns, by short name. Twelve lowercase hex, which the `/__desktop/stream` route validates. */
export const SESSION = { A: "aaaa11112222", B: "bbbb11112222" };
export const TITLE = { A: "Deploy checklist", B: "Review notes" };

/** The first-run seed: without it the app boots into the onboarding modal. */
export const ONBOARDING_SEED =
	'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}';

/*
 * ============================ page-side readers ==============================
 *
 * Written as functions and serialised with `.toString()` rather than as template
 * literals: a regex or an escape inside a template literal needs double escaping
 * and fails silently when it is wrong, while a real function is parsed by the same
 * tooling as the rest of these files. They reference nothing outside themselves.
 */

/**
 * THE FIVE OCCUPANTS OF THE SLOT, by the hook each mount carries.
 *
 * `data-tour-tag` is the app's own geometry handle for a slot occupant
 * (`PaneSlot`'s `tourTag`), which is why it is the reading rather than a class:
 * a pane that is open in the store and NOT mounted here is exactly the #868 case
 * ("the claim survives the route; the route cannot draw it"), and only the mount
 * can tell the two apart.
 */
export const PANE_HOOKS = {
	canvas: '[data-tour-tag="canvas-dock"]',
	run: '[data-tour-tag="run-panel-dock"]',
	browser: '[data-tour-tag="browser-pane-slot"]',
	console: '[data-tour-tag="console-pane-slot"]',
	ask: '[data-tour-tag="ask-drawer-slot"]',
};

/** The rail's four doors, in the app's own fixed order. */
export const RAIL_HOOKS = {
	run: '[data-panel-rail-item="run"]',
	browser: '[data-panel-rail-item="browser"]',
	console: '[data-panel-rail-item="console"]',
	canvas: '[data-panel-rail-item="canvas"]',
};

/** The two hook tables the page-side readers are given, as one value (see `HOOKS_SOURCE`). */
export const HOOKS = { panes: PANE_HOOKS, rail: RAIL_HOOKS };

/**
 * The hook tables, spliced into every page-side reader call.
 *
 * A page-side function is serialised with `.toString()`, so it closes over nothing -
 * and writing the two tables out again inside each of them is how the probe and the
 * sampler would come to disagree about which pane is "the canvas". One object,
 * handed to each reader as its argument.
 */
export const HOOKS_SOURCE = JSON.stringify(HOOKS);

/**
 * What the page says right now, as one object.
 *
 * THREE READINGS OF "WHICH PANE IS UP", and they are different claims rather than
 * three spellings of one: `drawn` is what is MOUNTED (the DOM), `rail` is what the
 * app LIGHTS (the rail's own `aria-pressed`), and `flags` is what the STORE holds
 * (the renderer dev driver's own `state()` verb - the app's code, reached through
 * the rig-supplied bridge the way an armed launch's preload reaches it). A frame
 * that shows a pane the store does not claim, or a lit item over an empty slot, is
 * a defect in one of the three, and a probe that read only one of them could not
 * say which.
 *
 * `rightSlotKey` and `rightSlotMemory` are absent on the before arm (`origin/main`
 * has no per-conversation memory), so they are reported as `null`/`absent` rather
 * than zeroed - a claim about a field the tree does not have would be a reading
 * this rig never took.
 */
export const probeSource = (HOOKS) => {
	const q = (selector) => document.querySelector(selector);
	const count = (selector) => document.querySelectorAll(selector).length;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			x: Math.round(r.x),
			y: Math.round(r.y),
			w: Math.round(r.width),
			h: Math.round(r.height),
		};
	};
	const PANES = HOOKS.panes;
	const RAIL = HOOKS.rail;
	const drawn = [];
	const slotBox = {};
	for (const [name, hook] of Object.entries(PANES)) {
		const el = q(hook);
		if (el) {
			drawn.push(name);
			slotBox[name] = rect(el);
		}
	}
	/*
	 * HOW MUCH OF THE CONVERSATION THE MOUNTED PANE SITS OVER, in CSS pixels: the
	 * horizontal intersection of the column and the pane. It is the number a claim
	 * about "covered" has to be stated in - the app's own `data-canvas-mode` names the
	 * SHAPE (`docked`/`overlay`), and at these widths the two do not coincide: at
	 * 1024x900 the canvas is `docked` at 444px while the column keeps its 480px
	 * minimum, and at 800x600 the app says `overlay` while the same 480px floor leaves
	 * the canvas 220px beside it. Both numbers are reported, because either alone can
	 * be read as saying something it does not.
	 */
	const columnBox = rect(q('[data-tour-tag="chat-column"]'));
	const overlap = (() => {
		if (!columnBox) return null;
		return Object.fromEntries(
			Object.entries(slotBox).map(([name, box]) => [
				name,
				Math.max(
					0,
					Math.min(box.x + box.w, columnBox.x + columnBox.w) -
						Math.max(box.x, columnBox.x),
				),
			]),
		);
	})();
	const rail = {};
	for (const [name, hook] of Object.entries(RAIL)) {
		const el = q(hook);
		rail[name] = el ? el.getAttribute("aria-pressed") : null;
	}
	const lit = Object.entries(rail)
		.filter(([, pressed]) => pressed === "true")
		.map(([name]) => name);
	/*
	 * THE RENDERER DEV DRIVER'S OWN VERB, or a stated absence. In an armed Electron
	 * launch the preload publishes `window.__loDevDriver`; this rig supplies the same
	 * contract for a browser page (`slot-rig.vite.mjs`), and the VERBS are the app's
	 * own (`src/renderer/src/dev-driver/install.ts`).
	 */
	let state = null;
	try {
		state = window.__loDevDriver?.call?.("state") ?? null;
	} catch (error) {
		state = { error: String(error) };
	}
	const composer = q('textarea[aria-label="Message"]');
	const active = document.activeElement;
	const prefs = (() => {
		try {
			return localStorage.getItem("ui-preferences-storage");
		} catch (error) {
			return null;
		}
	})();
	return {
		href: location.href,
		hash: location.hash,
		zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		viewport: { w: innerWidth, h: innerHeight },
		overflowX:
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
		drawn,
		slotBox,
		/* The conversation's own column, by the marker the shell hands its route. */
		/*
	 * THE CONVERSATION COLUMN. `chat-content.tsx` names the three boxes its own
	 * layout argument is written about (`data-tour-tag="pane-row"`, this one, and
	 * whichever pane occupies the slot beside it), so the reading is the app's own
	 * handle rather than a class match - the capture meter that walked every element
	 * for a class is what missed the commit that halved this column.
	 */
		column: columnBox,
		overlap,
		paneRow: rect(q('[data-tour-tag="pane-row"]')),
		rail,
		railLit: lit,
		railPresent: Object.values(rail).filter((v) => v !== null).length,
		composer: composer
			? { ...rect(composer), value: composer.value }
			: null,
		active: active
			? {
					tag: active.tagName,
					label: active.getAttribute("aria-label"),
					text: (active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
				}
			: null,
		ask: {
			slot: count('[data-tour-tag="ask-drawer-slot"]'),
			drawer: count('[data-ask-drawer="session"]'),
			close: count('[aria-label="Close asks"]'),
			chip: count("[data-lo-ask-item-toggle]"),
			chipExpanded: q("[data-lo-ask-item-toggle]")?.getAttribute("aria-expanded") ?? null,
			header: count('[data-tour-tag="ask-pane-trigger"]'),
		},
		draft: {
			draftRows: count("[data-draft-row]"),
			chatRows: count("[data-session-row]"),
		},
		/* The persisted preferences blob: its byte length is the memory's own size on disk. */
		prefsBytes: prefs === null ? null : prefs.length,
		state,
	};
};

/**
 * THE MEMORY, READ OFF THE APP'S OWN VERB rather than inferred from a frame.
 *
 * `rightSlotKey` is the identity the slot is bound to; `rightSlotMemory` is the
 * `[key, pane]` pairs newest last. On a tree without the feature both fields are
 * absent, and the reading says so instead of reporting "no memory" as if it were
 * a measurement of the same thing.
 */
export const memorySource = () => {
	const state = window.__loDevDriver?.call?.("state") ?? {};
	const memory = state.rightSlotMemory;
	return {
		rightSlotKey: state.rightSlotKey ?? null,
		rightSlotKeyAbsent: !("rightSlotKey" in state),
		rightSlotMemory: Array.isArray(memory)
			? memory.map(([key, pane]) => key + ":" + pane)
			: null,
		rightSlotMemoryAbsent: !("rightSlotMemory" in state),
		flags: {
			canvas: state.canvasOpen ?? null,
			run: state.runPanelOpen ?? null,
			browser: state.browserPaneOpen ?? null,
			console: state.consolePaneOpen ?? null,
			ask: state.isAskDrawerOpen ?? null,
		},
		/*
		 * WHICH OF THE FIVE THE VERB DOES NOT CARRY. `state()` exposes the three durable
		 * flags plus the slot's key and memory; `consolePaneOpen` and `isAskDrawerOpen`
		 * are NOT in it on either arm, so their `null` above is "the verb has no such
		 * field" rather than "the pane is not open". Those two are read from the DOM
		 * instead (`probe().drawn` and `probe().ask`), which is why the report carries
		 * both readings and says which is which.
		 */
		flagsAbsentFromVerb: ["canvasOpen", "runPanelOpen", "browserPaneOpen", "consolePaneOpen", "isAskDrawerOpen"].filter(
			(name) => !(name in state),
		),
		activeSessionId: state.activeSessionId ?? null,
		activeDraftKey: state.activeDraftKey ?? null,
	};
};

/**
 * ONE MARK PER ANIMATION FRAME for `durationMs`: the frame-accurate record of a
 * change of occupant.
 *
 * WHY A BURST AND NOT A STILL. The claim these cases make is "the occupant changes
 * in the same frame the transcript does", and a single still cannot carry it - it
 * would show the end state and nothing about whether an intermediate frame held
 * the wrong pane. One mark per rAF means a frame that briefly painted the other
 * conversation's pane is a TICK, not an inference - which is how the asks lane
 * established its own close's bound (`ask-drawer-stuck/harness/probe-switch-flash.mjs`).
 *
 * The marks are read INSIDE the page (the bridge's `call` is synchronous), so no
 * tick costs a CDP round trip: a 2s burst is ~120 marks, not ~120 requests.
 */
export const samplerSource = (HOOKS, durationMs) => {
	const q = (selector) => document.querySelector(selector);
	const PANES = HOOKS.panes;
	const RAIL = HOOKS.rail;
	const S = { t0: performance.now(), marks: [] };
	window.__timeline = S;
	const tick = () => {
		const drawn = Object.entries(PANES)
			.filter(([, hook]) => q(hook))
			.map(([name]) => name);
		const lit = Object.entries(RAIL)
			.filter(([, hook]) => q(hook)?.getAttribute("aria-pressed") === "true")
			.map(([name]) => name);
		let state = {};
		try {
			state = window.__loDevDriver?.call?.("state") ?? {};
		} catch (error) {
			state = {};
		}
		const slot = drawn.length
			? q(PANES[drawn[0]]).getBoundingClientRect()
			: null;
		const column = q('[data-tour-tag="chat-column"]')?.getBoundingClientRect() ?? null;
		const active = document.activeElement;
		S.marks.push({
			t: Math.round(performance.now() - S.t0),
			hash: location.hash.replace("#/chat/", ""),
			drawn: drawn.join("+"),
			lit: lit.join("+"),
			slotW: slot ? Math.round(slot.width) : null,
			colW: column ? Math.round(column.width) : null,
			key: state.rightSlotKey ?? null,
			mem: Array.isArray(state.rightSlotMemory)
				? state.rightSlotMemory.map(([k, p]) => k + ":" + p).join(",")
				: null,
			flags:
				(state.canvasOpen ? "C" : "") +
				(state.runPanelOpen ? "R" : "") +
				(state.browserPaneOpen ? "B" : "") +
				(state.consolePaneOpen ? "c" : "") +
				(state.isAskDrawerOpen ? "a" : ""),
			active: active
				? `${active.tagName}${active.getAttribute("aria-label") ? "[" + active.getAttribute("aria-label") + "]" : ""}`
				: null,
		});
		if (performance.now() - S.t0 < durationMs) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};

/** The generic "press this selector" target: rect plus a hit test at its centre. */
export const targetSource = (selector) => {
	const el = document.querySelector(selector);
	if (!el) return null;
	el.scrollIntoView({ block: "center" });
	const r = el.getBoundingClientRect();
	const x = Math.round(r.left + r.width / 2);
	const y = Math.round(r.top + r.height / 2);
	const hit = document.elementFromPoint(x, y);
	return {
		x,
		y,
		text: (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
		hittable: Boolean(hit && (el === hit || el.contains(hit))),
	};
};

/** A sidebar conversation row, scrolled into view and hit-tested at its centre. */
export const sessionRowSource = (sessionId) => {
	const row =
		document.querySelector(`[data-session-row="${sessionId}"] [data-chat-row]`) ??
		document.querySelector(`[data-session-row="${sessionId}"]`);
	if (!row) return null;
	row.scrollIntoView({ block: "center" });
	const r = row.getBoundingClientRect();
	const x = Math.round(r.left + r.width / 2);
	const y = Math.round(r.top + r.height / 2);
	const hit = document.elementFromPoint(x, y);
	return {
		x,
		y,
		text: (row.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
		hittable: Boolean(hit && (row === hit || row.contains(hit))),
	};
};

/**
 * The sidebar's `New chat` row: the draft's own door.
 *
 * Found by the app's OWN hook, `[data-new-chat-row]` (`sidebar-navigation.tsx`
 * writes it beside the `nav-item-chat` tour tag) rather than by its label: the
 * label carries the platform's chord (`New chat ⌘ N`), which is copy, and the
 * asks lane's rig found the same element the same way.
 */
export const newChatSource = () => {
	const row = document.querySelector("[data-new-chat-row]");
	if (!row) return null;
	row.scrollIntoView({ block: "center" });
	const r = row.getBoundingClientRect();
	const x = Math.round(r.left + r.width / 2);
	const y = Math.round(r.top + r.height / 2);
	const hit = document.elementFromPoint(x, y);
	return {
		x,
		y,
		text: (row.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
		disabled: row.disabled === true,
		hittable: Boolean(hit && (row === hit || row.contains(hit))),
	};
};

/* ============================ the mechanics ================================ */

/** Launch ONE headless Chrome for the whole run; the mock-keychain switch is the rig's, not Chrome's. */
export function launchChrome({ profile }) {
	return spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${profile}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
		/*
		 * The zone is pinned (`scripts/evidence-tz.mjs`, America/New_York): these frames
		 * print the transcript's clock time, and a frame in the host's own zone diffs
		 * against a re-shoot elsewhere as a fake rendering change. The page reports the
		 * zone it ran in (`probe.zone`), so the claim is read back rather than trusted.
		 */
		{ env: pinnedEvidenceEnv(process.env) },
	);
}

/** Connect to Chrome's own debug port, announced on its stderr. */
export async function connect(chrome) {
	const wsUrl = await new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (chunk) => {
			buffer += chunk.toString();
			const match = buffer.match(DEVTOOLS_URL);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
	});
	const browser = new WebSocket(wsUrl);
	await new Promise((resolve) => {
		browser.onopen = resolve;
	});
	let nextId = 1;
	const pending = new Map();
	browser.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error
				? reject(new Error(JSON.stringify(msg.error)))
				: resolve(msg.result);
		}
	};
	const raw = (method, params, sessionId) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			browser.send(
				JSON.stringify({
					id,
					method,
					params: params ?? {},
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	return { raw, close: () => raw("Browser.close") };
}

/**
 * A page in a fresh browser context, with the injected readers armed BEFORE the
 * app boots. Everything a case needs hangs off the returned object.
 */
export async function openPage(raw, { outDir, arm, sampler = false, storage = {}, viewport = { width: 1380, height: 900 }, theme = "localOperatorDark", url, timeout = 30_000 } = {}) {
	const { browserContextId } = await raw("Target.createBrowserContext", {});
	const { targetId } = await raw("Target.createTarget", {
		url: "about:blank",
		browserContextId,
	});
	const { sessionId } = await raw("Target.attachToTarget", {
		targetId,
		flatten: true,
	});
	const send = (method, params = {}) => raw(method, params, sessionId);
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: viewport.width,
		height: viewport.height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	const armScript = (source) =>
		send("Page.addScriptToEvaluateOnNewDocument", { source });
	await armScript(ONBOARDING_SEED);
	if (sampler)
		await armScript(`(${samplerSource.toString()})(${HOOKS_SOURCE}, ${sampler})`);
	/*
	 * Dark is the app's default, so it is NOT seeded: the dark frames are what a
	 * first-run user sees. Light is seeded the way the other live sets seed it,
	 * through the preferences store's own key. The frame's file name IS its palette:
	 * the evidence guard judges a frame against the palette its stem names, so a
	 * mis-seeded theme fails the guard rather than passing as the wrong one.
	 */
	if (theme !== "localOperatorDark") {
		await armScript(
			`try { localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch (error) {}`,
		);
	}
	for (const [key, value] of Object.entries(storage)) {
		await armScript(
			`try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}); } catch (error) {}`,
		);
	}

	const page = {
		arm,
		theme,
		sessionId,
		send,
		async evaluate(expression) {
			const res = await send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (res.exceptionDetails) {
				throw new Error(
					res.exceptionDetails.exception?.description ?? "page error",
				);
			}
			return res.result.value;
		},
		call(fn, ...fnArgs) {
			return page.evaluate(`(${fn.toString()})(...${JSON.stringify(fnArgs)})`);
		},
		async waitFor(expression, label, timeoutMs = timeout) {
			const start = Date.now();
			for (;;) {
				if (await page.evaluate(expression)) return true;
				if (Date.now() - start > timeoutMs) {
					throw new Error(`timed out waiting for ${label}`);
				}
				await wait(120);
			}
		},
		probe: () => page.evaluate(`(${probeSource.toString()})(${HOOKS_SOURCE})`),
		memory: () => page.call(memorySource),
		async click(x, y) {
			for (const [type, extra] of [
				["mouseMoved", { button: "none" }],
				["mousePressed", { button: "left", clickCount: 1 }],
				["mouseReleased", { button: "left", clickCount: 1 }],
			]) {
				await send("Input.dispatchMouseEvent", { type, x, y, ...extra });
			}
		},
		/** Press a selector the way a user does: scroll to it, hit-test its centre, click. */
		async press(selector, label = selector) {
			const target = await page.call(targetSource, selector);
			if (!target) throw new Error(`no ${label} on the page`);
			if (!target.hittable)
				throw new Error(`${label} is not hittable at its centre`);
			await page.click(target.x, target.y);
			return target;
		},
		/** Press a sidebar conversation row (the way a user switches conversations). */
		async pressRow(key) {
			/*
			 * THE ROW IS WAITED FOR, not assumed present: the sidebar paints its list
			 * once the sessions query answers, so a press issued on the composer's
			 * readiness alone can arrive before any `[data-session-row]` exists (measured:
			 * this is what failed `s6`'s hop while the identical `s1` hop passed).
			 */
			await page.waitFor(
				`document.querySelector(${JSON.stringify(`[data-session-row="${SESSION[key]}"]`)}) !== null`,
				`the ${TITLE[key]} sidebar row`,
			);
			const row = await page.call(sessionRowSource, SESSION[key]);
			if (!row) throw new Error(`no sidebar row for ${TITLE[key]}`);
			if (!row.hittable) throw new Error(`the ${TITLE[key]} row is not hittable`);
			await page.click(row.x, row.y);
			await page.waitFor(
				`location.hash.includes(${JSON.stringify(SESSION[key])})`,
				`the switch to ${TITLE[key]}`,
			);
			return row;
		},
		/** Press one of the rail's four items (the way a user opens a pane). */
		async pressRail(id) {
			return page.press(`[data-panel-rail-item="${id}"]`, `the ${id} rail item`);
		},
		/** Press the sidebar's `New chat` row (the draft's own door). */
		async pressNewChat() {
			const row = await page.call(newChatSource);
			if (!row) throw new Error("no New chat row on the page");
			if (row.disabled) throw new Error("the New chat row is disabled");
			if (!row.hittable) throw new Error("the New chat row is not hittable");
			await page.click(row.x, row.y);
			await page.waitFor(
				`location.hash === "#/chat" || location.hash.startsWith("#/chat?")`,
				"the draft route",
			);
			return row;
		},
		/** Press the composer's asks chip (the hand-opened drawer's own door). */
		async pressAskChip() {
			return page.press(
				'[data-lo-ask-item-toggle]',
				"the asks chip",
			);
		},
		/**
		 * Press the sidebar's `Search (⌘P) — chats (⌘K)` row, filter to one conversation
		 * by its title, and press Enter: the hop a user makes when the sidebar is not on
		 * screen.
		 *
		 * WHY THIS EXISTS AS WELL AS `pressRow`. At a narrow width a docked canvas makes
		 * the sidebar YIELD to its icon rail (measured: 1024x900 with the canvas open
		 * leaves `nav` absent and no `[data-session-row]` at all), so the row press has
		 * nothing to press. The palette is the app's own door for exactly that state -
		 * the rail's Search row carries the chord in its accessible name - and this
		 * drives it the way a user does: open, type the conversation's title, Enter.
		 */
		async pressPaletteChat(key) {
			await page.press(
				"[data-command-palette-trigger]",
				"the command palette's own trigger",
			);
			await page.waitFor(
				`document.querySelector('[role="dialog"]') !== null`,
				"the command palette",
			);
			await page.type(TITLE[key]);
			/*
			 * WAIT FOR THE FILTER TO HAVE BEEN APPLIED, not for the title to appear:
			 * every chat is listed BEFORE anything is typed, so an inner-text wait is
			 * satisfied by the unfiltered list and hands Enter the wrong row (measured:
			 * `s5a` timed out on this while the same hop passed by luck elsewhere).
			 */
			await page.waitFor(
				`document.querySelector('[role="dialog"] input')?.value === ${JSON.stringify(TITLE[key])}`,
				"the palette's filter to take the title",
			);
			await wait(400);
			await page.key("Enter", "Enter", 13, "\r");
			await page.waitFor(
				`location.hash.includes(${JSON.stringify(SESSION[key])})`,
				`the switch to ${TITLE[key]}`,
			);
		},
		/** The store's own `state()` verb, through the rig's bridge. */
		callDevState: () =>
			page.evaluate("window.__loDevDriver.call('state')"),
		/** Navigate to a route and wait for the composer (the conversation is up). */
		async open(path = "") {
			await page.navigate(path);
			await page.waitFor(
				`document.querySelector('textarea[aria-label="Message"]') !== null`,
				"the composer",
			);
		},
		async type(text) {
			await send("Input.insertText", { text });
		},
		async key(name, code, vk, text) {
			await send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key: name,
				code,
				windowsVirtualKeyCode: vk,
				...(text ? { text, unmodifiedText: text } : {}),
			});
			await send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key: name,
				code,
				windowsVirtualKeyCode: vk,
			});
		},
		async shot(name, label = name) {
			const { data } = await send("Page.captureScreenshot", { format: "png" });
			const dir = join(outDir, label, arm);
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${theme}.webp`);
			await sharp(Buffer.from(data, "base64"))
				.webp({ quality: 92 })
				.toFile(file);
			return `${label}/${arm}/${theme}.webp`;
		},
		startSampler: (ms) => page.evaluate(`(${samplerSource.toString()})(${HOOKS_SOURCE}, ${ms})`),
		async timeline() {
			const S = await page.evaluate("window.__timeline");
			return S?.marks ?? [];
		},
		async close() {
			await raw("Target.closeTarget", { targetId });
			await raw("Target.disposeBrowserContext", { browserContextId });
		},
		/** Navigate this page to the app at a conversation (or the bare shell). */
		async navigate(path = "") {
			await send("Page.navigate", { url: `${url}${path}` });
		},
		async reload() {
			await send("Page.reload", { ignoreCache: false });
		},
	};
	return page;
}

/**
 * Wait for the admitted conversation's FIRST assistant turn to land on disk.
 *
 * WHY THE TRANSCRIPT AND NOT A SENTENCE. The conversation a New-chat draft is
 * admitted as is hosted by the rig's own ROUTES process (the daemon is what
 * answers the create), so its turn is the INSTALLED RUNTIME's `mock` provider -
 * not this rig's stub. Waiting for a literal reply would be waiting for one
 * generation's mock copy; waiting for the transcript to hold an assistant message
 * is waiting for the same fact without borrowing the text.
 */
export async function waitForAssistantTurn(scratch, sessionId, timeoutMs = 30_000) {
	const file = join(scratch, "config", "sessions", sessionId, "transcript.jsonl");
	const started = Date.now();
	for (;;) {
		if (existsSync(file)) {
			const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const row = JSON.parse(line);
					if (
						row?.type === "message" &&
						row?.payload?.role === "assistant"
					)
						return { lines: lines.length, waitedMs: Date.now() - started };
				} catch {
					/* a half-written line is not a verdict */
				}
			}
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(`no assistant turn landed for ${sessionId}`);
		await wait(150);
	}
}

/** Where a case's screenshots go, under the run's own output directory. */
export const outPath = (...parts) => join(...parts);

/**
 * The driver's side channel to ONE owner process: a JSON file dropped where that
 * owner's loop is looking (`serve-slot.py`'s `run_commands`).
 *
 * The answer lands as `<name>.done.json`, and a refused command is a THROW rather
 * than a silent no-op, because every caller's next step reads the state the command
 * was supposed to produce.
 */
export async function command(scratch, sessionId, body, seqRef) {
	const dir = join(scratch, "cmd", sessionId);
	mkdirSync(dir, { recursive: true });
	seqRef.n += 1;
	const name = `${String(seqRef.n).padStart(4, "0")}`;
	writeFileSync(join(dir, `${name}.tmp`), JSON.stringify(body));
	renameSync(join(dir, `${name}.tmp`), join(dir, `${name}.json`));
	const done = join(dir, `${name}.done.json`);
	for (let i = 0; i < 150; i += 1) {
		if (existsSync(done)) {
			const result = JSON.parse(readFileSync(done, "utf8"));
			rmSync(done, { force: true });
			if (!result.ok)
				throw new Error(`owner refused ${body.op}: ${result.error}`);
			return result;
		}
		await wait(100);
	}
	throw new Error(`owner ${sessionId} never answered ${body.op}`);
}

/** The ask log's event kinds and the transcript's length, read from disk: the side effects. */
export function backendReading(scratch, sessionId, needle) {
	const dir = join(scratch, "config", "sessions", sessionId);
	const lines = (file) =>
		existsSync(join(dir, file))
			? readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean)
			: [];
	const kinds = lines("asks.jsonl").map((line) => {
		try {
			return JSON.parse(line).kind ?? "?";
		} catch {
			return "unparsed";
		}
	});
	const transcript = lines("transcript.jsonl");
	return {
		askEventKinds: kinds,
		transcriptLines: transcript.length,
		transcriptHasMessage: needle
			? transcript.some((line) => line.includes(needle))
			: null,
	};
}

/** Every conversation directory the backend has, so a report can name what admission CREATED. */
export function backendSessions(scratch) {
	const dir = join(scratch, "config", "sessions");
	if (!existsSync(dir)) return [];
	/*
	 * SESSION DIRECTORIES ONLY, by the id's own shape. The config root holds other
	 * entries of its own (`.local-operator-store` among them), and a bare `readdir`
	 * handed one of those to the driver as "the conversation the admission created" -
	 * which is how this set's first draft-admission run came to wait for an assistant
	 * turn in a store directory.
	 */
	return readdirSyncSafe(dir).filter((name) => /^[0-9a-f]{12}$/.test(name));
}

function readdirSyncSafe(dir) {
	try {
		return readdirSync(dir).sort();
	} catch (error) {
		return [];
	}
}

/** The rig's own scratch root for a run, and Chrome's profile inside it. */
export const makeProfile = () =>
	mkdtempSync(join(process.env.RIG_TMP ?? tmpdir(), "slot-rig-chrome-"));

/** The trajectory a report's frames are read against: a lane of marks, as a table. */
export const SAMPLER_COLUMNS = ["t", "hash", "drawn", "lit", "slotW", "colW", "flags", "key", "mem"];

export function summariseTimeline(marks) {
	if (!marks || marks.length === 0) return { framesSampled: 0, marks: [] };
	/*
	 * A mark is KEPT when any of the readings a claim is about moved, plus the first
	 * and last: the burst is what makes a transient visible, and 120 identical rows
	 * make the one that differs invisible in a report.
	 */
	const keys = SAMPLER_COLUMNS.filter((c) => c !== "t");
	const out = [];
	let last = null;
	for (const mark of marks) {
		const signature = keys.map((k) => String(mark[k])).join("|");
		if (signature !== last) {
			out.push(mark);
			last = signature;
		}
	}
	return {
		framesSampled: marks.length,
		changes: out.length,
		marks: out,
	};
}

/** How many sampled frames carried a reading, by a predicate over a mark. */
export const countMarks = (marks, predicate) => marks.filter(predicate).length;

export { spawn, spawnSync, sharp };
