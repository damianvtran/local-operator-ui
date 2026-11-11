/**
 * `--scene diff-history`: the full-diff pager, walked in the BUILT app.
 *
 *     node scripts/renderer-driver.mjs --scene diff-history --backend <url> \
 *       --backend-records <file> --session <12 lowercase hex> --out <dir>
 *
 * WHY THIS EXISTS. The pager (`diff-history.tsx`) is covered by model and
 * contract tests, and bare Vite cannot mount `App` without the preload bridge,
 * so nothing had pressed its controls in the real renderer. This scene composes
 * ONLY the existing verbs (`hello`, `navigate`, `press`, and `queries` on the
 * no-offer failure path) plus `capture` and DOM
 * reads: no new verb, no state written into React, no synthetic page. The
 * history it pages is whatever the seeded session's daemon serves.
 *
 * WHAT IT CANNOT SEE, stated rather than implied. The contained child reader
 * (`run-child-reader.tsx`) is not walked: this scene has no reviewed selector
 * for opening it, so child paging stays unproven here. Empty, error and
 * loading states are only noted when the fixture actually reaches them.
 * A fixture with no pageable diff row FAILS the scene; it never passes vacuously.
 */

/** The contract's `sessionIdPattern` (`src/shared/desktop-contract.ts`). */
export const SESSION_ID = /^[a-f0-9]{12}$/;

/** Refusal text for a run that cannot prove anything, or null when it can. */
export function diffHistorySceneRefusal({ backend, backendRecords, session }) {
	if (backend === null)
		return "--scene diff-history needs --backend: the pager reads the archived diff from a live daemon's scoped diff route";
	if (backendRecords === null)
		return "--scene diff-history needs --backend-records: without the daemon's own record discovery does not admit it";
	if (session === null || !SESSION_ID.test(session))
		return `--scene diff-history needs --session <12 lowercase hex>: got ${JSON.stringify(session)}`;
	return null;
}

const VIEW_FULL = "[data-diff-view-full]";
const NAV_BUTTONS = "[data-diff-history] > nav > button";

/** One reading of the pager as painted: range, status, rows, inks, geometry, focus. */
const READ = `(() => {
	const root = document.querySelector("[data-diff-history]");
	if (!root) return { open: false, viewFull: document.querySelectorAll(${JSON.stringify(VIEW_FULL)}).length };
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
		buttons: [...root.querySelectorAll(":scope > nav > button")].map((b) => ({ text: b.textContent, disabled: b.getAttribute("aria-disabled") })),
		rowCount: rows.length,
		firstRow: rows[0] ? { index: rows[0].getAttribute("data-diff-line"), box: box(rows[0]) } : null,
		lastRow: rows.at(-1) ? { index: rows.at(-1).getAttribute("data-diff-line"), text: rows.at(-1).firstChild?.textContent?.slice(0, 80), box: box(rows.at(-1)) } : null,
		signs,
		zeroBoxes: rows.filter((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || r.height === 0; }).length,
		viewport: { w: innerWidth, h: innerHeight },
		focus: active ? active.tagName.toLowerCase() + (active.textContent ? ":" + active.textContent.slice(0, 40) : "") : null,
	};
})()`;

/**
 * What the session route painted when no View full diff control appeared.
 * Read-only and bounded: route, title, readiness, and the visible controls'
 * accessible names, roles and geometry. Never input values, innerHTML or
 * attribute dumps: the frame beside it shows the rest, and this must stay
 * safe to note even for a session that is not a synthetic fixture.
 */
export const NO_OFFER_READ = `(() => {
	const cut = (s, n) => (s ?? "").replace(/\\s+/g, " ").trim().slice(0, n);
	const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
	const scope = document.querySelector("[data-lo-canonical-transcript]") ?? document.querySelector("main") ?? document.body;
	const controls = [...scope.querySelectorAll("button, [role=button], summary, a[href], [aria-expanded]")].filter(seen);
	return {
		route: location.hash || location.pathname,
		title: cut(document.title, 80),
		readyState: document.readyState,
		scope: scope.hasAttribute("data-lo-canonical-transcript") ? "transcript" : scope.tagName.toLowerCase(),
		viewFull: document.querySelectorAll(${JSON.stringify(VIEW_FULL)}).length,
		diffRegions: document.querySelectorAll("[data-diff-line], [data-diff-history]").length,
		controlCount: controls.length,
		controls: controls.slice(0, 40).map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), name: cut(el.getAttribute("aria-label") || el.textContent, 60), expanded: el.getAttribute("aria-expanded"), state: el.getAttribute("data-state"), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }),
		text: cut(scope.innerText, 600),
	};
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
 * Selectors are derived from the source, never "any button":
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
export const COLLAPSED_FOLD =
	'[data-lo-canonical-transcript] [data-fold-ids] button[aria-expanded="false"]:has([data-fold-summary])';
const TOOL_TRIGGER = 'button[aria-expanded="false"]:has([data-trace-verb])';
/** Nearest owning disclosure root of a header: decides "own" vs nested inner. */
const HEADER_OWNER = "[data-turn-summary], [data-fold-ids]";
const TURN_HEADER = "button[aria-expanded]";
const FOLD_HEADER = "button[aria-expanded]:has([data-fold-summary])";
const MAX_FOLD_PRESSES = 4;
const MAX_TOOL_PRESSES = 4;

/** Read-only facts about the work controls: counts, verbs, addressable rows. */
export const WORK_READ = `(() => {
	const root = document.querySelector("[data-lo-canonical-transcript]");
	const viewFull = document.querySelectorAll(${JSON.stringify(VIEW_FULL)}).length;
	if (!root) return { transcript: false, viewFull, collapsedFolds: 0, folds: 0, disclosures: [], ambiguous: 0, tools: [] };
	const folds = root.querySelectorAll("[data-fold-ids]").length;
	// Diagnostic only: never the progress signal (see THE NORMAL STEPS above).
	const collapsedFolds = document.querySelectorAll(${JSON.stringify(COLLAPSED_FOLD)}).length;
	const owner = ${JSON.stringify(HEADER_OWNER)};
	const disclosures = [];
	let ambiguous = 0;
	const offer = (kind, el, attr, header) => {
		const b = [...el.querySelectorAll(header)].find((x) => x.closest(owner) === el);
		if (!b || b.getAttribute("aria-expanded") !== "false") return;
		const base = kind === "turn" ? "[data-turn-summary]" : "";
		const rootSel = '[data-lo-canonical-transcript] ' + base + '[' + attr + '="' + CSS.escape(el.getAttribute(attr) ?? "") + '"]';
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
		const selector = '[data-lo-canonical-transcript] [data-record-id="' + CSS.escape(row.getAttribute("data-record-id")) + '"] ' + ${JSON.stringify(TOOL_TRIGGER)};
		if (document.querySelector(selector) === button) tools.push({ verb, selector });
		if (tools.length >= 8) break;
	}
	tools.sort((a, b) => (a.verb === "Edited" ? 0 : 1) - (b.verb === "Edited" ? 0 : 1));
	return { transcript: true, viewFull, folds, collapsedFolds, disclosures, ambiguous, tools };
})()`;

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

export async function sceneDiffHistory({
	cdp,
	verb,
	capture,
	check,
	note,
	waitForCondition,
	factsOf,
	session,
}) {
	note("diff-history facts", JSON.stringify(await factsOf(cdp)));
	note("diff-history hello", JSON.stringify(await verb(cdp, "hello")));
	const read = () => cdp.evaluate(READ);
	const settle = (expr, label) =>
		waitForCondition(cdp, expr, 30_000).then((r) => {
			check(label, r.ok, `last reading: ${JSON.stringify(r.last)}`);
			return r.ok;
		});
	const pressLabel = async (label) => {
		const state = await read();
		const index = state.buttons?.findIndex((b) => b.text === label) ?? -1;
		if (index < 0 || state.buttons[index].disabled === "true") {
			check(
				`pager offers an enabled "${label}"`,
				false,
				JSON.stringify(state.buttons),
			);
			return null;
		}
		const hit = await verb(cdp, "press", {
			selector: `${NAV_BUTTONS}:nth-of-type(${index + 1})`,
		});
		note(`press "${label}" hit`, JSON.stringify(hit));
		return state.range;
	};
	const rangeMoved = (from) =>
		`(document.querySelector("[data-diff-history-range]")?.textContent ?? "") !== ${JSON.stringify(from)} && document.querySelector("[data-diff-history]")?.getAttribute("aria-busy") !== "true"`;
	const openFull = async (label) => {
		const hit = await verb(cdp, "press", { selector: VIEW_FULL });
		note(`press view-full (${label}) hit`, JSON.stringify(hit));
		return settle(
			`Boolean(document.querySelector("[data-diff-history-range]")?.textContent) || Boolean(document.querySelector("[data-diff-history-status]")?.textContent)`,
			`full diff opens (${label})`,
		);
	};
	const page = async (label) => {
		const state = await read();
		note(`diff-history ${label}`, JSON.stringify(state));
		check(
			`${label}: added rows paint text-success with "+", removed rows text-danger with "-"`,
			state.signs.addedBadSign === 0 && state.signs.removedBadSign === 0,
			JSON.stringify(state.signs),
			JSON.stringify(state.signs),
		);
		check(
			`${label}: every row has painted geometry`,
			state.zeroBoxes === 0,
			JSON.stringify(state),
		);
		await capture(cdp, `diff-history-${label}`);
		return state;
	};

	/*
	 * Open folds, then Edited/Wrote rows, until a View full diff control exists.
	 * Each press is checked by its own aria-expanded settling, so a gesture that
	 * does nothing is a recorded FAIL rather than a silent skip.
	 */
	const disclose = async (label) => {
		await settle(
			`Boolean(document.querySelector("[data-lo-canonical-transcript]"))`,
			`${label}: the transcript mounts`,
		);
		const facts = () => cdp.evaluate(WORK_READ);
		let state = await facts();
		note(`diff-history ${label} work controls`, JSON.stringify(state));
		await capture(cdp, `diff-history-${label}-initial`);
		const pressOpen = async (selector, what, opened) => {
			try {
				note(
					`press ${what} hit`,
					JSON.stringify(
						await verb(cdp, "press", { selector, timeoutMs: 2_000 }),
					),
				);
			} catch (error) {
				check(
					`${label}: ${what} takes the press`,
					false,
					String(error).slice(0, 200),
				);
				return false;
			}
			return settle(opened, `${label}: ${what} opens`);
		};
		// Outer TurnSummary headers come first in the read, then TraceFolds, so an
		// outer bar opens before the inner folds it reveals are pressed.
		for (let i = 0; i < MAX_FOLD_PRESSES && !state.viewFull; i += 1) {
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
			const what = `${next.kind === "turn" ? "turn summary" : "work fold"} ${i + 1}`;
			if (!(await pressOpen(next.selector, what, headerOpened(next)))) break;
			state = await facts();
		}
		for (
			let i = 0;
			i < MAX_TOOL_PRESSES && !state.viewFull && state.tools?.length;
			i += 1
		) {
			const { selector, verb: rowVerb } = state.tools[0];
			// The row's own trigger, now expanded: the same address with the state flipped.
			const open = `Boolean(document.querySelector(${JSON.stringify(selector.replace('aria-expanded="false"', 'aria-expanded="true"'))}))`;
			if (!(await pressOpen(selector, `${rowVerb} row ${i + 1}`, open))) break;
			state = await facts();
		}
		note(`diff-history ${label} after disclosure`, JSON.stringify(state));
	};

	await verb(cdp, "navigate", `/chat/${session}`);
	await disclose("open");
	const offered = await settle(
		`Boolean(document.querySelector(${JSON.stringify(VIEW_FULL)}))`,
		"the seeded session offers a View full diff control",
	);
	if (!offered) {
		// WHY a frame on failure: native QA failed here with nothing to look at,
		// so whether the diff block was collapsed, the route was wrong, a query
		// failed or the paint broke was guesswork. The frame and these read-only
		// facts are evidence for fixing the real nested view; they never mask the
		// missing control: the settle above already recorded the FAIL and the
		// scene still stops before any pager step.
		await capture(cdp, "diff-history-no-offer");
		note(
			"diff-history no-offer dom",
			JSON.stringify(await cdp.evaluate(NO_OFFER_READ)),
		);
		const queries = await verb(cdp, "queries");
		const list = Array.isArray(queries) ? queries : [];
		note(
			"diff-history no-offer queries",
			JSON.stringify({
				count: list.length,
				notSuccess: list
					.filter((q) => q.status !== "success")
					.slice(0, 20)
					.map((q) => ({
						key: String(q.key).slice(0, 120),
						status: q.status,
						hasData: q.hasData,
					})),
			}),
		);
		return;
	}
	await capture(cdp, "diff-history-preview");
	if (!(await openFull("first open"))) return;
	const first = await page("page-first");
	const firstRange = parseRange(first.range);
	if (first.status) note("diff-history reached status", first.status);
	check(
		"first page states its range",
		firstRange !== null,
		JSON.stringify(first),
	);
	if (firstRange && firstRange.last < firstRange.total) {
		const from = await pressLabel("Next");
		if (
			from !== null &&
			(await settle(rangeMoved(from), "Next moves the range"))
		) {
			const next = parseRange((await page("page-next")).range);
			check(
				"Next starts after the first page",
				next?.first === firstRange.last + 1,
				JSON.stringify(next),
			);
		}
		const back = await pressLabel("Previous");
		if (
			back !== null &&
			(await settle(rangeMoved(back), "Previous moves the range"))
		) {
			const prev = parseRange((await page("page-previous")).range);
			check(
				"Previous returns to the first page",
				prev?.first === firstRange.first,
				JSON.stringify(prev),
			);
		}
		const toLast = await pressLabel("Last");
		if (
			toLast !== null &&
			(await settle(rangeMoved(toLast), "Last moves the range"))
		) {
			const last = await page("page-last");
			const range = parseRange(last.range);
			check(
				"Last ends on the final row",
				range !== null && range.last === range.total,
				JSON.stringify({ range, lastRow: last.lastRow }),
				JSON.stringify({
					range,
					lastRow: last.lastRow,
					rowCount: last.rowCount,
				}),
			);
		}
	} else
		note(
			"diff-history paging",
			"the fixture's diff fits one page: Next/Previous/Last not offered",
		);
	if ((await pressLabel("Back to preview")) !== null) {
		await settle(
			`!document.querySelector("[data-diff-history]") && document.activeElement?.matches(${JSON.stringify(VIEW_FULL)})`,
			"Back closes the pager and focus returns to View full diff",
		);
		await capture(cdp, "diff-history-closed");
	}
	if (await openFull("reopen")) {
		const again = await page("page-reopened");
		check(
			"reopen lands on the first page again",
			again.range === first.range,
			JSON.stringify(again.range),
		);
	}
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "navigate", `/chat/${session}`);
	await disclose("replay");
	if (
		(await settle(
			`Boolean(document.querySelector(${JSON.stringify(VIEW_FULL)}))`,
			"replayed session offers View full diff again",
		)) &&
		(await openFull("replay"))
	) {
		const replay = await page("page-replayed");
		check(
			"replayed session pages the same first page",
			replay.range === first.range &&
				replay.lastRow?.text === first.lastRow?.text,
			JSON.stringify({ replay: replay.range, first: first.range }),
		);
	}
	note(
		"diff-history unproven",
		"contained child reader paging; empty/error/loading unless noted above",
	);
}
