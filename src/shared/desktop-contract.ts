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
	z.object({ op: z.literal("providers.list") }).strict(),
	z.object({ op: z.literal("accounts.list") }).strict(),
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
export type DesktopAPI = {
	request: (request: DesktopRequest) => Promise<DesktopResponse>;
	openAuthorization: (operationId: string, reopen?: boolean) => Promise<void>;
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
		case "providers.list":
			return { path: "/v1/auth/providers", method: "GET" };
		case "accounts.list":
			return { path: "/v1/auth/status", method: "GET" };
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
