import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's readings row: what a DRAFT renders, and the layout contract
 * that keeps the four readings in one row without clipping any of them.
 *
 * `session-status.test.mjs` owns the strip's ARITHMETIC (three ports and the
 * payloads a real backend sent); nothing pinned what the strip renders when
 * there is no session yet, which is the state the operator reported as empty.
 * These are rendered-markup assertions because that is where the defects are:
 * a chip that renders as a control with nothing to open, a cost chip on a pane
 * that has spent nothing, and a truncation that would turn `≥$0.0…` into a
 * false claim. None of those are visible to a test over the model functions.
 *
 * Rendering with `renderToStaticMarkup`, against the shipped component with
 * the app's own aliases, on a payload shaped like the one
 * `POST /v1/desktop/sessions/preview` answers with (a `CanonicalFrontendSync`
 * whose `snapshot.session_id` is empty). A story shows the same thing to a
 * person; this fails the build when the markup changes under it.
 *
 * The row half is asserted on the SOURCE, because the composer cannot be
 * rendered in isolation: `MessageInput` needs a message list, a dispatcher and
 * the canonical store. The layout, the placement and the auto-margin rule are
 * class strings on two elements, so the source is the accurate instrument —
 * the same argument `canonical-chat.test.mjs` makes for the slash popup's
 * ancestors. The rendered geometry itself is measured in the live frames.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { SessionStatusStrip } from "./src/renderer/src/features/chat/session-status/session-status-strip";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";

			export const renderStrip = (props) =>
				renderToStaticMarkup(createElement(SessionStatusStrip, props));
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
	// imports. Two copies give the component a different React than the server
	// renderer uses, and every render throws on an invalid hook call.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: React DOM's
// server build resolves its own CJS entry at import time, which a data: URL
// has no base path for.
const bundlePath = new URL("./_composer-readings.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { renderStrip, desktopEndpoint, desktopRequestSchema } = await import(
	bundlePath.href
);
await unlink(bundlePath);

/** The rendered text a user reads, with markup and layout whitespace removed. */
function text(html) {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** One element's class list, found by an attribute marker on the same tag. */
function stripRootClasses(html) {
	const match = html.match(
		/<div class="([^"]*)"[^>]*data-lo-session-strip="true"/,
	);
	assert.ok(match, "no element carries `data-lo-session-strip`");
	return match[1].split(/\s+/);
}

const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/**
 * A model spec with a four-rung ladder, i.e. a draft on this machine's config.
 * Copied from `session-status.test.mjs`'s capture fixtures: the same spec a
 * real backend sent, so the draft frame is not a shape nobody has.
 */
const GPT_5 = {
	provider: "openrouter",
	model_id: "openai/gpt-5",
	display_name: "OpenAI: GPT-5",
	reasoning: true,
	reasoning_effort: "high",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

/** A draft's payload: identity and window known, nothing measured, no spend. */
const DRAFT = {
	effective_model: GPT_5,
	selected_model: null,
	context_tokens: null,
	context_window: 400_000,
	context_is_estimate: null,
	cumulative_parent_cost: null,
	cost_knowledge: "unknown",
};

/**
 * The class list a reading's own box carries.
 *
 * Matched on the reading's `aria-label`, so the assertion is about the element
 * a screen reader is told about rather than about the Nth button in the row —
 * which is what moved in this change.
 */
function readingClasses(html, labelPrefix) {
	const match = html.match(
		new RegExp(
			`<button[^>]*aria-label="(${labelPrefix}[^"]*)"[^>]*class="([^"]*)"`,
		),
	);
	assert.ok(
		match,
		`no reading renders an aria-label starting \`${labelPrefix}\``,
	);
	return { label: match[1], classes: match[2].split(/\s+/) };
}

/* ---- 1. the draft renders three inert readings ------------------------- */

test("a draft mounts the strip inline, with the model as a label and an empty ring", () => {
	const html = renderStrip({ frontend: DRAFT, draft: true });

	// The QA/E2E hook and the row's identity: one node, in the row, told it is a
	// draft rather than inferring it.
	assert.match(html, /data-lo-session-strip="true"/);
	assert.match(html, /data-lo-session-strip-draft="true"/);

	// Inline above 750px of column and first-on-its-own-line below it, with the
	// one live auto margin the cluster owns at the wide end.
	const root = stripRootClasses(html);
	assert.ok(root.includes("flex-wrap"), "the cluster must wrap internally");
	assert.ok(root.includes("min-w-0"), "the cluster must be allowed to shrink");
	assert.ok(root.includes("order-first"));
	assert.ok(root.includes("basis-full"));
	assert.ok(root.includes("@min-[750px]/chatcol:ml-auto"));
	assert.ok(
		!root.includes("ml-auto"),
		"the cluster must not carry an unconditional auto margin: below 750 the right-hand group owns it",
	);
	assert.ok(root.includes("@min-[750px]/chatcol:order-none"));
	assert.ok(root.includes("@min-[750px]/chatcol:basis-auto"));

	// The model is a LABEL: a real button with `aria-disabled`, focusable so the
	// tooltip stays reachable, no hover step that would advertise an action.
	const model = readingClasses(html, "Model:");
	assert.ok(
		/<button type="button" aria-disabled="true" aria-label="Model:/.test(html),
		"the draft's model reading must render as the label form, not as a control",
	);
	assert.ok(model.classes.includes("cursor-default"));
	assert.ok(!model.classes.includes("cursor-pointer"));
	assert.ok(
		!model.classes.includes("hover:bg-accent-wash"),
		"an inert reading must not light up under the pointer",
	);
	assert.match(model.label, /The first message will use it\./);
	assert.doesNotMatch(model.label, /Choose a different model/);

	// Effort is shown because the spec carries a ladder, in the same inert form.
	const effort = readingClasses(html, "Reasoning effort:");
	assert.match(
		effort.label,
		/^Reasoning effort: high\. Set once the conversation starts\.$/,
	);

	// Context: an empty ring, and a sentence rather than a number. A percentage,
	// a token count or a `$` here would all be claims about a session that does
	// not exist.
	const context = readingClasses(html, "Context:");
	assert.match(context.label, /^Context: nothing measured yet\./);
	assert.doesNotMatch(html, /\d+(\.\d+)?%/);
	assert.doesNotMatch(html, /\$/);
	assert.match(html, /<svg/);

	// And the draft is labelled as one: the sentences live in the tooltips and the
	// `aria-label`s, which is where a static render carries them (Radix mounts a
	// tooltip's content only when it opens, deliberately — see `Tooltip`).
	assert.match(
		html,
		/aria-label="Reasoning effort: high\. Set once the conversation starts\."/,
	);
});

test("a draft without a resolved model renders nothing, never a row of dashes", () => {
	const html = renderStrip({
		frontend: { ...DRAFT, effective_model: null, context_window: null },
		draft: true,
	});
	assert.equal(html, "");
});

/* ---- 2. D3: an inert reading never advertises a control ---------------- */

test("an inert reading states its reason instead of naming a control it cannot open", () => {
	// The other way to have nothing to open: a live session on a backend whose
	// command surface is off (`onCommand === undefined`). The line used to be the
	// same constant in both states — "Click to choose a different model" — which
	// is the D3 defect, and the context reading had the same shape ("Click for
	// the full breakdown").
	const inert = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 12_977,
			context_is_estimate: false,
			cumulative_parent_cost: 2.1,
			cost_knowledge: "floor",
		},
	});
	assert.doesNotMatch(inert, /choose a different model/i);
	assert.doesNotMatch(inert, /open the context breakdown/i);
	assert.doesNotMatch(inert, /for the full breakdown/i);
	assert.match(inert, /Slash commands are off on this server/);
	// The readings themselves are unaffected: this is a copy defect, not a
	// rendering one.
	assert.match(
		inert,
		/aria-label="Reasoning effort: high\. Slash commands are off/,
	);
	assert.match(text(inert), /3\.2%\/400k/);
});

test("a session with a dispatcher keeps the copy that names its controls", () => {
	// The other half of the fix: the actionable state must NOT have been
	// weakened while the inert one was corrected.
	const live = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 12_977,
			context_is_estimate: false,
			cumulative_parent_cost: 2.1,
			cost_knowledge: "floor",
		},
		onCommand: () => undefined,
	});
	assert.match(live, /Click to choose a different model/);
	assert.match(live, /Change it\./);
	assert.match(live, /for the full breakdown/);
	assert.doesNotMatch(live, /Slash commands are off/);
});

/* ---- 3. the 220px column contract -------------------------------------- */

test("below 750px the value readings neither truncate nor collapse, and only the name does", () => {
	const html = renderStrip({
		frontend: {
			...DRAFT,
			effective_model: {
				...GPT_5,
				display_name: "",
				model_id: "moonshotai/kimi-k2-instruct-0905-preview-long-context",
			},
			context_tokens: 352_000,
			context_is_estimate: true,
			cumulative_parent_cost: 4.02,
			cost_knowledge: "floor",
		},
		onCommand: () => undefined,
	});

	// Exactly ONE truncation in the whole cluster. `≥$0.0…` or `52.5%/40…` would
	// be false or unverifiable (§ 8), and the wheel's arc is a second channel for
	// a number the tooltip states in full.
	assert.equal(
		html.match(/truncate/g)?.length ?? 0,
		1,
		"only the model NAME may truncate",
	);

	// The name keeps its floor, so a truncated name still names something.
	const model = readingClasses(html, "Model:");
	assert.ok(model.classes.includes("min-w-14"));
	assert.ok(model.classes.includes("shrink"));
	assert.ok(model.classes.includes("max-w-full"));

	// The three value readings are whole, with their marks and denominators.
	const shown = text(html);
	assert.match(shown, /88\.0%\/400k/);
	assert.match(shown, /estimate/);
	assert.match(shown, /≥\$4\.02/);
});

/* ---- 4. the composer row ------------------------------------------------- */

test("the readings are inside the composer's button row, and the row has one live auto margin", () => {
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);

	// ONE node, ONE place, for every state.
	assert.equal(
		composer.match(/<SessionStatusStrip/g)?.length,
		1,
		"the strip must render once; a second render is a second layout to keep in step",
	);
	// The row is the container, and `justify-between` is gone: with three children
	// it centres the middle one, which is the opposite of right-justified.
	assert.match(
		composer,
		/<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">/,
	);
	// The counterpart auto margin: live below 750px, handed over above it, so
	// exactly one is live at any width.
	assert.match(
		composer,
		/<div className="ml-auto flex items-center gap-1 @min-\[750px\]\/chatcol:ml-0">/,
	);

	// Placement: inside the row, after the working-directory chip and before the
	// microphone/send group.
	const stripAt = composer.indexOf("<SessionStatusStrip");
	const chipAt = composer.indexOf("<DirectoryIndicator");
	const controlsAt = composer.indexOf("Right side: microphone, send or stop");
	assert.ok(chipAt > 0 && controlsAt > 0);
	assert.ok(
		chipAt < stripAt && stripAt < controlsAt,
		"the strip must sit between the directory chip and the microphone/send group",
	);

	// The row wraps its ERROR BOUNDARY too: a crash in the readings must not take
	// the composer down, and a null fallback must not disturb the row's layout.
	assert.match(
		composer,
		/<ErrorBoundary fallback=\{null\}>\s*<SessionStatusStrip/,
	);
});

// The draft's payload reaches the STRIP and nothing else. Asserted on the
// source because `SessionPanel` cannot be rendered in isolation (it needs the
// router, the canonical stream and the store), and the claim is structural:
// every read of the preview's payload is the strip's prop, so it cannot have
// been written into the canonical sessions store, whose rows are sessions.
test("the preview payload never enters the canonical store", () => {
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const reads = [...page.matchAll(/preview\.data/g)];
	assert.ok(reads.length > 0, "the preview payload is not read at all");
	for (const read of reads) {
		const rest = page.slice(read.index + "preview.data".length);
		assert.ok(
			rest.startsWith(".frontend.snapshot,") || /^\s*\n\s*\?/.test(rest),
			`the preview payload is used as \`preview.data${rest.slice(0, 24)}\`; it belongs to the strip only`,
		);
	}
	// And nothing hands it to a store action: the canonical store's rows are
	// sessions, and a preview has no session behind it.
	assert.doesNotMatch(page, /useCanonicalSessionsStore[\s\S]{0,240}preview/);
	// Told it is a draft, so the copy can say why nothing opens (R22).
	assert.match(page, /draft: true,/);
});

/* ---- 5. the control contract -------------------------------------------- */

test("sessions.preview routes to its own POST, with create's body and a closed schema", () => {
	assert.deepEqual(
		desktopEndpoint({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "/tmp/example",
			target: { kind: "agent", name: "reviewer" },
		}),
		{
			path: "/v1/desktop/sessions/preview",
			method: "POST",
			body: {
				request_id: UUID,
				cwd: "/tmp/example",
				target: { kind: "agent", name: "reviewer" },
			},
		},
	);
	// No target is legal: a plain new chat is bound to nothing.
	assert.deepEqual(
		desktopEndpoint({ op: "sessions.preview", requestId: UUID, cwd: "/tmp" })
			.body,
		{ request_id: UUID, cwd: "/tmp" },
	);

	const ok = desktopRequestSchema.safeParse({
		op: "sessions.preview",
		requestId: UUID,
		cwd: "/tmp",
	});
	assert.equal(ok.success, true);
	// A draft with no settled directory has nothing to preview, and the backend
	// requires 1..4096 characters: the schema refuses rather than sending.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "",
		}).success,
		false,
	);
	// The receipt key is not optional: an unkeyed request is not a request this
	// vocabulary can describe.
	assert.equal(
		desktopRequestSchema.safeParse({ op: "sessions.preview", cwd: "/tmp" })
			.success,
		false,
	);
	// Closed: the renderer selects an operation, it never smuggles a field.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "/tmp",
			sessionId: "aaaaaaaaaaaa",
		}).success,
		false,
	);
});
