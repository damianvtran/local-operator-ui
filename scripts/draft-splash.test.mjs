import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

/*
 * The composer band on a NEW CHAT: what decides whether it is still waiting.
 *
 * The operator's report was a stuck draft splash - on a fresh New chat the band
 * rendered the hydration skeleton and its "Loading conversation…" line forever,
 * instead of the greeting and the suggestion chips. The cause was one read:
 * `chat-content.tsx` gave the composer `!canonical.view.hydrated`, and on a New
 * chat the pane is a staged DRAFT, `useCanonicalSessionStream(undefined, false)`
 * early-returns without subscribing, so no page can ever be applied and
 * `hydrated` stays false for as long as the pane is open. The composer was
 * therefore told "still loading" forever, which is the one state in which it
 * may show neither the greeting nor a transcript (design D22).
 *
 * WHAT IS ASSERTED, AND WITH WHICH INSTRUMENT. Two halves, because they fail
 * differently and neither instrument can see the other's half:
 *
 *   1. The decision itself, against the SHIPPED hook, rendered with
 *      `renderToStaticMarkup`. This is the real module through the app's own
 *      aliases; SSR renders it without running its effects, which is exactly
 *      right here - the claim is about what a session-less handle says, and the
 *      draft's defining property is that its effect does NOT run.
 *      `awaitingHydration` is the composed fact the composer now reads, and the
 *      case that matters is the first one: a session-less pane owes no page.
 *      The raw `hydrated` field is asserted too, so that a later attempt to
 *      "fix" this by redefining it there fails here rather than silently
 *      changing what every other reader of that field is told.
 *
 *   2. The wiring, on the SOURCE of `chat-content.tsx`, because the composer
 *      cannot be rendered in isolation - `MessageInput` needs a message list, a
 *      dispatcher and the canonical store, which is the argument
 *      `composer-readings.test.mjs` records for asserting its row half on the
 *      source as well. What a rendered composer would prove is only that its
 *      `isHydrating` prop picks its branch; the defect was which fact was passed
 *      into that prop, and that is a fact about one JSX expression. The
 *      EXPRESSION is evaluated against handle-shaped probes rather than
 *      compared to source text, so a semantics-preserving reformat does not
 *      redden it (code review round 1, N4).
 *
 *   3. OUT OF SCOPE HERE: the composer band's suggestion STACK and its
 *      containment (design round 1, D1) is asserted in
 *      `suggestion-stack.test.mjs`. A separate file on purpose: these four cases
 *      are red on the tree before this branch, which is what makes them a guard,
 *      and a rule this branch ADDS would make that tree stop at resolution
 *      instead of failing its assertions.
 *
 * ONE THING THIS TEST DOES NOT REACH: a real session whose page HAS landed, i.e.
 * the settled empty conversation, which is the other half of the composed rule
 * (`!hydrated`). `hydrated` only turns true when a stream delivers a page, and
 * that transition is already pinned where it happens, on the same hook, in
 * `session-load-recovery.test.mjs` ("an empty applied page IS a claim the app
 * may make", `hydrated === true`). Re-mounting a transport fixture here would
 * be a second copy of that harness asserting the same transition, and the
 * settled frame is captured instead: docs/evidence/draft-splash/.
 */

const SESSION = "7c9e6679-7425";

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { useCanonicalSessionStream } from "./src/renderer/src/shared/hooks/use-canonical-session";
			/*
			 * Renders the hook ONCE and hands back the handle it returned. The
			 * probe renders nothing on purpose: the handle is the whole subject.
			 */
			export const handleFor = (sessionId, enabled) => {
				let handle = null;
				const Probe = () => {
					handle = useCanonicalSessionStream(sessionId, enabled);
					return null;
				};
				renderToStaticMarkup(createElement(Probe));
				return handle;
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports (the composer-readings.test.mjs argument: two copies give the
	// component a different React than the renderer uses, and every render
	// throws on an invalid hook call).
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: React DOM's
// server build resolves its own CJS entry at import time, which a data: URL
// has no base path for.
const bundlePath = new URL("./_draft-splash.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { handleFor } = await import(bundlePath.href);
await unlink(bundlePath);

/**
 * The composer's own property, stated once so the assertions read as claims
 * about the band rather than about a field.
 */
const waits = (handle) => handle.awaitingHydration;

test("a session-less draft owes no page, so the band may assert the greeting", () => {
	// The New chat pane, exactly as `chat-page.tsx` builds it: `sessionId` is
	// undefined while a draft is staged, so `enabled` is false and the stream
	// deliberately opens nothing.
	const draft = handleFor(undefined, false);

	assert.equal(
		draft.hydrated,
		false,
		"a draft has no stream, so no page is ever applied - this is the fact that used to be read as 'still loading'",
	);
	assert.equal(
		waits(draft),
		false,
		"a pane with no session has no page coming; waiting on one is the stuck skeleton the operator reported",
	);
	assert.equal(
		draft.subscriptionId,
		null,
		"the draft's stream stays off - the fix is about what the composer claims, never about opening a transport before a session exists",
	);
});

test("a real session whose page has not landed still waits", () => {
	// A cold conversation: the stream is opening and no page has arrived yet.
	// `hydrated` is false here too, and the difference between this and the
	// draft is the whole point of the composed rule.
	const cold = handleFor(SESSION, true);

	assert.equal(cold.hydrated, false);
	assert.equal(
		waits(cold),
		true,
		"an unread conversation must keep the skeleton rather than paint the greeting over rows that may exist (design D7)",
	);
});

test("a session with its stream deliberately off does not wait forever", () => {
	// No product call site does this today, and that is why the term is in the
	// rule: a caller that holds the stream off on purpose would otherwise strand
	// the composer in a wait that cannot end, because `hydrated` cannot turn
	// true without a subscription. The trade runs the other way too - such a
	// caller is asserting there is nothing to wait FOR, so it must not read the
	// band's empty-conversation state out of this field (the field's docstring
	// says so; code review round 1, M1).
	const held = handleFor(SESSION, false);

	assert.equal(
		waits(held),
		false,
		"a stream that is not running owes no page, so the wait is claimed only when there is something to wait FOR",
	);
});

test("the composer is given the composed fact, not the raw one", () => {
	/*
	 * The wiring half: the prop's own expression, EVALUATED against handle-shaped
	 * probes rather than compared to source text. The claim is which fact reaches
	 * `isHydrating`, and a `Boolean(...)` wrap, parentheses, optional chaining or
	 * a reordered ternary all make that same claim - requiring one exact string
	 * made a semantics-preserving reformat red (code review round 1, N4).
	 *
	 * The first probe is the one that tells the two rules apart: a draft has
	 * nothing applied AND nothing owed, and that is the state `!hydrated` got
	 * wrong. A probe where `hydrated` and `awaitingHydration` agree cannot fail
	 * the old expression, so the probes are chosen to disagree in that direction.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	const prop = source.match(/isHydrating=\{([\s\S]*?)\}/);
	assert.ok(
		prop,
		"chat-content.tsx no longer passes `isHydrating` to the composer at all - this guard is aimed at that expression",
	);
	const expression = prop[1];

	const probes = [
		// A New chat staged as a draft: no page applied, and none owed.
		{ view: { hydrated: false, awaitingHydration: false } },
		// A cold session whose page is still in flight (design D7): still waits.
		{ view: { hydrated: false, awaitingHydration: true } },
		// A settled conversation: nothing owed.
		{ view: { hydrated: true, awaitingHydration: false } },
		// No handle at all.
		null,
	];
	const expected = probes.map((probe) => probe?.view.awaitingHydration ?? false);

	let actual;
	try {
		actual = probes.map((probe) =>
			runInNewContext(`(${expression})`, { canonical: probe }),
		);
	} catch (error) {
		assert.fail(
			`the composer's \`isHydrating\` expression could not be evaluated with only a \`canonical\` handle in scope (${error.message}) - this guard reads that expression off the source, so it has to be re-aimed at whatever now carries the fact`,
		);
	}

	assert.deepEqual(
		actual,
		expected,
		"the composer's loading state is the session handle's own claim that a page is owed; feeding it anything else is how a New chat came to wait on a page that does not exist",
	);
	assert.doesNotMatch(
		expression,
		/\.hydrated\b/,
		"`hydrated` answers 'has an authoritative page been applied for this session', which is false forever on a pane that has no session - the composer must not read it directly (use the handle's composed field). Asserted on the prop's own expression, not file-wide: a later legitimate reader of that field elsewhere in this file is not this defect (code review round 1, N4).",
	);
});


