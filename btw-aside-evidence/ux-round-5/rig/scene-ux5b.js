/* ===================================================================== *
 *   UX ROUND 5, PASS B — the FOLD's arriving surfaces, driven where a
 *   user would feel them (PR #482 at cf5a12f95)
 *
 * The fold (15abad9ce) brought main's own content into this branch:
 * `chat-sidebar.tsx` (+929), `sidebar-scope-paging.ts` (+474) and
 * `canonical-sessions-store.ts` (+956) are the paged-catalogue / lazy-chats
 * work, and `chat-page.tsx` took an 8-line comment. The aside panel's own
 * state does not live in any of them, which is exactly why this pass does not
 * argue that from the diff: it walks the flow a reader would actually take
 * through the arrived code with the aside open —
 *
 *   b00  the exchange is open and settled on conversation A
 *   b01  the reader leaves by pressing the app's OWN `New chat` row (the row
 *        main's sidebar rework owns), the panel does not follow them onto a
 *        draft that belongs to no conversation, and the new conversation is
 *        created by the send and PUBLISHED in the sidebar
 *   b02  the send lands in the conversation on screen as a thread message —
 *        not in the aside of the one that was left, and not in silence
 *   b03  coming back by a real press on A's own row: A's transcript is intact,
 *        the panel does not return with stale content, the composer is empty,
 *        and a fresh /btw still opens, streams and offers its control
 *   b04  what the leave did to the exchange, on the wire: Esc's cost is the
 *        only thing allowed to destroy it, so a navigation must not
 *
 * Every step is a real Input.dispatchKeyEvent / mouse press; every reading is
 * the app's own DOM plus the daemon's own responses through the proxy.
 *
 * RIG NOTES (each cost a pass):
 *  - The app is served from `out/renderer/index.html` over `file://`, so
 *    `location.pathname` is the built file's path: which conversation is on
 *    screen is read from the row the sidebar marks `aria-current="page"`.
 *  - Frame labels are capped at 64 characters by the app's own dev-driver
 *    (`^[a-z0-9][a-z0-9_-]{0,63}$`), and the harness prefixes the scene, so
 *    every `take` label here is short.
 *  - A conversation created OUT OF BAND (straight on the backend) is not in the
 *    app's catalogue until something refreshes it, so the second conversation
 *    is created the way a reader creates one: the New chat row, then a send.
 * ===================================================================== */

const UX5B = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	ASIDE_Q: "UX5B the question in the conversation we leave",
	AFTER: "UX5B a thread message in a new conversation",
	BACK: "UX5B the question after we come back",
	NEW_CHAT: "New chat",
};

/** The conversation the app is showing, from the button the sidebar marks current.
 *
 * `aria-current="page"` is on the row's own BUTTON (`[data-chat-row]`), not on the
 * `[data-session-row]` wrapper, so the wrapper is reached by `closest`. The New chat
 * row carries `data-chat-row` and the same attribute with no session wrapper: that is
 * the "on a draft that belongs to no conversation" state, reported as
 * `sessionId: null` with `draft: true` rather than confused with "nothing found".
 */
function ux5bCurrent(cdp) {
	return cdp.evaluate(`(() => {
		const btn = document.querySelector('[data-chat-row][aria-current="page"]');
		const row = btn ? btn.closest("[data-session-row]") : null;
		return {
			sessionId: row ? row.getAttribute("data-session-row") : null,
			draftCurrent: btn ? row === null : false,
			currentRowText: btn ? btn.textContent.replace(/\\s+/g, " ").trim().slice(0, 40) : null,
			rows: document.querySelectorAll("[data-session-row]").length,
		};
	})()`);
}

/** A row of the sidebar, found by its own visible text, as a point to press. */
function ux5bRowByText(cdp, label) {
	return cdp.evaluate(`(() => {
		const rows = Array.from(document.querySelectorAll("[data-chat-row]"));
		const hit = rows.find((r) => r.textContent.replace(/\\s+/g, " ").trim().startsWith(${JSON.stringify(label)}));
		if (!hit) return { found: false, seen: rows.map((r) => r.textContent.replace(/\\s+/g, " ").trim().slice(0, 30)) };
		const r = hit.getBoundingClientRect();
		return {
			found: true,
			tag: hit.tagName.toLowerCase(),
			disabled: hit.disabled === true,
			text: hit.textContent.replace(/\\s+/g, " ").trim().slice(0, 60),
			x: Math.round(r.x + r.width / 2),
			y: Math.round(r.y + r.height / 2),
			inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
		};
	})()`);
}

/** The sidebar's own box for a session id, as a point to press. */
function ux5bRow(cdp, id) {
	return cdp.evaluate(`(() => {
		const el = document.querySelector('[data-session-row="${id}"] [data-chat-row]');
		if (!el) return { present: false, rows: Array.from(document.querySelectorAll("[data-session-row]")).map((n) => n.getAttribute("data-session-row")) };
		const r = el.getBoundingClientRect();
		return {
			present: true,
			text: el.textContent.replace(/\\s+/g, " ").trim().slice(0, 60),
			x: Math.round(r.x + r.width / 2),
			y: Math.round(r.y + r.height / 2),
			inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
		};
	})()`);
}

async function sceneBtwUx5b(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"headless and never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId: A } = await qaOpenSession(cdp);
	const h = await ux3Harness(cdp, `ux5b-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));

	await h.replaceComposer("UX5B seed turn");
	await clickAt(cdp, UX5B.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX5B.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/* --- b00: the exchange A's reader opens, and leaves open --------------- */
	const base = await ux4BaseWith(cdp, h, `/btw ${UX5B.ASIDE_Q}`, UX5B.ASIDE_Q);
	const asideId = base.asideId;
	const onA = await h.read();
	const before = await ux5bCurrent(cdp);
	log("b00 the aside open on A before the leave", {
		conversation: before.sessionId,
		rows: before.rows,
		asideId,
		panelUp: onA.panelUp,
		announce: onA.announce,
		head: (onA.panelText ?? "").slice(0, 120),
	});
	r2check(
		"b00 the exchange is open and settled on A, and A is the conversation on screen",
		before.sessionId === A && onA.panelUp === true && asideId !== null && (onA.panelText ?? "").includes(UX5B.ASIDE_Q),
		JSON.stringify({ conversation: before.sessionId, A, panelUp: onA.panelUp, asideId }),
	);

	/* --- b01: the reader leaves, by the app's own New chat row ------------- */
	const newChat = await ux5bRowByText(cdp, UX5B.NEW_CHAT);
	log("b01 the New chat row", newChat);
	r2check(
		"b01 the sidebar publishes a New chat row a person can press",
		newChat.found === true && newChat.inViewport === true,
		JSON.stringify(newChat),
	);
	if (newChat.found) await qaPressPoint(cdp, { x: newChat.x, y: newChat.y });
	await wait(700);
	const staged = await h.read();
	const stagedNow = await ux5bCurrent(cdp);
	log("b01 after the press, on the staged draft", {
		current: stagedNow,
		panelUp: staged.panelUp,
		panelText: (staged.panelText ?? "").slice(0, 120),
		fieldValue: staged.fieldValue,
		bandLines: staged.bandLines,
	});
	r2check(
		"b01 leaving by the New chat row takes A's panel with it: the exchange is not painted over a draft that belongs to no conversation",
		stagedNow.sessionId === null && staged.panelUp === false && (staged.panelText ?? null) === null,
		JSON.stringify({ sessionId: stagedNow.sessionId, panelUp: staged.panelUp, panelText: (staged.panelText ?? "").slice(0, 120) }),
	);
	await h.take("b01-on-the-staged-draft");

	/* --- b02: the send creates the new conversation, visibly -------------- */
	await h.replaceComposer(UX5B.AFTER);
	await clickAt(cdp, UX5B.FIELD);
	await h.enter();
	const answered = await h.until(
		(r) => (r.transcriptText ?? "").includes(UX5B.AFTER) || (r.bandLines ?? []).length > 0,
		40000,
	);
	await wait(2000);
	const nowB = await ux5bCurrent(cdp);
	const threadPosts = r3msgs(UX5B.AFTER);
	const asidePosts = r4posts(UX5B.AFTER);
	const rowB = nowB.sessionId ? await ux5bRow(cdp, nowB.sessionId) : { present: false };
	log("b02 the conversation the send created", {
		current: nowB,
		publishedRow: rowB,
		inTranscript: (answered.transcriptText ?? "").includes(UX5B.AFTER),
		threadPosts: threadPosts.map((p) => ({ status: p.status })),
		asidePosts: asidePosts.length,
		bandLines: answered.bandLines,
	});
	r2check(
		"b02 the send lands in the conversation on screen as a thread message - not in the aside of the one that was left",
		threadPosts.length >= 1 && asidePosts.length === 0,
		JSON.stringify({ threadPosts: threadPosts.length, asidePosts: asidePosts.length, bandLines: answered.bandLines }),
	);
	r2check(
		"b02 the new conversation is on screen and published in the sidebar, and the send is visibly there",
		nowB.sessionId !== null && rowB.present === true && (answered.transcriptText ?? "").includes(UX5B.AFTER),
		JSON.stringify({ conversation: nowB.sessionId, row: rowB.present, inTranscript: (answered.transcriptText ?? "").includes(UX5B.AFTER) }),
	);
	await h.take("b02-sent-into-the-new-conversation");

	/* --- b03: coming back the user's own way ------------------------------ */
	let rowA = await ux5bRow(cdp, A);
	for (let i = 0; i < 40 && !rowA.present; i++) {
		await wait(250);
		rowA = await ux5bRow(cdp, A);
	}
	log("b03 A's own row", rowA);
	r2check("b03 conversation A is published in the sidebar and pressable", rowA.present === true, JSON.stringify(rowA));
	if (rowA.present) {
		if (!rowA.inViewport) {
			await cdp.evaluate(`document.querySelector('[data-session-row="${A}"] [data-chat-row]').scrollIntoView({ block: "center" })`);
			await wait(250);
			rowA = await ux5bRow(cdp, A);
		}
		await qaPressPoint(cdp, { x: rowA.x, y: rowA.y });
	}
	let backNow = await ux5bCurrent(cdp);
	for (let i = 0; i < 60 && backNow.sessionId !== A; i++) {
		await wait(200);
		backNow = await ux5bCurrent(cdp);
	}
	await h.idle();
	const onReturn = await h.read();
	log("b03 what coming back shows", {
		current: backNow.sessionId,
		panelUp: onReturn.panelUp,
		panelText: (onReturn.panelText ?? "").slice(0, 100),
		fieldValue: onReturn.fieldValue,
		bandLines: onReturn.bandLines,
		transcriptHead: (onReturn.transcriptText ?? "").slice(0, 120),
	});
	r2check(
		"b03 coming back shows A's own transcript, with the seed turn still in it",
		backNow.sessionId === A && (onReturn.transcriptText ?? "").includes("UX5B seed turn"),
		JSON.stringify({ current: backNow.sessionId, head: (onReturn.transcriptText ?? "").slice(0, 120) }),
	);
	r2check(
		"b03 coming back paints A's OWN exchange on the panel (or none at all) - never another conversation's",
		onReturn.panelUp !== true || ((onReturn.panelText ?? "").includes(UX5B.ASIDE_Q) && !(onReturn.panelText ?? "").includes(UX5B.AFTER)),
		JSON.stringify({ panelUp: onReturn.panelUp, panelText: (onReturn.panelText ?? "").slice(0, 160), announce: onReturn.announce }),
	);
	r2check(
		"b03 the composer the reader comes back to does not carry the send that belonged to the other conversation",
		!((onReturn.fieldValue ?? "").includes(UX5B.AFTER)),
		JSON.stringify({ fieldValue: onReturn.fieldValue }),
	);

	/* --- b04: what the leave did to the exchange, on the wire ------------- */
	const raw = asideId ? await ux3AsideRaw(A, asideId) : { status: null, body: null };
	const closes = (r3stats().asideOps ?? []).filter((op) => op.kind === "close");
	const adopts = (r3stats().asideOps ?? []).filter((op) => op.kind === "adopt");
	log("b04 the exchange that was open when the reader left", {
		getStatus: raw.status,
		turns: raw.body?.data?.turns?.length ?? raw.body?.turns?.length ?? null,
		adoptable: raw.body?.data?.adoptable ?? raw.body?.adoptable ?? null,
		closes: closes.map((c) => ({ url: c.url, status: c.status })),
		adopts: adopts.length,
	});
	r2check(
		"b04 the leave itself sent no close: navigating away is not Esc, and the reader's exchange is still held on the wire",
		closes.length === 0 && raw.status === 200,
		JSON.stringify({ closes: closes.map((c) => c.url), getStatus: raw.status, keys: raw.body ? Object.keys(raw.body) : null }),
	);

	/* --- and a fresh aside still works end to end on this conversation ---- */
	const fresh = await ux4BaseWith(cdp, h, `/btw ${UX5B.BACK}`, UX5B.BACK);
	const after = await h.read();
	log("b03 a fresh aside after the round trip", {
		asideId: fresh.asideId,
		panelUp: after.panelUp,
		adoptDisabled: after.adoptDisabled,
		adoptReason: after.adoptReason,
		head: (after.panelText ?? "").slice(0, 140),
	});
	r2check(
		"b03 a fresh /btw after the round trip still opens, streams its answer and offers the adopt control",
		after.panelUp === true &&
			(after.panelText ?? "").includes(UX5B.BACK) &&
			(after.panelText ?? "").includes(UX5B.TAIL) &&
			after.adoptDisabled === false,
		JSON.stringify({
			panelUp: after.panelUp,
			adoptDisabled: after.adoptDisabled,
			adoptReason: after.adoptReason,
			head: (after.panelText ?? "").slice(0, 140),
		}),
	);
	await h.take("b03-fresh-aside-after-returning");

	note("UX5B scene", "finished");
}
