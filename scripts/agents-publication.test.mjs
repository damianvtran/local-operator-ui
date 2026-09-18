import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/** Source-anchoring reads files rather than bundling them; see the call-site test. */
const read = (path) => readFileSync(path, "utf8");

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
			export { backendLoadErrorMessage } from "./src/renderer/src/shared/api/local-operator/backend-error";
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
	agentActionFailureMessage,
	backendLoadErrorMessage,
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
	// The refusal's OWN id is enough, with no remembered listing: gating this offer
	// on the store alone printed "update that listing instead" beside a lone
	// "Choose another name" for every fresh profile and every agent published
	// before this app kept the link, which is the copy naming a remedy the action
	// set did not contain.
	const ownedFromRefusal = publicationTreatment(
		{
			code: "name_taken",
			message: "taken",
			details: {
				owned_by_caller: true,
				existing_agent_id: "listing-from-refusal",
			},
		},
		context(),
	);
	assert.deepEqual(ownedFromRefusal.actions, ["update-listing", "focus-name"]);
	// With neither there is no honest "update it" offer.
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
		// The name the dialog's own field holds, which is the thing a reader of the
		// refusal has to change: the fixture is D2's frame.
		context({ name: "adverse-media-screener" }),
	);
	// The SUBJECT is the name being published; the built-in is the agent that
	// reserves it. `details.builtin_name` says WHICH built-in reserved it, so a
	// sentence built from it alone told an author publishing
	// `adverse-media-screener` to stop using "reviewer" — a name that was not on
	// their screen — and never named the one that was. Its source URL is still not
	// shown: a link to where the hub's definition came from is not what the author
	// has to change.
	assert.match(
		reserved.body,
		/"adverse-media-screener" is reserved by the built-in agent "reviewer"/,
	);
	assert.ok(!JSON.stringify(reserved).includes("example.invalid"));
	assert.deepEqual(reserved.actions, ["focus-name", "install-builtin"]);
	// When the two names ARE the same name — the pre-submit arm, which has no
	// `details` to read, and the hub refusing a built-in's own name — one clause
	// says it once rather than naming the same string twice.
	assert.match(
		publicationTreatment(
			{ code: "name_reserved_builtin", message: "reserved" },
			context({ name: "Reviewer" }),
		).body,
		/^"Reviewer" is the name of a built-in agent\. Built-in names cannot be published to the hub\.$/,
	);

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
	// The body says "shorten the instructions", so the action set has to hold the
	// route to them: an empty set left the one sentence and the one control
	// disagreeing.
	assert.deepEqual(tooLarge.actions, ["edit-instructions"]);

	// The escape from a remembered listing this account cannot address. Both
	// refusals that mean the memory is stale offer it, because `submit` sends the
	// remembered id on every later attempt and neither of these can be fixed from
	// the dialog otherwise.
	const notOwner = publicationTreatment(
		{ code: "not_owner", message: "not yours" },
		context({ hubAgentId: "listing1" }),
	);
	assert.equal(notOwner.headline, "You cannot update this listing");
	assert.deepEqual(notOwner.actions, ["publish-as-new"]);

	const gone = publicationTreatment(
		{ code: "agent_not_found", message: "gone" },
		context({ hubAgentId: "listing1" }),
	);
	assert.deepEqual(gone.actions, ["publish-as-new", "refresh-hub"]);

	// The proxy's own three are distinguishable from the hub's, because the remedy
	// differs: one is a dependency, one is this machine's own credential, and one
	// is this machine before the hub was asked anything.
	assert.equal(
		publicationTreatment(
			{ code: "hub_unavailable", message: "unreachable" },
			context(),
		).variant,
		"warning",
	);
	// A refused CREDENTIAL is not the same fact as the app being signed out, and
	// its remedy — re-running the Radient sign-in — is a control this dialog owns.
	// Without an arm it rendered as the generic panel, so the one refusal whose fix
	// was already on this component had no route to it.
	const unauthorized = publicationTreatment(
		{ code: "hub_unauthorized", message: "credential refused" },
		context(),
	);
	assert.equal(unauthorized.variant, "danger");
	assert.deepEqual(unauthorized.actions, ["sign-in"]);
	assert.equal(
		publicationTreatment({ code: "local_failure", message: "local" }, context())
			.body,
		"local",
	);

	// No code: the prose, unchanged, and the one step that is honest at this level.
	// Nothing in an untyped refusal establishes that a second attempt is unsafe,
	// and an attempt that fails again comes back with a code that has a real next
	// step.
	const prose = publicationTreatment(
		{ message: "Error uploading agent to Radient: boom" },
		context(),
	);
	assert.equal(prose.body, "Error uploading agent to Radient: boom");
	assert.deepEqual(prose.actions, ["retry"]);
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

test("a name held by an in-flight publication is retryable, not taken", () => {
	/*
	 * agent-server's ninth code, and the one most easily folded into
	 * `name_taken` by accident. They are different facts: `name_taken` is a claim
	 * to give up on, `name_claim_in_flight` is a seconds-long reservation to wait
	 * out. The assertions below are about that difference - a retry action, a
	 * warning register - and about the neighbours it must not be
	 * confused with, asserted in the same place so the distinction is one test
	 * rather than three files.
	 */
	const inFlight = publicationTreatment(
		{
			code: "name_claim_in_flight",
			message:
				'The name "adverse-media-screener" is being published right now. Try again in a moment.',
			details: { owned_by_caller: false, retryable: true },
		},
		context(),
	);
	assert.deepEqual(inFlight.actions, ["retry"]);
	assert.equal(inFlight.variant, "warning");
	assert.match(inFlight.headline, /being published/i);
	assert.doesNotMatch(inFlight.body, /another account|choose another/i);

	// Its two neighbours on the submit path: the taken name, and the review
	// outage. Only the outage offers a retry, and only the taken name sends the
	// user back to the name field.
	assert.deepEqual(
		publicationTreatment(
			{ code: "name_taken", message: "taken", details: {} },
			context(),
		).actions,
		["focus-name"],
	);
	assert.deepEqual(
		publicationTreatment(
			{ code: "moderation_unavailable", message: "down", details: {} },
			context(),
		).actions,
		["retry"],
	);
});

test("a validator refusal offers the route to the field it names", () => {
	// The name is the one field this dialog owns a control for.
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
	assert.deepEqual(name.actions, ["focus-name"]);

	// The rule text is the hub's, so the sentence names the field and the bound in
	// one place rather than two — and the sentence's own instruction ("shorten the
	// instructions") has to be an action, not a sentence beside a lone Close.
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
	assert.deepEqual(body.actions, ["edit-instructions"]);

	// The rest of the document is on the agent's own page, which is one destination
	// for the description and the tool surface alike.
	for (const field of ["description", "tools", "when_to_use", "categories"])
		assert.deepEqual(
			publicationTreatment(
				{
					code: "invalid_instruction_set",
					message: "…",
					details: { field, rule: "is too long" },
				},
				context(),
			).actions,
			["edit-agent"],
			`${field} is edited on the agent's own page`,
		);

	// A document-level field has the same route, and keeps the backend's own
	// sentence: this dialog cannot describe `kind` better than the validator did.
	const kind = publicationTreatment(
		{
			code: "invalid_instruction_set",
			message: "…kind must be role.",
			details: { field: "kind" },
		},
		context(),
	);
	assert.deepEqual(kind.actions, ["edit-agent"]);
	assert.equal(kind.body, "…kind must be role.");
});

test("the pre-validation mirrors the hub's name rules, rule for rule", () => {
	/*
	 * Order matters: it decides WHICH rule a name breaks for, and a client that
	 * reported a different one would send its author looking for a character that
	 * is not there. The order, the classes and the sentences are `_name_rule`
	 * (`local_operator/clients/radient.py`), which is the function the publish
	 * dialog's own sentences are quoted from; the bidi-before-whitespace case below
	 * is what pins that.
	 */
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
		publicationNameRule("code\u202ereviewer"),
		"must not contain Unicode bidirectional override characters",
	);
	assert.equal(
		publicationNameRule("code\u202ere viewer"),
		"must not contain Unicode bidirectional override characters",
		"the ORDER is the hub's: bidi outranks the space it also breaks",
	);
	// Whitespace that is ALSO a control character stays refused, with the hub's own
	// text for it: no legitimate name contains a tab, a form feed or a NEL.
	assert.equal(
		publicationNameRule("code\u0009reviewer"),
		"must not contain whitespace",
	);
	assert.equal(
		publicationNameRule("code\u0085reviewer"),
		"must not contain whitespace",
	);
	assert.equal(
		publicationNameRule("code\u0007reviewer"),
		"must not contain control characters",
	);
	/*
	 * Format characters (Cf) render as NOTHING, so `reviewer` with a zero-width
	 * space inside it draws identically to `reviewer` while being a different key —
	 * the shadowing an exact local lookup cannot see. This is the class the local
	 * mirror used to leave entirely to the hub, in the one direction of divergence
	 * that stays invisible until somebody types an invisible character.
	 */
	assert.equal(
		publicationNameRule("code\u200breviewer"),
		"must not contain invisible Unicode formatting characters",
	);
	assert.equal(
		publicationNameRule("code\ufeffreviewer"),
		"must not contain invisible Unicode formatting characters",
		"U+FEFF is Cf here whatever a JavaScript regex makes of it",
	);
	assert.equal(
		publicationNameRule("-coder"),
		'must not begin or end with "-" or "."',
	);
	assert.equal(
		publicationNameRule("coder."),
		'must not begin or end with "-" or "."',
	);

	/*
	 * AN ORDINARY SPACE IS NOT REFUSED, and this is the one rule the mirror
	 * deliberately does NOT mirror. The hub is relaxing a whitespace ban its own
	 * marketplace has already outgrown, so a client refusing one here would refuse a
	 * name the hub accepts — a client bound stricter than the server, which is a bug
	 * report — and would behave differently against two hub versions from one
	 * release. The name travels as the author wrote it and the hub decides, quoting
	 * its own rule through `details.rule`, which this dialog renders.
	 */
	assert.equal(publicationNameRule("code reviewer"), null);
	assert.equal(publicationNameRule("code\u00a0reviewer"), null);
	assert.equal(isPublishableName("Code Reviewer"), true);

	// Everything else is allowed, case included: case is normalised for the
	// duplicate check and never for storage.
	assert.equal(publicationNameRule("Code_Reviewer-2"), null);
	assert.equal(publicationNameRule("Кодер"), null);
	assert.equal(isPublishableName("Code-Reviewer"), true);
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
	// The name breaks the begin/end rule, which is a rule the hub HAS — a space is
	// not, so a fixture named with one would have made this list three long and the
	// assertion below would have been pinning a rule the server does not have.
	const many = publicationIssues({
		name: "two words.",
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
	assert.equal(many[0].message, 'Name must not begin or end with "-" or ".".');
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
		'The hub did not complete the download, so "Inbox triage" was not downloaded.',
		// The typed arm serves BOTH causes - a hub that stayed silent and a hub that
		// answered with something the transport codes `hub_unavailable` (this 502, a
		// 429) - so its sentence names the outcome rather than asserting a reach
		// failure the way round 4's M4-1 found it doing.
	);
	/*
	 * No code: the transport's machine voice comes off, and what is LEFT is
	 * classified, because a residue that is itself machinery is not a reason.
	 *
	 * The carriers are the classes the client actually throws: the Python proxy's
	 * two measured shapes — a `requests` read timeout, and a status the hub
	 * answered with — plus a genuine crash, whose message is not copy at all.
	 */
	const transport =
		"Error downloading agent from Radient: Failed to download agent hub-1f4c9a from Radient Agent Hub due to a requests error: HTTPSConnectionPool(host='api.radienthq.com', port=443): Read timed out.";
	assert.equal(
		pullRefusalMessage(
			new DesktopControlError(
				400,
				`Download agent from Radient failed: ${transport}`,
			),
			"Inbox triage",
		),
		'The hub could not be reached, so "Inbox triage" was not downloaded.',
		"a requests timeout is the retryable case, and reads the way the hub_unavailable arm reads",
	);
	/*
	 * THE STATUSES THAT MEAN THE HUB ANSWERED, each said as itself - the branches
	 * round 3's M3 split out of "could not be reached", pinned here because the
	 * distinction is the whole finding: a 429 is retryable, a 401/403 is a refused
	 * credential in the words the typed `hub_unauthorized` arm uses for the publish
	 * path, and a 5xx is the hub failing its own work rather than staying silent.
	 */
	for (const [status, expected] of [
		[
			429,
			'The hub is busy, so "Inbox triage" was not downloaded. Try again in a moment.',
		],
		[
			401,
			'The hub refused this machine\'s sign-in, so "Inbox triage" was not downloaded.',
		],
		[
			403,
			'The hub refused this machine\'s sign-in, so "Inbox triage" was not downloaded.',
		],
		[
			503,
			'The hub could not complete the download, so "Inbox triage" was not downloaded. Try again in a moment.',
		],
	]) {
		assert.equal(
			pullRefusalMessage(
				new DesktopControlError(
					status,
					`Download agent from Radient failed: Failed to download agent from Radient Agent Hub: ${status} Server Error for url: https://api.radienthq.com/v1/agents/aa14759e-9c1f/download`,
				),
				"Inbox triage",
			),
			expected,
			`${status} is the hub answering, not the hub being unreachable`,
		);
	}
	// The other measured shape: the hub answered 404 for a listing that is gone,
	// with its route and status class in the sentence. The listing id, the URL, the
	// exception class and the port must not reach the reader, and the sentence is
	// the same one the typed `agent_not_found` arm produces for the same fact.
	assert.equal(
		pullRefusalMessage(
			new DesktopControlError(
				404,
				"Error downloading agent from Radient: Failed to download agent from Radient Agent Hub: 404 Client Error: Not Found for url: https://api.radienthq.com/v1/agents/aa14759e-9c1f/download,Response Body: No response body",
			),
			"Inbox triage",
		),
		'"Inbox triage" is no longer on the hub, so nothing was downloaded.',
	);
	// A status the hub answered with that is neither: it refused, and this layer
	// cannot invent a remedy for a reason it was not told.
	assert.equal(
		pullRefusalMessage(
			new DesktopControlError(
				400,
				"Error downloading agent from Radient: Failed to download agent from Radient Agent Hub: 400 Client Error: Bad Request for url: https://api.radienthq.com/v1/agents/x/download",
			),
			"Inbox triage",
		),
		'The hub refused the download, so "Inbox triage" is not here.',
	);
	// A backend sentence that is a sentence is still shown as one.
	assert.equal(
		pullRefusalMessage(
			new DesktopControlError(
				400,
				"Error downloading agent from Radient: This agent is private to its owner.",
			),
			"Inbox triage",
		),
		'"Inbox triage" was not downloaded: This agent is private to its owner.',
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

/*
 * WHICH VOCABULARY A FAILED ACTION SPEAKS (design round 3, D1).
 *
 * The card, the details page and the onboarding batch all ask
 * `agentActionFailureMessage` for the sentence under the control that failed, so
 * this is the rule those three surfaces read - and the finding was that the PULL
 * was classified against the LOCAL server instead. Driven end to end through the
 * real card, a 404 `agent_not_found` arrived as "The Local Operator server is
 * older than this app expects. Update the server and try again." and a 503
 * `hub_unavailable` as "The Local Operator server is not answering. Restart the
 * app so it can start its own server." Both are true sentences about a process
 * that had nothing to do with the refusal, and each names a remedy the user
 * cannot act on; three more refusals arrived as "The action did not complete."
 * with no reason at all, because a code this client has no treatment for is not
 * something the local classifier can speak about either.
 *
 * PINNED HERE RATHER THAN IN A FRAME because the set that used to photograph this
 * cannot settle: `agents-pull-outcomes--refused` waits on a toast sentence the
 * hook no longer produces, the failure having become the caller's to render (D4
 * in the same round).
 *
 * The `notEqual` against the local classifier is the load-bearing half rather
 * than a tautology: it is the assertion that would have failed before this fix
 * and it fails on the WORDING rather than on the wiring.
 *
 * It does NOT pin the wiring, and an earlier version of this paragraph claimed
 * it did. Everything here bundles modules, so reverting a CALLER to
 * `backendLoadErrorMessage` leaves this test green - measured, 15/15, for the
 * card and for the onboarding step; only reverting the rule itself turns it red
 * (review round 2, R1). The call sites are pinned by the test below, which is
 * the instrument this PR actually has for them: the card's inline line is the one
 * place these sentences render and its frame set cannot settle (D4 below).
 */
test("a failed action is answered by the process that refused it, never the other one", () => {
	const localSentence = (error) =>
		backendLoadErrorMessage("The action did not complete.", error);
	const refusals = [
		[
			"a listing the hub no longer has",
			publicationErrorFromBody(404, {
				detail: { code: "agent_not_found", message: "Agent not found." },
			}),
		],
		[
			"a hub that is not answering",
			publicationErrorFromBody(503, {
				detail: { code: "hub_unavailable", message: "unreachable" },
			}),
		],
		[
			"a code this client has no treatment for",
			publicationErrorFromBody(400, {
				detail: {
					code: "invalid_instruction_set",
					message: "The reviewer refused these instructions.",
				},
			}),
		],
		[
			"a name the hub already holds",
			publicationErrorFromBody(409, {
				detail: { code: "name_taken", message: "That name is taken." },
			}),
		],
		[
			"an older backend's single prose refusal",
			new DesktopControlError(
				400,
				"Error downloading agent from Radient: Failed to download agent hub-1f4c9a " +
					"from Radient Agent Hub due to a requests error: HTTPSConnectionPool(host='api.radienthq.com', port=443): Read timed out.",
			),
		],
	];
	for (const [what, error] of refusals) {
		const sentence = agentActionFailureMessage(
			"download",
			error,
			"Inbox triage",
		);
		assert.equal(
			sentence,
			pullRefusalMessage(error, "Inbox triage"),
			`${what}: the pull speaks the hub's vocabulary`,
		);
		assert.notEqual(
			sentence,
			localSentence(error),
			`${what}: and never the local server's, which answers about another process`,
		);
	}
	/*
	 * The other three actions on those two surfaces ARE local-server calls and keep
	 * the classifier that names their remedy, so the split follows the process that
	 * answers rather than the shape the failure arrived in.
	 */
	for (const action of ["like", "favourite", "delist"]) {
		const error = new Error("the local server did not answer");
		assert.equal(
			agentActionFailureMessage(action, error, "Inbox triage"),
			localSentence(error),
			`${action} is answered by the local server`,
		);
	}
});

/*
 * AND THE THREE SURFACES ACTUALLY ASK IT (review round 2, R1).
 *
 * A rule with no caller restores the D1 defect exactly: the card, the details
 * page and the onboarding batch are what render the refusal under the control
 * that failed, and reverting any one of their three lines left the test above
 * green. There is no frame that can catch it either, because the local
 * classifier's answer is itself a plausible sentence - it is the WRONG one, not
 * a broken one. So the wiring is pinned where it lives, the shape
 * `agent-hub-queries.test.mjs` uses for the card's viewer state.
 */
test("every surface that can refuse an action asks the rule, not the local classifier", () => {
	const card =
		"src/renderer/src/features/agent-hub/components/agent-card-container.tsx";
	for (const [what, path, anchor] of [
		["the hub card", card, /agentActionFailureMessage\(/],
		[
			"the agent details page",
			"src/renderer/src/features/agent-hub/agent-details-page.tsx",
			/agentActionFailureMessage\(/,
		],
		[
			"the onboarding batch",
			"src/renderer/src/features/onboarding/components/steps/create-agent-step.tsx",
			/pullRefusalMessage\(/,
		],
	]) {
		assert.match(
			read(path),
			anchor,
			`${what} renders the refusal it was given`,
		);
	}
	/*
	 * The card has no load arm of its own, so the local classifier has no business
	 * in that file at all - the sharpest form this anchor can take, and the
	 * assertion that fails if the D1 defect is reintroduced here.
	 */
	assert.doesNotMatch(
		read(card),
		/backendLoadErrorMessage\(/,
		"the card never classifies a refusal against the local server",
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
			document: { name: "code/reviewer" },
		},
		{
			op: "agent.publish",
			agentId: "agent123",
			document: { name: "coder." },
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

	/*
	 * ...and the other direction, which is the defect this pair exists for: a name
	 * the HUB accepts must be sendable. An ordinary space is not a rule the hub has
	 * — it is relaxing a whitespace ban its own marketplace has outgrown — so a
	 * renderer refusing one is a client bound stricter than the server, which is a
	 * bug report. The two cases below are the same name the old local rule refused.
	 */
	for (const ok of ["code reviewer", "code\u00a0reviewer"])
		assert.equal(
			desktopRequestSchema.safeParse({
				op: "agent.publish",
				agentId: "agent123",
				document: { name: ok },
			}).success,
			true,
			`${JSON.stringify(ok)} is a name the hub accepts, so it must be sendable`,
		);
});
