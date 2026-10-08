/**
 * The sidebar's rows read in the order their TIME LABELS imply, in every view -
 * executable, and run through the pipeline the component runs.
 *
 *     node --test scripts/chat-sidebar-time-order.test.mjs
 *
 * THE REPORT THIS FILE ANSWERS (operator, 2026-10-08, Group by `Time section`,
 * Time basis `Last active`, Order by `Active first`): "despite having order by
 * active first, the sorting doesn't seem to properly sort within each section by
 * last active first ... (or maybe the timestamp it shows is not last active, in
 * that case it should show what we have selected/expect, last active vs creation
 * time, so the time doesn't appear out of order)". The labels top to bottom in
 * his screenshot read 15h 15h 15h 1d 1d 12h 11h 2d 2d 2d 5d 5d 5d 5d 6d 2d 15h
 * 15h 2d 12h.
 *
 * THE CAUSE, measured on his real store: the desktop catalogue is ranked
 * `(tier, wake band, -created_at, id)`, so the rows ARRIVE in creation order, and
 * the sidebar filed and LABELLED every row from the activity clock (`updated_at`)
 * while treating the arrival order as recency. Inside a section the order was the
 * creation clock and the label was the activity clock, so a conversation made
 * three days ago and answered an hour ago printed `1h` under rows that printed
 * `6d`.
 *
 * THE RULE THIS FILE HOLDS THE PIPELINE TO (the operator's, in his words and then
 * the clarification that superseded his first draft of the running half):
 *
 *   - every row that is not running is ordered newest-first by the clock the
 *     chosen basis names - `Last active` reads `updated_at`, `Created` reads
 *     `created_at` - and that is the clock its label prints, so the two cannot
 *     disagree; a row with no usable stamp sorts last and prints no label;
 *   - a RUNNING row is never ordered by activity, because a response landing in a
 *     running chat would re-sort the section every time ("they'll keep resorting
 *     every time a new message is sent"); it is ordered by the time of the last
 *     USER message (`last_user_at`, which no backend publishes yet) and by
 *     creation until one does;
 *   - `Active first` lifts the running rows (the ones stopped on the reader
 *     first) above everything; `Most recent` is one order over all of them.
 *
 * WHY THE ORACLE BELOW DOES NOT CALL THE MODULE'S OWN CLOCK READER. `rowTimeMs` is
 * the one door the bins and the labels share; an oracle that asked it would agree
 * with a sort that read it wrongly. So the clocks are re-read here from the wire's
 * field names, and the label grammar (`now`, `4m`, `2h`, `3d`, `5w`, `1y`) is
 * restated from the same wire. A divergence between the two statements is the
 * failure, in either direction.
 *
 * THE MATRIX: both bases x both orderings x the ladder's four rungs (10, 25, 50,
 * 100) x the three groupings, over one seeded catalogue that mixes every kind of
 * row the operator's store holds. It runs UNCHANGED on `origin/main` - the base
 * tree has no `basis` argument on the arrangement and still merges remote rows by
 * activity, and the pipeline below runs each tree as it ships - which is how the
 * red-before counts in the pull request were produced.
 *
 * WHAT IT CANNOT SAY: that the column LOOKS right (the frames beside this change
 * are the pixels), or that the daemon will ever publish `last_user_at`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export * from "./src/renderer/src/features/chat/chat-list-sections";',
			/*
			 * A namespace re-export, not a named one: the base tree's pipeline merged
			 * remote rows with `mergeRemoteRowsByActivity` before ordering, and the
			 * arrangement this change ships makes that pass redundant (it is deleted).
			 * A named re-export would stop this file bundling on the tree where the name
			 * is gone, and the file's whole use is to run on both.
			 */
			'export * from "./src/renderer/src/features/chat/chat-remote";',
			'export * from "./src/renderer/src/features/chat/chat-sections";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "ts",
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	CHAT_LIST_SECTIONS,
	STOPPED_ON_READER_CODES,
	entityRows,
	groupRows,
	mergeRemoteRowsByActivity,
	pageLimit,
	pageOrder,
	pageRows,
	relativeTime,
	runningOrderMs,
	sectionOf,
	sectionRows,
	unpinnedRows,
	pinnedRows,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The component's own first step on a tree that still has it; the identity where it is gone. */
const mergeRemote =
	typeof mergeRemoteRowsByActivity === "function"
		? mergeRemoteRowsByActivity
		: (rows) => [...rows];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2026-10-08 15:00 LOCAL: the TODAY boundary is a local-calendar one. */
const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime();

const BASES = ["active", "created"];
const ORDERS = ["active-first", "recent"];
const GROUPINGS = ["section", "agent", "flat"];
/** The ladder's four rungs, as `loads` (10, 25, 50, 100 rows). */
const RUNGS = [0, 1, 2, 3];

/* ------------------------------------------------------------- the oracle */

/** The wire's seconds as milliseconds; zero, negatives and non-numbers are "no claim". */
const wireMs = (value) =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value * 1000
		: null;
const RUNNING = new Set(["busy", "delegating", "approval", "answer", "wedged"]);
const WAITS_ON_READER = new Set(["approval", "answer"]);
const isRunning = (row) => RUNNING.has(row.status?.code ?? "");
const clockOf = (row, basis) =>
	wireMs(basis === "created" ? row.created_at : row.updated_at);
/** A running row's key: the last USER message, else birth, else nothing. */
const runningKey = (row) => wireMs(row.last_user_at) ?? wireMs(row.created_at);
const keyOf = (row, basis) =>
	isRunning(row) ? runningKey(row) : clockOf(row, basis);
const laneOf = (row, orderBy) =>
	orderBy !== "active-first"
		? 0
		: WAITS_ON_READER.has(row.status?.code ?? "")
			? 0
			: isRunning(row)
				? 1
				: 2;

/** The label grammar, restated: `now`, minutes, hours, days (to 6), weeks (to 364), years. */
function expectedLabel(ms) {
	if (ms === null) return "";
	const minutes = Math.floor(Math.max(0, NOW - ms) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 365) return `${Math.floor(days / 7)}w`;
	return `${Math.floor(days / 365)}y`;
}
const UNIT_SECONDS = { m: 60, h: 3600, d: 86_400, w: 604_800, y: 31_536_000 };
/** A label's age in seconds, so two labels compare the way a reader compares them. */
function labelAge(label) {
	if (label === "now") return 0;
	return Number.parseInt(label, 10) * UNIT_SECONDS[label.slice(-1)];
}

/* ------------------------------------------------------------ the catalogue */

/** A seeded generator (mulberry32): the same catalogue on every run and every tree. */
function prng(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const BINDINGS = [
	{ agent: "coder", team: null },
	{ agent: "reviewer", team: null },
	{ agent: null, team: "release-crew" },
	{ agent: null, team: null },
	{ agent: null, team: null },
];

/**
 * The backend's own rank, restated: `(tier, -created_at, id)` with the tiers the
 * desktop catalogue uses (`session/catalog.py`) - stopped-on-the-reader first, then
 * unread completions, then busy and wedged, then attached, then everything else.
 * THIS IS WHY THE ROWS ARRIVE IN CREATION ORDER, and the fixture reproduces it
 * because the defect only exists for input that arrives that way.
 */
function backendTier(row) {
	const code = row.status?.code ?? "";
	if (WAITS_ON_READER.has(code)) return 0;
	if (code === "complete" && row.attention?.unseen) return 1;
	if (code === "busy" || code === "delegating" || code === "wedged") return 4;
	if (code === "attached") return 5;
	return 6;
}

/**
 * ONE MIXED CATALOGUE: complete and unread-completed chats, stopped ones (the
 * pause glyph), scheduled ones (the clock glyph), a running chat of every kind,
 * remote rows with a real stamp, with a zero stamp (core's "no claim") and with no
 * stamp key at all, chats created long ago and answered an hour ago, and groups of
 * equal stamps.
 */
function catalogue(seed = 20261008) {
	const random = prng(seed);
	const between = (low, high) => low + random() * (high - low);
	const pick = (list) => list[Math.floor(random() * list.length)];
	const plan = [
		["complete", 64],
		["unread", 14],
		["interrupted", 6],
		["dormant", 6],
		["scheduled", 8],
		["recent", 8],
		["attached", 6],
		["error", 3],
		["busy", 6],
		["delegating", 3],
		["approval", 3],
		["answer", 3],
		["wedged", 2],
	];
	const local = [];
	let serial = 0;
	for (const [kind, count] of plan) {
		for (let n = 0; n < count; n += 1) {
			serial += 1;
			const running = RUNNING.has(kind);
			// Hours since the last write: running chats are mid-turn, the rest spread over
			// the day, the week and the long tail - so TODAY, THIS WEEK and OLDER are all
			// populated well past the ladder's 100th row.
			const idleHours = running
				? between(0.01, 0.4)
				: random() < 0.34
					? between(0.1, 14)
					: random() < 0.62
						? between(15, 24 * 6.9)
						: between(24 * 7, 24 * 60);
			// Born before it was last written to; a third are born within hours of it.
			const bornHours =
				idleHours + (random() < 0.33 ? between(0, 3) : between(2, 24 * 50));
			const row = {
				session_id: `local-${String(serial).padStart(3, "0")}`,
				title: `${kind} ${serial}`,
				status: { code: kind === "unread" ? "complete" : kind, label: kind },
				binding: pick(BINDINGS),
				updated_at: (NOW - idleHours * HOUR) / 1000,
				created_at: (NOW - bornHours * HOUR) / 1000,
			};
			if (kind === "unread") row.attention = { unseen: true };
			// A running chat's last user message: usually minutes to hours before its last
			// write, sometimes absent (the field is not published today).
			if (running && random() < 0.6) {
				row.last_user_at = row.updated_at - between(60, 4 * 3600);
			}
			local.push(row);
		}
	}
	// Chats made long ago and answered inside the hour: the operator's own case, and
	// the one a creation-ordered list prints out of order.
	for (let n = 0; n < 4; n += 1) {
		serial += 1;
		local.push({
			session_id: `local-${String(serial).padStart(3, "0")}`,
			title: `revived ${n}`,
			status: { code: "complete", label: "complete" },
			binding: pick(BINDINGS),
			updated_at: (NOW - (0.5 + n * 0.4) * HOUR) / 1000,
			created_at: (NOW - (30 + n * 9) * DAY) / 1000,
		});
	}
	// Equal stamps: every seventh row repeats its neighbour's activity clock, and
	// every eleventh repeats its birth clock.
	for (let i = 1; i < local.length; i += 1) {
		if (i % 7 === 0 && local[i].status.code !== "approval")
			local[i].updated_at = local[i - 1].updated_at;
		if (i % 11 === 0) local[i].created_at = local[i - 1].created_at;
	}
	// A few rows from a backend that could not read a birth record.
	local[5].created_at = 0;
	local[17].created_at = undefined;
	local[33].created_at = null;
	local.sort(
		(a, b) =>
			backendTier(a) - backendTier(b) ||
			(b.created_at ?? 0) - (a.created_at ?? 0) ||
			(a.session_id < b.session_id ? -1 : 1),
	);
	// The peer half arrives APPENDED, after the page, and carries no `created_at`
	// key at all (measured on the live wire: 10 of 10).
	const remote = [];
	const remoteSpecs = [
		["recent", 1.2],
		["recent", 5],
		["complete", 17],
		["complete", 30],
		["recent", 52],
		["complete", 90],
		["busy", 0.1],
		["recent", 0],
		["complete", 0],
		["recent", undefined],
		["complete", undefined],
	];
	for (const [index, [kind, hours]] of remoteSpecs.entries()) {
		const row = {
			session_id: `remote-${String(index).padStart(2, "0")}`,
			title: `remote ${kind} ${index}`,
			status: { code: kind, label: kind },
			binding: pick(BINDINGS),
			locality: "remote",
			owner_device: "device-b",
		};
		if (hours === 0) row.updated_at = 0;
		else if (hours !== undefined) row.updated_at = (NOW - hours * HOUR) / 1000;
		remote.push(row);
	}
	return [...local, ...remote];
}

/* ------------------------------------------------------ one cell, drawn */

/**
 * The rows each drawn section or group holds, in drawn order, exactly as the
 * component builds them: the merge (where the tree has it), the pin partition, the
 * arrangement, the cut at the rung, and then the section bins or the grouping.
 *
 * `arrangeBy` names the clock the ARRANGEMENT reads when it is not the clock the
 * view draws - the oracle's own falsifier uses it to arrange by the wrong clock
 * and prove the audit can see that.
 */
function drawn({ rows, basis, arrangeBy = basis, orderBy, loads, groupBy }) {
	const rest = unpinnedRows(mergeRemote(rows), true);
	const page = pageRows(pageOrder(rest, orderBy, arrangeBy), {
		limit: pageLimit(loads),
		currentId: null,
	});
	if (groupBy === "section") {
		const sections = sectionRows(page.rows, NOW, basis);
		return CHAT_LIST_SECTIONS.map((key) => ({
			name: key,
			section: key,
			rows: sections[key],
		}));
	}
	return groupRows(page.rows, groupBy).map((group) => ({
		name: group.key,
		section: null,
		rows: group.rows,
	}));
}

/** What the component prints beside a row: nothing on a running row. */
const printed = (row, basis) =>
	isRunning(row) ? "" : relativeTime(row, NOW, basis);

/**
 * Every way a drawn list can disagree with the rule, counted.
 *
 * `descents`: adjacent rows where the later one should have come first (a lower
 * lane, or a newer key, or a key where the earlier row has none).
 * `labelDescents`: the same thing as a READER sees it - among the rows that print a
 * label, a later label that is younger than an earlier one (`15h` after `6d`).
 * `wrongLabels`: a label that is not the independent reading of the basis's clock.
 * `zeroLabels`: a label printed for a row whose activity stamp is zero.
 * `misfiled`: a row drawn under a section its basis clock does not name.
 */
function audit(lists, orderBy, basis) {
	const found = {
		descents: 0,
		labelDescents: 0,
		wrongLabels: 0,
		zeroLabels: 0,
		misfiled: 0,
		first: null,
	};
	for (const list of lists) {
		let previous = null;
		let previousLabelAge = null;
		for (const row of list.rows) {
			if (previous !== null) {
				const earlier = [laneOf(previous, orderBy), keyOf(previous, basis)];
				const later = [laneOf(row, orderBy), keyOf(row, basis)];
				const inverted =
					later[0] < earlier[0] ||
					(later[0] === earlier[0] &&
						later[1] !== null &&
						(earlier[1] === null || later[1] > earlier[1]));
				if (inverted) {
					found.descents += 1;
					found.first ??= `${list.name}: ${previous.session_id} then ${row.session_id}`;
				}
			}
			previous = row;
			const label = printed(row, basis);
			if (label !== "") {
				const age = labelAge(label);
				if (previousLabelAge !== null && age < previousLabelAge)
					found.labelDescents += 1;
				previousLabelAge = age;
				if (label !== expectedLabel(clockOf(row, basis)))
					found.wrongLabels += 1;
			}
			if (basis === "active" && row.updated_at === 0 && label !== "")
				found.zeroLabels += 1;
			if (list.section !== null && list.section !== "running") {
				const at = clockOf(row, basis);
				const today = new Date(NOW).setHours(0, 0, 0, 0);
				const bin =
					at === null
						? "older"
						: at >= today
							? "today"
							: at >= today - 6 * DAY
								? "week"
								: "older";
				if (bin !== list.section || sectionOf(row, NOW, basis) !== bin)
					found.misfiled += 1;
			}
		}
	}
	return found;
}

/** Run the whole matrix once and total it. */
function sweep(rows, { arrangeAs = (basis) => basis } = {}) {
	const total = {
		cells: 0,
		badCells: 0,
		descents: 0,
		labelDescents: 0,
		wrongLabels: 0,
		zeroLabels: 0,
		misfiled: 0,
		firstBad: null,
		perView: new Map(),
	};
	for (const basis of BASES)
		for (const orderBy of ORDERS)
			for (const loads of RUNGS)
				for (const groupBy of GROUPINGS) {
					const lists = drawn({
						rows,
						basis,
						arrangeBy: arrangeAs(basis),
						orderBy,
						loads,
						groupBy,
					});
					const found = audit(lists, orderBy, basis);
					total.cells += 1;
					const bad = found.descents + found.labelDescents;
					if (bad > 0) {
						total.badCells += 1;
						total.firstBad ??= `${basis}/${orderBy}/${pageLimit(loads)}/${groupBy}: ${found.first}`;
					}
					total.descents += found.descents;
					total.labelDescents += found.labelDescents;
					total.wrongLabels += found.wrongLabels;
					total.zeroLabels += found.zeroLabels;
					total.misfiled += found.misfiled;
					const key = `${basis}/${orderBy}`;
					total.perView.set(key, (total.perView.get(key) ?? 0) + bad);
				}
	return total;
}

const summary = (total) =>
	`${total.badCells} of ${total.cells} cells out of order, ${total.descents} rows newer than the row above, ${total.labelDescents} labels younger than the label above` +
	` (first: ${total.firstBad ?? "none"}; per basis/order: ${JSON.stringify(Object.fromEntries(total.perView))})`;

/* -------------------------------------------------------------------- tests */

test("the fixture holds every kind of row the report is made of", () => {
	const rows = catalogue();
	const codes = new Set(rows.map((row) => row.status.code));
	for (const code of [
		"complete",
		"interrupted",
		"dormant",
		"scheduled",
		"busy",
		"delegating",
		"approval",
		"answer",
		"wedged",
	])
		assert.ok(codes.has(code), `the fixture lacks a ${code} row`);
	assert.ok(
		rows.some((row) => row.attention?.unseen),
		"an unread completion",
	);
	const remote = rows.filter((row) => row.locality === "remote");
	assert.ok(
		remote.some((row) => row.updated_at > 0),
		"a remote row with a real stamp",
	);
	assert.ok(
		remote.some((row) => row.updated_at === 0),
		"a remote row whose stamp is the wire's zero",
	);
	assert.ok(
		remote.some((row) => !("updated_at" in row)),
		"a remote row with no stamp key",
	);
	assert.ok(
		remote.every((row) => !("created_at" in row)),
		"remote rows carry no created_at key on the live wire",
	);
	assert.ok(
		rows.some(
			(row) =>
				row.created_at &&
				row.updated_at - row.created_at > 20 * 86_400 &&
				NOW / 1000 - row.updated_at < 3600,
		),
		"a chat created long ago and answered inside the hour",
	);
	const stamps = rows
		.filter((row) => row.locality !== "remote")
		.map((row) => row.updated_at);
	assert.ok(new Set(stamps).size < stamps.length, "equal stamps exist");
	// And the input is in the BACKEND's order, which is the order the defect needs.
	const local = rows.filter((row) => row.locality !== "remote");
	for (let i = 1; i < local.length; i += 1) {
		assert.ok(
			backendTier(local[i - 1]) <= backendTier(local[i]),
			"the page arrives tier by tier",
		);
	}
	assert.ok(rows.length > 100, "enough rows to fill the 100-row rung");
});

test("(a) in every drawn section and group the printed times read newest first", (t) => {
	const total = sweep(catalogue());
	t.diagnostic(summary(total));
	assert.equal(
		total.descents + total.labelDescents,
		0,
		`rows are drawn out of the order their labels imply: ${summary(total)}`,
	);
});

test("(b) the label and the bin read the clock the basis chose, and the order reads it too", (t) => {
	const total = sweep(catalogue());
	t.diagnostic(
		`label/bin disagreements: wrong labels ${total.wrongLabels}, misfiled ${total.misfiled}`,
	);
	assert.equal(
		total.wrongLabels,
		0,
		"a printed label is not the independent reading of the clock the basis names",
	);
	assert.equal(
		total.misfiled,
		0,
		"a row sits under a section its basis clock does not name",
	);
	// ... and the order is the SAME clock: a sort by the wrong one is caught. This is
	// the oracle's falsifier: it must be able to fail, or the sweep above is a comment.
	const wrong = sweep(catalogue(), {
		arrangeAs: (basis) => (basis === "active" ? "created" : "active"),
	});
	assert.ok(
		wrong.descents + wrong.labelDescents > 0,
		"ordering by the OTHER clock must be visible to the oracle",
	);
});

test("(c) a zero stamp prints no `Ny` label, files under Older and sorts last", (t) => {
	const rows = catalogue();
	const zeroRows = rows.filter((row) => row.updated_at === 0);
	assert.ok(zeroRows.length > 0);
	const offenders = [];
	for (const row of zeroRows) {
		const label = relativeTime(row, NOW, "active");
		const bin = sectionOf(row, NOW, "active");
		if (label !== "" || (bin !== "older" && !isRunning(row)))
			offenders.push(`${row.session_id}: label "${label}" under ${bin}`);
	}
	t.diagnostic(
		`zero-stamp rows: ${zeroRows.length}, printing a label or misfiled: ${offenders.length}`,
	);
	assert.deepEqual(
		offenders,
		[],
		`a zero stamp is the wire's "no claim", never 1970: ${offenders.join("; ")}`,
	);
	// And in the drawn matrix none of them prints a label anywhere.
	assert.equal(sweep(rows).zeroLabels, 0, "a zero stamp printed a label");
});

test("the Pinned partition is outside the arrangement: it stays the catalogue's own order", () => {
	const rows = catalogue().map((row, index) =>
		index % 9 === 0 ? { ...row, pinned: true } : row,
	);
	const expected = rows.filter((row) => row.pinned === true);
	assert.ok(expected.length > 5);
	assert.deepEqual(
		pinnedRows(rows, true).map((row) => row.session_id),
		expected.map((row) => row.session_id),
		"the Pinned section is the reader's manual order, not the clock's",
	);
	// And no pinned row is arranged into a section: the partition removes it first.
	const arranged = pageOrder(
		unpinnedRows(rows, true),
		"active-first",
		"active",
	);
	assert.equal(
		arranged.some((row) => row.pinned === true),
		false,
	);
});

/* ------------------------------------------------- T2: running stability */

/*
 * THE OPERATOR'S CLARIFICATION, EXACTLY: "across surfaces we should keep the sort
 * of running sessions stable ... otherwise they'll keep resorting every time a
 * new message is sent which we don't want, and I've noticed a bit of flicker in
 * the sidebar because of this ... Or actually I think in the running sections,
 * it makes sense to sort based on the time of the last user message, so if I send
 * a more recent message to a session that session will pop to the top/most
 * recent of the running sessions but any responses or non-user messages will not
 * reorder those by activity."
 *
 * The four tests below are those clauses, over the seeded catalogue: activity
 * writes move nothing, a user message moves exactly one row to the front of its
 * band, the fallback is a birth order, and ties keep the catalogue's sequence.
 */

const runningIds = (rows) =>
	pageOrder(rows, "active-first", "active")
		.filter((row) => isRunning(row))
		.map((row) => row.session_id);

test("T2 a response landing in a running chat reorders nothing", () => {
	const rows = catalogue();
	// "Appending responses": every running row's activity clock advances by a
	// second, a few times over - the flicker the operator reported.
	const before = new Map(rows.map((row) => [row.session_id, row.updated_at]));
	const ids = runningIds(rows);
	assert.ok(ids.length >= 5, "the fixture has running rows to move");
	for (let tick = 1; tick <= 5; tick += 1) {
		const moved = rows.map((row) =>
			isRunning(row)
				? { ...row, updated_at: (before.get(row.session_id) ?? 0) + tick }
				: row,
		);
		assert.deepEqual(
			runningIds(moved),
			ids,
			`tick ${tick}: a response moved a running row`,
		);
	}
	// And the same under `recent`, where the running rows share one order with the
	// rest: their positions may only change by the keys of the others.
	const positions = (list) =>
		list.map((row) => row.session_id).filter((id) => ids.includes(id));
	const first = positions(pageOrder(rows, "recent", "active"));
	const advanced = positions(
		pageOrder(
			rows.map((row) =>
				isRunning(row)
					? { ...row, updated_at: (row.updated_at ?? 0) + 10_000 }
					: row,
			),
			"recent",
			"active",
		),
	);
	assert.deepEqual(
		advanced,
		first,
		"a response moved a running row's place in the one-list order",
	);
});

test("T2 a new user message moves exactly that row to the front of its band", () => {
	const rows = catalogue();
	const before = runningIds(rows);
	// The LAST running row by the current order gets the newest user message.
	const lastBusy = [...before].reverse().find((id) => {
		const row = rows.find((entry) => entry.session_id === id);
		return row && !WAITS_ON_READER.has(row.status?.code ?? "");
	});
	assert.ok(lastBusy, "the fixture has a non-needs-you running row");
	const moved = rows.map((row) =>
		row.session_id === lastBusy
			? { ...row, last_user_at: (row.updated_at ?? 0) + 60 }
			: row,
	);
	const after = runningIds(moved).filter(
		(id) =>
			!WAITS_ON_READER.has(
				moved.find((row) => row.session_id === id)?.status?.code ?? "",
			),
	);
	assert.equal(
		after[0],
		lastBusy,
		"the row the user just messaged did not lead its band",
	);
	// ... and only that row moved: the others keep their relative order.
	assert.deepEqual(
		after.slice(1),
		before
			.filter((id) => id !== lastBusy)
			.filter(
				(id) =>
					!WAITS_ON_READER.has(
						rows.find((row) => row.session_id === id)?.status?.code ?? "",
					),
			),
		"a user message re-sorted rows it did not touch",
	);
	// The needs-you band keeps its precedence as a BAND: every row stopped on the
	// reader is drawn above every other running row, whatever the user-message
	// clocks say - the lift's first band is a design intent, not a key.
	const order = runningIds(moved);
	const stoppedAt = order.map((id) =>
		WAITS_ON_READER.has(
			moved.find((row) => row.session_id === id)?.status?.code ?? "",
		),
	);
	assert.deepEqual(
		stoppedAt,
		[...stoppedAt].sort((a, b) => Number(b) - Number(a)),
		"a user message outranked a turn stopped on the reader",
	);
	assert.ok(
		stoppedAt.some(Boolean),
		"the fixture has a needs-you row for the band assertion to mean anything",
	);
});

test("T2 with no last_user_at the running order is birth order, ties by catalogue", () => {
	const rows = catalogue().map((row) => ({ ...row, last_user_at: undefined }));
	const drawn = runningIds(rows);
	const byBirth = rows
		.map((row, index) => ({ row, index }))
		.filter((entry) => isRunning(entry.row))
		.sort(
			(a, b) =>
				laneOf(a.row, "active-first") - laneOf(b.row, "active-first") ||
				(wireMs(b.row.created_at) ?? -1) - (wireMs(a.row.created_at) ?? -1) ||
				a.index - b.index,
		)
		.map((entry) => entry.row.session_id);
	assert.deepEqual(
		drawn,
		byBirth,
		"the birth order is not what the running band drew",
	);
	// Ties: two running rows born at the same second keep their arrival order.
	const born = (NOW - 3 * 3600) / 1000;
	const tied = [
		{ session_id: "run-b", status: { code: "busy" }, created_at: born },
		{ session_id: "run-a", status: { code: "busy" }, created_at: born },
	];
	assert.deepEqual(
		pageOrder(tied, "active-first", "active").map((row) => row.session_id),
		["run-b", "run-a"],
		"a tie broke by id/title instead of the catalogue's sequence",
	);
});

/* ---------------------------------------------- T3: show-more stability */

test("T3 pressing the ladder reveals rows: drawn rows keep their order and are never dropped", () => {
	/*
	 * NARROWED BY A1's EXEMPTION (agent review round 1). The old claim was a
	 * strict PREFIX: rung k's page was a prefix of rung k+1's. With running rows
	 * drawn in place wherever they sit, a newly revealed non-running row can land
	 * ABOVE an already-drawn running row that sits later in the list - so the
	 * claim splits into the three that are still exactly true, and the first two
	 * are the ones the reader feels: nothing already on screen disappears, and
	 * the drawn rows keep their relative order (rung k's sequence is a
	 * subsequence of rung k+1's). What the strict prefix used to add on top is
	 * that no row could appear ABOVE a drawn one, which the exemption
	 * deliberately gives up (hiding live work is the worse failure - see A1).
	 */
	const rows = catalogue();
	for (const arrangeAs of ["active", "created"]) {
		for (const orderBy of ORDERS) {
			const arranged = pageOrder(rows, orderBy, arrangeAs);
			const runningIds = arranged
				.filter((row) => isRunning(row))
				.map((row) => row.session_id);
			let previous = [];
			for (const loads of RUNGS) {
				const page = pageRows(arranged, { limit: pageLimit(loads) });
				const drawn = page.rows.map((row) => row.session_id);
				const label = `${arrangeAs}/${orderBy}: rung ${pageLimit(loads)}`;
				// (i) every live turn is drawn, at every rung.
				for (const id of runningIds) {
					assert.ok(
						drawn.includes(id),
						`${label} withheld the live turn ${id}`,
					);
				}
				// (ii) nothing already on screen disappears...
				for (const id of previous) {
					assert.ok(drawn.includes(id), `${label} dropped the drawn row ${id}`);
				}
				// (iii) ...and the drawn rows keep their relative order.
				assert.deepEqual(
					drawn.filter((id) => previous.includes(id)),
					previous,
					`${label} re-ordered the rows already on screen`,
				);
				// (iv) the quota bounds the non-running rows as one prefix.
				const mundane = page.rows
					.filter((row) => !isRunning(row))
					.map((row) => row.session_id);
				assert.deepEqual(
					mundane,
					arranged
						.filter((row) => !isRunning(row))
						.slice(0, mundane.length)
						.map((row) => row.session_id),
					`${label} drew a non-running row out of the ladder's order`,
				);
				previous = drawn;
			}
		}
	}
});

/* --------------------------------------- T4: idempotence, and a total key */

test("T4 arranging an arranged list is the same list, in every view", () => {
	const rows = catalogue();
	for (const basis of BASES) {
		for (const orderBy of ORDERS) {
			const once = pageOrder(rows, orderBy, basis);
			const twice = pageOrder(once, orderBy, basis);
			assert.deepEqual(
				twice.map((row) => row.session_id),
				once.map((row) => row.session_id),
				`${basis}/${orderBy}: the arrangement is not idempotent`,
			);
		}
	}
});

test("T4 rows whose keys tie keep the catalogue's sequence", () => {
	// Same status, same activity clock, same birth: the input order IS the answer,
	// and it is never resolved by an id or a title.
	const at = (NOW - 5 * 3600) / 1000;
	const rows = [
		{
			session_id: "zzz",
			status: { code: "complete" },
			created_at: at,
			updated_at: at,
		},
		{
			session_id: "aaa",
			status: { code: "complete" },
			created_at: at,
			updated_at: at,
		},
		{
			session_id: "mmm",
			status: { code: "complete" },
			created_at: at,
			updated_at: at,
		},
	];
	assert.deepEqual(
		pageOrder(rows, "active-first", "active").map((row) => row.session_id),
		["zzz", "aaa", "mmm"],
	);
	// And a row that arrives with the same KEY as a held one sits after it, never
	// before: the sort is stable WITH RESPECT TO ARRIVAL by construction, not by
	// the engine's promise.
	const withNew = [
		...rows,
		{
			session_id: "new",
			status: { code: "complete" },
			created_at: at,
			updated_at: at,
		},
	];
	assert.deepEqual(
		pageOrder(withNew, "active-first", "active").map((row) => row.session_id),
		["zzz", "aaa", "mmm", "new"],
	);
});

/* -------------------------------------------------- T5: the nested lists */

test("T5 a nested group's rows arrive arranged, so its labels read newest-first", () => {
	const team = "release-crew";
	const rows = catalogue()
		.filter((row) => row.binding?.team === team || row.binding?.team === null)
		.slice(0, 26)
		.map((row) => ({ ...row, binding: { agent: null, team } }));
	const arranged = pageOrder(rows, "active-first", "active");
	const page = entityRows(arranged, { loads: 0 });
	/*
	 * THE BOUND IS THE QUOTA PLUS THE RUNNING EXEMPTION: ten rows, plus every
	 * running row the arranged list holds (the fixture's group has several). The
	 * drawn NON-running rows are the first ten of the arranged list, in order.
	 */
	const drawnMundane = page.rows.filter((row) => !isRunning(row));
	assert.equal(drawnMundane.length, 10, "the nested bound still cuts at ten");
	assert.deepEqual(
		drawnMundane.map((row) => row.session_id),
		arranged
			.filter((row) => !isRunning(row))
			.slice(0, 10)
			.map((row) => row.session_id),
		"the drawn non-running rows are not the arranged list's prefix",
	);
	// Every drawn row sits in its arranged position, running exemptions included.
	const positions = new Map(
		arranged.map((row, index) => [row.session_id, index]),
	);
	assert.deepEqual(
		page.rows.map((row) => positions.get(row.session_id)),
		[...page.rows.map((row) => positions.get(row.session_id))].sort(
			(a, b) => (a ?? 0) - (b ?? 0),
		),
		"a drawn row is out of the arranged order",
	);
	// And the labels a reader sees are monotone, which the old creation order made
	// false (`15h` under `6d`).
	let previous = null;
	for (const row of page.rows) {
		if (isRunning(row)) continue;
		const at = clockOf(row, "active");
		if (previous !== null && at !== null && at > previous)
			assert.fail(`${row.session_id} is newer than the row above it`);
		if (at !== null) previous = at;
	}
});

test("T5 a nested running row older than the cut is exempt, drawn in the arranged position", () => {
	// A team whose newest ten rows are recent, with one running chat born long
	// ago and no user-message clock yet: under `recent` its key is its birth, so
	// the arrangement puts it past the cut - and the quota exemption is what keeps
	// it on screen.
	const team = "release-crew";
	const recent = Array.from({ length: 12 }, (_, index) => ({
		session_id: `n-${String(index).padStart(2, "0")}`,
		title: `recent ${index}`,
		status: { code: "complete" },
		binding: { agent: null, team },
		created_at: (NOW - (index + 1) * 3600) / 1000,
		updated_at: (NOW - (index + 1) * 3600) / 1000,
	}));
	const oldRunning = {
		session_id: "old-running",
		title: "old running",
		status: { code: "busy" },
		binding: { agent: null, team },
		created_at: (NOW - 40 * 24 * 3600) / 1000,
		updated_at: (NOW - 60) / 1000,
	};
	const rows = [...recent.slice(0, 3), oldRunning, ...recent.slice(3)];
	const arranged = pageOrder(rows, "recent", "active");
	assert.equal(
		arranged[arranged.length - 1].session_id,
		"old-running",
		"the arrangement should put the old running row past the cut",
	);
	const page = entityRows(arranged, { loads: 0 });
	assert.ok(
		page.rows.some((row) => row.session_id === "old-running"),
		"the bound hid live work",
	);
	assert.equal(
		page.rows.findIndex((row) => row.session_id === "old-running"),
		10,
		"the exemption draws the row IN the arranged position, it does not lift it",
	);
	// Under `active-first` the same row leads instead, because the lift is what
	// that ordering is.
	const lifted = pageOrder(rows, "active-first", "active");
	assert.equal(lifted[0].session_id, "old-running");
});

/* ---------------------------- T6: the page never hides live work (A1) */

/*
 * AGENT REVIEW ROUND 1, A1 (MAJOR): `Most recent` could hide live work behind
 * `Show more`. With no running exemption in `pageRows`, a running row whose key
 * sorts past the rung was simply not drawn under `recent` - rung 10, 2 busy + 40
 * completed, 0 busy drawn - while `origin/main` had drawn it because the
 * catalogue's tier happened to put it top. The fix is the rule `entityRows`
 * already uses: running rows cost no quota, so they are drawn IN PLACE and the
 * limit bounds only the rows that are not live. These two tests are the repro,
 * for both orders (and the second for the case the reviewer named: more running
 * rows than the limit).
 */
const A1_BUSY = (id, over = {}) => ({
	session_id: id,
	title: `busy ${id}`,
	status: { code: "busy", label: "Working" },
	// OLD birth, no user message: the key that sorts it LAST under `recent`.
	created_at: (NOW - 40 * 86_400) / 1000,
	updated_at: (NOW - 60) / 1000,
	...over,
});
const A1_DONE = (id, index) => ({
	session_id: id,
	title: `done ${index}`,
	status: { code: "complete", label: "Done" },
	created_at: (NOW - (index + 1) * 3600) / 1000,
	updated_at: (NOW - (index + 1) * 1800) / 1000,
});

test("T6 a live turn is never behind the page cut, in both orders", () => {
	const done = Array.from({ length: 40 }, (_, index) =>
		A1_DONE(`done-${String(index).padStart(2, "0")}`, index),
	);
	// Interleaved: one busy row early, one at the very end, so the strays are
	// tested at both edges of the page.
	const rows = [
		done[0],
		A1_BUSY("busy-early"),
		...done.slice(1),
		A1_BUSY("busy-late"),
	];
	/*
	 * THE REVIEWER'S REPRO FIRST, for both orders, before any other assertion can
	 * fire: under `recent` the busy rows sort past the cut (old birth, no user
	 * message) and under the pre-fix page NOTHING live was drawn at rung 10.
	 */
	for (const orderBy of ORDERS) {
		const drawn = pageRows(pageOrder(rows, orderBy, "active"), {
			limit: 10,
		}).rows.map((row) => row.session_id);
		assert.ok(
			drawn.includes("busy-early") && drawn.includes("busy-late"),
			`${orderBy}: a live turn fell behind the cut (drawn ${drawn.length} of ${rows.length}: [${drawn.join(", ")}])`,
		);
	}
	/*
	 * THE CLOSED FORM the page now IS, asserted directly: the first ten rows of
	 * the arrangement, plus every running row the window did not reach - drawn in
	 * place, so the drawn set is a subsequence of the arranged list. (The
	 * entityRows-shaped alternative - running rows costing no quota - was
	 * implemented and MEASURED: it makes the page size a function of the live
	 * set, evicting the tail row on every completion; the geometry rig turned
	 * three cells red on the one-row clamps. `chat-sidebar-view.ts`'s `pageRows`
	 * carries that measurement.)
	 */
	for (const orderBy of ORDERS) {
		const arranged = pageOrder(rows, orderBy, "active");
		const page = pageRows(arranged, { limit: 10 });
		const drawn = page.rows.map((row) => row.session_id);
		assert.deepEqual(
			drawn,
			arranged
				.filter((row, index) => index < 10 || isRunning(row))
				.map((row) => row.session_id),
			`${orderBy}: the page is not the window plus the live rows beyond it`,
		);
		assert.deepEqual(
			drawn,
			arranged
				.filter((row) => drawn.includes(row.session_id))
				.map((row) => row.session_id),
			`${orderBy}: a drawn row is out of the arranged order`,
		);
		// And the foot's own number agrees with what is actually drawn.
		assert.equal(
			page.remaining,
			rows.length - drawn.length,
			`${orderBy}: remaining does not count what is withheld`,
		);
	}
});

test("T6 more live rows than the window: every one draws, and the window grows cleanly", () => {
	const running = Array.from({ length: 12 }, (_, index) =>
		A1_BUSY(`run-${String(index).padStart(2, "0")}`, {
			created_at: (NOW - (index + 1) * 86_400) / 1000,
		}),
	);
	const done = Array.from({ length: 30 }, (_, index) =>
		A1_DONE(`done-${String(index).padStart(2, "0")}`, index),
	);
	const rows = [...done.slice(0, 5), ...running, ...done.slice(5)];
	for (const orderBy of ORDERS) {
		const arranged = pageOrder(rows, orderBy, "active");
		const page = pageRows(arranged, { limit: 10 });
		// Every live row draws...
		assert.equal(
			page.rows.filter((row) => isRunning(row)).length,
			12,
			`${orderBy}: a live turn was dropped when the band outnumbers the page`,
		);
		// ...in place, as the window plus strays (under `active-first` the twelve
		// running rows fill the whole window and no completed row is drawn yet).
		assert.deepEqual(
			page.rows.map((row) => row.session_id),
			arranged
				.filter((row, index) => index < 10 || isRunning(row))
				.map((row) => row.session_id),
			`${orderBy}: the window-plus-strays shape does not hold past the window`,
		);
		// Pressing once: the window reaches past the running band.
		const more = pageRows(arranged, { limit: pageLimit(1) });
		assert.ok(
			more.rows.filter((row) => !isRunning(row)).length > 0,
			`${orderBy}: the first press still reveals no completed row`,
		);
	}
});

/* ------------------- the guards round 1 found unguarded (A6) */

test("runningOrderMs refuses a zero, negative or NaN last-user stamp", () => {
	const born = (NOW - 3 * 3600) / 1000;
	const base = { session_id: "x", status: { code: "busy" }, created_at: born };
	/*
	 * THE GUARD THE REVIEW FOUND UNTESTED: removing `lastUser > 0` left the file
	 * green, and the failure mode is the `56y` class one layer down - a zero is
	 * the wire's "no claim" and must fall through to the birth, never key the row
	 * at 1970 and never make it sort as if it were exactly that old.
	 */
	assert.equal(runningOrderMs({ ...base }), born * 1000);
	assert.equal(
		runningOrderMs({ ...base, last_user_at: 0 }),
		born * 1000,
		"zero is no claim",
	);
	assert.equal(
		runningOrderMs({ ...base, last_user_at: -60 }),
		born * 1000,
		"negative is no claim",
	);
	assert.equal(
		runningOrderMs({ ...base, last_user_at: Number.NaN }),
		born * 1000,
		"NaN is no claim",
	);
	assert.equal(
		runningOrderMs({ ...base, last_user_at: born + 60 }),
		(born + 60) * 1000,
		"a real user-message stamp is the key",
	);
});

test("the needs-you band is a subset of the running codes", () => {
	/*
	 * WHY THIS IS ITS OWN TEST: `pageOrder` reads the two sets in order -
	 * `isStoppedOnReader` first, then `isRunningRow` - so a code that stopped on
	 * the reader but dropped out of the running set would be lifted to lane 0
	 * while every OTHER rule (the page cut's exemption, the Running section's
	 * membership) treated it as an ordinary row. That split is the bug this
	 * pins: the band and the set must agree about which rows are live.
	 */
	for (const code of STOPPED_ON_READER_CODES) {
		assert.ok(
			RUNNING.has(code),
			`${code} stops on the reader but is not a running code`,
		);
	}
});
