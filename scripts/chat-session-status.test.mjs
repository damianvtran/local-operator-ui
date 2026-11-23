import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const result = await build({
	stdin: {
		contents:
			'export { ChatSessionStatus, ChatAsksOutstanding, withQueuedAskStatus, withQueuedAskStatuses, approvalAsksSentence, openAskCount } from "./src/renderer/src/features/chat/components/chat-session-status"; export { sectionOf, isRunningRow, isStoppedOnReader, sectionRows } from "./src/renderer/src/features/chat/chat-list-sections"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react"; export { peerLinkDownLabel, peerLinkDownVisibleLabel } from "./src/renderer/src/features/mesh/peer-presence";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
});
const output = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(
	output,
	output.exports,
	require,
);
const {
	ChatSessionStatus,
	ChatAsksOutstanding,
	withQueuedAskStatus,
	withQueuedAskStatuses,
	approvalAsksSentence,
	openAskCount,
	sectionOf,
	isRunningRow,
	isStoppedOnReader,
	peerLinkDownLabel,
	peerLinkDownVisibleLabel,
	renderToStaticMarkup,
	createElement,
} = output.exports;
const render = (code, unseen, label = code) =>
	renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "fixture",
				status: { code, label },
				attention: { unseen },
			},
		}),
	);
test("read complete rests, unread complete keeps the attention check", () => {
	assert.match(render("complete", true), /lucide-check/);
	assert.match(render("complete", true), /text-success/);
	assert.match(render("complete", false), /lucide-circle /);
	assert.doesNotMatch(render("complete", false), /lucide-check|text-success/);
	assert.match(render("complete", undefined), /lucide-circle /);
	/*
	 * THE NAME IS ASSERTED ON THE MARKUP, not on the code path (review round 4,
	 * R4-2). The suffix is the half a screen reader hears and the half the ink
	 * cannot carry, and nothing else in this repository asserts it: deleting it
	 * left all twelve cases here green. Rendered names, not a regex over the
	 * source — `text-success` is already asserted above for the same reason.
	 */
	assert.match(render("complete", true), /sr-only">complete, unread</);
	assert.match(render("complete", false), /sr-only">complete</);
	assert.doesNotMatch(render("complete", false), /unread/);
	// The narrow gating is a contract, not an accident: a code that keeps its own
	// meaning keeps its own name, whether or not the row is unseen.
	assert.doesNotMatch(render("danger", true), /unread/);
	// And a row with NO status pair draws no mark either: a locally created row
	// carries none until its first catalogue read, and unknown is not unread.
	assert.doesNotMatch(
		renderToStaticMarkup(
			createElement(ChatSessionStatus, {
				row: { session_id: "fixture", attention: { unseen: true } },
			}),
		),
		/unread/,
	);
});
/*
 * The marks that are NOT the completion check: `error` and `interrupted`.
 *
 * They keep the glyph and the ink their code already had — the warning/danger
 * signalling a reader depends on — and gain only the accessible name, because
 * they are `unreadMarkKind`'s other two members: the runtime ranks them as
 * outstanding completions and labels them "Unseen error" / "Unseen
 * interruption", and a screen reader has to hear that while the mark stands.
 *
 * The delta is EXACTLY the suffix, which is what `before.replace(...)` asserts:
 * acknowledgement may not change a mark-bearing row's glyph, ink or label, only
 * stop it claiming the mark.
 */
for (const [code, icon, ink] of [
	["error", "circle-alert", "danger"],
	["interrupted", "pause", "warning"],
]) {
	test(`${code} draws its own glyph and names the unseen mark`, () => {
		const before = render(code, true);
		const after = render(code, false);
		assert.ok(before.includes(", unread"), `${code} unseen lost the suffix`);
		assert.equal(
			after,
			before.replace(", unread", ""),
			"acknowledging changed more than the suffix",
		);
		assert.doesNotMatch(after, /unread/);
		assert.match(before, new RegExp(`lucide-${icon}`));
		assert.match(after, new RegExp(`lucide-${icon}`));
		assert.match(before, new RegExp(`text-${ink}`));
		assert.match(after, new RegExp(`text-${ink}`));
	});
}

/*
 * And the codes that draw NO mark of their own, which must render identically
 * whether the row is acknowledged or not — the property an unconditional
 * `, unread` suffix would break, and the reported defect in the one channel the
 * ink cannot show it in.
 */
for (const [code, icon, ink] of [
	/*
	 * `wedged` WEARS A MARK OF ITS OWN AND NOT `error`'S, which is the change this
	 * file exists to pin. It used to read `["wedged", "circle-alert", "danger"]`
	 * — byte-identical to the `error` row two cases above — so an owner that had
	 * merely stopped reporting was drawn exactly like a turn that had failed.
	 */
	["wedged", "equal-approximately", "warning"],
	["busy", "loader-circle", "accent"],
	["answer", "message-circle-question", "warning"],
	["approval", "message-circle-question", "warning"],
	["scheduled", "clock", "ink-dim"],
	["attached", "message-square", "ink-dim"],
	/*
	 * `delegating` rests on the ring since the running lane (2026-11-07): the
	 * trio of #840 is retired, and the lane under the cell carries the liveness.
	 */
	["delegating", "circle", "ink-dim"],
	["idle", "circle", "ink-dim"],
	["dormant", "pause", "ink-dim"],
	["unknown", "circle-help", "ink-dim"],
]) {
	test(`${code} does not lose status when acknowledged`, () => {
		const before = render(code, true);
		const after = render(code, false);
		assert.equal(after, before);
		assert.match(after, new RegExp(`text-${ink}`));
		assert.match(after, new RegExp(`lucide-${icon}`));
	});
}

/*
 * `delegating` is the arm for a parent whose own turn is NOT running while its
 * subagents are; core folds the counts into `status.label`, so the words are
 * the label VERBATIM. Its mark is the resting ring plus the running lane (the
 * trio is retired), and even on an older backend with no `background_work`
 * flag the lane is drawn, because `delegating` always implied children.
 */
test("delegating draws the ring and the lane and names its counts", () => {
	const label = "2 subagents running \u00b7 1 queued";
	const markup = render("delegating", false, label);
	assert.match(markup, /lucide-circle /);
	assert.match(markup, /data-background-work=""/);
	assert.match(markup, new RegExp(label));
	assert.doesNotMatch(markup, /lucide-circle-help|<circle cx="12" cy="6.8"/);
});

test("a not-answering row is not drawn like a failed one", () => {
	const failed = render("error", false);
	const silent = render("wedged", false);
	assert.notEqual(silent, failed);
	assert.match(silent, /lucide-equal-approximately/);
	assert.doesNotMatch(silent, /lucide-circle-alert/);
	assert.match(silent, /text-warning/);
	assert.doesNotMatch(silent, /text-danger/);
	assert.match(failed, /lucide-circle-alert/);
	assert.match(failed, /text-danger/);
});

/*
 * THE WORDS STAY ON THE WIRE. The state's sentence is the backend's
 * (`session/catalog.py`'s `status`) and the renderer must read it rather than
 * re-author it — so a row carrying a DIFFERENT label has to render that label,
 * in the channel this component owns (the `sr-only` name). The assertion is
 * deliberately made with a label no other code in this repo contains, so a
 * hard-coded `"Not answering · process alive"` fails here.
 *
 * THE TOOLTIP CHANNEL MOVED TO THE ROW (review round 1, MINOR 1), and the second
 * half of this case is now the assertion that keeps it there: this component used
 * to put `title` on the span wrapping the mark, which — nested inside the row's
 * button — SHADOWED the row's composed tooltip over the mark itself, hiding the
 * remedy clause over the very glyph it is about. The label is still shown by a
 * tooltip, the row's, and that is asserted where the row is (`mark-all-read-
 * control.test.mjs`, which mounts the shipped sidebar); what is asserted here is
 * that no `title` comes back to shadow it.
 */
test("the wedged row renders the backend's sentence, not one of its own", () => {
	const label = "Not answering · process alive (last heartbeat 4m ago)";
	const markup = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "fixture",
				status: { code: "wedged", label },
			},
		}),
	);
	// `includes` rather than a RegExp: the label carries parentheses and a `·`,
	// and a pattern built from it would be testing the escaping rather than the
	// string. The literal below is the one the catalogue publishes.
	assert.ok(
		markup.includes(`sr-only">${label}`),
		"the accessible name lost the backend's sentence",
	);
	assert.doesNotMatch(
		markup,
		/title=/,
		"a `title` came back onto the mark, where it shadows the row's tooltip",
	);
});

/*
 * ------------------------------------------------------------ the row the
 *                                                                FEED produced
 *
 * Everything above renders a row built by hand, which cannot tell the difference
 * between a status that came from a `sessions.list` response and one a
 * `session_status` frame patched in afterwards - and that difference is the whole
 * point of the frame. So this case builds its row the way the app does: a
 * catalogue row as a list response leaves it, then the two frames that move it
 * (the status frame with the completion, the attention frame with the unseen
 * mark), then the SAME component over the row the store actually holds.
 *
 * It is deliberately not a substitute for the rendered frames under
 * `docs/evidence/`: those show the sidebar, and this shows the icon and its
 * name. What it adds that a screenshot cannot is that the row reaching the
 * component is the frame's, with the frame's stamp on it.
 *
 * The store is bundled here rather than in a second file because the claim
 * couples the two: a frame applies to the row, and that row renders as the
 * unread completion. Two files would let each half pass while the seam between
 * them was broken.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const storeResult = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "chat-session-status-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({
						path: "transport",
						namespace: "chat-session-status-fixture",
					}),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "chat-session-status-fixture" },
					() => ({
						contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = async () => ({});`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "unseen";
export const paintPendingSend = () => undefined;
export const settlePendingSend = () => undefined;
export const hasPendingSend = () => false;
export const movePendingSendIdentity = () => undefined;
export const replacePendingSendText = () => undefined;
export const discardPendingSends = () => undefined;
export const pendingSendForView = () => null;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const { useCanonicalSessionsStore, replaceSessionRows } = await import(
	`data:text/javascript;base64,${Buffer.from(storeResult.outputFiles[0].text).toString("base64")}`
);

const FEED_SESSION = "0f1e2d3c4b5a";
const FEED_EPOCH = "9f2c1a6b7d3e4051";

test("a completion delivered by frames renders as an unread complete row", () => {
	// What a `sessions.list` response left in the store: busy, stamped by the
	// feed process that is serving this client.
	useCanonicalSessionsStore.setState({
		sessions: replaceSessionRows(
			[],
			[
				{
					session_id: FEED_SESSION,
					title: "Quarterly revenue model",
					binding: { agent: null, team: null },
					status: { code: "busy", label: "Working" },
					status_revision: 2,
					status_epoch: FEED_EPOCH,
				},
			],
		),
	});
	// The turn finishes: the derived pair arrives on `session_status`, the unseen
	// mark on `attention`. Both through the store, both as the hook calls them.
	useCanonicalSessionsStore
		.getState()
		.applySessionStatus(
			FEED_SESSION,
			{ code: "complete", label: "Complete" },
			3,
			FEED_EPOCH,
		);
	useCanonicalSessionsStore.getState().applyAttention(FEED_SESSION, {
		conversation_id: `session/${FEED_SESSION}`,
		completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		anchor_id: "row-1",
		kind: "complete",
		unseen: true,
		revision: [4, 2],
	});

	const [fed] = useCanonicalSessionsStore.getState().sessions;
	// The row is the frame's, stamp and all - otherwise the render below would be
	// of something the feed never sent.
	assert.deepEqual(fed.status, { code: "complete", label: "Complete" });
	assert.equal(fed.status_revision, 3);
	assert.equal(fed.status_epoch, FEED_EPOCH);

	const markup = renderToStaticMarkup(
		createElement(ChatSessionStatus, { row: fed }),
	);
	assert.match(markup, /lucide-check/);
	assert.match(markup, /text-success/);
	// The label is the frame's own (`Complete`), so the name reads with it.
	assert.match(markup, /sr-only">Complete, unread</);

	// And the mark is not what makes it complete: acknowledging the completion
	// rests the ICON back to a plain ring and keeps the code, which is the
	// behaviour the twelve cases above pin for a hand-built row.
	useCanonicalSessionsStore.getState().applyAttention(FEED_SESSION, {
		conversation_id: `session/${FEED_SESSION}`,
		completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		anchor_id: "row-1",
		kind: "complete",
		unseen: false,
		revision: [4, 3],
	});
	const acknowledged = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: useCanonicalSessionsStore.getState().sessions[0],
		}),
	);
	assert.match(acknowledged, /lucide-circle /);
	assert.doesNotMatch(acknowledged, /lucide-check|text-success|unread/);
});

/*
 * ---------------------------------------------------------------------------
 * THE OUTSTANDING-ASKS MARK (operator ask, 2026-10-04)
 * ---------------------------------------------------------------------------
 *
 * The operator's report: he queued a question, the composer chip beside it read
 * "1 question waiting", and the session's sidebar row showed nothing - he only
 * knew because a notification fired. The mark itself was right; the READ behind
 * it was not. `ChatAsksOutstanding` read `row.asks_open`, and the desktop
 * catalogue route never fills that field, so the mark drew nothing on every
 * desktop install.
 *
 * These cases pin the two halves: the count may come from the caller (the
 * sidebar passes the fleet aggregate's per-conversation count, the read that
 * actually answers), and the row's own field is still honoured when that is all
 * a caller has.
 */
const asksMark = (props) =>
	renderToStaticMarkup(createElement(ChatAsksOutstanding, props));
const asksRow = (asks_open) => ({
	session_id: "fixture",
	status: { code: "idle", label: "idle" },
	asks_open,
});

test("the asks mark draws the caller's count, in the accent glyph and the count ink", () => {
	const markup = asksMark({ row: asksRow(undefined), open: 2 });
	// One fact, one glyph: the same mark the question dock spends on "the agent
	// is asking".
	assert.match(markup, /lucide-message-circle-question/);
	// THE ACCENT CARRIES THE GLYPH AND ONLY THE GLYPH (design round 1, D1). The row
	// can be `row-selected`/`row-hover`, where `accent` measures 4.24:1 at worst
	// over the fifty-nine palettes - under SC 1.4.3's 4.5:1 for the 12px count
	// digits. A 14px glyph is a GRAPHIC and clears its 3:1 floor there, so the
	// accent stays on the icon and the numeral takes `ink-muted` (5.53:1 worst on
	// every ground this row can sit on). `scripts/contrast-contract.mjs`'s
	// "session row ask mark" row asserts the numeral's half.
	assert.match(markup, /text-accent/);
	// The numeral's own span, caught as a unit: it must carry the count ink and
	// NOT the accent, which is the whole finding.
	const numeral = markup.match(/<span class="([^"]*)">2<\/span>/);
	assert.ok(numeral, "the count digits render in their own span");
	assert.match(numeral[1], /text-ink-muted/);
	assert.doesNotMatch(numeral[1], /text-accent/);
	assert.match(
		markup,
		/aria-label="2 asks outstanding\. The agent is not blocked on you\."/,
	);
});

test("zero, absent and unreadable counts draw nothing at all", () => {
	// A zero badge is a claim that something is happening; the honest state of
	// "nothing outstanding" is no mark. `null` and `NaN` are the wire failing to
	// say a number, not a count of zero.
	assert.equal(asksMark({ row: asksRow(undefined), open: 0 }), "");
	assert.equal(asksMark({ row: asksRow(undefined) }), "");
	assert.equal(asksMark({ row: asksRow(0) }), "");
	assert.equal(asksMark({ row: asksRow(null) }), "");
	assert.equal(asksMark({ row: asksRow(Number.NaN) }), "");
});

test("the row's own field answers when the caller has no read, and the caller wins when it has one", () => {
	// A caller holding a canonical row and no aggregate (a story, a second
	// surface) keeps working; a caller with a read states the number, so the two
	// sources can never both draw a count.
	assert.match(asksMark({ row: asksRow(1) }), />1</);
	assert.match(asksMark({ row: asksRow(5), open: 2 }), />2</);
	assert.doesNotMatch(asksMark({ row: asksRow(5), open: 2 }), />5</);
});

test("waiting uses a static accent hourglass and the backend accessible name", () => {
	const label = "Waiting on 2 jobs · 1 subagent running";
	const html = render("waiting", false, label);
	assert.match(html, /lucide-hourglass/);
	assert.match(html, /text-accent/);
	assert.doesNotMatch(html, /animate-spin/);
	assert.match(html, /sr-only">Waiting on 2 jobs · 1 subagent running</);
});

test("a link-down remote row cannot draw or announce its last-known idle state", () => {
	const html = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "offline-fixture",
				locality: "remote",
				link_down: true,
				last_seen_at: null,
				status: { code: "idle", label: "Idle" },
			},
		}),
	);
	assert.match(html, /lucide-wifi-off/);
	assert.match(html, /link down · last seen unknown/);
	assert.doesNotMatch(html, /lucide-circle |Idle|animate-spin/);
	const recovered = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "offline-fixture",
				locality: "remote",
				link_down: false,
				status: { code: "idle", label: "Idle" },
			},
		}),
	);
	assert.match(recovered, /lucide-circle /);
	assert.doesNotMatch(recovered, /lucide-wifi-off|link down/);
});

test("remote glyph and sidebar age copy share the supplied list clock", () => {
	const row = {
		session_id: "clock-fixture",
		locality: "remote",
		link_down: true,
		last_seen_at: 100,
		status: { code: "idle", label: "Idle" },
	};
	const html = renderToStaticMarkup(
		createElement(ChatSessionStatus, { row, nowSeconds: 340 }),
	);
	assert.match(html, /link down · last seen 4m ago/);
	assert.equal(peerLinkDownLabel(row, 340), "link down · last seen 4m ago");
	assert.equal(peerLinkDownVisibleLabel(row, 340), "Link down · 4m ago");
	// A date far from the real clock proves the glyph is not consulting Date.now().
	assert.doesNotMatch(html, /Idle|d ago/);
});

const renderRow = (row) =>
	renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: { session_id: "fixture", ...row },
		}),
	);

/*
 * THE PRECEDENCE RULE, pinned (agent review round 1, R1-2; this is design round
 * 1's D1, which was a BLOCKER). The runtime publishes `delegating` only when no
 * louder code applies (`catalog.py:268-330`), so a live child count ALWAYS rides
 * beside a louder fact - and the count may never replace it. A cell that asked
 * the counts first would pass every other test in this file, which is why each
 * louder code gets its own case here rather than one representative: the trio is
 * `delegating`'s alone, and a queued glyph is never drawn over a louder glyph.
 */
for (const [code, icon] of [
	["approval", "lucide-message-circle-question"],
	["answer", "lucide-message-circle-question"],
	["wedged", "lucide-equal-approximately"],
	["busy", "lucide-loader-circle"],
	["waiting", "lucide-hourglass"],
	["interrupted", "lucide-pause"],
	["scheduled", "lucide-clock"],
	["idle", "lucide-circle "],
]) {
	test(`${code} keeps its own glyph while children run and queue`, () => {
		const html = renderRow({
			status: { code, label: code },
			subagents_running: 2,
			subagents_queued: 1,
		});
		assert.match(html, new RegExp(icon), `${code} must keep its own glyph`);
		assert.equal(
			(html.match(/fill="currentColor"/g) ?? []).length,
			0,
			`${code}: no lane without core's background_work flag`,
		);
		assert.doesNotMatch(html, /data-subagent-mark/);
	});
}

test("an unread completion keeps its check while children run", () => {
	const html = renderRow({
		status: { code: "complete", label: "complete, unread" },
		attention: { unseen: true },
		subagents_running: 2,
	});
	assert.match(html, /lucide-check/);
	assert.match(html, /text-success/);
	assert.equal(
		(html.match(/fill="currentColor"/g) ?? []).length,
		0,
		"no lane without core's background_work flag; the check stays",
	);
});

/*
 * THE RUNNING LANE (2026-11-07): drawn UNDER every glyph while core says
 * `background_work`, never in place of it - geometry pinned so an edit cannot
 * quietly grow it into the cell or move the row: 10x2, radius 1, absolute,
 * accent ink through currentColor on an SVG rect (forced-colors survives).
 */
const LANE =
	/<svg aria-hidden="true" data-background-work="" viewBox="0 0 10 2" width="10" height="2" class="[^"]*absolute[^"]*text-accent[^"]*"><rect width="10" height="2" rx="1" fill="currentColor"><\/rect><\/svg>/;

for (const [code, icon] of [
	["idle", "lucide-circle "],
	["complete", "lucide-circle "],
	["approval", "lucide-message-circle-question"],
	["error", "lucide-circle-alert"],
	["busy", "lucide-loader-circle"],
	["attached", "lucide-message-square"],
	["interrupted", "lucide-pause"],
]) {
	test(`${code} keeps its glyph and gains the lane while background work runs`, () => {
		const html = renderRow({
			status: { code, label: code },
			background_work: true,
			subagents_running: 1,
			jobs_running: 1,
		});
		assert.match(html, new RegExp(icon));
		assert.match(html, LANE);
		assert.match(html, /relative flex size-4 shrink-0/);
	});
}

test("the lane leaves with the work, in the same render", () => {
	const html = renderRow({
		status: { code: "idle", label: "Idle" },
		background_work: false,
		subagents_running: 0,
		jobs_running: 0,
	});
	assert.doesNotMatch(html, /data-background-work/);
});

test("queued-only rests on the ring plus the lane (the Timer is retired)", () => {
	const html = renderRow({
		status: { code: "delegating", label: "1 subagent queued" },
		background_work: true,
		subagents_queued: 1,
	});
	assert.match(html, /lucide-circle /);
	assert.match(html, LANE);
	assert.doesNotMatch(html, /lucide-timer/);
});

test("a remote row draws the lane; a link-down or uncertain one does not", () => {
	const remote = {
		session_id: "remote-fixture",
		locality: "remote",
		owner_device: "synthetic-peer",
		status: { code: "idle", label: "Idle" },
		background_work: true,
		subagents_running: 1,
	};
	assert.match(
		renderToStaticMarkup(createElement(ChatSessionStatus, { row: remote })),
		LANE,
	);
	for (const stale of [{ link_down: true }, { peer_reach: "unknown" }]) {
		const html = renderToStaticMarkup(
			createElement(ChatSessionStatus, {
				row: { ...remote, ...stale },
				nowSeconds: 340,
			}),
		);
		assert.doesNotMatch(html, /data-background-work/, JSON.stringify(stale));
	}
});

test("not-attempted remote reach does not claim idle or link loss", () => {
	const html = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "not-asked-fixture",
				locality: "remote",
				link_down: false,
				peer_reach: "not-attempted",
				status: { code: "idle", label: "Idle" },
			},
		}),
	);
	assert.match(html, /not asked/);
	assert.match(
		html,
		/lucide-circle-question-mark|lucide-help-circle|lucide-circle-help/,
	);
	assert.doesNotMatch(html, /Idle|link down|lucide-circle /);
});

/* The reconnecting cell's patterns, at TOP LEVEL per the scripts lint ratchet. */
const WIFI_OFF_RE = /lucide-wifi-off/;
const STALE_IDLE_RE = /lucide-circle |Idle/;
const DIM_INK_RE = /text-ink-dim/;
const WARNING_INK_RE = /text-warning/;
const RECONNECTING_AGE_RE = /Reconnecting · 3m ago/;
const LINK_DOWN_AGE_RE = /link down · last seen 3m ago/;

test("a remote row inside the relay's redial grace says Reconnecting in dim ink", () => {
	const row = {
		session_id: "reconnecting-fixture",
		locality: "remote",
		link_down: true,
		link_reconnecting: true,
		last_seen_at: 100,
		status: { code: "idle", label: "Idle" },
	};
	const html = renderToStaticMarkup(
		createElement(ChatSessionStatus, { row, nowSeconds: 280 }),
	);
	// Still the lost-link SHAPE and still no stale idle claim...
	assert.match(html, WIFI_OFF_RE);
	assert.doesNotMatch(html, STALE_IDLE_RE);
	// ...but quiet ink and the reconnecting sentence with a real last-seen age.
	assert.match(html, DIM_INK_RE);
	assert.doesNotMatch(html, WARNING_INK_RE);
	assert.match(html, RECONNECTING_AGE_RE);
	// Escalated: the same row once the relay says `down` is amber "link down".
	const down = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: { ...row, link_reconnecting: false },
			nowSeconds: 280,
		}),
	);
	assert.match(down, WARNING_INK_RE);
	assert.match(down, LINK_DOWN_AGE_RE);
});

/** The three surfaces the derivation has to reach (see the tests below). */
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const TAG_HEADER =
	"src/renderer/src/features/chat/components/chat-tag-header.tsx";
const SWITCHER =
	"src/renderer/src/features/session-switcher/components/session-switcher.tsx";

/*
 * ---------------------------------------------------------------------------
 * ONE OPEN QUEUED ASK DRAWS ONE ASK GLYPH (operator report, 2026-11-22/23)
 * ---------------------------------------------------------------------------
 *
 * The core files an open queued ask under status code `answer` (it claims the
 * record's `pending`, and `catalog.status_code` ranks that above busy and idle),
 * and the sidebar ALSO draws the ask count beside it. Both are the same
 * `MessageCircleQuestion`, so an idle conversation with one ask read as two ask
 * icons. PR #2053 rebuilt the status mark from `live_state` while the ask mark
 * owns the ask; this file pins the rest of the operator's report - the APPROVAL
 * case, which still drew two bubbles, the count that has to be said in words
 * once its glyph yields, and the section a derived row must file under - plus the
 * two surfaces that draw a row's status with no ask mark of their own.
 *
 * `cluster` is what one sidebar row draws left of the title: the status mark and
 * the asks mark, in that order, the way `chat-sidebar.tsx` composes them - BOTH
 * from the DERIVED row, which is the wiring the sidebar carries now (the
 * derivation happens over the list, in `withQueuedAskStatuses`). The OLD wiring
 * is the same call without the derivation (the RED control).
 */
const questionGlyphs = (markup) =>
	(markup.match(/lucide-message-circle-question/g) ?? []).length;
const askRow = (extra = {}) => ({
	session_id: "fixture",
	status: { code: "answer", label: "Answer needed" },
	...extra,
});
const cluster = (row, open, wired = true) => {
	const drawn = wired ? withQueuedAskStatus(row, open) : row;
	return (
		renderToStaticMarkup(createElement(ChatSessionStatus, { row: drawn })) +
		renderToStaticMarkup(
			createElement(ChatAsksOutstanding, { row: drawn, open }),
		)
	);
};
const APPROVAL = () =>
	askRow({
		live_state: "idle",
		status: { code: "approval", label: "Approval needed" },
	});

test("RED control: the old wiring drew two ask glyphs for one open ask", () => {
	const old = cluster(askRow({ live_state: "idle" }), 1, false);
	assert.equal(questionGlyphs(old), 2);
	assert.match(old, /Answer needed/);
});

test("idle with one open ask: a resting ring and ONE ask mark", () => {
	const markup = cluster(askRow({ live_state: "idle" }), 1);
	assert.equal(questionGlyphs(markup), 1);
	assert.match(markup, /lucide-circle /);
	assert.doesNotMatch(markup, /Answer needed/);
	assert.match(markup, /sr-only">Recent</);
	// The ask mark is still there, with its count and its own sentence.
	assert.match(markup, /aria-label="1 ask outstanding/);
});

test("busy with one open ask: the spinner and ONE ask mark", () => {
	const markup = cluster(askRow({ live_state: "busy" }), 1);
	assert.equal(questionGlyphs(markup), 1);
	assert.match(markup, /lucide-loader-circle/);
	assert.match(markup, /motion-safe:animate-spin/);
	assert.doesNotMatch(markup, /Answer needed/);
	assert.match(markup, /sr-only">Working</);
});

test("the count may come from the row's own field as well as the caller", () => {
	const markup = cluster(
		askRow({ live_state: "idle", asks_open: 3 }),
		undefined,
	);
	assert.equal(questionGlyphs(markup), 1);
	assert.match(markup, /lucide-circle /);
});

test("[M-sidebar-approval-asks1] an approval with an open ask draws ONE bubble, and says the count", () => {
	/*
	 * THE REMAINING TWO-BUBBLE CASE (the operator's report, and what #2053 left
	 * deferred): `withQueuedAskStatus` returns early for any code but `answer`, so
	 * an approval parked beside an open ask still drew the status cell's amber
	 * question bubble AND the ask mark's accent one. The approval owns that glyph,
	 * so the mark yields and the count rides the sentence.
	 */
	const one = cluster(APPROVAL(), 1);
	assert.equal(questionGlyphs(one), 1);
	// The one glyph is the status cell's: the ask mark, whose root is a labelled
	// image, is not drawn at all.
	assert.doesNotMatch(one, /role="img"/);
	assert.match(one, /sr-only">Approval needed\. 1 ask</);
	// NOT the mark's own sentence, whose "The agent is not blocked on you" is
	// false under a blocking approval.
	assert.doesNotMatch(one, /not blocked on you/);
	const two = cluster(APPROVAL(), 2);
	assert.equal(questionGlyphs(two), 1);
	assert.match(two, /sr-only">Approval needed\. 2 asks</);
	// The code keeps its own ink: this is a blocking gate, not a resting row.
	assert.match(two, /text-warning/);
	assert.doesNotMatch(two, /lucide-circle /);
});

test("[M-row-approval-asks3] the derived approval row keeps its code and carries the count", () => {
	const wire = APPROVAL();
	const derived = withQueuedAskStatus(wire, 3);
	assert.equal(derived.status.code, "approval");
	assert.equal(derived.status.label, "Approval needed");
	assert.equal(derived.asks_open, 3);
	// The sentence is empty on the wire row (no count) and on every other code,
	// and states the count exactly once on the derived one.
	assert.equal(approvalAsksSentence(wire), "");
	assert.equal(approvalAsksSentence(derived), ". 3 asks");
	assert.equal(approvalAsksSentence(askRow({ live_state: "idle" }), 2), "");
	assert.equal(openAskCount(wire), null);
	assert.equal(openAskCount(wire, 3), 3);
});

test("[M-sidebar-answer-fallback-asks1] attached and unread-completion rows keep the documented resting ring", () => {
	/*
	 * THE COLLAPSE IS PINNED, not lost (the docblock's "what it does NOT
	 * recover"): a session that is attached, or that holds an unread completion,
	 * is a real state under `answer`, but re-deriving it would be the second
	 * precedence rule the contract forbids. The ask mark carries the ask and the
	 * ring says nothing is running - asserted so a later change cannot move it
	 * silently.
	 */
	for (const extra of [
		{ live_state: "attached" },
		{ attention: { unseen: true, kind: "complete" } },
		{ live_state: "waiting" },
	]) {
		const markup = cluster(askRow(extra), 1);
		assert.equal(questionGlyphs(markup), 1);
		assert.match(markup, /lucide-circle /);
		assert.doesNotMatch(markup, /Answer needed/);
	}
});

test("[M-sidebar-answer-linkdown-asks1] a remote or uncertain override keeps its own glyph beside the ask mark", () => {
	// The louder fact wins over the derived code, and the ask mark still draws -
	// one glyph each, never two of the same.
	const down = cluster(
		askRow({
			live_state: "idle",
			locality: "remote",
			link_down: true,
			last_seen_at: null,
		}),
		1,
	);
	assert.equal(questionGlyphs(down), 1);
	assert.match(down, /lucide-wifi-off/);
	const uncertain = cluster(
		askRow({ live_state: "idle", peer_reach: "unknown" }),
		1,
	);
	assert.equal(questionGlyphs(uncertain), 1);
	assert.match(uncertain, /lucide-circle-help/);
	// An APPROVAL over a lost link: the status cell is the link's mark, the ask
	// mark still yields, and the count is spoken rather than drawn.
	const approvalDown = cluster(
		askRow({
			live_state: "idle",
			locality: "remote",
			link_down: true,
			last_seen_at: null,
			status: { code: "approval", label: "Approval needed" },
		}),
		2,
	);
	assert.equal(questionGlyphs(approvalDown), 0);
	assert.match(approvalDown, /link down · last seen unknown\. 2 asks/);
});

test("[M-sidebar-answer-nocount] a count the wire could not state leaves the blocking glyph and its words", () => {
	for (const asks_open of [Number.NaN, -2, 0, undefined, null]) {
		const row = askRow({ live_state: "idle", asks_open });
		assert.equal(withQueuedAskStatus(row), row);
		const markup = cluster(row, undefined);
		assert.equal(questionGlyphs(markup), 1);
		assert.match(markup, /Answer needed/);
	}
});

test("other codes pass through untouched", () => {
	for (const code of ["busy", "complete", "recent", "wedged", "error"]) {
		const row = askRow({ status: { code, label: code } });
		assert.equal(withQueuedAskStatus(row, 2), row);
	}
});

test("[M-sidebar-anycode-asks1] no code ever draws two ask glyphs for one open ask", () => {
	// The operator's ask, as an invariant rather than a case: "there is ONE ask
	// icon, never two, in every case".
	const codes = [
		"answer",
		"approval",
		"busy",
		"waiting",
		"recent",
		"complete",
		"error",
		"wedged",
		"interrupted",
		"dormant",
		"scheduled",
		"attached",
		"delegating",
	];
	for (const code of codes) {
		for (const live of ["idle", "busy", "attached", undefined]) {
			for (const open of [1, 3]) {
				const markup = cluster(
					askRow({ live_state: live, status: { code, label: code } }),
					open,
				);
				assert.ok(
					questionGlyphs(markup) <= 1,
					`${code}/${live}/${open} drew ${questionGlyphs(markup)} ask glyphs`,
				);
			}
		}
	}
});

test("[M-list-helper-asks2] the list helper derives every named row from one count map", () => {
	const idle = askRow({ live_state: "idle" });
	const approval = APPROVAL();
	const quiet = {
		session_id: "quiet",
		status: { code: "recent", label: "Recent" },
	};
	const derived = withQueuedAskStatuses(
		[idle, approval, quiet],
		new Map([["fixture", 2]]),
	);
	assert.equal(derived[0].status.code, "recent");
	assert.equal(derived[0].asks_open, 2);
	assert.equal(derived[1].status.code, "approval");
	assert.equal(derived[1].asks_open, 2);
	// A row the map does not name is the very row it was: nothing to derive.
	assert.equal(derived[2], quiet);
	// The aggregate has not answered: every row is the row it was, unless its own
	// field states a count (the fallback the mark also reads).
	assert.deepEqual(withQueuedAskStatuses([idle, quiet], null), [idle, quiet]);
	const [own] = withQueuedAskStatuses(
		[askRow({ live_state: "idle", asks_open: 1 })],
		null,
	);
	assert.equal(own.status.code, "recent");
});

test("[M-sidebar-wiring] the sidebar derives the LIST before the partitions and the arrangement", () => {
	/*
	 * THE WIRING IS THE BUG (PR #2053's lesson): the helper was right on its own
	 * and the sidebar still drew two glyphs. Here it is the SECTION that disagrees
	 * with the mark unless the derivation happens upstream - `pageOrder`'s lift and
	 * `sectionRows` both read `status.code`, so a per-row derivation at the draw
	 * leaves an idle row with an ask filed at the top of RUNNING.
	 */
	const source = readFileSync(SIDEBAR, "utf8").replace(/\s+/g, " ");
	assert.match(
		source,
		/const matching = useMemo\( \(\) => withQueuedAskStatuses\(searchedRows, asksBySession\), \[searchedRows, asksBySession\], \);?/,
	);
	assert.match(
		source,
		/const pinned = pinnedRows\(matching, pinsEnabled\); const rest = unpinnedRows\(matching, pinsEnabled\);/,
	);
	assert.match(
		source,
		/<ChatAsksOutstanding row=\{row\} open=\{asksBySession\?\.get\(row\.session_id\)\}/,
	);
	// The pointer channel states the approval's count with the same sentence the
	// spoken name appends.
	assert.match(source, /\{approvalAsksSentence\(row\)\}/);
});

test("[M-surfaces-wiring] the tag header's live cue and the switcher read derived rows too", () => {
	/*
	 * A QUEUED ASK IS A DERIVED STATUS ON BOTH SURFACES - the header draws the row
	 * the sidebar hands it, and that row comes from the derived buckets
	 * (`foldedLiveCue(bucket.rows, ...)` over rows that derive from `matching`,
	 * pinned above); the switcher has no shared list, so it derives on its own.
	 *
	 * THE SWITCHER ALSO DRAWS THE ASK MARK (design round 1, D1), and the mark is
	 * handed the count the way the sidebar hands it: the catalogue route never
	 * fills `asks_open`, and the derivation only writes the count into the rows
	 * whose code it rewrites.
	 */
	const header = readFileSync(TAG_HEADER, "utf8").replace(/\s+/g, " ");
	assert.match(header, /<ChatSessionStatus row=\{live\.row\} \/>/);
	const sidebar = readFileSync(SIDEBAR, "utf8").replace(/\s+/g, " ");
	assert.match(
		sidebar,
		/live=\{topLevel \? foldedLiveCue\(bucket\.rows, collapsed\) : null\}/,
	);
	const switcher = readFileSync(SWITCHER, "utf8").replace(/\s+/g, " ");
	assert.match(
		switcher,
		/withQueuedAskStatus\( row\.row, asksBySession\?\.get\(row\.sessionId\), \)/,
	);
	assert.match(switcher, /fleetAsksBySession\(fleetAsks\.rows\)/);
	// The mark sits on the derived row (the switcher row's `row` prop is the result
	// of the derivation above) and is handed that same aggregate read.
	assert.match(
		switcher,
		/<ChatAsksOutstanding row=\{row\.row\} open=\{open\} \/>/,
	);
	assert.match(switcher, /open=\{asksBySession\?\.get\(row\.sessionId\)\}/);
});

/*
 * THE SWITCHER'S MARK CLUSTER, RENDERED (design round 1, D1). The switcher drew
 * no ask mark of its own before this round, so an idle conversation holding a
 * question was a bare ring - visually and to a screen reader the same row as one
 * with nothing waiting. These cases render the composition the switcher draws
 * (the derived row into the status mark, the same derived row and the same count
 * into the ask mark) and pin one ask glyph per row in every state.
 */
const switcherCluster = (row, open) => {
	const derived = withQueuedAskStatus(row, open);
	return renderToStaticMarkup(
		createElement(
			"div",
			null,
			createElement(ChatSessionStatus, { row: derived }),
			createElement(ChatAsksOutstanding, { row: derived, open }),
		),
	);
};
const askGlyphs = (markup) =>
	(markup.match(/lucide-message-circle-question/g) ?? []).length;
const wireRow = (code, live_state) => ({
	session_id: "fixture",
	status: { code, label: code === "answer" ? "Answer needed" : code },
	live_state,
});

test("[M-switcher-asks] one ask glyph per switcher row, in every state", () => {
	// idle + 1 ask: the derived status rests on the ring, and the mark is the one
	// thing on the row that says a question is waiting - beside it, not instead
	// of it. The count rides the mark's own name, which is inside the row's
	// button, so the row's accessible name states it too.
	const idle = switcherCluster(wireRow("answer", "idle"), 1);
	assert.match(idle, /lucide-circle /);
	assert.equal(askGlyphs(idle), 1);
	assert.match(
		idle,
		/aria-label="1 ask outstanding\. The agent is not blocked on you\."/,
	);
	// busy + 1 ask: the spinner keeps its slot and the ask mark rides beside it -
	// the old switcher hid this spinner behind a bubble, and the new one must not.
	const busy = switcherCluster(wireRow("answer", "busy"), 1);
	assert.match(busy, /lucide-loader-circle/);
	assert.equal(askGlyphs(busy), 1);
	// A row whose own code the derivation leaves alone (this one is neither `answer`
	// nor `approval`) carries no count of its own, so this is the case that proves
	// the mark is reading the aggregate and not the row: without `open` it draws
	// nothing.
	assert.equal(
		withQueuedAskStatus(wireRow("recent", "idle"), 1).asks_open,
		undefined,
	);
	assert.equal(askGlyphs(switcherCluster(wireRow("recent", "idle"), 1)), 1);
	// approval + 2 asks: the status cell's amber bubble already spends the glyph,
	// so the mark yields - the row keeps exactly one bubble, and the count is
	// heard in the status sentence rather than drawn a second time.
	const approval = switcherCluster(wireRow("approval", "idle"), 2);
	assert.equal(askGlyphs(approval), 1);
	assert.match(approval, /2 asks/);
	// Nothing outstanding draws no mark at all, which is what keeps the title edge
	// where it was on every row without a question.
	const none = switcherCluster(wireRow("recent", "idle"), undefined);
	assert.equal(askGlyphs(none), 0);
	assert.doesNotMatch(none, /role="img"/);
});
