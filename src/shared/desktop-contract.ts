import { z } from "zod";

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
 * An execution-variable key. Looser than `id` because these are user-named
 * Python identifiers rather than machine ids, but still no slashes, dots or
 * spaces -- the key goes into the PATH, so a permissive value would let the
 * renderer address a route it was never given an operation for.
 */
const variableKey = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);
// The fields create and edit have in common. Both extend it with their own
// required/nullable variants of prompt, interval and unit, which differ because
// create supplies defaults and edit sends only what changed.
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
	 * optional `target`, same 422 for an unresolvable profile. The response is a
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
	z
		.object({ op: z.literal("legacy.agent.variables.list"), agentId: id })
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.variables.create"),
			agentId: id,
			variable: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.variables.get"),
			agentId: id,
			key: variableKey,
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.variables.update"),
			agentId: id,
			key: variableKey,
			variable: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("legacy.agent.variables.delete"),
			agentId: id,
			key: variableKey,
		})
		.strict(),
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
	z.object({ op: z.literal("mcp.list"), sessionId }).strict(),
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
 * `"sessions.command"`), `sessionId` is a 12-char id and `requestId` a 36-char
 * UUID, plus their keys, quotes, colons and commas. 256 is comfortably above
 * that worst case and still far too small to admit a body the per-op check
 * would refuse - the proxy bounds the READ, and `requestDesktop` still applies
 * the exact per-op budget afterwards.
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
};

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
		case "legacy.agent.variables.list":
			return {
				path: `/v1/agents/${request.agentId}/execution-variables`,
				method: "GET",
			};
		case "legacy.agent.variables.create":
			return {
				path: `/v1/agents/${request.agentId}/execution-variables`,
				method: "POST",
				body: request.variable,
			};
		case "legacy.agent.variables.get":
			return {
				path: `/v1/agents/${request.agentId}/execution-variables/${request.key}`,
				method: "GET",
			};
		case "legacy.agent.variables.update":
			return {
				path: `/v1/agents/${request.agentId}/execution-variables/${request.key}`,
				method: "PATCH",
				body: request.variable,
			};
		case "legacy.agent.variables.delete":
			return {
				path: `/v1/agents/${request.agentId}/execution-variables/${request.key}`,
				method: "DELETE",
			};
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
 * **The live half is deliberately empty and the client does not read it.**
 * `agents.tree`, `agents.running/queued/settled/max_running`, `env.mcp_*` and
 * `env.approval_mode` are `LiveState()` defaults, because those facts belong to
 * a SESSION and the desktop already holds them live for the conversation on
 * screen. The `/info` panel renders subagents and MCP from
 * `canonical.frontend` instead. The fields are typed here so they are
 * demonstrably ignored rather than forgotten — a later reader "fixing" the
 * panel to read them would introduce a second source of truth for a live fact.
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
		}>;
		running: number;
		queued: number;
		settled: number;
		max_running: number | null;
		at_capacity: boolean;
		max_depth: number;
		deeper: number;
		cross_session_known: boolean;
		roster_unread: boolean;
	};
	env: {
		mcp_configured: number;
		mcp_connected: number;
		mcp_failed: number;
		mcp_settling: boolean;
		/** `[server name, truncated message]`. */
		mcp_failures: Array<[string, string]>;
		approval_mode: string;
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
		skills: number;
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
