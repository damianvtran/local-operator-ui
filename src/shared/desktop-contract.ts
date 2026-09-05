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
const requestId = z
	.string()
	.regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const sessionImage = z
	.object({
		data_b64: z.string().min(1).max(1_000_000),
		mime_type: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
	})
	.strict();
const chains = z.record(z.array(z.string().max(1024)).max(100));
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
	z
		.object({
			op: z.literal("sessions.list"),
			limit: z.number().int().min(1).max(500).optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("sessions.create"),
			requestId,
			cwd: z.string().min(1).max(4096),
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
	z
		.object({
			op: z.literal("sessions.message"),
			sessionId,
			requestId,
			text: z.string().max(200000),
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
			args: z.string().max(200000).optional(),
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
			op: z.literal("sessions.watch"),
			sessionId,
			subscriptionId: z.string().regex(/^[a-f0-9]{32}$/),
			visible: z.boolean(),
			canNotify: z.boolean(),
		})
		.strict(),
	z.object({ op: z.literal("legacy.models") }).strict(),
	z.object({ op: z.literal("legacy.agent.upload"), agentId: id }).strict(),
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
 * Legacy media relay vocabulary (speech, transcription, agent import). The
 * schema and endpoint map live in main (`desktop-media.ts`); this is the
 * renderer-facing type so preload and callers agree on the shape.
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
	| { op: "agent.import"; fileName: string };

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
	id: string;
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
	configured: boolean;
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
		case "sessions.list":
			return {
				path: `/v1/desktop/sessions?limit=${request.limit ?? 100}`,
				method: "GET",
			};
		case "sessions.create":
			return {
				path: "/v1/desktop/sessions",
				method: "POST",
				body: { request_id: request.requestId, cwd: request.cwd },
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
		case "legacy.models":
			return { path: "/v1/models", method: "GET" };
		case "legacy.agent.upload":
			return { path: `/v1/agents/${request.agentId}/upload`, method: "POST" };
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
