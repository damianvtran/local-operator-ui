/**
 * `--scene diff-history`: the full-diff pager, walked in the BUILT app.
 *
 *     node scripts/renderer-driver.mjs --scene diff-history --backend <url> \
 *       --backend-records <file> --session <12 lowercase hex> --out <dir> \
 *       [--child <job id>] [--handshake] [--live-session <12 lowercase hex>] \
 *       [--diff-expect '<json>']
 *
 * WHY THIS EXISTS. The pager (`diff-history.tsx`) is covered by model and
 * contract tests, and bare Vite cannot mount `App` without the preload bridge,
 * so nothing had pressed its controls in the real renderer. This scene composes
 * ONLY the existing verbs (`hello`, `navigate`, `press`, and `queries` on the
 * no-offer failure path) plus `capture`, DOM reads and scene-level CDP input
 * (`Input.dispatchMouseEvent` wheel, as the `palette` scene drives CDP input):
 * no new verb, no state written into React, no synthetic page. The history it
 * pages is whatever the seeded session's daemon serves.
 *
 * MODES.
 * - default: the parent session's Edited row, paged, closed, reopened on the
 *   SAME call, then re-navigated (a route round-trip, NOT a cold replay).
 * - `--child <job id>`: the operator's case. The Run panel trigger, the
 *   subagent's row (`[data-run-panel-row=<job id>]`, run-panel.tsx), then the
 *   contained child reader (`[data-run-panel-pane]`): its Edited row paged with
 *   the D1 sticky-nav scroll, then every Wrote row: an archived one is paged to
 *   its last page, an oversized one must state its note and offer no View full.
 * - `--handshake`: QA acts mid-run. The scene writes `<out>/ready-<step>` and
 *   waits (bounded, HANDSHAKE_MS) for QA's `<out>/go-<step>`. Steps, in order:
 *   `error-stop` (QA stops the backend; the scene presses Next and asserts the
 *   error + Retry), `error-restart` (QA restarts it; Retry must load the next
 *   page), then `live` (with `--live-session`: QA posts the turn; the new rows
 *   must appear without a reload and page).
 * - `--diff-expect`: the fixture's ground truth (display-row totals, final row
 *   text), so a page is checked against the fixture, not the UI's own numbers.
 *
 * WHAT IT CANNOT SEE, stated rather than implied. Empty and evicted states are
 * not reachable from these fixtures. A fixture with no pageable diff row FAILS
 * the scene; it never passes vacuously. Labels are matched in English.
 */
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The contract's `sessionIdPattern` (`src/shared/desktop-contract.ts`). */
export const SESSION_ID = /^[a-f0-9]{12}$/;
/** How long a handshake step waits for QA's go file. */
export const HANDSHAKE_MS = 120_000;
/** The parent chat's transcript, and the child reader's inside the Run panel. */
export const PARENT_SCOPE = "[data-lo-canonical-transcript]";
export const CHILD_SCOPE =
	"[data-run-panel-pane] [data-lo-canonical-transcript]";
export const HANDSHAKE_STEPS = ["error-stop", "error-restart", "live"];

const EXPECT_KEYS = ["edit", "write", "liveEdit", "liveWrite"];

/** `--diff-expect` JSON: `{edit|write|liveEdit|liveWrite: {total, last?}, oversized?}`. */
export function parseDiffExpect(text) {
	if (text === null || text === undefined) return { value: null };
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return { error: "--diff-expect is not JSON" };
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		return { error: "--diff-expect must be a JSON object" };
	const value = {};
	for (const [key, entry] of Object.entries(raw)) {
		if (key === "oversized") {
			if (typeof entry !== "boolean")
				return { error: "--diff-expect.oversized must be a boolean" };
			value.oversized = entry;
		} else if (!EXPECT_KEYS.includes(key)) {
			return { error: `--diff-expect: unknown key ${JSON.stringify(key)}` };
		} else if (
			!entry ||
			!Number.isInteger(entry.total) ||
			entry.total <= 0 ||
			(entry.last !== undefined && typeof entry.last !== "string")
		) {
			return {
				error: `--diff-expect.${key} needs {total: positive integer, last?: string}`,
			};
		} else value[key] = { total: entry.total, last: entry.last ?? null };
	}
	return { value };
}

/** Refusal text for a run that cannot prove anything, or null when it can. */
export function diffHistorySceneRefusal({
	backend,
	backendRecords,
	session,
	child = null,
	liveSession = null,
	handshake = false,
	expect = null,
}) {
	if (backend === null)
		return "--scene diff-history needs --backend: the pager reads the archived diff from a live daemon's scoped diff route";
	if (backendRecords === null)
		return "--scene diff-history needs --backend-records: without the daemon's own record discovery does not admit it";
	if (session === null || !SESSION_ID.test(session))
		return `--scene diff-history needs --session <12 lowercase hex>: got ${JSON.stringify(session)}`;
	if (child !== null && !SESSION_ID.test(child))
		return `--child needs the subagent's job id (12 lowercase hex), as the Run panel row carries it: got ${JSON.stringify(child)}`;
	if (liveSession !== null && !SESSION_ID.test(liveSession))
		return `--live-session needs <12 lowercase hex>: got ${JSON.stringify(liveSession)}`;
	if (liveSession !== null && !handshake)
		return "--live-session needs --handshake: the live step waits for QA to post the turn";
	if (liveSession !== null && liveSession === session)
		return "--live-session must differ from --session: the live step needs a session with no rows yet";
	const parsed = parseDiffExpect(expect);
	if (parsed.error) return parsed.error;
	// Only the child walk pages Wrote rows and looks for the oversized note: in
	// parent mode these fields would be accepted and never asserted (R9).
	if (
		child === null &&
		(parsed.value?.write !== undefined || parsed.value?.oversized !== undefined)
	)
		return "--diff-expect.write and .oversized need --child: only the child walk asserts them";
	return null;
}

const viewFullIn = (root) => `${root} [data-diff-view-full]`;
const pagerIn = (root) => `${root} [data-diff-history]`;
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;

/** One reading of a pager as painted: range, status, rows, inks, geometry, focus. */
export const readPager = (root) => `(() => {
	const root = ${q(pagerIn(root))};
	if (!root) return { open: false, viewFull: document.querySelectorAll(${JSON.stringify(viewFullIn(root))}).length };
	const rows = [...root.querySelectorAll("[data-diff-line]")];
	const ink = (el) => el.classList.contains("text-success") ? "added" : el.classList.contains("text-danger") ? "removed" : "other";
	const signs = { added: 0, removed: 0, addedBadSign: 0, removedBadSign: 0 };
	for (const el of rows) {
		const kind = ink(el); const first = (el.firstChild?.textContent ?? "")[0];
		if (kind === "added") { signs.added += 1; if (first !== "+") signs.addedBadSign += 1; }
		if (kind === "removed") { signs.removed += 1; if (first !== "-") signs.removedBadSign += 1; }
	}
	const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	const active = document.activeElement;
	return {
		open: true,
		range: root.querySelector("[data-diff-history-range]")?.textContent ?? "",
		status: root.querySelector("[data-diff-history-status]")?.textContent ?? "",
		busy: root.getAttribute("aria-busy"),
		retry: Boolean(root.querySelector(":scope > button")),
		buttons: [...root.querySelectorAll(":scope > nav > button")].map((b) => ({ text: b.textContent, disabled: b.getAttribute("aria-disabled") })),
		nav: box(root.querySelector(":scope > nav")),
		rowCount: rows.length,
		firstRow: rows[0] ? { index: rows[0].getAttribute("data-diff-line"), box: box(rows[0]) } : null,
		head: box(root.querySelector(":scope > [data-diff-hunk-context], :scope > [data-diff-line]")),
		scroller: (() => { const s = root.closest("[data-lo-canonical-transcript]"); return s ? { top: Math.round(s.getBoundingClientRect().top), scrollTop: Math.round(s.scrollTop), min: Math.round(s.clientHeight - s.scrollHeight) } : null; })(),
		lastRow: rows.at(-1) ? { index: rows.at(-1).getAttribute("data-diff-line"), text: rows.at(-1).firstChild?.textContent?.slice(0, 80), box: box(rows.at(-1)) } : null,
		signs,
		zeroBoxes: rows.filter((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || r.height === 0; }).length,
		viewport: { w: innerWidth, h: innerHeight },
		focus: active ? active.tagName.toLowerCase() + (active.textContent ? ":" + active.textContent.slice(0, 40) : "") : null,
	};
})()`;

/**
 * THE REPLAY ORACLE (QA round 5, N9): a pager counts as open only once its
 * range is SET and it is no longer busy. "Loading full diff…" in the status
 * region is not an open pager, so a mid-load frame can never be compared.
 */
export const pagerReady = (root) =>
	`(() => { const p = ${q(pagerIn(root))}; return Boolean(p) && p.getAttribute("aria-busy") !== "true" && Boolean(p.querySelector("[data-diff-history-range]")?.textContent); })()`;

/** The pager's error state: not busy, a status sentence, and its Retry. */
export const pagerErrored = (root) =>
	`(() => { const p = ${q(pagerIn(root))}; return Boolean(p) && p.getAttribute("aria-busy") !== "true" && Boolean(p.querySelector(":scope > button")) && Boolean(p.querySelector("[data-diff-history-status]")?.textContent); })()`;

/* A NEW, non-empty range on a settled pager: a blank range (loading, error) never counts as moved. */
export const rangeMoved = (root, from) =>
	`(() => { const p = ${q(pagerIn(root))}; const r = p?.querySelector("[data-diff-history-range]")?.textContent ?? ""; return Boolean(p) && p.getAttribute("aria-busy") !== "true" && r !== "" && r !== ${JSON.stringify(from)}; })()`;

/** D1: where the pager's last row and nav are, and a wheel point inside the well. */
const scrollGeometry = (root) => `(() => {
	const p = ${q(pagerIn(root))};
	if (!p) return null;
	const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
	const well = rect(p); const rows = p.querySelectorAll("[data-diff-line]");
	const top = Math.max(well.top, 0); const bottom = Math.min(well.bottom, innerHeight);
	const navEl = p.querySelector(":scope > nav");
	const scroller = p.closest("[data-lo-canonical-transcript]");
	// D1: every box between the bar and the transcript scroller that is itself a
	// scroll container (computed hidden/auto/scroll) - sticky would pin to it.
	const scrollBoxes = [];
	for (let el = navEl?.parentElement ?? null; el && el !== scroller; el = el.parentElement) {
		const cs = getComputedStyle(el);
		if ([cs.overflowX, cs.overflowY].some((v) => v === "hidden" || v === "auto" || v === "scroll"))
			scrollBoxes.push({ tag: el.tagName.toLowerCase(), x: cs.overflowX, y: cs.overflowY, cls: String(el.className).slice(0, 80) });
	}
	return { vh: innerHeight, scroller: Boolean(scroller), scrollBoxes, foot: rect(p.querySelector(":scope > [data-diff-history-foot]")), nav: rect(navEl), last: rect(rows[rows.length - 1]), lastIndex: rows[rows.length - 1]?.getAttribute("data-diff-line") ?? null, point: { x: Math.round((well.left + well.right) / 2), y: Math.round(bottom > top ? (top + bottom) / 2 : innerHeight / 2) } };
})()`;

/** A press target's box, for the layout-settle wait (D6). */
const boxOf = (selector) =>
	`(() => { const el = ${q(selector)}; if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); })()`;

/**
 * What the session route painted when no View full diff control appeared.
 * Read-only and bounded: route, title, readiness, and the visible controls'
 * accessible names, roles and geometry. Never input values, innerHTML or
 * attribute dumps. It notes visible transcript text, so it is for the owned
 * synthetic fixtures the QA gate requires (R6-1).
 */
export const noOfferRead = (transcript) => `(() => {
	const cut = (s, n) => (s ?? "").replace(/\\s+/g, " ").trim().slice(0, n);
	const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
	const scope = document.querySelector(${JSON.stringify(transcript)}) ?? document.querySelector("main") ?? document.body;
	const controls = [...scope.querySelectorAll("button, [role=button], summary, a[href], [aria-expanded]")].filter(seen);
	return {
		route: location.hash || location.pathname,
		title: cut(document.title, 80),
		readyState: document.readyState,
		scope: scope.hasAttribute("data-lo-canonical-transcript") ? "transcript" : scope.tagName.toLowerCase(),
		viewFull: document.querySelectorAll("[data-diff-view-full]").length,
		diffRegions: document.querySelectorAll("[data-diff-line], [data-diff-history]").length,
		controlCount: controls.length,
		controls: controls.slice(0, 40).map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), name: cut(el.getAttribute("aria-label") || el.textContent, 60), expanded: el.getAttribute("aria-expanded"), state: el.getAttribute("data-state"), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }),
		text: cut(scope.innerText, 600),
	};
})()`;
/** The parent chat's no-offer read; child mode reads `CHILD_SCOPE` instead. */
export const NO_OFFER_READ = noOfferRead(PARENT_SCOPE);

/**
 * D6 (QA round 6): bring a press target clear of fixed chrome BEFORE the
 * press. If its centre does not hit-test to it where it is (below the
 * reader's foot band, under the header, banner, composer or the
 * scroll-to-bottom button), its nearest scrolling ancestor is moved so the
 * centre lands at a few viewport fractions in turn until it does. Read-only
 * otherwise; a target that already hit-tests is never scrolled.
 */
export const clearForPress = (selector) => `(async () => {
	const el = document.querySelector(${JSON.stringify(selector)});
	if (!el) return { found: false };
	const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	const probe = () => { const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return { ok: h !== null && (h === el || el.contains(h)), y: Math.round(y), hit: h ? h.tagName.toLowerCase() + ":" + (h.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 30) : null }; };
	let seen = probe();
	if (seen.ok) return { found: true, scrolled: false, ...seen };
	let scroller = el.parentElement;
	while (scroller) { const cs = getComputedStyle(scroller); if (/(auto|scroll)/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight) break; scroller = scroller.parentElement; }
	if (!scroller) return { found: true, scrolled: false, ...seen };
	const tried = [];
	for (const f of [0.5, 0.35, 0.65, 0.25, 0.75]) {
		const s = scroller.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		scroller.scrollTop += r.top + r.height / 2 - (s.top + s.height * f);
		await frame();
		seen = probe();
		tried.push(f);
		if (seen.ok) break;
	}
	return { found: true, scrolled: true, tried, ...seen };
})()`;

/**
 * A frame shows the state that was asserted, not the one before it (QA round
 * 6: Run panel frames still showing the chat, a Loading frame for a loaded
 * page). Finite animations finish (bounded), then two frames are painted.
 */
export const PAINT_SETTLED = `(async () => {
	const t0 = performance.now();
	const moving = () => document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming?.().iterations !== Infinity);
	while (performance.now() - t0 < 2000 && moving()) await new Promise((r) => setTimeout(r, 50));
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	return true;
})()`;

/*
 * THE NORMAL STEPS BEFORE A DIFF EXISTS IN THE DOM. A finished run's work is
 * folded by design (`trace-fold.tsx`: the user's preference keeps it collapsed),
 * and a tool row's detail, where the diff block and its View full diff control
 * live, mounts only when that row is opened. Native QA failed waiting for the
 * control on a transcript showing only the collapsed "3 actions" header, so the
 * scene must make the reader's gestures first, through the existing `press`.
 *
 * TWO TIERS, OUTER FIRST. The collapsed "3 actions" header native QA saw is the
 * OUTER `TurnSummary` (turn-summary.tsx: root `[data-turn-summary]`, stamped
 * `data-record-id`/`data-run-ids`, whose `Disclosure` trigger is the root's
 * first `aria-expanded` button), not a `TraceFold`; the work folds live inside
 * it. So the scene opens each closed TurnSummary header, then each closed
 * TraceFold header the open bar revealed.
 *
 * WHY PROGRESS IS THE CLICKED HEADER'S OWN STATE, NOT A COUNT: opening an outer
 * bar mounts its inner folds still closed, so a global "collapsed folds" count
 * stays the same (or grows) after a press that worked. Each press is judged by
 * re-reading the very header it pressed, addressed by its root's stable stamp,
 * flipping to aria-expanded="true".
 *
 * Selectors are derived from the source, never "any button", and every one is
 * prefixed by the transcript SCOPE being walked (the parent chat's, or the
 * child reader's inside the Run panel), so a parent row is never pressed while
 * the child is the subject:
 * - a header is "own" only when its nearest `[data-turn-summary]`/`[data-fold-ids]`
 *   ancestor is its root, so a nested inner header is never taken for the outer;
 * - a TurnSummary is addressed by `[data-turn-summary][data-record-id=..]`
 *   (`data-run-ids` when no anchor), a fold by `[data-fold-ids=..]`; a header is
 *   pressed only when its root selector is unique and the press selector resolves
 *   to exactly that header, else the scene FAILS closed instead of guessing;
 * - a fold's trigger is the `aria-expanded` button holding `[data-fold-summary]`
 *   inside its `[data-fold-ids]` root (trace-fold.tsx);
 * - a tool row's trigger is the `Disclosure` button holding `[data-trace-verb]`
 *   (tool-row.tsx), addressed through its `[data-record-id]` row and only when
 *   that selector resolves to exactly the element read, since `press` takes the
 *   first match. Only rows whose verb reads Edited (red AND green) or Wrote.
 * Every selector demands aria-expanded="false", so an open fold or row is never
 * pressed closed. Counts are bounded; nothing here clicks user content.
 */
export const collapsedFold = (scope) =>
	`${scope} [data-fold-ids] button[aria-expanded="false"]:has([data-fold-summary])`;
export const COLLAPSED_FOLD = collapsedFold(PARENT_SCOPE);
const TOOL_TRIGGER = 'button[aria-expanded="false"]:has([data-trace-verb])';
/** Nearest owning disclosure root of a header: decides "own" vs nested inner. */
const HEADER_OWNER = "[data-turn-summary], [data-fold-ids]";
const TURN_HEADER = "button[aria-expanded]";
const FOLD_HEADER = "button[aria-expanded]:has([data-fold-summary])";
const MAX_FOLD_PRESSES = 4;
const MAX_WRITE_ROWS = 4;

/** Read-only facts about one scope's work controls: counts, verbs, addressable rows. */
export const workRead = (scope) => `(() => {
	const root = document.querySelector(${JSON.stringify(scope)});
	const viewFull = root ? root.querySelectorAll("[data-diff-view-full]").length : 0;
	if (!root) return { transcript: false, viewFull, collapsedFolds: 0, folds: 0, disclosures: [], ambiguous: 0, tools: [] };
	const folds = root.querySelectorAll("[data-fold-ids]").length;
	// Diagnostic only: never the progress signal (see THE NORMAL STEPS above).
	const collapsedFolds = document.querySelectorAll(${JSON.stringify(collapsedFold(scope))}).length;
	const owner = ${JSON.stringify(HEADER_OWNER)};
	const disclosures = [];
	let ambiguous = 0;
	const offer = (kind, el, attr, header) => {
		const b = [...el.querySelectorAll(header)].find((x) => x.closest(owner) === el);
		if (!b || b.getAttribute("aria-expanded") !== "false") return;
		const base = kind === "turn" ? "[data-turn-summary]" : "";
		const rootSel = ${JSON.stringify(`${scope} `)} + base + '[' + attr + '="' + CSS.escape(el.getAttribute(attr) ?? "") + '"]';
		const selector = rootSel + ' ' + header.replace("[aria-expanded]", '[aria-expanded="false"]');
		if (document.querySelectorAll(rootSel).length === 1 && document.querySelector(selector) === b)
			disclosures.push({ kind, root: rootSel, header, selector });
		else ambiguous += 1;
	};
	for (const el of root.querySelectorAll("[data-turn-summary]"))
		offer("turn", el, el.hasAttribute("data-record-id") ? "data-record-id" : "data-run-ids", ${JSON.stringify(TURN_HEADER)});
	for (const el of root.querySelectorAll("[data-fold-ids]"))
		offer("fold", el, "data-fold-ids", ${JSON.stringify(FOLD_HEADER)});
	const tools = [];
	for (const button of root.querySelectorAll(${JSON.stringify(`[data-record-id] ${TOOL_TRIGGER}`)})) {
		const verb = (button.querySelector("[data-trace-verb]")?.textContent ?? "").trim().slice(0, 24);
		if (verb !== "Edited" && verb !== "Wrote") continue;
		const row = button.closest("[data-record-id]");
		const selector = ${JSON.stringify(`${scope} [data-record-id="`)} + CSS.escape(row.getAttribute("data-record-id")) + '"] ' + ${JSON.stringify(TOOL_TRIGGER)};
		if (document.querySelector(selector) === button) tools.push({ verb, selector });
		if (tools.length >= 8) break;
	}
	tools.sort((a, b) => (a.verb === "Edited" ? 0 : 1) - (b.verb === "Edited" ? 0 : 1));
	return { transcript: true, viewFull, folds, collapsedFolds, disclosures, ambiguous, tools };
})()`;
export const WORK_READ = workRead(PARENT_SCOPE);

/** A tool entry's row root: its press selector without the trigger suffix. */
export const rowRootOf = (selector) =>
	selector.endsWith(` ${TOOL_TRIGGER}`)
		? selector.slice(0, -(TOOL_TRIGGER.length + 1))
		: null;

/** Rendered Wrote/Edited counts in a scope, plus the document's identity. */
const verbCounts = (scope) =>
	`(() => { const root = ${q(scope)}; const verbs = root ? [...root.querySelectorAll("[data-trace-verb]")].map((el) => el.textContent.trim()) : []; return { route: location.hash, origin: performance.timeOrigin, wrote: verbs.filter((v) => v === "Wrote").length, edited: verbs.filter((v) => v === "Edited").length, headers: root ? root.querySelectorAll("[data-turn-summary], [data-fold-ids]").length : 0 }; })()`;

/**
 * Whether the header a disclosure entry pressed now reads open: the root's OWN
 * header (nearest owner is the root), never a descendant inner fold's.
 */
export const headerOpened = ({ root, header }) =>
	`(() => { const r = document.querySelector(${JSON.stringify(root)}); if (!r) return false; const b = [...r.querySelectorAll(${JSON.stringify(header)})].find((x) => x.closest(${JSON.stringify(HEADER_OWNER)}) === r); return b?.getAttribute("aria-expanded") === "true"; })()`;

/** "Rows 1–200 of 263" -> numbers, or null. */
export function parseRange(text) {
	const m = /([\d,]+)\D+([\d,]+)\D+([\d,]+)/.exec(text ?? "");
	if (!m) return null;
	const n = (s) => Number(s.replaceAll(",", ""));
	return { first: n(m[1]), last: n(m[2]), total: n(m[3]) };
}

const realFiles = {
	write: (path, text) => writeFile(path, text),
	exists: (path) =>
		access(path).then(
			() => true,
			() => false,
		),
};
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One QA handshake step: write `<out>/ready-<step>`, then wait at most `ms`
 * for `<out>/go-<step>`. A go file that exists BEFORE ready is written is a
 * stale answer from another run and FAILS instead of passing instantly.
 */
export async function awaitHandshake({
	step,
	outDir,
	ms = HANDSHAKE_MS,
	files = realFiles,
	sleep = realSleep,
	now = Date.now,
	check,
	note,
}) {
	const ready = join(outDir, `ready-${step}`);
	const go = join(outDir, `go-${step}`);
	if (await files.exists(go)) {
		check(
			`handshake ${step}: no stale go file before ready`,
			false,
			`${go} already exists`,
		);
		return false;
	}
	await files.write(
		ready,
		`${JSON.stringify({ step, at: new Date(now()).toISOString() })}\n`,
	);
	note(`handshake ${step}`, `wrote ${ready}; waiting up to ${ms}ms for ${go}`);
	const started = now();
	while (now() - started < ms) {
		if (await files.exists(go)) {
			check(
				`handshake ${step}: QA answered`,
				true,
				undefined,
				`${now() - started}ms`,
			);
			return true;
		}
		await sleep(500);
	}
	check(`handshake ${step}: QA answered within ${ms}ms`, false, `no ${go}`);
	return false;
}

export async function sceneDiffHistory({
	cdp,
	verb,
	capture,
	check,
	note,
	waitForCondition,
	factsOf,
	session,
	child = null,
	liveSession = null,
	handshake = false,
	expect = null,
	outDir = null,
	handshakeMs = HANDSHAKE_MS,
	files = realFiles,
	sleep = realSleep,
	now = Date.now,
}) {
	note("diff-history facts", JSON.stringify(await factsOf(cdp)));
	note("diff-history hello", JSON.stringify(await verb(cdp, "hello")));
	const settle = (expr, label, ms = 30_000) =>
		waitForCondition(cdp, expr, ms).then((r) => {
			check(label, r.ok, `last reading: ${JSON.stringify(r.last)}`);
			return r.ok;
		});
	/* Capture once the asserted state is painted (QA round 6 harness note). */
	const shot = async (label, ready = null) => {
		if (ready) await waitForCondition(cdp, ready, 10_000);
		await cdp.evaluate(PAINT_SETTLED);
		return capture(cdp, label);
	};
	const step = (name) =>
		handshake
			? awaitHandshake({
					step: name,
					outDir,
					ms: handshakeMs,
					files,
					sleep,
					now,
					check,
					note,
				})
			: Promise.resolve(false);

	/*
	 * D6: a press is made only once its target's box has stopped moving (two
	 * equal non-empty reads), so `press` hit-tests the painted row rather than
	 * whatever was there mid-layout; the hit test is recorded AND checked.
	 */
	const pressSettled = async (selector, what) => {
		const clear = await cdp.evaluate(clearForPress(selector));
		note(`${what}: clear of chrome`, JSON.stringify(clear));
		let last = null;
		let stable = false;
		for (let i = 0; i < 30 && !stable; i += 1) {
			const box = await cdp.evaluate(boxOf(selector));
			const size = typeof box === "string" ? box.split(",").map(Number) : [];
			const nonEmpty = size[2] > 0 && size[3] > 0;
			stable = nonEmpty && box === last;
			last = box;
			if (!stable) await sleep(100);
		}
		note(`${what}: layout`, JSON.stringify({ settled: stable, box: last }));
		let hit;
		try {
			hit = await verb(cdp, "press", { selector, timeoutMs: 2_000 });
		} catch (error) {
			check(`${what}: takes the press`, false, String(error).slice(0, 200));
			return null;
		}
		note(`press ${what} hit`, JSON.stringify(hit));
		check(
			`${what}: the press hit-tests its own target`,
			hit?.hitTest === true,
			JSON.stringify(hit),
			JSON.stringify({ hitTest: hit?.hitTest }),
		);
		return hit;
	};

	/*
	 * Open folds, then ONE closed row with the wanted verb (or the named row),
	 * and return that row's root. Each press is checked by its own
	 * aria-expanded settling, so a gesture that does nothing is a recorded FAIL.
	 */
	const disclose = async (label, scope, { verb: want, row = null } = {}) => {
		await settle(
			`Boolean(document.querySelector(${JSON.stringify(scope)}))`,
			`${label}: the transcript mounts`,
		);
		const read = workRead(scope);
		const facts = () => cdp.evaluate(read);
		const candidate = (state) =>
			(state.tools ?? []).find((t) =>
				row ? rowRootOf(t.selector) === row : t.verb === want,
			);
		let state = await facts();
		note(`diff-history ${label} work controls`, JSON.stringify(state));
		await shot(`diff-history-${label}-initial`);
		if (row && (await cdp.evaluate(`Boolean(${q(viewFullIn(row))})`)) === true)
			return row;
		// Outer TurnSummary headers come first in the read, then TraceFolds, so an
		// outer bar opens before the inner folds it reveals are pressed.
		for (let i = 0; i < MAX_FOLD_PRESSES && !candidate(state); i += 1) {
			const next = state.disclosures?.[0];
			if (!next) {
				if (state.ambiguous)
					check(
						`${label}: every collapsed work header is uniquely addressable`,
						false,
						JSON.stringify(state),
					);
				break;
			}
			const what = `${label}: ${next.kind === "turn" ? "turn summary" : "work fold"} ${i + 1}`;
			if (!(await pressSettled(next.selector, what))) break;
			if (!(await settle(headerOpened(next), `${what} opens`))) break;
			state = await facts();
		}
		const tool = candidate(state);
		note(`diff-history ${label} after disclosure`, JSON.stringify(state));
		if (!tool) return null;
		const what = `${label}: ${tool.verb} row`;
		if (!(await pressSettled(tool.selector, what))) return null;
		// The row's own trigger, now expanded: the same address with the state flipped.
		const open = `Boolean(document.querySelector(${JSON.stringify(tool.selector.replace('aria-expanded="false"', 'aria-expanded="true"'))}))`;
		if (!(await settle(open, `${what} opens`))) return null;
		return rowRootOf(tool.selector);
	};

	const page = async (root, label, tally) => {
		const state = await cdp.evaluate(readPager(root));
		note(`diff-history ${label}`, JSON.stringify(state));
		check(
			`${label}: added rows paint text-success with "+", removed rows text-danger with "-"`,
			state.signs?.addedBadSign === 0 && state.signs?.removedBadSign === 0,
			JSON.stringify(state.signs),
			JSON.stringify(state.signs),
		);
		check(
			`${label}: every row has painted geometry`,
			state.zeroBoxes === 0,
			JSON.stringify(state),
		);
		/*
		 * U6: the page's first row (its `@@` context or first row) sits directly
		 * under the bar, within 12px. A short page at the very end of the
		 * transcript cannot be lifted further (scrollTop 0 in the reverse
		 * scroller), so there it need only start below the bar and on screen.
		 */
		const bar = state.nav ? state.nav.y + state.nav.h : null;
		const atEnd = Math.abs(state.scroller?.scrollTop ?? 1) <= 1;
		check(
			`${label}: the page's first row sits directly under the pinned bar (U6)`,
			state.head != null &&
				bar !== null &&
				state.nav.y >= (state.scroller?.top ?? 0) - 1 &&
				(Math.abs(state.head.y - bar) <= 12 ||
					(atEnd &&
						state.head.y >= bar - 1 &&
						state.head.y < state.viewport.h)),
			JSON.stringify({
				nav: state.nav,
				head: state.head,
				scroller: state.scroller,
			}),
			JSON.stringify({ navBottom: bar, head: state.head?.y }),
		);
		if (tally && state.signs) {
			tally.added += state.signs.added;
			tally.removed += state.signs.removed;
		}
		await shot(`diff-history-${label}`, pagerReady(root));
		return state;
	};
	const pressNav = async (root, label, what) => {
		const state = await cdp.evaluate(readPager(root));
		const index = state.buttons?.findIndex((b) => b.text === label) ?? -1;
		if (index < 0 || state.buttons[index].disabled === "true") {
			check(
				`${what}: pager offers an enabled "${label}"`,
				false,
				JSON.stringify(state.buttons),
			);
			return null;
		}
		const hit = await pressSettled(
			`${pagerIn(root)} > nav > button:nth-of-type(${index + 1})`,
			`${what} "${label}"`,
		);
		return hit ? state.range : null;
	};
	const openFull = async (root, label) => {
		if (!(await pressSettled(viewFullIn(root), `${label}: View full diff`)))
			return false;
		return settle(
			pagerReady(root),
			`${label}: full diff opens with its range set and not busy`,
		);
	};

	/* D1: wheel inside the well until the page's last row is on screen, then the nav must be too. */
	const stickyNav = async (root, label) => {
		let geometry = null;
		let visible = false;
		let wheels = 0;
		for (let i = 0; i < 40; i += 1) {
			geometry = await cdp.evaluate(scrollGeometry(root));
			if (!geometry?.last) break;
			if (geometry.last.top >= 0 && geometry.last.bottom <= geometry.vh) {
				visible = true;
				break;
			}
			wheels += 1;
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: geometry.point.x,
				y: geometry.point.y,
				deltaX: 0,
				deltaY: 600,
			});
			await sleep(150);
		}
		await shot(`diff-history-${label}-page-first-scrolled`);
		note(`${label}: D1 scroll`, JSON.stringify({ wheels, geometry }));
		check(
			`${label}: the first page's last row scrolls into view inside the page`,
			visible,
			JSON.stringify({ wheels, geometry }),
			JSON.stringify({ wheels, scrolled: wheels > 0 }),
		);
		check(
			`${label}: nothing between the bar and the transcript scroller is a scroll container (D1)`,
			geometry?.scroller === true &&
				Array.isArray(geometry.scrollBoxes) &&
				geometry.scrollBoxes.length === 0,
			JSON.stringify({
				scroller: geometry?.scroller,
				scrollBoxes: geometry?.scrollBoxes,
			}),
			JSON.stringify({ scrollBoxes: geometry?.scrollBoxes?.length ?? null }),
		);
		const nav = geometry?.nav;
		check(
			`${label}: the page nav stays on screen at the page end (D1)`,
			visible && nav !== null && nav?.top >= 0 && nav?.bottom <= geometry.vh,
			JSON.stringify({ nav, vh: geometry?.vh, wheels }),
			JSON.stringify({ nav, vh: geometry?.vh, scrolled: wheels > 0 }),
		);
	};

	/* Error (QA stops then restarts the backend), from the first page. */
	const errorAndRetry = async (root, label, fromRange) => {
		await shot(`diff-history-${label}-error-before`);
		if (!(await step("error-stop"))) return null;
		if ((await pressNav(root, "Next", label)) === null) return null;
		const errored = await settle(
			pagerErrored(root),
			`${label}: Next with the backend stopped shows the error and Retry`,
			60_000,
		);
		note(
			`${label}: error state`,
			JSON.stringify(await cdp.evaluate(readPager(root))),
		);
		await shot(`diff-history-${label}-error`, pagerErrored(root));
		if (!errored) return null;
		if (!(await step("error-restart"))) return null;
		if (!(await pressSettled(`${pagerIn(root)} > button`, `${label}: Retry`)))
			return null;
		if (
			!(await settle(
				rangeMoved(root, fromRange),
				`${label}: Retry loads the next page`,
				60_000,
			))
		)
			return null;
		return page(root, `${label}-page-retried`);
	};

	/*
	 * One call's pager: open, page First/Next/Previous/Last against the
	 * fixture's truth, assert colours by COUNT (R5-1), Back, and reopen the
	 * SAME call (the replay oracle fix).
	 */
	const walkCall = async (
		root,
		{ label, kind, truth = null, d1 = false, error = false },
	) => {
		if (!(await openFull(root, label))) return null;
		const tally = { added: 0, removed: 0 };
		const first = await page(root, `${label}-page-first`, tally);
		const firstRange = parseRange(first.range);
		check(
			`${label}: first page states its range`,
			firstRange !== null,
			JSON.stringify(first),
		);
		if (truth)
			check(
				`${label}: the range total is the fixture's ${truth.total} display rows`,
				firstRange?.total === truth.total,
				JSON.stringify(firstRange),
			);
		if (d1) await stickyNav(root, label);
		let last = first;
		if (firstRange && firstRange.last < firstRange.total) {
			let next = null;
			if (error) next = await errorAndRetry(root, label, first.range);
			else {
				const from = await pressNav(root, "Next", label);
				if (
					from !== null &&
					(await settle(
						rangeMoved(root, from),
						`${label}: Next moves the range`,
					))
				)
					next = await page(root, `${label}-page-next`, tally);
			}
			if (next) {
				if (error && next.signs) {
					tally.added += next.signs.added;
					tally.removed += next.signs.removed;
				}
				check(
					`${label}: Next starts after the first page`,
					parseRange(next.range)?.first === firstRange.last + 1,
					JSON.stringify(parseRange(next.range)),
				);
				const back = await pressNav(root, "Previous", label);
				if (
					back !== null &&
					(await settle(
						rangeMoved(root, back),
						`${label}: Previous moves the range`,
					))
				)
					check(
						`${label}: Previous returns to the first page`,
						parseRange((await page(root, `${label}-page-previous`)).range)
							?.first === firstRange.first,
						"",
					);
			}
			const toLast = await pressNav(root, "Last", label);
			if (
				toLast !== null &&
				(await settle(
					rangeMoved(root, toLast),
					`${label}: Last moves the range`,
				))
			)
				last = await page(root, `${label}-page-last`, tally);
		} else {
			note(
				`${label}: paging`,
				"the diff fits one page: Next/Previous/Last not offered",
			);
			// The handshake's error and Retry proof runs only from a multi-page
			// call; skipping it silently would PASS a run that never tested it (R9).
			if (error)
				check(
					`${label}: handshake error steps need a multi-page call`,
					false,
					JSON.stringify(firstRange),
				);
		}
		const lastRange = parseRange(last.range);
		check(
			`${label}: Last ends on the final row`,
			lastRange !== null && lastRange.last === lastRange.total,
			JSON.stringify({ lastRange, lastRow: last.lastRow }),
		);
		if (truth?.last)
			check(
				`${label}: the final row is the fixture's ${JSON.stringify(truth.last)}`,
				last.lastRow?.text === truth.last,
				JSON.stringify(last.lastRow),
				JSON.stringify(last.lastRow),
			);
		note(`${label}: colour counts`, JSON.stringify(tally));
		check(
			kind === "edit"
				? `${label}: an edit paints both green and red rows (counts)`
				: `${label}: a write paints green rows (counts)`,
			kind === "edit" ? tally.added > 0 && tally.removed > 0 : tally.added > 0,
			JSON.stringify(tally),
			JSON.stringify(tally),
		);
		if ((await pressNav(root, "Back to preview", label)) !== null) {
			await settle(
				`!${q(pagerIn(root))} && Boolean(document.activeElement?.matches(${JSON.stringify(viewFullIn(root))}))`,
				`${label}: Back closes the pager and focus returns to View full diff`,
			);
			await shot(`diff-history-${label}-closed`);
		}
		if (await openFull(root, `${label} reopen`)) {
			const again = await page(root, `${label}-page-reopened`);
			check(
				`${label}: reopening the same call lands on the same first page`,
				again.range === first.range &&
					again.lastRow?.text === first.lastRow?.text,
				JSON.stringify({ again: again.range, first: first.range }),
			);
			await pressNav(root, "Back to preview", `${label} reopen`);
		}
		return first;
	};

	const noOffer = async (scope = PARENT_SCOPE) => {
		// WHY a frame on failure: native QA failed here with nothing to look at.
		// The frame and these read-only facts never mask the missing control:
		// the settle before this already recorded the FAIL.
		await shot("diff-history-no-offer");
		note(
			"diff-history no-offer dom",
			JSON.stringify(await cdp.evaluate(noOfferRead(scope))),
		);
		const queries = await verb(cdp, "queries");
		const list = Array.isArray(queries) ? queries : [];
		note(
			"diff-history no-offer queries",
			JSON.stringify({
				count: list.length,
				notSuccess: list
					.filter((query) => query.status !== "success")
					.slice(0, 20)
					.map((query) => ({
						key: String(query.key).slice(0, 120),
						status: query.status,
						hasData: query.hasData,
					})),
			}),
		);
	};

	/* Every Wrote row in a scope: archived ones are paged, oversized ones noted. */
	const walkWrites = async (scope, label, truth) => {
		const seen = { archived: 0, oversized: 0 };
		for (let i = 0; i < MAX_WRITE_ROWS; i += 1) {
			const row = await disclose(`${label}-${i + 1}`, scope, { verb: "Wrote" });
			if (!row) break;
			await waitForCondition(
				cdp,
				`Boolean(${q(viewFullIn(row))}) || Boolean(${q(`${row} [data-diff-full-notice]`)})`,
				10_000,
			);
			const offer = await cdp.evaluate(
				`({ full: Boolean(${q(viewFullIn(row))}), notice: ${q(`${row} [data-diff-full-notice]`)}?.getAttribute("data-diff-full-notice") ?? null })`,
			);
			note(`${label}-${i + 1}: offer`, JSON.stringify(offer));
			if (offer?.notice) {
				await shot(`diff-history-${label}-${i + 1}-notice`);
				check(
					`${label}-${i + 1}: a ${offer.notice} write states its note and offers no View full`,
					!offer.full,
					JSON.stringify(offer),
					JSON.stringify(offer),
				);
				if (offer.notice === "oversized") seen.oversized += 1;
			} else if (offer?.full) {
				await walkCall(row, {
					label: `${label}-${i + 1}`,
					kind: "write",
					truth,
				});
				seen.archived += 1;
			} else
				check(
					`${label}-${i + 1}: the opened Wrote row shows View full or a note`,
					false,
					JSON.stringify(offer),
				);
		}
		check(
			`${label}: at least one archived Wrote row was paged`,
			seen.archived > 0,
			JSON.stringify(seen),
			JSON.stringify(seen),
		);
		return seen;
	};

	/*
	 * The route round-trip (R5-3: re-navigated, NOT a cold saved replay), for
	 * EVERY walk that pages a call: parent, child reader and live (QA round 7,
	 * Q7-2 — it ran only without `--child`, so the briefed command never
	 * exercised it). `prefix` keeps the parent's check names unchanged.
	 */
	const refound = async (prefix, target, scope, root, first, remount) => {
		await verb(cdp, "navigate", "/chat");
		await verb(cdp, "navigate", `/chat/${target}`);
		const mounted = await remount();
		const tag = prefix
			? `${prefix.replace(/: $/, "")}-renavigated`
			: "renavigated";
		const again = mounted ? await disclose(tag, scope, { row: root }) : null;
		// The regression this step exists for is "the row cannot be re-found
		// after the round-trip": a miss is a FAIL, never a silent skip (R9).
		check(
			`${prefix}re-navigated: the same call's row is found again`,
			first !== null && again !== null,
			JSON.stringify({ first: first?.range ?? null, row: root, again }),
		);
		if (first && again && (await openFull(again, tag))) {
			const state = await page(
				again,
				`${prefix ? `${tag}-` : ""}page-renavigated`,
			);
			check(
				`${prefix}re-navigated: the same call pages the same first page`,
				state.range === first.range &&
					state.lastRow?.text === first.lastRow?.text,
				JSON.stringify({ renavigated: state.range, first: first.range }),
			);
		}
	};

	/** The Run panel, the subagent's row, then its contained reader. */
	const openChildReader = async (again = false) => {
		const tag = again ? "child (re-navigated)" : "child";
		await settle(
			`Boolean(document.querySelector(${JSON.stringify(PARENT_SCOPE)}))`,
			`${tag}: the parent transcript mounts`,
		);
		if (
			!(await pressSettled(
				"[data-run-panel-trigger]",
				`${tag}: Run panel trigger`,
			))
		)
			return false;
		const rowButton = `[data-run-panel-row="${child}"] button`;
		if (
			!(await settle(
				`Boolean(${q(rowButton)})`,
				`${tag}: the Run panel lists the subagent's row`,
			))
		)
			return false;
		if (!(await pressSettled(rowButton, `${tag}: subagent row`))) return false;
		return settle(
			`Boolean(document.querySelector(${JSON.stringify(CHILD_SCOPE)}))`,
			`${tag}: the reader mounts the child transcript`,
		);
	};

	await verb(cdp, "navigate", `/chat/${session}`);
	if (child !== null) {
		await settle(
			`Boolean(document.querySelector(${JSON.stringify(PARENT_SCOPE)}))`,
			"child: the parent transcript mounts",
		);
		if (
			!(await pressSettled(
				"[data-run-panel-trigger]",
				"child: Run panel trigger",
			))
		)
			return;
		const rowButton = `[data-run-panel-row="${child}"] button`;
		if (
			!(await settle(
				`Boolean(${q(rowButton)})`,
				"child: the Run panel lists the subagent's row",
			))
		) {
			note(
				"child: Run panel rows present",
				JSON.stringify(
					await cdp.evaluate(
						`[...document.querySelectorAll("[data-run-panel-row]")].slice(0, 20).map((el) => el.getAttribute("data-run-panel-row"))`,
					),
				),
			);
			await shot("diff-history-child-no-row");
			return;
		}
		await shot("diff-history-child-run-panel", `Boolean(${q(rowButton)})`);
		if (!(await pressSettled(rowButton, "child: subagent row"))) return;
		if (
			!(await settle(
				`Boolean(document.querySelector(${JSON.stringify(CHILD_SCOPE)}))`,
				"child: the reader mounts the child transcript",
			))
		)
			return;
		await shot(
			"diff-history-child-reader",
			`Boolean(document.querySelector(${JSON.stringify(CHILD_SCOPE)}))`,
		);
		let childFirst = null;
		const editRow = await disclose("child-edit", CHILD_SCOPE, {
			verb: "Edited",
		});
		if (
			!(await settle(
				`Boolean(${q(viewFullIn(editRow ?? CHILD_SCOPE))})`,
				"child: the reader's Edited row offers View full diff",
			))
		)
			await noOffer(CHILD_SCOPE);
		else {
			await shot("diff-history-child-edit-preview");
			childFirst = await walkCall(editRow ?? CHILD_SCOPE, {
				label: "child-edit",
				kind: "edit",
				truth: expect?.edit ?? null,
				d1: true,
				error: handshake,
			});
		}
		const writes = await walkWrites(
			CHILD_SCOPE,
			"child-write",
			expect?.write ?? null,
		);
		if (expect?.oversized)
			check(
				"child: the oversized write is shown with its note",
				writes.oversized > 0,
				JSON.stringify(writes),
			);
		await refound(
			"child: ",
			session,
			CHILD_SCOPE,
			editRow ?? CHILD_SCOPE,
			childFirst,
			() => openChildReader(true),
		);
	} else {
		const row = await disclose("open", PARENT_SCOPE, { verb: "Edited" });
		const offered = await settle(
			`Boolean(${q(viewFullIn(row ?? PARENT_SCOPE))})`,
			"the seeded session offers a View full diff control",
		);
		if (!offered) {
			await noOffer();
			return;
		}
		await shot("diff-history-preview");
		const root = row ?? PARENT_SCOPE;
		const first = await walkCall(root, {
			label: "parent-edit",
			kind: "edit",
			truth: expect?.edit ?? null,
			d1: true,
			error: handshake,
		});
		// The SAME call reopened after the round-trip, compared once its range is set.
		await refound("", session, PARENT_SCOPE, root, first, async () => true);
	}

	if (liveSession !== null) {
		await verb(cdp, "navigate", `/chat/${liveSession}`);
		await settle(
			`Boolean(document.querySelector(${JSON.stringify(PARENT_SCOPE)}))`,
			"live: the live session's transcript mounts",
		);
		const before = await cdp.evaluate(verbCounts(PARENT_SCOPE));
		note("live: before", JSON.stringify(before));
		await shot("diff-history-live-before");
		check(
			"live: no Wrote/Edited row before the turn",
			before?.wrote === 0 && before?.edited === 0,
			JSON.stringify(before),
		);
		if (await step("live")) {
			const workArrived = `(() => { const c = ${verbCounts(PARENT_SCOPE)}; return c.origin === ${JSON.stringify(before?.origin)} && c.route === ${JSON.stringify(before?.route)} && ((c.wrote > 0 && c.edited > 0) || c.headers > ${Number(before?.headers ?? 0)}); })()`;
			const arrived = await settle(
				workArrived,
				"live: the turn's work appears without a reload or navigation",
				90_000,
			);
			note(
				"live: after",
				JSON.stringify(await cdp.evaluate(verbCounts(PARENT_SCOPE))),
			);
			await shot("diff-history-live-after", workArrived);
			if (arrived) {
				const row = await disclose("live-edit", PARENT_SCOPE, {
					verb: "Edited",
				});
				check("live: the new Edited row is reachable", row !== null, "");
				const liveFirst = row
					? await walkCall(row, {
							label: "live-edit",
							kind: "edit",
							truth: expect?.liveEdit ?? null,
						})
					: null;
				await walkWrites(PARENT_SCOPE, "live-write", expect?.liveWrite ?? null);
				const after = await cdp.evaluate(verbCounts(PARENT_SCOPE));
				check(
					"live: still the same document (no reload) after paging",
					after?.origin === before?.origin,
					JSON.stringify({ before: before?.origin, after: after?.origin }),
				);
				// After the same-document check: the round-trip is a navigation.
				await refound(
					"live: ",
					liveSession,
					PARENT_SCOPE,
					row ?? PARENT_SCOPE,
					liveFirst,
					() =>
						settle(
							`Boolean(document.querySelector(${JSON.stringify(PARENT_SCOPE)}))`,
							"live (re-navigated): the live session's transcript mounts",
						),
				);
			}
		}
	}
	note(
		"diff-history unproven",
		"empty and evicted states; anything a FAIL above stopped short of",
	);
}
