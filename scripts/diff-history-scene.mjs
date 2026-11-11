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
	const controls = [...document.querySelectorAll("button, [role=button], summary, a[href], [aria-expanded]")].filter(seen);
	return {
		route: location.hash || location.pathname,
		title: cut(document.title, 80),
		readyState: document.readyState,
		viewFull: document.querySelectorAll(${JSON.stringify(VIEW_FULL)}).length,
		diffRegions: document.querySelectorAll("[data-diff-line], [data-diff-history]").length,
		controlCount: controls.length,
		controls: controls.slice(0, 40).map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), name: cut(el.getAttribute("aria-label") || el.textContent, 60), expanded: el.getAttribute("aria-expanded"), state: el.getAttribute("data-state"), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }),
		text: cut(document.querySelector("main")?.innerText ?? document.body?.innerText, 600),
	};
})()`;

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

	await verb(cdp, "navigate", `/chat/${session}`);
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
