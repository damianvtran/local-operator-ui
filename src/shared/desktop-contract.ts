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
const sessionId = z.string().regex(/^[a-f0-9]{12}$/);
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

// This vocabulary is the security boundary, not a generic authenticated fetch.
// The renderer selects an operation; it never supplies a URL, method or headers.
export const desktopRequestSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("capabilities") }).strict(),
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
		})
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
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.create"),
			requestId,
			cwd: z.string().min(1).max(4096),
			target: target.optional(),
			/*
			 * OMITTED when the user never picked anything, so the body is the one
			 * this op sent before the draft's chips could open: making them
			 * actionable is strictly additive, and a `null` here would be a
			 * different request for every caller that never asked.
			 */
			model: modelSelection.optional(),
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
	z.object({ op: z.literal("sessions.get"), sessionId }).strict(),
	z
		.object({
			op: z.literal("sessions.history"),
			sessionId,
			beforeId: id.optional(),
			limit: z.number().int().min(1).max(500).optional(),
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
			images: z.array(sessionImage).max(8).optional(),
			mode: z.enum(["prompt", "steer"]).optional(),
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
			images: z.array(sessionImage).max(8).optional(),
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
			epoch: id,
			requestId: id,
			value: z.string().max(32768).optional(),
			approved: z.boolean().optional(),
			questionIndex: z.number().int().min(0).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.seen"),
			sessionId,
			completionToken: z.string().uuid(),
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
		.object({ op: z.literal("models.catalogue"), live: z.boolean().optional() })
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
			op: z.literal("analytics.get"),
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
		.object({ op: z.literal("skills.list"), sessionId, name: id.optional() })
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
			boundary: z.literal("next_safe").optional(),
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
					name: z
						.string()
						.regex(/^[A-Za-z0-9_.:-]{1,100}$/)
						.optional(),
					scope: z.enum(["global", "project"]).optional(),
					command: z.string().min(1).max(4096).optional(),
					args: z.array(z.string().max(8192)).max(128).optional(),
					env: z
						.record(z.string().regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/))
						.optional(),
					url: z.string().max(4096).optional(),
					headers: z
						.record(z.string().regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/))
						.optional(),
					oauth: z.boolean().optional(),
					confirmed: z.boolean().optional(),
					operation_id: z
						.string()
						.regex(/^[a-f0-9]{32}$/)
						.optional(),
				})
				.strict(),
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
						"comments.list",
						"comments.create",
						"comments.update",
						"comments.delete",
						"account.agents",
					]),
					request_id: requestId.optional(),
					tenant_id: id.optional(),
					account_id: id.optional(),
					agent_id: id.optional(),
					comment_id: id.optional(),
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
]);

export type DesktopRequest = z.infer<typeof desktopRequestSchema>;
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

/** Every op on the long budget, whichever of the two shapes put it there. */
const LONG_READ_OPS: ReadonlySet<string> = new Set([
	...LEDGER_READ_OPS,
	...PROVIDER_READ_OPS,
]);

/** The deadline one op's request may run for. */
export function desktopRequestDeadlineMs(op: DesktopRequest["op"]): number {
	return LONG_READ_OPS.has(op)
		? DESKTOP_LONG_READ_DEADLINE_MS
		: DESKTOP_CONTROL_DEADLINE_MS;
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
	"commands.entities",
	"commands.list",
	"config.get",
	"credentials.list",
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
	"mcp.list",
	"models.catalogue",
	"profiles.get",
	"profiles.list",
	"providers.list",
	"sessions.aside.get",
	"sessions.failovers",
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
	| { status: number; kind: "error"; detail: string };

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
	onOpenConversation?: (callback: (sessionId: string) => void) => () => void;
	/** `/exit`: close this window. Detach-only; the backend keeps sessions
	 * running. Main applies the normal unsaved-state guard. Electron only. */
	closeWindow?: () => Promise<void>;
	/** Authenticated canonical session stream. Present only when the Electron
	 * preload is live; browser development uses the server-side stream proxy. */
	stream?: {
		subscribe: (
			args: { sessionId: string; epoch?: string; afterSeq?: number },
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

export function desktopEndpoint(request: DesktopRequest): {
	path: string;
	method: string;
	body?: unknown;
} {
	switch (request.op) {
		case "capabilities":
			return { path: "/v1/capabilities", method: "GET" };
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
		case "sessions.list":
			return {
				path: `/v1/desktop/sessions?limit=${request.limit ?? 100}`,
				method: "GET",
			};
		case "sessions.search": {
			// `encodeURIComponent` rather than interpolation: a query is whatever
			// the user typed, and `&`, `#` or a space in it would otherwise change
			// the request's meaning (or truncate it) instead of being searched for.
			const query = new URLSearchParams({
				q: request.q,
				limit: String(request.limit ?? SESSION_SEARCH_DEFAULT_LIMIT),
			});
			return {
				path: `/v1/desktop/sessions/search?${query}`,
				method: "GET",
			};
		}
		case "sessions.create":
			return {
				path: "/v1/desktop/sessions",
				method: "POST",
				body: {
					request_id: request.requestId,
					cwd: request.cwd,
					...(request.target ? { target: request.target } : {}),
					...(request.model ? { model: request.model } : {}),
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
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/history?${query}`,
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
		case "sessions.notified":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/notified`,
				method: "POST",
				body: { completion_token: request.completionToken },
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
		case "models.catalogue":
			return {
				path: `/v1/desktop/models?live=${request.live ?? false}`,
				method: "GET",
			};
		case "usage.get": {
			const query = new URLSearchParams({
				live: String(request.live ?? false),
				refresh: String(request.refresh ?? false),
			});
			if (request.provider) query.set("provider", request.provider);
			return { path: `/v1/desktop/usage?${query}`, method: "GET" };
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
		case "skills.list":
			return {
				path: `/v1/desktop/skills?session_id=${request.sessionId}${request.name ? `&name=${encodeURIComponent(request.name)}` : ""}`,
				method: "GET",
			};
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
	}
}

/**
 * The local-file bridge, shared by main, the preload and the renderer.
 *
 * These are NOT `DesktopRequest`s. Every op in the union above travels to the
 * backend over HTTP and is validated by a zod schema there; these four handlers
 * (`read-file`, `save-file`, `probe-files`, `read-file-bytes`) never leave the
 * machine, and two of them return bytes that a zod schema would only get in the
 * way of. They are declared here anyway because this module is the one place
 * the three processes already agree on a shape, and a type that lives beside
 * `ReadFileResponse` in a `.d.ts` is a type main cannot import.
 */

/**
 * Paths one `probe-files` call may resolve.
 *
 * A bound rather than a guess: a stat on an unmounted network path can hang for
 * seconds, so the renderer chunks its probe requests and main refuses anything
 * larger rather than turning one call into a stall. 64 is comfortably more than
 * a panel's worth of tiles while keeping a single synchronous batch short. The
 * panel's own list is bounded by the conversation, not by this number: a
 * transcript with hundreds of mentions is probed in chunks of 64, and the
 * extractor no longer caps its output at all (it used to stop at 200 paths,
 * which is what made the tail of a long conversation unreachable).
 */
export const MAX_PROBE_PATHS = 64;

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
	 * Present only when `stat` itself failed (permission, a broken mount) rather
	 * than answering "no such file". Both report `exists: false`; this says
	 * which one happened, because "deleted" and "cannot look" deserve different
	 * words in a bug report.
	 */
	error?: string;
};

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
	components: Record<string, number>;
	by_provider: Record<string, DesktopUsageAggregate>;
	by_session: Record<string, DesktopUsageAggregate>;
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
