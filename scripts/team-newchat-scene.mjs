/* ------------------------------------------------------------------------- *
 * `team-newchat`: a New chat with a team whose replayed draft receipt names a
 * warm id the daemon can no longer serve.
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
 * WHAT THE TWO EXPECTATIONS ANSWER.
 *   - `--expect broken` is the BEFORE half, run on the base tree: after one
 *     keystroke the notice is on screen, the draft row still holds the seeded
 *     request id, and the send cannot produce a transcript because the composer
 *     has become the refused one. A pass here is evidence of the defect, not of
 *     the fix.
 *   - `--expect fresh` is the AFTER half: no notice, the typed 'C' still in the
 *     box, the row's request id re-minted (the dead id's receipt can never hand
 *     it back), and the first send rendering a transcript bubble.
 *
 * WHAT A FRAME HERE CAN AND CANNOT CLAIM. The seed is the operator's persisted
 * shape written into an isolated profile and then RELOADED, so the pane mounts
 * the way it did after a relaunch. The 404 is the daemon's own: the run's
 * precondition (the daemon's serve.log) minted D, materialised a conversation on
 * it, deleted that conversation and restarted the daemon - see the PR for the
 * exact commands. The scene cannot manufacture a daemon restart, so it asserts
 * what the screen did with the answer that came back, not why the answer was a
 * 404; the serve log's `GET /v1/desktop/sessions/<D>/events` lines are counted
 * beside the frames.
 * ------------------------------------------------------------------------- */

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

/** The composer the scene types into, addressed the way the other scenes do. */
const COMPOSER = '[data-tour-tag="chat-input-textarea"] textarea';
/** `MISSING_SESSION_NOTICE_ID` - the one spelling of the pane's notice. */
const NOTICE = "#lo-missing-session-notice";
/**
 * The header row's landmark. `data-chat-region="header"` is the app's own
 * vocabulary (the walk's first region), not a class name that a restyle renames.
 */
const HEADER = '[data-chat-region="header"]';

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
 * `--scene team-newchat`. See the module header for the two halves.
 */
export async function sceneTeamNewchat({
	cdp,
	verb,
	capture,
	check,
	note,
	wait,
	waitForCondition,
	clickAt,
	pressChord,
}) {
	if (TEAM === null || DRAFT_REQUEST_ID === null || EXPECT === null) {
		throw new Error(
			"--scene team-newchat needs --team <name>, --draft-request-id <uuid> and --expect <broken|fresh>: the seed is the operator's persisted shape, and both halves have to be named rather than inferred",
		);
	}
	if (EXPECT !== "broken" && EXPECT !== "fresh") {
		throw new Error(
			`--scene team-newchat does not know --expect ${JSON.stringify(EXPECT)}: a typo would silently answer the other half's question`,
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
	const key = draftKeyOf(TEAM);
	const label = TEAM_LABEL ?? TEAM;

	/*
	 * The id the pane will stream on, read BEFORE the app is asked anything: this
	 * is the daemon's answer for the seeded receipt, so it is also the id the
	 * serve log's `GET .../events` lines name.
	 */
	const streamedId = await streamedDraftId(TEAM, DRAFT_REQUEST_ID);
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
			drafts: {
				...((canonical.state || {}).drafts || {}),
				[${JSON.stringify(key)}]: {
					key: ${JSON.stringify(key)},
					target: { kind: "team", name: ${JSON.stringify(TEAM)} },
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

	/*
	 * ONE KEYSTROKE, through CDP's own input pipeline: the pane's first keystroke
	 * is what mints (`ensureDraftWarm`), so the 'C' is not decoration - it is the
	 * act that asks the daemon for the id whose receipt replays the dead one.
	 */
	await clickAt(cdp, COMPOSER);
	await cdp.send("Input.insertText", { text: "C" });
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
		JSON.stringify({ waitedMs: answered.waitedMs, answered: answered.ok }),
	);
	await wait(600);

	const read = () =>
		cdp.evaluate(`(() => {
			const canonical = (() => { try { return JSON.parse(localStorage.getItem("canonical-sessions-storage") || "null")?.state ?? null; } catch { return null; } })();
			const row = canonical?.drafts?.[${JSON.stringify(key)}] ?? null;
			const notice = document.querySelector(${JSON.stringify(NOTICE)});
			const box = document.querySelector(${JSON.stringify(COMPOSER)});
			const header = document.querySelector(${JSON.stringify(HEADER)});
			return {
				activeDraftKey: canonical?.activeDraftKey ?? null,
				activeSessionId: canonical?.activeSessionId ?? null,
				draftSessionId: row?.sessionId ?? null,
				draftRequestId: row?.draftRequestId ?? null,
				notice: notice === null ? null : (notice.textContent || "").trim(),
				header: header === null ? null : (header.textContent || "").trim(),
				composer: box === null ? null : { value: box.value, disabled: box.disabled === true, readOnly: box.readOnly === true },
			};
		})()`);

	const afterC = await read();
	const route = (await verb(cdp, "state")).route;
	note(
		"the new chat after one keystroke",
		JSON.stringify({
			route,
			header: afterC.header,
			notice: afterC.notice,
			composer: afterC.composer,
			activeDraftKey: afterC.activeDraftKey,
			draftSessionId: afterC.draftSessionId,
			draftRequestId: afterC.draftRequestId,
			requestIdMoved: afterC.draftRequestId !== DRAFT_REQUEST_ID,
		}),
	);
	const newChatFrame = await capture(cdp, `team-newchat-${EXPECT}-new-chat`);
	note("frame", JSON.stringify(newChatFrame));

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
			afterC.draftRequestId === DRAFT_REQUEST_ID,
			JSON.stringify({ seeded: DRAFT_REQUEST_ID, row: afterC.draftRequestId }),
		);
	} else {
		check(
			"AFTER: no terminal notice - a draft's bridge 404 is not a conversation verdict",
			afterC.notice === null,
			JSON.stringify(afterC.notice),
		);
		check(
			"AFTER: the typed 'C' is still in the box, editable",
			afterC.composer !== null &&
				afterC.composer.value === "C" &&
				afterC.composer.disabled === false &&
				afterC.composer.readOnly === false,
			JSON.stringify(afterC.composer),
		);
		check(
			"AFTER: the dead warm's request id was re-minted, so the receipt cannot replay it",
			afterC.draftRequestId !== null &&
				afterC.draftRequestId !== DRAFT_REQUEST_ID,
			JSON.stringify({ seeded: DRAFT_REQUEST_ID, row: afterC.draftRequestId }),
		);
		check(
			"AFTER: the pane is still the new chat it began as (no conversation pointer)",
			afterC.activeDraftKey === key && afterC.draftSessionId === null,
			JSON.stringify({
				activeDraftKey: afterC.activeDraftKey,
				draftSessionId: afterC.draftSessionId,
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
	const afterSend = await read();
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
			draftSessionId: afterSend.draftSessionId,
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
			"AFTER: the creator is left empty once the message is on the transcript",
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
