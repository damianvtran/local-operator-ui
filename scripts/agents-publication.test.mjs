import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The publication flow's two pure halves, driven rather than eyeballed.
 *
 * Both of them decide something a story cannot assert: which refusal a user
 * sees and what they are told to do about it, and whether a name or a document
 * this dialog would submit is one the hub will accept. A Storybook frame proves
 * a treatment RENDERS for one code; it cannot prove that `name_taken` with
 * `owned_by_caller` set takes the different branch, that an unknown code falls
 * back to prose, that the instruction cap counts code points, or that the name
 * folding is the hub's. Those are the failures that ship silently — they look
 * exactly like the working case in a frame.
 *
 * Everything here is the shipped module, bundled the way the renderer bundles
 * it, so nothing is being tested twice: the constants (the 128-character name,
 * the 8000-character body) come from `src/shared/desktop-contract.ts`, which is
 * also the schema the transport asks before it builds a request.
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/api/local-operator/publication-errors";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export * from "./src/renderer/src/features/agents/utils/publication-failure";
			export * from "./src/renderer/src/features/agents/utils/publication-validation";
			export {
				desktopRequestSchema,
				desktopEndpoint,
				publicationNameRule,
				publicationNameKey,
				isPublishableName,
				PUBLICATION_NAME_MAX_CHARS,
				PUBLICATION_INSTRUCTIONS_MAX_CHARS,
				PUBLICATION_TOOLS_MAX_ITEMS,
			} from "./src/shared/desktop-contract";
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
	write: false,
});

// Written to a real file rather than imported as a data: URL, so the bundle's own
// relative imports resolve against a real base path. Unlinked immediately after
// import; a run killed mid-test leaves one file the next run overwrites.
const bundlePath = new URL("./_agents-publication.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const {
	DesktopControlError,
	publicationErrorFromBody,
	isPublicationError,
	publicationProse,
	MODERATION_CATEGORIES,
	publicationTreatment,
	publicationIssues,
	isReservedBuiltinName,
	localNameCollision,
	toolsFromAgentTags,
	pullRefusalMessage,
	desktopRequestSchema,
	desktopEndpoint,
	publicationNameRule,
	publicationNameKey,
	isPublishableName,
	PUBLICATION_NAME_MAX_CHARS,
	PUBLICATION_INSTRUCTIONS_MAX_CHARS,
	PUBLICATION_TOOLS_MAX_ITEMS,
} = mod;

/** A treatment context with no known hub listing, which is the common case. */
const context = (over = {}) => ({ name: "Coder", hubAgentId: null, ...over });

test("a refusal with a known code becomes a typed error carrying its details", () => {
	const refused = publicationErrorFromBody(409, {
		detail: {
			code: "name_taken",
			message: 'The name "Coder" is already published on the hub.',
			details: { existing_agent_id: "abc123", owned_by_caller: true },
		},
	});
	assert.ok(refused, "a known code must produce a typed refusal");
	assert.equal(refused.code, "name_taken");
	assert.equal(refused.status, 409);
	assert.equal(refused.details.existing_agent_id, "abc123");
	assert.equal(refused.details.owned_by_caller, true);
	// Authored copy: `userFacingMessage` only trusts a message from a class it
	// knows, and this error is one — otherwise every publish refusal would render
	// as a generic sentence.
	assert.ok(isPublicationError(refused));
	assert.equal(
		refused.message,
		'The name "Coder" is already published on the hub.',
	);
});

test("a missing or unknown code falls back to prose, which is a required state", () => {
	// An older backend: one prose `detail` string, the D-2 shape.
	const legacy = publicationErrorFromBody(400, {
		detail: "Error uploading agent to Radient: boom",
	});
	assert.equal(legacy, null, "a string detail has no code to switch on");
	assert.equal(
		publicationProse({ detail: "Error uploading agent to Radient: boom" }),
		"Error uploading agent to Radient: boom",
	);

	// A hub newer than this renderer: a code this build has no treatment for.
	const newer = publicationErrorFromBody(409, {
		detail: { code: "name_needs_a_lawyer", message: "No." },
	});
	assert.equal(
		newer,
		null,
		"an unrecognised code must not be guessed at, it must fall back to prose",
	);
	assert.equal(
		publicationProse({
			detail: { code: "name_needs_a_lawyer", message: "No." },
		}),
		"No.",
	);

	// Nothing parseable at all is also a fallback rather than a throw.
	assert.equal(publicationErrorFromBody(502, null), null);
	assert.equal(publicationErrorFromBody(502, { detail: {} }), null);
	assert.equal(publicationProse("<html>"), null);
});

test("each refusal code gets its own headline, and only the wrong ones say nothing was published", () => {
	const taken = publicationTreatment(
		{
			code: "name_taken",
			message: "taken",
			details: { owned_by_caller: false },
		},
		context(),
	);
	assert.match(taken.body, /another account/);
	assert.deepEqual(taken.actions, ["focus-name"]);
	assert.equal(taken.focus, "name");

	// The SAME code, owned by the caller: a different headline and a different
	// next step. This is the branch a single-sentence toast could not carry — the
	// recovery is "update your listing", not "pick another name".
	const owned = publicationTreatment(
		{
			code: "name_taken",
			message: "taken",
			details: { owned_by_caller: true },
		},
		context({ hubAgentId: "listing1" }),
	);
	assert.equal(owned.headline, "You already published this agent");
	assert.deepEqual(owned.actions, ["update-listing", "focus-name"]);
	// Without a listing id there is no honest "update it" offer.
	assert.deepEqual(
		publicationTreatment(
			{
				code: "name_taken",
				message: "taken",
				details: { owned_by_caller: true },
			},
			context(),
		).actions,
		["focus-name"],
	);

	const reserved = publicationTreatment(
		{
			code: "name_reserved_builtin",
			message: "reserved",
			details: {
				builtin_name: "reviewer",
				builtin_source_url: "https://example.invalid/reviewer",
			},
		},
		context(),
	);
	// The built-in's NAME is shown; its source URL is not — a link to where the
	// hub's definition came from is not what the author has to change.
	assert.match(reserved.body, /"reviewer" is the name of a built-in agent/);
	assert.ok(!JSON.stringify(reserved).includes("example.invalid"));
	assert.deepEqual(reserved.actions, ["focus-name", "install-builtin"]);

	// The one refusal that is NOT a rejection: warning, retryable, and it says
	// outright that nothing was published.
	const unavailable = publicationTreatment(
		{ code: "moderation_unavailable", message: "review unavailable" },
		context(),
	);
	assert.equal(unavailable.variant, "warning");
	assert.deepEqual(unavailable.actions, ["retry"]);
	assert.match(unavailable.body, /Nothing was published/);
	// Retrying a rejection is the trap this separation exists to prevent.
	const rejected = publicationTreatment(
		{
			code: "moderation_rejected",
			message: "This agent was not accepted for publication: phishing.",
			details: { categories: ["fraud_or_deception"], reason: "phishing" },
		},
		context(),
	);
	assert.equal(rejected.variant, "danger");
	assert.deepEqual(rejected.actions, ["edit-instructions"]);
	assert.ok(
		!rejected.actions.includes("retry"),
		"a content decision must not offer a retry that cannot change the answer",
	);

	const tooLarge = publicationTreatment(
		{
			code: "payload_too_large",
			message: "too large",
			details: { limit_bytes: 65536 },
		},
		context(),
	);
	assert.match(tooLarge.body, /64 KiB/);
	assert.deepEqual(tooLarge.actions, []);

	const notOwner = publicationTreatment(
		{ code: "not_owner", message: "not yours" },
		context(),
	);
	assert.equal(notOwner.headline, "You cannot update this listing");

	const gone = publicationTreatment(
		{ code: "agent_not_found", message: "gone" },
		context(),
	);
	assert.deepEqual(gone.actions, ["refresh-hub"]);

	// The proxy's own two are distinguishable from the hub's, because the remedy
	// differs: one is a dependency, the other is this machine.
	assert.equal(
		publicationTreatment(
			{ code: "hub_unavailable", message: "unreachable" },
			context(),
		).variant,
		"warning",
	);
	assert.equal(
		publicationTreatment({ code: "local_failure", message: "local" }, context())
			.body,
		"local",
	);

	// No code: the prose, unchanged, with no invented next step.
	const prose = publicationTreatment(
		{ message: "Error uploading agent to Radient: boom" },
		context(),
	);
	assert.equal(prose.body, "Error uploading agent to Radient: boom");
	assert.deepEqual(prose.actions, []);
});

test("every moderation category has a line, and an unknown one falls back rather than blanking", () => {
	for (const category of MODERATION_CATEGORIES) {
		const treatment = publicationTreatment(
			{
				code: "moderation_rejected",
				message: "rejected",
				details: { categories: [category], reason: "reason" },
			},
			context(),
		);
		assert.ok(
			treatment.note && treatment.note.length > 20,
			`${category} must have a line of its own`,
		);
	}
	// An unrecognised category from the wire takes the other_harmful line, which
	// is what the reviewer itself does with output it cannot place.
	const unknown = publicationTreatment(
		{
			code: "moderation_rejected",
			message: "rejected",
			details: { categories: ["something_new"], reason: "reason" },
		},
		context(),
	);
	assert.match(unknown.note, /would cause harm/);
	// The reviewer's reason is shown, and the reviewer's raw output never is.
	assert.equal(unknown.body, "reason");
});

test("a validator refusal points at the field it names, and at nothing when it names none", () => {
	const name = publicationTreatment(
		{
			code: "invalid_instruction_set",
			message:
				"The agent document is not valid: name must not contain whitespace.",
			details: { field: "name", rule: "must not contain whitespace" },
		},
		context(),
	);
	assert.equal(name.body, "Name must not contain whitespace.");
	assert.equal(name.focus, "name");
	assert.deepEqual(name.actions, ["focus-name"]);

	// The rule text is the hub's, so the sentence names the field and the bound in
	// one place rather than two.
	const body = publicationTreatment(
		{
			code: "invalid_instruction_set",
			message: "…",
			details: {
				field: "instructions",
				rule: "must be at most 8000 characters",
			},
		},
		context(),
	);
	assert.equal(
		body.body,
		"The instruction body must be at most 8000 characters.",
	);
	assert.equal(body.focus, "instructions");

	// A field with no control in this dialog stays dialog-level: pointing at a
	// control that does not exist is the defect.
	const kind = publicationTreatment(
		{
			code: "invalid_instruction_set",
			message: "…kind must be role.",
			details: { field: "kind" },
		},
		context(),
	);
	assert.equal(kind.focus, null);
	assert.equal(kind.body, "…kind must be role.");
});

test("the pre-validation mirrors the hub's name rules, rule for rule", () => {
	// Order matters: it decides WHICH rule a name breaks for, and a client that
	// reported a different one would send its author looking for a character that
	// is not there.
	assert.equal(publicationNameRule(""), "must not be empty");
	assert.equal(publicationNameRule("   "), "must not be empty");
	assert.equal(
		publicationNameRule("x".repeat(PUBLICATION_NAME_MAX_CHARS + 1)),
		`must be at most ${PUBLICATION_NAME_MAX_CHARS} characters`,
	);
	assert.equal(
		publicationNameRule("x".repeat(PUBLICATION_NAME_MAX_CHARS)),
		null,
		"the cap is inclusive",
	);
	assert.equal(
		publicationNameRule("code/reviewer"),
		'must not contain "/", "\\" or ":"',
	);
	assert.equal(
		publicationNameRule("code\\reviewer"),
		'must not contain "/", "\\" or ":"',
	);
	assert.equal(
		publicationNameRule("code:reviewer"),
		'must not contain "/", "\\" or ":"',
	);
	assert.equal(
		publicationNameRule("code reviewer"),
		"must not contain whitespace",
	);
	assert.equal(
		publicationNameRule("code\u00a0reviewer"),
		"must not contain whitespace",
	);
	assert.equal(
		publicationNameRule("code\u0007reviewer"),
		"must not contain control characters",
	);
	assert.equal(
		publicationNameRule("code\u202ereviewer"),
		"must not contain Unicode bidirectional override characters",
	);
	assert.equal(
		publicationNameRule("-coder"),
		'must not begin or end with "-" or "."',
	);
	assert.equal(
		publicationNameRule("coder."),
		'must not begin or end with "-" or "."',
	);
	// Everything else is allowed, case included: case is normalised for the
	// duplicate check and never for storage.
	assert.equal(publicationNameRule("Code_Reviewer-2"), null);
	assert.equal(publicationNameRule("Кодер"), null);
	// A zero-width no-break space is NOT White_Space: refusing it here would refuse
	// a name the hub accepts, which is the wrong direction.
	assert.equal(publicationNameRule("code\ufeffreviewer"), null);
	assert.equal(isPublishableName("Code-Reviewer"), true);
	assert.equal(isPublishableName("Code Reviewer"), false);
});

test("the name key folds the way the hub folds, so the local check cannot disagree", () => {
	// NFKC (a fullwidth name is the ASCII name), case, trim, and whitespace runs.
	assert.equal(publicationNameKey("Code Reviewer"), "code reviewer");
	assert.equal(publicationNameKey("CODE   REVIEWER"), "code reviewer");
	assert.equal(publicationNameKey("  code reviewer  "), "code reviewer");
	assert.equal(publicationNameKey("ＣｏｄｅＲｅｖｉｅｗｅｒ"), "codereviewer");
	assert.equal(publicationNameKey("Coder"), publicationNameKey("coder"));
	// Not folded, and deliberately: punctuation and script are part of the name.
	assert.notEqual(
		publicationNameKey("Code-Reviewer"),
		publicationNameKey("Code_Reviewer"),
	);
});

test("the built-in reservation is checked offline, by name key", () => {
	const builtins = ["reviewer", "coder", "designer", "scout"];
	assert.equal(isReservedBuiltinName("reviewer", builtins), true);
	// The case-variant is the same reserved name, which is the whole point of the
	// folding: a user cannot publish "Reviewer" around the reservation.
	assert.equal(isReservedBuiltinName("Reviewer", builtins), true);
	assert.equal(isReservedBuiltinName("review", builtins), false);
	assert.equal(isReservedBuiltinName("coder", []), false);
});

test("the document rules are the hub's bounds, counted in code points", () => {
	const base = {
		name: "Coder",
		description: "Does things.",
		instructions: "Do it.",
		tools: null,
	};
	assert.deepEqual(publicationIssues(base), []);

	// 8000 code points, not 8000 UTF-16 units: an emoji is two units and one
	// character, so counting units would refuse at half the hub's ceiling.
	const emoji = "🙂".repeat(PUBLICATION_INSTRUCTIONS_MAX_CHARS);
	assert.deepEqual(
		publicationIssues({ ...base, instructions: emoji }),
		[],
		"8000 code points is at the cap, not over it",
	);
	assert.match(
		publicationIssues({ ...base, instructions: `${emoji}🙂` })[0].message,
		new RegExp(
			`The instruction body must be at most ${PUBLICATION_INSTRUCTIONS_MAX_CHARS} characters.`,
		),
	);

	// Every reason, not the first: the dialog lists them all and disables submit.
	const many = publicationIssues({
		name: "two words",
		description: "   ",
		instructions: "",
		tools: Array.from(
			{ length: PUBLICATION_TOOLS_MAX_ITEMS + 1 },
			(_, i) => `t${i}`,
		),
	});
	assert.equal(many.length, 4);
	assert.deepEqual(
		many.map((issue) => issue.field),
		["name", "description", "instructions", "tools"],
	);
	assert.equal(many[0].message, "Name must not contain whitespace.");
	assert.equal(many[1].message, "Description must not be empty.");

	// `null` instructions means the body is not known yet (it is a separate read),
	// which is not a violation: the hub still checks it.
	assert.deepEqual(publicationIssues({ ...base, instructions: null }), []);

	// The tool surface is decoded from the tags the registry encodes it in.
	assert.deepEqual(
		toolsFromAgentTags(["role", "tools:read,grep, web_search"]),
		["read", "grep", "web_search"],
	);
	assert.equal(toolsFromAgentTags(["role"]), null);
	assert.equal(toolsFromAgentTags(["tools:"]), null);
	assert.equal(toolsFromAgentTags(undefined), null);
	assert.equal(
		toolsFromAgentTags(["TOOLS:read"]).length,
		1,
		"the key is case-folded",
	);
});

test("a pull refusal names what was not downloaded, from the code when there is one", () => {
	assert.equal(
		pullRefusalMessage(
			publicationErrorFromBody(404, {
				detail: { code: "agent_not_found", message: "Agent not found." },
			}),
			"Inbox triage",
		),
		'"Inbox triage" is no longer on the hub, so nothing was downloaded.',
	);
	assert.equal(
		pullRefusalMessage(
			publicationErrorFromBody(502, {
				detail: { code: "hub_unavailable", message: "unreachable" },
			}),
			"Inbox triage",
		),
		'The hub could not be reached, so "Inbox triage" was not downloaded.',
	);
	// No code: the backend's own sentence, with the transport's machine-voice
	// prefixes stripped so what is left is the reason. The carrier is the class the
	// client actually throws — a `DesktopControlError` — because that class is the
	// only thing that makes a message authored copy.
	assert.equal(
		pullRefusalMessage(
			new DesktopControlError(
				400,
				"Download agent from Radient failed: Error downloading agent from Radient: Failed to download agent x from Radient Agent Hub due to a requests error",
			),
			"Inbox triage",
		),
		'"Inbox triage" was not downloaded: Failed to download agent x from Radient Agent Hub due to a requests error',
	);
	// A refusal that carried no sentence at all still says what it is about rather
	// than nothing, and a bare `Error` (a crash, or this client's own guard) is not
	// copy: its message is not shown.
	assert.equal(
		pullRefusalMessage(new DesktopControlError(500, ""), ""),
		"That agent could not be downloaded.",
	);
	assert.equal(
		pullRefusalMessage(new Error("boom"), "Inbox triage"),
		'"Inbox triage" could not be downloaded.',
	);
});

test("the local collision check folds, so Coder beside coder is found", () => {
	// The exact D-4 state: the local lookup is case-sensitive, so `Coder` and
	// `coder` coexist and the profile resolver picks one arbitrarily.
	assert.equal(localNameCollision("coder", ["Coder", "scout"]), "Coder");
	assert.equal(localNameCollision("Coder (2)", ["Coder", "scout"]), null);
	assert.equal(localNameCollision("Coder", []), null);
});

test("the three publication ops reach their routes with the body the routes require", () => {
	const parse = (request) => {
		const result = desktopRequestSchema.safeParse(request);
		assert.ok(result.success, `${JSON.stringify(request)} must be a legal op`);
		return desktopEndpoint(request);
	};

	const publish = parse({ op: "agent.publish", agentId: "agent123" });
	assert.equal(publish.path, "/v1/agents/agent123/publish");
	assert.equal(publish.method, "POST");
	// `{}` and not an omitted body: the route's input model forbids extras while
	// still requiring a JSON object, so an absent body 422s a legal call.
	assert.deepEqual(publish.body, { document: {} });

	const withDocument = parse({
		op: "agent.publish",
		agentId: "agent123",
		document: { name: "Coder" },
	});
	assert.deepEqual(withDocument.body, { document: { name: "Coder" } });

	// The republish REQUIRES the hub listing: the local registry keeps no link to
	// it, so a PUT without one would have to guess which public row to overwrite.
	const republish = parse({
		op: "agent.republish",
		agentId: "agent123",
		hubAgentId: "listing456",
		document: { name: "Coder" },
	});
	assert.equal(republish.path, "/v1/agents/agent123/publish");
	assert.equal(republish.method, "PUT");
	assert.deepEqual(republish.body, {
		hub_agent_id: "listing456",
		document: { name: "Coder" },
	});

	const availability = parse({
		op: "agent.nameAvailability",
		name: "Code Reviewer",
	});
	assert.equal(
		availability.path,
		"/v1/agent-name-availability?name=Code+Reviewer",
	);
	assert.equal(availability.method, "GET");
});

test("the ops refuse what the hub would refuse, before a request is built", () => {
	// `document_type`/`document_version` are client-owned: an override of either is
	// refused by the hub, so there is no shape here in which one could travel.
	for (const bad of [
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { document_version: 2 },
		},
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { document_type: "x" },
		},
		{ op: "agent.publish", agentId: "agent123", document: { model: "gpt" } },
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { hosting: "local" },
		},
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { current_working_directory: "/tmp" },
		},
		{ op: "agent.republish", agentId: "agent123" },
		{
			op: "agent.republish",
			agentId: "agent123",
			hubAgentId: "listing",
			document: { name: "two words" },
		},
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { name: "two words" },
		},
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { instructions: "" },
		},
		{ op: "agent.nameAvailability", name: "" },
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { name: "ok" },
			history: [],
		},
	]) {
		assert.equal(
			desktopRequestSchema.safeParse(bad).success,
			false,
			`${JSON.stringify(bad)} must not be sendable`,
		);
	}
});
