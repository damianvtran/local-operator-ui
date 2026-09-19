import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const result = await build({
	stdin: {
		contents:
			'export { ChatSessionStatus } from "./src/renderer/src/features/chat/components/chat-session-status"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";',
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
const { ChatSessionStatus, renderToStaticMarkup, createElement } =
	output.exports;
const render = (code, unseen) =>
	renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "fixture",
				status: { code, label: code },
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
	["answer", "circle-alert", "warning"],
	["approval", "circle-alert", "warning"],
	["scheduled", "clock", "ink-dim"],
	["attached", "message-square", "ink-dim"],
	["idle", "circle", "ink-dim"],
	["dormant", "pause", "ink-dim"],
	["unknown", "circle-help", "ink-dim"],
]) {
	test(`${code} does not lose status when acknowledged`, () => {
		const before = render(code, true);
		const after = render(code, false);
		assert.equal(after, before);
		assert.match(after, new RegExp(`lucide-${icon}`));
		assert.match(after, new RegExp(`text-${ink}`));
	});
}

/*
 * The separation itself, asserted as a RELATION between two rows.
 *
 * A table row proves what `wedged` draws; it cannot prove that what it draws is
 * different from `error`, and sameness is exactly what the defect was. So this
 * case renders the pair and compares them, on both channels that carry the mark:
 * the glyph and the ink. The ink half is checked as inequality rather than as two
 * literals because this product's own measurement records the two inks CONVERGING
 * under deuteranopia — the silhouettes have to differ on their own, and a test
 * that only pinned the two class names would pass with two identical marks in two
 * colours.
 *
 * WHICH OF THESE ASSERTIONS DISCRIMINATES, because one of them does not on its
 * own (QA round 1, Q-1). `notEqual` is a smoke assertion: the two rows differ in
 * their LABELS as well as their marks, so it passes for the exact regression this
 * case exists to catch — a `wedged` row wearing `error`'s silhouette in the
 * warning ink — and both reviewers had to mutate the component to establish that.
 * The discriminating pair is `match(/lucide-equal-approximately/)` with
 * `doesNotMatch(/lucide-circle-alert/)`: those two fail on such a mutant while
 * `notEqual` still passes. They are kept TOGETHER and after it, so the shape is
 * named rather than left to be inferred from a case that reads like an
 * inequality test.
 */
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
