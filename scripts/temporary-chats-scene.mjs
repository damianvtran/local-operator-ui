/**
 * `--scene temporary-chats`: the temporary-chats surfaces in the BUILT app,
 * against `docs/evidence/temporary-chats/harness/stub-daemon.mjs` (the core half
 * is its own pull request, so the daemon is a stand-in that answers the frozen
 * wire; the app, its store, its sidebar, header, menu, chord and tombstone are
 * the real ones).
 *
 * Two arms, chosen by `--temporary-expect`:
 *
 * - `on`: the stub advertises `features.temporary_chats`. The scene asserts and
 *   photographs the sidebar's `Temporary · N` group (closed, then open), the
 *   live pill, the last-five-minutes countdown pill with its Keep action, the
 *   header menu's Keep chat and Make temporary…, the confirmation, the draft's
 *   dashed toggle off (Cmd/Ctrl+N) and on (Cmd/Ctrl+Shift+N), and the tombstone
 *   for a deleted temporary chat.
 * - `withdrawn`: the stub is run with `--no-temporary` (an older core). The same
 *   steps assert that NOTHING new is drawn - no group, no pill, no menu item, no
 *   toggle, the generic missing notice - and take the before frames.
 *
 * Every frame name carries the palette (`--theme`), and every check reads the
 * DOM rather than trusting the press that preceded it.
 */

const flag = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const PALETTE_SLUG = {
	localOperatorDark: "dark",
	localOperatorLight: "light",
};

// The stub's fixture ids (`stub-daemon.mjs`).
const NORMAL = "e059761608ae";
const LIVE = "c0ffee5a1e01";
const COUNTDOWN = "c0ffee5a1e02";
const DELETED = "c0ffee5a1e04";
// The countdown row is 4.5 min from deletion; the pill rounds up to whole minutes.
const COUNTDOWN_TEXT = /Deletes in [45] min/;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sceneTemporaryChats({
	cdp,
	verb,
	capture,
	check,
	note,
	waitForCondition,
	pressChord,
	modifier,
	shift,
}) {
	const expect = flag("--temporary-expect") ?? "on";
	if (expect !== "on" && expect !== "withdrawn") {
		throw new Error(
			`--temporary-expect must be "on" or "withdrawn" (got ${JSON.stringify(expect)}): the two arms make opposite claims`,
		);
	}
	const on = expect === "on";
	const theme = flag("--theme") ?? "localOperatorDark";
	const palette = PALETTE_SLUG[theme];
	if (!palette)
		throw new Error(
			`--theme must be one of ${Object.keys(PALETTE_SLUG).join(", ")}`,
		);
	const label = (name) => `${on ? "after" : "before"}-${name}-${palette}`;
	const shot = async (name) => {
		const frame = await capture(cdp, label(name));
		note("frame", JSON.stringify(frame));
	};
	const present = (selector) =>
		cdp.evaluate(
			`document.querySelector(${JSON.stringify(selector)}) !== null`,
		);
	const textOf = (selector) =>
		cdp.evaluate(
			`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? "").trim()`,
		);
	const until = (expr, ms = 10_000) => waitForCondition(cdp, expr, ms);
	const openMenu = async () => {
		await verb(cdp, "press", {
			selector: '[aria-label="Conversation actions"]',
		});
		await until(`document.querySelector('[role="menu"]') !== null`, 5_000);
		await wait(250);
	};
	const closeMenu = async () => {
		await pressChord(cdp, {
			key: "Escape",
			code: "Escape",
			virtualKeyCode: 27,
		});
		await until(`document.querySelector('[role="menu"]') === null`, 5_000);
	};
	const openRow = async (id) => {
		await verb(cdp, "navigate", `/chat/${id}`);
		await until(
			`document.querySelector('[data-tour-tag="pane-row"]') !== null || document.querySelector('[aria-label="Conversation actions"]') !== null`,
			15_000,
		);
		await wait(800);
	};

	await verb(cdp, "setTheme", theme);
	await verb(cdp, "navigate", "/chat");
	const listed = await until(
		`document.querySelector('[data-session-row="${NORMAL}"]') !== null`,
		20_000,
	);
	check(
		"the catalogue answered",
		listed.ok,
		`no row ${NORMAL} after ${listed.waitedMs}ms`,
	);
	await wait(600);

	// 1. The sidebar at rest: the group (closed) or nothing.
	const group = await present("[data-sidebar-temporary-group]");
	check(
		on
			? "the Temporary group is drawn"
			: "no Temporary group without the capability",
		group === on,
		`[data-sidebar-temporary-group] present: ${group}`,
		on ? await textOf('[data-chat-section="temporary"]') : "absent",
	);
	const leaked = await cdp.evaluate(
		`[${JSON.stringify(LIVE)}, ${JSON.stringify(COUNTDOWN)}].filter((id) => document.querySelector('[data-session-row="' + id + '"]') !== null)`,
	);
	check(
		"no temporary chat is in the normal list",
		leaked.length === 0,
		`drawn as normal rows: ${leaked.join(", ")}`,
		"none",
	);
	await shot("sidebar");

	if (on) {
		await verb(cdp, "press", { selector: '[data-chat-section="temporary"]' });
		const opened = await until(
			`document.querySelectorAll('[data-temporary-row]').length === 3`,
			5_000,
		);
		check(
			"the group opens onto its three rows",
			opened.ok,
			`after ${opened.waitedMs}ms`,
		);
		const amber = await present(
			`[data-temporary-row="${COUNTDOWN}"] [data-temporary-countdown]`,
		);
		check(
			"only the last-five-minutes row counts down in amber",
			amber,
			"no countdown on the 4.5 min row",
		);
		await shot("sidebar-group-open");
	}

	// 2. A live temporary chat's header: the pill (or nothing).
	await openRow(LIVE);
	const pill = await cdp.evaluate(
		`document.querySelector('[data-session-temporary-pill]')?.getAttribute('data-session-temporary-pill') ?? null`,
	);
	check(
		on
			? "the live chat wears the dashed Temporary pill"
			: "no pill without the capability",
		on ? pill === "live" : pill === null,
		`pill: ${pill}`,
		pill ?? "absent",
	);
	if (on) {
		const groupOpen = await cdp.evaluate(
			`document.querySelector('[data-chat-section="temporary"]')?.getAttribute('aria-expanded')`,
		);
		note(
			"the group's state with the temporary chat on screen",
			String(groupOpen),
		);
	}
	await shot("live-pill");
	await openMenu();
	const keep = await present("[data-temporary-keep]");
	check(
		on ? "the menu offers Keep chat" : "the menu offers no Keep chat",
		keep === on,
		`[data-temporary-keep] present: ${keep}`,
	);
	await shot("menu-keep");
	await closeMenu();

	// 3. The last five minutes.
	if (on) {
		await openRow(COUNTDOWN);
		const countdown = await textOf('[data-session-temporary-pill="countdown"]');
		check(
			"the pill counts down in its last five minutes",
			COUNTDOWN_TEXT.test(countdown),
			`read "${countdown}"`,
			countdown,
		);
		await shot("countdown-pill");
	}

	// 4. An ordinary chat: Make temporary… and its confirmation.
	await openRow(NORMAL);
	await openMenu();
	const make = await present("[data-temporary-make]");
	check(
		on
			? "an ordinary chat's menu offers Make temporary…"
			: "no Make temporary… without the capability",
		make === on,
		`[data-temporary-make] present: ${make}`,
	);
	await shot("menu-make");
	if (on) {
		await verb(cdp, "press", { selector: "[data-temporary-make]" });
		const dialog = await until(
			`document.querySelector('[data-make-temporary-dialog]') !== null`,
			5_000,
		);
		check(
			"Make temporary… asks first",
			dialog.ok,
			`no dialog after ${dialog.waitedMs}ms`,
		);
		await wait(300);
		await shot("confirm");
		await pressChord(cdp, {
			key: "Escape",
			code: "Escape",
			virtualKeyCode: 27,
		});
		await wait(300);
	} else {
		await closeMenu();
	}

	// 5. A draft: Cmd/Ctrl+N (toggle off) and Cmd/Ctrl+Shift+N (toggle on).
	await pressChord(cdp, {
		key: "n",
		code: "KeyN",
		virtualKeyCode: 78,
		modifiers: modifier,
	});
	await wait(800);
	const toggleOff = await cdp.evaluate(
		`document.querySelector('[data-temporary-toggle]')?.getAttribute('aria-pressed') ?? null`,
	);
	check(
		on
			? "a new chat's header carries the dashed toggle, off"
			: "a new chat has no toggle",
		on ? toggleOff === "false" : toggleOff === null,
		`aria-pressed: ${toggleOff}`,
		String(toggleOff),
	);
	await shot("draft-toggle-off");
	await pressChord(cdp, {
		key: "N",
		code: "KeyN",
		virtualKeyCode: 78,
		modifiers: modifier | shift,
	});
	await wait(800);
	const toggleOn = await cdp.evaluate(
		`document.querySelector('[data-temporary-toggle]')?.getAttribute('aria-pressed') ?? null`,
	);
	check(
		on
			? "Cmd/Ctrl+Shift+N starts a temporary draft (toggle on)"
			: "Cmd/Ctrl+Shift+N does nothing new",
		on ? toggleOn === "true" : toggleOn === null,
		`aria-pressed: ${toggleOn}`,
		String(toggleOn),
	);
	if (on) await shot("draft-toggle-on");

	// 6. A deleted temporary chat: the tombstone (or the generic notice).
	await verb(cdp, "navigate", `/chat/${DELETED}`);
	const settled = await until(
		on
			? `document.querySelector('[data-missing-session-notice="temporary"]') !== null`
			: `document.querySelector('[data-missing-session-notice]') !== null`,
		15_000,
	);
	const kind = await cdp.evaluate(
		`document.querySelector('[data-missing-session-notice]')?.getAttribute('data-missing-session-notice') ?? null`,
	);
	check(
		on
			? "a deleted temporary chat lands on its tombstone"
			: "an older core paints the generic notice",
		settled.ok && kind === (on ? "temporary" : "generic"),
		`notice: ${kind} after ${settled.waitedMs}ms`,
		String(kind),
	);
	if (on) {
		const actions = await cdp.evaluate(
			`Array.from(document.querySelectorAll('[data-temporary-tombstone-action]')).map((b) => b.textContent.trim())`,
		);
		check(
			"the tombstone offers New temporary chat and Back to chats",
			actions.join("|") === "New temporary chat|Back to chats",
			`actions: ${actions.join("|")}`,
			actions.join(" | "),
		);
	}
	await shot("tombstone");
}
