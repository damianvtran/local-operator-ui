/* ------------------------------------------------------------------------- *
 * `team-newchat`: a New chat with a team whose replayed draft receipt names a
 * warm id the daemon can no longer serve - and the missing notice's way out.
 *
 * WHY THIS MODULE. `scripts/renderer-driver.mjs` sits under Biome's 2 MiB
 * single-file ceiling, so this scene joins the agent-messages, library-asset,
 * sidebar-layout and sounds scenes in its own module. The driver passes its own
 * `check`, `note`, `wait`, `capture` and input helpers in, so every assertion and
 * frame here runs on the same instruments as an inline scene.
 *
 * THE DEFECT THIS PHOTOGRAPHS (the operator's report, 2026-10-23). A team's New
 * chat keys a STABLE draft row (`draft:team:<name>`) and its `draftRequestId`
 * persists across launches. A daemon that restarted - or a draft that expired -
 * answers that request's receipt by REPLAYING the id it minted the first time,
 * an id its registry no longer serves. The pane's stream is
 * `sessionId ?? draft.warmId`, so the bridge 404s; on the base tree the renderer
 * read that as "the conversation is missing" and painted the terminal notice
 * under a header that says "New chat with <team>". The fix retires the dead warm
 * and keeps the pane a working new chat.
 *
 * WHAT THE FOUR EXPECTATIONS ANSWER.
 *   - `--expect broken` is the BEFORE half, run on the base tree: after one
 *     keystroke the notice is on screen, the draft row still holds the seeded
 *     request id, and the send cannot produce a transcript because the composer
 *     has become the refused one. A pass here is evidence of the defect, not of
 *     the fix.
 *   - `--expect fresh` is the AFTER half: no notice, the typed 'C' still in the
 *     box, the row's request id re-minted (the dead id's receipt can never hand
 *     it back), and the first send rendering a transcript bubble. It also
 *     installs an in-page probe over the 404 -> retire -> next-mint window, so
 *     the claim is "the notice was never PAINTED", not merely "it is absent in
 *     the settled frame" (design round 1 D2 / UX round 1 U1).
 *   - `--expect immediate` races the SEND into that window: the words and Enter
 *     go in without waiting for the mint or the 404, and the run reports what
 *     the race did (bubble, delivery, notice/refusal paints, ordering) rather
 *     than asserting one of the two legal outcomes.
 *   - `--expect carry` is the SECOND changed surface: a genuinely missing
 *     materialised conversation (a real route to an id the daemon does not
 *     serve), a composer holding text and a chip, the notice's own
 *     Start-a-new-chat press, the new chat that must hold exactly that box, and
 *     a reload proving the way out survives (design round 1 D1 / UX round 1 U2 /
 *     QA Q1). It needs no daemon receipt: the id is missing by construction.
 *
 * WHAT A FRAME HERE CAN AND CANNOT CLAIM. The draft halves seed the operator's
 * persisted shape into an isolated profile and then RELOAD, so the pane mounts
 * the way it did after a relaunch. The 404 is the daemon's own: the run's
 * precondition minted D, materialised a conversation on it, deleted that
 * conversation and restarted the daemon - see the PR for the exact commands. The
 * scene cannot manufacture a daemon restart, so it asserts what the screen did
 * with the answer that came back, not why the answer was a 404; the serve log's
 * `GET /v1/desktop/sessions/<D>/events` lines are counted beside the frames. The
 * 404 itself is not observable in the page (it arrives over IPC from main), so
 * the probe's clock starts at the keystroke and the first observable consequence
 * is the store's re-minted request id - the report says so rather than dressing
 * a sampling bound as an exact instant.
 * ------------------------------------------------------------------------- */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The driver's argv, read here for the same reason the sidebar-layout and
 * library-asset scenes read their own: the driver is at Biome's single-file
 * ceiling, so its dispatch passes the helpers and every flag is read from the
 * same argv it parsed.
 */
const flagValue = (name) => {
	const at = process.argv.indexOf(name);
	if (at === -1) return null;
	const value = process.argv[at + 1];
	return value === undefined || value.startsWith("--") ? null : value;
};

const TEAM = flagValue("--team");
const TEAM_LABEL = flagValue("--team-label");
const DRAFT_REQUEST_ID = flagValue("--draft-request-id");
const EXPECT = flagValue("--expect");
const BACKEND = flagValue("--backend");
const BACKEND_RECORDS = flagValue("--backend-records");

/** The composer the scene types into, addressed the way the other scenes do. */
const COMPOSER = '[data-tour-tag="chat-input-textarea"] textarea';
/** `MISSING_SESSION_NOTICE_ID` - the one spelling of the pane's notice. */
const NOTICE = "#lo-missing-session-notice";
/**
 * The notice's own action, addressed as a sibling of the sentence that names it:
 * the block renders `<p id=.../><p/><Button/>` in one column, so the button is
 * the notice paragraph's next sibling. No id was added to shipped code for a rig.
 */
const NOTICE_ACTION = `${NOTICE} ~ button`;
/**
 * The header row's landmark. `data-chat-region="header"` is the app's own
 * vocabulary (the walk's first region), not a class name that a restyle renames.
 */
const HEADER = '[data-chat-region="header"]';
/**
 * A 12-hex id this daemon does not serve. The desktop session id's own shape
 * (`SESSION_ID` in `chat-page`), so the route effect accepts it as a session and
 * the session arm's 404 paints the notice - the genuine missing conversation.
 */
const MISSING_ID = "abcdef123456";
/** The words and the chip the missing conversation's box is holding. */
const CARRY_TEXT = "carry-me";
const CARRY_SUFFIX = " and then some";
const CARRY_CHIP_ID = "carry-chip-0001";

const draftKeyOf = (team) => `draft:team:${team}`;

/** The bearer, from this script's environment and never from argv. */
const desktopBearer = () => {
	const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	if (!token) {
		throw new Error(
			"--scene team-newchat reads its bearer from LOCAL_OPERATOR_DESKTOP_TOKEN in this script's environment, never from argv: without it the precondition cannot be read back and the app cannot authenticate",
		);
	}
	return token;
};

/**
 * The id the pane's bridge stream addressed: the daemon's own answer for the
 * seeded request id.
 *
 * This is why the scene reads it from the BACKEND rather than from the page: a
 * draft's `warmId` is deliberately NOT persisted (`partialize` strips it - a
 * reload cannot know whether the registry survived), so a localStorage read can
 * never see it. Replaying the receipt asks the same question the pane's first
 * keystroke asked and gets the same id - `replayed: true` is what says the answer
 * is a receipt rather than a new mint.
 */
async function streamedDraftId(team, requestId) {
	const response = await fetch(`${BACKEND}/v1/desktop/sessions/draft`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${desktopBearer()}`,
		},
		body: JSON.stringify({
			request_id: requestId,
			cwd: "~",
			target: { kind: "team", name: team },
		}),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(
			`the daemon refused the seeded request id: ${response.status} ${JSON.stringify(body)}`,
		);
	}
	// The desktop plane wraps every result in `{status, message, result}`; the id
	// is the envelope's payload, not a top-level field.
	return body?.result?.draft_id ?? null;
}

/**
 * THE WINDOW BETWEEN THE 404 AND THE NEXT MINT, sampled from inside the page.
 *
 * WHY THIS EXISTS (design round 1 D2, UX round 1 U1). A settled frame proves the
 * destination, not the transition: a notice painted for two frames and replaced
 * before `captureSettled` would pass every settled assertion. So the probe
 * samples the DOM on EVERY mutation and every animation frame, and on every
 * persisted write of the canonical store, and records only changes: whether the
 * notice is in the document, whether the composer is refused, what it holds, and
 * the row's request id. The first sample that states each fact is kept.
 *
 * The `Storage.prototype.setItem` wrapper is rig instrumentation in this page
 * session only - it records the store's OWN writes rather than changing them;
 * nothing in the repository is patched. `MutationObserver` is what makes "the
 * notice was never painted" a statement about every DOM state, not about the
 * 60 Hz the RAF loop happens to see.
 */
async function installProbe(cdp, draftKey) {
	await cdp.evaluate(`(() => {
		const boxOf = () => document.querySelector(${JSON.stringify(COMPOSER)});
		const noticeOf = () => document.querySelector(${JSON.stringify(NOTICE)});
		const readRequestId = () => {
			try {
				return JSON.parse(localStorage.getItem("canonical-sessions-storage") || "null")
					?.state?.drafts?.[${JSON.stringify(draftKey)}]?.draftRequestId ?? null;
			} catch { return null; }
		};
		const started = performance.now();
		const probe = {
			startedAt: Date.now(),
			samples: [],
			last: null,
			noticeAt: null,
			refusedAt: null,
			requestIdAt: null,
			usableAt: null,
		};
		globalThis.__teamNewchatProbe = probe;
		const sample = (phase) => {
			const t = Math.round(performance.now() - started);
			const notice = noticeOf();
			const box = boxOf();
			const requestId = readRequestId();
			const rec = {
				t,
				phase,
				notice: notice !== null,
				readOnly: box ? box.readOnly : null,
				disabled: box ? box.disabled : null,
				value: box ? box.value : null,
				focused: box ? document.activeElement === box : null,
				requestId,
			};
			const last = probe.last;
			if (
				last &&
				last.notice === rec.notice &&
				last.readOnly === rec.readOnly &&
				last.disabled === rec.disabled &&
				last.value === rec.value &&
				last.focused === rec.focused &&
				last.requestId === rec.requestId
			) return;
			if (probe.samples.length < 120) probe.samples.push(rec);
			probe.last = rec;
			if (rec.notice && probe.noticeAt === null) probe.noticeAt = t;
			if ((rec.readOnly === true || rec.disabled === true) && probe.refusedAt === null)
				probe.refusedAt = t;
			if (
				rec.requestId !== null &&
				rec.requestId !== ${JSON.stringify(DRAFT_REQUEST_ID)} &&
				probe.requestIdAt === null
			) probe.requestIdAt = t;
			if (
				!rec.notice &&
				rec.readOnly === false &&
				rec.disabled === false &&
				probe.usableAt === null
			) probe.usableAt = t;
		};
		sample("install");
		const tick = () => {
			sample("raf");
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		const observer = new MutationObserver(() => sample("mutation"));
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		});
		const storage = window.Storage && window.Storage.prototype;
		if (storage && storage.setItem && !storage.__teamNewchatProbeWrapped) {
			storage.__teamNewchatProbeWrapped = true;
			const original = storage.setItem;
			storage.setItem = function (key, value) {
				const out = original.call(this, key, value);
				if (key === "canonical-sessions-storage") sample("write");
				return out;
			};
		}
		return true;
	})()`);
}

async function readProbe(cdp) {
	return cdp.evaluate(`(() => {
		const p = globalThis.__teamNewchatProbe;
		if (!p) return null;
		return {
			startedAt: p.startedAt,
			noticeAt: p.noticeAt,
			refusedAt: p.refusedAt,
			requestIdAt: p.requestIdAt,
			usableAt: p.usableAt,
			sampleCount: p.samples.length,
			samples: p.samples.slice(0, 24),
		};
	})()`);
}

/**
 * Everything a reading of this pane needs, from the app's own state.
 *
 * The draft rows are read from `localStorage` because that is where the store
 * persists them - `warmId` is stripped there (runtime state), so a row's presence
 * in `drafts` and the request id it holds are the claims available; the composer
 * rows come from the input store's own persisted slice (which keeps attachments,
 * so the carried chip is readable).
 */
async function readScreen(cdp) {
	return cdp.evaluate(`(() => {
		const read = (key) => {
			try { return JSON.parse(localStorage.getItem(key) || "null")?.state ?? null; } catch { return null; }
		};
		const canonical = read("canonical-sessions-storage");
		const input = read("conversation-input-store");
		const notice = document.querySelector(${JSON.stringify(NOTICE)});
		const box = document.querySelector(${JSON.stringify(COMPOSER)});
		const header = document.querySelector(${JSON.stringify(HEADER)});
		const noticeBlock = notice ? notice.parentElement : null;
		return {
			activeDraftKey: canonical?.activeDraftKey ?? null,
			activeSessionId: canonical?.activeSessionId ?? null,
			drafts: Object.fromEntries(
				Object.entries(canonical?.drafts ?? {}).map(([key, row]) => [
					key,
					{ sessionId: row?.sessionId ?? null, draftRequestId: row?.draftRequestId ?? null },
				]),
			),
			inputs: Object.fromEntries(
				Object.entries(input?.inputByConversation ?? {}).map(([key, row]) => [
					key,
					{
						currentInput: row?.currentInput ?? "",
						pendingText: row?.pendingText ?? null,
						attachments: (row?.attachments ?? []).map((chip) => chip?.path ?? null),
					},
				]),
			),
			notice: notice === null ? null : (notice.textContent || "").trim(),
			// The detail line is the block's SECOND paragraph; reading the block's text
			// and subtracting the first paragraph leaves the action's label glued on.
			noticeDetail: noticeBlock
				? Array.from(noticeBlock.querySelectorAll("p"))
						.slice(1)
						.map((paragraph) => paragraph.textContent || "")
						.join(" ")
						.trim()
				: null,
			noticeAction: noticeBlock ? (noticeBlock.querySelector("button")?.textContent || "").trim() : null,
			header: header === null ? null : (header.textContent || "").trim(),
			composer: box === null ? null : { value: box.value, readOnly: box.readOnly === true, disabled: box.disabled === true },
			focus: box === null ? null : {
				focused: document.activeElement === box,
				start: box.selectionStart,
				end: box.selectionEnd,
			},
			chipCount: document.querySelectorAll('[aria-label="Remove attachment"]').length,
		};
	})()`);
}

/**
 * `--scene team-newchat`. Dispatches the four expectations; the daemon's
 * precondition is the caller's (see `run-leg.sh` in the evidence README).
 */
export async function sceneTeamNewchat({
	cdp,
	verb,
	capture,
	captureRaw,
	check,
	note,
	wait,
	waitForCondition,
	clickAt,
	pressChord,
}) {
	const modes = ["broken", "fresh", "immediate", "carry"];
	if (TEAM === null || EXPECT === null) {
		throw new Error(
			"--scene team-newchat needs --team <name> and --expect <broken|fresh|immediate|carry>: the seed is the operator's persisted shape, and every half has to be named rather than inferred",
		);
	}
	if (!modes.includes(EXPECT)) {
		throw new Error(
			`--scene team-newchat does not know --expect ${JSON.stringify(EXPECT)}: a typo would silently answer another half's question`,
		);
	}
	if (BACKEND === null) {
		throw new Error(
			"--scene team-newchat needs --backend <url>: the defect IS the daemon's answer to a replayed receipt, and a run with no reachable backend has no bridge to 404",
		);
	}
	if (!process.argv.includes("--seed-onboarding-complete")) {
		throw new Error(
			"--scene team-newchat needs --seed-onboarding-complete: the first-run wizard owns the window otherwise, and a frame of it would not be the pane under test",
		);
	}
	if (EXPECT !== "carry" && DRAFT_REQUEST_ID === null) {
		throw new Error(
			"--scene team-newchat needs --draft-request-id <uuid> for the draft halves: it is the receipt whose replay names the dead id",
		);
	}
	const label = TEAM_LABEL ?? TEAM;
	if (EXPECT === "carry") {
		return await runCarry({
			cdp,
			verb,
			capture,
			captureRaw,
			check,
			note,
			wait,
			waitForCondition,
			clickAt,
			pressChord,
		});
	}
	return await runDraft({
		cdp,
		verb,
		capture,
		captureRaw,
		check,
		note,
		wait,
		waitForCondition,
		clickAt,
		pressChord,
		team: TEAM,
		label,
	});
}

/**
 * The draft half: a replayed receipt and its bridge 404.
 *
 * `broken` and `fresh` differ only in what they assert; `immediate` adds the
 * raced send. All three seed the same row and type the same first keystroke, so
 * the pair's difference is the app rather than the rig.
 */
async function runDraft({
	cdp,
	verb,
	capture,
	captureRaw,
	check,
	note,
	wait,
	waitForCondition,
	clickAt,
	pressChord,
	team,
	label,
}) {
	const key = draftKeyOf(team);
	const streamedId = await streamedDraftId(team, DRAFT_REQUEST_ID);
	note(
		"the id the bridge stream addresses (the daemon's replay of the seeded request id)",
		JSON.stringify({ requestId: DRAFT_REQUEST_ID, streamedId }),
	);

	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	/*
	 * THE OPERATOR'S PERSISTED SHAPE, written into this run's isolated profile and
	 * then reloaded: a stable team draft with the request id whose receipt names
	 * the dead id, no `sessionId` (the row is a new chat), and an empty composer
	 * so the typed 'C' is the whole reading.
	 */
	await cdp.evaluate(`(() => {
		const read = (storageKey) => {
			try { return JSON.parse(localStorage.getItem(storageKey) || "null") || {}; } catch { return {}; }
		};
		const canonical = read("canonical-sessions-storage");
		canonical.state = {
			...(canonical.state || {}),
			activeSessionId: null,
			activeDraftKey: ${JSON.stringify(key)},
			forgotten: {},
			/*
			 * REPLACED, not merged: a launch draft from before this seed is a row no
			 * screen in this run addresses, and its presence only clouds the reading
			 * of which row the pane kept.
			 */
			drafts: {
				[${JSON.stringify(key)}]: {
					key: ${JSON.stringify(key)},
					target: { kind: "team", name: ${JSON.stringify(team)} },
					/*
					 * UUIDs, not readable labels: the desktop request schema types every
					 * request id as a uuid, and a seeded label made the send die in the
					 * renderer with the generic "Invalid desktop operation." before a
					 * socket opened (caught by this scene's first run - the bubble was an
					 * echo beside that refusal, which is exactly the failure a pass must
					 * not wear).
					 */
					createRequestId: "0e5f1c2a-0000-4000-8000-000000000001",
					admissionRequestId: "0e5f1c2a-0000-4000-8000-000000000002",
					draftRequestId: ${JSON.stringify(DRAFT_REQUEST_ID)},
				},
			},
		};
		localStorage.setItem("canonical-sessions-storage", JSON.stringify(canonical));
		const input = read("conversation-input-store");
		input.state = { ...(input.state || {}), inputByConversation: {} };
		localStorage.setItem("conversation-input-store", JSON.stringify(input));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await wait(1500);
	await waitForCondition(
		cdp,
		`Boolean(document.querySelector(${JSON.stringify(COMPOSER)}))`,
		30_000,
	);

	await installProbe(cdp, key);

	/*
	 * ONE KEYSTROKE, through CDP's own input pipeline: the pane's first keystroke
	 * is what mints (`ensureDraftWarm`), so the 'C' is not decoration - it is the
	 * act that asks the daemon for the id whose receipt replays the dead one.
	 */
	await clickAt(cdp, COMPOSER);
	await cdp.send("Input.insertText", { text: "C" });

	if (EXPECT === "immediate") {
		/*
		 * THE RACED SEND (UX round 1 U1). The words and Enter go in NOW - before
		 * the mint or the 404 has answered - so the leg records what a reader who
		 * keeps typing through the bridge sees. Both outcomes are legal: the send
		 * may beat the mint (a create without a draft id) or follow the retire (a
		 * create after the re-mint); what must not happen is a terminal notice, a
		 * refused box, or a message that vanishes.
		 */
		await clickAt(cdp, COMPOSER);
		await cdp.send("Input.insertText", { text: " raced send" });
		await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
		const bubble = await waitForCondition(
			cdp,
			`(() => {
				const log = document.querySelector('[role="log"]');
				return Boolean(log && log.textContent.includes("raced send"));
			})()`,
			45_000,
		);
		await wait(1500);
		const screen = await readScreen(cdp);
		const probe = await readProbe(cdp);
		const undelivered = await cdp.evaluate(
			`Boolean(document.querySelector('[role="log"] [data-undelivered]'))`,
		);
		const route = (await verb(cdp, "state")).route;
		note(
			"the raced send",
			JSON.stringify({
				route,
				bubble: bubble.ok,
				timeToBubbleMs: bubble.waitedMs,
				undelivered,
				notice: screen.notice,
				composer: screen.composer,
				activeDraftKey: screen.activeDraftKey,
				activeSessionId: screen.activeSessionId,
				probe,
			}),
		);
		await capture(cdp, "team-newchat-immediate-after-send");
		check(
			"the reader who keeps typing through the bridge gets a transcript, not a verdict",
			bubble.ok && undelivered === false,
			`bubble=${bubble.ok} undelivered=${undelivered}`,
		);
		check(
			"the notice was never painted while the send raced the 404",
			probe?.noticeAt === null,
			JSON.stringify(probe?.noticeAt),
		);
		check(
			"the composer was never refused while the send raced the 404",
			probe?.refusedAt === null,
			JSON.stringify(probe?.refusedAt),
		);
		return;
	}

	/*
	 * THE 404 HAS LANDED when either half of the answer is visible: the fresh tree
	 * re-mints the row's request id, the base tree paints the notice. Reading both
	 * is what lets one expression wait for either.
	 */
	const answered = await waitForCondition(
		cdp,
		`(() => {
			const canonical = (() => { try { return JSON.parse(localStorage.getItem("canonical-sessions-storage") || "null")?.state ?? null; } catch { return null; } })();
			const row = canonical?.drafts?.[${JSON.stringify(key)}] ?? null;
			return Boolean(document.querySelector(${JSON.stringify(NOTICE)})) ||
				(row !== null && row.draftRequestId !== ${JSON.stringify(DRAFT_REQUEST_ID)});
		})()`,
		20_000,
	);
	note(
		"the bridge's answer",
		JSON.stringify({
			waitedMs: answered.waitedMs,
			answered: answered.ok,
			note: "the 404 is not observable in the page (it arrives over IPC); this is the first observation of its consequence, polled every 50 ms",
		}),
	);
	/*
	 * THE FIRST PAINT AFTER THE ANSWER, held beside the settled one: `captureRaw`
	 * is not a settle loop, so if a notice or a refused box existed for any frame
	 * here it would appear in this file. The two are compared byte-for-byte and
	 * the result is reported rather than assumed.
	 */
	/*
	 * THE FIRST FRAME'S OWN FACTS, read at the instant it is taken. The two images
	 * are compared byte-for-byte in the report, but the ASSERTION is the state:
	 * a text caret blinks, so identical bytes are not what "the same working new
	 * chat" means (this scene's first run failed on exactly that, and the frame it
	 * kept shows the caret's on-phase).
	 */
	const firstRead = await readScreen(cdp);
	const first = await captureRaw(cdp, `team-newchat-${EXPECT}-first`);
	await wait(600);
	const settled = await capture(cdp, `team-newchat-${EXPECT}-new-chat`);
	const probe = await readProbe(cdp);
	const afterC = await readScreen(cdp);
	const route = (await verb(cdp, "state")).route;
	note(
		"the window between the answer and the settled pane",
		JSON.stringify({
			firstFrame: first?.path ?? null,
			settledFrame: settled?.path ?? null,
			firstEqualsSettled:
				JSON.stringify(first?.bytes) === JSON.stringify(settled?.bytes),
			probe,
		}),
	);
	note(
		"the new chat after one keystroke",
		JSON.stringify({
			route,
			header: afterC.header,
			notice: afterC.notice,
			composer: afterC.composer,
			focus: afterC.focus,
			activeDraftKey: afterC.activeDraftKey,
			activeSessionId: afterC.activeSessionId,
			drafts: afterC.drafts,
			requestIdMoved: afterC.drafts[key]?.draftRequestId !== DRAFT_REQUEST_ID,
		}),
	);

	check(
		"the header names the press's own act: a NEW chat with the team",
		(afterC.header ?? "").includes(`New chat with ${label}`),
		`header: ${JSON.stringify(afterC.header)}`,
	);
	if (EXPECT === "broken") {
		check(
			"BEFORE: the draft's bridge 404 paints the terminal notice under that header",
			afterC.notice !== null &&
				/no longer on this machine/i.test(afterC.notice),
			JSON.stringify(afterC.notice),
		);
		check(
			"BEFORE: the row still holds the seeded request id, so a replay keeps naming the dead id",
			afterC.drafts[key]?.draftRequestId === DRAFT_REQUEST_ID,
			JSON.stringify({ seeded: DRAFT_REQUEST_ID, row: afterC.drafts[key] }),
		);
		check(
			"BEFORE: the probe caught the notice being PAINTED and the composer being refused",
			probe?.noticeAt !== null && probe?.refusedAt !== null,
			JSON.stringify({
				noticeAt: probe?.noticeAt,
				refusedAt: probe?.refusedAt,
			}),
		);
	} else {
		check(
			"AFTER: no terminal notice - a draft's bridge 404 is not a conversation verdict",
			afterC.notice === null,
			JSON.stringify(afterC.notice),
		);
		check(
			"AFTER: the typed 'C' is still in the box, editable, and still has the caret",
			afterC.composer !== null &&
				afterC.composer.value === "C" &&
				afterC.composer.readOnly === false &&
				afterC.composer.disabled === false &&
				afterC.focus?.focused === true,
			JSON.stringify({ composer: afterC.composer, focus: afterC.focus }),
		);
		check(
			"AFTER: the dead warm's request id was re-minted, so the receipt cannot replay it",
			afterC.drafts[key]?.draftRequestId != null &&
				afterC.drafts[key]?.draftRequestId !== DRAFT_REQUEST_ID,
			JSON.stringify({ seeded: DRAFT_REQUEST_ID, row: afterC.drafts[key] }),
		);
		check(
			"AFTER: the pane is still the new chat it began as (no conversation pointer)",
			afterC.activeDraftKey === key && afterC.drafts[key]?.sessionId === null,
			JSON.stringify({
				activeDraftKey: afterC.activeDraftKey,
				row: afterC.drafts[key],
			}),
		);
		check(
			"AFTER: the notice was never PAINTED and the box was never refused in the whole window",
			probe?.noticeAt === null && probe?.refusedAt === null,
			JSON.stringify({
				noticeAt: probe?.noticeAt,
				refusedAt: probe?.refusedAt,
				samples: probe?.samples?.length,
			}),
		);
		check(
			"AFTER: the first frame after the answer is the same working new chat as the settled one",
			firstRead.notice === null &&
				afterC.notice === null &&
				firstRead.composer?.value === afterC.composer?.value &&
				firstRead.composer?.readOnly === false &&
				afterC.composer?.readOnly === false &&
				firstRead.header === afterC.header &&
				firstRead.focus?.focused === true,
			JSON.stringify({
				first: {
					notice: firstRead.notice,
					composer: firstRead.composer,
					header: firstRead.header,
				},
				settled: {
					notice: afterC.notice,
					composer: afterC.composer,
					header: afterC.header,
				},
				frames: { first: first?.path ?? null, settled: settled?.path ?? null },
				firstEqualsSettledBytes:
					JSON.stringify(first?.bytes) === JSON.stringify(settled?.bytes),
			}),
		);
	}

	/*
	 * AND THE SEND. Both halves attempt the same gesture: on the base tree the box
	 * is the refused one the notice describes, so the bubble is the reading that
	 * says the defect cost the user their send as well as their screen.
	 */
	await clickAt(cdp, COMPOSER);
	await cdp.send("Input.insertText", { text: " a regression check" });
	const enteredAt = Date.now();
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const bubble = await waitForCondition(
		cdp,
		`(() => {
			const log = document.querySelector('[role="log"]');
			return Boolean(log && log.textContent.includes("a regression check"));
		})()`,
		45_000,
	);
	const timeToTranscriptMs = Date.now() - enteredAt;
	/*
	 * THE BUBBLE IS THE ECHO; THE DELIVERY IS THE ROW (and the base tree's refused
	 * composer, the bad first run of this scene, showed why the two must be read
	 * apart: an optimistic row can sit beside a refusal line). `data-undelivered`
	 * is the transcript's own address for a message the owner did not take, so a
	 * pass here is a message that reached the conversation, not merely a bubble.
	 */
	await wait(1500);
	const afterSend = await readScreen(cdp);
	const undelivered = await cdp.evaluate(
		`Boolean(document.querySelector('[role="log"] [data-undelivered]'))`,
	);
	note(
		"the send",
		JSON.stringify({
			timeToTranscriptMs,
			bubble: bubble.ok,
			notice: afterSend.notice,
			composer: afterSend.composer,
			undelivered,
			activeDraftKey: afterSend.activeDraftKey,
			activeSessionId: afterSend.activeSessionId,
			drafts: afterSend.drafts,
		}),
	);
	await wait(800);
	const sentFrame = await capture(cdp, `team-newchat-${EXPECT}-after-send`);
	note("frame", JSON.stringify(sentFrame));

	if (EXPECT === "fresh") {
		check(
			"AFTER: the first send renders a transcript bubble that the owner took",
			bubble.ok && undelivered === false,
			`after ${timeToTranscriptMs}ms: bubble=${bubble.ok} undelivered=${undelivered}`,
		);
		check(
			"AFTER: the notice stayed away through the send",
			afterSend.notice === null,
			JSON.stringify(afterSend.notice),
		);
		check(
			"AFTER: the composer is left empty once the message is on the transcript",
			afterSend.composer !== null && afterSend.composer.value === "",
			JSON.stringify(afterSend.composer),
		);
	} else {
		check(
			"BEFORE: the refused composer cannot send, which is the stranded draft the report names",
			bubble.ok === false,
			`bubble after ${timeToTranscriptMs}ms: ${JSON.stringify(bubble.last)}`,
		);
	}
}

/**
 * The top of the carry flow: a genuinely missing conversation.
 *
 * WHY THE MISSING ID IS NOT SEEDED AS A DRAFT. The notice's press is only
 * reachable from the SESSION arm, so the pane must mount a conversation the
 * daemon does not serve - the route effect opens it, its stream 404s, and the
 * session arm paints the notice (exactly `--expect broken`'s paint, on a real
 * session rather than a draft's bridge). The composer's row is persisted state a
 * user can genuinely hold: words typed into that pane before the loss, and a
 * chip attached while the conversation still existed.
 */
async function runCarry({
	cdp,
	verb,
	capture,
	captureRaw,
	check,
	note,
	wait,
	waitForCondition,
	clickAt,
	pressChord,
}) {
	const chipPath = carryChipPath();
	note("the chip's file", chipPath);
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	await cdp.evaluate(`(() => {
		const read = (storageKey) => {
			try { return JSON.parse(localStorage.getItem(storageKey) || "null") || {}; } catch { return {}; }
		};
		const canonical = read("canonical-sessions-storage");
		canonical.state = {
			...(canonical.state || {}),
			activeSessionId: ${JSON.stringify(MISSING_ID)},
			activeDraftKey: null,
			forgotten: {},
			drafts: {},
		};
		localStorage.setItem("canonical-sessions-storage", JSON.stringify(canonical));
		const input = read("conversation-input-store");
		input.state = {
			...(input.state || {}),
			inputByConversation: {
				[${JSON.stringify(MISSING_ID)}]: {
					currentInput: ${JSON.stringify(CARRY_TEXT)},
					submittedMessages: [],
					currentHistoryIndex: null,
					replies: [],
					attachments: [{ id: ${JSON.stringify(CARRY_CHIP_ID)}, path: ${JSON.stringify(chipPath)} }],
				},
			},
		};
		localStorage.setItem("conversation-input-store", JSON.stringify(input));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await wait(1500);
	const missing = await waitForCondition(
		cdp,
		`Boolean(document.querySelector(${JSON.stringify(NOTICE)}))`,
		30_000,
	);
	/*
	 * THE DEAD ADDRESS, TAKEN AS AN ADDRESS (agent review round 2, R2-1). The seed
	 * alone left the route at `/chat`, so a route assertion after the press could
	 * not fail: the pane shows the missing conversation because the STORE names
	 * it, not because the URL does. Standing the leg at the id's own route is what
	 * makes the press's `/chat` and the reload's emptiness discriminating - the
	 * unpatched press leaves the address here, and the reload then re-opens the
	 * dead id instead of the staged draft.
	 */
	const deadRoute = `/chat/${MISSING_ID}`;
	const beforePress = await verb(cdp, "navigate", deadRoute);
	const before = await readScreen(cdp);
	note(
		"the genuinely missing conversation",
		JSON.stringify({
			noticePaintedAtMs: missing.waitedMs,
			route: beforePress.route,
			notice: before.notice,
			detail: before.noticeDetail,
			action: before.noticeAction,
			composer: before.composer,
			activeSessionId: before.activeSessionId,
			activeDraftKey: before.activeDraftKey,
		}),
	);
	await capture(cdp, "team-newchat-carry-notice");
	check(
		"the leg stands at the dead conversation's own address before the press",
		beforePress.route === deadRoute,
		`route: ${JSON.stringify(beforePress.route)} expected ${JSON.stringify(deadRoute)}`,
	);
	check(
		"the missing conversation says so, with the one action",
		before.notice !== null &&
			/Start a new chat/i.test(before.noticeAction ?? "") &&
			before.composer?.readOnly === true,
		JSON.stringify({
			notice: before.notice,
			action: before.noticeAction,
			composer: before.composer,
		}),
	);
	check(
		"the box holds the words and the chip the reader left there",
		before.composer?.value === CARRY_TEXT &&
			before.inputs[MISSING_ID]?.attachments?.[0] === chipPath,
		JSON.stringify({ composer: before.composer, inputs: before.inputs }),
	);

	/*
	 * KEYBOARD FIRST (UX round 1, U2): focus lands on the notice's own control and
	 * Space is pressed through CDP. The repo's own notes say a synthetic Enter does
	 * not always produce Chromium's default activation for a button over this
	 * path, so Space is the attempt; whether it activated is REPORTED, and the
	 * pointer press below is the fallback rather than a product claim.
	 */
	const focused = await cdp.evaluate(`(() => {
		const button = document.querySelector(${JSON.stringify(NOTICE_ACTION)});
		if (!button) return null;
		button.focus();
		return {
			focused: document.activeElement === button,
			label: (button.textContent || "").trim(),
		};
	})()`);
	await pressChord(cdp, { key: " ", code: "Space", virtualKeyCode: 32 });
	const keyboard = await waitForCondition(
		cdp,
		`Boolean(document.querySelector(${JSON.stringify(NOTICE)})) === false`,
		2500,
	);
	note(
		"the keyboard attempt",
		JSON.stringify({
			focused,
			activated: keyboard.ok,
			waitedMs: keyboard.waitedMs,
		}),
	);
	let activation = "keyboard";
	if (!keyboard.ok) {
		activation = "pointer";
		await clickAt(cdp, NOTICE_ACTION);
		await waitForCondition(
			cdp,
			`Boolean(document.querySelector(${JSON.stringify(NOTICE)})) === false`,
			10_000,
		);
	}
	// One frame for the route commit and the composer's adoption of the returned
	// text (`pendingText` is adopted on mount, a render after the press).
	await wait(600);
	const afterPress = await readScreen(cdp);
	const routeAfterPress = (await verb(cdp, "state")).route;
	const newKey = afterPress.activeDraftKey;
	note(
		"the way out",
		JSON.stringify({
			activation,
			route: routeAfterPress,
			notice: afterPress.notice,
			composer: afterPress.composer,
			focus: afterPress.focus,
			activeDraftKey: newKey,
			activeSessionId: afterPress.activeSessionId,
			inputs: afterPress.inputs,
			chipCount: afterPress.chipCount,
		}),
	);
	await capture(cdp, "team-newchat-carry-new-chat");

	check(
		"the press lands on the chat route, not the dead conversation's address",
		routeAfterPress === "/chat",
		JSON.stringify(routeAfterPress),
	);
	check(
		"the new chat holds exactly the carried words, once",
		afterPress.composer?.value === CARRY_TEXT &&
			afterPress.composer?.readOnly === false,
		JSON.stringify({
			composer: afterPress.composer,
			inputs: afterPress.inputs,
		}),
	);
	check(
		"and the chip came with it, in the box and in the store row",
		afterPress.chipCount === 1 &&
			newKey !== null &&
			afterPress.inputs[newKey]?.attachments?.[0] === chipPath,
		JSON.stringify({
			chipCount: afterPress.chipCount,
			inputs: afterPress.inputs,
			key: newKey,
		}),
	);
	check(
		"the dead identity no longer holds a second copy",
		afterPress.inputs[MISSING_ID] === undefined,
		JSON.stringify(afterPress.inputs[MISSING_ID]),
	);
	check(
		"the notice is gone and the selection no longer names the dead conversation",
		afterPress.notice === null && afterPress.activeSessionId === null,
		JSON.stringify({
			notice: afterPress.notice,
			activeSessionId: afterPress.activeSessionId,
		}),
	);

	/*
	 * AND IT SURVIVES A RELOAD (QA round 1, Q1): the press's state must be the
	 * state a relaunch restores. The route is read again from the app after the
	 * reload, and the box must still hold the carried words and chip.
	 */
	await cdp.send("Page.reload", { ignoreCache: false });
	await wait(1500);
	await waitForCondition(
		cdp,
		`Boolean(document.querySelector(${JSON.stringify(COMPOSER)}))`,
		30_000,
	);
	const afterReload = await readScreen(cdp);
	const routeAfterReload = (await verb(cdp, "state")).route;
	note(
		"after the reload",
		JSON.stringify({
			route: routeAfterReload,
			notice: afterReload.notice,
			composer: afterReload.composer,
			focus: afterReload.focus,
			activeDraftKey: afterReload.activeDraftKey,
			activeSessionId: afterReload.activeSessionId,
			chipCount: afterReload.chipCount,
		}),
	);
	await capture(cdp, "team-newchat-carry-reload");
	check(
		"RELOAD: still the chat route, no notice, and the carried words are visible",
		routeAfterReload === "/chat" &&
			afterReload.notice === null &&
			afterReload.composer?.value === CARRY_TEXT,
		JSON.stringify({
			route: routeAfterReload,
			notice: afterReload.notice,
			composer: afterReload.composer,
		}),
	);
	check(
		"RELOAD: and the chip is still there",
		afterReload.chipCount === 1,
		JSON.stringify({ chipCount: afterReload.chipCount }),
	);

	/*
	 * UX round 1 U2's continuation: the carried box accepts MORE typing and the
	 * carried message sends once. The chip is removed through its own control
	 * first - the fixture's file is a rig path, and the send's claim here is the
	 * carried TEXT, not the attachment transport (which the fresh leg exercises
	 * without a chip).
	 */
	await clickAt(cdp, COMPOSER);
	await cdp.send("Input.insertText", { text: CARRY_SUFFIX });
	const typed = await readScreen(cdp);
	const removeChip = await cdp.evaluate(`(() => {
		const button = document.querySelector('[aria-label="Remove attachment"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);
	await wait(300);
	const beforeSend = await readScreen(cdp);
	const sentAt = Date.now();
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const bubble = await waitForCondition(
		cdp,
		`(() => {
			const log = document.querySelector('[role="log"]');
			return Boolean(log && log.textContent.includes(${JSON.stringify(`${CARRY_TEXT}${CARRY_SUFFIX}`)}));
		})()`,
		45_000,
	);
	await wait(1500);
	const afterSend = await readScreen(cdp);
	const undelivered = await cdp.evaluate(
		`Boolean(document.querySelector('[role="log"] [data-undelivered]'))`,
	);
	const occurrences = await cdp.evaluate(`(() => {
		const log = document.querySelector('[role="log"]');
		if (!log) return 0;
		return (log.textContent.match(${JSON.stringify(new RegExp(CARRY_TEXT, "g"))}) || []).length;
	})()`);
	note(
		"the carried send",
		JSON.stringify({
			typedValue: typed.composer?.value,
			chipRemoved: removeChip,
			valueAtSend: beforeSend.composer?.value,
			timeToTranscriptMs: Date.now() - sentAt,
			bubble: bubble.ok,
			undelivered,
			occurrences,
			composer: afterSend.composer,
			activeDraftKey: afterSend.activeDraftKey,
			activeSessionId: afterSend.activeSessionId,
		}),
	);
	await capture(cdp, "team-newchat-carry-sent");
	check(
		"the carried box accepts continued typing",
		typed.composer?.value === `${CARRY_TEXT}${CARRY_SUFFIX}`,
		JSON.stringify(typed.composer),
	);
	check(
		"the carried message sends once and reaches the owner",
		bubble.ok && undelivered === false && occurrences === 1,
		`bubble=${bubble.ok} undelivered=${undelivered} occurrences=${occurrences}`,
	);
}

/**
 * A file for the carried chip.
 *
 * WHY IT EXISTS AND WHERE. The chip's path is read by the DAEMON on send, so the
 * fixture is written inside the isolated agent home the run's cwd resolves to
 * (the config root's sibling `home/`, from `--backend-records <config>/run/serve`).
 * Falling back to the OS temp directory keeps the carry flow runnable when the
 * records path is elsewhere; the chip's own claim is the store row either way.
 */
function carryChipPath() {
	// `<config>/run/serve` -> `<config>/run` -> `<config>` -> the root -> `home`.
	const home = BACKEND_RECORDS
		? resolve(BACKEND_RECORDS, "..", "..", "..", "home")
		: null;
	const dir = home && existsSync(home) ? home : null;
	const path = resolve(
		dir ?? process.env.TMPDIR ?? "/tmp",
		"team-newchat-carry.txt",
	);
	try {
		writeFileSync(path, "carried attachment fixture\n");
	} catch {
		// The chip is still the row's claim; the send removes it before Enter.
	}
	return path;
}
