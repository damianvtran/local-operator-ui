/**
 * What makes a frame in `docs/evidence/new-chat-row/` a picture of the SEEDED
 * app rather than a picture of a broken one.
 *
 *     import { assertHealthyFrame } from "./new-chat-row-evidence.mjs";
 *
 * WHY THIS EXISTS. Round 1 of PR #139 published two light-theme frames
 * (`after-new-chat-focus`, `after-new-chat-current`) that were captured while
 * the isolated backend was down: the sidebar carried the capability error
 * ("The backend could not complete this request. … Retry refresh") plus the
 * connectivity banner, every list label rendered dimmed, and Tab-ing to the
 * row scrolled the pinned partition to reveal it (`newChat.y` 503.83 against
 * 568 in the other fourteen frames). The capture guard in force at the time
 * asserted only that the All chats row existed and read the seeded total, and
 * both held anyway — the capability error is not a catalogue failure, so the
 * counts arrived from cache and every per-frame check passed. A degraded run
 * could therefore be published by luck.
 *
 * The property that was missing is the one this module states: a frame is
 * evidence only if the WHOLE seeded fixture is on screen (all three global
 * counts, not just the All chats one) and no error surface is present. The
 * counts are what make the check load-bearing, because they land on later
 * desktop calls than the rows do — `Active chats 2` / `Previous chats 32` are
 * exactly the terms a half-arrived catalogue gets wrong, and the fixture totals
 * are `seed.mjs`'s, so they are a fact about the seeded run rather than a
 * restatement of whatever happened to render.
 *
 * CALLED FROM TWO PLACES, deliberately:
 *   - the capture harness, per frame, so a degraded run FAILS rather than
 *     publishing (`out/evidence-harness/capture.mjs`, gitignored);
 *   - `scripts/new-chat-row-evidence.test.mjs`, over the committed readbacks,
 *     so the shipped set is checked on every `pnpm test:desktop` run without
 *     re-running Chrome.
 *
 * The two callers see slightly different records: the capture passes the live
 * probe (signals always present), and a committed readback only carries the
 * signals its own probe recorded. `requireSignals` is how a caller says which
 * contract it wants — the capture and the post-re-capture readbacks ask for the
 * full one; the older `before-` readback, captured before the signal block
 * existed, is checked on the fields it carries.
 */

/**
 * `seed.mjs`'s fixture, as the sidebar renders it.
 *
 * Pinned here rather than copied from the readback on purpose: a guard that
 * derives its expectation from the artefact it is judging cannot fail.
 */
export const SEEDED_CATALOGUE = Object.freeze({
	sessions: 34,
	allChats: "All chats 34",
	activeChats: "Active chats 2",
	previousChats: "Previous chats 32",
});

/**
 * Copy that only reaches the sidebar when a desktop call has failed.
 *
 * `chat-sidebar.tsx` renders the capability failure as `role="alert"` plus a
 * `Retry` control (:467-480) and the "Retry refresh" footer (:686-697). None of
 * it belongs in a frame of a healthy catalogue, and the failure that produced
 * D5 is exactly the case where the rest of the frame still looked plausible.
 */
export const ERROR_COPY = Object.freeze([
	"could not complete this request",
	"will not function properly",
	"Retry",
]);

/**
 * `connectivity-banner.tsx`'s three copies, which render OUTSIDE the sidebar.
 *
 * The banner is the shell's own first child (D9: it was `fixed inset-x-0 top-0`
 * until then, and the TEXT is what these copies are matched on, not the
 * positioning) with `role="alert"` and a `Retry` button, so every
 * sidebar-scoped check misses it: on the re-capture that
 * produced this module's first failure, `nav` had no alert and the counts read
 * their fixture totals while the window-level banner was up, and only the Tab
 * walk (which starts at the banner's own button) noticed. The hook behind it
 * polls `/health` every 5s and a single failed poll raises it, so a rig whose
 * `VITE_LOCAL_OPERATOR_API_URL` does not answer `/health` renders a permanently
 * offline sidebar — a whole run's worth of frames that look reasonable and are
 * not the surface this set claims.
 */
export const BANNER_COPY = Object.freeze([
	"will not function properly",
	"You are offline.",
	"A connectivity issue has been detected.",
]);

/**
 * Assertion helper: throw rather than return, so a caller cannot ignore it.
 *
 * @param {object} frame  a capture probe record or one entry of a committed
 *   `*-readback.json`
 * @param {object} [options]
 * @param {number} [options.baselineY]  `newChat.box.y` from the same run's
 *   `sidebar-rest` frame. The row must not move between states of one run: the
 *   row is the LAST thing in the pinned partition, so any scroll introduced by
 *   a frame taken at a different height shows up here and nowhere else.
 * @param {boolean} [options.requireSignals]  demand the error-surface fields
 *   rather than checking only the ones present.
 */
export function assertHealthyFrame(frame, options = {}) {
	const { baselineY, requireSignals = false } = options;
	const where = `${frame.state ?? "frame"} (${frame.theme ?? "unknown theme"})`;
	const fail = (why) => {
		throw new Error(`${where}: ${why}`);
	};

	if (frame.allChatsText !== SEEDED_CATALOGUE.allChats) {
		fail(
			`the All chats row reads ${JSON.stringify(frame.allChatsText)}, not ${JSON.stringify(SEEDED_CATALOGUE.allChats)} — the seeded catalogue was still arriving when this frame was taken`,
		);
	}

	// The split totals are the fixture's own terms and arrive on a LATER poll
	// than the rows do, so they are the part of the catalogue a frame taken too
	// early gets wrong while the rows themselves look fine.
	const split = [
		["activeChatsText", SEEDED_CATALOGUE.activeChats],
		["previousChatsText", SEEDED_CATALOGUE.previousChats],
	];
	for (const [field, expected] of split) {
		const actual = frame[field];
		if (actual === undefined) {
			if (requireSignals) {
				fail(
					`carries no ${field} readback, so nothing here rules out an unseeded or half-arrived catalogue`,
				);
			}
			continue;
		}
		if (actual !== expected) {
			fail(
				`the ${field === "activeChatsText" ? "Active" : "Previous"} chats heading reads ${JSON.stringify(actual)}, not ${JSON.stringify(expected)} — the seeded catalogue was still arriving when this frame was taken`,
			);
		}
	}

	if (baselineY !== undefined && frame.newChat?.box) {
		if (frame.newChat.box.y !== baselineY) {
			fail(
				`the New chat row sits at y=${frame.newChat.box.y} where the same run's rest frame has it at y=${baselineY} — the panel is scrolled, which is what an error banner above the list does`,
			);
		}
	}

	const traversal = frame.keyboard?.traversal ?? frame.traversal;
	if (Array.isArray(traversal)) {
		const stop = traversal.find((s) => (s?.label ?? "").trim() === "Retry");
		if (stop) {
			fail(
				`the keyboard walk passes a ${JSON.stringify(stop.label)} control, which only renders beside a failed desktop call`,
			);
		}
	}

	if (requireSignals && typeof frame.alerts !== "number") {
		fail(
			"carries no `[role=alert]` count, so nothing here rules out an error surface in the sidebar",
		);
	}
	if (typeof frame.alerts === "number" && frame.alerts > 0) {
		fail(
			`the sidebar carries ${frame.alerts} \`[role=alert]\` node(s) — this set documents a healthy catalogue, and an error surface means it is a frame of something else`,
		);
	}

	if (typeof frame.navText === "string") {
		for (const copy of ERROR_COPY) {
			if (frame.navText.includes(copy)) {
				fail(
					`the sidebar text contains ${JSON.stringify(copy)}, which only renders after a failed desktop call`,
				);
			}
		}
	} else if (requireSignals) {
		fail("carries no sidebar text, so nothing here rules out an error surface");
	}

	if (requireSignals && typeof frame.navScroll !== "number") {
		fail(
			"carries no scroll readback, so nothing here rules out a scrolled panel",
		);
	}
	if (typeof frame.navScroll === "number" && frame.navScroll > 0) {
		fail(
			`the sidebar's scroll containers are scrolled by ${frame.navScroll}px — the pinned partition only scrolls when something above the list changes its height`,
		);
	}

	if (requireSignals && typeof frame.bannerText !== "string") {
		fail(
			"carries no document-wide alert text, so nothing here rules out the window-level connectivity banner",
		);
	}
	if (typeof frame.bannerText === "string") {
		for (const copy of BANNER_COPY) {
			if (frame.bannerText.includes(copy)) {
				fail(
					`the connectivity banner is up (${JSON.stringify(copy)}), which means the app had decided the server was gone — outside the sidebar, so only this check and the Tab walk can see it`,
				);
			}
		}
	}
}

/**
 * `baselineY` for one theme's run: the `sidebar-rest` frame's row position.
 *
 * Exported because both callers need the same rule and it must not drift: the
 * rest frame is the only state in a run taken before any key or pointer event.
 */
export function baselineRows(frames) {
	const baselines = new Map();
	for (const frame of frames) {
		if (!String(frame.state ?? "").endsWith("sidebar-rest")) continue;
		if (frame.newChat?.box) baselines.set(frame.theme, frame.newChat.box.y);
	}
	return baselines;
}
