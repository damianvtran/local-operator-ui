import { z } from "zod";
// The feed's frame family lives beside the session stream's, so the two cannot
// drift into disagreeing about the envelope they deliberately share.
import type { DesktopFeedFrame } from "./desktop-session-contract";

const id = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);
const settingKey = z
	.string()
	.min(1)
	.max(256)
	.regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/);
const secret = z.string().min(1).max(32768);
/**
 * The canonical stream session id, as the wire spells it.
 *
 * Exported beside the schema so a client that holds a session KEY rather than
 * a session id (a draft pane's "draft:<uuid>") can tell the two apart before
 * composing a request — a second copy of the regex at the call site is where
 * the two answers would drift (PR #726, QA Q-1).
 */
export const sessionIdPattern = /^[a-f0-9]{12}$/;
const sessionId = z.string().regex(sessionIdPattern);
/*
 * The folder a SESSIONLESS skills read is discovered from.
 *
 * NOT `mcpCatalogCwd`'s absolute-only regex: a draft pane's staged default is
 * the literal `"~"`, which the route resolves against the daemon's home
 * (`resolve_cwd`), and the acceptance here is the same `min(1).max(4096)` the
 * session routes use for a `cwd` the folder chip can produce. Refusing `"~"`
 * at the transport would refuse the one value every new draft starts from, and
 * the route still enforces absolute-and-existing AFTER expansion (422
 * `invalid_cwd`) — the check belongs at the end that can actually resolve it.
 */
const skillCwd = z.string().min(1).max(4096);
/*
 * The MCP field shapes, named once because the session route and the
 * sessionless catalog route accept the same server names, secret references and
 * operation ids - two inline copies of a regex are two places to drift.
 */
const mcpServerName = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);
const mcpSecretReference = z.string().regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/);
const mcpOperationId = z.string().regex(/^[a-f0-9]{32}$/);
/**
 * An absolute POSIX or Windows directory path; the backend checks it exists.
 *
 * Exported because a CLIENT sometimes holds a value that is not what it
 * appears: the composer's own `cwd` is the pane's DISPLAY string ("~" for
 * home) and its draft panes key their session as "draft:<uuid>". Sent raw,
 * both are refused by the schemas here BEFORE any byte reaches the backend, so
 * the sessionless MCP read died as a 422 and the composer's `/mcp` list
 * rendered empty (PR #726, QA Q-1) — the read performed fine everywhere a
 * fixture stood in for the transport. `mcp-catalog.ts` coerces with these two
 * patterns; the schemas below stay the one enforcement point, and the bound
 * mirror is there so a coerced value cannot fail a term the pattern does not
 * check.
 */
export const mcpCatalogCwdPattern = /^(\/|[A-Za-z]:[\\/])/;
const mcpCatalogCwd = z.string().min(1).max(4096).regex(mcpCatalogCwdPattern);
/**
 * The wire shape of a canonical stream subscription id.
 *
 * Exported because three parties have to agree on it and only one of them can
 * see the schema below: this request schema, the renderer's watch lease, and
 * main's `desktop-watch-heartbeat` handler - which is the last gate before an
 * authenticated POST and the only one Electron actually passes through.
 *
 * They disagreed. The renderer's lease tested its id for truthiness and main
 * tested it for `typeof === "string"`, so an empty `subscription_id` reached
 * `POST /v1/desktop/sessions/{id}/watch` and the backend answered 422 (its own
 * `Watch.subscription_id` is `Field(pattern=r"^[a-f0-9]{32}$")`). A lease for
 * a subscription that does not exist is not a lease, so the shape is checked
 * at every hop instead of being assumed from the id's presence.
 */
export const SUBSCRIPTION_ID_PATTERN = /^[a-f0-9]{32}$/;
const requestId = z
	.string()
	.regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
/**
 * A mesh device or network id (`d_`/`n_` + hex today), on its way into a URL path.
 *
 * MIRRORS `MESH_ID_PATTERN` in `local_operator/server/models/desktop_mesh.py`, and
 * the property being mirrored is PATH-SAFETY rather than the exact shape: every
 * one of these reaches a route path, so what must be impossible is `/`, `.` and
 * `%` — which is also why the endpoint builder still `encodeURIComponent`s it. The
 * pattern is deliberately wider than today's ids so the transport may evolve its
 * ids without a renderer release, and narrow enough that a client bug (an empty
 * string, a sentence, a path fragment) is refused HERE, by name, rather than by
 * the daemon's generic 422.
 */
const meshId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/**
 * An onboarding approval's id (`ap_` + Crockford base32), on its way into a URL path.
 *
 * MIRRORS the mint in `local_operator/network/approvals.py` (`new_approval_id`:
 * `ap_` + `crockford(8 bytes)`, thirteen characters today) and follows `meshId`'s
 * discipline for the same reason: the id reaches a ROUTE PATH (and the store's own
 * record filename), so what must be impossible is `/`, `.` and `%` — which is why
 * the endpoint builder still `encodeURIComponent`s it. The pattern is deliberately
 * wider than today's mint (length, not alphabet) so the store may mint longer ids
 * without a renderer release, while an empty string, a sentence or a path fragment
 * is refused HERE, by name, rather than by the daemon's generic 422.
 */
const approvalId = z.string().regex(/^ap_[0-9a-hjkmnp-tv-z]{1,64}$/);
const sessionImage = z
	.object({
		data_b64: z.string().min(1).max(1_000_000),
		mime_type: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
	})
	.strict();

/**
 * Longest `text`/`args` a message-carrying op accepts, in JS CHARACTERS.
 *
 * Named and exported rather than repeated as a literal because it is a SECOND,
 * independent ceiling beside the byte budget, and the renderer's pre-flight has
 * to weigh both. A 400,000-character paste is only ~400 KB - comfortably inside
 * the 880,000-byte budget - so the pre-flight admitted it and the schema parse
 * in `requestDesktop` then rejected it with "Invalid desktop operation.", which
 * tells a user who pasted a long document nothing they can act on (review round
 * 1, Q-2). Characters, not bytes: `z.string().max()` counts UTF-16 code units,
 * so the two ceilings bind on different inputs and neither implies the other.
 */
export const DESKTOP_MESSAGE_MAX_CHARS = 200_000;

/**
 * Most images one message-carrying op carries, in IMAGES.
 *
 * Named and exported rather than repeated as a literal because the renderer
 * has to agree with it: `encodeImageAttachments` applies the cap to every
 * send it encodes, and a draft that staged more images than this used to be
 * sliced to the ceiling SILENTLY - a send left with fewer images than the
 * composer showed and nothing named the difference (design round 1 on issue
 * #790, D1). The encoder now reports the excess (`overflow`) and the sends
 * refuse before admission with `imageOverflowRefusal`'s sentence; both
 * schemas below are the wire end of the same number.
 */
export const DESKTOP_MESSAGE_MAX_IMAGES = 8;

/**
 * Longest chat-search query the desktop search op accepts, in CHARACTERS.
 *
 * The backend bounds `q` at the same number (`routes/desktop_sessions.py`),
 * and the renderer's input cannot exceed it by typing — but a paste can, and a
 * query is a sentence a user typed rather than data to be stored, so the bound
 * belongs at both ends: here so the refusal names the field, there so a
 * hand-rolled request cannot project an unbounded string into every digest
 * comparison in the store.
 *
 * The sidebar is the consumer that makes "refused by name" true of a USER's
 * surface rather than only of the schema: the schema's refusal is the
 * transport's generic 422, which names neither field nor length, and the one
 * branch that rendered it offered a Retry that re-sent the same characters
 * forever (QA round 1, Q1). `searchQueryExceedsLimit` reads this constant, and
 * the notice it drives names the number — so the bound is stated in one place
 * and the copy cannot drift from it.
 */
export const SESSION_SEARCH_MAX_CHARS = 256;

/**
 * How many search hits one query may return.
 *
 * A page-sized cap, not the scan's: the search still looks at every session
 * (`session_search.search_store` documents why a scan cap makes a session
 * unfindable), and this only bounds the ANSWER. A sidebar renders a screenful,
 * and a ranked list whose tail nobody can see is the same list as a shorter
 * one.
 */
export const SESSION_SEARCH_DEFAULT_LIMIT = 100;

/**
 * How many checkpoint ids one `sessions.checkpoints.warm` call may carry.
 *
 * The op is a user-gesture-driven spend (one model call per turn named), so
 * the wire bound and the client's own slice read the same number: the hover
 * arm sends one id, the rail-open arm sends none and lets the backend select
 * its own default, and a caller that ever sends a set is clamped here rather
 * than refused by the schema for a count it computed itself.
 */
export const CHECKPOINT_WARM_MAX_IDS = 16;

/**
 * Longest in-thread find query the `sessions.find` op accepts, in CHARACTERS.
 *
 * The backend bounds `q` at the same number (`routes/desktop_sessions.py`),
 * and it matches `SESSION_SEARCH_MAX_CHARS` because both are "a sentence a user
 * typed": the overlay's input carries `maxLength` at this number, so a paste
 * cannot exceed it either, and the schema refuses an over-long query BY NAME
 * rather than projecting it into every doc comparison of the session's index.
 */
export const THREAD_FIND_MAX_CHARS = 256;

/**
 * How many in-thread hits one find may return.
 *
 * The backend's own route default (`limit: int = Query(default=100, ge=1,
 * le=200)`), sent explicitly by the client so the request the app makes does
 * not depend on a route default that could move: find is a navigation surface,
 * not an export, and the panel renders a screenful at a time.
 */
export const THREAD_FIND_DEFAULT_LIMIT = 100;

/**
 * The route's ceiling, mirrored so a client cannot compute its own refusal:
 * `sessions.find` refuses `limit > 200` here rather than letting the backend's
 * generic "invalid fields" 422 answer a request this app built itself.
 */
export const THREAD_FIND_MAX_LIMIT = 200;

/**
 * Longest `systemPrompt` the agent system-prompt op accepts, in JS CHARACTERS.
 *
 * Declared here beside `DESKTOP_MESSAGE_MAX_CHARS` and referenced by the schema
 * below rather than repeated as a literal, because the editor now pre-flights
 * against it: a cap the check and the schema state separately is a cap they can
 * state differently, which is the drift this file exists to prevent.
 */
export const DESKTOP_SYSTEM_PROMPT_MAX_CHARS = 1_000_000;
const profileName = z
	.string()
	.min(1)
	.max(128)
	.refine(
		(name) =>
			name !== "." &&
			name !== ".." &&
			!name.includes("/") &&
			!name.includes("\\") &&
			[...name].every(
				(character) =>
					character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
			),
	);
const target = z
	.object({ kind: z.enum(["agent", "team"]), name: profileName })
	.strict();
/**
 * The model a NEW conversation will be born on, picked on the draft pane.
 *
 * Deliberately the same three fields, in the same spelling, that the canonical
 * frontend state publishes for a session's model (`CanonicalModel` in
 * `desktop-session-contract.ts`): the draft's chips and the session's chips are
 * two readings of one fact, and a second spelling here would be the place the
 * two came to disagree. `reasoning_effort` is `null` for "no rung chosen",
 * which the backend resolves to the model's own default exactly as `/effort
 * auto` does — never `"auto"`, which is a word the picker uses for a state
 * rather than a level the model could be set to.
 *
 * Bounds mirror the rest of this contract's id-shaped fields: they exist to
 * keep a malformed request off the wire, not to encode a catalogue.
 */
const modelSelection = z
	.object({
		provider: z.string().min(1).max(128),
		model_id: z.string().min(1).max(512),
		reasoning_effort: z.string().min(1).max(64).nullable(),
	})
	.strict();
/** What a draft pane's chips record, and what the wire carries. */
export type DesktopModelSelection = z.infer<typeof modelSelection>;
const profileFields = z
	.object({
		kind: z.enum(["role", "specialist"]).optional(),
		description: z.string().max(8000).optional(),
		instructions: z.string().max(8000).optional(),
		tools: z.array(z.string().min(1).max(128)).max(256).optional(),
		effort: z.string().max(64).optional(),
		delegate: z.boolean().optional(),
		/*
		 * The action class (`reactive` | `proactive`), the field the Class control
		 * writes. An ENUM rather than a free string, because the route takes a
		 * `Literal` and a spelling this schema let through would be a 422 the
		 * caller could not tell from a bug — the same reasoning `scheduleUnit`
		 * above states. Optional like every other field here: an omitted key means
		 * "leave the class alone" on an update, which is what lets the control send
		 * the class and nothing else.
		 */
		action_class: z.enum(["reactive", "proactive"]).optional(),
	})
	.strict();
const teamFields = z
	.object({
		name: z.string().min(1).max(64).optional(),
		description: z.string().max(8000).optional(),
		manager: profileName.optional(),
		members: z
			.array(
				z
					.object({
						role: profileName,
						count: z.number().int().min(1).max(16),
						kind: z.enum(["agent", "team"]),
					})
					.strict(),
			)
			.max(128)
			.optional(),
		instructions: z.string().max(8000).optional(),
		project: z.string().max(8000).optional(),
	})
	.strict();
const chains = z.record(z.array(z.string().max(1024)).max(100));
// Mirrors ScheduleUnit in the renderer's api/local-operator/types.ts and the
// backend's ScheduleUnit enum. Enumerated rather than free text so the value
// cannot become a path or query fragment on its way to the server.
const scheduleUnit = z.enum(["minutes", "hours", "days"]);

/**
 * Whether a code-memory key addresses the route it is built into.
 *
 * The denylist above refuses the separators, the control characters and NUL -
 * the characters that would let a key name a route segment of its own. This is
 * the one shape that survives that rule and STILL does not address what it looks
 * like it addresses: the transport fetches `new URL(target.path, backendUrl)`, so
 * `..` and `.` are resolved away by the URL parser before the request leaves, and
 * a PATCH built for the name `..` reaches the collection instead. A namespace
 * may legally hold such a name (`globals()[".."] = 1` is ordinary memory, which
 * is why this is a denylist at all), so the rule has to live here rather than in
 * the backend's naming policy.
 *
 * Nothing is exploitable while no route lives at the resolved path; what this
 * protects is the invariant the surrounding comment claims - a key addresses a
 * route this op was given - so the next route added under `/variables/` does not
 * inherit the reach. Exported because the panel asks the same question before it
 * offers an Edit: `editable` is the backend's answer about the VALUE, and it
 * cannot answer this (review round 1, C-03).
 */
export function isAddressableVariableKey(key: string): boolean {
	return !/^\.+$/.test(key);
}

/**
 * Whether this renderer's contract would let a write for `key` leave at all.
 *
 * The schema, asked directly, rather than a second copy of its rules. The panel
 * needs this because `editable` is the BACKEND's judgement about the VALUE -
 * could this text be coerced back into that type - and it says nothing about
 * whether this renderer's own contract would accept the name: a key that is
 * empty, longer than 128 characters, or carrying a control character is
 * advertised as editable and then rejected by `desktopRequestSchema` before any
 * request is built, which surfaces as "Invalid desktop operation." - a refusal
 * the user cannot act on and cannot tell apart from a bug (backend PR #1101's
 * MINOR-1). Asking the schema keeps the panel's offer and the write path's rule
 * from drifting apart.
 */
export const isWritableVariableKey = (key: string): boolean =>
	variableKey.safeParse(key).success;
/**
 * A session code-memory key.
 *
 * A key is a NAME in the session's eval namespace, and the worker reads it as a
 * dict key rather than interpolating it into code, so a name that is not a
 * Python identifier (`globals()["a b"] = 1`) is legal memory and has to stay
 * addressable from the panel that lists it. That is why this is a denylist and
 * not the identifier regex the legacy agent-variable ops used: the renderer
 * must refuse exactly the characters that would let it address a route it was
 * never given an operation for - the slash and backslash that separate route
 * segments, the control characters and NUL no route can carry, and (below) the
 * dot-only names `new URL()` would normalise out of the path. The
 * backend applies the same rule plus its reserved-name list, which is the half
 * that needs the namespace to answer.
 */
const variableKey = z
	.string()
	.min(1)
	.max(128)
	.refine((key) =>
		[...key].every(
			(character) =>
				character.charCodeAt(0) >= 32 &&
				character.charCodeAt(0) !== 127 &&
				character !== "/" &&
				character !== "\\",
		),
	)
	.refine(isAddressableVariableKey);
/**
 * The writable code-memory types, as one table.
 *
 * Enumerated rather than free text so a typo is refused before it reaches the
 * worker, and identical to the six names the worker's coercion table and the
 * form's own select offer (see `VARIABLE_TYPES` in `session-variables-api.ts`).
 * `str` is not `string`, and the form used to send `string` while the worker's
 * table had no such row - the drift this freeze exists to end.
 */
const variableType = z.enum(["str", "int", "float", "bool", "list", "dict"]);
/**
 * A value crossing as TEXT, plus the type it should be coerced to.
 *
 * The worker builds the object from its own table; nothing the renderer sends
 * is ever evaluated as code. 16 KiB is a transport bound only: the contract's
 * real ceiling is the backend's 409 `too_large` at 4096 rendered characters,
 * and pre-empting it here would answer "Invalid desktop operation." where the
 * route would have named the limit.
 */
const variableValue = z.string().max(16384);
// The fields create and edit have in common. Both extend it with their own
// required/nullable variants of prompt, interval and unit, which differ because
// create supplies defaults and edit sends only what changed.
/**
 * One wake's prompt, at the backend's own ceiling.
 *
 * `MAX_WAKE_MESSAGE_CHARS = 2_000` (`local_operator/harness/wake.py`) is
 * enforced in the one validated constructor (`build_wake_schedule`), so this
 * bound is the same number stated where a caller can be refused by name
 * instead of by a 422 the user cannot act on.
 */
/**
 * The prompt's ceiling, EXPORTED because a second reader needs the number.
 *
 * The create dialog states this bound inline ("This prompt is 3,120 characters,
 * and a wake holds at most 2,000") rather than letting the main process refuse
 * the request with its generic "Invalid desktop operation." - which is the one
 * refusal in this family a user could neither read nor act on. One number, two
 * readers, no second copy to drift.
 */
export const WAKE_MESSAGE_MAX_CHARS = 2_000;

const wakeMessage = z.string().min(1).max(WAKE_MESSAGE_MAX_CHARS);
/**
 * A wake's per-session handle, `w1`..`w16`.
 *
 * Deliberately not a regex. The ids are CREATION-ORDERED and minted by the
 * scheduler, and the sixteen ceiling is enforced by the agent-tool path rather
 * than by every writer (`lop wake create` writes past it), so a pattern here
 * would refuse a cancel for a row the listing just sent - a control that is
 * drawn and cannot be pressed. The shape that matters is "an opaque token the
 * backend minted", and that is what is checked.
 */
const wakeId = z.string().min(1).max(64);

/**
 * A monitor's per-session handle, `m1`..`m8` on the wire (`^m\d{1,4}$`).
 *
 * Lenient for the wakeId's own reason, and it matters more here: the run pane
 * renders the handle the SESSION minted (`frontend.monitors[].id`), so a pattern
 * a drawn row could fail would be a control that is drawn and cannot be pressed.
 * The route declares `^m\d{1,4}$` as its path pattern and refuses a malformed
 * handle with a 422 before any handler runs, which is where the shape belongs.
 */
const monitorId = z.string().min(1).max(64);

const scheduleWrite = z
	.object({
		is_active: z.boolean().nullish(),
		one_time: z.boolean().nullish(),
		start_time_utc: z.string().max(64).nullish(),
		end_time_utc: z.string().max(64).nullish(),
	})
	.strict();
const configUpdate = z
	.object({
		conversation_length: z.number().int().optional(),
		detail_length: z.number().int().optional(),
		max_learnings_history: z.number().int().optional(),
		hosting: z.string().max(256).optional(),
		model_name: z.string().max(1024).optional(),
		auto_save_conversation: z.boolean().optional(),
	})
	.strict();

/*
 * Instruction-set publication (agent-hub contract §1.3/§1.4/§1.5/§3.1).
 *
 * An agent is primarily its instruction set, so the unit of publication is a
 * DOCUMENT and not an archive: `POST`/`PUT /v1/agents/{id}/publish` carry the
 * content fields below, and the local backend fills in the ones it owns (the
 * instruction body lives in the agent's `system_prompt.md`) while the renderer
 * overrides only what the dialog actually edits. That is why there is no
 * `model`, no `hosting` and no `current_working_directory` in this vocabulary:
 * nothing outside a content field has a shape to travel in.
 *
 * The bounds and the rule SENTENCES below mirror the hub's validator — the same
 * numbers and the same words as `local_operator/clients/radient.py`'s
 * `_name_rule` and `build_instruction_set_document` — for two reasons the brief
 * calls out. A client bound stricter than the server's is a bug report (it
 * refuses a document the hub would have accepted, with no way for the author to
 * tell which side refused), and a client that explains one rule in its own words
 * puts two sentences in front of the user for the same refusal. So the schema
 * below REFINES ON these functions rather than restating their rules: what this
 * renderer would send and what it would refuse cannot disagree with the field
 * sentence the publish dialog renders.
 *
 * ONE RULE IS DELEGATED RATHER THAN MIRRORED, and it is named here so nobody
 * reads the claim above as covering it: the hub bans no whitespace in a
 * published name, because it is mid-relaxation on exactly that rule. See
 * `publicationNameRule`.
 */

/** 128 after `trim`, the same bound the desktop profiles route already uses. */
export const PUBLICATION_NAME_MAX_CHARS = 128;
export const PUBLICATION_DESCRIPTION_MAX_CHARS = 2000;
export const PUBLICATION_INSTRUCTIONS_MAX_CHARS = 8000;
export const PUBLICATION_TOOL_MAX_CHARS = 64;
export const PUBLICATION_TOOLS_MAX_ITEMS = 64;

/**
 * Length in CODE POINTS, the unit every cap here counts.
 *
 * Not `String.prototype.length`, which counts UTF-16 units: an instruction body
 * of 8000 emoji is 8000 characters to the hub and 16,000 to a naive check, so
 * counting units would refuse at half the ceiling the server enforces — the
 * client-stricter-than-the-server direction the contract forbids.
 */
const publicationCharCount = (value: string): number => [...value].length;

/*
 * The character classes a name is checked against, written as predicates over
 * CODE POINTS rather than as character-class literals.
 *
 * Two reasons, and the second is why this is the form rather than a taste.
 * These sets are statements about code points — "a name may not contain a
 * control character" is a claim about the character, not about the byte — so
 * the code says code points. And a class literal has to CONTAIN the characters
 * it refuses, which this repository's linter rejects
 * (`lint/suspicious/noControlCharactersInRegex`) for exactly this kind of rule;
 * the same reasoning is recorded at `src/main/window-mode.ts`'s `breaksALine`.
 */

/**
 * Python's `str.isspace()`: the White_Space property, plus `U+001C`-`U+001F`.
 *
 * Those four are not White_Space and Python's `isspace()` says they are, which
 * is why this is a set rather than a property lookup.
 *
 * It is used for `strip`, for the collapse `name_key` folds with, and for
 * nothing else — NOT for the name rule, because the hub deliberately bans no
 * whitespace in a published name (see `publicationNameRule`). The whitespace the
 * rule does refuse is the narrower set below.
 *
 * `U+FEFF` is deliberately absent here too, for a different reason: JavaScript's
 * `\s` matches it and Python's `isspace()` does not, so trimming it would take a
 * character off a name the hub keeps.
 */
const isPublicationWhiteSpace = (point: number): boolean =>
	(point >= 0x09 && point <= 0x0d) ||
	(point >= 0x1c && point <= 0x20) ||
	point === 0x85 ||
	point === 0xa0 ||
	point === 0x1680 ||
	(point >= 0x2000 && point <= 0x200a) ||
	point === 0x2028 ||
	point === 0x2029 ||
	point === 0x202f ||
	point === 0x205f ||
	point === 0x3000;

/**
 * The whitespace that is ALSO a control character: the transport's
 * `_CONTROL_WHITESPACE` (`local_operator/clients/radient.py`), which is one notch
 * stricter than the hub's own validator.
 *
 * The one whitespace refusal the mirror keeps, and the reason the rule cannot
 * simply drop its whitespace arm: no legitimate name contains a tab, a vertical
 * tab, a form feed, a line control or NEL, and the transport reports those as
 * whitespace rather than as control characters — so dropping the check would put
 * a different `details.rule` on the same input than the side that refuses it.
 *
 * Spelled out rather than written as an intersection with the set above, because
 * Python's `str.isspace()` additionally calls `U+001C`-`U+001F` whitespace while
 * the hub's own list reports those as control characters, and a client that
 * disagrees with the hub about WHICH rule a name broke is what this mirror
 * exists to prevent.
 */
const isPublicationControlWhitespace = (point: number): boolean =>
	point === 0x09 ||
	point === 0x0a ||
	point === 0x0b ||
	point === 0x0c ||
	point === 0x0d ||
	point === 0x85;

/** Python's `unicodedata.category(c) == "Cc"`, which is what the hub checks. */
const isPublicationControl = (point: number): boolean =>
	point <= 0x1f || (point >= 0x7f && point <= 0x9f);

/**
 * Python's `unicodedata.category(c) == "Cf"` — the format characters.
 *
 * A property escape rather than a range set like the three beside it, because
 * `Cf` is a live category — `U+13430`-`U+1343F` and the tag characters arrived
 * in recent Unicode versions — and a hand-copied range list is how a mirror
 * drifts from the tables it claims to be. `\p{Cf}` IS the category, so it moves
 * with the engine's.
 *
 * The class is not decoration: a format character renders as nothing, so
 * `reviewer` with a U+200B in it and `reviewer` draw identically while being two
 * different keys — the shadowing an exact local name lookup cannot see.
 */
const isPublicationFormat = (point: number): boolean =>
	/\p{Cf}/u.test(String.fromCodePoint(point));

/** The bidi overrides a rendered name would use to differ from its bytes. */
const isPublicationBidiOverride = (point: number): boolean =>
	(point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069);

/** Whether any code point of `value` satisfies `predicate`. */
const publicationHasCodePoint = (
	value: string,
	predicate: (point: number) => boolean,
): boolean => {
	for (const character of value) {
		if (predicate(character.codePointAt(0) ?? 0)) return true;
	}
	return false;
};

/**
 * Python's `str.strip()`, over the set above.
 *
 * Not `String.prototype.trim()`, which strips the ECMAScript WhiteSpace set:
 * the four `U+001C`-`U+001F` characters the set above includes are exactly the
 * ones JS leaves alone, so a name trailing one of them would be trimmed by the
 * hub and not here — two different names out of one string.
 */
const publicationTrim = (value: string): string => {
	const characters = [...value];
	let start = 0;
	let end = characters.length;
	while (
		start < end &&
		isPublicationWhiteSpace(characters[start].codePointAt(0) ?? 0)
	)
		start++;
	while (
		end > start &&
		isPublicationWhiteSpace(characters[end - 1].codePointAt(0) ?? 0)
	)
		end--;
	return characters.slice(start, end).join("");
};

/** Every run of the whitespace set collapsed to a single `U+0020` (contract §3.1). */
const publicationCollapseWhiteSpace = (value: string): string => {
	let result = "";
	let pendingSeparation = false;
	for (const character of value) {
		if (isPublicationWhiteSpace(character.codePointAt(0) ?? 0)) {
			pendingSeparation = result.length > 0;
			continue;
		}
		if (pendingSeparation) {
			result += " ";
			pendingSeparation = false;
		}
		result += character;
	}
	return result;
};

/**
 * The rule a published NAME breaks, or `null` when it is publishable.
 *
 * Rule text included, because it is what the dialog shows and what the hub's
 * `details.rule` carries — one sentence whichever side refused — and in the
 * HUB'S ORDER, because the order decides which sentence a name that breaks two
 * rules gets: `code\u202ere viewer` is a bidi override first and a space second,
 * and a client that reported the other one would send its author looking for a
 * character that is not the problem.
 *
 * THE WHITESPACE BAN IS DELIBERATELY ABSENT, and this is the one place the
 * function is not a mirror. The transport is mid-relaxation on exactly that
 * rule: the live marketplace is already spelled with ordinary spaces, so
 * agent-server's rule is moving to "collapse every run of Unicode whitespace to
 * one U+0020 and trim the ends". A client cannot mirror a rule that is moving —
 * refusing an ordinary space here would refuse a name the other side accepts, and
 * only after the change would the same release behave differently against two
 * versions. So whitespace that is not a control character travels as the author
 * wrote it and the far side decides. Until that relaxation lands, a space is
 * refused by the LOCAL write path (`local_operator`'s `write_profile`), not by the
 * hub's own `ValidateAgentName` — a distinction worth keeping straight, because a
 * reader who assigns the refusal to the hub draws the wrong conclusion about
 * which side has to change. `name_key` still folds whitespace, so the local
 * duplicate and reservation checks keep asking the hub's own question.
 *
 * The sentences and the order are `local_operator/clients/radient.py`'s
 * `_name_rule`, which is the function to keep this in step with.
 */
export function publicationNameRule(name: string): string | null {
	const trimmed = publicationTrim(name);
	if (!trimmed) return "must not be empty";
	if (publicationCharCount(trimmed) > PUBLICATION_NAME_MAX_CHARS)
		return `must be at most ${PUBLICATION_NAME_MAX_CHARS} characters`;
	if (/[/\\:]/.test(trimmed)) return 'must not contain "/", "\\" or ":"';
	if (publicationHasCodePoint(trimmed, isPublicationBidiOverride))
		return "must not contain Unicode bidirectional override characters";
	if (publicationHasCodePoint(trimmed, isPublicationControlWhitespace))
		return "must not contain whitespace";
	if (publicationHasCodePoint(trimmed, isPublicationControl))
		return "must not contain control characters";
	if (publicationHasCodePoint(trimmed, isPublicationFormat))
		return "must not contain invisible Unicode formatting characters";
	const characters = [...trimmed];
	if (
		"-.".includes(characters[0]) ||
		"-.".includes(characters[characters.length - 1])
	)
		return 'must not begin or end with "-" or "."';
	return null;
}

/**
 * The hub's `name_key`: `normalize(lowercase(NFKC(trim(name))))`.
 *
 * The identity a name is unique BY (contract §3.1) and not the name itself — the
 * stored name keeps the author's case. The publish dialog asks this of a name
 * the user is about to claim, and the pull path asks it of a name it is about to
 * land beside, so both use it from here rather than each normalising its own
 * way: two normalisations in one app is how a duplicate check passes where the
 * resolver then picks one row arbitrarily.
 *
 * Known divergence, recorded rather than hidden: `toLowerCase()` is the JS
 * case mapping, which differs from Go's `strings.ToLower` for a handful of
 * characters (Turkish dotted I, Cherokee). A name that differs only in one of
 * those is refused by the hub as taken and reported as available here — the
 * safer of the two directions, since the server's answer is the one that
 * decides and the dialog's check is a courtesy.
 */
export function publicationNameKey(name: string): string {
	return publicationCollapseWhiteSpace(
		publicationTrim(name).normalize("NFKC").toLowerCase(),
	);
}

/** The rule a publication description breaks, or `null` (1..2000 characters). */
export function publicationDescriptionRule(description: string): string | null {
	if (!description.trim()) return "must not be empty";
	if (publicationCharCount(description) > PUBLICATION_DESCRIPTION_MAX_CHARS)
		return `must be at most ${PUBLICATION_DESCRIPTION_MAX_CHARS} characters`;
	return null;
}

/** The rule an instruction body breaks, or `null` (1..8000 characters). */
export function publicationInstructionsRule(
	instructions: string,
): string | null {
	if (!instructions.trim()) return "must not be empty";
	if (publicationCharCount(instructions) > PUBLICATION_INSTRUCTIONS_MAX_CHARS)
		return `must be at most ${PUBLICATION_INSTRUCTIONS_MAX_CHARS} characters`;
	return null;
}

/** The rule a tool list breaks, or `null` (<=64 items of 1..64 characters). */
export function publicationToolsRule(tools: readonly string[]): string | null {
	if (tools.length > PUBLICATION_TOOLS_MAX_ITEMS)
		return `must hold at most ${PUBLICATION_TOOLS_MAX_ITEMS} items`;
	for (const tool of tools) {
		if (!tool.trim() || publicationCharCount(tool) > PUBLICATION_TOOL_MAX_CHARS)
			return `must hold items of 1 to ${PUBLICATION_TOOL_MAX_CHARS} characters`;
	}
	return null;
}

/** Whether this renderer's contract would let a publish for `name` leave at all. */
export const isPublishableName = (name: string): boolean =>
	publicationNameRule(name) === null;

/**
 * A publishable name, asked of the rule above rather than restated.
 *
 * A name the schema refuses never reaches the backend, so the dialog checks it
 * first and says which rule broke: the schema's own refusal is "Invalid desktop
 * operation.", which names neither field nor rule and cannot be told apart from
 * a bug.
 */
const publicationName = z.string().refine(isPublishableName, {
	message: "That is not a name the hub can publish.",
});

const publicationInstructions = z
	.string()
	.refine(
		(instructions) => publicationInstructionsRule(instructions) === null,
		{ message: "That instruction body cannot be published." },
	);

const publicationDescription = z
	.string()
	.refine((description) => publicationDescriptionRule(description) === null, {
		message: "That description cannot be published.",
	});

const publicationTools = z
	.array(z.string())
	.refine((tools) => publicationToolsRule(tools) === null, {
		message: "That tool list cannot be published.",
	});

/**
 * The fields a renderer may override, which are exactly a version-1 document's
 * CONTENT fields.
 *
 * `document_type`/`document_version` are absent on purpose: they are
 * client-owned and the hub refuses an override of either, so a schema that
 * admitted them would let the renderer send a value the server must reject.
 * Every field is optional because an override is a partial: a field the dialog
 * does not edit is read from the local agent row, which is where the instruction
 * body actually lives. A field this renderer does not send is a field whose
 * local value is the one the author wrote.
 */
const publicationDocument = z
	.object({
		name: publicationName,
		description: publicationDescription,
		instructions: publicationInstructions,
		kind: z.enum(["role", "specialist"]),
		when_to_use: z.string(),
		tools: publicationTools,
		effort: z.string(),
		delegate: z.boolean(),
		version: z.string(),
		categories: z.array(z.string()),
		tags: z.array(z.string()),
	})
	.partial()
	.strict();

// This vocabulary is the security boundary, not a generic authenticated fetch.
// The renderer selects an operation; it never supplies a URL, method or headers.

/**
 * The two axes a catalogue request may be scoped to.
 *
 * A CLOSED VOCABULARY, and `team`/`agent` are the renderer's own two group kinds
 * rather than the daemon's binding field names: the group predicate is
 * `binding.team === name` for a team and `!binding.team && binding.agent === name`
 * for an agent, and the `!team` half is load-bearing (a team-attached session
 * that also carries an agent name belongs to the team's group, never the agent's).
 * Spelling the kinds here is what keeps a client from asking for a third axis
 * the daemon would have to refuse by hand.
 */
const catalogueScopeKind = z.enum(["team", "agent"]);
/**
 * A scope's display name, as `attachment.json` recorded it.
 *
 * BOUNDED AT 64, the bound the profile and team registries already use for a
 * name, so an over-long value is refused HERE by name rather than arriving as the
 * backend's generic "invalid fields" 422. It is deliberately NOT validated
 * against a registry: an operator renames and deletes teams, and their sessions
 * keep the old name (`read_session_attachment`'s docstring in the daemon is
 * explicit that the stored name is a historical fact), so a scope naming a team
 * that no longer exists is a legitimate empty page rather than a refusal.
 */
const catalogueScopeName = z.string().min(1).max(64);
/**
 * An opaque position, echoed back from a previous answer's `next_cursor`.
 *
 * Opaque to this client on purpose: it encodes the rank tuple the daemon sorts
 * by, and a client that parsed it would be a second implementation of the
 * ordering. The bound is what stops a malformed token from being a transport
 * problem; the daemon answers an unusable one with the scope's first page and
 * `cursor_missing: true`, so a token this schema admits but the daemon does not
 * recognise is a RE-READ rather than an error.
 */
const catalogueCursor = z.string().min(1).max(256);

/*
 * The Projects contract's own vocabulary, mirroring the backend store's grammar
 * rather than re-inventing one. The name rule is the store's exactly
 * (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`): a project name is both a `/project`
 * argument and an `@project:<name>` token, so a space or a slash in one would
 * break the surfaces that read it. It is checked HERE so a typo is a named
 * refusal in the dialog rather than the backend's generic 422; every STATE
 * question (a name already taken, the 64-link cap, a row written by a newer
 * build) stays the backend's right to answer.
 */
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const projectName = z.string().regex(PROJECT_NAME_PATTERN, {
	message: "Letters, digits, dot, underscore and dash; no spaces.",
});
/** The four statuses the store declares, in the board's fixed order. */
/**
 * The status vocabulary, in the store's lifecycle order.
 *
 * `planning` -> `active` -> `qa` -> `validation` -> `done` is the pipeline the
 * operator named (RFC/research, implementation, review cycles, deployed and
 * observed, fully validated); `paused` and `archived` are the two SIDE states
 * that leave the pipeline without ending it. The order is the menu order —
 * `STATUS_OPTIONS` and the board columns both read it — so it is written once
 * here and mirrored there rather than spelled per list.
 *
 * A SERVER NEWER THAN THIS BUILD may send a word not in this list; every
 * reader treats the vocabulary as open (`projectStatusMeta` keeps the raw
 * word), and this enum only bounds what THIS UI may SEND.
 */
const PROJECT_STATUSES = [
	"planning",
	"active",
	"qa",
	"validation",
	"done",
	"paused",
	"archived",
] as const;
const projectStatus = z.enum(PROJECT_STATUSES);
/**
 * A planning date: ISO `YYYY-MM-DD`, or `""` to CLEAR the field.
 *
 * The empty string is a member on purpose — it is the PATCH tri-state's third
 * value (omit leaves the field alone, `""` clears it, a date sets it), and a
 * schema that refused it would make "make this date TBD again" inexpressible
 * from the edit dialog.
 */
const projectDate = z
	.string()
	.regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD, or empty to clear.");
/** The tag grammar, bounded as the store bounds it (≤8 tags, ≤24 chars each). */
const projectTags = z.array(z.string().min(1).max(24)).max(8);
/** A route key: an exact id, or a name the route resolves case-insensitively. */
const projectKey = z.string().min(1).max(64);

/**
 * Longest progress snippet the store accepts, in CHARACTERS.
 *
 * Deliberately NOT reachable from this app's own edit dialog — progress is
 * tool-authored (the design's §2.3) — but the bound is declared beside the ops
 * that carry it so a hand-built request cannot project a document where a
 * snippet is expected.
 */
export const PROJECT_PROGRESS_MAX_CHARS = 1000;

/**
 * Longest description the store accepts, in CHARACTERS.
 *
 * The edit dialog's own counter reads this constant, so the refusal and the
 * promise above the field cannot state two different limits.
 */
export const PROJECT_DESCRIPTION_MAX_CHARS = 240;

/** Longest milestone name the store accepts, in CHARACTERS. */
export const PROJECT_MILESTONE_NAME_MAX_CHARS = 80;

/**
 * Longest query the `projects.search` op accepts, in CHARACTERS.
 *
 * The route bounds `q` at the same number (core
 * `local_operator/server/routes/desktop_projects.py`), and it matches
 * `SESSION_SEARCH_MAX_CHARS` because both are "a sentence a user typed". The
 * box carries no `maxLength` here on purpose — a pasted query must be searched,
 * not silently truncated — so this bound is enforced by SLICING the string the
 * client sends (see `use-projects-search`), which keeps the refusal in the
 * app's own words instead of the transport's generic 422.
 */
export const PROJECTS_SEARCH_MAX_CHARS = 256;

/**
 * How many ranked rows one `projects.search` query returns unless asked
 * otherwise, and the ceiling the schema allows.
 *
 * A page-sized cap, not the scan's: every row is still ranked and only the
 * ANSWER is bounded, so a ranked tail no view can draw costs nothing to omit.
 * Sent explicitly rather than left to the route's own default (50) — the
 * caller's list, not a second authority the app cannot see, is what decides
 * how many rows a view asked for.
 */
export const PROJECTS_SEARCH_DEFAULT_LIMIT = 100;
export const PROJECTS_SEARCH_MAX_LIMIT = 200;

/** The store's own tag grammar (`projects.py`'s `_TAG_RE`), hoisted so the rule
 *  below and anything else that has to name it agree on one object. */
export const PROJECT_TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,23}$/;

/**
 * The name check as a DIALOG needs it: a sentence for the user, or null.
 *
 * The same pattern the schema validates with, exposed so an inline refusal
 * under the field and the 422 the wire would answer cannot say two different
 * things about one name. The empty case gets its own sentence rather than the
 * grammar's, because "give it a name" is a different mistake from "this name
 * has a space in it".
 */
export function projectNameRule(name: string): string | null {
	if (!name) return "Give the project a name.";
	if (!PROJECT_NAME_PATTERN.test(name))
		return "Names start with a letter or digit and may use letters, digits, dot, underscore or dash.";
	return null;
}

/**
 * The tag grammar, one tag at a time (`PROJECT_TAG_PATTERN` — the store's own
 * `_TAG_RE`), as a dialog sentence or null.
 */
export function projectTagRule(tag: string): string | null {
	if (!PROJECT_TAG_PATTERN.test(tag))
		return "Tags are 1-24 characters of lowercase letters, digits, underscore or dash.";
	return null;
}

const hubItemKind = z.enum(["agent", "team"]);

const desktopRequestUnion = z.discriminatedUnion("op", [
	z.object({ op: z.literal("capabilities") }).strict(),
	/*
	 * THE MACHINE'S RUNTIME ROSTER, read for the straggler census a completed
	 * server update reports (`GET /v1/desktop/runtimes`). A GET with a fixed
	 * shape, so the whole request is the op.
	 *
	 * It reads the INVENTORY (`probe=false` in the path composer): the census
	 * asks every row what build it booted with, and the route's per-row loopback
	 * connects answer a different question ("did it answer?") that nothing here
	 * acts on. Skipping them also keeps the response inside the control budget
	 * without depending on the probe pool's own deadline logic.
	 *
	 * THE CONTROL BUDGET IS THE RIGHT ONE, and it is a bound rather than a hope:
	 * the route's own ceiling is the two external reads in front of the
	 * composition (5 s process table + 3 s socket table, stated in `roster.py`),
	 * and `probe=false` skips the per-row connects entirely - so the worst case
	 * is ~8 s, well under the 20 s control deadline. It is NOT on the long-read
	 * list: nothing here fans out to a provider or walks a ledger.
	 */
	z
		.object({ op: z.literal("runtimes.list") })
		.strict(),
	z.object({ op: z.literal("profiles.list") }).strict(),
	z.object({ op: z.literal("profiles.get"), name: profileName }).strict(),
	z
		.object({ op: z.literal("profiles.install"), name: profileName, requestId })
		.strict(),
	z
		.object({
			op: z.literal("profiles.create"),
			name: profileName,
			requestId,
			fields: profileFields.extend({
				description: z.string().max(8000),
				instructions: z.string().min(1).max(8000),
			}),
		})
		.strict(),
	z
		.object({
			op: z.literal("profiles.update"),
			name: profileName,
			requestId,
			fields: profileFields,
		})
		.strict(),
	/*
	 * THE HUB AUTO-UPDATE PLANE (backend `server/routes/desktop_hub.py`, gated by
	 * the `hub_updates` capability). `hub.updates` is a STORE READ on the backend
	 * (no network, O(items)), which is what makes it safe to poll from the
	 * sidebar; the five mutations are the ones that touch the hub or write a
	 * local definition, and each carries a `requestId` so a lost response is
	 * replayed by the server's receipts rather than re-run.
	 *
	 * `kind` is closed to the two definition families the hub carries, and `name`
	 * is the profile/team NAME because names are the runtime's attachment keys.
	 * `prefer` is per-item only: the backend refuses it on apply-all, since a
	 * conflict decision cannot be made for a set of items at once, so the
	 * apply-all schema does not offer it.
	 */
	z
		.object({ op: z.literal("hub.updates") })
		.strict(),
	z
		.object({
			op: z.literal("hub.check"),
			requestId,
			kind: hubItemKind.optional(),
			name: profileName.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("hub.apply"),
			requestId,
			kind: hubItemKind,
			name: profileName,
			prefer: z.enum(["local", "remote"]).optional(),
			acknowledgeUnknownBaseline: z.boolean().optional(),
			dryRun: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("hub.applyAll"),
			requestId,
			kind: hubItemKind.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("hub.retry"),
			requestId,
			kind: hubItemKind,
			name: profileName,
		})
		.strict(),
	z.object({ op: z.literal("teams.list") }).strict(),
	z.object({ op: z.literal("teams.get"), name: profileName }).strict(),
	z
		.object({
			op: z.literal("teams.create"),
			requestId,
			fields: teamFields.extend({ name: z.string().min(1).max(64) }),
		})
		.strict(),
	z
		.object({
			op: z.literal("teams.update"),
			name: profileName,
			requestId,
			fields: teamFields,
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.list"),
			limit: z.number().int().min(1).max(500).optional(),
			/*
			 * Whether ARCHIVED conversations belong in the answer.
			 *
			 * ABSENT MEANS `false`, and that default is a compatibility promise rather
			 * than a preference: a client that predates archiving sends no such field
			 * and must keep the list it always had rather than acquiring rows it has no
			 * way to mark, filter or restore. This app sends `true` and partitions the
			 * archived rows out of every default list itself (see `fetchSessions` in the
			 * canonical sessions store and `visibleRows` in `features/chat/chat-archived`),
			 * which is what lets ONE fetch serve both the hidden list and the two
			 * questions a list that hides them cannot answer: the open conversation's own
			 * archived state, and an unarchive control on a row found by search.
			 */
			include_archived: z.boolean().optional(),
			/*
			 * Whether conversations OTHER devices hold belong in the answer.
			 *
			 * ABSENT MEANS `false`, the same compatibility promise `include_archived`
			 * makes and for the same reason: the app's own sidebar fetch has always
			 * meant "this device's catalogue", and a client that predates the mesh must
			 * keep reading exactly that. The Mesh tab is the ONE surface that asks for
			 * the federated list, because "which conversation is on which device" is its
			 * question and it cannot answer it from `session_count` alone.
			 *
			 * THE COST IS NOT ZERO, which is why only that surface asks: the backend's
			 * peer projection dials each peer's relay under a 12 s fan-out budget and is
			 * TTL-cached at 20 s (`network/relay.py`, `session/peer_rows.py`), while a
			 * machine in no network short-circuits to no call at all — so the flag costs
			 * a paired device one cached fan-out per cadence, and an unpaired one
			 * nothing. The sidebar's two-second poll must never carry it.
			 */
			include_peers: z.boolean().optional(),
			/*
			 * The four parameters that make the catalogue PAGEABLE, and the switch that
			 * makes the daemon count it.
			 *
			 * ALL FOUR ARE OPTIONAL AND DEFAULTED, which is the whole compatibility
			 * promise: a request that sends none of them is byte-identical to the one
			 * this app sent before they existed, and an older daemon is therefore fully
			 * supported. They are gated on the `session_catalogue_page` capability rather
			 * than on a `session_catalogue` version bump, for the reason that map's own
			 * register states (an EXISTING surface must keep working against a backend
			 * that lacks the new one): FastAPI silently ignores unknown query parameters,
			 * so an un-gated client asking for `scope_kind=team&scope_name=lopdev` would
			 * receive the UNSCOPED page and draw other teams' rows under that team, and an
			 * un-gated `cursor` would receive page one again and duplicate it. The client
			 * has to be able to ask whether the daemon understands these, and the
			 * capability map is how this codebase asks.
			 *
			 * They travel as ONE contract revision rather than three: counts without the
			 * scope could not be rendered consistently with that scope's paged rows.
			 */
			scope_kind: catalogueScopeKind.optional(),
			scope_name: catalogueScopeName.optional(),
			cursor: catalogueCursor.optional(),
			with_counts: z.boolean().optional(),
		})
		.strict(),
	/*
	 * Acknowledge the one-time delegated-cleanup notice:
	 * `POST /v1/desktop/delegated-cleanup-notice/ack`.
	 *
	 * The notice rides `sessions.list` UNTIL this write lands: the GET is a
	 * non-consuming peek (every list answer keeps carrying the field while the
	 * store is unacknowledged, which is what lets a second window see the same
	 * notice), and this op is the one thing that flips `notice_acknowledged` on
	 * disk. The route is idempotent - acknowledging an acknowledged store writes
	 * what is already there - so, like `sessions.archive`, it needs no
	 * `requestId`: a retry cannot flip anything back.
	 */
	z
		.object({ op: z.literal("delegated_cleanup_notice.ack") })
		.strict(),
	z
		.object({
			// Content search over the store: name, id, exact conversation body, and
			// a bounded soft tier. `q` is capped at the backend's own 256-character
			// bound so an over-long query is refused here, by name, rather than by
			// the backend's generic "invalid fields" 422.
			op: z.literal("sessions.search"),
			// `.min(1)`: an EMPTY query is not a search. The backend answers one by
			// listing the whole store (documented there, and used by the phone's web
			// client), but this surface has that list already — its box is a filter
			// over the catalogue — so an empty `q` here would ask the server to send
			// back everything the client is holding. Refusing it by name is how the
			// closed vocabulary stays closed: no caller can send a request whose
			// answer it would have to discard.
			q: z.string().min(1).max(SESSION_SEARCH_MAX_CHARS),
			limit: z.number().int().min(1).max(500).optional(),
			/*
			 * Whether the SCAN admits archived conversations, absent meaning `false`
			 * (the same compatibility promise `sessions.list` states).
			 *
			 * The sidebar's "Include archived" control is the only writer, and the flag is
			 * in the query's cache key on this side because the two answers to one query
			 * are different questions: without that, toggling the control off would serve
			 * the answer that carries the archived hits and the rows would linger - the
			 * stale-row failure `chat-search.test.mjs` pins.
			 */
			include_archived: z.boolean().optional(),
		})
		.strict(),
	/*
	 * Archive or unarchive ONE conversation: `POST /v1/desktop/sessions/{id}/archive`.
	 *
	 * DESIRED STATE ON THE WIRE (`archived: true|false`), never a bare toggle, for
	 * the reason the pin op states beside its own field: over HTTP a toggle is not
	 * idempotent, and a request retried after a dropped response would flip the
	 * conversation back. Idempotent by construction here rather than by a receipt:
	 * re-archiving an archived conversation writes what is already there, so the op
	 * carries no `requestId` (the same at-most-once trade `sessions.warm` makes for
	 * a call that already is).
	 *
	 * Archiving is RECOVERABLE and therefore never confirmed: it hides the
	 * conversation from the default lists and from search, and unarchiving restores
	 * it. Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`):
	 * a boolean and a 12-char id are not prose.
	 */
	z
		.object({
			op: z.literal("sessions.archive"),
			sessionId,
			archived: z.boolean(),
		})
		.strict(),
	/*
	 * Delete ONE conversation PERMANENTLY: `DELETE /v1/desktop/sessions/{id}`.
	 *
	 * `confirmed: true` is required and is not a receipt: it is the wire's own echo
	 * of the user's answer to a danger dialog, so a caller that has not asked cannot
	 * express this request at all (a missing field is a 422 here, by name, rather
	 * than a delete nobody confirmed). The route refuses the delete of a session
	 * that is LIVE with a 409 and a sentence naming the guard - the one refusal this
	 * surface renders inside the dialog that asked, which is why the op needs no
	 * failure vocabulary of its own.
	 *
	 * It removes exactly the addressed conversation and NOT its subagent children;
	 * a surface that has children to mention says so in its own copy rather than
	 * implying a wider blast radius. No `requestId`: the delete is not retried by
	 * this client, and a retry of a delete cannot be owed an answer - the second
	 * call's honest answer is 404 and the outcome the user asked for either way.
	 */
	z
		.object({
			op: z.literal("sessions.delete"),
			sessionId,
			confirmed: z.literal(true),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.create"),
			requestId,
			/*
			 * OPTIONAL ONLY FOR A `purpose` CREATE, and the pair is enforced below by
			 * the union's own `superRefine` rather than by two union members: a
			 * `discriminatedUnion` accepts one member per `op` value, and a `.refine`
			 * on a member would make it a `ZodEffects` the union refuses (the same
			 * constraint `agent.publish`'s pairing rule states).
			 *
			 * WHY A CONFIGURATION RUN OMITS IT AT ALL. `cwd` exists so a conversation
			 * has a folder to work in, and this app has always refused an empty one
			 * precisely because it would resolve to "a directory the user never named".
			 * A configuration run edits this device's registries and holds no file
			 * tools at all, so its cwd is not authority — and the renderer cannot name
			 * one honestly: it would have to invent a path it cannot verify exists.
			 * The backend resolves it (to the config directory) when `purpose` is set.
			 */
			cwd: z.string().min(1).max(4096).optional(),
			target: target.optional(),
			/*
			 * WHAT KIND OF SESSION THIS IS, when it is not a conversation the operator
			 * asked for: `agents-config` starts a supervised configuration run (the
			 * Agents page's composer), which the backend stamps as a hidden origin and
			 * admits through the desktop door for watch/events/messages/interrupt
			 * without ever listing it as one of the operator's conversations.
			 *
			 * A LITERAL, so a typo is a compile error on this side and a 422 on a
			 * backend that does not know the value. It is capability-gated before it is
			 * ever sent (`agents_config`), because a backend older than this field
			 * validates the create body with `extra="forbid"` and would report a
			 * malformed request for a request the app deliberately made.
			 */
			purpose: z.literal("agents-config").optional(),
			/*
			 * OMITTED when the user never picked anything, so the body is the one
			 * this op sent before the draft's chips could open: making them
			 * actionable is strictly additive, and a `null` here would be a
			 * different request for every caller that never asked.
			 */
			model: modelSelection.optional(),
			/*
			 * The id a `sessions.draft` mint handed the pane, when it has one: the
			 * create then adopts that id (and the runtime already engaged for it)
			 * instead of minting a fresh session id. OMITTED when the pane never
			 * minted — an older backend, a draft the user sent before the first
			 * keystroke's mint answered, or a set of fields that changed since the
			 * mint (see the store's drop rule) — so the body is byte-for-byte the
			 * request this op sent before the draft could be warmed, and a backend
			 * that cannot resolve the id mints fresh rather than failing the send.
			 */
			draftId: sessionId.optional(),
			/*
			 * The DEVICE to create the conversation on (`features.peers`): the mesh route's
			 * own field, sent only when the user actually picked one, so the body of an
			 * ordinary create is unchanged. Omitted means this device.
			 *
			 * THE DIRECTORY RULE THAT COMES WITH IT, which is why the app must not offer this
			 * choice without saying so: a remote create carries an explicit `cwd` and an EMPTY
			 * one resolves to that device's home rather than to this project, so a pane with a
			 * peer destination names the directory it will use.
			 *
			 * `--yolo` and friends are NOT here because the peer's own route refuses them: a
			 * remote create that let this machine run tools unattended on another one is the
			 * thing the route declines to express.
			 */
			peer: meshId.optional(),
		})
		.strict(),
	/*
	 * What a NEW conversation's readings would be, without creating anything.
	 *
	 * The composer's status strip needs a model, an effort ladder and a window
	 * BEFORE a session exists, and every honest way to get them was rejected: a
	 * `sessions.create` on pane open writes a directory and a marker, so every
	 * abandoned new-chat pane would leave a visible empty row in the sidebar,
	 * and composing it in the renderer from `config.get` + `models.catalogue`
	 * moves model RESOLUTION (Python policy) into the app and reports nothing
	 * when the pair is absent from the catalogue. This op runs the backend's own
	 * cold resolution and returns the same canonical projection a cold session
	 * publishes, so the strip keeps one arithmetic path and the draft cannot
	 * disagree with the session the first send creates.
	 *
	 * Body and response mirror `sessions.create` deliberately: same `cwd`, same
	 * optional `target`, same `model` and same 422 for an unresolvable profile —
	 * the pane is asking the question it will ask for real on the first send, so
	 * the two bodies are derived from one selection. The response is a
	 * `CanonicalFrontendSync` — the wire shape `sessions.watch` streams — whose
	 * `snapshot.session_id` is EMPTY, because there is no session. The renderer
	 * passes it to the strip and never into the canonical sessions store.
	 */
	z
		.object({
			op: z.literal("sessions.preview"),
			requestId,
			cwd: z.string().min(1).max(4096),
			target: target.optional(),
			/* Present only when the pane's chips were used: the preview then answers
			   the reading the CHOSEN model gives, which is the ladder and window the
			   first turn will actually get. */
			model: modelSelection.optional(),
		})
		.strict(),
	/*
	 * Mint the id a NEW chat's runtime is warmed and then born on, from the
	 * pane's first keystroke.
	 *
	 * WHY THE OP EXISTS. A draft pane has no session to address, so there is
	 * nothing to warm: `sessions.warm` needs an id, and the multi-second engage
	 * the first send pays is exactly what the draft cannot pre-empt without one.
	 * The mint allocates that id and registers it with the daemon (fast, no
	 * engage), and the id then unlocks the same three doors a session pane uses
	 * — `events`, `watch` (the lease) and `warm` — through a deliberately narrow
	 * allow-list on the backend. `sessions.create` adopts the id on send, so the
	 * conversation the user lands in IS the one that was warmed; a daemon that
	 * has never seen the id (restart, expiry, eviction) mints fresh and the send
	 * works exactly as it did before this op existed.
	 *
	 * THE MINT ENGAGES NOTHING, and that is the lifetime design rather than an
	 * omission: the pane's own subscription and watch lease hold the bridge that
	 * keeps a warm alive, exactly as they do for a session, so abandoning the
	 * pane cancels an in-flight warm through the same `_detach` and a runtime
	 * nobody holds is reaped by the residency drain. There is no second, warmer-
	 * owned lifetime to get wrong.
	 *
	 * `requestId` IS A RECEIPT KEY, unlike `sessions.preview`'s token: a mint is
	 * fired once per pane, and a retry — a fast second keystroke, a lost
	 * response — must replay the SAME id, because two ids for one pane would
	 * warm two runtimes and leave a registry entry nobody can ever consume.
	 *
	 * The body is `sessions.create`'s first half, deliberately: same `cwd` bounds,
	 * same optional `target`, same optional `model` and the same 422 for an
	 * unresolvable profile. The pane is asking the question it will ask for real
	 * on the first send, so both derive from one selection and cannot disagree.
	 *
	 * Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`):
	 * a path and two optional short ids are not prose, so the mint costs the
	 * control budget — which is what lets a KEYSTROKE issue it.
	 */
	z
		.object({
			op: z.literal("sessions.draft"),
			requestId,
			cwd: z.string().min(1).max(4096),
			target: target.optional(),
			model: modelSelection.optional(),
		})
		.strict(),
	z.object({ op: z.literal("sessions.get"), sessionId }).strict(),
	z
		.object({
			op: z.literal("sessions.history"),
			sessionId,
			beforeId: id.optional(),
			limit: z.number().int().min(1).max(500).optional(),
			/*
			 * THE OPEN-FRAME NEGOTIATION (`docs/DESKTOP_API.md`, "The open frame").
			 * True means "this reader consumes `runs`, `runs_state` and `head_cut`, and
			 * accepts `limit` being counted in PAINTABLE rows" - the two halves are one
			 * statement, which is why the capability gates the flag rather than the
			 * caller's judgement: a page whose unit changed under a reader that does not
			 * read `runs` is the defect the capability exists to prevent. It is sent on
			 * EVERY history read this renderer makes while it is negotiated, because a
			 * page served one shape and paged in another is two page builders for one
			 * transcript.
			 *
			 * Optional and absent-by-default, so the wire for an older backend - and for
			 * every request this app made before the capability existed - is unchanged.
			 */
			openFrame: z.boolean().optional(),
		})
		.strict(),
	/*
	 * The transcript checkpoint rail's manifest (design D1/D9): every material
	 * checkpoint of one LOCAL conversation — the reader's own messages and each
	 * completed turn — with the seq-proportional ordinal the rail places a tick
	 * by, and a completion's optional generated name.
	 *
	 * The answer is deliberately cheap and never blocks on a scan: a cold or
	 * stale index answers `state: "building"` while a refresh runs in the
	 * background (the backend measures 22 s for this machine's 272 MB journal),
	 * so the rail's first paint is immediate and the hook polls while anything
	 * it asked for is still pending. A remote/peer conversation answers
	 * `state: "unsupported"` — a fact about where the bytes are, not a failure
	 * — and the rail hides, the same degradation as an empty manifest.
	 */
	z
		.object({ op: z.literal("sessions.checkpoints"), sessionId })
		.strict(),
	/*
	 * Buy names for checkpoints (design D2/D9): idempotent, bounded, and never
	 * blocking on the model call itself — the backend schedules one
	 * `complete_once` per turn (15 s budget, single attempt, a 10-minute
	 * cooldown after a failure) and answers accepted/pending immediately.
	 *
	 * `ids` is the hover gesture's arm (a bounded set of explicit checkpoint
	 * ids); omitting it is the rail-open arm, where the backend selects the
	 * most recent checkpoints missing names under its own default. Both fields
	 * are optional, and an older backend that predates the op answers the same
	 * 404/422 a missing route always does — the hook treats any failure as "no
	 * rail here", never as a user-facing error.
	 */
	z
		.object({
			op: z.literal("sessions.checkpoints.warm"),
			sessionId,
			ids: z.array(id).max(CHECKPOINT_WARM_MAX_IDS).optional(),
			limit: z.number().int().min(1).max(CHECKPOINT_WARM_MAX_IDS).optional(),
		})
		.strict(),
	/*
	 * In-thread find (D9): messages of ONE conversation matching `q`, best
	 * first, served from the per-session transcript index.
	 *
	 * A READ like `history` and `checkpoints` beside it. The answer's `state` is
	 * the checkpoint manifest's own ladder: a cold or stale index answers
	 * `building` inside the first-paint budget (with hits ranked from the
	 * previous scan marked `partial`) while the background refresh runs, so the
	 * overlay's first paint is immediate; `unsupported` is a peer conversation
	 * whose journal is not on this device; `error` is a failed refresh inside
	 * its cooldown. The overlay renders both tiers (`exact`/`soft`) and treats
	 * `ranges` as snippet-relative — empty on a soft hit, which has no literal
	 * occurrence of the query by construction.
	 */
	z
		.object({
			op: z.literal("sessions.find"),
			sessionId,
			// `.min(1)`: an empty query is not a search. The overlay's client never
			// sends one — it answers an empty query locally, without a request — so
			// refusing it by name keeps the vocabulary closed rather than paying a
			// round trip for an answer the box already knows.
			q: z.string().min(1).max(THREAD_FIND_MAX_CHARS),
			limit: z.number().int().min(1).max(THREAD_FIND_MAX_LIMIT).optional(),
		})
		.strict(),
	/*
	 * One child's durable transcript, for the run panel's reader
	 * (`docs/run-sidebar.md` § 10.1, § 10.3).
	 *
	 * Both ids are the same `^[a-f0-9]{12}$` the whole desktop surface already
	 * validates on, and NEITHER is a path: the child directory is resolved by the
	 * route from the id and from the parent's own roster, so the renderer cannot
	 * name a directory at all. That containment is the route's, not the caller's —
	 * a schema that accepted a path here would be the whole boundary.
	 *
	 * `beforeId` is an entry id (max 128 chars, the `id` shape) rather than an
	 * offset, matching `sessions.history`: file compaction replaces the JSONL
	 * atomically, so offsets become lies while ids stay meaningful.
	 */
	z
		.object({
			op: z.literal("subagents.transcript"),
			sessionId,
			childId: sessionId,
			beforeId: id.optional(),
			limit: z.number().int().min(1).max(500).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.message"),
			sessionId,
			requestId,
			text: z.string().max(DESKTOP_MESSAGE_MAX_CHARS),
			images: z.array(sessionImage).max(DESKTOP_MESSAGE_MAX_IMAGES).optional(),
			mode: z.enum(["prompt", "steer"]).optional(),
			/*
			 * HOW THE MESSAGE WAS PRODUCED (arch §4.2), and the harness gate is what
			 * keeps this `optional`: `features.input_mode`. Absent means a legacy
			 * body (and is what every older build sends), so an older harness's own
			 * `.strict()` schema never sees the key at all.
			 *
			 * `inputPath` is RESERVED (§4.2a): the route cascade owns its
			 * vocabulary and no caller sets it yet; it is accepted here - bounded -
			 * so the first caller that does does not also need a contract change.
			 */
			inputMode: z.enum(["typed", "dictated", "mixed"]).optional(),
			inputPath: z.string().max(1024).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.command"),
			sessionId,
			requestId,
			command: z
				.string()
				.regex(/^\/?[A-Za-z]+$/)
				.max(64),
			args: z.string().max(DESKTOP_MESSAGE_MAX_CHARS).optional(),
			images: z.array(sessionImage).max(DESKTOP_MESSAGE_MAX_IMAGES).optional(),
		})
		.strict(),
	/*
	 * Point a LIVE session at another working directory (the desktop's `/move`).
	 *
	 * Its own op rather than an argument to `sessions.command`, and the reason is
	 * where the work happens: the move is executed in the SERVER process against
	 * the session's viewer (`POST
	 * /v1/desktop/sessions/{id}/working-directory`), while the command endpoint
	 * answers a `NativeAction | OwnerCommandResult` - the union's other member is
	 * the RUNTIME's own slash answer, and a move produces neither. `/move`
	 * therefore stays a presentation request in the backend's command catalogue
	 * (`desktop_destination="session.move"`): a bare `/move` opens the picker,
	 * and the argument form and the chip both call this op instead. The shape is
	 * `sessions.warm`'s: a lifecycle operation on the session's runtime, with its
	 * own receipt.
	 *
	 * Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`): a
	 * path is not prose, and claiming image-sized room for a 4 KB field would
	 * spend the message budget on nothing. `cwd` carries the same bound as
	 * `sessions.create`/`sessions.preview` because it reaches the same route
	 * model, which refuses anything else.
	 */
	z
		.object({
			op: z.literal("sessions.move"),
			sessionId,
			requestId,
			cwd: z.string().min(1).max(4096),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.answer"),
			sessionId,
			/**
			 * The owner epoch, for the two GATE shapes. Optional here because a queued
			 * ask has no epoch to give — `ask_id` is the other selector and the checks
			 * below require exactly one of the pair.
			 */
			epoch: id.optional(),
			requestId: id.optional(),
			value: z.string().max(32768).optional(),
			approved: z.boolean().optional(),
			questionIndex: z.number().int().min(0).optional(),
			/**
			 * The queued ask's id (`a-3f9c`). Its presence selects the THIRD body shape —
			 * `{ask_id, answers}` or `{ask_id, decline}` — and, per the backend's own
			 * contract, makes `epoch` irrelevant rather than optional-but-checked: an ask
			 * outlives the owner that queued it, so requiring an epoch would refuse
			 * exactly the case the feature exists for (a cold session whose asks are
			 * still open). The single-winner rule that the epoch check used to provide
			 * now lives on the ask log, where the first `answered` event wins.
			 */
			askId: id.optional(),
			/**
			 * The WHOLE ask's answers, keyed by question id, each a list because a
			 * question may be multi-select.
			 *
			 * One atomic body rather than a per-question stream: the blocking path
			 * answered one question at a time over the wire, and a client that died
			 * part-way left an ask half-settled — the exact state the atomic submit
			 * exists to make unrepresentable.
			 */
			answers: z.record(z.string(), z.array(z.string().max(32768))).optional(),
			/** "No answer — decide yourself", the explicit form of today's Esc. */
			decline: z.boolean().optional(),
			/**
			 * CHANGE a recorded answer instead of submitting a first one (design §10,
			 * #1936).
			 *
			 * A modifier on the SAME `{ask_id, answers}` body, and it has to be sent
			 * explicitly because the intent is not recoverable from the values: equal
			 * values are not a retry marker and different values are not a revision
			 * (§10 — "no layer may infer a revision by comparing values"). The backend
			 * accepts it only while the answer is still UNDELIVERED and refuses it with
			 * its own sentence once the response row exists; this client does not
			 * pre-judge that, it renders the owner's refusal.
			 */
			revise: z.boolean().optional(),
		})
		/*
		 * A PLAIN `ZodObject`, with the mutual-exclusion rules on the UNION below.
		 * `z.discriminatedUnion` accepts only `ZodObject` options and a `.superRefine`
		 * member is a `ZodEffects` — this file already states that at
		 * `desktopRequestSchema`, and the member form does not compile.
		 */
		.strict(),
	z
		.object({
			op: z.literal("sessions.seen"),
			sessionId,
			completionToken: z.string().uuid(),
		})
		.strict(),
	/*
	 * Bulk acknowledgement: mark many completions read in ONE user gesture
	 * (`POST /v1/desktop/attention/seen`).
	 *
	 * Its OWN op rather than a loop over `sessions.seen`, for two reasons that are
	 * both about what the receipt MEANS. The backend writes the whole batch in one
	 * `BEGIN IMMEDIATE`, so an observer sees the pre-batch or the post-batch receipt
	 * set and never a prefix; N round trips would expose a partial batch to every
	 * poller, and a failure half way would leave the user unable to tell which
	 * marks went. And the items are TOKEN-bound on purpose: the batch names exactly
	 * the completions the client has RENDERED, so a completion published between
	 * the render and the click is not in it and stays unread. A watermark sweep
	 * ("acknowledge everything now") would clear exactly that result instead, which
	 * is the hazard the per-session receipt exists to prevent — so this op never
	 * carries a time, a count or a "all" flag, only the pairs the client observed.
	 *
	 * `items` is 1..500: 500 is the catalogue's own maximum page, so every row the
	 * sidebar can hold is sendable in one call and `markAllRead` never has to
	 * chunk (chunking would break "one gesture, one request").
	 */
	z
		.object({
			op: z.literal("attention.seen"),
			items: z
				.array(
					z
						.object({
							sessionId,
							// A REAL uuid, like `sessions.seen`: a token that is not one cannot
							// name a completion, so it is refused here rather than round-tripped
							// to answer `unknown` for an item the client should not have sent.
							completionToken: z.string().uuid(),
						})
						/*
						 * `.strict()` on the ITEM as well as on the arm, because the
						 * sibling repository's input model is `extra="forbid"`: without
						 * it an item carrying a third field is stripped here while the
						 * request is answered 422 on the far side — and in the other
						 * direction a future caller's extra field would be silently
						 * dropped rather than refused. The two frozen surfaces now
						 * refuse the same (agent review round 1, R5).
						 */
						.strict(),
				)
				.min(1)
				.max(500),
		})
		.strict(),
	// Cross-surface delivery claim, NOT a read receipt. `claim_delivery`
	// serialises the observers that can see one completion (a TUI, this app) so
	// exactly one of them toasts it. It deliberately never advances the read
	// watermark: routing a notification must not clear the sidebar's unseen mark
	// for a session the user never opened, which is why this is its own op and
	// not a reuse of `sessions.seen`.
	z
		.object({
			op: z.literal("sessions.notified"),
			sessionId,
			completionToken: z.string().uuid(),
		})
		.strict(),
	/*
	 * Pin or unpin a conversation, in the SHARED pin store the terminal's `f10`
	 * writes (`local_operator/tui/sidebar_pins.py`), so a conversation pinned in
	 * the TUI is pinned in this app and the other way round.
	 *
	 * DESIRED STATE ON THE WIRE (`pinned: true|false`), never a bare toggle, and
	 * this is the decision the op exists to carry. The TUI's verb is a toggle
	 * because it is a keypress; over HTTP a toggle is not idempotent - a request
	 * retried after a dropped response flips the pin back, and the user reports
	 * "the pin keeps un-pinning itself" in the one feature whose whole value is
	 * reliability. The route makes the call idempotent BY CONSTRUCTION instead of
	 * putting it on the receipt ladder: re-pinning an already-pinned conversation
	 * is a no-op that does not reorder, and unpinning an unpinned one writes
	 * nothing. That is also why there is no `requestId` here - at-most-once is
	 * bought only for calls that ADMIT WORK (`sessions.warm` carries no receipt
	 * for the same reason), and a call that is already idempotent needs none.
	 *
	 * Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`):
	 * a boolean and a 12-char id are not prose, so this costs the control budget.
	 */
	z
		.object({
			op: z.literal("sessions.pin"),
			sessionId,
			pinned: z.boolean(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.watch"),
			sessionId,
			subscriptionId: z.string().regex(SUBSCRIPTION_ID_PATTERN),
			visible: z.boolean(),
			canNotify: z.boolean(),
		})
		.strict(),
	// Speculative runtime engage. Carries no payload BY DESIGN: it admits no
	// work, so it is not receipt-keyed and not a `MESSAGE_OPS` member - see
	// `desktopRequestByteBudget`. Firing it costs the control budget and a
	// 2-byte body, which is what lets the renderer issue it from a keystroke.
	z
		.object({ op: z.literal("sessions.warm"), sessionId })
		.strict(),
	/*
	 * Stop the session's CURRENT TURN and the work under it, leaving the session
	 * and its process alive: the composer's Stop control and the Escape that is
	 * its accelerator.
	 *
	 * Its OWN op rather than an argument to `sessions.command`, because the
	 * command endpoint answers a presentation form: `/stop` is a catalogue entry
	 * whose `native_action` asks the client to open the session-stop picker, so a
	 * body of `{command: "stop"}` there answers 200, changes nothing, and reads as
	 * a stop that worked. That is the reported defect this op exists to remove.
	 *
	 * NOT `sessions.stop` either, and the two are one letter apart on purpose of
	 * naming rather than of meaning: `sessions.stop` is the KILL SWITCH (deny the
	 * pending gates, dispose the runtime, release the writer lease, unpublish,
	 * exit) reached from the `/stop` picker, and it is the rung ABOVE this one. A
	 * client that could not interrupt a turn can still stop a session; a backend
	 * that can do the second must not be told it can do the first, which is why
	 * the capability key is new rather than a `lifecycle` bump.
	 *
	 * `requestId` is the route's receipt key: "make the current turn stop" is
	 * idempotent and creates or destroys nothing, so the same id replayed with the
	 * same body answers the first receipt rather than interrupting twice.
	 *
	 * Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`): a
	 * uuid is not prose, so this costs the control budget.
	 */
	z
		.object({ op: z.literal("sessions.interrupt"), sessionId, requestId })
		.strict(),
	/*
	 * A session's code memory: the names the session's own cells have left in its
	 * eval namespace.
	 *
	 * Session-addressed, because the runtime is what holds a namespace and the
	 * kernel it lives in is keyed by session id. The legacy
	 * `/v1/agents/{id}/execution-variables` route answered through the agent
	 * registry instead, which resolves agent-directory UUIDs - so a canonical
	 * session id could only ever 404 there, and the panel that taught "code
	 * memory" never loaded once.
	 */
	z
		.object({ op: z.literal("sessions.variables.list"), sessionId })
		.strict(),
	z
		.object({
			op: z.literal("sessions.variables.create"),
			sessionId,
			key: variableKey,
			value: variableValue,
			type: variableType,
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.variables.update"),
			sessionId,
			key: variableKey,
			value: variableValue,
			type: variableType,
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.variables.delete"),
			sessionId,
			key: variableKey,
		})
		.strict(),
	// Machine-wide desktop presence. NOT a watch lease and deliberately not
	// shaped like one: it names no session, because the fact it carries is
	// "somebody is at this machine's screen and this app can raise a banner",
	// which is a property of the app rather than of any conversation. The
	// backend reads it to decide whether a BACKGROUND completion is worth a
	// banner here at all (a session runtime with no surface to present on
	// otherwise toasts on its own host, where nobody may be).
	//
	// `subscription_id` is the LIVE feed subscription the presence belongs to,
	// not a per-session watch subscription: the server holds the lease against
	// that socket, so a dropped feed revokes the claim without waiting for a
	// heartbeat to go stale. That is the whole reason presence is a route on the
	// feed rather than a local file - a desktop paired to a backend on another
	// host cannot write to that host's disk.
	z
		.object({
			op: z.literal("sessions.presence"),
			subscriptionId: z.string().regex(/^[a-f0-9]{1,64}$/),
			canNotify: z.boolean(),
			/*
			 * WHY THE CLAIM CARRIES MORE THAN "a desktop is connected".
			 *
			 * The backend's delivery lease answers two separate questions from
			 * this one beat, and a claim that names neither is a claim that
			 * delivers NOTHING:
			 *
			 * - `can_notify_kinds` is what `delivers(kind)` reads. Empty (the
			 *   default for a client that forgot) means rung 2 is never eligible
			 *   for any completion, so rung 4 raises the runtime's own banner —
			 *   earlier, and its claim advances the read watermark, so the
			 *   clickable banner this app exists to raise never composes.
			 *   The backend's own test for this is
			 *   `test_a_claim_with_no_kinds_claims_nothing`: an app that does not
			 *   advertise must not win the rung.
			 * - `window` (with `session_id`) is what `attended` reads. Without it
			 *   this app counts as watching NOTHING, so a completion in the
			 *   conversation on screen raises a banner — the inverse of rung 1,
			 *   and a regression against the per-session flag it replaces.
			 *
			 * `window` is sent even when there is no window: a windowless app
			 * (macOS, alive in the dock) can still raise a banner but cannot be
			 * displaying anything, which is why `session_id` must be "" there
			 * rather than the last conversation the closed window held.
			 */
			canNotifyKinds: z.array(z.enum(["complete", "error"])).max(4),
			sessionId: z.string().regex(/^([a-f0-9]{12})?$/),
			window: z
				.object({
					exists: z.boolean(),
					focused: z.boolean(),
					visible: z.boolean(),
					minimized: z.boolean(),
				})
				.strict(),
		})
		.strict(),
	// The legacy surface, reached through the same authenticated vocabulary as
	// everything else. These routes are gated in managed mode (agent inventory,
	// cwd paths, job history and conversation content are the same tenant's data
	// as the control plane), so a bare renderer fetch would 401 against exactly
	// the backend this app starts.
	z
		.object({
			op: z.literal("legacy.models"),
			provider: z.string().max(128).optional(),
			// Mirrors ModelSortKey / ModelSortDirection in models-api.ts. Enumerated
			// rather than free text so the renderer cannot smuggle a query fragment.
			sort: z.enum(["id", "name", "provider", "recommended"]).optional(),
			direction: z.enum(["ascending", "descending"]).optional(),
		})
		.strict(),
	z.object({ op: z.literal("legacy.models.providers") }).strict(),
	// Reachability is checked only when the user asks for it: a probe is a real
	// network round trip, and nothing behind first paint may make one.
	z
		.object({ op: z.literal("auth.probe"), provider: id })
		.strict(),
	z.object({ op: z.literal("legacy.agent.upload"), agentId: id }).strict(),
	/*
	 * Publication, beside the legacy zip upload it replaces for this surface.
	 *
	 * `legacy.agent.upload` stays exactly as it is — it is how an agent published
	 * under the old standard is still updated, and an older desktop build still
	 * pushes through it — but the app's own publish action moves onto the document
	 * ops below, which carry the instruction set instead of a zip of the agent
	 * directory.
	 */
	z
		.object({
			op: z.literal("agent.publish"),
			agentId: id,
			document: publicationDocument.optional(),
			/*
			 * The publication TARGET (§4.4/§4.7). Both travel together or neither does,
			 * and the rule is a `superRefine` on the whole UNION (below) rather than a
			 * `.refine` here — a refined member becomes a `ZodEffects`, which cannot be a
			 * member of a discriminated union; measured, it does not compile.
			 *
			 * WHY THE COMMENT CHANGED (security review round 1, S-1). It used to say a
			 * half-specified target was "refused there rather than silently published to
			 * the public hub". The local server's route does refuse one, but
			 * `desktopEndpoint` dropped an unpaired half before the request was composed,
			 * so what reached the server was indistinguishable from a deliberate public
			 * publication: the documented guarantee held at neither boundary, and it
			 * failed OPEN on a privacy-relevant target. Measured at the previous head:
			 * each half parsed on its own and `desktopEndpoint({visibility: "org"})`
			 * composed a plain `/publish` with no query at all.
			 *
			 * Absent means the public hub, which is exactly what every caller did before
			 * this field existed — so the rule is "one half is an error", not "absent is
			 * an error".
			 */
			visibility: z.literal("org").optional(),
			tenantId: id.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("agent.republish"),
			agentId: id,
			// The HUB listing to update. Required rather than inferred: the local
			// registry keeps no link to the listing a row was published as, so a
			// republish that did not name one would have to guess which public row to
			// overwrite — and guessing here overwrites somebody's listing.
			hubAgentId: id,
			document: publicationDocument.optional(),
			/** The publication target, on the same terms as `agent.publish` above. */
			visibility: z.literal("org").optional(),
			tenantId: id.optional(),
		})
		.strict(),
	/*
	 * Pulling a published organization team into this machine's local registry
	 * (§4.5/§8.4's "list + pull action").
	 *
	 * The id is the HUB document's id, not a local row's: the pull addresses what
	 * was published, and the local copy gets its own fresh id (the local server's
	 * `GET /v1/teams/pull/{team_id}` reconstructs it, renaming on a local id
	 * clash through the registry's own convention). `tenantId` is OPTIONAL and is
	 * the caller's statement of which organization owns the document, not part of
	 * the address: §4.5's pull path is org-agnostic by id, the local server
	 * verifies the claim and refuses a document owned by another tenant, and the
	 * credential that reads it is the one the local server already holds.
	 */
	z
		.object({
			op: z.literal("team.pull"),
			teamId: id,
			/*
			 * The caller's statement of which organization owns the document. The local
			 * server verifies it and refuses a document owned by another tenant rather
			 * than storing it under the wrong expectation, so sending it is a stronger
			 * read where the caller knows the org — and omitting it is still legal
			 * (§4.5's pull path is org-agnostic by id).
			 */
			tenantId: id.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("agent.nameAvailability"),
			// Deliberately looser than `publicationName`: this op asks whether a name
			// is publishable, and a name that breaks the rules is a question the
			// dialog does not ask (it shows the rule locally instead). The route is
			// public, so the only thing this bound has to keep out is a query the
			// backend can make no sense of.
			name: z.string().min(1).max(PUBLICATION_NAME_MAX_CHARS),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agents.list"),
			page: z.number().int().min(1).optional(),
			perPage: z.number().int().min(1).max(500).optional(),
			name: z.string().max(256).optional(),
			sort: z.string().max(64).optional(),
			direction: z.enum(["asc", "desc"]).optional(),
		})
		.strict(),
	z.object({ op: z.literal("legacy.agent.get"), agentId: id }).strict(),
	z
		.object({
			op: z.literal("legacy.agent.history"),
			agentId: id,
			page: z.number().int().min(1).optional(),
			perPage: z.number().int().min(1).max(500).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.jobs.list"),
			agentId: id.optional(),
			status: z.string().max(64).optional(),
		})
		.strict(),
	z.object({ op: z.literal("legacy.job.get"), jobId: id }).strict(),
	// The schedules surface. Gated in managed mode not because a schedule is
	// sensitive to READ but because both writes hand their `prompt` to the
	// scheduler, which later runs it as the user's own agent -- so a bare
	// renderer fetch would 401 against exactly the backend this app starts.
	z
		.object({
			op: z.literal("legacy.schedules.list"),
			page: z.number().int().min(1).optional(),
			perPage: z.number().int().min(1).max(100).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.schedules.list"),
			agentId: id,
			page: z.number().int().min(1).optional(),
			perPage: z.number().int().min(1).max(100).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.schedule.create"),
			agentId: id,
			// Passed through as the request body. Declared field-by-field rather
			// than as a passthrough object so the renderer cannot smuggle keys the
			// backend model would silently accept.
			schedule: scheduleWrite.extend({
				prompt: z.string().max(64_000),
				interval: z.number().int().min(1),
				unit: scheduleUnit,
			}),
		})
		.strict(),
	z.object({ op: z.literal("legacy.schedule.get"), scheduleId: id }).strict(),
	z
		.object({
			op: z.literal("legacy.schedule.edit"),
			scheduleId: id,
			// Every field optional: the backend applies `exclude_unset`, so sending
			// a key the user did not touch would overwrite it with a default.
			schedule: scheduleWrite.extend({
				prompt: z.string().max(64_000).nullish(),
				interval: z.number().int().min(1).nullish(),
				unit: scheduleUnit.nullish(),
			}),
		})
		.strict(),
	z
		.object({ op: z.literal("legacy.schedule.remove"), scheduleId: id })
		.strict(),
	// The remaining gated legacy writes and reads the renderer still issued as
	// bare same-origin `fetch`. `apiConfig.baseUrl` points AT THE BACKEND, not
	// through the main-process relay, so in managed mode these went out with no
	// bearer and 401'd -- agent creation among them, which is the app's most
	// basic action (review round 3, Q7).
	z
		.object({
			op: z.literal("legacy.agent.create"),
			// The body is forwarded whole: the backend model owns which fields
			// exist, and enumerating ~20 optional agent fields here would be a
			// second schema to keep in step with it. `strict()` on the wrapper
			// still stops any key outside `agent` from riding along.
			agent: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.update"),
			agentId: id,
			update: z.record(z.unknown()),
		})
		.strict(),
	z.object({ op: z.literal("legacy.agent.delete"), agentId: id }).strict(),
	z
		.object({ op: z.literal("legacy.agent.conversation.clear"), agentId: id })
		.strict(),
	z
		.object({ op: z.literal("legacy.agent.systemPrompt.get"), agentId: id })
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.systemPrompt.update"),
			agentId: id,
			systemPrompt: z.string().max(DESKTOP_SYSTEM_PROMPT_MAX_CHARS),
		})
		.strict(),
	z.object({ op: z.literal("legacy.agent.download"), agentId: id }).strict(),
	z.object({ op: z.literal("legacy.job.cancel"), jobId: id }).strict(),
	z.object({ op: z.literal("commands.list") }).strict(),
	z
		.object({
			op: z.literal("commands.entities"),
			sessionId,
			command: id,
			name: z.string().max(128).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("models.catalogue"),
			live: z.boolean().optional(),
			/*
			 * Which view of the catalogue to answer with: `usable` (the rows this
			 * machine can run, plus the session's current model) or `all`. Absent
			 * means `all`, which is also what a backend that predates the
			 * parameter does with it — the picker stays correct either way, because
			 * a compile-time-correct request against an old backend is filtered
			 * client-side by `scopeCatalogue`.
			 */
			scope: z.enum(["usable", "all"]).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("usage.get"),
			provider: id.optional(),
			live: z.boolean().optional(),
			refresh: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			/*
			 * THE PRE-EMPTIVE QUOTA READ (the sibling core PRs' route,
			 * `GET /v1/desktop/quota-notice`).
			 *
			 * The provider and model are the SELECTION under review, sent so the
			 * renderer's query key and the backend's verdict cannot disagree about
			 * what is being checked. Both are optional because the route falls back
			 * to the backend's own config values -- the same store the renderer's
			 * selection was read from -- and `refresh` is the user's explicit "I
			 * topped up" / "I verified": it bypasses the route's cache floor while
			 * every automatic read stays cache-aware.
			 */
			op: z.literal("quota.notice"),
			provider: id.optional(),
			model: z.string().min(1).max(200).optional(),
			refresh: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("analytics.get"),
			sessionId: sessionId.optional(),
			sinceMs: z.number().int().nonnegative().optional(),
			untilMs: z.number().int().nonnegative().optional(),
			days: z.number().int().min(1).max(366).optional(),
		})
		.strict(),
	/*
	 * The per-model rate table's own read, and a SEPARATE op on purpose.
	 *
	 * Its rows come from a grouped scan of the RAW LEDGER rather than from the
	 * rollup `analytics.get` reads, which is what makes it cover the operator's
	 * whole existing history rather than only the days since the rollup shipped
	 * — and is also what makes it cost seconds on a large ledger. Riding
	 * `analytics.get` would add that scan to every analytics panel load,
	 * including the ones that never scroll to the table, so it is fetched on its
	 * own and its wait is bounded and stated on its own section.
	 *
	 * Same arguments as `analytics.get`, same `.strict()` door, same window
	 * bounds: the two ops are windowed by the same `since_ms`/`until_ms`, which
	 * is the one property that lets a reader hold a row here against the
	 * headline Total above it.
	 */
	z
		.object({
			op: z.literal("analytics.models"),
			sessionId: sessionId.optional(),
			sinceMs: z.number().int().nonnegative().optional(),
			untilMs: z.number().int().nonnegative().optional(),
			days: z.number().int().min(1).max(366).optional(),
		})
		.strict(),
	/*
	 * The two diagnostics reads. They ride their own capability key
	 * (`diagnostics`) rather than the catalogue one, because `/analytics` and
	 * `/failovers` must keep working against a backend that lacks these routes.
	 */
	z
		.object({ op: z.literal("info.get") })
		.strict(),
	z
		.object({
			op: z.literal("sessions.report"),
			sessionId,
			/*
			 * 0..50, matching the route's own clamp. The client always sends it:
			 * the number of rows the panel draws is a design decision made here, and
			 * inheriting the route's default would let the two drift apart.
			 */
			recentLimit: z.number().int().min(0).max(50).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("skills.list"),
			/*
			 * The sessionless arm's pair, both optional, `cwd` wins when both are sent
			 * (the explicit folder beats the implied one; the route's docstring owns
			 * the rule). `cwd` given → the folder's own discovery roots (identical to
			 * the session created there); `session_id` given → the session's cwd
			 * (compat, for the `/skills` panel and released clients); NEITHER → the
			 * daemon's home roots, explicitly — never the daemon's process cwd.
			 */
			sessionId: sessionId.optional(),
			cwd: skillCwd.optional(),
			name: id.optional(),
		})
		.strict(),
	z.object({ op: z.literal("sessions.failovers"), sessionId }).strict(),
	z
		.object({
			op: z.literal("sessions.credential"),
			sessionId,
			action: z.enum(["list", "store", "forget"]),
			key: settingKey.optional(),
			value: secret.optional(),
			confirmed: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.fork"),
			sessionId,
			requestId,
			message: z.string().max(200000).optional(),
			/*
			 * WHERE THE COPY STOPS. `next_safe` is the historical form and the default
			 * (the whole committed conversation, waiting for a turn boundary);
			 * `at_entry` cuts through `entryId` and needs no boundary, because a named
			 * point is already committed.
			 *
			 * `entryId` is bounded rather than patterned for the route's reason -
			 * entry ids are minted in more than one shape and existence in the
			 * CONVERSATION is what decides whether one is real (the route answers an
			 * unknown or foreign id with a refusal, never a fork of the wrong
			 * history) - so this client validates the shape it can and lets the
			 * backend adjudicate the rest.
			 *
			 * BOTH ARE OPTIONAL AND ABSENT IS THE OLD CALL, key for key: a typed
			 * `/fork` and the palette's fork send neither, and the body builder below
			 * omits `entry_id` entirely rather than sending it as null.
			 */
			boundary: z.enum(["next_safe", "at_entry"]).optional(),
			entryId: z.string().max(128).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.stop"),
			requestId,
			targets: z.array(sessionId).min(1).max(100),
			confirmed: z.literal(true),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.aside"),
			sessionId,
			requestId,
			text: z.string().min(1).max(32768),
			asideId: requestId.optional(),
			/*
			 * THE SUBSCRIPTION THAT WANTS THE ANSWER'S CHUNKS, named by the viewer
			 * that is asking.
			 *
			 * `aside_delta` is published on the session's stream, and the stream is
			 * read by every attached viewer of a session - so the owner has to be
			 * told WHICH of them asked, or an off-record answer is broadcast to
			 * windows that never asked the question. The same id the `open` frame
			 * hands the renderer (`payload.subscription_id`), which is also what
			 * `sessions.watch` leases it with, so the two cannot disagree about
			 * which subscription a viewer is.
			 *
			 * OPTIONAL, and that is the backward-compatibility half: an owner that
			 * predates the routing sends no `aside_delta` at all, and a viewer that
			 * has no subscription yet (the stream has not opened) still gets the
			 * settled answer from the POST's response.
			 */
			subscriptionId: z.string().regex(SUBSCRIPTION_ID_PATTERN).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.adopt"),
			sessionId,
			requestId,
			asideId: requestId,
			confirmed: z.literal(true),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.aside.get"),
			sessionId,
			asideId: requestId,
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.aside.close"),
			sessionId,
			asideId: requestId,
		})
		.strict(),
	/*
	 * The wake surface: the Schedules page's machine-wide read and its writes.
	 *
	 * Deliberately NOT an extension of `sessions.*`. The session list is
	 * paginated by recency (`limit ≤ 500`), so a session armed once and never
	 * opened falls off it - and the page whose whole job is "every session that
	 * has wakes" would then list fewer sessions than exist. `wakes.list` reads
	 * the wake index instead, which is one small JSON file per wake-carrying
	 * session and is complete at any store size.
	 *
	 * The four ops sit behind the same router-level desktop bearer as their
	 * `sessions.*` siblings, and every one of them does its filesystem work off
	 * the event loop, so a listing over a cold store cannot stall the desktop
	 * plane's other readers.
	 */
	z
		.object({
			op: z.literal("wakes.list"),
			/* Bounded like `sessions.list`: the field exists so a pathological
			   store degrades visibly (through `truncated`) rather than silently. */
			limit: z.number().int().min(1).max(500).optional(),
			/* Dormant rows are the ones whose session was stopped, which the page
			   SHOWS ("parked") rather than hides: stopping a conversation parks its
			   wakes, and a management surface that dropped them would report a
			   scheduled task as gone when it is only parked. */
			includeDormant: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("wakes.create"),
			requestId,
			/*
			 * The session half of the request is EXACTLY ONE of two shapes: name an
			 * existing `sessionId`, or name a `cwd` (plus an optional `target`) and
			 * have the backend create the conversation and arm the wake in one
			 * call. The exclusivity cannot be stated with a `.refine()` on this
			 * object - that turns the member into a `ZodEffects`, which a
			 * discriminated union cannot take (see `mcp.credentials.store`, which
			 * records the same trap) - so the API client enforces it on the way out
			 * with `wakeCreateBody`, and the backend refuses the malformed shape
			 * with a 422 rather than a 500.
			 */
			sessionId: sessionId.optional(),
			cwd: z.string().min(1).max(4096).optional(),
			target: target.optional(),
			message: wakeMessage,
			/*
			 * Timing, in the same spellings the wake tool and `lop wake create`
			 * take, parsed by the backend's own `parse_wake_duration` /
			 * `parse_wake_at`: a relative duration (`30m`), an ISO instant or the
			 * next `HH:MM`. The dialog's presets are `in`/`at` pairs so the common
			 * path never touches a calendar, and `Pick a time…` sends the ISO
			 * instant the picker yields.
			 */
			in: z.string().min(1).max(64).optional(),
			at: z.string().min(1).max(64).optional(),
			every: z.string().min(1).max(64).optional(),
			until: z.string().min(1).max(64).optional(),
			limit: z.number().int().min(1).optional(),
			/*
			 * The conversation's own title, when a caller wants to override the one
			 * derived from the prompt.
			 *
			 * Carried because the interface declares it, and never set by this
			 * page: the prompt IS the name here (the backend writes it into the
			 * session's stored-title sidecar, which `resume.session_name` consults
			 * first), which is what keeps the create flow free of a "name" field
			 * nobody would fill in.
			 */
			title: z.string().min(1).max(200).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("wakes.edit"),
			sessionId,
			wakeId,
			/* Every field optional, and the body is sent with the absent ones
			   OMITTED rather than nulled: the backend applies the update against
			   the schedule it holds, so a `null` here would be a request to clear
			   a bound the user did not touch. */
			message: wakeMessage.optional(),
			in: z.string().min(1).max(64).optional(),
			at: z.string().min(1).max(64).optional(),
			every: z.string().min(1).max(64).optional(),
			until: z.string().min(1).max(64).optional(),
			limit: z.number().int().min(1).optional(),
		})
		.strict(),
	z.object({ op: z.literal("wakes.remove"), sessionId, wakeId }).strict(),
	/*
	 * The monitor surface's one write that has a UI: cancelling a standing watch
	 * (`DELETE /v1/desktop/monitors/{session_id}/{monitor_id}`). The sibling
	 * routes - the machine-wide listing and the arm - are deliberately not
	 * mirrored yet: the pane and the composer's chip read the SESSION's own
	 * `frontend.monitors` field (the design's §12 row states the desktop contract
	 * as "the `monitors` field + command routes"), so a listing op would have no
	 * reader, and the arm op waits for the form that will use it.
	 */
	z
		.object({
			op: z.literal("monitors.cancel"),
			sessionId,
			monitorId,
		})
		.strict(),
	z.object({ op: z.literal("mcp.list"), sessionId }).strict(),
	z
		.object({
			op: z.literal("mcp.credentials.store"),
			sessionId,
			name: z.string().min(1).max(256),
			values: z
				.record(z.string().min(1).max(128), z.string().min(1).max(32768))
				// Field-level on purpose: a `.refine()` on the OBJECT would make this
				// member a `ZodEffects`, which a discriminated union cannot take — it
				// needs the `op` shape to discriminate on, so refining the whole
				// object silently collapsed `DesktopRequest` to `unknown` and broke
				// every `switch (request.op)` in this file.
				.refine(
					(secrets) =>
						Object.keys(secrets).length <= 32 &&
						Object.values(secrets).reduce(
							(total, value) => total + value.length,
							0,
						) <= 65536,
					// Mirrors the owner's own bound (`local_operator/mcp/credentials.py`),
					// so an oversized paste is refused as a sentence rather than
					// serialized into a request the control budget rejects as an
					// opaque 413.
					{
						message:
							"Too many secret values, or too much secret text, for one MCP credential write.",
					},
				),
			confirmedReplace: z.array(z.string().min(1).max(128)).max(32),
		})
		.strict(),
	z
		.object({
			op: z.literal("mcp.control"),
			sessionId,
			control: z
				.object({
					action: z.enum([
						"list",
						"add",
						"remove",
						"reload",
						"connect",
						"probe",
						"disconnect",
						"login",
						"logout",
						"reauth",
						"status",
						"cancel",
					]),
					name: mcpServerName.optional(),
					scope: z.enum(["global", "project"]).optional(),
					command: z.string().min(1).max(4096).optional(),
					args: z.array(z.string().max(8192)).max(128).optional(),
					env: z.record(mcpSecretReference).optional(),
					url: z.string().max(4096).optional(),
					headers: z.record(mcpSecretReference).optional(),
					oauth: z.boolean().optional(),
					confirmed: z.boolean().optional(),
					operation_id: mcpOperationId.optional(),
				})
				.strict(),
		})
		.strict(),
	/*
	 * The SESSIONLESS MCP catalog (`GET|POST /v1/desktop/mcp`), gated on the
	 * `mcp_catalog` capability. Settings > Integrations reads and writes MCP
	 * CONFIGURATION through these, so it no longer needs a running conversation -
	 * the session route above booted a whole runtime (and so needed a model
	 * provider) just to write a JSON file (UX walk U5). The session ops stay: the
	 * run panel is a live per-runtime view, and `connect`/`disconnect`/`reload`
	 * are about a runtime's live connection, so they are not accepted here.
	 *
	 * `cwd` is optional (the backend defaults it to the user's home, the desktop's
	 * own default) and must be absolute: the backend 422s anything else, and the
	 * schema refuses it first so a relative path never reaches the wire.
	 */
	z
		.object({
			op: z.literal("mcp.catalog"),
			cwd: mcpCatalogCwd.optional(),
			sessionId: sessionId.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("mcp.catalog.control"),
			cwd: mcpCatalogCwd.optional(),
			control: z
				.object({
					action: z.enum([
						"add",
						"remove",
						"test",
						"login",
						"reauth",
						"logout",
						"status",
						"cancel",
					]),
					name: mcpServerName.optional(),
					scope: z.enum(["global", "project"]).optional(),
					command: z.string().min(1).max(4096).optional(),
					args: z.array(z.string().max(8192)).max(128).optional(),
					env: z.record(mcpSecretReference).optional(),
					url: z.string().max(4096).optional(),
					headers: z.record(mcpSecretReference).optional(),
					confirmed: z.boolean().optional(),
					operation_id: mcpOperationId.optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			op: z.literal("mcp.catalog.credentials"),
			/*
			 * WHICH HEADER OR ENV NAME THE KEY BELONGS TO (backend #1511
			 * `aa927158a`). A server with no `${ID}` reference has nothing for the
			 * catalog's own `set_key` to fill, so the credential write names the
			 * header itself and the backend adds `headers[header] = "${ID}"` to the
			 * defining file. Refused (`invalid_target`) for a header the transport
			 * owns, one already set, a malformed name, or an invalid id - and
			 * refused with NOTHING written.
			 */
			header: z.string().min(1).max(128).optional(),
			cwd: mcpCatalogCwd.optional(),
			name: mcpServerName,
			values: z
				.record(z.string().min(1).max(128), z.string().min(1).max(32768))
				// The same owner bound as `mcp.credentials.store`, field-level for the
				// same discriminated-union reason given there.
				.refine(
					(secrets) =>
						Object.keys(secrets).length <= 32 &&
						Object.values(secrets).reduce(
							(total, value) => total + value.length,
							0,
						) <= 65536,
					{
						message:
							"Too many secret values, or too much secret text, for one MCP credential write.",
					},
				),
			confirmedReplace: z.array(z.string().min(1).max(128)).max(32),
		})
		.strict(),
	z
		.object({
			op: z.literal("radient.request"),
			control: z
				.object({
					operation: z.enum([
						"account",
						"prices",
						"credits",
						"usage",
						"provision",
						"application.create",
						"agents.list",
						"agents.get",
						"agents.create",
						"agents.update",
						"agents.delete",
						"agents.like",
						"agents.unlike",
						"agents.liked",
						"agents.like_count",
						"agents.favourite",
						"agents.unfavourite",
						"agents.favourited",
						"agents.favourite_count",
						"agents.download_count",
						/*
						 * The viewer's own like/favourite state for a whole page of agents. The
						 * closed vocabulary has to name it here as well as in
						 * `shared/api/radient/proxy.ts`, because this schema is what validates
						 * the request the renderer actually sends.
						 */
						"agents.statuses",
						"comments.list",
						"comments.create",
						"comments.update",
						"comments.delete",
						"account.agents",
						/*
						 * The organization operations (design §4.7). They are named here as well as
						 * in `shared/api/radient/proxy.ts` because this schema is what validates the
						 * request the renderer actually sends: an op in one list and not the other
						 * is a request that never leaves the renderer. `team_id` is the published
						 * team document an `org_team.get` pull names.
						 */
						"memberships.list",
						"org_agents.list",
						"org_team.get",
						"org_teams.list",
						/*
						 * The verification-email resend (core PR2,
						 * `feat/quota-notice-resend`): it maps to the upstream's JWT-only
						 * `POST /auth/signup/resend` and needs a `request_id`, exactly like
						 * every other mutation. Named here and in
						 * `shared/api/radient/proxy.ts` for the reason above; an OLDER
						 * backend answers it with a masked 422, which the quota notice
						 * reads as "degrade to the verification-page link".
						 */
						"signup.resend",
					]),
					request_id: requestId.optional(),
					tenant_id: id.optional(),
					account_id: id.optional(),
					agent_id: id.optional(),
					comment_id: id.optional(),
					team_id: id.optional(),
					query: z
						.record(z.union([z.string().max(1024), z.number().int()]))
						.optional(),
					payload: z.record(z.unknown()).optional(),
					confirmed: z.boolean().optional(),
				})
				.strict(),
		})
		.strict(),
	z.object({ op: z.literal("providers.list") }).strict(),
	z.object({ op: z.literal("accounts.list") }).strict(),
	z
		.object({
			op: z.literal("accounts.remove"),
			accountId: z.number().int().positive(),
			confirmed: z.literal(true),
		})
		.strict(),
	z.object({ op: z.literal("auth.start"), provider: id }).strict(),
	z.object({ op: z.literal("auth.status"), id }).strict(),
	z
		.object({ op: z.literal("auth.input"), id, promptId: id, value: secret })
		.strict(),
	z.object({ op: z.literal("auth.cancel"), id }).strict(),
	z.object({ op: z.literal("auth.key"), provider: id, value: secret }).strict(),
	z.object({ op: z.literal("auth.logout"), provider: id }).strict(),
	z.object({ op: z.literal("settings.list") }).strict(),
	z
		.object({
			op: z.literal("settings.edit"),
			key: settingKey,
			value: z
				.unknown()
				.refine((value) => value !== undefined, "A setting value is required."),
			base: chains.optional(),
		})
		.strict(),
	z.object({ op: z.literal("settings.reset"), key: settingKey }).strict(),
	/*
	 * THE VOICING SURFACE's read (`features.tts`), and the twin of the STT
	 * cascade report: every rung in order with its availability and the reason a
	 * reader would be shown, plus the surface's own `servable` bit. It is a GET
	 * with no parameters - the daemon resolves the cascade against THIS
	 * machine's stored credentials - so a client cannot scope it to anything and
	 * has nothing to send.
	 *
	 * Gated on its own capability key rather than on `settings`: the two are
	 * different contracts on different release trains (a backend can serve the
	 * registry and predate voicing), and a surface that fired this read at such a
	 * backend would render a 404 as a failure of the user's own account.
	 */
	z
		.object({ op: z.literal("tts.paths") })
		.strict(),
	z.object({ op: z.literal("config.get") }).strict(),
	z.object({ op: z.literal("config.update"), value: configUpdate }).strict(),
	z.object({ op: z.literal("instructions.get") }).strict(),
	z
		.object({
			op: z.literal("instructions.update"),
			content: z.string().max(64000),
		})
		.strict(),
	z.object({ op: z.literal("credentials.list") }).strict(),
	z
		.object({
			op: z.literal("credentials.update"),
			key: settingKey,
			value: secret,
		})
		.strict(),
	/*
	 * THE MESH READS (`features.peers`).
	 *
	 * Both reach a peer only THROUGH this app's one backend: the renderer never dials
	 * a peer, never learns an address to dial and holds no mesh credential, because a
	 * UI that could would have to re-implement the relay's authorisation model in
	 * JavaScript.
	 *
	 * THE MUTATING MESH OPS LANDED WITH THE SURFACES THAT USE THEM (slice 2: the drag
	 * layer, the invite action, the member list), which is the rule this block stated
	 * while they were still absent: a request schema entry with no caller is a
	 * capability this app advertises but cannot exercise.
	 *
	 * `features.session_transfer` gates the TRANSFER and only it (`capabilities.py`):
	 * a backend can host a network, mint invites and remove members without being able
	 * to move a conversation, and the surfaces that gate on the wrong key draw a
	 * control that 404s. The three ops below therefore sit behind different keys —
	 * `networks.invite`/`networks.member.remove` behind `features.peers` (they are
	 * routes the mesh itself introduced), `sessions.transfer` behind
	 * `features.session_transfer`.
	 *
	 * WHAT TRAVELS, AND WHAT DOES NOT. `to` is the destination device id or the
	 * literal `"local"` (a RECALL), because that is the route's own shape: one route,
	 * two protocols, and the direction is decided by which of the two ends is asking
	 * — see `guide://network`. `request_id` is minted by the CALLER and is what makes
	 * a retry replay a recorded outcome instead of starting a second move for a
	 * request that may still be running, so it is sent on every drop rather than kept
	 * for a retry path this surface does not have.
	 */
	z
		.object({ op: z.literal("peers.list") })
		.strict(),
	z.object({ op: z.literal("networks.list") }).strict(),
	/*
	 * Mint an invite. `role` is the joined device's own role in the network and
	 * `device` BINDS the token to one device id, so a token intercepted on its way to
	 * another machine cannot be redeemed by a third one. The token itself NEVER
	 * crosses this API (the receipt carries a path, and it is written where the
	 * renderer cannot read it) — which is why the answer is a receipt and not a
	 * secret.
	 */
	z
		.object({
			op: z.literal("networks.invite"),
			networkId: meshId,
			role: z.enum(["read", "drive", "admin"]),
			deviceId: meshId.optional(),
		})
		.strict(),
	/*
	 * Revoke a membership. `confirm` is the NETWORK'S NAME, typed by the user, and
	 * the route compares it exactly: this is the one mesh act that changes other
	 * devices' state (every peer is rekeyed and the removed device is locked out on
	 * its next handshake), so the request must carry what the user was shown rather
	 * than a bool a stray retry could also send.
	 */
	z
		.object({
			op: z.literal("networks.member.remove"),
			networkId: meshId,
			deviceId: meshId,
			confirm: z.string().min(1).max(256),
		})
		.strict(),
	/*
	 * Ask a device to take a conversation, or ask THIS device to take one back.
	 *
	 * THE DIRECTION IS THE PROTOCOL'S, not a UI preference: there is no push verb, so
	 * a drop on a peer is this device asking that peer to PULL (`to: <device_id>`),
	 * and a drop on this device is a recall (`to: "local"`). `keep` is the reversible
	 * half — it mints a new id at the destination and leaves the source running —
	 * while a move deletes the source's copy once the handoff commits, which is why
	 * `source_retired = (mode == "move")` on the receipt.
	 *
	 * `wait_s` is a CEILING ON WAITING INSIDE THE REQUEST, not a promise: the route
	 * returns as soon as it has a definite outcome, and a `busy` source refuses
	 * rather than being interrupted. The desktop's own deadline for this op is
	 * derived from the route's published bound rather than from the 20 s control
	 * budget (see `moveClientBoundMs`) — the defect this avoids is a client that gives
	 * up first and reports its own timeout for a move the backend was about to answer.
	 */
	z
		.object({
			op: z.literal("sessions.transfer"),
			sessionId,
			to: z.union([z.literal("local"), meshId]),
			keep: z.boolean().optional(),
			waitS: z.number().min(0).max(300).optional(),
			requestId: requestId.optional(),
		})
		.strict(),
	/*
	 * THE ONBOARDING APPROVALS (`features.approvals`), the third mesh-adjacent
	 * family: one durable, signed record per remote-onboarding request, kept
	 * DEVICE-LOCALLY under `<config>/network/approvals/` (remote-onboarding
	 * design §2.3 — the badge must answer on a machine whose relay is down, which
	 * is why the record is a flat file rather than something behind the relay).
	 *
	 * THE LIST IS THE BADGE READ and it dials nothing: every row comes off this
	 * machine's own directory, so a rail-mounted interval costs one local scan
	 * rather than a peer fan-out — the reason it is the ONE mesh-family read a
	 * sidebar badge may poll (see `mesh-approvals.ts` for the cadence argument).
	 * Each row is the frozen §3.5 shape — `what` (the scope block), the
	 * where-block (`device` for `device_onboard`, `machine` for `local_authority`;
	 * the KIND is which key is present), `requested_by` and the expiry — and the
	 * surfaces do their own wording, so the wire stays the record's own
	 * vocabulary and a new scope does not need a wire change.
	 *
	 * THE DECISIONS TAKE NO BODY, deliberately (`routes/desktop_approvals.py`:
	 * "the two decision routes take NO body at all — approving is the gesture").
	 * `approve` runs the SAME presence-gated signing call the CLI's `approve`
	 * verb runs, so its latency includes a human's — see
	 * `APPROVAL_APPROVE_DEADLINE_MS` for why this op alone carries its own
	 * budget. `deny` never signs: it is write-once and settles in the safe
	 * direction.
	 */
	z
		.object({ op: z.literal("approvals.list") })
		.strict(),
	z.object({ op: z.literal("approvals.approve"), approvalId }).strict(),
	z.object({ op: z.literal("approvals.deny"), approvalId }).strict(),
	/*
	 * THE FLEET ASKS READ (`GET /v1/desktop/asks`), the cross-session companion of
	 * the per-session queue the canonical frame carries. A GET with no parameters
	 * at all: the route answers from the DERIVED ask index under the config dir,
	 * so it needs no session id and no `cwd` — the rows name their own conversation
	 * (`session_id`, `cwd` are the frozen `PendingAsk` shape plus those two keys).
	 *
	 * IT IS A SEPARATE OP FROM THE SESSION QUEUE, deliberately. The session's asks
	 * arrive on its own canonical stream (the frontend state's `asks`), which is
	 * scoped to the conversation being watched and is therefore silent about every
	 * other conversation by construction; "what is waiting across the whole app" is
	 * a question no per-session frame can answer, which is why the drawer's other
	 * scope needs its own read rather than a widened filter on that one.
	 *
	 * THE ANSWER IS A LIST OF RAW ROWS rather than a modelled shape, matching the
	 * route's own reasoning: the rows ARE the frozen `PendingAsk` wire shape, and
	 * re-declaring their fields here would be a third copy of §4 to keep in step.
	 */
	z
		.object({ op: z.literal("asks.list") })
		.strict(),
	/*
	 * The Projects surface (`/v1/desktop/projects*`), APPENDED to the union
	 * rather than inserted beside the other catalogue ops: the backend serves
	 * these routes from its own release, and an older daemon that has never
	 * heard of the op is a backend this app must be able to gate against —
	 * which it does through the `projects` capability key, not through this
	 * schema (a request this client refuses to build is not a negotiation).
	 *
	 * One op per route; the wipe and the milestone routes are the two shapes
	 * that do not fit the plain CRUD, and both exist because the backend
	 * declared them separately (a milestone is add-or-update-by-name, and a
	 * removal is a DELETE with the name in the path). `projects.update` carries
	 * its editable fields as a NESTED `fields` object for the same reason the
	 * profile ops do: the fields differ per surface, and a flat op would put
	 * every future field at the top level of a union member.
	 */
	z
		.object({ op: z.literal("projects.list") })
		.strict(),
	z.object({ op: z.literal("projects.get"), key: projectKey }).strict(),
	z
		.object({
			op: z.literal("projects.create"),
			name: projectName,
			description: z.string().max(PROJECT_DESCRIPTION_MAX_CHARS).optional(),
			status: projectStatus.optional(),
			tags: projectTags.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.update"),
			key: projectKey,
			/*
			 * Only the keys the caller includes travel; an omitted key leaves the
			 * field alone, and `""` clears a date, the progress snippet or an
			 * attribution (the route forwards `model_fields_set`, and this client
			 * mirrors it). The three attribution/title steps are bounded at 80 —
			 * the store's `ATTRIBUTION_MAX`/`TITLE_MAX` — so a client cannot build
			 * a body the route would refuse for length alone.
			 */
			fields: z
				.object({
					name: projectName.optional(),
					title: z.string().max(80).optional(),
					owner: z.string().max(80).optional(),
					team: z.string().max(80).optional(),
					description: z.string().max(PROJECT_DESCRIPTION_MAX_CHARS).optional(),
					status: projectStatus.optional(),
					progress: z.string().max(PROJECT_PROGRESS_MAX_CHARS).optional(),
					tags: projectTags.optional(),
					start_date: projectDate.optional(),
					target_date: projectDate.optional(),
					completed_at: projectDate.optional(),
					estimate: z.number().positive().max(1000).optional(),
					estimate_unit: z.enum(["points", "days"]).optional(),
				})
				.strict(),
			/*
			 * `force_done` is a flag about THIS CALL, not a field of the row, so it
			 * sits at the op's top level and never inside `fields` (the strict
			 * `fields` object above rejects it there). It is the daemon's deliberate
			 * escape from the done-gate: close the project with milestones still
			 * open. Sent ONLY when true (see the mapper) because a daemon that
			 * predates the `projects_force_done` capability 422s an unknown body key
			 * - the renderer gates the offer on that key, and an absent flag keeps
			 * every other PATCH byte-identical to what shipped before.
			 */
			force_done: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.delete"),
			key: projectKey,
			confirmed_name: projectName,
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.link"),
			key: projectKey,
			sessionId,
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.unlink"),
			key: projectKey,
			sessionId,
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.milestone"),
			key: projectKey,
			name: z.string().min(1).max(PROJECT_MILESTONE_NAME_MAX_CHARS),
			/** `""` clears it; omitted leaves it alone. */
			targetDate: projectDate.optional(),
			/** `true` stamps today, `false` clears; omitted leaves it alone. */
			completed: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("projects.milestone.remove"),
			key: projectKey,
			name: z.string().min(1).max(PROJECT_MILESTONE_NAME_MAX_CHARS),
		})
		.strict(),
	/*
	 * The check-in fan-out (`POST /v1/desktop/projects/{project}/request-update`):
	 * ask every linked session to post a progress update. APPENDED to the union
	 * like its siblings, and gated by its OWN capability key
	 * (`features.projects_request_update`) rather than a bump of `projects`: the
	 * tab renders perfectly well against a backend that cannot ask its sessions
	 * for anything, so the version would hide a working surface behind an update
	 * it does not need (the `session_search` rule above). The key is the row's
	 * address (id or name) - the same shape every other projects op takes.
	 */
	z
		.object({
			op: z.literal("projects.request_update"),
			key: projectKey,
		})
		.strict(),
	/*
	 * THE DERIVED SEARCH INDEX (`GET /v1/desktop/projects/search`). APPENDED like
	 * its siblings, and gated by a `projects` VERSION BUMP (1 -> 2) rather than a
	 * key of its own: the route ranks over the same store the listing reads and is
	 * additive by construction — every version-1 call keeps its exact behaviour —
	 * so the version is what lets a client ask for the new read without a second
	 * negotiation. The backend's own register states the same split
	 * (`routes/capabilities.py`: "a client gates ONLY the two new calls on
	 * ``>= 2``").
	 *
	 * `.min(1)`: an EMPTY query is not a search. The route answers one with the
	 * listing's own order truncated to `limit`, but this surface already holds
	 * that list — its box is a filter over the catalogue — so an empty `q` would
	 * ask the server to send back everything the client is holding, which is the
	 * refusal `sessions.search` above states in the same words.
	 */
	z
		.object({
			op: z.literal("projects.search"),
			q: z.string().min(1).max(PROJECTS_SEARCH_MAX_CHARS),
			limit: z.number().int().min(1).max(PROJECTS_SEARCH_MAX_LIMIT).optional(),
		})
		.strict(),
	/*
	 * AIDA'S CONTROL PLANE: one read and one control op on the same route
	 * (`/v1/desktop/aida`), because the rail's row and the composer's `/aida`
	 * need the SAME state and a second spelling of it would be a second answer
	 * about her one long session (`design.md` § 4 freezes the route).
	 *
	 * The feature is gated by its OWN capability key (`features.aida`), never a
	 * bump of `commands`: a renderer that does not read it keeps working against
	 * this backend, and this renderer must not call the route while the key is
	 * absent or 0 (§ 3.4's version skew).
	 *
	 * Deliberately NOT a `MESSAGE_OPS` member (see `desktopRequestByteBudget`):
	 * an enum word and a receipt are not prose, so this costs the control budget.
	 */
	z
		.object({ op: z.literal("aida.status") })
		.strict(),
	z
		.object({
			op: z.literal("aida.control"),
			/*
			 * The route's own op vocabulary, held to it here: a word the backend does
			 * not serve must fail at this boundary rather than travel as a 422 the
			 * user reads as a defect of their press.
			 */
			action: z.enum(["open", "pause", "resume", "greet", "status"]),
		})
		.strict(),
	/*
	 * THE CODE REQUEST LEDGER (the per-session PR/MR list, and its refresh).
	 *
	 * BOTH ROUTES SIT UNDER THE SESSION because the LEDGER is the session's: the
	 * rows are derived from THIS conversation's transcript, so a read that did not
	 * name the session could only be some other session's list or a fleet scan
	 * nobody asked for. The pair follows the monitors/projects routes' pattern
	 * (`Depends(require_desktop)` behind the desktop bearer) and the refresh is a
	 * POST because it mutates the cache's TTL state; a GET with a side effect is
	 * the shape the monitors routes already refused.
	 *
	 * `keys` narrows the refresh to named rows and `force` bypasses the TTL but
	 * NOT a host's rate-limit window (`cooling` in the list answer says which);
	 * both are optional because "refresh what is dirty" and "per the TTL" are the
	 * route's defaults, which is what the pane's untouched Refresh press wants.
	 */
	z
		.object({ op: z.literal("code_requests.list"), sessionId })
		.strict(),
	z
		.object({
			op: z.literal("code_requests.refresh"),
			sessionId,
			/*
			 * A key is one row's `key` from the list answer; the bound mirrors the
			 * fetch routes' own ceilings rather than inventing one here, and the
			 * cap keeps a mis-read list from being re-sent whole.
			 */
			keys: z.array(z.string().min(1).max(512)).max(256).optional(),
			force: z.boolean().optional(),
		})
		.strict(),
]);

/**
 * The desktop request union, with the ONE rule that cannot live on a member.
 *
 * A publication target is two fields or none: `visibility: "org"` without a
 * `tenantId` (or the reverse) is refused HERE, before any socket is opened
 * (security review round 1, S-1). It is a `superRefine` on the union rather than
 * a `.refine` on the two members because a refined member is a `ZodEffects` and
 * `z.discriminatedUnion` accepts only `ZodObject` options — measured: the member
 * form does not compile. `assertPairedPublicationTarget` enforces the same rule
 * at the path composer, so a half pair cannot reach the wire by either route.
 *
 * The failure direction is the reason this is enforced twice: dropping the half
 * silently published to the PUBLIC hub, which is the one outcome that must not
 * be a default.
 */
export const desktopRequestSchema = desktopRequestUnion.superRefine(
	(request, ctx) => {
		/*
		 * AN ANSWER CARRIES ONE OF THREE SHAPES, and which one is decided by two
		 * mutually exclusive selectors: `askId` (a queued ask) or `epoch`+`requestId`
		 * (a gate). The rule lives HERE rather than on the member for the reason this
		 * whole callback exists — a refined member is a `ZodEffects` and
		 * `z.discriminatedUnion` accepts only `ZodObject` options.
		 *
		 * It is checked on the client at all because the alternative is a 422: a body
		 * the app composed itself would come back as a refusal, and the user would be
		 * told their answer failed when nothing was ever sent. The backend restates
		 * these rules (`Answer.one_answer`) because it cannot trust a caller; this one
		 * exists to keep the user's sentence honest, not to replace that.
		 */
		if (request.op === "sessions.answer") {
			if (request.askId !== undefined) {
				if (!request.askId)
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "ask_id must be a non-empty string",
						path: ["askId"],
					});
				/*
				 * `decline: false` is NOT a way to say "answer with nothing": the shape that
				 * carries neither answers nor a decline is malformed rather than merely
				 * empty, and the two together are contradictory rather than redundant.
				 */
				if (request.decline !== true && !request.answers)
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "A queued-ask answer needs answers or decline",
						path: ["answers"],
					});
				else if (request.decline === true && request.answers !== undefined)
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Supply either answers or decline",
						path: ["decline"],
					});
				else if (request.revise === true && request.decline === true)
					/*
					 * The same class of contradiction as the row above: a revision is how an
					 * answer is CHANGED and a decline is the refusal to give one, so no single
					 * intent sends both. The backend restates this (`Answer.one_answer`); this
					 * copy exists so the user is told here rather than by a 422.
					 */
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Supply either decline or revise",
						path: ["revise"],
					});
				else if (
					request.answers !== undefined &&
					Object.keys(request.answers).length === 0
				)
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "answers must name at least one question",
						path: ["answers"],
					});
				return;
			}
			// The gate shape keeps its epoch identity; a queued ask is the only answer
			// that may omit it, because an ask outlives the owner that queued it.
			if (!request.epoch)
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "An epoch is required to answer a gate",
					path: ["epoch"],
				});
			if (!request.requestId)
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "A request id is required to answer a gate",
					path: ["requestId"],
				});
			if (request.revise === true)
				/*
				 * A gate has no recorded answer to revise, so the field would be silently
				 * ignored — the class of no-op §10 rules out; refused in words at the
				 * boundary rather than dropped on the floor (the backend refuses it too).
				 */
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "revise applies to a queued ask",
					path: ["revise"],
				});
			return;
		}
		/*
		 * A CONVERSATION NEEDS A FOLDER; A CONFIGURATION RUN DOES NOT.
		 *
		 * The rule lives here rather than on the member because the two fields are
		 * one decision (`cwd` is required UNLESS `purpose` names a run), and this is
		 * the same place the publication pair is checked for the same reason: a
		 * request that could reach the wire half-specified would be answered with a
		 * 422 the app composed itself. `cwd` is checked by presence rather than by
		 * truthiness because an empty string is already refused by the field's own
		 * `min(1)`.
		 */
		if (request.op === "sessions.create" && request.purpose === undefined) {
			if (request.cwd === undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message:
						"A conversation needs a working directory: only a configuration run (`purpose`) may omit `cwd`.",
					path: ["cwd"],
				});
			}
			return;
		}
		if (request.op === "sessions.create" && request.purpose !== undefined) {
			/*
			 * A RUN EDITS THIS DEVICE'S REGISTRIES, and this op has no `peer` field to
			 * refuse: the create schema cannot express a peer session at all, so
			 * "local only" is a property of the wire rather than a rule to check here.
			 * Stated so the next reader does not add a check that can never fire.
			 */
			/*
			 * AND IT CARRIES NONE OF A CONVERSATION'S OWN FIELDS (agent review round
			 * 1, n3). The backend resolves a run's cwd, model and target itself and
			 * refuses a body that also states them
			 * (`agents_config_client_fields`), so a caller that sent both would be
			 * refused on the wire for a request this schema had let through — the
			 * refusal the app composed itself, one layer later than it could have
			 * been. `draftId` is in the list for the same reason: it names a pane's
			 * conversation draft, and a run has no pane.
			 */
			for (const field of ["cwd", "target", "model", "draftId"] as const) {
				if (request[field] === undefined) continue;
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `A configuration run resolves its own \`${field}\`: send \`purpose\` alone.`,
					path: [field],
				});
			}
			return;
		}
		if (request.op !== "agent.publish" && request.op !== "agent.republish") {
			return;
		}
		// The same presence test the composer's assert uses (S-2): one predicate for
		// "is this half specified", so the two boundaries cannot disagree.
		if (Boolean(request.visibility === "org") !== Boolean(request.tenantId)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					'A publication target needs both `visibility: "org"` and `tenantId`, or neither: one half would publish to the public hub.',
			});
		}
	},
);

export type DesktopRequest = z.infer<typeof desktopRequestSchema>;

/**
 * The machine register for a desktop-control REFUSAL, and the one translator that
 * turns it into a sentence a user reads.
 *
 * WHY these are codes on the error rather than the string a refusal came with.
 * `desktopResult` used to throw the response envelope's `detail` as the error's
 * MESSAGE, so the daemon's own prose became the app's diagnosis: the operator's
 * sidebar read "Desktop controls require a backend started by the desktop app."
 * (`local_operator/server/desktop.py`), a sentence about the daemon's own
 * ownership written by the daemon, on a machine where the app was
 * simply not paired (design § 0(c), § 5.1). A server string is not this app's
 * sentence, and a transport that adopts it as one cannot be reviewed for what the
 * user will read.
 *
 * The shape is `desktop-stream-notice.ts`'s, one layer over: the details are a
 * machine vocabulary that is NEVER rendered, and one translator composes the
 * product sentence. What differs is who needs to read the machine value - the
 * surfaces here are nine call sites of `userFacingMessage`, so the translator is
 * that function rather than a per-surface switch.
 */
export const DESKTOP_REFUSAL_CODE = {
	/**
	 * This app holds no token for the daemon it can see, so main refused to send
	 * the request at all. A PAIRING condition: the daemon never answered.
	 */
	noCredential: "pairing.no-credential",
	/**
	 * A 401/403 from a `/v1/desktop/` route: the daemon answered and refused this
	 * app's bearer. Re-claiming is the repair that exists, so it is a pairing
	 * condition and not a version one.
	 */
	refused: "pairing.refused",
	/**
	 * A 503 from a `/v1/desktop/` route that the app did NOT author: the daemon is
	 * running with its desktop plane shut (no claim accepted, no environment
	 * token), which is what a successor answers with until the app claims it.
	 */
	planeClosed: "pairing.plane-closed",
	/**
	 * Main could not complete the request at all (a refused socket, a reset). NOT a
	 * pairing condition - nothing was established about the daemon's plane - and it
	 * carries its own authored sentence.
	 */
	transportFailed: "transport.failed",
} as const;

/** One code from {@link DESKTOP_REFUSAL_CODE}. */
export type DesktopRefusalCode =
	(typeof DESKTOP_REFUSAL_CODE)[keyof typeof DESKTOP_REFUSAL_CODE];

/**
 * The daemon's OWN hop failure, which is a sight loss rather than a refusal.
 *
 * WHY THIS IS NOT IN `DESKTOP_REFUSAL_CODE`. That table is the app's vocabulary
 * for a refusal by the desktop PLANE — pairing conditions, each with its own
 * authored sentence. This code means something else, and the difference is a
 * constraint rather than a filing preference: it says the daemon could not hand
 * the request to the session's OWNER, so nothing was established about whether
 * the request arrived.
 *
 * The path is short and it is write-then-wait. `POST
 * /v1/desktop/sessions/{id}/answers` wraps `bridge.remote.answer_gate(...)`, which
 * hands the value over the bridge socket (`attach_client.py`): the frame is
 * WRITTEN first and its ack awaited after, raising `OwnerAckTimeout` past
 * `ACK_TIMEOUT_S = 15.0` and `ConnectionError` when the connection drops
 * mid-flight. Both land in the route's `errors()`, whose `ConnectionError` and
 * `(RuntimeError, asyncio.TimeoutError)` arms answer
 * `503 {"code": "runtime_unreachable"}` with the vetted sentence below.
 *
 * So an owner that resolved the gate and then lost its ack produces this, which
 * is the same fact `DESKTOP_REFUSAL_CODE.transportFailed` carries one hop up —
 * main could not complete the request — and the app must treat both the same way:
 * as an outcome it cannot know rather than as a refusal it can state. A `503`
 * whose code is `pairing.plane-closed` is the daemon refusing this app, and that
 * IS an answer (agent review round 2, MAJOR-1).
 */
export const DESKTOP_LOST_SIGHT_CODE = {
	/** The daemon could not reach the session's owner to deliver the answer. */
	runtimeUnreachable: "runtime_unreachable",
} as const;

/**
 * The daemon's FAST verdict on a control call aimed at a live owner that is not
 * answering its attach socket: `503 {"detail": {"code": "runtime_busy",
 * "message": ..., "retryable": true, "retry_after_ms": 2000}}` plus
 * `Retry-After: 2`, within ~3 s rather than the 15 s the control bind used to
 * wait before `runtime_unreachable` (backend workstream A of the load work;
 * `docs/DESKTOP_API.md` on that backend).
 *
 * WHY IT IS NOT A LOST-SIGHT CODE. `runtime_unreachable` says nothing was
 * established about whether the request arrived; this one is the daemon saying
 * it refused BEFORE handing anything to the owner, and that a resend with the
 * SAME `request_id` is safe - admission is at most once per id, so a resend can
 * never double-deliver. That makes it the one 503 the app may repeat on its own
 * (`admitChatDraft`'s bounded resend). A warm that gets it is dropped silently,
 * like every other warm failure (`use-warm-session`).
 *
 * Reads never answer it: they serve the cold facade with `cold_reason:
 * "owner-silent"` and `attaching: true` instead, so nothing on the read path
 * has to know this code.
 */
export const RUNTIME_BUSY_CODE = "runtime_busy";

/**
 * The session OWNER's refusal while its runtime is leaving - a build handover,
 * a signalled stop, a `/move`.
 *
 * NOT YET ON THE WIRE, AND KEPT ANYWAY. This constant names the code the backend
 * half of the change will put on that refusal (design of record section 6 B2);
 * today the desktop ladder does not send it. Captured from the real ladder rather
 * than read off a literal (`docs/evidence/owner-refusal-send/harness/capture-bodies.py`,
 * backend `origin/main` = `5bc34c90`): `RuntimeRetiring` is a `ValueError`
 * (`session/errors.py`) and the ladder's coded `except (ReceiptConflict, ValueError)`
 * arm covers only the attachment, profile-registry, superseded-token and
 * deletion-refused errors, so this one falls to `raise HTTPException(409, str(error))`
 * and arrives as `409 {"detail": "This session is switching to a newer build; the one
 * it loaded is gone from disk. The message was not admitted - send it again once the
 * new build is up."}` - a STRING, with no `code` for the renderer to read. So this
 * branch's retiring term is inert until that backend change ships: the refusal an
 * operator meets today still lands in the held state, and its own sentence is the
 * only thing on screen that says the message was not admitted. The app's answer to
 * the CODED shape is pinned in `scripts/canonical-chat.test.mjs` so the day the code
 * arrives the behaviour is already asserted; the frames ship the uncoded body,
 * because that is what a real owner answers with.
 *
 * WHY IT BELONGS WITH `runtime_busy` ANYWAY. Once coded, the fact is the same
 * kind: the refusal is raised from the latched departure BEFORE the message is
 * admitted, and its sentence says so in as many words. A send that meets it
 * provably does not exist on the owner, so the composer owes the text back rather
 * than a held claim whose whole content is that the outcome cannot be known.
 *
 * WHY THE CODE AND NEVER THE STATUS. A bare `409` establishes nothing about
 * admission: the receipt-conflict ladder, the attachment ladder and the profile
 * registry all answer one, and the conflicting-receipt case is a refusal of a
 * replay whose FIRST attempt may well have been admitted. `isRefusedBeforeAdmission`
 * therefore reads this field and not `status === 409`.
 *
 * WHY NOT A `retryable` FLAG either way. It is not a statement about admission in
 * EITHER direction, so it cannot be a safe positive or a safe negative: the
 * `runtime_busy` body the app does trust carries `"retryable": true` while
 * establishing that nothing was admitted (measured above), and the ladder's other,
 * admitting refusals set it to mean "a retry may help" (`SubagentChildUnavailable`
 * is the measured example). Keying on it would hand a payload back to the composer
 * for a message that may be on the owner - the one direction this classification
 * must never take. The code is the fact; a body's `retry_after_ms` is pacing, and it
 * is read where the backend sends it (`messageWithBusyResend`).
 */
export const RUNTIME_RETIRING_CODE = "runtime_retiring";

/**
 * The sentences a refusal composes into, one per code.
 *
 * NO sentence here names an update, and none tells the user to change what the
 * app manages: every one of these codes is a PAIRING condition, and pairing is
 * the app's own business to re-establish (design § 3.1, § 4's falsifiable
 * prediction). The two that can only be repaired by re-claiming say so; the two
 * that cannot be repaired from here state the fact and stop.
 *
 * ONE CONDITION, ONE TABLE, and this one is deliberately the narrower: it holds
 * the TRANSPORT classes - a plane nobody has claimed, a credential this app does
 * not hold, a request main could not complete - and it does not restate the
 * causes the pairing table owns. A `pairing.stale` code used to live here for the
 * successor condition and nothing ever emitted it: the daemon refuses with bare
 * prose, so no producer existed, while its sentence restated the successor cause
 * verbatim. Removing it is what keeps "which table words this condition" a
 * question with one answer (review round 1, MINOR-3; design round 1, D4).
 */
export const DESKTOP_REFUSAL_SENTENCE: Record<DesktopRefusalCode, string> = {
	[DESKTOP_REFUSAL_CODE.noCredential]:
		"This app is not paired with the running Local Operator server, so this control is unavailable.",
	[DESKTOP_REFUSAL_CODE.refused]:
		"This app's credential for the running Local Operator server was refused, so this control is unavailable.",
	[DESKTOP_REFUSAL_CODE.planeClosed]:
		"The running Local Operator server does not accept this app's desktop controls.",
	[DESKTOP_REFUSAL_CODE.transportFailed]:
		"The Local Operator server did not answer this request.",
};

/**
 * The two sentences MAIN writes into a refusal it synthesised itself.
 *
 * Declared here - the shared half of the desktop contract - because they are a
 * machine vocabulary rather than copy: main emits them, and the renderer has to
 * tell them apart from the DAEMON's own 503 so that "the app holds no credential"
 * is never reported as "the server's plane is shut". They are carried in
 * `detail.message` and rendered only by {@link DESKTOP_REFUSAL_SENTENCE}.
 */
export const DESKTOP_MACHINE_DETAIL = {
	/*
	 * NOTE for whoever greps for the ownership instruction this change removed:
	 * `noCredential` still READS like that sentence, and deliberately. The code is
	 * what `userFacingMessage` keys on, so this string is never rendered; it exists
	 * because the development proxy forwards a refusal body without declaring one,
	 * and `mcp-failure.ts` has to recognise main's own 503 by its text there. It is
	 * a machine vocabulary, not copy - which is why the sentence a user reads comes
	 * from `userFacingMessage` and this one is only ever compared (review round 1,
	 * NIT-5).
	 */
	noCredential: "Restart with a desktop-managed backend to use these controls.",
	transportFailed:
		"The backend could not complete this request. Check its connection and try again.",
} as const;

/** Whether a caught error's `code` is one of the refusal codes. */
export function isDesktopRefusalCode(
	code: string | undefined,
): code is DesktopRefusalCode {
	return (
		code !== undefined &&
		(Object.values(DESKTOP_REFUSAL_CODE) as string[]).includes(code)
	);
}

/**
 * The refusal code a status names on a route the desktop plane has to admit, or
 * undefined for a status that names none.
 *
 * The PATH is half the test, and it is what keeps a 401 from an ordinary route
 * out of this vocabulary: only `/v1/desktop/` is behind the plane's admission, so
 * a refusal there is about the PAIRING while the same status elsewhere is about
 * that route's own authorization.
 */
export function desktopRefusalCodeForStatus(
	path: string,
	status: number,
): DesktopRefusalCode | undefined {
	if (!path.startsWith("/v1/desktop/")) return undefined;
	if (status === 401 || status === 403) return DESKTOP_REFUSAL_CODE.refused;
	if (status === 503) return DESKTOP_REFUSAL_CODE.planeClosed;
	/*
	 * A 409 is deliberately NOT read this way. A conflict about the RESOURCE (a
	 * profile repair, a store that is busy) answers 409 on the same routes as a
	 * conflict about the PLANE, and only the answering process can say which: a
	 * declared code is what carries that answer. Measured: reading the status alone
	 * ate a profile conflict's own category. (This comment used to name a
	 * `pairing.stale` code as the discriminator; no such code exists — it was
	 * removed for having no producer.)
	 */
	return undefined;
}

export type DesktopResponse = { status: number; body: unknown };

/**
 * Whether the supervisor that actually fires wakes is working here.
 *
 * Rides every wake response because "will my scheduled task fire" cannot be
 * answered from the wake index: on macOS the supervisor is a LaunchAgent, and
 * its three failure states (platform unsupported, plist written but launchd not
 * addressable, installed but not running) are invisible in the index itself. A
 * listing that omitted this would invite a user to trust a schedule that
 * nothing is going to run.
 */
export type DesktopWakeSupervisor = {
	supported: boolean;
	running: boolean;
	/** The backend's own word for the state, shown verbatim rather than re-worded. */
	detail: string;
	/**
	 * Whether the probe could speak about THIS store at all.
	 *
	 * A fourth field the frozen interface did not name and the route sends
	 * anyway (`routes/desktop_wakes.py::_supervisor_info`), which the reviewer's R7
	 * asked the page to read: a store outside the real home is supervised by
	 * nothing, so `supported`/`running` describe SOMEBODY ELSE's launchd there and
	 * printing "the supervisor is not running" over it is a claim about a machine
	 * the probe never looked at. Optional, so a runtime that stops sending it
	 * reads as "the probe can speak" - which is the pre-field behaviour.
	 */
	verifiable?: boolean;
};

/**
 * One armed wake, as the machine-wide listing sends it.
 *
 * The fields are `WakeSchedule`'s plus the two the supervisor knows: `stale` is
 * its own seven-day predicate and `overdue_s` its own lateness measure, imported
 * from the supervisor rather than re-derived here, so the page and `lop wake
 * status` cannot disagree about whether a wake is still being pursued.
 *
 * `next_due_at` is epoch MILLISECONDS, like the pane's `WakeState` and unlike
 * every other clock on the desktop wire (epoch seconds). The renderer formats
 * both through `formatWakeDue`, which states the unit at its own boundary, so
 * the page does no time arithmetic of its own.
 */
export type DesktopWakeScheduleRow = {
	id: string;
	message: string;
	next_due_at: number | null;
	/** The recurrence in milliseconds, `null` for a single shot. */
	every_ms: number | null;
	until_at: number | null;
	limit: number | null;
	/** Deliveries already made, the honest "this is working" number. */
	fired_count: number;
	/** Seconds past `next_due_at`, the supervisor's own measure. */
	overdue_s: number;
	/** The supervisor's seven-day predicate: past it, it stops engaging the session. */
	stale: boolean;
	last_fired_at: number | null;
	last_attempt_at: number | null;
};

/**
 * One conversation that has wakes, with its wakes beneath it.
 *
 * The page's ROW is this conversation rather than each wake: the row's name is
 * the object the user can open, the wake lines are what it is armed to do, and
 * a conversation with three wakes is one thing rather than three (the run
 * pane's own rule one level down: one row per schedule, not per occurrence).
 *
 * `dormant` is stamped by a session STOP (`stopped_at` in the index) and
 * `ghost` by the supervisor's own test for a session with no transcript, so a
 * wake that cannot fire says so instead of printing an instant it will not keep.
 * `name` is best-effort (`resume.session_name`, a bounded read): an unnamed
 * session still lists, named by its id and its `cwd`.
 */
export type DesktopWakeEntry = {
	session_id: string;
	name: string;
	cwd: string;
	/** How the session came to exist, for grouping only. */
	origin: string;
	/** The index entry's own write stamp, epoch milliseconds. */
	updated_at: number;
	dormant: boolean;
	ghost: boolean;
	/** The soonest due instant across this conversation's wakes, or `null`. */
	next_due_at: number | null;
	schedules: DesktopWakeScheduleRow[];
};

/**
 * `wakes.list`'s answer: every wake-carrying session on this machine.
 *
 * `read_error` is carried rather than folded into an empty list, because "the
 * index could not be read" and "nothing is scheduled" are different sentences
 * and only one of them is true when the store is unreadable.
 */
export type DesktopWakesListResponse = {
	entries: DesktopWakeEntry[];
	generated_at: number;
	total: number;
	truncated: boolean;
	supervisor: DesktopWakeSupervisor;
	read_error: boolean;
};

/**
 * `wakes.create`'s answer.
 *
 * `created_session` says whether this call made the conversation (the dialog's
 * `A new conversation` branch) or armed into an existing one, which is what
 * decides whether the page can open it. `index_written: false` is a 200 with a
 * caveat: the transcript is the truth and the index is derived, so the next open
 * heals it - the arm still happened.
 */
export type DesktopWakeCreateResponse = {
	session_id: string;
	wake_id: string;
	next_due_at: number | null;
	created_session: boolean;
	supervisor: DesktopWakeSupervisor;
	/**
	 * The create's at-most-once receipt, as the route's own mechanism returns it.
	 *
	 * `unknown` rather than a guessed field: the backend stamps its replay marker
	 * onto the operation's own result (`desktop_receipts.run`), so the shape is
	 * the backend's to define, and this page never branches on it - the response
	 * fields it reads are typed above. A rename inside the receipt would change
	 * nothing a user can see, and typing a guess here would be a claim the wire has
	 * not made.
	 */
	receipt: unknown;
	index_written: boolean;
};

/**
 * The outcome of cancelling (or arming) one monitor, as the route's
 * `MonitorWriteReceipt` sends it (`routes/desktop_monitors.py::_receipt`).
 *
 * Shared by both writes on the wire; this client only sends the cancel today,
 * so the fields a cancel answers are the load-bearing ones - `monitor_id` names
 * the row that changed, `remaining` is what the conversation holds after it
 * (0 removes the index entry, which is also what releases the cleanup reap
 * guard), and `next_due_at` is always null after a cancel. A refusal is not a
 * value here: it travels as the error's `detail.message`.
 */
export type DesktopMonitorWriteReceipt = {
	session_id: string;
	monitor_id: string;
	name: string;
	next_due_at: number | null;
	remaining: number;
	already_armed: boolean;
	reactivated: boolean;
	receipt: string;
	index_written: boolean;
};

/*
 * THE PER-SESSION CODE REQUEST LEDGER (`code_requests.list`), the PR/MR list a
 * conversation carries: what it opened, what it acted on, what it mentions.
 *
 * WHAT IS LOCAL AND WHAT IS REMOTE. The rows' existence, relations, mentions
 * and `tool_output_only_count` are DERIVED locally from the session's own
 * transcript (`GET` never blocks on a forge), so a row renders as soon as the
 * read answers. The remote half - `summary`, `lanes`, `fetched_at`, `stale`,
 * `refresh_error` - is a cache of one host's last successful fetch, which is why
 * every one of those fields is optional: a session that has never refreshed (or
 * a host this machine holds no credential for, `link_only`) renders from the
 * local half alone and must not read an absence as a failure.
 */

/**
 * How this session relates to one code request, in the backend's own words.
 *
 * A UNION rather than a plain string, because every value here drives copy the
 * user reads (`opened`, `via subagent coder`, `unknown — possibly opened`) and
 * the group partition; a value this app has never heard of would have no honest
 * rendering, unlike a project STATUS which can paint raw (`DesktopProjectStatus`
 * makes that argument). `unknown` is the backend's explicit "possibly opened by
 * this session, not proved" and the UI must never upgrade it: a script that
 * merely PRINTED a PR URL is indistinguishable from one that created it without
 * the forge's own record.
 */
export type DesktopCodeRequestRelation =
	| "opened"
	| "mentioned"
	| "unknown"
	| "inherited";

/**
 * One lane's parsed review state (the design record's §C.5 machine).
 *
 * The LANE's raw name and state travel as strings for the reason
 * `DesktopProject.status` does: a newer backend may parse a state or serve a
 * lane this build has not seen, and the row's clause then prints the raw value
 * with neutral treatment rather than dropping a review that happened.
 */
export type DesktopCodeRequestLane = {
	lane: string;
	/**
	 * The round the lane's LATEST comment carries, or absent/null when no
	 * number could be parsed. The backend omits the key in that case
	 * (`rounds.py`'s `to_payload` writes it only when not None) - a lane with
	 * no placeable round still draws its state word and NO segments, because
	 * a segment count is a claim about how many rounds ran.
	 */
	round?: number | null;
	/** The header's parenthetical qualifier (`delta`, `fix verification`), if any. */
	qualifier?: string | null;
	state: string;
	/** The backend's own derived sentence (`remediation posted, fresh`). */
	state_copy?: string | null;
	freshness: string;
	/** `findings_open` | `clean` | `terminal` | `unstated`, the parser's class. */
	verdict_class?: string | null;
	/** The head the lane's latest comment reviewed, when its own Scope stated one. */
	reviewed_head?: string | null;
	reviewer?: string | null;
	verdict?: string | null;
};

/**
 * The CI figures for one row's head, as the adapter normalised them.
 *
 * `status` is the word every host can answer (`success` | `failure` |
 * `pending` | `unknown` | `none`); the COUNT counters are nullable because
 * GitLab pipeline state carries no job counts at all (`adapters/gitlab.py`
 * returns null for all four) and GitHub leaves them null when the host did
 * not carry them. The clause is built in one place (`code-review-model.ts`),
 * and `total === 0` with `status: "none"` is "No checks yet" rather than
 * "0/0 passed".
 */
export type DesktopCodeRequestCi = {
	status: string;
	passed: number | null;
	failed: number | null;
	pending: number | null;
	total: number | null;
	/** The host's own raw status word, when it sent one (GitLab pipelines do). */
	raw_status?: string | null;
	/**
	 * The checks page, when the host reported one. OPTIONAL for the same reason
	 * `comments` is: the design's row sketch (§D.6) does not list it, and a
	 * backend that omits it must not fail a parse.
	 */
	url?: string | null;
};

/** The fetched summary of the forge's own record, absent until first fetched. */
export type DesktopCodeRequestSummary = {
	state: string;
	draft: boolean;
	title: string;
	head_sha: string;
	/**
	 * The CI half, present-and-null when the fetched entry has no ci record
	 * yet. Nullable rather than optional because the backend writes the key
	 * with `entry.get("ci")` - a value that can be None - and a guard on
	 * `row.summary?.ci?.status` is what keeps one such row from throwing
	 * inside `ChatContent`'s render.
	 */
	ci?: DesktopCodeRequestCi | null;
	updated_at: number;
	/**
	 * How many comments the record carries, when the host reported it (§1's
	 * comment clause, `6 comments`). null means "not reported": the clause is
	 * omitted, never rendered as 0, and the backend sends the key with null
	 * rather than omitting it (`service.py`'s summary projection).
	 */
	comments?: number | null;
};

/**
 * How a subagent's open reached this session (`via subagent coder › reviewer`).
 *
 * `path` is the propagation chain (a depth-2 child shows both names); the flat
 * fields are the child's own record. Either may be absent on an older event, so
 * the row's tag falls back through `path` → `agent_role` → `label`.
 */
export type DesktopCodeRequestVia = {
	job_id?: string;
	label?: string;
	agent_role?: string;
	child_session_id?: string;
	path?: string[];
};

/** Where and how often this session's text mentions the row. */
export type DesktopCodeRequestMention = {
	sources: string[];
	count: number;
	last_at: number | null;
};

/** One row of the ledger: the identity half is always present, the rest gated. */
export type DesktopCodeRequestRow = {
	key: string;
	url: string;
	forge: string;
	host?: string;
	project: string;
	number: number;
	relation: DesktopCodeRequestRelation;
	/** Every relation the ref accumulated, strongest first (the audit half). */
	relations?: string[];
	via?: DesktopCodeRequestVia | null;
	/** The acts this session performed on the ref (`comment`, `merge`, ...). */
	acted: string[];
	mention: DesktopCodeRequestMention;
	/** No credential for this host: the row opens, and shows its remedy line. */
	link_only: boolean;
	/**
	 * The backend's own remedy sentence for a link-only row (`Link only -
	 * sign in with the gh CLI to track this one.` / `... this host isn't
	 * tracked yet.`), per FORGE - a gitea row is not "sign in with gh".
	 * Rendered VERBATIM instead of the client deriving a CLI from `forge`
	 * (agent review F8 / design D8 / UX U5).
	 */
	link_only_hint?: string | null;
	/**
	 * Why the row is only a link, when there is something to say (an
	 * unconfirmed host, a failed refresh, the scanner's note). Shown
	 * verbatim; never a guess.
	 */
	reason?: string | null;
	/**
	 * The epoch the row's host is cooling until, when the backend skipped this
	 * row's fetch for a rate limit (server row payload `cooling_until`, PR1b
	 * `039476dff3`). Present beside `reason`, whose cooling sentence names the
	 * same instant; rendered through the notice line, not read directly.
	 */
	cooling_until?: number | null;
	/** The scanner's note for an undecided relation (shown verbatim). */
	unknown_reason?: string | null;
	inherited_from?: string | null;
	summary?: DesktopCodeRequestSummary | null;
	lanes?: DesktopCodeRequestLane[] | null;
	fetched_at?: number | null;
	stale?: boolean;
	/** A failed refresh left the last known data in place; this is why. */
	refresh_error?: string | null;
};

/**
 * `code_requests.list`'s answer.
 *
 * `tool_output_only_count` is the collapsed group's size: mentions seen ONLY in
 * tool output are noise (a `gh pr list` dump can carry 158 URLs) and are counted
 * rather than listed; they do not gate the composer chip either. `cooling` is
 * per HOST (epoch seconds until the window opens), because the quota belongs to
 * the host and row-level repetition of one host's window would be noise.
 */
export type DesktopCodeRequestsList = {
	session_id?: string;
	revision: number;
	rows: DesktopCodeRequestRow[];
	tool_output_only_count: number;
	/**
	 * True when the collapsed count is CAPPED - the scan stops listing tool-only
	 * refs past a bound, and the model then renders the count with a `+` rather
	 * than presenting a truncated list as exact.
	 */
	tool_output_truncated?: boolean;
	/** Per-host cooling windows: host → epoch seconds the window lifts. */
	cooling?: Record<string, number>;
	/**
	 * The transcript scan's own state: `ready` when the index is current for the
	 * journal, `refreshing` while a scan is owed or running, `missing` when
	 * there is no journal to scan. The pane keeps its LOADING state while
	 * `refreshing` and the rows are empty - an empty answer mid-scan is not yet
	 * a claim that the session has no code requests (UX round 1, U2).
	 */
	scan_state?: string;
	updated_at?: number | null;
};

/**
 * `code_requests.refresh`'s 202 receipt: the scan half ran, the fetch half is
 * queued. `note` is the backend's own sentence about both halves.
 */
export type DesktopCodeRequestRefreshReceipt = {
	session_id?: string;
	accepted: boolean;
	keys?: string[];
	force?: boolean;
	note?: string;
};

/**
 * What a checkpoint MARKS: the reader's own message, or a finished turn.
 */
export type CheckpointKind = "user" | "completion";

/**
 * A settled turn's ending, when the journal can prove one.
 *
 * `open` is the live tail: no marker resolves it and no newer settled run
 * followed it, so the rail draws an in-progress dot rather than staying
 * silent about the turn the reader is sitting in.
 */
export type CheckpointOutcome = "complete" | "error" | "interrupted" | "open";

/**
 * How far a completion checkpoint's naming has got.
 *
 * `unavailable` is a FAILED call inside its cooldown (the marker is
 * persisted), not a pending one: the card shows the fallback text with no
 * "Generating…" line, because nothing is generating.
 */
export type CheckpointNamingState = "ready" | "pending" | "unavailable";

export type CheckpointNaming = {
	state: CheckpointNamingState;
	/** The model's name, or `null` while pending/unavailable. */
	name: string | null;
	/** One sentence, or `null`; `""` is a ready name that carries no summary. */
	summary: string | null;
};

/**
 * One checkpoint of the `sessions.checkpoints` manifest (design D9).
 *
 * The manifest deliberately omits fields rather than nulling them, and this
 * type keeps that: `outcome` is absent on checkpoints no attention marker
 * resolved (markers only exist from partway through a session's life, so
 * pre-mechanism turns have no outcome to show), and `naming` is present only
 * on COMPLETION checkpoints, because a name is attached to a finished turn.
 * A required field would force the renderer to invent a value the wire never
 * claimed.
 */
export type Checkpoint = {
	/** The journal entry id — the jump target and the warm's handle. */
	id: string;
	kind: CheckpointKind;
	/** 1-based turn ordinal, assigned structurally by the backend. */
	turn: number;
	/**
	 * Epoch SECONDS — the journal's own unit, not milliseconds. Converted once,
	 * where a label is formatted (`checkpointClockLabel`), the same way the
	 * transcript reducer converts a durable `entry.ts`.
	 */
	ts: number;
	/** The journal ordinal the tick's position is proportional to. */
	seq: number;
	/** User text, or the turn's closing answer text (flattened, capped). */
	text: string;
	outcome?: CheckpointOutcome;
	naming?: CheckpointNaming;
};

/**
 * The index's own state, as the manifest reports it.
 *
 * `building` and `stale` both mean "a scan is in flight over a previous
 * answer" — the rail renders whatever checkpoints arrived and pulses its top
 * mark, rather than hiding. `unsupported` is a REMOTE conversation, whose
 * journal is not on this machine; the backend answers it in place of an
 * error because it is a fact about where the bytes are, and the rail hides —
 * the same honest degradation as an empty manifest.
 */
export type CheckpointIndexState =
	| "ready"
	| "building"
	| "stale"
	| "error"
	| "unsupported";

/** The `sessions.checkpoints` 200 body (design D9). */
export type CheckpointManifest = {
	session_id: string;
	index: {
		state: CheckpointIndexState;
		/** The cache file's mtime, epoch seconds; absent on a cold answer. */
		built_at?: number;
	};
	checkpoints: Checkpoint[];
};

/**
 * The `sessions.checkpoints.warm` 200 body (design D9): ids this call took
 * ownership of, and the subset still waiting on a name. An id already named
 * (same digest) or inside its failure cooldown is accepted but not pending —
 * the rail's poll has nothing left to wait for on it.
 */
export type CheckpointWarmAnswer = {
	accepted: string[];
	pending: string[];
};

/**
 * What one find hit matched (D3/D9): a casefolded literal substring of what was
 * said (`exact`), or the bounded soft tier (`soft` — prefix, token-AND, or edit
 * distance <= 2 on 4+ character tokens).
 *
 * The tiers are the backend's and are rendered differently rather than
 * re-derived here: a client that guessed which hits were literal would differ
 * from the index exactly where the index's ranking is subtlest.
 */
export type ThreadFindTier = "exact" | "soft";

/**
 * The find answer's lifecycle state (D9); see the op's own comment for what
 * each one means and how the overlay degrades.
 */
export type ThreadFindState = "ready" | "building" | "error" | "unsupported";

/**
 * One message the query matched, with the snippet the results list renders.
 *
 * `ranges` are match offsets RELATIVE TO `snippet` (non-overlapping, oldest
 * first, at most five), so the client marks `snippet[start:end]` without
 * knowing the window offset into the message. They are always present — empty
 * for a soft hit, which has no literal occurrence of the query. `role` is the
 * wire vocabulary (`user`/`agent`); the backend translates the stored docs'
 * `assistant` so both clients read the same word.
 *
 * `ts` is the journal's own epoch SECONDS, not milliseconds — the same unit
 * every durable transcript entry carries; a caller that shows a clock converts
 * once, where it formats (the rail's `checkpointClockLabel` is the precedent).
 */
export type ThreadFindHit = {
	id: string;
	role: "user" | "agent";
	ts: number;
	snippet: string;
	ranges: [number, number][];
	tier: ThreadFindTier;
};

/**
 * The `sessions.find` 200 body (D9).
 *
 * `query` is echoed rather than assumed: the overlay debounces its input, so
 * responses can arrive out of order and it must be able to tell which of its
 * queries this answers. `partial` is true exactly when `hits` were ranked from
 * an index that does not reflect the journal's current tail (`building`),
 * never as a substitute for `truncated`, which reports the hit list itself
 * being cut at `limit`.
 */
export type ThreadFindAnswer = {
	query: string;
	state: ThreadFindState;
	partial: boolean;
	hits: ThreadFindHit[];
	truncated: boolean;
};

/**
 * How many bytes of serialized JSON body one desktop operation may carry.
 *
 * These live here, beside the schemas they bound, because the two were allowed
 * to disagree: the transport that fronts this vocabulary carried a bare
 * `262144` literal in two separate files while `sessions.message` promised
 * eight 1,000,000-char images, a declared contract 31x larger than the pipe.
 * One ordinary Retina screenshot busts 256 KiB, so the app refused payloads it
 * had just told the user it accepted. A budget that is not stated next to its
 * schema is a budget that drifts from it.
 *
 * Message-carrying ops get the larger budget because they carry user prose and
 * inline images. Every remaining op moves fixed-shape control fields whose
 * widest declared string is 64,000 characters (`instructions.update`,
 * `legacy.schedule.edit` and `legacy.agent.schedule.create` — all three, since
 * a list that names only some of the ops at the limit invites the next reader
 * to assume the unnamed one is narrower), so the tight budget there is a real
 * boundary on a malformed or hostile renderer payload rather than a limit any
 * legitimate request approaches.
 *
 * That claim used to read "the widest is a 32768-char credential" and was
 * FALSE, which is how this file reproduced next door the exact asymmetry it
 * exists to remove (round 1, R3): `legacy.agent.systemPrompt.update` declares
 * 1,000,000 characters and `sessions.fork` declares 200,000, both behind a
 * 262,144-byte pipe, and both reachable from real UI - the agent system-prompt
 * editor and the fork picker's message box. An inaccurate comment about a
 * limit is how the original bug survived review, so this one is now a
 * statement the table below actually satisfies.
 */
const DESKTOP_MESSAGE_BYTE_BUDGET = 880_000;
const DESKTOP_CONTROL_BYTE_BUDGET = 262_144;

/**
 * The budget for `legacy.agent.systemPrompt.update`, sized to its own schema.
 *
 * Its `systemPrompt` field declares 1,000,000 characters, so no smaller number
 * can be honest about what the schema promises. Unlike the message ops this
 * does not pass through the session control socket - it is a plain REST PUT to
 * `/v1/agents/{id}/system-prompt` - so the 900,000-byte `Prompt` wall and the
 * 1 MiB frame reader do not apply to it, and the budget is bounded by the
 * declared field rather than by a backend ceiling.
 *
 * 1,100,000 covers the full declared length of ordinary prose plus the
 * envelope. Text that escapes heavily (a C0 control serializes as a 6-byte
 * `\uXXXX`) can still exceed it while remaining legal by character count, and
 * is refused with the sized copy - the same accepted tradeoff the message
 * budget makes, not a gap.
 */
const DESKTOP_SYSTEM_PROMPT_BYTE_BUDGET = 1_100_000;

/**
 * Ops whose body carries user text and inline images, and so needs the room.
 *
 * 880,000 is the backend's real ceiling minus headroom, not a round number.
 * `Prompt.nonempty` in `local_operator/server/routes/desktop_sessions.py:101`
 * raises once `len(self.model_dump_json().encode()) > 900_000`, and behind
 * that sits the owner control socket's 1 MiB line reader
 * (`local_operator/session/runtime/server.py:100`, `_MAX_LINE_BYTES = 1 << 20`)
 * — 900,000 is itself that wall less ~14% envelope. So the wall is physical;
 * the question is only how close the client sits to it.
 *
 * Client and server measure very nearly the same bytes — `desktopEndpoint`
 * emits every field explicitly including defaults, in declaration order, and
 * pydantic v2 serializes raw UTF-8 like `JSON.stringify` — but "very nearly"
 * is the problem. Landing on the boundary turns a client-accepted message into
 * a server 409, which is a worse outcome than a local refusal that names the
 * numbers and leaves the composer editable. The 20,000-byte margin (~2.2%) is
 * the same discipline `local_operator/imaging.py:167-182` applies when it
 * repairs to a 1960px edge against a 2000px ceiling.
 */
const MESSAGE_OPS: ReadonlySet<string> = new Set([
	"sessions.message",
	"sessions.command",
	// `sessions.fork` declares the SAME 200,000-character text field as
	// `sessions.message` and carries it to the same session, so it belongs in the
	// same tier; leaving it on the control budget refused a fork message the
	// schema promised to accept (round 1, R3).
	"sessions.fork",
]);

/** The budget one op's serialized body must fit within. */
export function desktopRequestByteBudget(op: DesktopRequest["op"]): number {
	if (op === "legacy.agent.systemPrompt.update")
		return DESKTOP_SYSTEM_PROMPT_BYTE_BUDGET;
	return MESSAGE_OPS.has(op)
		? DESKTOP_MESSAGE_BYTE_BUDGET
		: DESKTOP_CONTROL_BYTE_BUDGET;
}

/**
 * How long a desktop request may run before the transport stops waiting for it.
 *
 * WHY PER OP RATHER THAN ONE LITERAL. Twenty seconds is right for the controls:
 * a write, a settings read or a catalogue call answers in milliseconds, so
 * twenty seconds of silence is a failure rather than a wait. Two other shapes
 * need longer, and they are long for DIFFERENT reasons — a local scan against
 * how much a user has USED this machine (the ledger reads), and a live fan-out
 * to providers over the network (see `PROVIDER_READ_OPS` below). Both are on
 * the same number because the number is a bound on how long a user may be made
 * to wait, not because their costs are alike.
 *
 * Measured against one isolated backend and one copy of the ledger (1,153,206
 * rows, 341 MB), same query, back to back: `analytics.get` for 30 days answered
 * in 12.1-17.8 s warm and 39.6 s with a cold page cache; for 7 days, 5.6-11.8 s.
 * The variance is the page cache, not the window. So a 20 s budget does not
 * bound a slow read, it GUARANTEES the read is abandoned part-way — and an
 * aborted `fetch` does not cancel the daemon's aggregation. Measured through a
 * timing tap in front of the same backend: the app gave up on a read the daemon
 * then completed 9.2 s later, and the app's retry put a second full scan on the
 * daemon while the first was still running.
 *
 * 90 s is 2.3x the worst cold read measured here, which is the headroom a cold
 * ledger needs on a machine that is also doing something else. It is still a
 * bound rather than an absence of one: a wedged backend ends the wait, and the
 * sentence it ends with says which of the two happened
 * ({@link desktopRequestDeadlineDetail}).
 */
const DESKTOP_CONTROL_DEADLINE_MS = 20_000;
const DESKTOP_LONG_READ_DEADLINE_MS = 90_000;

/**
 * Ops whose answer is an aggregate over the local usage ledger.
 *
 * Listed by SHAPE, because that is what the budget is sized for: each of these
 * reads `<config dir>/analytics.db` on the same machine as the app, so its cost
 * follows the ledger's size and whatever the page cache is holding rather than
 * anything about the request. `analytics.get` is the one measured above;
 * `sessions.report` walks a session's subtree in the same ledger (measured
 * 0.65-2.2 s here, which is inside the control budget today and on this list
 * because the scan behind it is the same one, not because it was seen to
 * exceed 20 s).
 */
const LEDGER_READ_OPS: ReadonlySet<string> = new Set([
	"analytics.get",
	/*
	 * The worst case of the same shape, and the reason the set is spelled by
	 * shape rather than by measured cost: `/analytics/models` is a grouped scan
	 * of the raw ledger with no covering index, measured in SECONDS on a 1.95 M
	 * row ledger where `analytics.get` measures 12-40 s cold. On the control
	 * budget it would be abandoned mid-read on nearly every open, so it is here
	 * beside the op it is a slower sibling of.
	 */
	"analytics.models",
	"sessions.report",
]);

/**
 * Ops whose answer is a provider-side read: a cache, or a live fan-out.
 *
 * A SECOND LONG-BUDGET SHAPE, and the reason it is written down separately is
 * that the first cut of this table claimed `usage.get` was "the same ledger
 * over the same span" — which is false, and a table whose rule does not
 * describe its own membership is one the next author edits by guesswork
 * (review round 1, R1). `/v1/desktop/usage`
 * (`local_operator/server/routes/desktop_catalogues.py`) answers from
 * `controller.cached_usage_reports()` — the provider controller's cache, which
 * does not cross the network — or, when the panel asks for a refresh, from
 * `controller.fetch_usage()`, a live fan-out to each provider's own quota
 * endpoint. The backend's own source draws the same line: the local-cost
 * question is "`/analytics`' question, answered from recorded token counts".
 *
 * So this op is on the long budget because a refresh is bounded by the network
 * and by the backend's per-account retries, not because anything local decides
 * its cost. `usageQueryOptions` already refuses to retry it at all.
 */
const PROVIDER_READ_OPS: ReadonlySet<string> = new Set(["usage.get"]);

/**
 * Ops whose answer requires this device's RELAY to fan out to every peer.
 *
 * A THIRD LONG-BUDGET SHAPE, and it is not either of the two above: nothing here
 * crosses the public network on this app's behalf, and nothing is a provider's
 * quota read. What makes it long is a loopback listing that dials each member and
 * waits for its answer, under budgets the BACKEND publishes rather than ones this
 * file may choose: `LISTING_PROBE_BUDGET_S = 12.0` for the fan-out and
 * `LISTING_CLIENT_TIMEOUT_S = 20.0` for the client above it
 * (`local_operator/network/relay.py`).
 *
 * THE APP'S DEADLINE MUST SIT ABOVE THE BACKEND'S, which is the whole reason these
 * are here: on the 20 s control budget this layer would give up FIRST and report a
 * failure about a read that was still working, and the give-up sentence cannot name
 * the cause (the same defect `sessions.transfer`'s envelope fixes on the write
 * side). 90 s is comfortably above the 20 s the daemon itself waits, and a mesh
 * whose peer answers neither is a state the tab reports rather than one the app
 * waits out.
 */
const MESH_READ_OPS: ReadonlySet<string> = new Set([
	"networks.list",
	"peers.list",
]);

/** Every op on the long budget, whichever of the two shapes put it there. */
const LONG_READ_OPS: ReadonlySet<string> = new Set([
	...LEDGER_READ_OPS,
	...PROVIDER_READ_OPS,
	...MESH_READ_OPS,
]);

/*
 * THE TRANSFER'S BOUND IS THE ONE OP WHOSE DEADLINE DEPENDS ON ITS OWN REQUEST.
 *
 * MIRRORED FROM THE BACKEND, NEVER CHOSEN HERE. `network/mobility.py` publishes
 * `move_client_bound_s(wait_s, keep, to)` — "the deadline a CLIENT's own request
 * must not be shorter than" — and every term below is one of its constants, named
 * so a reader can diff this against that file. The published answers at the
 * `wait_s=0` both routes default to are **145 s** for an offload, **415 s** for a
 * `keep` copy and **415 s** for a recall; the terms are 90 s (the peer's slow-op
 * budget), 30 s or 300 s (the relay's own held time for that shape), 10 s (the
 * control socket's answer coming back) and 15 s (the client's margin over the
 * route's answer).
 *
 * WHY THIS EXISTS AT ALL, and it is not symmetry: the desktop transport used to
 * give up at `wait_s + 15` against a route that answers at `wait_s + 30`, so a
 * user read "the move may have happened, check the other device" while the backend
 * was about to answer "nothing was deleted". The timeout's vaguer sentence always
 * won, because the client's own bound was shorter than the backend's. A recall is
 * the harder half: it is bounded by a BUDGET rather than a promise (the copy is
 * transcript-sized), so a client deadline that fires on one knows NOTHING about
 * the outcome and must report it as unknown — never as a refusal, and never retry
 * into a second move.
 */
const MOVE_OP_DEADLINE_S = 90;
const MOVE_OFFLOAD_CONFIRM_S = 30;
const MOVE_COPY_WAIT_S = 300;
const MOVE_CONTROL_SLACK_S = 10;
const MOVE_CLIENT_MARGIN_S = 15;

/**
 * The app's own margin over the route's published bound.
 *
 * The transport must outwait the route, so `moveClientBoundMs` is the FLOOR and
 * this is what makes the app's deadline strictly above it rather than exactly on
 * it — an answer landing on the boundary is the one case where a client that
 * waited long enough still reports its own timeout.
 */
const MOVE_APP_MARGIN_MS = 10_000;

/** One transfer request's shape, as the deadline needs it. */
export type MoveShape = { to: string; keep?: boolean; waitS?: number };

/**
 * The route's own bound for one transfer shape, in the terms it publishes.
 *
 * `to: "local"` is the recall, and it is NOT the offload's term with a different
 * direction: nothing is confirmed over the link, so what bounds it is the copy
 * (300 s) rather than the 30 s settle window — the mistake `move_bound_s`'s own
 * docstring was written to stop being published as "the formula for all of them".
 */
export function moveClientBoundMs(shape: MoveShape): number {
	const recall = shape.to === "local";
	const hold = recall || shape.keep ? MOVE_COPY_WAIT_S : MOVE_OFFLOAD_CONFIRM_S;
	const waitS = Math.max(0, shape.waitS ?? 0);
	return (
		(MOVE_OP_DEADLINE_S + hold + MOVE_CONTROL_SLACK_S + MOVE_CLIENT_MARGIN_S) *
			1000 +
		waitS * 1000
	);
}

/*
 * THE APPROVAL'S BOUND IS THE ONE OP THAT WAITS ON A HUMAN GESTURE.
 *
 * MIRRORED FROM THE BACKEND, NEVER CHOSEN HERE. `approvals.approve` signs through
 * `network/approvals.py::sign_decision`, which signs with `timeout=None` and so
 * takes the signer's own default: `keyagent.SIGN_TIMEOUT_SECONDS = 180.0` — past
 * it the key agent is killed and NOTHING is signed, so the backend's own answer
 * always arrives before 180 s plus a store round trip. A control-budget deadline
 * would abandon a prompt the operator was still reading more than two minutes
 * before the backend itself stops waiting, and would report this app's own
 * timeout for a decision the backend was still holding — the exact defect
 * `sessions.transfer`'s envelope fixed on the move side.
 *
 * The margin over the backend's number covers the store's file lock, the response,
 * and the signer's own teardown (`keyagent` gives a terminated helper 2 s to
 * exit). `approvals.deny` and `approvals.list` are deliberately NOT here: a deny
 * never signs ("ordinary, write-once, safe direction") and a list is a cold scan
 * of the device-local directory, so both keep the control budget.
 */
const PRESENCE_GESTURE_DEADLINE_MS = 180_000;
const APPROVAL_APPROVE_DEADLINE_MS = PRESENCE_GESTURE_DEADLINE_MS + 15_000;

/*
 * THE HUB'S WRITES ARE MODEL MERGES, so they sit on their own budgets, ABOVE the
 * backend's (agent review round 1, R2; UX U9).
 *
 * MIRRORED FROM THE BACKEND, NEVER CHOSEN HERE: `hub_sync/resolver.py` gives one
 * item `MERGE_ITEM_TIMEOUT_S = 120.0` of wall time (retries included), and
 * `apply`/`retry` first re-check that one item against the hub over the network.
 * On the 20 s control budget this layer gave up FIRST, told the person the update
 * "may or may not have reached the server", and their natural next press minted a
 * new request id (so the server's receipts could not dedupe it) and started a
 * SECOND concurrent merge.
 *
 * - `hub.apply` / `hub.retry`: one item = the 120 s merge + its network check and
 *   the write, with the same margin the move envelope uses (`MOVE_CLIENT_MARGIN_S`).
 * - `hub.check`: a network read of every linked item, and it applies nothing.
 * - `hub.applyAll`: SEQUENTIAL over every waiting item, so the honest bound scales
 *   with a number this file cannot know at request time. It is a generous fixed
 *   ceiling (five worst-case merges) rather than a promise; a run that outlasts it
 *   ends in the "still working" sentence and the poll shows what landed. The
 *   backend stops the run at the first systemic failure, so a typical long run is
 *   far shorter than the ceiling.
 */
const HUB_ITEM_MERGE_S = 120;
const HUB_ITEM_WRITE_DEADLINE_MS =
	(HUB_ITEM_MERGE_S + 30 + MOVE_CLIENT_MARGIN_S) * 1000;
const HUB_CHECK_DEADLINE_MS = 60_000;
const HUB_APPLY_ALL_DEADLINE_MS = 5 * HUB_ITEM_WRITE_DEADLINE_MS;

const HUB_WRITE_OPS: ReadonlySet<string> = new Set([
	"hub.apply",
	"hub.retry",
	"hub.check",
	"hub.applyAll",
]);

function hubWriteDeadlineMs(op: string): number | null {
	switch (op) {
		case "hub.apply":
		case "hub.retry":
			return HUB_ITEM_WRITE_DEADLINE_MS;
		case "hub.check":
			return HUB_CHECK_DEADLINE_MS;
		case "hub.applyAll":
			return HUB_APPLY_ALL_DEADLINE_MS;
		default:
			return null;
	}
}

/**
 * The deadline one request may run for.
 *
 * Takes the OP for every ordinary case and the whole REQUEST where the shape
 * decides the budget — today that is `sessions.transfer` alone, and it is the only
 * op whose answer may legitimately take minutes. A caller with the request in hand
 * should pass it; the string form is what a caller that only has an op uses (a
 * story, a test, a panel sizing its own spinner).
 */
export function desktopRequestDeadlineMs(
	request: DesktopRequest | DesktopRequest["op"],
): number {
	if (typeof request !== "string" && request.op === "sessions.transfer") {
		return moveClientBoundMs(request) + MOVE_APP_MARGIN_MS;
	}
	const op = typeof request === "string" ? request : request.op;
	// Op-keyed rather than request-keyed, because the gesture's bound is a property
	// of the op alone: a caller holding only the op string (a story, a test) gets
	// the same number the transport uses.
	if (op === "approvals.approve") return APPROVAL_APPROVE_DEADLINE_MS;
	const hub = hubWriteDeadlineMs(op);
	if (hub !== null) return hub;
	return LONG_READ_OPS.has(op)
		? DESKTOP_LONG_READ_DEADLINE_MS
		: DESKTOP_CONTROL_DEADLINE_MS;
}

/**
 * How long the RENDERER waits for a desktop control before calling it dead.
 *
 * Deliberately longer than the main process's own `fetch` deadline for the same
 * op - `desktopRequestDeadlineMs` plus this margin, rather than the 30 s literal
 * that used to sit in the renderer's wrapper against main's flat 20 s. The
 * invariant is the thing worth keeping: the renderer's bound only covers the case
 * main can never report (the IPC round trip itself never settling), so a backend
 * that answers slowly is still reported by the layer that actually knows the HTTP
 * status. Splitting it per op is what keeps that true now that main's deadline is
 * not one number: a flat 30 s against a 90 s ledger-read budget would have made
 * the renderer the layer that gives up first, and its copy cannot name the reason.
 *
 * It does NOT cover `desktopMedia`, whose transport allows 120 s for speech and
 * agent-ZIP transfers; that path is bounded separately and is not routed here.
 *
 * IT LIVES HERE, beside the deadline it derives from, because more than one
 * renderer module needs the renderer's bound and only this module is resolved as
 * a real module by every harness that bundles them (the desktop-api wrapper is
 * stubbed in several of them). A reader asking "how long does this request
 * really have" gets one answer with one definition.
 */
export const DESKTOP_DEADLINE_MARGIN_MS = 5000;

/** The renderer's own deadline for one request, derived from the transport's. */
export function desktopRequestTimeoutMs(
	request: DesktopRequest | DesktopRequest["op"],
): number {
	return desktopRequestDeadlineMs(request) + DESKTOP_DEADLINE_MARGIN_MS;
}

/**
 * The code a request that ran out of its own budget carries.
 *
 * A string, read off `DesktopControlError.code`, for the reason
 * `ReadFileBytesFailure` is a string: it has to survive IPC and a re-throw, and
 * the callers that act on it are deciding whether to run an expensive read
 * again rather than catching a class.
 */
export const DESKTOP_DEADLINE_EXCEEDED_CODE = "deadline_exceeded";

/**
 * The refusal main answers a READ RECEIPT with when the window is not in the
 * foreground, and the sentence the user reads for it.
 *
 * ONE sentence rather than a machine register translated into copy, unlike the
 * stream details in `shared/desktop-stream-notice.ts`: this refusal is already
 * addressed to the reader ("View these completions in the foreground..."), and
 * user copy is the register that names the true condition in the reader's own
 * terms. A second sentence for the same fact would be a second authority.
 *
 * THE SENTENCE SPEAKS IN THE SET'S TERMS AND NAMES NO COUNT, and both halves are
 * deliberate (UX round 4, U4-1). The control the reader just clicked says
 * `Mark all 2 read` over its own count, so a refusal answering in the singular
 * ("this completion ... it") disagreed with the gesture it was answering at
 * every count above one — measured with one row and with two. Nothing here names
 * a number, so nothing here can disagree at any count: the count is the
 * control's, and on success the receipt's, which pluralises by count the way
 * `markAllReadReceipt` does ("1 has a newer result and stays unread" against
 * "2 have newer results and stay unread"). Pluralising THIS sentence by count
 * would instead need main to build it per request, and that is incompatible with
 * the property the next paragraph relies on: ONE constant, produced by main and
 * matched by the renderer across a boundary that carries only text.
 *
 * Declared here, and as a STRING, for the deadline code's reason above — it has
 * to survive IPC and a re-throw — with one consequence specific to it:
 * `ipcRenderer.invoke` rebuilds main's rejection as a plain `Error` and keeps
 * only the message, so the renderer's transport has no typed field to read and
 * must recognise the refusal by the words main sent. That makes this constant
 * the ONE authority for both halves: the producer (`src/main/desktop-ipc.ts`)
 * refuses with it, and the classifier (`desktop-api.ts`, `isForegroundRequired`)
 * reads it. A test pins the two together
 * (`scripts/attention-seen.test.mjs`), because a reworded producer against an
 * unchanged classifier is how a deliberate refusal would quietly go back to
 * being reported as an unreachable backend.
 *
 * It is NOT the sentence for a transport failure, and the two must stay
 * distinguishable in the renderer: a refusal means the backend was never asked,
 * and a retry against a focused window is the reader's own next move.
 */
export const DESKTOP_FOREGROUND_REQUIRED_CODE = "foreground_required";
export const DESKTOP_FOREGROUND_REQUIRED_MESSAGE =
	"View these completions in the foreground before marking them read.";

/**
 * Ops that change nothing on the server, and so may be told "nothing was read".
 *
 * An ALLOWLIST, deliberately, and the direction of the guess is the point: an
 * op nobody classified here gets the cautious sentence, which says the request
 * may or may not have reached the server. The other direction tells a user who
 * just sent a message that nothing happened, and the obvious next act is to
 * send it again (design round 1, D1). The costs are asymmetric, so the default
 * is the cheap one — and a new read op that lands on the cautious sentence is a
 * wording nit rather than a wrong claim about a write.
 */
const READ_ONLY_OPS: ReadonlySet<string> = new Set([
	"capabilities",
	"accounts.list",
	"analytics.get",
	"analytics.models",
	"approvals.list",
	"commands.entities",
	"commands.list",
	"config.get",
	"credentials.list",
	"hub.updates",
	"info.get",
	"instructions.get",
	"legacy.agent.get",
	"legacy.agent.history",
	"legacy.agent.schedules.list",
	"legacy.agents.list",
	"legacy.job.get",
	"legacy.jobs.list",
	"legacy.models",
	"legacy.models.providers",
	"legacy.schedule.get",
	"legacy.schedules.list",
	"mcp.catalog",
	"mcp.list",
	"models.catalogue",
	"networks.list",
	"peers.list",
	"profiles.get",
	"profiles.list",
	// A ranked read over the same store the listing reads: it changes nothing, so
	// a failure is reported with a read's patience rather than a write's caution.
	"projects.search",
	"providers.list",
	// The pre-emptive quota read: a cache-first verdict that changes nothing on
	// the server. It may trigger the backend's own bounded usage fetch, but no
	// state the user can see is written.
	"quota.notice",
	// A reader that changes nothing (the route's own docstring): the straggler
	// census, and the app re-reads it rather than caching a stale count.
	"runtimes.list",
	"sessions.aside.get",
	"sessions.checkpoints",
	"sessions.failovers",
	"sessions.find",
	"sessions.get",
	"sessions.history",
	"sessions.list",
	"sessions.preview",
	"sessions.report",
	"sessions.search",
	"sessions.variables.list",
	"skills.list",
	"subagents.transcript",
	"teams.get",
	"teams.list",
	"usage.get",
]);

/**
 * Ops whose answer is a panel the user can open again, for the remedy clause.
 *
 * "Reopen the panel" is only advice if there IS one; `capabilities` is asked
 * for by the app itself and by no surface the user opens, so it gets "ask
 * again" instead (review round 1, D2 — a remedy clause that does not exist on
 * the surface reading it is not a remedy).
 */
const PANEL_READ_OPS: ReadonlySet<string> = new Set([
	"analytics.get",
	"analytics.models",
	"networks.list",
	"peers.list",
	"usage.get",
	"sessions.report",
	"info.get",
	"sessions.failovers",
]);

/**
 * What a request that ran out of its budget says, and which failure it was.
 *
 * The transport had ONE sentence for every failure it could produce: "The
 * backend could not complete this request. Check its connection and try again."
 * For a refused socket that is true. For a read that was still running when the
 * app stopped waiting it is false twice over — the backend WAS completing that
 * request, and "try again" asks the user to start a second multi-second scan
 * against a daemon that is still executing the first one.
 *
 * So the two are separated by both a sentence and a status: this outcome is a
 * 504, which is what a gateway timeout means, and it is deliberately NOT a 503 —
 * `backendErrorKind` reads 503 and `null` as "unreachable" and answers them
 * with a remedy ("Restart the app") that arrives on the wrong surfaces.
 *
 * THREE SENTENCES, because the app knows three different things:
 *
 * - a long read (`LONG_READ_OPS`): the wait is the app's own and the read has
 *   no side effect, so "nothing was read" is knowable;
 * - any other read (`READ_ONLY_OPS`): same claim, shorter patience;
 * - everything else, which may be a WRITE: the app stopped waiting, and it does
 *   not know whether the server applied the request. Saying "nothing was
 *   changed" there would be a claim the app cannot check, and a user who reads
 *   it re-sends — which is the one outcome the copy must not invite.
 *
 * Each names what happened, what it means, and what to do, in that order, the
 * order `panel-states.tsx` sets for panel copy. The seconds figure is the APP'S
 * OWN LIMIT and says so: it is checkable, it explains an otherwise inexplicable
 * "nothing happened", and it does not read as a measurement of how long the
 * read needed (design round 1, D5). And the subject is named in all three —
 * "the app stopped waiting", never "it" (design round 2, D10): the nearest
 * noun to that verb is the read, so the pronoun made the READ the thing that
 * gave up, which is the one actor in the sentence that cannot.
 */
export function desktopRequestDeadlineDetail(
	op: DesktopRequest["op"],
	deadlineMs: number,
): { code: string; message: string } {
	const seconds = Math.round(deadlineMs / 1000);
	const code = DESKTOP_DEADLINE_EXCEEDED_CODE;
	/*
	 * A MOVE THAT RAN OUT OF TIME IS NOT A FAILED REQUEST, and this is the one op
	 * where the difference decides what the user does next. The route returns as soon
	 * as it has a definite outcome but may legitimately hold one for minutes (145 s
	 * for an offload, 415 s for a copy), so a client-side deadline can fire while the
	 * move is still progressing on the other device. `deadline_exceeded` is one of the
	 * move's OWN unconfirmed codes (`MOVE_REFUSAL_CODES`, and the set the route
	 * journals rather than replays), so the sentence says what that code means: the
	 * request was sent, the outcome is unknown, re-read the session — and never send
	 * a second move for it.
	 */
	if (op === "sessions.transfer") {
		return {
			code,
			message: `The app waits up to ${seconds} seconds for a move, and it was still running when the app stopped waiting. The move was asked for, so its outcome is unknown from here: read the session again before moving it anywhere else.`,
		};
	}
	/*
	 * AN APPROVAL THAT RAN OUT OF TIME WAS STILL WAITING ON A HUMAN, and unlike a
	 * read there is no "nothing happened" to promise: the OS prompt is what decides,
	 * so a decision the app stopped waiting for may still land. The instruction is
	 * therefore the move's shape — read the record again — with its own second
	 * half: answering again is SAFE, because the store keeps the first decision and
	 * refuses a second rather than repeating one (write-once, F3).
	 */
	if (op === "approvals.approve") {
		return {
			code,
			message: `The app waits up to ${seconds} seconds for an approval, and the signing prompt was still open when it stopped waiting. The request was sent, so the decision may or may not have landed: read the approvals again — if the record still waits, answering it again is safe, because the store keeps the first decision and refuses a second.`,
		};
	}
	/*
	 * A HUB WRITE THAT RAN OUT OF TIME IS STILL RUNNING, and the person's next move
	 * is to wait, not to repeat it (a repeat is a second merge). The sentence says
	 * so in the app's own words, without a number of seconds or a mention of what
	 * "the server" did (UX round 1, U9).
	 */
	if (HUB_WRITE_OPS.has(op)) {
		return {
			code,
			message:
				"This is taking longer than expected. It may still finish; the mark will update.",
		};
	}
	if (READ_ONLY_OPS.has(op)) {
		return {
			code,
			message: PANEL_READ_OPS.has(op)
				? `The app waits up to ${seconds} seconds for this panel's data, and the read was still running when the app stopped waiting. Nothing was read; reopen the panel to ask again.`
				: `The app waits up to ${seconds} seconds for this read, and it was still running when the app stopped waiting. Nothing was read; ask again.`,
		};
	}
	return {
		code,
		message: `The app waits up to ${seconds} seconds for this request, and it was still running when the app stopped waiting. It may or may not have reached the server; check the result before repeating it.`,
	};
}

/**
 * The largest budget any op may claim.
 *
 * The dev proxy reads its request body as a stream and cannot know the op
 * until the JSON is parsed, so it bounds the READ by this and leaves the
 * per-op refusal to `requestDesktop`, which both transports already call. That
 * keeps one authority for the per-op number instead of a second copy that can
 * drift, which is exactly how `262144` ended up in two files disagreeing with
 * the schema between them.
 */
export const MAX_DESKTOP_REQUEST_BYTES = Math.max(
	DESKTOP_MESSAGE_BYTE_BUDGET,
	DESKTOP_CONTROL_BYTE_BUDGET,
	DESKTOP_SYSTEM_PROMPT_BYTE_BUDGET,
);

/**
 * Bytes the dev proxy's REQUEST ENVELOPE adds on top of the op body.
 *
 * The proxy weighs `{op, sessionId, requestId, text, images, mode}` off the
 * wire; `desktopRequestByteBudget` weighs only the body `{request_id, text,
 * images, mode}` that reaches the backend. Bounding the streamed read at
 * `MAX_DESKTOP_REQUEST_BYTES` therefore truncated a MAXIMAL legal message into
 * a 413 in dev - a message `requestDesktop` and the backend would both accept,
 * refused ~50 bytes from the ceiling (review round 1, F5).
 *
 * The envelope is bounded, which is what makes a constant allowance safe
 * rather than a guess: `op` is a string literal from a closed set (longest
 * `"sessions.interrupt"`), `sessionId` is a 12-char id and `requestId` a 36-char
 * UUID, plus their keys, quotes, colons and commas. 256 is comfortably above
 * that worst case and still far too small to admit a body the per-op check
 * would refuse - the proxy bounds the READ, and `requestDesktop` still applies
 * the exact per-op budget afterwards. `desktop-contract.test.mjs` measures the
 * worst case against this constant rather than restating it, so adding a longer
 * op name fails there instead of silently truncating here.
 */
export const MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES = 256;

/**
 * What the untargeted 413 backstops say when they fire.
 *
 * One constant for the two transports because this string reaches the user
 * verbatim in the send-error banner, and a copy in each file is how two
 * refusals for one condition start wording it differently. It names both
 * remedies rather than the overflowing one: by the time a body reaches a
 * backstop the op is all that is left, so which term overflowed is precisely
 * what these call sites cannot see. The renderer's pre-flight is where the
 * sized, specific copy comes from; this is the sentence for the paths that
 * pre-flight does not cover (review round 1, Q-3).
 */
export const DESKTOP_REQUEST_TOO_LARGE_DETAIL =
	"This message is too large to send in one request. Remove an image, or split the text across two messages.";

/**
 * The same backstop sentence, scoped to the SURFACE the op belongs to.
 *
 * One sentence for every op was wrong wherever the op is not a chat message.
 * `legacy.agent.systemPrompt.update` is reachable from the agent system-prompt
 * editor, and a user who saved a long prompt there read "This message is too
 * large to send in one request. Remove an image, or split the text across two
 * messages." - three claims that are all false in that surface: it is not a
 * message, there are no images, and a system prompt is one field that cannot be
 * split across two of anything (round 2, N4).
 *
 * This is the backstop, so it still cannot name a SIZE - by the time a body
 * reaches `requestDesktop` the op is all that is left. What it can do is name a
 * remedy that exists on the surface the user is looking at. Sized copy comes
 * from the renderer's pre-flight, which runs before admission where the numbers
 * are still known.
 *
 * `DESKTOP_REQUEST_TOO_LARGE_DETAIL` remains the message-tier sentence and the
 * streaming dev proxy's answer, because that proxy bounds its READ before the
 * JSON is parsed and so genuinely cannot know which op it is refusing.
 */
export function desktopRequestTooLargeDetail(op: DesktopRequest["op"]): string {
	if (op === "legacy.agent.systemPrompt.update")
		return "This system prompt is too large to save in one request. Shorten it.";
	if (op === "sessions.fork")
		return "This first message is too large to send with the fork. Shorten it, or send it in the new conversation instead.";
	if (op === "sessions.command")
		return "This command is too large to send in one request. Shorten it, or put the text in a message instead.";
	if (MESSAGE_OPS.has(op)) return DESKTOP_REQUEST_TOO_LARGE_DETAIL;
	// Control ops move fixed-shape fields; reaching this means a field far past
	// anything a legitimate UI submits, so the sentence names the field rather
	// than a remedy that assumes prose.
	return "This request is too large to send. Shorten the text in this form.";
}

/**
 * The largest ENVELOPE the dev proxy may read before refusing outright.
 *
 * Distinct from `MAX_DESKTOP_REQUEST_BYTES`, which bounds the op BODY. Only
 * the streaming proxy needs this: every other caller measures a body.
 */
export const MAX_DESKTOP_ENVELOPE_BYTES =
	MAX_DESKTOP_REQUEST_BYTES + MAX_DESKTOP_ENVELOPE_OVERHEAD_BYTES;

/**
 * The budget a chat message body must fit, exported for the renderer's
 * pre-flight check.
 *
 * The renderer refuses an oversize message BEFORE it calls `admitChatDraft`,
 * because only there does it still know the numbers (how much is text, how
 * much is images) and only there is the composer still editable. Main's guard
 * stays as the untargeted backstop it always was.
 */
export const DESKTOP_MESSAGE_BUDGET_BYTES = DESKTOP_MESSAGE_BYTE_BUDGET;

/**
 * The system-prompt budget, exported for the same reason: the agent
 * system-prompt editor now runs its own pre-flight, and a second copy of the
 * number is how the pipe and the schema drifted apart in the first place. The
 * character cap it is weighed beside is `DESKTOP_SYSTEM_PROMPT_MAX_CHARS`,
 * declared at the top of this file with the schema that reads it.
 */
export const DESKTOP_SYSTEM_PROMPT_BUDGET_BYTES =
	DESKTOP_SYSTEM_PROMPT_BYTE_BUDGET;
export type DesktopStreamEvent = {
	streamId: string;
	kind: "data" | "error" | "end";
	data?: string;
	detail?: string;
	/**
	 * The HTTP status that refused this stream, when one did.
	 *
	 * A REFUSAL is not a transport failure and the difference is user-visible:
	 * the desktop plane answers 404 for a session this machine does not have, and
	 * the one path that reaches it without validating the id first is the
	 * notification click (which deliberately does NOT spend a `sessions.get`
	 * round trip on the latency path). Without the code, that case fell into the
	 * generic `unavailable` branch and the reader got "The event stream was
	 * refused (404)." — transport text, saying what happened and neither what it
	 * means nor what to do.
	 *
	 * Optional because not every emitter has one: a socket that died mid-stream
	 * and a frame-budget overflow are failures, not refusals.
	 */
	status?: number;
};

/**
 * Whether the machine-wide feed socket is live, as the sidebar needs it.
 *
 * It lives in the contract rather than in `desktop-feed.ts` because it is a
 * RENDERER-visible shape: the sidebar renders the disconnected line from it, so
 * it travels over IPC and belongs with the other wire types.
 */
export type DesktopFeedState = { connected: boolean };

export type DesktopStreamSubscription = {
	streamId: Promise<string>;
	dispose: () => void;
};

/**
 * Media relay vocabulary (speech, transcription, agent import, and canonical
 * session attachments). The schema and endpoint map live in main
 * (`desktop-media.ts`); this is the renderer-facing type so preload and callers
 * agree on the shape.
 */
export type DesktopMediaRequest =
	| { op: "speech.create"; request: Record<string, unknown> }
	| { op: "speech.agent"; agentId: string; request: Record<string, unknown> }
	| {
			op: "transcription.create";
			fileName: string;
			mimeType: string;
			fields: Record<string, string>;
	  }
	| { op: "agent.import"; fileName: string }
	| { op: "agent.export"; agentId: string }
	// A durable transcript row references an image by content digest with the
	// payload stripped, and the JSON transport's envelope has nowhere to put
	// bytes — which is what puts a screenshot fetch on this relay rather than
	// beside the other session operations.
	| { op: "sessions.attachment"; sessionId: string; digest: string }
	/*
	 * The same fetch, scoped to a CHILD of the named session.
	 *
	 * The parent's op above cannot serve a child's rows: its route resolves the
	 * digest against the session whose transcript holds the reference, and a
	 * child session is not a user session, so the parent's path refuses it. The
	 * backend ships the child-scoped twin
	 * (`/v1/desktop/sessions/{id}/children/{child}/attachments/{digest}`) in the
	 * same window as its `transcript` sibling, so the reader that already reads
	 * a child's page from that route family resolves that page's images through
	 * this one.
	 *
	 * Both ids are the same `^[a-f0-9]{12}$` the rest of the desktop surface
	 * validates on and neither is a path: main owns the URL, as it does for
	 * every op here.
	 */
	| {
			op: "subagents.attachment";
			sessionId: string;
			childId: string;
			digest: string;
	  };

export type DesktopMediaResponse =
	| { status: number; kind: "bytes"; mimeType: string; data: Uint8Array }
	| { status: number; kind: "json"; body: unknown }
	| {
			status: number;
			kind: "error";
			detail: string;
			/**
			 * The pairing-family refusal this was, when it was one.
			 *
			 * Optional because a transport need not declare one: main does (see
			 * `src/main/desktop-media.ts`), and the development proxy forwards a refusal
			 * body without one. Carried at all so a media refusal the plane wrote is
			 * composed into this app's own sentence rather than echoed as its diagnosis,
			 * exactly as the JSON transport's refusals are (design § 3.5, § 5.1).
			 */
			code?: DesktopRefusalCode;
	  };

export type DesktopAPI = {
	request: (request: DesktopRequest) => Promise<DesktopResponse>;
	openAuthorization: (operationId: string, reopen?: boolean) => Promise<void>;
	/** Binary/multipart relay; present only under the Electron preload. */
	media?: (
		request: DesktopMediaRequest,
		bytes: Uint8Array | null,
	) => Promise<DesktopMediaResponse>;
	/** Watch-lease heartbeat; main adds can_notify. Electron only. */
	watchHeartbeat?: (args: {
		sessionId: string;
		subscriptionId: string;
		visible: boolean;
		focused: boolean;
	}) => Promise<DesktopResponse>;
	/**
	 * Tell main this pane has stopped displaying `sessionId` (review round 2,
	 * R2-4). Electron only, and optional: absent means the pre-fix behaviour, where
	 * the claim stood until the window closed.
	 */
	releaseWatchHeartbeat?: (args: {
		sessionId: string;
	}) => Promise<DesktopResponse>;
	/** Notification click -> open this conversation. Never answers a gate. */
	/**
	 * A notification click, with the conversation it names and - when the banner was
	 * about a console surface - the surface to select once the conversation is on
	 * screen (design 12.3).
	 *
	 * The second argument is OPTIONAL on purpose: it is additive on a payload that
	 * already carries an explicit `null` for the catalogue case, so a renderer that
	 * ignores it opens the conversation exactly as it did before, and a sender that
	 * predates it simply never passes one.
	 */
	onOpenConversation?: (
		callback: (sessionId: string, surface?: string) => void,
	) => () => void;
	/** `/exit`: close this window. Detach-only; the backend keeps sessions
	 * running. Main applies the normal unsaved-state guard. Electron only. */
	closeWindow?: () => Promise<void>;
	/** Authenticated canonical session stream. Present only when the Electron
	 * preload is live; browser development uses the server-side stream proxy. */
	stream?: {
		subscribe: (
			args: {
				sessionId: string;
				epoch?: string;
				afterSeq?: number;
				/**
				 * The open-frame negotiation (`docs/DESKTOP_API.md`), on the subscription
				 * that carries the snapshot page. Sent by the caller rather than fixed in
				 * main because only the RENDERER knows whether it read the capability -
				 * and a page whose `limit` changed unit for a reader that does not read
				 * `runs` is exactly what the capability exists to prevent. Optional,
				 * and absent means the backend answers today's page byte for byte.
				 */
				openFrame?: boolean;
			},
			onEvent: (event: DesktopStreamEvent) => void,
		) => DesktopStreamSubscription;
	};
	/**
	 * The machine-wide desktop feed, held by MAIN and not by this window.
	 *
	 * Absent in browser development, where there is no relay and no native
	 * delivery to be told about — a renderer with no `feed` must keep the polling
	 * behaviour it has today rather than waiting for a stream that cannot exist.
	 *
	 * Subscribe is a VIEW subscription and nothing more: main opens the feed on
	 * its own (gated on the backend's capability) and stays subscribed with no
	 * window at all, which is the state the operator reported — app alive in the
	 * dock, nothing on screen, and a completion announced to nobody.
	 */
	feed?: {
		subscribe: (onFrame: (frame: DesktopFeedFrame) => void) => () => void;
		watchState: (onState: (state: DesktopFeedState) => void) => () => void;
	};
	/**
	 * The conversation main was launched to display, or null.
	 *
	 * A VALUE rather than an event, and that is the point (B3): the initial
	 * session has to be readable before the renderer's first paint, because a
	 * recreated window rehydrates its persisted `activeSessionId` and paints THAT
	 * conversation first. Delivering the id as a post-load IPC instead showed the
	 * user the wrong conversation and then swapped it, which reads as a click
	 * that landed on the wrong row.
	 */
	initialSession?: string | null;
	/**
	 * Whether main created this window to open the CATALOGUE (review round 2,
	 * R2-1), read from the same argv and resolved through the same reader.
	 *
	 * Additive and optional like every other post-contract field: absent means "no
	 * catalogue intent", which is what an older main says, and that degrades to
	 * the pre-fix behaviour (restore the last conversation) rather than to an
	 * error. It is NOT the same claim as `initialSession: null`, and that
	 * distinction is the finding: `null` is also an ordinary launch, whose
	 * correct answer is "restore what you had open".
	 */
	initialCatalogue?: boolean;
};

export type DesktopCapabilities = {
	desktop_contract: number;
	desktop_available: boolean;
	desktop_auth: "bearer";
	features: Record<string, number>;
};

/**
 * `GET /v1/desktop/quota-notice`, as the route sends it.
 *
 * THE RENDERER'S TWIN of the backend's `QuotaNoticeResult` (core PR1/
 * PR2). A schema rather than a bare type because it is the WIRE'S half of the
 * contract, not a convenience: the tests that stub this route bind their
 * fixtures to it, so a fixture cannot drift from the shape the real route
 * sends (its producer builds it in `server/routes/desktop_quota.py` from
 * `providers/quota_notice.py`'s verdict).
 *
 * `state` is the whole vocabulary, including the "show nothing" states,
 * because it is also the diagnostics carrier; the notice's own shown set is
 * `quota-notice.ts`'s list. No `identity` or email ever appears here -- the
 * route is built to leave both out. `title` is the short form and `body` the
 * full sentence; `actions` arrive in the order the builder composed.
 */
export const QUOTA_NOTICE_SCHEMA = z.object({
	state: z.enum([
		"ok",
		"depleted",
		"limit_reached",
		"unverified",
		"unknown",
		"not_applicable",
	]),
	provider: z.string(),
	kind: z.enum(["balance", "subscription", "radient", "none"]),
	model_free: z.boolean(),
	title: z.string(),
	body: z.string(),
	actions: z.array(
		z.object({
			id: z.enum(["open_url", "resend_verification", "refresh"]),
			label: z.string(),
			url: z.string().nullable().optional(),
		}),
	),
	resets_at_ms: z.number().int().nullable().optional(),
	checked_at_ms: z.number().int(),
	age_ms: z.number().int().nullable().optional(),
	source: z.enum(["cached", "live"]),
});

export type QuotaNotice = z.infer<typeof QUOTA_NOTICE_SCHEMA>;
export type QuotaNoticeAction = QuotaNotice["actions"][number];
export type QuotaNoticeState = QuotaNotice["state"];

export type ProviderMethod = {
	/** The provider a flow acts on; `auth.start` and `auth.key` take this. */
	id: string;
	/**
	 * Stable identity of the METHOD within its provider's chooser. Distinct
	 * from `id` because one provider can offer several ways to sign in that all
	 * act on the same provider, and keying the chooser on `id` collided.
	 */
	method_id: string;
	label: string;
	kind: "api_key" | "browser" | "device";
	requires_secret_input: boolean;
	paste_fallback: boolean;
	/**
	 * The model this method would make the default on a machine with none, as
	 * the backend's one suggestion map states it. Optional because backends
	 * before the suggested-defaults change do not send it; absent and `null`
	 * both mean "no suggestion to show", and nothing is derived in its place.
	 */
	suggested_model?: SuggestedModel | null;
};

/** A backend-owned model suggestion: the id to write and the name to show. */
export type SuggestedModel = { id: string; name: string };

/**
 * What a successful sign-in or key save did to the default model.
 *
 * The backend decides and writes it (`plan_login_defaults`, the same planner
 * the terminal uses), and the renderer only renders the `receipt` sentence and
 * offers "Change": re-deriving the decision here would be a second planner that
 * can disagree with the one that actually wrote the config.
 *
 * - `hosting`/`model` set: this is what was written.
 * - `hosting` null with a `receipt`: nothing was written, only explained.
 * - the whole field `null`: an existing working default was left alone.
 */
export type DefaultsApplied = {
	hosting: string | null;
	/** The model ID. */
	model: string | null;
	/** The model's display name, e.g. "Claude Opus 5.5". */
	model_name: string | null;
	/** One user-facing sentence describing what happened. */
	receipt: string;
};

/**
 * The result of `auth.key` (PUT /v1/auth/providers/{id}/key).
 *
 * Every field is optional: a backend before key validation answers `{}`. A
 * REJECTED key never arrives here -- it is a 422 whose `detail` names the
 * reason, and nothing is stored. `valid: null` is "saved, but not checked",
 * with `reason` saying why.
 */
export type SaveKeyResult = {
	valid?: boolean | null;
	reason?: string | null;
	defaults_applied?: DefaultsApplied | null;
};
export type DesktopProvider = {
	id: string;
	name: string;
	storage_id: string;
	search_aliases: string[];
	auth_methods: ProviderMethod[];
	local: boolean;
	/** Usable without further setup: has a credential, or needs none. */
	configured: boolean;
	/** Needs no credential at all (a local server). NOT "reachable". */
	credential_optional: boolean;
	/** A credential is actually present, in the store or the environment. */
	has_credential: boolean;
	stored_credentials: number;
	base_url: string | null;
	/** See `ProviderMethod.suggested_model`; optional for older backends. */
	suggested_model?: SuggestedModel | null;
	/*
	 * The additive fields of the provider-catalogue contract (`provider_catalogue`
	 * capability), which both this app's composer and the TUI read. Optional
	 * because a backend that predates the capability omits them: readers fall
	 * back to what the older snapshot carried, and the composer's provider lists
	 * are licensed by the capability itself.
	 */
	/** The clean title the backend owns: "OpenAI" for "OpenAI (ChatGPT Plus/Pro)". */
	brand?: string;
	/** The declared capability vocabulary (`chat`/`tts`/`stt`). */
	capabilities?: string[];
	/** The machine form of the TUI's three-plus-two credential states. */
	state?:
		| "logged_in"
		| "env_key"
		| "needs_login"
		| "local_ready"
		| "local_unconfigured";
	/**
	 * The stored account's label when the provider holds exactly ONE credential
	 * row; `null` (or absent) otherwise — the account-level choice stays in
	 * `LogoutPicker`.
	 */
	identity?: string | null;
	/** Stored credential rows; the same count as `stored_credentials`, named for the logout rows. */
	account_count?: number;
};
export type AuthOperation = {
	id: string;
	provider: string;
	state:
		| "starting"
		| "waiting"
		| "input_required"
		| "succeeded"
		| "failed"
		| "cancelled"
		| "expired";
	message: string;
	auth_url: string | null;
	instructions: string | null;
	input_required: boolean;
	prompt_id: string | null;
	expires_in: number;
	/*
	 * The fields below are additive (backend suggested-defaults change) and are
	 * optional because an older backend omits them. Every reader falls back to
	 * what the older snapshot already carried: `instructions` for the device
	 * code, `auth_url` for the page, and "paste only when asked" for the input.
	 */
	/** What the sign-in changed about the default model; only on `succeeded`. */
	defaults_applied?: DefaultsApplied | null;
	/** A device flow's one-time code, as its own field. */
	user_code?: string | null;
	/**
	 * A loopback alias for the SAME page as `auth_url`, reported by every
	 * callback flow on the newer backend (`http://localhost:<port>/launch`), and
	 * never by a device flow. It is not a second page and not a device page: a
	 * reader that names a provider to the user takes `auth_url`'s host, which is
	 * what the panel does (code round 1 M1).
	 */
	launch_url?: string | null;
	/**
	 * True when the paste box is only a FALLBACK: the flow completes on its own
	 * when the browser redirects back, and the box exists for the case where it
	 * cannot (Anthropic). False/absent with `input_required` means the paste is
	 * the flow itself.
	 */
	input_optional?: boolean;
};
export type BackendSetting = {
	key: string;
	section: string;
	label: string;
	kind:
		| "bool"
		| "enum"
		| "int"
		| "float"
		| "text"
		| "list"
		| "cascade"
		// A remappable hotkey (`keymap.*`). Its own kind on the wire because the
		// editor for it LISTENS for a keystroke rather than accepting text - which
		// is why a plain text input was wrong for these two rows even though the
		// registry's help says "press the key you want".
		| "hotkey"
		| "readonly";
	help: string;
	value: unknown;
	default: unknown;
	is_default: boolean;
	minimum: number | null;
	maximum: number | null;
	members: string[];
	choices: { value: unknown; label: string; description: string }[];
	empty_unsets: boolean;
	redacted: boolean;
	/*
	 * The four fields below are ADDITIVE and OPTIONAL, and an older server sends
	 * none of them: `local-operator` and this app release independently, and the
	 * desktop app talks to whatever server is installed. Every one of them is
	 * therefore read with a fallback (see `backend-settings-tiers.ts` for `tier`,
	 * the gate check in `backend-setting-row.tsx` for `gated_by`), and a missing
	 * value degrades to the behaviour this surface had before the field existed
	 * rather than to a broken row.
	 */
	/**
	 * The server's own tier, once a backend projects one. The UI answers without
	 * it (a curated map + drift test); this is the seam that lets the map be
	 * deleted rather than a dependency the section waits on.
	 */
	tier?: "core" | "advanced" | null;
	/**
	 * A consequence worth stating beside the row wherever it renders. The
	 * registry owns this sentence, so the renderer never spells it out a second
	 * time: it is shown in danger ink, outside the help text and never behind a
	 * disclosure, because it is a consequence rather than detail.
	 */
	warning?: string;
	/**
	 * The registry's own example value, for a field whose shape is not obvious
	 * from its label (`host order` takes host slugs; a price takes a JSON pair).
	 */
	placeholder?: string;
	/**
	 * The key whose value decides whether this row may be edited at all. A child
	 * of a feature that is switched off renders disabled and says which switch.
	 */
	gated_by?: string | null;
	/**
	 * A FIFTH additive field, and the reason the four above are no longer "the
	 * four": which SURFACE a `hotkey` row's value belongs to — `"app"` (a
	 * binding inside the terminal UI) or `"desktop"` (a global shortcut this app
	 * owns). Absent means `"app"`, which is exactly today's behaviour for every
	 * hotkey row an older server serves, so a client that ignores the field
	 * stays correct: the field's arrival changes nothing until a surface reads
	 * it, and this one is read only to switch the capture rules of the quick-send
	 * row (see `setting-control.tsx`).
	 */
	hotkey_scope?: "app" | "desktop" | null;
	/**
	 * A SIXTH additive field: what an `int`/`float` row COUNTS, as a plain
	 * lowercase noun (`"hours"`), and `""` on every row that counts nothing in
	 * particular. With `minimum`/`maximum` it is the whole contract a bounded
	 * duration control needs, and it exists because a renderer cannot tell "this
	 * int is hours" from its key. The stored value is ALWAYS in this unit: a
	 * control that shows "7 days" writes 168. Absent on a server that predates it,
	 * which is read as "no unit" and degrades to the plain number field the row
	 * always had (the delegated-retention row has a key-keyed fallback, see
	 * `retention-duration.ts`).
	 */
	unit?: string | null;
};
/**
 * The one-time "delegated sessions were cleaned up" notice, as
 * `GET /v1/desktop/sessions` carries it in the additive field
 * `delegated_cleanup_notice` (`null` or absent when there is nothing to say).
 *
 * SERVED UNTIL ACKNOWLEDGED: the GET is a non-consuming PEEK - every list
 * answer keeps carrying the field while the store's `notice_acknowledged` flag
 * is unset (which is what lets a second window see the same notice), and the
 * dismissal's `POST /v1/desktop/delegated-cleanup-notice/ack` is the one write
 * that flips it. The renderer lifts the field out of every answer at the
 * transport (`desktopResult`) into `delegated-cleanup-notice-store`, which
 * holds it until the reader dismisses it - a notice kept only in the response
 * that carried it would be gone with the next re-render of whatever fetched it.
 */
export type DelegatedCleanupNotice = {
	/** Finished sentences, one per line; rendered verbatim, never re-worded. */
	message: string;
	/** Sessions removed so far. */
	removed: number;
	/** The window the removal used, in hours. */
	max_age_hours: number;
	/** True while a backlog is still draining (the message already says "so far"). */
	in_progress: boolean;
	/** ISO timestamp of the first removal. */
	first_removal_at: string;
	/** A LOWER BOUND on the bytes freed (the sizer caps its walk), or null. */
	freed_bytes_estimate: number | null;
	/** Where the per-removal record lives, for display. */
	record: string;
};
export type BackendSettings = {
	sections: {
		name: string;
		title: string;
		scope: string;
		description: string;
	}[];
	settings: BackendSetting[];
};

/**
 * The text-to-speech paths the daemon would take, as `GET /v1/tts/paths` reports
 * them (`local_operator/tts/cascade.py::resolve_voice_path`).
 *
 * The wire spellings are the daemon's own `VoicePath` values, so they are
 * compared as strings rather than mapped to app names: the same value travels in
 * the `X-Radient-Speech-Path` header of a served call, and a second spelling
 * here would be a second vocabulary for one fact.
 */
export type VoicePath =
	| "provider_tts_radient"
	| "provider_tts_elevenlabs"
	| "provider_tts_openai"
	// No usable path. Appears in availability and refusal payloads only.
	| "none";

/**
 * One rung's availability, with the sentence the daemon wrote for it.
 *
 * `available` answers "a PERSISTED credential exists for this rung", not "the
 * call will succeed" - a refused key or an empty balance surfaces at synthesis
 * time. The surface must not upgrade it into a promise; that caveat is the
 * daemon's, stated in its own module docstring.
 */
export type VoicePathRung = {
	path: VoicePath;
	available: boolean;
	reason: string;
};

/** The resolver's report: the chosen path, why, and every rung's state. */
export type VoicePathResolution = {
	path: VoicePath;
	reason: string;
	/** Fixed cascade order, `none` excluded. */
	rungs: VoicePathRung[];
	/**
	 * Whether this surface can synthesize AT ALL - true when any rung is
	 * available. Derived by the daemon, never stored, so it cannot disagree with
	 * `rungs`; a reader that walked the rungs itself would be re-deriving it.
	 */
	servable: boolean;
};

/**
 * The session half of a `wakes.create` body.
 *
 * Two mutually exclusive shapes on the wire, decided by which one the caller
 * set: `{session_id}` arms into a conversation that exists, `{cwd, target?}`
 * has the backend create the conversation first. `target` rides with `cwd`
 * because it is a property of the conversation being created, and sending it
 * beside a `session_id` would be a second answer to a question the session
 * already answers.
 */
function wakeSessionHalf(request: {
	sessionId?: string;
	cwd?: string;
	target?: { kind: "agent" | "team"; name: string };
}): Record<string, unknown> {
	if (request.sessionId) return { session_id: request.sessionId };
	return {
		...(request.cwd ? { cwd: request.cwd } : {}),
		...(request.target ? { target: request.target } : {}),
	};
}

/**
 * The timing fields of a wake write, present only when they were set.
 *
 * Absence is meaningful on both writes: `create` derives what it can (a wake
 * with no `every` is a one-shot, and one with neither `in` nor `at` is
 * refused by the backend's own constructor), and `edit` applies the fields it
 * was given against the schedule it holds, so an omitted bound is "leave this
 * alone" rather than "clear this".
 */
function wakeTiming(request: {
	in?: string;
	at?: string;
	every?: string;
	until?: string;
	limit?: number;
}): Record<string, unknown> {
	return {
		...(request.in !== undefined ? { in: request.in } : {}),
		...(request.at !== undefined ? { at: request.at } : {}),
		...(request.every !== undefined ? { every: request.every } : {}),
		...(request.until !== undefined ? { until: request.until } : {}),
		...(request.limit !== undefined ? { limit: request.limit } : {}),
	};
}

/**
 * Refuse a publication target that names only one of its two fields.
 *
 * WHY THIS EXISTS BESIDE THE SCHEMA'S OWN `.refine` (security review round 1,
 * S-1): the refinement is what a CALLER meets, and this is the same rule one
 * boundary later, where the path is composed. Both are needed for the property
 * the comments promised — "a half-specified target is refused rather than
 * silently published to the public hub" — because the failure mode was that a
 * half pair parsed and then composed a plain `/publish`: a PUBLIC publication
 * with no error anywhere, on the one field where failing open is a disclosure.
 *
 * It throws rather than returning a refusal because this is a programming error
 * (a cast hole, a dynamic object with `tenantId: undefined`), not a state a user
 * can be in: the dialog builds the pair as one unit.
 */
function assertPairedPublicationTarget(request: {
	visibility?: "org";
	tenantId?: string;
}): void {
	/*
	 * ONE PREDICATE WITH THE SCHEMA'S, AND A PRESENCE TEST RATHER THAN A DEFINED
	 * TEST (security review round 2, S-2). `!== undefined` read `""` as "present"
	 * while the composition below reads it as "absent" -- the assert passed and the
	 * query was dropped, which is the same silent public publication S-1 closed for
	 * the undefined half. `Boolean` makes the two halves agree on what "a tenant"
	 * is, so an empty string throws like a missing one. `""` is unreachable from
	 * the renderer (`id` is `min(1)`), which is why this is the second boundary's
	 * promise rather than a live hole.
	 */
	if (Boolean(request.visibility === "org") !== Boolean(request.tenantId)) {
		throw new Error(
			'A publication target needs both `visibility: "org"` and `tenantId`, or neither: one half would publish to the public hub.',
		);
	}
}

export function desktopEndpoint(request: DesktopRequest): {
	path: string;
	method: string;
	body?: unknown;
} {
	switch (request.op) {
		case "capabilities":
			return { path: "/v1/capabilities", method: "GET" };
		case "runtimes.list":
			// `probe=false` is load-bearing rather than an optimisation: the census
			// reads BUILD VERSIONS, and a probed row spends a loopback connect per
			// runtime on a machine that can hold dozens.
			return { path: "/v1/desktop/runtimes?probe=false", method: "GET" };
		/*
		 * The mesh reads. Both are plain GETs with no parameters at all - the backend
		 * reads THIS device's own relay, so there is nothing for the client to scope it
		 * by, and a network NAME would be the wrong thing to send anyway (a device in
		 * two networks asks once and gets both).
		 */
		case "peers.list":
			return { path: "/v1/desktop/peers", method: "GET" };
		case "networks.list":
			return { path: "/v1/desktop/networks", method: "GET" };
		/*
		 * The fleet read, and the path is the DESKTOP plane's rather than the relay's
		 * (`/api/asks`): the two answer the same rows today, but this client reaches
		 * the daemon it is paired with, not the phone relay, and the desktop route is
		 * the one behind this app's own bearer.
		 */
		case "asks.list":
			return { path: "/v1/desktop/asks", method: "GET" };
		/*
		 * THE THREE MESH WRITES. Each path segment is `encodeURIComponent`ed even
		 * though `meshId` already refuses `/`, `.` and `%`: the schema is this
		 * client's check, and a redirect or a hand-built request must not be able to
		 * turn a device id into a path fragment. `device: null` on an invite is the
		 * route's own "unbound token" — an invite any device may redeem once.
		 */
		case "networks.invite":
			return {
				path: `/v1/desktop/networks/${encodeURIComponent(request.networkId)}/invite`,
				method: "POST",
				body: { role: request.role, device: request.deviceId ?? null },
			};
		case "networks.member.remove":
			return {
				path: `/v1/desktop/networks/${encodeURIComponent(request.networkId)}/members/${encodeURIComponent(request.deviceId)}`,
				method: "DELETE",
				// The NETWORK'S NAME, as typed: see the op's own comment for why the
				// route takes a name rather than a bool.
				body: { confirm: request.confirm },
			};
		case "sessions.transfer":
			return {
				path: `/v1/desktop/sessions/${encodeURIComponent(request.sessionId)}/transfer`,
				method: "POST",
				body: {
					to: request.to,
					// Sent explicitly rather than omitted-when-false: `keep` decides whether
					// the SOURCE'S COPY IS DELETED, so the request says which move it is
					// rather than leaving the route's default to answer for a drop a user
					// made from a menu that offered the copy.
					keep: request.keep ?? false,
					wait_s: request.waitS ?? 0,
					// Omitted while absent, and this one is load-bearing: the route
					// journals an UNCONFIRMED move under this key so a retry replays the
					// recorded outcome instead of moving twice, and a request with no key
					// is a different (unjournalled) request on purpose.
					...(request.requestId ? { request_id: request.requestId } : {}),
				},
			};
		case "approvals.list":
			return { path: "/v1/desktop/approvals", method: "GET" };
		/*
		 * The decision paths carry the record's OWN id, `encodeURIComponent`ed even
		 * though the schema already refuses `/`, `.` and `%`: the pattern is this
		 * client's check, and a hand-built request must not be able to turn an id
		 * into a path fragment (the same rule the mesh writes state).
		 */
		case "approvals.approve":
			return {
				path: `/v1/desktop/approvals/${encodeURIComponent(request.approvalId)}/approve`,
				method: "POST",
			};
		case "approvals.deny":
			return {
				path: `/v1/desktop/approvals/${encodeURIComponent(request.approvalId)}/deny`,
				method: "POST",
			};
		case "profiles.list":
			return { path: "/v1/desktop/profiles", method: "GET" };
		case "profiles.get":
			return {
				path: `/v1/desktop/profiles/${encodeURIComponent(request.name)}`,
				method: "GET",
			};
		case "profiles.install":
			return {
				path: "/v1/desktop/profiles/install",
				method: "POST",
				body: { request_id: request.requestId, name: request.name },
			};
		case "profiles.create":
			return {
				path: "/v1/desktop/profiles",
				method: "POST",
				body: {
					request_id: request.requestId,
					name: request.name,
					...request.fields,
				},
			};
		case "profiles.update":
			return {
				path: `/v1/desktop/profiles/${encodeURIComponent(request.name)}`,
				method: "PATCH",
				body: { request_id: request.requestId, ...request.fields },
			};
		case "hub.updates":
			return { path: "/v1/desktop/hub/updates", method: "GET" };
		case "hub.check":
			return {
				path: "/v1/desktop/hub/updates/check",
				method: "POST",
				body: {
					request_id: request.requestId,
					...(request.kind ? { kind: request.kind } : {}),
					...(request.name ? { name: request.name } : {}),
				},
			};
		case "hub.apply":
			return {
				path: "/v1/desktop/hub/updates/apply",
				method: "POST",
				body: {
					request_id: request.requestId,
					kind: request.kind,
					name: request.name,
					...(request.prefer ? { prefer: request.prefer } : {}),
					...(request.acknowledgeUnknownBaseline !== undefined
						? {
								acknowledge_unknown_baseline:
									request.acknowledgeUnknownBaseline,
							}
						: {}),
					...(request.dryRun !== undefined ? { dry_run: request.dryRun } : {}),
				},
			};
		case "hub.applyAll":
			return {
				path: "/v1/desktop/hub/updates/apply-all",
				method: "POST",
				body: {
					request_id: request.requestId,
					...(request.kind ? { kind: request.kind } : {}),
				},
			};
		case "hub.retry":
			return {
				path: "/v1/desktop/hub/updates/retry",
				method: "POST",
				body: {
					request_id: request.requestId,
					kind: request.kind,
					name: request.name,
				},
			};
		case "teams.list":
			return { path: "/v1/desktop/teams", method: "GET" };
		case "teams.get":
			return {
				path: `/v1/desktop/teams/${encodeURIComponent(request.name)}`,
				method: "GET",
			};
		case "teams.create":
			return {
				path: "/v1/desktop/teams",
				method: "POST",
				body: { request_id: request.requestId, ...request.fields },
			};
		case "teams.update":
			return {
				path: `/v1/desktop/teams/${encodeURIComponent(request.name)}`,
				method: "PATCH",
				body: { request_id: request.requestId, ...request.fields },
			};
		case "sessions.list": {
			/*
			 * Built as a query string rather than by interpolation, because four of the
			 * parameters are store data: a team name is whatever the operator called it,
			 * and a `&` or a `#` in one would otherwise change the request's meaning
			 * instead of scoping it.
			 *
			 * THE ORDER IS PART OF THE COMPATIBILITY PROMISE. `limit` then
			 * `include_archived` are the two parameters this request has always carried,
			 * and they come first so a request that names none of the paging parameters
			 * serialises to the exact bytes it sent before those existed - which is what
			 * an older daemon is promised.
			 */
			const params = new URLSearchParams();
			params.set("limit", String(request.limit ?? 100));
			// Omitted when false, for the reason `sessions.search`'s own query states:
			// the pre-flag request is what an older backend must keep seeing, and
			// `false` is the route's default anyway.
			if (request.include_archived) params.set("include_archived", "true");
			/*
			 * The paging four, appended only when asked for. `with_counts` follows
			 * `include_archived`'s rule rather than `cursor`'s: it is a boolean whose
			 * route default is false, so omitting it is the pre-change request, while
			 * `scope_kind`/`scope_name`/`cursor` are absent-or-present values.
			 *
			 * A HALF SCOPE IS SENT AS SENT. This schema admits `scope_kind` without
			 * `scope_name` (they are two optional fields, not a discriminated pair), and
			 * that is deliberate: the daemon refuses the half by name, which is the
			 * behaviour a client bug should meet rather than a client-side guess at
			 * which half it meant. Dropping the pair here would turn a bug into an
			 * unscoped answer drawn under one team.
			 */
			if (request.scope_kind) params.set("scope_kind", request.scope_kind);
			if (request.scope_name) params.set("scope_name", request.scope_name);
			if (request.cursor) params.set("cursor", request.cursor);
			if (request.with_counts) params.set("with_counts", "true");
			// Appended LAST and omitted when false, `with_counts`'s rule rather than
			// the paging three's: it is a boolean whose route default is false, so the
			// ordinary request keeps the exact bytes it sent before this flag existed.
			if (request.include_peers) params.set("include_peers", "true");
			return {
				path: `/v1/desktop/sessions?${params}`,
				method: "GET",
			};
		}
		/*
		 * The one write behind the notice's lifecycle: the dismissal's ack. The GET
		 * above is a PEEK (`delegated_cleanup_notice` stays on every answer until
		 * this lands), so this is the only op that stops the store serving it -
		 * idempotent, and sent once per dismissal.
		 */
		case "delegated_cleanup_notice.ack":
			return {
				path: "/v1/desktop/delegated-cleanup-notice/ack",
				method: "POST",
			};
		case "sessions.search": {
			// `encodeURIComponent` rather than interpolation: a query is whatever
			// the user typed, and `&`, `#` or a space in it would otherwise change
			// the request's meaning (or truncate it) instead of being searched for.
			const query = new URLSearchParams({
				q: request.q,
				limit: String(request.limit ?? SESSION_SEARCH_DEFAULT_LIMIT),
			});
			// Omitted when false rather than sent as `include_archived=false`: the
			// default IS false on the route, so the request this app sends for the
			// ordinary case stays byte-identical to the one it sent before the flag
			// existed - which is what keeps the control a strict superset of the old
			// behaviour against a backend that has not learned the flag yet.
			if (request.include_archived) query.set("include_archived", "true");
			return {
				path: `/v1/desktop/sessions/search?${query}`,
				method: "GET",
			};
		}
		case "sessions.archive":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/archive`,
				method: "POST",
				// The desired state, never a toggle: see the op's own comment for why a
				// retried toggle is the bug this shape exists to make impossible.
				body: { archived: request.archived },
			};
		case "sessions.delete":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}`,
				method: "DELETE",
				// The user's own confirmation, echoed on the wire: the route requires
				// it, so this op cannot be reached without a dialog having been
				// answered (see the op's comment).
				body: { confirmed: true },
			};
		case "sessions.create":
			return {
				path: "/v1/desktop/sessions",
				method: "POST",
				body: {
					request_id: request.requestId,
					/*
					 * OMITTED, not nulled, for a configuration run: the backend resolves the
					 * folder itself (see the field's own note), and sending an empty string
					 * would be a different request from the one this feature means to make —
					 * it would trip the `min(1)` on the backend's own `cwd` validator and
					 * report a mistake nobody made.
					 */
					...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
					/*
					 * THE DEVICE THE PANE PICKED (`features.peers`), and it is omitted for every
					 * draft nobody aimed at a peer - the same additive rule `target`, `model` and
					 * `draft_id` follow, so an ordinary create is byte-for-byte what it was.
					 *
					 * THIS LINE IS THE WHOLE OF THE HEADER CONTROL'S CREATE PATH. The schema above
					 * accepted `peer` and the store passed it down, but the body is composed HERE,
					 * field by field, and this file never mapped it - so "start a new chat and send
					 * it to another device" posted `{request_id, cwd}` while the chip said
					 * `New on build-box`, and the conversation was created locally with the chip
					 * then relabelled `On this device` (UX round 1, U1 - a silent success that
					 * reports the wrong machine).
					 */
					...(request.peer ? { peer: request.peer } : {}),
					...(request.target ? { target: request.target } : {}),
					...(request.model ? { model: request.model } : {}),
					// Omitted, not nulled, when the pane has no minted id: see the field's
					// own note for the byte-identity promise this keeps.
					...(request.draftId ? { draft_id: request.draftId } : {}),
					...(request.purpose ? { purpose: request.purpose } : {}),
				},
			};
		case "sessions.preview":
			return {
				path: "/v1/desktop/sessions/preview",
				method: "POST",
				body: {
					request_id: request.requestId,
					cwd: request.cwd,
					...(request.target ? { target: request.target } : {}),
					...(request.model ? { model: request.model } : {}),
				},
			};
		case "sessions.draft":
			return {
				path: "/v1/desktop/sessions/draft",
				method: "POST",
				body: {
					request_id: request.requestId,
					cwd: request.cwd,
					...(request.target ? { target: request.target } : {}),
					...(request.model ? { model: request.model } : {}),
				},
			};
		case "sessions.get":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}`,
				method: "GET",
			};
		case "sessions.history": {
			const query = new URLSearchParams({
				limit: String(request.limit ?? 100),
			});
			if (request.beforeId) query.set("before_id", request.beforeId);
			/*
			 * `open_frame=1` only when the caller negotiated it (see the request
			 * schema): the unit of `limit` changes with the flag, so a page served a
			 * shape the caller does not read is worse than today's page.
			 */
			if (request.openFrame) query.set("open_frame", "1");
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/history?${query}`,
				method: "GET",
			};
		}
		case "sessions.checkpoints":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/checkpoints`,
				method: "GET",
			};
		case "sessions.checkpoints.warm":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/checkpoints/warm`,
				method: "POST",
				/*
				 * Omitted, not zeroed: an absent `ids` IS the rail-open arm (the backend
				 * selects its own default), and an absent `limit` leaves that selection
				 * its own number — sending 8 here would be a second copy of the
				 * backend's `DEFAULT_WARM_LIMIT` that could drift from it.
				 */
				body: {
					...(request.ids ? { ids: request.ids } : {}),
					...(request.limit !== undefined ? { limit: request.limit } : {}),
				},
			};
		case "sessions.find": {
			// `encodeURIComponent` rather than interpolation, for `sessions.search`'s
			// reason: a query is whatever the user typed, and `&`, `#` or a space in
			// it would otherwise change the request's meaning (or truncate it)
			// instead of being searched for. `limit` is ALWAYS sent (the route's
			// default is a second authority, and `truncated` on the answer is a fact
			// about the list the caller actually asked for).
			const query = new URLSearchParams({
				q: request.q,
				limit: String(request.limit ?? THREAD_FIND_DEFAULT_LIMIT),
			});
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/find?${query}`,
				method: "GET",
			};
		}
		case "subagents.transcript": {
			const query = new URLSearchParams({
				limit: String(request.limit ?? 100),
			});
			if (request.beforeId) query.set("before_id", request.beforeId);
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/children/${request.childId}/transcript?${query}`,
				method: "GET",
			};
		}
		case "sessions.message":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/messages`,
				method: "POST",
				body: {
					request_id: request.requestId,
					text: request.text,
					images: request.images ?? [],
					mode: request.mode ?? "prompt",
					/*
					 * ABSENT, not empty, when the app has nothing to say: an older harness
					 * validates this body with `extra="forbid"`, so a key present-but-null
					 * would be refused where a missing one is simply a legacy body. That is
					 * why these are conditional spreads rather than `?? undefined` values
					 * (which `JSON.stringify` would drop anyway - stated so a reader does
					 * not "simplify" them into a shape whose behaviour depends on the
					 * serializer).
					 */
					...(request.inputMode ? { input_mode: request.inputMode } : {}),
					...(request.inputPath ? { input_path: request.inputPath } : {}),
				},
			};
		case "sessions.command":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/commands`,
				method: "POST",
				body: {
					request_id: request.requestId,
					command: request.command,
					args: request.args ?? "",
					images: request.images ?? [],
				},
			};
		case "sessions.answer":
			/*
			 * ONE PATH, THREE BODIES. The queued-ask shape sends `ask_id` plus either
			 * `answers` or `decline`, and deliberately sends NEITHER `epoch` nor
			 * `request_id`: the backend ignores an epoch when `ask_id` is set, and a
			 * reviewer reading a body that carried both would be right to ask which one
			 * the server honoured. The gate shape is byte-for-byte what it was.
			 */
			if (request.askId !== undefined)
				return {
					path: `/v1/desktop/sessions/${request.sessionId}/answers`,
					method: "POST",
					body: {
						ask_id: request.askId,
						answers: request.answers,
						decline: request.decline,
						/*
						 * Sent only when asked for, so the first-answer body keeps its exact
						 * previous bytes: `revise` is a modifier the client has to state, and a
						 * body that carried `revise: false` on every ordinary submit would be
						 * asserting an intent it does not have.
						 */
						...(request.revise === true ? { revise: true } : {}),
					},
				};
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/answers`,
				method: "POST",
				body: {
					epoch: request.epoch,
					request_id: request.requestId,
					value: request.value,
					approved: request.approved,
					question_index: request.questionIndex,
				},
			};
		case "sessions.seen":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/seen`,
				method: "POST",
				body: { completion_token: request.completionToken },
			};
		case "attention.seen":
			return {
				/*
				 * A path with no `{session_id}` in it, deliberately: the batch spans
				 * sessions, and `/v1/desktop/attention/seen` cannot be shadowed by the
				 * per-session route at any registration order. The body is snake_case
				 * like every other route in that module, and the conversation identity
				 * is NEVER taken from the client — the backend derives `session/<id>`
				 * from the validated session id, the rule `/seen` already follows.
				 */
				path: "/v1/desktop/attention/seen",
				method: "POST",
				body: {
					items: request.items.map((item) => ({
						session_id: item.sessionId,
						completion_token: item.completionToken,
					})),
				},
			};
		case "sessions.notified":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/notified`,
				method: "POST",
				body: { completion_token: request.completionToken },
			};
		case "sessions.pin":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/pin`,
				method: "POST",
				// The route's own closed model (`{pinned: bool}`, `extra="forbid"`),
				// and the one field: the DESIRED state, never a toggle. See the op's
				// own comment for why a retried toggle is the bug this avoids.
				body: { pinned: request.pinned },
			};
		case "sessions.watch":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/watch`,
				method: "POST",
				body: {
					subscription_id: request.subscriptionId,
					visible: request.visible,
					can_notify: request.canNotify,
				},
			};
		case "sessions.presence":
			return {
				path: "/v1/desktop/presence",
				method: "POST",
				body: {
					subscription_id: request.subscriptionId,
					// The three fields the delivery lease reads beside it. Sent
					// snake_case like the route's own model, and always sent: a
					// defaulted claim is what made this app ineligible.
					can_notify_kinds: request.canNotifyKinds,
					session_id: request.sessionId,
					window: request.window,
					// `can_notify` means "can ATTEMPT delivery", never "the user will
					// be reached": `Notification.isSupported()` knows nothing about
					// macOS Focus/DND, Windows Focus Assist or a denied permission.
					// The backend's suppression reads it as eligibility to try, and a
					// claim never advances the read watermark, so a suppressed banner
					// still leaves the durable unseen mark intact.
					can_notify: request.canNotify,
				},
			};
		case "sessions.move":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/working-directory`,
				method: "POST",
				// `request_id` is the receipt key the route journals on, and it is what
				// makes a retried move replay the first answer rather than retire the
				// runtime a second time. `cwd` is sent as typed: resolving `~` and a
				// relative path is the backend's job, because the base for a relative
				// path is the SESSION's directory, which the renderer does not own.
				body: { request_id: request.requestId, cwd: request.cwd },
			};
		case "sessions.warm":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/warm`,
				method: "POST",
				// `{}` rather than `undefined`: the transport only sets
				// Content-Type when a body exists, and the route's pydantic input
				// forbids extras but still wants a JSON OBJECT. An omitted body
				// makes a legal call answer 422.
				body: {},
			};
		case "sessions.interrupt":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/interrupt`,
				method: "POST",
				// The route's own field name, and the only field: there is no
				// `confirmed` here because an interrupt destroys nothing, and a
				// confirmation gate would make Escape useless. The route answers the
				// runtime's abort receipt verbatim - see `DesktopInterruptReceipt`.
				body: { request_id: request.requestId },
			};
		case "sessions.variables.list":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/variables`,
				method: "GET",
			};
		case "sessions.variables.create":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/variables`,
				method: "POST",
				// The route's own body shape, not the op's: `{key, value, type}` on
				// create and `{value, type}` on update, because the key is in the path
				// once the variable exists and is immutable after that.
				body: { key: request.key, value: request.value, type: request.type },
			};
		case "sessions.variables.update":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/variables/${encodeURIComponent(request.key)}`,
				method: "PATCH",
				body: { value: request.value, type: request.type },
			};
		case "sessions.variables.delete":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/variables/${encodeURIComponent(request.key)}`,
				method: "DELETE",
			};
		case "legacy.models": {
			// The query the renderer's own listModels() built. Dropping it would
			// silently widen every provider-filtered model list to the whole
			// catalogue, which reads as a UI bug rather than a transport one.
			const query = new URLSearchParams();
			if (request.provider) query.set("provider", request.provider);
			if (request.sort) query.set("sort", request.sort);
			if (request.direction) query.set("direction", request.direction);
			return {
				path: query.size > 0 ? `/v1/models?${query}` : "/v1/models",
				method: "GET",
			};
		}
		case "legacy.models.providers":
			return { path: "/v1/models/providers", method: "GET" };
		case "auth.probe":
			return {
				path: `/v1/auth/providers/${request.provider}/probe`,
				method: "POST",
			};
		case "legacy.agent.upload":
			return { path: `/v1/agents/${request.agentId}/upload`, method: "POST" };
		case "agent.publish": {
			/*
			 * The org target rides on QUERY PARAMS, not in the body (§4.4): the
			 * published document's schema is strict, and the target is not part of
			 * the document. `URLSearchParams` rather than string interpolation so a
			 * tenant id can never compose a path or a second parameter.
			 */
			/*
			 * A HALF PAIR THROWS rather than composing a public publication (security
			 * review round 1, S-1): this builder used to drop an unpaired half, which
			 * turned `{visibility: "org"}` alone into a plain `/publish` — a silent
			 * PUBLIC publication where the comment promised a refusal. The schema's own
			 * `.refine` is the enforcement the renderer meets; this is the same rule at
			 * the boundary that composes the path, so a caller that reached here through
			 * a cast cannot publish to the wrong audience either.
			 */
			assertPairedPublicationTarget(request);
			const query = new URLSearchParams();
			if (request.visibility === "org" && request.tenantId) {
				query.set("visibility", "org");
				query.set("tenant_id", request.tenantId);
			}
			const search = query.toString();
			return {
				path: `/v1/agents/${request.agentId}/publish${search ? `?${search}` : ""}`,
				method: "POST",
				// The route's own body shape: a partial override of the document the
				// backend builds from the local row. `{}` rather than `undefined` when
				// there is no override, because the route's input model forbids extras
				// and still wants a JSON OBJECT — an omitted body makes a legal call
				// answer 422.
				body: { document: request.document ?? {} },
			};
		}
		case "agent.republish": {
			/*
			 * A HALF PAIR THROWS rather than composing a public publication (security
			 * review round 1, S-1): this builder used to drop an unpaired half, which
			 * turned `{visibility: "org"}` alone into a plain `/publish` — a silent
			 * PUBLIC publication where the comment promised a refusal. The schema's own
			 * `.refine` is the enforcement the renderer meets; this is the same rule at
			 * the boundary that composes the path, so a caller that reached here through
			 * a cast cannot publish to the wrong audience either.
			 */
			assertPairedPublicationTarget(request);
			const query = new URLSearchParams();
			if (request.visibility === "org" && request.tenantId) {
				query.set("visibility", "org");
				query.set("tenant_id", request.tenantId);
			}
			const search = query.toString();
			return {
				path: `/v1/agents/${request.agentId}/publish${search ? `?${search}` : ""}`,
				method: "PUT",
				body: {
					hub_agent_id: request.hubAgentId,
					document: request.document ?? {},
				},
			};
		}
		case "team.pull": {
			const query = new URLSearchParams();
			if (request.tenantId) query.set("tenant_id", request.tenantId);
			const search = query.toString();
			return {
				path: `/v1/teams/pull/${request.teamId}${search ? `?${search}` : ""}`,
				method: "GET",
			};
		}
		case "agent.nameAvailability": {
			// `name` travel as the user typed it: the hub is the one that trims and
			// normalises, and a client that pre-normalised would be answering a
			// different question than the one it asked.
			const query = new URLSearchParams({ name: request.name });
			return { path: `/v1/agent-name-availability?${query}`, method: "GET" };
		}
		case "legacy.agents.list": {
			const query = new URLSearchParams({
				page: String(request.page ?? 1),
				per_page: String(request.perPage ?? 10),
			});
			if (request.name) query.set("name", request.name);
			if (request.sort) query.set("sort", request.sort);
			if (request.direction) query.set("direction", request.direction);
			return { path: `/v1/agents?${query}`, method: "GET" };
		}
		case "legacy.agent.get":
			return { path: `/v1/agents/${request.agentId}`, method: "GET" };
		case "legacy.agent.history": {
			const query = new URLSearchParams({
				page: String(request.page ?? 1),
				per_page: String(request.perPage ?? 10),
			});
			return {
				path: `/v1/agents/${request.agentId}/history?${query}`,
				method: "GET",
			};
		}
		/*
		 * The wake routes, mapped beside their `sessions.*` siblings: one op per
		 * method, snake_case on the wire (`include_dormant`, `request_id`), which is
		 * what the backend's models declare.
		 */
		case "wakes.list": {
			const query = new URLSearchParams();
			if (request.limit !== undefined)
				query.set("limit", String(request.limit));
			if (request.includeDormant !== undefined)
				query.set("include_dormant", String(request.includeDormant));
			return {
				path:
					query.size > 0 ? `/v1/desktop/wakes?${query}` : "/v1/desktop/wakes",
				method: "GET",
			};
		}
		case "wakes.create":
			return {
				path: "/v1/desktop/wakes",
				method: "POST",
				body: {
					request_id: request.requestId,
					...wakeSessionHalf(request),
					message: request.message,
					...wakeTiming(request),
				},
			};
		case "wakes.edit":
			return {
				path: `/v1/desktop/wakes/${request.sessionId}/${request.wakeId}`,
				method: "PATCH",
				body: {
					...(request.message !== undefined
						? { message: request.message }
						: {}),
					...wakeTiming(request),
				},
			};
		case "wakes.remove":
			return {
				path: `/v1/desktop/wakes/${request.sessionId}/${request.wakeId}`,
				method: "DELETE",
			};
		/*
		 * The monitor cancel, mapped like its wake sibling. Both segments are
		 * `encodeURIComponent`ed even though both their schemas already refuse
		 * separators: the schema is this client's own check, and a redirect or a
		 * hand-built request must not be able to turn a handle into a path
		 * fragment (the mesh writes' own rule).
		 */
		case "monitors.cancel":
			return {
				path: `/v1/desktop/monitors/${encodeURIComponent(request.sessionId)}/${encodeURIComponent(request.monitorId)}`,
				method: "DELETE",
			};
		case "legacy.jobs.list": {
			const query = new URLSearchParams();
			if (request.agentId) query.set("agent_id", request.agentId);
			if (request.status) query.set("status", request.status);
			return {
				path: query.size > 0 ? `/v1/jobs?${query}` : "/v1/jobs",
				method: "GET",
			};
		}
		case "legacy.job.get":
			return { path: `/v1/jobs/${request.jobId}`, method: "GET" };
		case "legacy.schedules.list": {
			const query = new URLSearchParams({
				page: String(request.page ?? 1),
				per_page: String(request.perPage ?? 10),
			});
			return { path: `/v1/schedules?${query}`, method: "GET" };
		}
		case "legacy.agent.schedules.list": {
			const query = new URLSearchParams({
				page: String(request.page ?? 1),
				per_page: String(request.perPage ?? 10),
			});
			return {
				path: `/v1/agents/${request.agentId}/schedules?${query}`,
				method: "GET",
			};
		}
		case "legacy.agent.schedule.create":
			return {
				path: `/v1/agents/${request.agentId}/schedules`,
				method: "POST",
				body: request.schedule,
			};
		case "legacy.schedule.get":
			return { path: `/v1/schedules/${request.scheduleId}`, method: "GET" };
		case "legacy.schedule.edit":
			return {
				path: `/v1/schedules/${request.scheduleId}`,
				method: "PATCH",
				body: request.schedule,
			};
		case "legacy.schedule.remove":
			return { path: `/v1/schedules/${request.scheduleId}`, method: "DELETE" };
		case "legacy.agent.create":
			return { path: "/v1/agents", method: "POST", body: request.agent };
		case "legacy.agent.update":
			return {
				path: `/v1/agents/${request.agentId}`,
				method: "PATCH",
				body: request.update,
			};
		case "legacy.agent.delete":
			return { path: `/v1/agents/${request.agentId}`, method: "DELETE" };
		case "legacy.agent.conversation.clear":
			return {
				path: `/v1/agents/${request.agentId}/conversation`,
				method: "DELETE",
			};
		case "legacy.agent.systemPrompt.get":
			return {
				path: `/v1/agents/${request.agentId}/system-prompt`,
				method: "GET",
			};
		case "legacy.agent.systemPrompt.update":
			return {
				path: `/v1/agents/${request.agentId}/system-prompt`,
				method: "PUT",
				body: { system_prompt: request.systemPrompt },
			};
		case "legacy.agent.download":
			return { path: `/v1/agents/${request.agentId}/download`, method: "GET" };
		case "legacy.job.cancel":
			return { path: `/v1/jobs/${request.jobId}`, method: "DELETE" };
		case "commands.list":
			return { path: "/v1/desktop/commands", method: "GET" };
		case "commands.entities":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/command-entities?command=${encodeURIComponent(request.command)}${request.name ? `&name=${encodeURIComponent(request.name)}` : ""}`,
				method: "GET",
			};
		case "models.catalogue": {
			/*
			 * `scope` rides the query ONLY when asked for, so the path of a request
			 * that does not name one is byte-identical to the pre-`scope` form
			 * (`desktop-contract.test.mjs` pins that row) and an old backend keeps
			 * answering exactly what it answered before.
			 */
			const scope = request.scope ? `&scope=${request.scope}` : "";
			return {
				path: `/v1/desktop/models?live=${request.live ?? false}${scope}`,
				method: "GET",
			};
		}
		case "usage.get": {
			const query = new URLSearchParams({
				live: String(request.live ?? false),
				refresh: String(request.refresh ?? false),
			});
			if (request.provider) query.set("provider", request.provider);
			return { path: `/v1/desktop/usage?${query}`, method: "GET" };
		}
		case "quota.notice": {
			const query = new URLSearchParams({
				refresh: String(request.refresh ?? false),
			});
			if (request.provider) query.set("provider", request.provider);
			if (request.model) query.set("model", request.model);
			return { path: `/v1/desktop/quota-notice?${query}`, method: "GET" };
		}
		case "analytics.get": {
			const query = new URLSearchParams({ days: String(request.days ?? 30) });
			if (request.sessionId) query.set("session_id", request.sessionId);
			if (request.sinceMs !== undefined)
				query.set("since_ms", String(request.sinceMs));
			if (request.untilMs !== undefined)
				query.set("until_ms", String(request.untilMs));
			return { path: `/v1/desktop/analytics?${query}`, method: "GET" };
		}
		/*
		 * `/analytics/models`, NOT `/analytics?models=1`.
		 *
		 * The path segment is what keeps the two reads separable at the
		 * transport: `desktopRequestDeadlineMs` sizes a wait from the op, and an
		 * op that sometimes means "the cheap rollup" and sometimes "a 1.95 M-row
		 * ledger scan" cannot have one honest budget. The two spellings of the
		 * query string below are deliberately identical to `analytics.get`'s, so
		 * the server resolves one window from either.
		 */
		case "analytics.models": {
			const query = new URLSearchParams({ days: String(request.days ?? 30) });
			if (request.sessionId) query.set("session_id", request.sessionId);
			if (request.sinceMs !== undefined)
				query.set("since_ms", String(request.sinceMs));
			if (request.untilMs !== undefined)
				query.set("until_ms", String(request.untilMs));
			return { path: `/v1/desktop/analytics/models?${query}`, method: "GET" };
		}
		case "info.get":
			/* No parameters: `/info` has exactly one answer per host. */
			return { path: "/v1/desktop/info", method: "GET" };
		case "sessions.report": {
			const query = new URLSearchParams({
				recent_limit: String(request.recentLimit ?? 12),
			});
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/report?${query}`,
				method: "GET",
			};
		}
		case "skills.list": {
			/*
			 * Built from the PRESENT fields only, in a fixed order, so the wire URL is
			 * a function of the request and nothing else: `cwd` and `session_id` are
			 * each optional, and a request with neither is the home-roots read rather
			 * than a malformed one. Encoding is `URLSearchParams`', which is what the
			 * `name` field was already encoded with (a name can never collide with a
			 * query delimiter, but the cwd can).
			 */
			const query = new URLSearchParams();
			if (request.sessionId) query.set("session_id", request.sessionId);
			if (request.cwd) query.set("cwd", request.cwd);
			if (request.name) query.set("name", request.name);
			const encoded = query.toString();
			return {
				path: `/v1/desktop/skills${encoded ? `?${encoded}` : ""}`,
				method: "GET",
			};
		}
		case "sessions.failovers":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/failovers`,
				method: "GET",
			};
		case "sessions.credential":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/credentials`,
				method: "POST",
				body: {
					action: request.action,
					key: request.key,
					value: request.value,
					confirmed: request.confirmed,
				},
			};
		case "sessions.fork":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/fork`,
				method: "POST",
				body: {
					request_id: request.requestId,
					message: request.message,
					boundary: request.boundary,
					/*
					 * The route validates the two TOGETHER: `entry_id` with `next_safe`
					 * is a 422, and `at_entry` without one is a 422. This builder does
					 * not police that pairing (the schema above is what a renderer may
					 * send; the route is what adjudicates it), but it does keep the
					 * absent case byte-identical to the call that shipped before the
					 * cut existed - `undefined` is dropped by `JSON.stringify`, so a
					 * `next_safe` fork sends no `entry_id` key at all.
					 */
					entry_id: request.entryId,
				},
			};
		case "sessions.stop":
			return {
				path: "/v1/desktop/stop",
				method: "POST",
				body: {
					request_id: request.requestId,
					targets: request.targets,
					confirmed: request.confirmed,
				},
			};
		case "sessions.aside":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/asides`,
				method: "POST",
				body: {
					request_id: request.requestId,
					text: request.text,
					aside_id: request.asideId,
					// The viewer the chunks belong to; see the op's own note for why it
					// is optional and why it is the stream's own id.
					subscription_id: request.subscriptionId,
				},
			};
		case "sessions.adopt":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/asides/${request.asideId}/adopt`,
				method: "POST",
				body: { request_id: request.requestId, confirmed: request.confirmed },
			};
		case "sessions.aside.get":
		case "sessions.aside.close":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/asides/${request.asideId}`,
				method: request.op === "sessions.aside.get" ? "GET" : "DELETE",
			};
		case "mcp.list":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/mcp`,
				method: "GET",
			};
		case "mcp.credentials.store":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/mcp/credentials`,
				method: "POST",
				body: {
					name: request.name,
					values: request.values,
					confirmed_replace: request.confirmedReplace,
				},
			};
		case "mcp.control":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/mcp`,
				method: "POST",
				body: request.control,
			};
		case "mcp.catalog": {
			// Absent fields are OMITTED rather than sent empty: the backend's own
			// default (home, no overlay) is the answer for "no conversation open".
			const query = new URLSearchParams();
			if (request.cwd) query.set("cwd", request.cwd);
			if (request.sessionId) query.set("session_id", request.sessionId);
			const suffix = query.toString();
			return {
				path: suffix ? `/v1/desktop/mcp?${suffix}` : "/v1/desktop/mcp",
				method: "GET",
			};
		}
		case "mcp.catalog.control":
			return {
				path: "/v1/desktop/mcp",
				method: "POST",
				body: {
					...request.control,
					...(request.cwd ? { cwd: request.cwd } : {}),
				},
			};
		case "mcp.catalog.credentials":
			return {
				path: "/v1/desktop/mcp/credentials",
				method: "POST",
				body: {
					name: request.name,
					values: request.values,
					// `add_key`'s one extra field: which HTTP header the key
					// travels in, for a server that declares no `${ID}` yet. The
					// backend binds `headers[header] = "${ID}"` for the single id in
					// `values` and stores the value beside it.
					...(request.header ? { header: request.header } : {}),
					confirmed_replace: request.confirmedReplace,
					...(request.cwd ? { cwd: request.cwd } : {}),
				},
			};
		case "radient.request":
			return {
				path: "/v1/desktop/radient",
				method: "POST",
				body: request.control,
			};
		case "providers.list":
			return { path: "/v1/auth/providers", method: "GET" };
		case "accounts.list":
			return { path: "/v1/auth/status", method: "GET" };
		case "accounts.remove":
			return {
				path: `/v1/auth/accounts/${request.accountId}`,
				method: "DELETE",
			};
		case "auth.start":
			return {
				path: "/v1/auth/login",
				method: "POST",
				body: { provider: request.provider },
			};
		case "auth.status":
			return { path: `/v1/auth/operations/${request.id}`, method: "GET" };
		case "auth.input":
			return {
				path: `/v1/auth/operations/${request.id}/input`,
				method: "POST",
				body: { prompt_id: request.promptId, value: request.value },
			};
		case "auth.cancel":
			return { path: `/v1/auth/operations/${request.id}`, method: "DELETE" };
		case "auth.key":
			return {
				path: `/v1/auth/providers/${request.provider}/key`,
				method: "PUT",
				body: { value: request.value },
			};
		case "auth.logout":
			return {
				path: `/v1/auth/providers/${request.provider}/credentials`,
				method: "DELETE",
			};
		case "settings.list":
			return { path: "/v1/settings", method: "GET" };
		case "settings.edit":
			return {
				path: `/v1/settings/${request.key}`,
				method: "PATCH",
				body: { value: request.value, base: request.base },
			};
		case "settings.reset":
			return { path: `/v1/settings/${request.key}/reset`, method: "POST" };
		/*
		 * The synthesis availability report. A plain GET with no query at all: the
		 * resolver reads this machine's credential store, so there is no parameter a
		 * caller could scope it by - and it is deliberately NOT cached by this
		 * layer (the daemon withdrew the TTL: availability is a statement about a
		 * credential the user may have just removed).
		 */
		case "tts.paths":
			return { path: "/v1/tts/paths", method: "GET" };
		case "config.get":
			return { path: "/v1/config", method: "GET" };
		case "config.update":
			return { path: "/v1/config", method: "PATCH", body: request.value };
		case "instructions.get":
			return { path: "/v1/config/system-prompt", method: "GET" };
		case "instructions.update":
			return {
				path: "/v1/config/system-prompt",
				method: "PATCH",
				body: { content: request.content },
			};
		case "credentials.list":
			return { path: "/v1/credentials", method: "GET" };
		case "credentials.update":
			return {
				path: "/v1/credentials",
				method: "PATCH",
				body: { key: request.key, value: request.value },
			};
		/*
		 * The Projects routes, in the store's own wire vocabulary: snake_case
		 * bodies, the typed NAME in `confirm` for the delete (the route compares
		 * it case-insensitively against the row it resolved), and every key
		 * URL-encoded because it is user text — a project name may carry dots
		 * and dashes, and a milestone name is free text up to 80 chars.
		 */
		case "projects.list":
			return { path: "/v1/desktop/projects", method: "GET" };
		case "projects.get":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}`,
				method: "GET",
			};
		case "projects.create":
			return {
				path: "/v1/desktop/projects",
				method: "POST",
				// Absent fields are OMITTED: the route's own defaults are the
				// answer for "no status, no tags, no description".
				body: {
					name: request.name,
					...(request.description !== undefined
						? { description: request.description }
						: {}),
					...(request.status !== undefined ? { status: request.status } : {}),
					...(request.tags !== undefined ? { tags: request.tags } : {}),
				},
			};
		case "projects.update":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}`,
				method: "PATCH",
				// Exactly the keys the caller included travel, so an omitted key
				// leaves its field alone and `""` clears a date (the route
				// forwards `model_fields_set` into the store's edit model).
				body: {
					...request.fields,
					// Only a TRUE flag travels: `false` and absent are the same request
					// to the route, and omitting both keeps the body valid for a daemon
					// that does not know the key at all.
					...(request.force_done === true ? { force_done: true } : {}),
				},
			};
		case "projects.delete":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}`,
				method: "DELETE",
				body: { confirm: request.confirmed_name },
			};
		case "projects.link":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}/links`,
				method: "POST",
				body: { session_id: request.sessionId },
			};
		case "projects.unlink":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}/links/${encodeURIComponent(request.sessionId)}`,
				method: "DELETE",
			};
		case "projects.milestone":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}/milestones`,
				method: "POST",
				body: {
					name: request.name,
					...(request.targetDate !== undefined
						? { target_date: request.targetDate }
						: {}),
					...(request.completed !== undefined
						? { completed: request.completed }
						: {}),
				},
			};
		case "projects.milestone.remove":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}/milestones/${encodeURIComponent(request.name)}`,
				method: "DELETE",
			};
		case "projects.request_update":
			return {
				path: `/v1/desktop/projects/${encodeURIComponent(request.key)}/request-update`,
				method: "POST",
			};
		case "projects.search": {
			/*
			 * `URLSearchParams` rather than interpolation, for the reason
			 * `sessions.search` states: a query is whatever the user typed, and an
			 * `&`, `#` or space in it would otherwise change the request's meaning
			 * (or truncate it) instead of being searched for. The route is a static
			 * path declared before `/v1/desktop/projects/{key}` on the backend, so
			 * `search` is never read as a project name.
			 */
			const query = new URLSearchParams({
				q: request.q,
				limit: String(request.limit ?? PROJECTS_SEARCH_DEFAULT_LIMIT),
			});
			return {
				path: `/v1/desktop/projects/search?${query}`,
				method: "GET",
			};
		}
		case "aida.status":
			return { path: "/v1/desktop/aida", method: "GET" };
		case "aida.control":
			return {
				path: "/v1/desktop/aida",
				method: "POST",
				/*
				 * The route's body is `{"op": ...}` — its own word, not this envelope's
				 * — so the ACTION travels under the route's field name and the two `op`s
				 * cannot be read as one.
				 */
				body: { op: request.action },
			};
		/*
		 * THE CODE REQUEST LEDGER, the session-scoped pair (see the union members'
		 * comment for why both routes name the session). The GET is the read the pane
		 * and the chip share; the POST asks the host to re-fetch, and its body
		 * carries only the fields the CALLER set, so an untouched Refresh press is
		 * the route's own defaults rather than this client's opinion of them.
		 */
		case "code_requests.list":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/code-requests`,
				method: "GET",
			};
		case "code_requests.refresh":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/code-requests/refresh`,
				method: "POST",
				body: {
					...(request.keys !== undefined ? { keys: request.keys } : {}),
					...(request.force !== undefined ? { force: request.force } : {}),
				},
			};
	}
}

/**
 * The local-file bridge, shared by main, the preload and the renderer.
 *
 * These are NOT `DesktopRequest`s. Every op in the union above travels to the
 * backend over HTTP and is validated by a zod schema there; the local-file
 * handlers (`read-file`, `save-file`, `probe-files`, `read-file-bytes`,
 * `list-directory`) never leave the machine, and two of them return bytes that a
 * zod schema would only get in the way of. They are declared here anyway because
 * this module is the one place the three processes already agree on a shape, and
 * a type that lives beside `ReadFileResponse` in a `.d.ts` is a type main cannot
 * import.
 */

/**
 * Paths one `probe-files` call may resolve.
 *
 * A bound rather than a guess: a stat on an unmounted network path can hang for
 * seconds, so the renderer chunks its probe requests and main refuses anything
 * larger rather than turning one call into a stall. 64 is comfortably more than
 * a panel's worth of tiles while keeping a single batch's work short - the probe
 * itself is asynchronous and bounded (`src/main/directory-listing.ts`,
 * `PROBE_CONCURRENCY`), so this number bounds the request, not the event loop.
 * The panel's own list is bounded by the conversation, not by this number: a
 * transcript with hundreds of mentions is probed in chunks of 64, and the
 * extractor no longer caps its output at all (it used to stop at 200 paths,
 * which is what made the tail of a long conversation unreachable).
 */
export const MAX_PROBE_PATHS = 64;

/**
 * Entries one `list-directory` call may return.
 *
 * 200, which is the harness's own `_DIRECTORY_ENTRY_LIMIT` for the directory
 * element of a reference block — the same number, so a directory the two
 * surfaces describe has the same length. A bound exists at all because the
 * listing crosses IPC on a keystroke path and is rendered as rows; the answer
 * reports the truncation rather than silently dropping the tail.
 */
export const DIRECTORY_ENTRY_LIMIT = 200;

/** One entry of a `list-directory` answer. */
export type DirectoryEntry = {
	name: string;
	/**
	 * Whether the entry is a directory, with SYMLINKS FOLLOWED — the harness's
	 * `DirEntry.is_dir()` does the same, so a link to a directory is a directory
	 * row on both surfaces.
	 */
	directory: boolean;
};

/**
 * One directory, as a picker's list of rows.
 *
 * `dir` is the path after the path rule resolved it, which is what lets a caller
 * place the rows relative to the working directory without doing path
 * arithmetic of its own.
 */
export type DirectoryListing = {
	dir: string;
	entries: DirectoryEntry[];
	/** True when `DIRECTORY_ENTRY_LIMIT` hid entries. */
	truncated: boolean;
	/**
	 * Present only when the directory could not be read at all. "Unreadable" and
	 * "empty" are different facts and the caller says so, rather than painting an
	 * empty folder for a permission wall.
	 */
	error?: string;
};

/**
 * The largest file `read-file-bytes` will return, in bytes.
 *
 * A cap exists so a 2 GB file cannot OOM the renderer through structured clone.
 * 64 MiB is chosen against the largest thing a viewer plausibly opens (the
 * PDFs, images and audio a session touches) with room to spare; a file over it
 * gets a named refusal and the "open in the default app" action rather than a
 * spinner that never resolves.
 */
export const MAX_FILE_READ_BYTES = 64 * 1024 * 1024;

/** One entry of the `probe-files` answer, in the order it was asked about. */
export type ProbedFile = {
	/** The path exactly as the renderer asked about it. */
	input: string;
	/** The path after `~`/cwd resolution; the store's dedupe key. */
	resolved: string;
	exists: boolean;
	isFile: boolean;
	/** Bytes, or `null` when the path does not resolve to a file. */
	sizeBytes: number | null;
	/** Modification time, ms since epoch, or `null`. */
	mtimeMs: number | null;
	/**
	 * Present only when the probe could not ANSWER: `stat`/`realpath` failed
	 * (permission, a broken mount) or the probe exceeded its deadline, rather
	 * than the filesystem reporting "no such file". Both a fault and a miss
	 * report `exists: false`, so THIS FIELD IS THE DISCRIMINANT between them,
	 * and consumers must branch on it: a fault is UNKNOWN - the Files panel
	 * leaves such a path unmarked and the link surfaces keep it unanswered,
	 * while the existing retry cadence re-asks it - and only `exists: false`
	 * with NO `error` is the absence the "gone" receipts are painted from
	 * (remediation round 1, R1-2; QA round 1, Q1). It says which one happened
	 * because "deleted" and "cannot look" deserve different words in a bug
	 * report AND different behaviour on screen.
	 */
	error?: string;
	/**
	 * Whether the target's FULLY RESOLVED path lies outside the fully resolved
	 * workspace root passed as `cwd` — symlinks followed on both sides, which is
	 * the harness's own containment rule (`builtin.py:_resolve_workspace_path`)
	 * and the fact a caller paints "this will ask for approval" from.
	 *
	 * Absent rather than `false` when the question cannot be asked: no `cwd`
	 * argument, or a target that will not resolve. A caller that needs a verdict
	 * for its own decision (`outsideWorkspace` in `src/main/directory-listing.ts`)
	 * treats the unresolvable case as outside; a caller that only DECORATES is
	 * told nothing rather than told "inside".
	 */
	outsideWorkspace?: boolean;
};

/**
 * What `open-file` and `show-item-in-folder` answer with.
 *
 * Both used to answer `void`, and both dropped the half of the answer that
 * matters. `shell.openPath` RETURNS its failure as a string (it does not throw),
 * so the old `open-file` reported success for a path that opened nothing; and
 * `shell.showItemInFolder` returns nothing at all, so a path that does not exist
 * revealed whichever folder happened to be in front of it. A press that fails
 * silently is the failure this carries the answer out for - the transcript's
 * link toolbar says `No file at …` instead of looking broken.
 *
 * `resolved` is the path the main process actually acted on, after `~`
 * expansion: the renderer spells a path the way the agent wrote it, and the
 * resolved form is the only one that names the same file for both of them.
 */
export type FileActionOutcome = {
	ok: boolean;
	resolved: string;
	/** Why it failed, for the toast; absent when `ok`. */
	error?: string;
};

/**
 * What `open-external` answers with, and the channel a refusal is PUSHED on.
 *
 * The IPC half answers its caller directly: the link toolbar's Open awaits
 * `window.api.openExternal`, so a refusal travels back as `ok: false` and the
 * renderer shows it rather than a press that looks broken (round-2 R-4).
 *
 * A markdown ANCHOR's click has no such caller: it leaves through `window.open`
 * and the main process's door, so the refusal is pushed to the window whose
 * content asked - `EXTERNAL_OPEN_REFUSED_CHANNEL` with `ExternalOpenRefusedPayload`
 * - and the renderer shows the same sentence. Before this, a refused link (a
 * transcript link to `http://localhost:3000`, say) did nothing at all with only
 * a main-process log line, which is not an answer a person can see.
 */
export type ExternalOpenOutcome = { ok: true } | { ok: false; reason: string };

/** The push payload for a refused external open; mirrors the outcome's failure half. */
export type ExternalOpenRefusedPayload = {
	/** The URL whose open was refused, as the door saw it. */
	url: string;
	/** The door's own reason, for the toast's copy and for a log line. */
	reason: string;
};

/** The channel a refused external open is pushed on (see `ExternalOpenOutcome`). */
export const EXTERNAL_OPEN_REFUSED_CHANNEL = "external-open-refused";

/**
 * Why a byte read was refused.
 *
 * A string code, not an `Error` subclass: Electron serialises an Error across
 * IPC by message and stack, so a custom class arrives with a plain `Error`
 * prototype and an `instanceof FileTooLargeError` test in the renderer is
 * always false. A discriminant that survives the boundary is the only form the
 * renderer can act on — and the viewer acts on `too-large` specifically.
 */
export type ReadFileBytesFailure =
	| "too-large"
	| "not-a-file"
	| "not-found"
	| "unreadable";

export type ReadFileBytesResponse =
	| { success: true; data: Uint8Array; sizeBytes: number }
	| {
			success: false;
			code: ReadFileBytesFailure;
			error: string;
			sizeBytes?: number;
	  };

/* ---------------------------------------------------------------------------
 * The diagnostics panels' response shapes (`docs/design/panel-views.md` §5).
 *
 * The request schemas above are the transport's closed vocabulary; these are
 * the payloads two of those ops answer with. They live beside the requests
 * because §5 is one contract: a field name that exists in one half and not the
 * other is the drift that turns a panel's first frame into a 500. Nothing here
 * validates at runtime — the routes are trusted to send what §5 says — so these
 * are the renderer's declared reading of the wire, and a panel that reads a
 * field absent from these types is reading something nobody promised.
 *
 * Conventions, restated because every field below depends on them:
 *
 * - **Money** is integer micro-USD (`cost_micro`), always paired with
 *   `cost_known_calls`. `cost_known_calls < calls` means the figure is a LOWER
 *   BOUND; `cost_known_calls === 0` means nothing in scope is priceable and the
 *   client renders `—`, never `$0.00`.
 * - **Tokens** are raw integers; abbreviation is the client's job.
 * - **Time**: `ts_ms` is epoch milliseconds, `captured_at` epoch seconds.
 * - **Unknown is not zero.** Every field that can be unmeasured is nullable and
 *   the client renders the unknown spelling. Where the absence of a measurement
 *   is a different fact from a zero (`tool_calls: null`, an unreadable ledger,
 *   an unopenable store) the payload says so explicitly and the client MUST NOT
 *   fold the two together.
 * ------------------------------------------------------------------------- */

/**
 * One usage aggregate: `dataclasses.asdict(UsageAggregate)`.
 *
 * `components` is exactly `COMPONENT_KEYS` (nine entries, all present);
 * `by_provider` and `by_session` are always `{}` on `sessions.report`, which is
 * the point of that op — one session's own figures, from one pinned read.
 */
export type DesktopUsageAggregate = {
	calls: number;
	ok_calls: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	reasoning_tokens: number;
	context_tokens: number;
	cost_micro: number;
	cost_known_calls: number;
	/**
	 * The measured GENERATION window, in integer microseconds, summed over the
	 * calls that have one — and its two companions.
	 *
	 * ADDITIVE and OPTIONAL, which is the whole reason they are declared that
	 * way rather than as required fields: they are ordinary new fields on
	 * `dataclasses.asdict(UsageAggregate)`, so a backend that predates the
	 * feature omits them, and the panel's existing By-provider and By-session
	 * tables gain a rate column with no new request and no added latency. An
	 * absent triple means "no call in scope was measured", which is the same
	 * fact a present `{0, 0, 0}` states; both render the unknown spelling.
	 *
	 * `decode_us` starts at the FIRST output delta and ends at the last, so it
	 * excludes time-to-first-token, provider queueing and consumer backpressure.
	 * That is what makes it a generation rate rather than a wall rate, and it is
	 * also why it is forward-fill: there is nothing to backfill it from. The
	 * rate is `decode_tokens / (decode_us / 1e6)`, and it is UNKNOWN — `—`,
	 * never `0 tok/s` — whenever `decode_calls === 0`. See the wall half on
	 * {@link DesktopModelRate}, which is a DIFFERENT quantity and deliberately
	 * not on this type.
	 */
	decode_us?: number;
	/** Output tokens over exactly the calls counted by `decode_calls`. */
	decode_tokens?: number;
	/** How many calls contributed a measured window. `0` means unknown, not zero. */
	decode_calls?: number;
	components: Record<string, number>;
	by_provider: Record<string, DesktopUsageAggregate>;
	by_session: Record<string, DesktopUsageAggregate>;
};

/**
 * One `analytics.models` row: a `(provider, model_id)` group of the RAW LEDGER.
 *
 * Two rates live on this type and they are different quantities, so the field
 * names differ rather than sharing a `tokens`/`us` pair with a label:
 *
 * - **`decode_*`** is the measured generation window, the same triple
 *   {@link DesktopUsageAggregate} carries. Forward-fill: calls recorded before
 *   the feature contribute `0/0`, so `decode_calls === 0` means the rate is
 *   unknown and renders `—`.
 * - **`wall_*`** is the whole call: `wall_tokens / (wall_us / 1e6)` over calls
 *   that have a duration and reported output tokens. It is built from two
 *   already-stored columns, so it covers the operator's ENTIRE existing history
 *   with no migration. It is a WALL rate — it includes time-to-first-token,
 *   provider queueing and any consumer backpressure — and it must never be
 *   labelled or read as decode speed. Where the two differ, that gap is the
 *   diagnosis rather than a defect.
 *
 * Both rates come from ONE grouped scan, which is why this is its own op: it
 * costs seconds on a large ledger and must not ride the panel's headline read.
 * Every field is an integer.
 */
export type DesktopModelRate = {
	provider: string;
	model_id: string;
	/** Every call in the group, twice over: the decode and wall counts are subsets. */
	calls: number;
	output_tokens: number;
	decode_us: number;
	decode_tokens: number;
	decode_calls: number;
	/** Microseconds summed over calls with `duration_ms > 0`. */
	wall_us: number;
	wall_tokens: number;
	/** How many calls contributed a wall window. */
	wall_calls: number;
};

/**
 * `analytics.models`'s `data`.
 *
 * `scope` is the store's own word for where the rows came from — `"ledger"`,
 * never the rollup the headline reads — and it is carried rather than assumed
 * so a section that renders these rows can say which source it is quoting.
 *
 * `since_ms`/`until_ms` are the bounds the scan actually ran with, echoed back,
 * and are `null` when the request gave none. They are NOT the panel's own
 * window: the panel derives its window once and passes it, and this echo is
 * what lets the section's meta line state the window the rows were read over
 * rather than the one the toolbar currently shows.
 */
export type DesktopAnalyticsModelsData = {
	rows: DesktopModelRate[];
	scope: string;
	since_ms: number | null;
	until_ms: number | null;
};

/** One `usage_daily` rollup bucket, oldest-first across the series. */
export type DesktopUsagePeriod = {
	/** Local `YYYY-MM-DD`; `""` only for a totals row, which this route never sends. */
	period: string;
	/** `""` on the across-models series this route asks for. */
	model: string;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	reasoning_tokens: number;
	context_tokens: number;
	cost_micro: number;
	cost_known_calls: number;
	calls: number;
};

/**
 * `analytics.get`'s `data`.
 *
 * `session_names` and `session_parents` are the store's two side attributes,
 * which `dataclasses.asdict` drops; they are served explicitly here so the
 * by-session table can label a row with a name and show the tree. Both are
 * OPTIONAL on purpose: against a backend that predates them the panel renders
 * the hex id as the label and no indentation, and says nothing about it — an id
 * is a true label, so there is nothing to apologise for.
 *
 * The `aggregate` is per-session OWN figures and is never rolled up over
 * children; `session_parents` is what lets a client re-partition, which is why
 * the by-session section's meta has to say so.
 */
export type DesktopAnalyticsData = {
	aggregate: DesktopUsageAggregate;
	daily: DesktopUsagePeriod[];
	daily_scope: string;
	session_names?: Record<string, string>;
	session_parents?: Record<string, string>;
};

/** Timing statistics for one phase of a request, across a session's samples. */
export type DesktopTimingSummary = {
	samples: number;
	mean_ms: number | null;
	min_ms: number | null;
	max_ms: number | null;
};

/** One row of `sessions.report`'s recent-requests tail. */
export type DesktopSessionRequest = {
	request_id: string;
	ts_ms: number;
	provider: string;
	model_id: string;
	/** A label: `turn`, `compaction`, `aside`, `naming`, … or `unknown`. */
	purpose: string;
	/**
	 * A LABEL — a provider finish reason or an exception class name — and never
	 * the thing that decides failure. An older ledger reports every row as
	 * `unknown`, so deriving failure from it painted an entire healthy session
	 * as failed. Read `ok`.
	 */
	outcome: string;
	usage_reported: boolean | null;
	context_tokens: number;
	output_tokens: number;
	duration_ms: number | null;
	ttft_ms: number | null;
	preparation_ms: number | null;
	/** `null` is unknown, and unknown is NEVER painted as a failure. */
	ok: boolean | null;
};

/**
 * Tool-call counters, already net of the faults the rates exclude.
 *
 * The two rates are NOT on the wire (they are Python properties), so the client
 * derives them: `validity = 1 - model_faults/emitted` and
 * `execution_error_rate = execution_faults/(emitted - model_faults)`, where
 * `emitted = total - Σfaults[denied|aborted|skipped|gate_failed]`. Displaying
 * them as neighbouring bars is wrong — they share no denominator.
 *
 * `null` on the report means no tool-call rows were ever recorded (a session
 * predating the feature), which is the opposite of a zeroed counter.
 */
export type DesktopToolCallStats = {
	/** MODEL-EMITTED calls, every fault included. */
	total: number;
	ok: number;
	faults: Record<string, number>;
	faults_by_tool: Record<string, number>;
	nested_total: number;
	nested_ok: number;
	nested_excluded: number;
};

/**
 * `sessions.report`'s `data`, from one `AnalyticsStore.session_report` read.
 *
 * Every number here comes from a single explicit read transaction, which is why
 * `/session` reads this and not a second `analytics.get` — a differing query
 * path would give a second aggregate.
 */
export type DesktopSessionReport = {
	session_id: string;
	/** `false` = the ledger could not be read. Nothing on the panel is then trustworthy. */
	available: boolean;
	/** OWN scope, exact session id. */
	aggregate: DesktopUsageAggregate;
	/** `null` = the subtree walk could not run. NOT "$0.00 of subagents". */
	descendants_aggregate: DesktopUsageAggregate | null;
	/** Nearest-first. */
	descendant_ids: string[];
	by_model: Array<{
		provider: string;
		model_id: string;
		aggregate: DesktopUsageAggregate;
	}>;
	/**
	 * An ARRAY, like `by_model` and for the same reason: a `dict` reaches JSON as
	 * a keyed object, which the client cannot order. The route converts it; when
	 * it did not, the panel's `reportShapeProblem` names the field instead of
	 * rendering a `.map` over an object, and the divergence is a cross-repo
	 * finding rather than a shape this type tolerates.
	 */
	by_purpose: Array<{ purpose: string; aggregate: DesktopUsageAggregate }>;
	by_purpose_outcome: Array<{
		purpose: string;
		outcome: string;
		calls: number;
	}>;
	/** `usage_reported = 0`. */
	missing_usage_calls: number;
	/** `usage_reported IS NULL`. */
	unknown_usage_calls: number;
	timings: {
		duration_ms: DesktopTimingSummary;
		ttft_ms: DesktopTimingSummary;
		preparation_ms: DesktopTimingSummary;
	};
	/** Newest first, at most `recent_limit` rows. */
	recent: DesktopSessionRequest[];
	first_ts_ms: number | null;
	last_ts_ms: number | null;
	tool_calls: DesktopToolCallStats | null;
};

/** One machine-locatable `lop` process, as `info.get` reports it. */
export type DesktopInfoSessionLine = {
	pid: number;
	kind: string;
	state: "live" | "wedged" | "stale" | "stored" | "";
	session_id: string;
	conversation_name: string;
	model_label: string;
	cwd: string;
	uptime_s: number;
	heartbeat_age_s: number;
	rss_bytes: number | null;
	footprint_bytes: number | null;
	last_activity_s: number | null;
	pending: string | null;
	busy: boolean;
	detached: boolean;
	version: string;
	source_ref: string;
};

/**
 * `info.get`'s `data`.
 *
 * **The live half arrives as `null` and the client does not read it.** The route
 * nulls these fields explicitly (`_unmeasure_live_half` in
 * `server/routes/desktop_catalogues.py`) because `LiveState()` has no session
 * attached: `agents.tree`/`running`/`queued`/`settled`/`max_running`/
 * `at_capacity`/`max_depth`/`deeper`/`roster_unread`/`cross_session_known` and
 * `env.mcp_configured`/`mcp_connected`/`mcp_failed`/`mcp_settling`/
 * `mcp_failures`/`approval_mode`/`skills` are the dataclass DEFAULTS of a state
 * nothing measured, and a `0`/`false`/`[]` is indistinguishable from a reading on
 * the one screen whose job is to be believed (backend QA round on the sibling
 * PR, which found this route shipping them as values). The `/info` panel renders
 * subagents and MCP from `canonical.frontend` instead, and reads no field below
 * from this block.
 *
 * They are typed `| null` on purpose: the desktop's route never attaches a
 * session, so the nulls are the NORMAL payload, and a type that says `number`
 * made `formatCount(null)` compile into a confident "0 skills" — the fixture
 * typed to the old shape hid it. A later reader "fixing" the panel to read them
 * would introduce a second source of truth for a live fact, which is why the
 * fields are still typed here rather than dropped: demonstrably ignored, and now
 * unable to read as measured.
 */
export type DesktopInfoData = {
	install: {
		/** `""` when the version could not be read. */
		version: string;
		kind: string;
		prefix: string;
		executable: string;
		/** The package dir that ACTUALLY resolved, which may not be `prefix`'s. */
		import_path: string;
		import_path_foreign: boolean;
		is_git_snapshot: boolean;
		source_ref: string;
		build_age_s: number | null;
		/** Last PyPI answer ON DISK; `null` = never checked, a different fact from up to date. */
		latest_known: string | null;
		latest_age_s: number | null;
		behind: boolean;
		python_version: string;
		python_implementation: string;
		platform: string;
		machine: string;
	};
	process: {
		pid: number;
		session_id: string;
		conversation_name: string;
		cwd: string;
		model_label: string;
		effective_model: string;
		uptime_s: number | null;
		config_dir: string;
		config_dir_redirected: boolean;
		agent_home: string;
		agent_home_redirected: boolean;
		cache_dir: string;
		log_dir: string;
		/** `null` = not listening; a port is not a measurement otherwise. */
		control_port: number | null;
		protocol: number | null;
		kind: string;
	};
	sessions: {
		lines: DesktopInfoSessionLine[];
		total: number;
		live: number;
		wedged: number;
		stale: number;
		busy: number;
		pending: number;
		detached: number;
		/** More than one distinct (version, source_ref) among LIVE rows. */
		build_skew: boolean;
		/** `false` = the memory probes returned nothing at all. */
		usage_available: boolean;
		/** `false` = the registry scan itself failed. */
		available: boolean;
		subagents_reporting: number;
		subagents_unreported: number;
		fleet_subagents_running: number;
		fleet_subagents_queued: number;
		fleet_session_trajectories: number;
		fleet_trajectories: number;
	};
	agents: {
		profiles: number;
		teams: number;
		tree: Array<{
			job_id: string;
			label: string;
			status: string;
			depth: number;
			agent_role: string;
			effort: string;
			parent_job_id: string | null;
			session_id: string | null;
			live: boolean;
		}> | null;
		running: number | null;
		queued: number | null;
		settled: number | null;
		max_running: number | null;
		at_capacity: boolean | null;
		max_depth: number | null;
		deeper: number | null;
		cross_session_known: boolean | null;
		roster_unread: boolean | null;
	};
	env: {
		mcp_configured: number | null;
		mcp_connected: number | null;
		mcp_failed: number | null;
		mcp_settling: boolean | null;
		/** `[server name, truncated message]`. */
		mcp_failures: Array<[string, string]> | null;
		approval_mode: string | null;
		theme: string;
		terminal_size: [number, number] | null;
		term: string;
		colorterm: string;
		multiplexer: string;
		is_tty: boolean;
		browser_backend: string;
		browser_name: string;
		browser_paired: boolean;
		mobile_installed: boolean;
		mobile_healthy: boolean;
		mobile_port: number | null;
		/** NAMES ONLY — never a value, a length or a prefix. */
		credential_keys: string[];
		guides: number;
		/** `null` on every desktop read: no session is attached, so nothing counted. */
		skills: number | null;
	};
	/** `[field or block name, one-line reason]`. */
	degraded: Array<[string, string]>;
	/** Epoch SECONDS, not milliseconds. */
	captured_at: number;
};

/**
 * The numbers behind `/context`'s pre-formatted rows.
 *
 * Additive on an existing route: the rows themselves are `[label, "~12.3k"]`
 * strings the owner built, and this is the dict they were built from, one line
 * earlier in the same function. It is the only way a panel can draw a bar
 * instead of parsing a human string, and it MUST NOT be reconstructed by
 * parsing `items` — a formatter change would then silently move a chart.
 *
 * `cache_read` is `0` when there is no last usage; `context_window` is the
 * EFFECTIVE model's window, not the selected one's.
 */
export type DesktopContextNumbers = {
	instructions: number;
	tool_inventory: number;
	tool_schemas: number;
	environment: number;
	knowledge_mcp_goal: number;
	messages: number;
	context_window: number;
	cache_read: number;
	total: number;
};
