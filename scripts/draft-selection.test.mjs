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
				fetchDraftPreview,
				selectionFromModel,
				selectionSelector,
			} from "./src/renderer/src/features/chat/draft-selection";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
			export { bandReadings, effortLadder, specUnresolved } from "./src/renderer/src/features/chat/session-status/session-model";
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
	effortLadder,
	errorText,
	fetchDraftPreview,
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
			resolve.indexOf("draft.select(next)"),
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
	assert.match(resolve, /setPicked\(next\)/);
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

	// A model pick replaces the selection, rung included: the previous model's
	// rung is not a level the new model agreed to.
	assert.match(picker, /model_id: modelId, reasoning_effort: null/);
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
const hookStart = pickerSource.indexOf("function useDraftPick(");
const hookEnd = pickerSource.indexOf("export const ModelPicker:");
const effortStart = pickerSource.indexOf("export const EffortPicker:");
const effortEnd = pickerSource.indexOf("export const ThemePicker:");
assert.ok(hookStart >= 0 && hookEnd > hookStart);
assert.ok(effortStart >= 0 && effortEnd > effortStart);
const pickerCode = await transform(
	`${pickerSource.slice(hookStart, hookEnd)}\n${pickerSource.slice(effortStart, effortEnd)}\nexport { useDraftPick };`,
	{ loader: "tsx", jsx: "automatic", format: "cjs" },
);
let activePicker;
const pickerDependencies = {
	NO_DRAFT_TARGET,
	draftPreviewQuery,
	selectionFromModel,
	bandReadings,
	effortLadder,
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
const { EffortPicker: ExecutedEffortPicker, useDraftPick: executedDraftPick } =
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
		preview: (key) => {
			if (!key[5]) return resolved;
			const slash = key[5].indexOf("/");
			return frame({
				...SPEC,
				provider: key[5].slice(0, slash),
				model_id: key[5].slice(slash + 1),
				reasoning_effort: key[6],
			});
		},
	};
	instance.client = {
		fetchQuery: async (query) => {
			instance.requests.push(query.queryKey);
			if (instance.reject) throw new Error("The candidate was refused.");
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
