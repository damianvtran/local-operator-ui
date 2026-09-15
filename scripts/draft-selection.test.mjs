import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { build, transform } from "esbuild";

const ROOT = process.cwd();

/*
 * A NEW conversation's model and effort pick: what it resolves through, what it
 * records, and what it sends.
 *
 * `composer-readings.test.mjs` pins what the draft's chips RENDER (inert where
 * the backend cannot select, controls where it can, and the copy each state
 * gets). This file pins the other half, which no markup can show: that a pick is
 * resolved by the backend before it is recorded, that the resolution the strip
 * shows is the CHOSEN model's, and that the first turn is created on it — while a
 * pane nobody picked on sends the request body it always sent.
 *
 * Why the store rather than the strip: the selection's whole journey is draft
 * state -> `sessions.preview` -> `sessions.create`, and only the store performs
 * the second and third legs. The transport is stubbed at `window.api.desktop`,
 * which is the real IPC seam the renderer uses in Electron; the requests it
 * records are then projected through the SHIPPED `desktopEndpoint`, so what is
 * asserted about the wire is the app's own projection rather than a fixture's
 * idea of it.
 *
 * The byte-identity claim in requirement 6 is asserted literally: the body of a
 * create from a pane that never picked is deep-equal to the body this app sent
 * before the draft's chips could open, and it carries no `model` key at all —
 * absent, never null.
 */

/** One recorded desktop request, with the wire request it projects to. */
const calls = [];
let reply = () => ({ result: null });
globalThis.window = {
	api: {
		desktop: {
			request: async (request) => {
				calls.push(request);
				return { status: 200, body: reply(request) };
			},
		},
	},
};
// `persist` reads the default storage at store creation; Node has no
// localStorage, and zustand warns without one. An in-memory stub keeps the
// import quiet without changing what the store does with it.
const persisted = new Map();
globalThis.localStorage = {
	getItem: (key) => persisted.get(key) ?? null,
	setItem: (key, value) => persisted.set(key, value),
	removeItem: (key) => persisted.delete(key),
};

const bundle = await build({
	stdin: {
		contents: `
			export {
				NO_DRAFT_TARGET,
				draftPreviewKey,
				draftPreviewQuery,
				effortCarry,
				fetchDraftPreview,
				selectionFromModel,
				selectionSelector,
			} from "./src/renderer/src/features/chat/draft-selection";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
			export {
				bandReadings,
				effortLadder,
				effortLevel,
				effortState,
				modelSelector,
				specUnresolved,
			} from "./src/renderer/src/features/chat/session-status/session-model";
			export { errorText } from "./src/renderer/src/features/chat/pickers/use-picker-backend";
			export {
				admitChatDraft,
				useCanonicalSessionsStore,
			} from "./src/renderer/src/shared/store/canonical-sessions-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
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

const bundlePath = new URL("./_draft-selection.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	NO_DRAFT_TARGET,
	admitChatDraft,
	bandReadings,
	desktopEndpoint,
	desktopRequestSchema,
	draftPreviewKey,
	draftPreviewQuery,
	effortCarry,
	effortLadder,
	effortLevel,
	effortState,
	errorText,
	fetchDraftPreview,
	modelSelector,
	selectionFromModel,
	selectionSelector,
	specUnresolved,
	useCanonicalSessionsStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

const CWD = "/tmp/example";
const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** The pick a chip records: a catalogue row's provider/model and no rung. */
const PICKED = {
	provider: "openrouter",
	model_id: "openai/gpt-5-mini",
	reasoning_effort: null,
};
const PICKED_RUNG = { ...PICKED, reasoning_effort: "high" };

/** The canonical state `sessions.preview` answers with, for whatever was asked. */
const frame = (model) => ({
	state_version: 1,
	epoch: "epoch",
	sequence: 0,
	snapshot: {
		session_id: "",
		selected_model: model,
		effective_model: model,
		context_tokens: null,
		context_window: 400_000,
	},
	live_cursor: null,
});

const SPEC = {
	provider: "openrouter",
	model_id: "openai/gpt-5-mini",
	display_name: "OpenAI: GPT-5 Mini",
	reasoning: true,
	reasoning_effort: null,
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	context_window: 400_000,
};

/** Every recorded request, projected to the HTTP call it would make. */
function wire() {
	return calls.map((request) => desktopEndpoint(request));
}

function lastWire() {
	return wire().at(-1);
}

/* ---- the pick is resolved by the backend, for the CHOSEN selection -------- */

test("a pick is resolved through sessions.preview with the chosen model, not the picker's row", async () => {
	calls.length = 0;
	reply = (request) =>
		request.op === "sessions.preview"
			? { result: { frontend: frame(request.model ? SPEC : null) } }
			: { result: null };

	const resolved = await fetchDraftPreview({ cwd: CWD, model: PICKED_RUNG });

	// The request: the preview op, the pane's directory, and the selection.
	assert.deepEqual(lastWire(), {
		path: "/v1/desktop/sessions/preview",
		method: "POST",
		body: {
			request_id: lastWire().body.request_id,
			cwd: CWD,
			model: PICKED_RUNG,
		},
	});
	assert.match(lastWire().body.request_id, /^[0-9a-f-]{36}$/);
	// The answer the pane will read: the backend's own resolution for that model.
	assert.deepEqual(resolved.snapshot.selected_model, SPEC);
});

test("the query key carries the selection, so the pane cannot keep the previous model's readings", () => {
	const base = { cwd: CWD, target: { kind: "agent", name: "reviewer" } };
	const none = draftPreviewKey(base);
	const picked = draftPreviewKey({ ...base, model: PICKED });
	const rung = draftPreviewKey({ ...base, model: PICKED_RUNG });
	assert.notDeepEqual(none, picked);
	assert.notDeepEqual(picked, rung, "a rung is part of what is being asked");
	// The same selection is the same entry: the picker's re-read and the pane's
	// reading must be ONE cache entry, which is what makes them one answer.
	assert.deepEqual(picked, draftPreviewKey({ ...base, model: { ...PICKED } }));
	assert.ok(picked.includes("openrouter/openai/gpt-5-mini"));
	// The empty target differs from a staged one: a draft re-staged onto another
	// agent is a different question.
	assert.notDeepEqual(draftPreviewKey({ cwd: CWD }), none);
});

test("an unpicked draft asks with no model field at all", () => {
	assert.deepEqual(
		desktopEndpoint({
			op: "sessions.preview",
			requestId: UUID,
			cwd: CWD,
		}).body,
		{ request_id: UUID, cwd: CWD },
	);
	assert.deepEqual(draftPreviewKey({ ...NO_DRAFT_TARGET, model: null }), [
		"desktop",
		"session-preview",
		"",
		null,
		null,
		null,
		null,
	]);
});

/* ---- what a selection IS, spelled once ----------------------------------- */

test("a selection is read off the spec, and a blank rung is no rung", () => {
	assert.deepEqual(selectionFromModel(SPEC), {
		provider: "openrouter",
		model_id: "openai/gpt-5-mini",
		reasoning_effort: null,
	});
	assert.deepEqual(selectionFromModel({ ...SPEC, reasoning_effort: " low " }), {
		provider: "openrouter",
		model_id: "openai/gpt-5-mini",
		reasoning_effort: "low",
	});
	// The word `auto` is the picker's vocabulary for a state, not a rung: the wire
	// says `null` and the backend resolves the model's own default.
	assert.equal(
		selectionFromModel({ ...SPEC, reasoning_effort: "" })?.reasoning_effort,
		null,
	);
	// Two empty halves name nothing rather than interpolating `/`.
	assert.equal(selectionFromModel({ provider: "", model_id: "x" }), null);
	assert.equal(selectionSelector(PICKED), "openrouter/openai/gpt-5-mini");
	assert.equal(selectionSelector(null), null);
	// A ladder is what the wire carried, and nothing is invented for it.
	assert.deepEqual(effortLadder(SPEC), ["minimal", "low", "medium", "high"]);
	assert.deepEqual(effortLadder({ ...SPEC, reasoning_efforts: [] }), []);
	assert.deepEqual(effortLadder(null), []);
});

/* ---- the first turn is created on the selection --------------------------- */

test("the first turn is created on the picked model, and an unpicked pane sends the same body as always", async () => {
	const store = useCanonicalSessionsStore.getState();

	// PICKED: the pane's chips were used.
	calls.length = 0;
	reply = (request) =>
		request.op === "sessions.create"
			? { result: { session_id: "abcdef123456", binding: { kind: "none" } } }
			: { result: {} };
	const pickedKey = store.stageDraft();
	store.setDraftModel(pickedKey, PICKED);
	const pickedId = await admitChatDraft(pickedKey, {
		text: "hello",
		attachments: [],
		images: [],
		mode: "prompt",
		cwd: CWD,
	});
	assert.equal(pickedId, "abcdef123456");
	const create = wire().find((call) => call.path === "/v1/desktop/sessions");
	assert.deepEqual(create?.body.model, PICKED);
	// And the message itself is addressed to the session that create returned.
	assert.ok(
		wire().some(
			(call) => call.path === `/v1/desktop/sessions/${pickedId}/messages`,
		),
	);

	// NEVER PICKED: the body is the one this app sent before a chip could open.
	calls.length = 0;
	const plainKey = store.stageDraft();
	const plainId = await admitChatDraft(plainKey, {
		text: "hello",
		attachments: [],
		images: [],
		mode: "prompt",
		cwd: CWD,
	});
	assert.equal(plainId, "abcdef123456");
	const plainCreate = wire().find(
		(call) => call.path === "/v1/desktop/sessions",
	);
	assert.deepEqual(plainCreate?.body, {
		request_id: plainCreate.body.request_id,
		cwd: CWD,
	});
	assert.ok(
		!("model" in plainCreate.body),
		"an unpicked draft must omit `model` rather than send null",
	);
});

test("a changed create body gets a fresh at-most-once key, and only before a session exists", () => {
	const store = useCanonicalSessionsStore.getState();
	const key = store.stageDraft();
	const before = useCanonicalSessionsStore.getState().drafts[key];

	store.setDraftModel(key, PICKED);
	const after = useCanonicalSessionsStore.getState().drafts[key];
	assert.deepEqual(after.model, PICKED);
	// The create body changed, so re-sending the old request id would be a 409
	// from a receipt that hashes the whole body: a changed pick is a new intent.
	assert.notEqual(after.createRequestId, before.createRequestId);
	// The admission id addresses the message, not the model: it must not move.
	assert.equal(after.admissionRequestId, before.admissionRequestId);

	// Once a session exists the create is behind us, and its id stays pinned so a
	// replay of that request remains an idempotent replay.
	store.updateDraft(key, { sessionId: "abcdef123456" });
	const pinned =
		useCanonicalSessionsStore.getState().drafts[key].createRequestId;
	store.setDraftModel(key, PICKED_RUNG);
	assert.deepEqual(
		useCanonicalSessionsStore.getState().drafts[key].model,
		PICKED_RUNG,
	);
	assert.equal(
		useCanonicalSessionsStore.getState().drafts[key].createRequestId,
		pinned,
	);
});

test("a pick on a discarded pane records nothing, and never resurrects the row", () => {
	const store = useCanonicalSessionsStore.getState();
	const gone = "draft:00000000-0000-4000-8000-000000000000";
	assert.equal(useCanonicalSessionsStore.getState().drafts[gone], undefined);
	store.setDraftModel(gone, PICKED);
	assert.equal(useCanonicalSessionsStore.getState().drafts[gone], undefined);
});

/* ---- the pickers' draft branch ------------------------------------------- */

test("each picker routes a draft's pick through one resolver, and never through a session command", () => {
	/*
	 * Asserted on the source, and the reason is the instrument's limit rather than
	 * a preference: the interaction this pins needs a DOM, and this repo ships no
	 * DOM test environment (the read-only render checks use `renderToStaticMarkup`,
	 * which cannot click). What the source CAN prove is the shape the defects would
	 * have to change first: one resolver for both readings, the store written only
	 * after the backend answered, the rung cleared on a model pick and kept on an
	 * effort pick, no session command anywhere in draft mode, and no default-writing
	 * control on a draft at all.
	 */
	const picker = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
		),
		"utf8",
	);

	// One resolver, mounted by both pickers.
	assert.equal([...picker.matchAll(/useDraftPick\(draft, note\)/g)].length, 2);
	// Resolved by the backend BEFORE it is recorded: the strip must never paint a
	// choice the backend refused, and the readings must be the resolved ones.
	const resolve = picker.slice(
		picker.indexOf("const pick = useCallback"),
		picker.indexOf("return { pick, busy, result, selection, target, refuse }"),
	);
	assert.ok(resolve.indexOf("await queryClient.fetchQuery") > 0);
	assert.ok(
		resolve.indexOf("await queryClient.fetchQuery") <
			resolve.indexOf("draft.select(chosen)"),
		"the selection is recorded only after the preview answered",
	);
	assert.match(resolve, /refused: /);
	/*
	 * Review round 1, R2 and R6.
	 *
	 * R2: a confirmed pick has to be REMEMBERED, because `draft.target` is the
	 * snapshot the dialog opened on and the pane's own value moves underneath it -
	 * without this the header and the #x2713 keep naming the pre-pick model while the
	 * strip and the result strip show the pick, which is the self-contradiction the
	 * session's picker fixed for its lagging owner frame (QA Q2). The remembered
	 * selection is also what the dialog's own preview is keyed on, so the ladder an
	 * effort pick offers is the current model's.
	 */
	assert.match(resolve, /setPicked\(chosen\)/);
	assert.match(
		picker,
		/draftPreviewQuery\(draftPick\.target \?\? NO_DRAFT_TARGET\)/,
		"both dialogs resolve for the selection in force, not the prop they opened on",
	);
	/*
	 * R6: an effort rung with no model behind it is refused OUT LOUD. `pick` takes a
	 * null selection and says so ("This pane has not resolved a model to change") rather
	 * than the click doing nothing, and the effort caller passes null explicitly
	 * instead of an early `return`.
	 */
	assert.match(resolve, /if \(!next\)/);
	assert.match(resolve, /has not resolved a model to change/);
	assert.doesNotMatch(
		picker,
		/draft\.target\.model \?\? selectionFromModel\(model\)/,
		"the effort pick reads the remembered selection, not the prop",
	);

	/*
	 * A model pick no longer SILENTLY discards the effort rung the user chose
	 * (UX U1, design D7 - the same defect from the copy side).
	 *
	 * The candidate still starts with no rung, because that is the wire's only
	 * spelling of "the new model's own default", and the previous model's rung is
	 * still not a level the new model agreed to. What changed is that the pick
	 * asks whether it IS offered before recording it: the candidate is replaced by
	 * the carried selection only where the new model's own resolved ladder
	 * contains the level, and BOTH branches name in the confirmation which level
	 * the conversation will actually run - `Its effort is now <level>`, which
	 * claims no direction (design round 5, D21).
	 */
	assert.match(picker, /model_id: modelId,\s*reasoning_effort: null/);
	/*
	 * Review round 5, M1. The QUESTION is the dialog's LIVE selection -
	 * `draftPick.selection`, which the hook advances on every pick - and not
	 * `draft.target.model`, the snapshot the dialog opened on and never moves.
	 * Read from the snapshot, a second pick in the SAME open dialog carried a rung
	 * the first pick had already dropped. This assertion previously pinned the
	 * snapshot in its old form, which is why the defect survived it; the
	 * behavioural half is the M1 test in section 7, driven through the shipped
	 * hook.
	 */
	assert.match(
		picker,
		/const carried = carriedRung\(draftPick\.selection\);/,
		"the rung question is read from the pane's own live pick, not a frozen prop",
	);
	assert.match(resolve, /effortCarry\(reading\.carry, \{/);
	assert.match(resolve, /ladder: effortLadder\(offered\)/);
	/*
	 * The level the clearing sentence names is the NEW model's resolved one, read
	 * off the same resolution through `effortLevel` - the two fields that carry a
	 * LEVEL - so a category word (`auto`, `reasoning`, `unknown`) can never land in
	 * a level slot; and `null` when the resolution reports none, which is the
	 * non-reasoning target QA round 4 (Q-R4-1) filed. What cannot be read at all
	 * is `checked: false` - the ladder's shape, not just its presence, since
	 * review round 5's F4 (`specUnresolved` beside it) - and the PICK is refused
	 * rather than recording a rung-less selection (review round 4, F1), driven end
	 * to end in the tests at the bottom of this file, not pinned as source text.
	 */
	assert.match(resolve, /level: effortLevel\(offered\)/);
	assert.match(resolve, /if \(!decision\.checked\)/);
	// Candidate behaviour is exercised below through the actual hook/adapter.
	// A regex here previously required the very null branch that broke effort-first
	// picks on a resolved default, while every source assertion stayed green (R7).

	// Draft mode never reaches the session command path.
	assert.doesNotMatch(
		picker,
		/if \(draft\) \{[\s\S]{0,200}command\.run/,
		"a draft has no owner to command: the pick must not call sessions.command",
	);
	// The machine's default is not this control's to change, so a draft has no
	// checkbox to change it with.
	assert.match(picker, /\{!draft && \(/);
	assert.match(picker, /This pick also sets the default for new sessions/);
});

/* ---- 3b. a model pick may not silently discard the chosen effort rung ------ */

/*
 * UX U1, and design D7 read from the other side: the same defect, one a flow
 * finding and one a copy finding.
 *
 * The wire cannot say "keep the previous rung" - `null` means "the new model's
 * own default" - so a pick that always sent it discarded an explicit choice in
 * silence, and every signal on screen said the pick had succeeded. These are the
 * three outcomes `effortCarry` decides from the NEW model's own resolved ladder,
 * and each one is asserted on the sentence the confirmation prints, because a
 * clearing that is not stated is the defect rather than the rule.
 */
test("a model that offers the chosen rung carries it, and the confirmation says so", () => {
	const carry = effortCarry("high", {
		ladder: ["low", "medium", "high", "xhigh", "max"],
		ladderKnown: true,
		level: "low",
	});
	assert.equal(carry.checked, true);
	assert.equal(carry.rung, "high");
	assert.equal(
		carry.confirmation("openrouter/openai/gpt-6-astra"),
		"This conversation will run openrouter/openai/gpt-6-astra at high effort.",
	);
});

test("a model that does not offer it clears the rung AND names the level that will run", () => {
	const carry = effortCarry("high", {
		ladder: ["low", "medium"],
		ladderKnown: true,
		level: "low",
	});
	assert.equal(carry.checked, true);
	assert.equal(carry.rung, null);
	const sentence = carry.confirmation("openrouter/meta/llama-4");
	assert.match(sentence, /This conversation will run openrouter\/meta\/llama-4\./);
	/*
	 * Design round 5 (D21): the sentence names the level in force and claims no
	 * DIRECTION, which the copy cannot know - a `low` carried onto a model whose
	 * no-rung level is `high` printed "falls to high".
	 */
	assert.match(
		sentence,
		/Its effort is now low/,
		"the level that will actually run",
	);
	assert.match(sentence, /high is not one of that model's levels/, "the level dropped");
});

test("a pane that never chose a rung is unchanged, and claims no level", () => {
	const carry = effortCarry("", { ladder: ["low", "medium"], ladderKnown: true, level: "low" });
	assert.equal(carry.checked, true);
	assert.equal(carry.rung, null);
	assert.equal(
		carry.confirmation("openrouter/openai/gpt-5"),
		"This conversation will run openrouter/openai/gpt-5.",
	);
});

test("a target that reports no level says so, rather than naming one it does not have", () => {
	/*
	 * QA round 4, Q-R4-1: the degradation used to print "its own default", which
	 * asserts a level on a target that reports none - a non-reasoning model, where
	 * the pane shows no effort reading at all. Saying that no level is set is the
	 * honest form, and it is still a clearing that is STATED.
	 */
	const carry = effortCarry("xhigh", { ladder: ["low"], ladderKnown: true, level: null });
	assert.equal(carry.rung, null);
	assert.match(
		carry.confirmation("openrouter/openai/gpt-5"),
		/No effort level is set on it, because xhigh is not one of that model's levels/,
	);
});

test("a ladder that was never reported is a check that could not be made, not an empty ladder", () => {
	/*
	 * Review round 4, F4. `!ladder.includes(...)` is also true when the resolution
	 * reported no ladder at all, and the old branch then asserted "belongs to the
	 * other model's ladder" about a model whose ladder nobody had read (the class
	 * UX round 3's U12 named). `checked: false` is what makes the caller refuse
	 * instead of recording a rung-less selection under a claim it cannot support.
	 */
	const carry = effortCarry("high", { ladder: [], ladderKnown: false, level: "low" });
	assert.equal(carry.checked, false);
	assert.equal(carry.rung, null);
	/*
	 * Design round 5 (D19): the refusal carries its OWN sentence - what happened,
	 * what it means, and the act - and it is `refusal` rather than a
	 * `confirmation` the caller could never print. It names no model, because the
	 * resolution that would produce one is the step this refusal replaces.
	 */
	assert.match(
		carry.refusal,
		/^Nothing was changed, because that model's effort levels could not be read\. Try again\.$/,
	);
});

test("the comparison is case-insensitive and padded, and the ladder's own spelling is recorded", () => {
	// QA round 4, Q-R4-2: the trim used to live at the call site and the compare was
	// exact, so a padded or differently-cased rung silently stopped carrying. The
	// helper owns both now, and it records the string the wire will be asked about
	// again - the ladder's - rather than the caller's.
	const carry = effortCarry("  High ", {
		ladder: ["low", "medium", "high"],
		ladderKnown: true,
		level: "low",
	});
	assert.equal(carry.rung, "high");
	assert.equal(carry.checked, true);
});

test("the affordance is gated on all three capabilities the pickers depend on", () => {
	/*
	 * Review round 1, R3: the gate was pinned by nothing, so a regression that
	 * dropped a conjunct would ship silently - and it is a conjunction of three for
	 * a reason, each one a real dependency (see the block in `chat-page.tsx`): the
	 * capability itself (`sessions.create`/`preview` accepting a `model`), the
	 * command surface every live pane beside it carries, and the catalogue the
	 * picker's rows come from. The second assertion is the one that makes the gate
	 * load-bearing rather than decorative: the picker context is handed out only
	 * where it holds.
	 */
	const page = readFileSync(
		join(ROOT, "src/renderer/src/features/chat/components/chat-page.tsx"),
		"utf8",
	);
	const gate = page.slice(page.indexOf("const draftPickable ="));
	const conjunction = gate.slice(0, gate.indexOf(";"));
	for (const flag of ["draft_selection", "commands", "catalogues"])
		assert.ok(
			conjunction.includes(
				`desktopFeatureEnabled(capabilities.data, "${flag}")`,
			),
			`the gate must require ${flag}`,
		);
	assert.equal(
		[...conjunction.matchAll(/desktopFeatureEnabled\(/g)].length,
		3,
		"all three conjuncts and nothing else: a fourth capability folded in here would be a different decision",
	);
	assert.match(
		page,
		/draftPicker:\s*draftPickable && draftIdentity && preview\.data/,
		"and no picker is handed a target the gate refused",
	);
});

test("create and preview accept the same selection shape, and refuse anything else", () => {
	for (const op of ["sessions.create", "sessions.preview"]) {
		const ok = desktopRequestSchema.safeParse({
			op,
			requestId: UUID,
			cwd: CWD,
			model: PICKED_RUNG,
		});
		assert.equal(ok.success, true, `${op} must accept a selection`);
		// A null rung is legal — that is what "no rung chosen" IS on this wire.
		assert.equal(
			desktopRequestSchema.safeParse({
				op,
				requestId: UUID,
				cwd: CWD,
				model: PICKED,
			}).success,
			true,
		);
		// Omitted stays legal too: the capability is strictly additive.
		assert.equal(
			desktopRequestSchema.safeParse({ op, requestId: UUID, cwd: CWD }).success,
			true,
		);
		// Closed and typed: a bare string, a missing half or a smuggled field is not
		// a request this vocabulary can describe.
		for (const model of [
			"openrouter/openai/gpt-5",
			{ provider: "openrouter" },
			{ provider: "", model_id: "x", reasoning_effort: null },
			{ ...PICKED, reasoning_effort: undefined },
			{ ...PICKED, temperature: 0.5 },
		]) {
			assert.equal(
				desktopRequestSchema.safeParse({
					op,
					requestId: UUID,
					cwd: CWD,
					model,
				}).success,
				false,
				`${op} must refuse ${JSON.stringify(model)}`,
			);
		}
	}
});

/* ---- execute the shipped hook and effort adapter, not a source regex ----- */

/*
 * The old wiring assertions passed while an offered effort-first pick made no
 * request at all (R7). Transpile the actual hook/adapter bodies and invoke the
 * PickerHost callback they return, including another render after each receipt.
 *
 * This follows attachment-url.test.mjs's bounded hook-runtime pattern: the repo
 * has no DOM/test-renderer dependency. Only React state/query seams and the host
 * boundary are substituted; selection, precedence, options, refusal and receipt
 * control flow are the shipped code. Explicit renders preserve hook state, but
 * do NOT prove React scheduling, pointer events, browser focus or visible paint.
 * Those remain the blocked browser-tool acceptance matrix, not these tests.
 */
const pickerSource = readFileSync(
	join(ROOT, "src/renderer/src/features/chat/pickers/destination-pickers.tsx"),
	"utf8",
);
/*
 * From the helper the hook calls, not from the hook itself: `pick` resolves the
 * selector a confirmation names through the SAME function `ModelPicker` uses, so
 * a span that started at `useDraftPick` would leave it undefined and every carry
 * test would fail for a reason that has nothing to do with the carry.
 */
const hookStart = pickerSource.indexOf("function selectorOfResolution(");
const hookEnd = pickerSource.indexOf("export const ModelPicker:");
const effortStart = pickerSource.indexOf("export const EffortPicker:");
const effortEnd = pickerSource.indexOf("export const ThemePicker:");
assert.ok(hookStart >= 0 && hookEnd > hookStart);
assert.ok(effortStart >= 0 && effortEnd > effortStart);
const pickerCode = await transform(
	`${pickerSource.slice(hookStart, hookEnd)}\n${pickerSource.slice(effortStart, effortEnd)}\nexport { carriedRung, useDraftPick };`,
	{ loader: "tsx", jsx: "automatic", format: "cjs" },
);
let activePicker;
const pickerDependencies = {
	NO_DRAFT_TARGET,
	draftPreviewQuery,
	selectionFromModel,
	selectionSelector,
	bandReadings,
	effortCarry,
	effortLadder,
	effortLevel,
	effortState,
	modelSelector,
	specUnresolved,
	errorText,
	PickerHost: () => null,
	useEntities: () => ({}),
	useSessionCommand: () => ({
		run: () => assert.fail("a draft must not issue a session command"),
	}),
	useQueryClient: () => activePicker.client,
	useCallback: (callback) => callback,
	useMemo: (compute) => compute(),
	useState: (initial) => {
		const instance = activePicker;
		const index = instance.index++;
		if (!(index in instance.states))
			instance.states[index] =
				typeof initial === "function" ? initial() : initial;
		return [
			instance.states[index],
			(value) => {
				instance.states[index] =
					typeof value === "function" ? value(instance.states[index]) : value;
			},
		];
	},
	useQuery: (query) => {
		activePicker.lastPreviewKey = query.queryKey;
		return {
			data: activePicker.preview(query.queryKey),
			isLoading: false,
			isError: false,
		};
	},
};
const pickerModule = { exports: {} };
new Function(
	"require",
	"module",
	...Object.keys(pickerDependencies),
	pickerCode.code,
)(
	createRequire(import.meta.url),
	pickerModule,
	...Object.values(pickerDependencies),
);
const { EffortPicker: ExecutedEffortPicker, carriedRung, useDraftPick: executedDraftPick } =
	pickerModule.exports;

function pickerHarness({ initial = null, resolved = frame(SPEC) } = {}) {
	const instance = {
		states: [],
		index: 0,
		requests: [],
		selections: [],
		notes: [],
		reject: false,
		lastPreviewKey: null,
		/**
		 * The rungs a NAMED model's resolution reports, by selector. Empty means
		 * "answer with the SPEC's own ladder", which is what every test that does not
		 * care about the carrying question wants.
		 */
		ladders: {},
		/**
		 * How many leading resolutions to fail before answering. This is how a
		 * transient probe failure is reproduced: the probe fails, the pick's own
		 * resolution (a SECOND call, on the same or another key) would succeed.
		 */
		failing: 0,
		preview: (key) => {
			if (!key[5]) return resolved;
			const slash = key[5].indexOf("/");
			const model = {
				...SPEC,
				provider: key[5].slice(0, slash),
				model_id: key[5].slice(slash + 1),
				/*
				 * The backend's own cold resolution, which is what a real
				 * `sessions.preview` answers for a rung-less request: it names the
				 * level the model will actually run (`low` here, matching QA round 4's
				 * live rows), rather than echoing a null the pane would read as `auto`.
				 * A stub that echoed the request would make the clearing sentence name
				 * a level the pane does not show.
				 */
				reasoning_effort: key[6] ?? "low",
			};
			const rungs = instance.ladders[key[5]];
			if (rungs === "unreported")
				return frame({
					...model,
					reasoning_efforts: undefined,
					reasoning_default_effort: undefined,
				});
			/*
			 * The COLD shape `specUnresolved` exists for: every metadata field PRESENT
			 * and empty - an empty NAME beside an empty ladder - which `Array.isArray`
			 * alone reads as a known empty ladder (review round 5, F4's residual slot).
			 */
			if (rungs === "cold")
				return frame({
					...model,
					display_name: "",
					reasoning: false,
					reasoning_effort: undefined,
					reasoning_default_effort: undefined,
					reasoning_efforts: [],
				});
			if (!Array.isArray(rungs)) return frame(model);
			return frame({
				...model,
				reasoning_efforts: rungs,
				reasoning_default_effort: "low",
			});
		},
	};
	instance.client = {
		fetchQuery: async (query) => {
			instance.requests.push(query.queryKey);
			instance.lastPreviewKey = query.queryKey;
			if (instance.reject) throw new Error("The candidate was refused.");
			if (instance.failing > 0) {
				instance.failing -= 1;
				throw new Error("The resolution could not be reached.");
			}
			return instance.preview(query.queryKey);
		},
	};
	instance.draft = {
		target: { cwd: CWD, model: initial },
		select: (selection) => instance.selections.push(selection),
	};
	const note = (...args) => instance.notes.push(args);
	const run = (callback) => {
		activePicker = instance;
		instance.index = 0;
		return callback();
	};
	instance.hook = () => run(() => executedDraftPick(instance.draft, note));
	instance.render = () =>
		run(
			() =>
				ExecutedEffortPicker({
					sessionId: "",
					canonical: {},
					onClose: () => {},
					draft: instance.draft,
					note,
				}).props,
		);
	instance.pick = async (value) => {
		instance.render().onPick(value);
		await new Promise(setImmediate);
		return instance.render();
	};
	return instance;
}

test("effort first on an unpicked resolved draft previews and records its default model", async () => {
	const picker = pickerHarness();
	assert.deepEqual(
		picker.render().options.map((row) => row.value),
		SPEC.reasoning_efforts,
	);
	const settled = await picker.pick("high");
	assert.equal(picker.requests.length, 1);
	assert.deepEqual(picker.selections, [PICKED_RUNG]);
	assert.equal(settled.result.tone, "success");
	assert.equal(settled.busy, false);
	assert.equal(settled.options.find((row) => row.current)?.value, "high");
	assert.deepEqual(picker.notes, []);
	assert.equal(
		picker.draft.target.model,
		null,
		"the opened-on prop stays frozen",
	);
});

test("model first then effort retains the explicit model while changing only its rung", async () => {
	const selected = {
		provider: "openai",
		model_id: "gpt-5",
		reasoning_effort: "low",
	};
	const picker = pickerHarness({ initial: selected });
	await picker.pick("high");
	assert.deepEqual(picker.selections, [
		{ ...selected, reasoning_effort: "high" },
	]);
	assert.equal(picker.requests.length, 1);
});

test("a remembered successful effort pick survives a later refusal on the same open adapter", async () => {
	const picker = pickerHarness();
	await picker.pick("high");
	const successfulKey = picker.lastPreviewKey;
	picker.reject = true;
	const refused = await picker.pick("low");
	assert.equal(picker.requests.length, 2);
	assert.deepEqual(picker.selections, [PICKED_RUNG]);
	assert.deepEqual(picker.lastPreviewKey, successfulKey);
	assert.equal(refused.options.find((row) => row.current)?.value, "high");
	assert.equal(refused.result.tone, "error");
	assert.match(refused.result.text, /The candidate was refused/);
	assert.deepEqual(picker.notes, [[refused.result.text, true]]);
	assert.equal(refused.busy, false);
});

test("the actual draft hook remembers a successful model candidate across a refused candidate", async () => {
	const picker = pickerHarness();
	const reading = {
		describe: () => "Chosen model.",
		refused: "The model was not changed.",
	};
	await picker.hook().pick(PICKED, reading);
	assert.deepEqual(picker.hook().selection, PICKED);
	picker.reject = true;
	await picker
		.hook()
		.pick(
			{ provider: "openai", model_id: "gpt-5", reasoning_effort: null },
			reading,
		);
	assert.deepEqual(picker.hook().selection, PICKED);
	assert.deepEqual(picker.hook().target.model, PICKED);
	assert.deepEqual(picker.selections, [PICKED]);
	assert.equal(picker.hook().busy, false);
	assert.equal(picker.hook().result.tone, "error");
});

test("effort options, identity and default fallback follow the strip's effective-first spec", async () => {
	const effective = {
		...SPEC,
		provider: "openai",
		model_id: "gpt-5",
		reasoning_efforts: ["low", "high"],
		reasoning_effort: "low",
	};
	const resolved = frame(SPEC);
	resolved.snapshot.effective_model = effective;
	const picker = pickerHarness({ resolved });
	const initial = picker.render();
	assert.deepEqual(
		initial.options.map((row) => row.value),
		["low", "high"],
	);
	assert.match(initial.description, /openai\/gpt-5 supports/);
	assert.equal(initial.options.find((row) => row.current)?.value, "low");
	await picker.pick("high");
	assert.deepEqual(picker.selections, [
		{ provider: "openai", model_id: "gpt-5", reasoning_effort: "high" },
	]);
});

test("a truly unresolved draft offers no rungs and refuses a forced candidate without a preview", async () => {
	const picker = pickerHarness({ resolved: frame(null) });
	assert.deepEqual(picker.render().options, []);
	const refused = await picker.pick("high");
	assert.deepEqual(picker.requests, []);
	assert.deepEqual(picker.selections, []);
	assert.match(refused.result.text, /has not resolved a model to change/);
});

test("a resolved ladderless model stays honestly non-adjustable and makes no request", () => {
	const picker = pickerHarness({
		resolved: frame({ ...SPEC, reasoning: false, reasoning_efforts: [] }),
	});
	const view = picker.render();
	assert.deepEqual(view.options, []);
	assert.match(view.description, /has no adjustable effort/);
	assert.equal(view.emptyText, "Effort is not adjustable on this model.");
	assert.deepEqual(picker.requests, []);
	assert.deepEqual(picker.selections, []);
});

/* ---- 7. the carry, driven through the SHIPPED hook the picker calls ------- */

/*
 * The missing level, named by review round 4: everything above pins `effortCarry`
 * as a pure decision and the call site as source text, and neither drives the
 * path a user's click takes. These tests call the REAL `useDraftPick` — the same
 * function `ModelPicker` calls, extracted from the shipped file and executed
 * against a stubbed transport — with the reading a model pick passes it.
 *
 * They are also where F1 and F2 are pinned, because both are properties of where
 * the check lives rather than of what it decides: the probe has to sit inside the
 * busy window, and a probe that cannot answer has to REFUSE the pick.
 */

const DRAFT_RUNG = {
	provider: "openrouter",
	model_id: "openai/gpt-5",
	reasoning_effort: "high",
};
const NEW_MODEL = {
	provider: "openrouter",
	model_id: "openai/gpt-6-astra",
	reasoning_effort: null,
};
const MODEL_READING = {
	describe: (resolved) =>
		`This conversation will run ${
			selectionSelector(
				resolved.snapshot.selected_model ?? resolved.snapshot.effective_model,
			) ?? "?"
		}.`,
	carry: "high",
	refused: "The model was not changed.",
};

test("a model pick carries the chosen rung through the shipped hook, and says the level", async () => {
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = [
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	];
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, MODEL_READING);
	const settled = picker.hook();
	assert.deepEqual(picker.selections, [{ ...NEW_MODEL, reasoning_effort: "high" }]);
	assert.equal(picker.requests.length, 2, "carrying costs the probe and the pick");
	assert.notDeepEqual(
		picker.requests[0],
		picker.requests[1],
		"the carried selection is a different key, which is why it is a second call",
	);
	assert.equal(settled.busy, false);
	assert.equal(settled.result.tone, "success");
	assert.match(settled.result.text, /at high effort\.$/);
	assert.deepEqual(picker.notes, []);
});

test("a model that does not offer the rung clears it, states the level, and costs one resolution", async () => {
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = ["low", "medium"];
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, MODEL_READING);
	const settled = picker.hook();
	assert.deepEqual(picker.selections, [NEW_MODEL], "no rung is recorded");
	/*
	 * Two CALLS in the stub, one in production: the stub has no cache, so the
	 * property to assert is the one that makes it free - the probe's key IS the
	 * pick's key once no rung is carried, so a real client serves the second from
	 * the entry the first wrote.
	 */
	assert.deepEqual(
		picker.requests[0],
		picker.requests[1],
		"the probe's key is the pick's own key",
	);
	assert.match(settled.result.text, /Its effort is now low/);
	assert.match(settled.result.text, /because high is not one of that model's levels/);
});

test("F1: a probe that cannot answer REFUSES the pick instead of dropping the rung in silence", async () => {
	/*
	 * The defect the round-4 review filed: a caller-side probe's failure left the
	 * decision at its level-free default while the pick went ahead and recorded
	 * `reasoning_effort: null` - U1's original silence, on a narrower path. The
	 * pick's own resolution is a SECOND call and would have succeeded, so
	 * "the pick's refusal path reports it" was never true.
	 */
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = ["low", "medium", "high"];
	picker.failing = 1;
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, MODEL_READING);
	const settled = picker.hook();
	assert.deepEqual(picker.selections, [], "nothing is recorded");
	assert.equal(picker.requests.length, 1, "the pick's own resolution is not attempted");
	assert.equal(settled.result.tone, "error");
	/*
	 * Two refusal paths, and this is the transport's: a probe that THROWS is
	 * refused by the same `catch` every other failure goes through, so the sentence
	 * carries the transport's own words. The other is a resolution that answered
	 * without a ladder, which refuses on `checked` (the tests below) and states its
	 * own sentence - `decision.refusal`, since design round 5 (D19) moved the
	 * refusal out of this reading, where it was a second string that never printed.
	 * Both record NOTHING, which is the finding.
	 */
	assert.match(settled.result.text, /The model was not changed\./);
	assert.deepEqual(
		picker.notes,
		[[settled.result.text, true]],
		"said twice, as a refusal is",
	);
});

test("F4: an unreported ladder is refused, not read as an empty one", async () => {
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = "unreported";
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, MODEL_READING);
	const settled = picker.hook();
	assert.deepEqual(picker.selections, []);
	assert.equal(settled.result.tone, "error");
	assert.match(settled.result.text, /effort levels could not be read/);
});

test("F4: a PRESENT-but-unresolved ladder is refused, not read as an empty one", async () => {
	/*
	 * Review round 5's reproduction of F4's residual slot. `Array.isArray` alone
	 * separates an ABSENT key from an empty ladder; it cannot separate "nobody has
	 * read this ladder" from "this model has no rungs", and the shape that slips
	 * through it is the cold snapshot - every field present and empty, no display
	 * name. There the old decision was `checked: true` and the clearing sentence
	 * printed the chip's category word in a level slot: "Its effort falls to
	 * unknown". It is refused now.
	 */
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = "cold";
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, MODEL_READING);
	const settled = picker.hook();
	assert.deepEqual(picker.selections, [], "nothing is recorded");
	assert.equal(settled.result.tone, "error");
	assert.match(settled.result.text, /effort levels could not be read/);
	assert.doesNotMatch(settled.result.text, /unknown/);
});

test("F2: the busy window covers the probe, so a second click cannot commit behind it", async () => {
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/openai/gpt-6-astra"] = ["low", "high"];
	const hook = picker.hook();
	const pending = hook.pick(NEW_MODEL, MODEL_READING);
	assert.equal(
		picker.hook().busy,
		true,
		"busy is set before the probe, and it is the dialog's only guard",
	);
	await pending;
	assert.equal(picker.hook().busy, false, "and it clears when the pick settles");
});

test("M1: the carry question is the DIALOG's live selection, not the snapshot it opened on", async () => {
	/*
	 * Review round 5, M1. `draft.target` is the snapshot the dialog MOUNTED with and
	 * does not move when the pane does - the hook's own comment says so, and the
	 * remembered `picked` exists precisely because of it. The call site read its
	 * carry QUESTION from that snapshot, so a second pick in the SAME open dialog
	 * asked to carry a rung the first pick had already dropped, and the back end
	 * resolved the new model at a level the pane was not showing.
	 *
	 * The question is executable only at the call site's own expression, and this
	 * repository deliberately has no DOM harness to render `ModelPicker`'s list. So
	 * the question lives in `carriedRung` - in the executed slice above, because it
	 * sits beside the hook - and this test drives the SHIPPED hook through the
	 * two-pick sequence with it, while the call site that must use it is pinned as
	 * source text, the way this file's other call-site facts are. Both halves fail
	 * on the old code: the function did not exist, and the call site read the frozen
	 * prop at `destination-pickers.tsx:598-601`.
	 */
	const llama = {
		provider: "openrouter",
		model_id: "meta/llama-4",
		reasoning_effort: null,
	};
	const picker = pickerHarness({ initial: DRAFT_RUNG });
	picker.ladders["openrouter/meta/llama-4"] = ["low", "medium"];
	picker.ladders["openrouter/openai/gpt-6-astra"] = ["low", "medium", "high"];
	const opened = picker.hook();
	assert.equal(
		carriedRung(opened.selection),
		"high",
		"the pane opened holding a rung",
	);
	await opened.pick(llama, {
		...MODEL_READING,
		carry: carriedRung(opened.selection),
	});
	assert.deepEqual(
		picker.selections,
		[llama],
		"the first pick clears the rung, because that model does not offer it",
	);
	/*
	 * The question has MOVED and the snapshot is the thing that has not. This
	 * comparison IS the defect, and it is what a second pick used to be answered
	 * from.
	 */
	const held = picker.hook();
	assert.equal(carriedRung(held.selection), "", "the pane holds no rung now");
	assert.equal(
		carriedRung(picker.draft.target.model),
		"high",
		"the snapshot the dialog opened on still answers with the rung it dropped",
	);
	await held.pick(NEW_MODEL, {
		...MODEL_READING,
		carry: carriedRung(held.selection),
	});
	assert.deepEqual(
		picker.selections[1],
		NEW_MODEL,
		"the second pick records no rung, rather than reinstating one the pane dropped",
	);
	assert.equal(
		picker.requests.length,
		3,
		"only the first pick pays for a probe: an empty question issues none",
	);
	/*
	 * And the call-site EXPRESSION itself, EXECUTED rather than pattern-matched.
	 *
	 * A regex could not carry this test: the old line matched no pattern this file
	 * pinned - the assertion that stood here pinned it as DESIRED, which is how the
	 * defect survived two rounds. So the slice is lifted out of the shipped file
	 * and evaluated with the same live hook bound to `draftPick`, and the question
	 * the picker actually asks is the one compared. On the old line `draft` is
	 * bound to the frozen target, this returns the rung the pane dropped, and the
	 * test fails with that value in the diff.
	 */
	const callSite = pickerSource.slice(
		pickerSource.indexOf("const carried ="),
		pickerSource.indexOf("await draftPick.pick("),
	);
	assert.ok(callSite.length > 0, "the pick's carry question is still a local");
	const question = new Function(
		"carriedRung",
		"draft",
		"draftPick",
		`${callSite}\nreturn carried;`,
	)(carriedRung, picker.draft, held);
	assert.equal(
		question,
		"",
		"the question the picker asks is the live pane's, not the snapshot's",
	);
});

test("a model pick on a pane with no rung is unchanged, and passes no carry question", async () => {
	const picker = pickerHarness();
	const hook = picker.hook();
	await hook.pick(NEW_MODEL, { ...MODEL_READING, carry: "" });
	const settled = picker.hook();
	assert.deepEqual(picker.selections, [NEW_MODEL]);
	assert.equal(picker.requests.length, 1, "no probe without a rung to check");
	assert.match(
		settled.result.text,
		/This conversation will run openrouter\/openai\/gpt-6-astra\./,
	);
});
