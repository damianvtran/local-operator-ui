import { readLinkPreviewArtifact } from "./link-preview/artifact-reader";
import {
	readMemberFileAttachment,
	readOwnerAuditAttachment,
} from "./team-bridge-audit-media";
/**
 * Authenticated binary/multipart relay for the legacy media routes.
 *
 * The JSON desktop transport cannot carry audio bytes or a multipart body,
 * and the managed backend now requires the bearer on speech, transcription
 * and agent ZIP import. This relay is the narrow bridge: a fixed allowlist of
 * operations, each mapped in main to an exact backend path and method, with
 * the bearer attached here and never crossing IPC. Renderer code submits
 * typed arguments and raw bytes; it cannot pick a URL, method or header.
 *
 * Bodies are bounded so a runaway payload cannot pin main's memory: 16 MiB
 * for uploads (audio and ZIP) and 32 MiB for downloaded speech.
 */

import { z } from "zod";
import {
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_CODE,
	type DesktopRefusalCode,
	desktopRefusalCodeForStatus,
	isDesktopRefusalCode,
} from "../shared/desktop-contract";
import { LINK_PREVIEW_ARTIFACT_ID } from "../shared/link-preview";

const NOTIFICATION_INITIALS = /^[\p{L}\p{N}]{0,2}$/u;

const id = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
/*
 * Team Bridge image ceilings. The upload cap is the hub's own 5 MiB request
 * bound (manager decision D3); the renderer already bounds to 1 MiB, so this is
 * headroom that keeps a renderer bug from sending 16 MiB to a route that will
 * refuse it. The download cap is the same number: a bound attachment can never
 * be larger than the upload that created it, so anything bigger is not one.
 */
const TEAM_BRIDGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/*
 * The only picture types the hub stores (it sniffs and re-states them; D3).
 * A fetched attachment answering any other type is refused here rather than
 * handed to the renderer as a blob: `image/svg+xml` in particular is script-
 * capable, and the renderer must never be the one deciding that.
 */
const TEAM_BRIDGE_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
]);
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;

const profileScope = z.string().regex(/^[a-f0-9]{64}$/);
const profileFields = z
	.object({
		display_name: z.string().max(128).optional(),
		title: z.string().max(160).optional(),
		description: z.string().max(1000).optional(),
		timezone: z.string().max(64).optional(),
	})
	.strict()
	.refine((fields) => Object.keys(fields).length > 0);

// Owner audit is a different authority domain. Keep the tuple closed and
// explicit even though several ids also appear in member attachment requests.
const ownerAuditAttachmentTupleSchema = z
	.object({
		tenantId: id,
		conversationId: id,
		messageId: id,
		attachmentId: id,
		expectedAccountId: id,
	})
	.strict();

/*
 * The byte lane a Team Bridge read asks for (decision a-fdf0). Absent means the
 * image lane, so every existing caller is unchanged; `file` is the generic-file
 * Save. Closed: anything else is refused before a request is built.
 */
const attachmentMode = z.enum(["image", "file"]).optional();

const mediaRequestSchema = z.discriminatedUnion("op", [
	ownerAuditAttachmentTupleSchema
		.extend({
			op: z.literal("team_bridge.owner_audit.attachment"),
			/* Main-side only: core's audit route serves whatever the hub bound and
			   refuses unknown query names, so the mode picks main's reader (type
			   and ceiling) and never travels on the wire. */
			mode: attachmentMode,
		})
		.strict(),
	z
		.object({ op: z.literal("account.profile"), expectedAccountId: id })
		.strict(),
	z
		.object({
			op: z.literal("account.profile.update"),
			expectedAccountId: id,
			scope: profileScope,
			fields: profileFields,
		})
		.strict(),
	z
		.object({
			op: z.literal("account.avatar.put"),
			expectedAccountId: id,
			scope: profileScope,
		})
		.strict(),
	z
		.object({
			op: z.literal("account.avatar.delete"),
			expectedAccountId: id,
			scope: profileScope,
			mode: z.enum(["uploaded", "provider"]),
			confirmed: z.literal(true),
		})
		.strict(),
	z
		.object({
			op: z.literal("speech.create"),
			request: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("speech.agent"),
			agentId: id,
			request: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("transcription.create"),
			fileName: z.string().min(1).max(255),
			mimeType: z.string().min(1).max(128),
			fields: z.record(z.string().max(4096)),
		})
		.strict(),
	z
		.object({
			op: z.literal("agent.import"),
			fileName: z.string().min(1).max(255),
		})
		.strict(),
	// Export is a gated GET that answers with a ZIP, so it belongs on this relay
	// rather than the JSON transport: `desktopEndpoint`'s envelope has nowhere to
	// put binary. It is the only read here, which is why `endpoint()` below
	// returns a method instead of assuming POST.
	z
		.object({ op: z.literal("agent.export"), agentId: id })
		.strict(),
	/*
	 * A local agent's profile picture: read, replace, clear (core
	 * `/v1/agents/{id}/avatar`). The route needs the bearer, which only main
	 * holds, so the renderer cannot point an `<img>` at it. `sha256` is the
	 * content address `agent.yml` publishes - exactly 64 lowercase hex - and is
	 * shape-checked because main builds the query from it.
	 */
	z
		.object({
			op: z.literal("agent.avatar"),
			agentId: id,
			sha256: z.string().regex(/^[0-9a-f]{64}$/),
			// Closed to core's three derivatives (`agent_avatar_sizes`), so the
			// renderer cannot make main build an arbitrary query.
			size: z.union([z.literal(64), z.literal(128), z.literal(256)]).optional(),
		})
		.strict(),
	z.object({ op: z.literal("agent.avatar.put"), agentId: id }).strict(),
	z.object({ op: z.literal("agent.avatar.delete"), agentId: id }).strict(),
	// A durable transcript row references an image by content digest with the
	// payload stripped, so rendering a screenshot after a reload means fetching
	// bytes. That cannot go through the JSON transport (its envelope has nowhere
	// to put them), which is what puts it on this relay.
	//
	// Both identifiers are shape-constrained here as well as by the backend
	// route: this file's whole premise is that renderer code cannot pick a URL,
	// and a digest that reaches `endpoint()` unvalidated is renderer-controlled
	// path text.
	z
		.object({
			op: z.literal("sessions.attachment"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// The child-scoped twin of the op above, for the run panel's reader: a
	// child's durable rows reference attachments in the same content-addressed
	// store, and the parent's route takes the session whose transcript holds the
	// reference — which a child session is not, so it refuses. `childId` is
	// shape-constrained here for the same reason `sessionId` is: the path is
	// built in main, and an unvalidated id would be renderer-controlled path
	// text.
	z
		.object({
			op: z.literal("subagents.attachment"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			childId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// A generated sound's PRE-RENDER peaks sidecar (`<digest>.peaks.json`, 240
	// bars). It rides this relay because it is content IN the session store,
	// served beside the audio it describes by the same attachment route family -
	// the renderer asks the store one question ("what did this session keep under
	// this digest?") rather than learning the store's layout - and because the
	// route needs the bearer, which this relay attaches and the JSON transport's
	// callers would have to re-plumb. Same shape constraints as the attachment op
	// above for the same reason: main builds the path.
	z
		.object({
			op: z.literal("sessions.attachment.waveform"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// One supplement component's assembled HTML document (turn-supplements
	// memo §2.7), as `{ html }` JSON. Both identifiers are shape-constrained
	// here for the same reason the attachment ops' are: the path is built in
	// main, and an unvalidated digest would be renderer-controlled path text.
	// The digest regex is the contract's own (`DIGEST_PATTERN`,
	// `local_operator/supplements/contract.py`): 32 lowercase hex characters.
	z
		.object({
			op: z.literal("sessions.supplementDocument"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	/*
	 * Team Bridge image attachments (image-attachments contract §3). Upload and
	 * fetch ride THIS relay rather than the JSON transport for the reason every
	 * op here does - bytes - and because the bearer must stay in main: the hub
	 * route is member-gated, so the renderer cannot be handed a fetchable URL.
	 * Every id is shape-checked because main builds the path from it.
	 *
	 * The upload is a raw `application/octet-stream` body, not multipart: the hub
	 * ignores the client's type and filename (it sniffs the bytes), so sending
	 * neither means neither can leak into a log or be trusted by mistake.
	 */
	z
		.object({
			op: z.literal("team_bridge.attachment.upload"),
			mode: z.enum(["image", "file"]).optional(),
			fileName: z
				.string()
				.max(512)
				.refine((value) => {
					try {
						return encodeURIComponent(value).length <= 1024;
					} catch {
						return false;
					}
				})
				.optional(),
			tenantId: id,
			conversationId: id,
			/* REQUIRED: the runtime route answers 422 without a captured-owner
			   receipt, and comparing an account to itself is not a guard. Main
			   refuses the request locally when it is absent, so no unguarded
			   attachment call can be constructed. */
			expectedAccountId: id,
		})
		.strict(),
	z
		.object({
			op: z.literal("team_bridge.attachment"),
			/* `file` asks core #3521 for the bound generic file (`?mode=file`). */
			mode: attachmentMode,
			tenantId: id,
			conversationId: id,
			messageId: id,
			attachmentId: id,
			expectedAccountId: id,
		})
		.strict(),
	/*
	 * The Radient account avatar route is authenticated and member-gated. Main
	 * does NOT own the hub bearer: core's AuthStore does. This operation uses
	 * only core's closed binary relay, with the commissioning viewer receipt. The two sizes are the server's complete derivative
	 * set, not a client-chosen resize parameter.
	 */
	z
		.object({
			op: z.literal("team_bridge.avatar"),
			expectedAccountId: id,
			accountId: id,
			hash: z.string().regex(/^[0-9a-f]{16}$/),
			size: z.union([z.literal(64), z.literal(256)]),
		})
		.strict(),
	/*
	 * An agent's own picture, by endpoint (core's closed endpoint relay). The id
	 * is the transport-safe subset the resolver and core both enforce, so a
	 * renderer value can never reshape the path.
	 */
	z
		.object({
			op: z.literal("team_bridge.endpoint_avatar"),
			expectedAccountId: id,
			endpointId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
			hash: z.string().regex(/^[0-9a-f]{16}$/),
			size: z.union([z.literal(64), z.literal(256)]),
		})
		.strict(),
	// Sender composites stay on the private avatar authority: never a URL.
	z
		.object({
			op: z.literal("team_bridge.notification_avatar"),
			expectedAccountId: id,
			tenantId: id,
			accountId: id,
			kind: z.enum(["person", "person_agent"]),
			theme: z.enum(["light", "dark"]),
			size: z.union([z.literal(64), z.literal(256)]),
			initials: z
				.string()
				.max(4)
				.refine((value) => NOTIFICATION_INITIALS.test(value.normalize("NFC"))),
			avatar: z
				.object({ account_id: id, hash: z.string().regex(/^[0-9a-f]{16}$/) })
				.strict()
				.optional(),
			/*
			 * A `person_agent`'s OWN picture (core capability
			 * `team_bridge_endpoint_avatar`). Never alongside `avatar`, and never
			 * for a person: refused below before anything is sent.
			 */
			endpointAvatar: z
				.object({
					endpoint_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
					hash: z.string().regex(/^[0-9a-f]{16}$/),
				})
				.strict()
				.optional(),
		})
		.strict(),
	/*
	 * The Library's content and thumbnail bytes. The asset id is shape-checked
	 * here as well as by the backend route: this relay's premise is that
	 * renderer code cannot pick a URL, and an unvalidated id would become a path
	 * segment. The width is the thumbnail route's own ceiling (`w=480` is the
	 * documented maximum), so a caller cannot ask the daemon for an unbounded
	 * rasterisation.
	 */
	z
		.object({
			op: z.literal("library.content"),
			assetId: z.string().regex(/^la_[0-9a-f]{16}$/),
			/** `?download=1` asks the route for an attachment disposition. */
			download: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("library.thumbnail"),
			assetId: z.string().regex(/^la_[0-9a-f]{16}$/),
			width: z.number().int().min(1).max(480).optional(),
		})
		.strict(),
	/*
	 * A Library audio asset's PRE-RENDER peaks sidecar, the same `{version,
	 * bars, peaks}` document a generated sound's attachment route serves. It
	 * rides this relay for the reason `library.content` does: the renderer must
	 * not learn the store's layout or hold the bearer, and the asset id has to
	 * be validated before it becomes a path segment. The route answers 404 when
	 * the catalog has no sidecar for the asset (a path-backed file imported
	 * rather than generated), which the renderer draws as its flat scrubber.
	 */
	z
		.object({
			op: z.literal("library.waveform"),
			assetId: z.string().regex(/^la_[0-9a-f]{16}$/),
		})
		.strict(),
	/*
	 * One notification sound as `audio/wav` with the volume baked in (core
	 * `/v1/notification-sounds/{id}/audio?volume=`, `features.notification_sounds`).
	 * Main stages it in ~/Library/Sounds or hands it to the renderer's player
	 * (`notification-sound.ts`). The id is the catalog's slug or core's
	 * `custom-[a-z0-9-]{1,40}`, checked here because it becomes a path segment.
	 */
	z
		.object({
			op: z.literal("notification_sounds.audio"),
			soundId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
			volume: z.number().int().min(0).max(100),
		})
		.strict(),
	/*
	 * Add one custom notification sound: multipart `file` + optional `name`
	 * (core `POST /v1/notification-sounds`). The daemon sniffs the bytes and
	 * refuses by content, so the declared type below is never trusted;
	 * `fileName` is the user's own name for the file, used by the daemon only in
	 * refusal copy and as the default display name.
	 */
	z
		.object({
			op: z.literal("notification_sounds.upload"),
			fileName: z.string().min(1).max(255),
			name: z.string().min(1).max(200).optional(),
		})
		.strict(),
	/*
	 * ONE CACHED LINK-PREVIEW ARTIFACT, by the id core derived for it.
	 *
	 * THE ID IS SHAPED HERE, not merely passed through: it is a PATH SEGMENT on this
	 * request and a FILE NAME in main's artifact cache, so one check in front of both
	 * is cheaper than a path bug. `[0-9a-f]{32}` mirrors core's own
	 * `ARTIFACT_ID_PATTERN`, which the artifact route and the store both re-check.
	 *
	 * `expectedAccountId` travels as the `X-Link-Preview-Account` HEADER below, never
	 * as a query parameter: this is a GET, and a GET's URL is the one thing every
	 * intermediary writes down. Core answers 404 when the caller's scope does not
	 * name the id - indistinguishable from "gone" by design — and 422 for a
	 * malformed one.
	 */
	z
		.object({
			op: z.literal("team_bridge.link_preview.artifact"),
			id: z.string().regex(LINK_PREVIEW_ARTIFACT_ID),
			expectedAccountId: z.string().min(1).max(128),
		})
		.strict(),
]);

export type DesktopMediaRequest = z.infer<typeof mediaRequestSchema>;

export type DesktopMediaResponse =
	| {
			status: number;
			kind: "bytes";
			mimeType: string;
			data: Uint8Array;
			cacheControl?: string;
			/**
			 * Core drew the agent glyph where the agent's own picture was asked for
			 * (`X-Avatar-Fallback: glyph`, local-operator #3228). Main keeps such a
			 * composite only for its failure TTL (code review round 1, F1).
			 */
			fallback?: true;
	  }
	| { status: number; kind: "json"; body: unknown }
	| {
			status: number;
			kind: "error";
			detail: string;
			/**
			 * The pairing-family refusal this was, when it was one (`shared/desktop-contract`).
			 *
			 * The media transport answers a DIFFERENT shape from its JSON twin, so the
			 * code is carried here rather than in a `detail` envelope - and it is carried
			 * at all for the same reason: a media refusal the plane wrote must not be
			 * rendered as this app's own sentence (design § 3.5, § 5.1).
			 */
			/**
			 * `renderer_busy` is MAIN-ONLY, deliberately outside the shared
			 * pairing-refusal table: core's composite route uses it for a transient
			 * local overload (503) that the desktop answers with initials. It is a
			 * fact about one core renderer, not a pairing condition, so it must not
			 * become a sentence the renderer shows or a code other routes may claim.
			 */
			code?: DesktopRefusalCode | "renderer_busy";
			/**
			 * The daemon's own refusal code and params, forwarded ONLY for
			 * `notification_sounds.upload`, whose row copy switches on them (see
			 * the relay's error branch).
			 */
			refusal?: { code: string; params?: Record<string, unknown> };
	  };

function endpoint(request: DesktopMediaRequest): {
	path: string;
	method: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
} {
	switch (request.op) {
		case "account.profile":
			return {
				path: `/v1/desktop/account/profile?${new URLSearchParams({ expected_account_id: request.expectedAccountId })}`,
				method: "GET",
			};
		case "account.profile.update":
			return {
				path: `/v1/desktop/account/profile?${new URLSearchParams({ expected_account_id: request.expectedAccountId, scope: request.scope })}`,
				method: "PATCH",
			};
		case "account.avatar.put":
			return {
				path: `/v1/desktop/account/avatar?${new URLSearchParams({ expected_account_id: request.expectedAccountId, scope: request.scope })}`,
				method: "PUT",
			};
		case "account.avatar.delete":
			return {
				path: `/v1/desktop/account/avatar?${new URLSearchParams({ expected_account_id: request.expectedAccountId, scope: request.scope, mode: request.mode, confirmed: "true" })}`,
				method: "DELETE",
			};
		case "speech.create":
			return { path: "/v1/tools/speech", method: "POST" };
		case "speech.agent":
			return { path: `/v1/agents/${request.agentId}/speech`, method: "POST" };
		case "transcription.create":
			return { path: "/v1/transcriptions", method: "POST" };
		case "agent.import":
			return { path: "/v1/agents/import", method: "POST" };
		case "agent.export":
			return { path: `/v1/agents/${request.agentId}/export`, method: "GET" };
		case "agent.avatar":
			return {
				path: `/v1/agents/${request.agentId}/avatar?${new URLSearchParams({
					v: request.sha256,
					...(request.size ? { size: String(request.size) } : {}),
				})}`,
				method: "GET",
			};
		case "agent.avatar.put":
			return { path: `/v1/agents/${request.agentId}/avatar`, method: "PUT" };
		case "agent.avatar.delete":
			return { path: `/v1/agents/${request.agentId}/avatar`, method: "DELETE" };
		case "sessions.attachment":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/attachments/${request.digest}`,
				method: "GET",
			};
		case "subagents.attachment":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/children/${request.childId}/attachments/${request.digest}`,
				method: "GET",
			};
		case "sessions.attachment.waveform":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/attachments/${request.digest}/waveform`,
				method: "GET",
			};
		case "sessions.supplementDocument":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/supplements/${request.digest}/document`,
				method: "GET",
			};
		case "library.content":
			return {
				path: `/v1/desktop/library/assets/${request.assetId}/content${request.download ? "?download=1" : ""}`,
				method: "GET",
			};
		case "library.thumbnail":
			return {
				path: `/v1/desktop/library/assets/${request.assetId}/thumbnail?w=${request.width ?? 480}`,
				method: "GET",
			};
		case "library.waveform":
			return {
				path: `/v1/desktop/library/assets/${request.assetId}/waveform`,
				method: "GET",
			};
		case "notification_sounds.audio":
			return {
				path: `/v1/notification-sounds/${request.soundId}/audio?volume=${request.volume}`,
				method: "GET",
			};
		case "notification_sounds.upload":
			return { path: "/v1/notification-sounds", method: "POST" };
		case "team_bridge.attachment.upload":
			return {
				path: `/v1/desktop/team-bridge/conversations/${request.conversationId}/attachments?${new URLSearchParams({ tenant_id: request.tenantId, expected_account_id: request.expectedAccountId, ...(request.mode ? { mode: request.mode } : {}) })}`,
				method: "POST",
			};
		case "team_bridge.owner_audit.attachment":
			return {
				path: `/v1/desktop/team-bridge/owner-audit/conversations/${request.conversationId}/messages/${request.messageId}/attachments/${request.attachmentId}?${new URLSearchParams({ tenant_id: request.tenantId, expected_account_id: request.expectedAccountId })}`,
				method: "GET",
			};
		/*
		 * `mode=file` only when asked for, never `mode=image`: an older core refuses
		 * any query name it does not know, so spelling out the default would break
		 * every picture against it. The image lane's URL is byte-for-byte unchanged.
		 */
		case "team_bridge.attachment":
			return {
				path: `/v1/desktop/team-bridge/conversations/${request.conversationId}/messages/${request.messageId}/attachments/${request.attachmentId}?${new URLSearchParams({ tenant_id: request.tenantId, expected_account_id: request.expectedAccountId, ...(request.mode === "file" ? { mode: "file" } : {}) })}`,
				method: "GET",
			};
		case "team_bridge.notification_avatar": {
			const query = new URLSearchParams({
				tenant_id: request.tenantId,
				expected_account_id: request.expectedAccountId,
				kind: request.kind,
				theme: request.theme,
				size: String(request.size),
				initials: request.initials,
			});
			if (request.avatar) {
				query.set("v", request.avatar.hash);
				query.set("avatar_account_id", request.avatar.account_id);
			} else if (request.endpointAvatar) {
				query.set("v", request.endpointAvatar.hash);
				query.set("avatar_endpoint_id", request.endpointAvatar.endpoint_id);
			}
			return {
				path: `/v1/desktop/team-bridge/accounts/${request.accountId}/notification-avatar?${query}`,
				method: "GET",
			};
		}
		case "team_bridge.endpoint_avatar":
			return {
				path: `/v1/desktop/team-bridge/endpoints/${request.endpointId}/avatar?${new URLSearchParams({ v: request.hash, size: String(request.size), expected_account_id: request.expectedAccountId })}`,
				method: "GET",
			};
		case "team_bridge.avatar":
			return {
				path: `/v1/desktop/team-bridge/accounts/${request.accountId}/avatar?${new URLSearchParams({ v: request.hash, size: String(request.size), expected_account_id: request.expectedAccountId })}`,
				method: "GET",
			};
		/*
		 * One cached link-preview artifact id (core's scope-derived hash).
		 *
		 * The path segment is the id and nothing else: no query string at all, because
		 * the account receipt this route needs travels as the `X-Link-Preview-Account`
		 * HEADER (see the header block in `requestDesktopMediaOutcome`) - a GET's URL is
		 * written down by every intermediary, and an account id does not belong there.
		 * `encodeURIComponent` is belt over the schema's `[0-9a-f]{32}`: the schema is
		 * this client's check, and a hand-built request must not be able to turn an id
		 * into a path fragment either.
		 */
		case "team_bridge.link_preview.artifact":
			return {
				path: `/v1/desktop/team-bridge/link-preview/artifact/${encodeURIComponent(request.id)}`,
				method: "GET",
			};
	}
}

/**
 * A media request in the same two parts as `./desktop-transport`'s JSON twin,
 * for the same reason: every failure here resolves rather than throws, so the
 * promise's own resolution is no evidence that anything answered (review
 * round 1, F-1). `answered` is true exactly when `fetch` resolved.
 */
export type DesktopMediaOutcome = {
	response: DesktopMediaResponse;
	/** Whether the daemon itself answered this request. */
	answered: boolean;
};

/**
 * A refusal's `params`, kept only as SHORT SCALARS (review round 1, n2): the
 * renderer interpolates them into copy (`{seconds}`, `format`), so nothing
 * else is needed, and the daemon being trusted is no reason to pass an
 * arbitrarily large or nested object across IPC. At most 8 keys of at most 64
 * characters; strings are cut to 128; objects, arrays and non-finite numbers
 * are dropped.
 */
export function scalarParams(
	params: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
	const out: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(params).slice(0, 8)) {
		if (key.length > 64) continue;
		if (typeof value === "string") out[key] = value.slice(0, 128);
		else if (typeof value === "number" && Number.isFinite(value))
			out[key] = value;
		else if (typeof value === "boolean") out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export async function requestDesktopMediaOutcome(
	input: unknown,
	// ArrayBuffer-backed by contract: `Blob`, which this relay builds the
	// multipart body from, accepts no other view. `desktop-ipc.ts` is where the
	// value arriving over IPC is narrowed to this, so the requirement travels
	// with the type instead of being asserted again here.
	bytes: Uint8Array<ArrayBuffer> | null,
	backendUrl: string,
	token: string | null,
): Promise<DesktopMediaOutcome> {
	const parsed = mediaRequestSchema.safeParse(input);
	if (
		!parsed.success ||
		(parsed.data.op === "team_bridge.notification_avatar" &&
			((parsed.data.avatar &&
				parsed.data.avatar.account_id !== parsed.data.accountId) ||
				// An agent's picture is never drawn on a person, and one banner
				// never names both pictures (core refuses either; so do we, first).
				(parsed.data.endpointAvatar &&
					(parsed.data.kind !== "person_agent" || parsed.data.avatar))))
	) {
		// Never sent.
		return {
			response: {
				status: 422,
				kind: "error",
				detail: "Invalid media operation.",
			},
			answered: false,
		};
	}
	if (!token) {
		// Never sent: this app has no credential to send. Coded, so the renderer can
		// say THIS fact (a pairing condition) rather than echoing the machine sentence.
		return {
			response: {
				status: 503,
				kind: "error",
				detail: DESKTOP_MACHINE_DETAIL.noCredential,
				code: DESKTOP_REFUSAL_CODE.noCredential,
			},
			answered: false,
		};
	}
	const request = parsed.data;
	if (bytes && bytes.byteLength > MAX_UPLOAD_BYTES) {
		// Never sent: refused on this side of the socket.
		return {
			response: {
				status: 413,
				kind: "error",
				detail: "This file is too large.",
			},
			answered: false,
		};
	}
	if (
		(request.op === "team_bridge.attachment.upload" ||
			request.op === "account.avatar.put") &&
		bytes &&
		bytes.byteLength >
			(request.op === "account.avatar.put"
				? 1024 * 1024
				: request.mode === "file"
					? 25 * 1024 * 1024
					: TEAM_BRIDGE_ATTACHMENT_MAX_BYTES)
	) {
		// Never sent: the hub would answer 413 for the same bytes.
		return {
			response: {
				status: 413,
				kind: "error",
				detail: "This image is too large.",
			},
			answered: false,
		};
	}
	const target = endpoint(request);
	/* The generic-file Save lane (a-fdf0), under either authority. */
	const fileLane =
		(request.op === "team_bridge.attachment" ||
			request.op === "team_bridge.owner_audit.attachment") &&
		request.mode === "file";

	let body: BodyInit | undefined;
	let contentType: string | undefined;
	if (
		request.op === "account.profile" ||
		request.op === "account.avatar.delete" ||
		request.op === "agent.export" ||
		request.op === "agent.avatar" ||
		request.op === "agent.avatar.delete" ||
		request.op === "sessions.attachment" ||
		request.op === "subagents.attachment" ||
		request.op === "sessions.attachment.waveform" ||
		request.op === "sessions.supplementDocument" ||
		request.op === "library.content" ||
		request.op === "library.thumbnail" ||
		request.op === "library.waveform" ||
		request.op === "notification_sounds.audio" ||
		request.op === "team_bridge.attachment" ||
		request.op === "team_bridge.owner_audit.attachment" ||
		request.op === "team_bridge.avatar" ||
		request.op === "team_bridge.endpoint_avatar" ||
		request.op === "team_bridge.link_preview.artifact" ||
		request.op === "team_bridge.notification_avatar"
	) {
		// A GET carries no body; `fetch` rejects one outright.
		body = undefined;
	} else if (
		request.op === "team_bridge.attachment.upload" ||
		request.op === "account.avatar.put" ||
		request.op === "agent.avatar.put"
	) {
		/*
		 * Both are a raw image body with no filename or declared type: the receiver
		 * sniffs the magic bytes (core's avatar gate refuses by content, never by
		 * extension), so nothing the client claims can be trusted by mistake.
		 */
		if (!bytes || bytes.byteLength === 0) {
			return {
				response: {
					status: 422,
					kind: "error",
					detail: "An image is required.",
				},
				answered: false,
			};
		}
		body = new Blob([bytes]);
		contentType = "application/octet-stream";
	} else if (request.op === "account.profile.update") {
		body = JSON.stringify(request.fields);
		contentType = "application/json";
	} else if (request.op === "speech.create" || request.op === "speech.agent") {
		body = JSON.stringify(request.request);
		contentType = "application/json";
	} else {
		if (!bytes) {
			return {
				response: { status: 422, kind: "error", detail: "A file is required." },
				answered: false,
			};
		}
		const form = new FormData();
		const blob = new Blob([bytes], {
			type:
				request.op === "transcription.create"
					? request.mimeType
					: request.op === "notification_sounds.upload"
						? "application/octet-stream"
						: "application/zip",
		});
		form.append("file", blob, request.fileName);
		if (request.op === "notification_sounds.upload" && request.name) {
			form.append("name", request.name);
		}
		if (request.op === "transcription.create") {
			for (const [key, value] of Object.entries(request.fields)) {
				form.append(key, value);
			}
		}
		body = form;
		// fetch sets the multipart boundary itself; forcing the header breaks it.
	}

	let answered = false;
	try {
		const response = await fetch(new URL(target.path, backendUrl), {
			method: target.method,
			headers: {
				Accept: fileLane
					? "application/octet-stream, application/json"
					: request.op === "team_bridge.owner_audit.attachment"
						? "image/png, image/jpeg"
						: "application/json, audio/*, image/*, application/octet-stream",
				...(contentType ? { "Content-Type": contentType } : {}),
				// #3363 forwards the name only in file mode; it is display content,
				// never a filesystem path or a declared MIME/safety claim.
				...(request.op === "team_bridge.attachment.upload" &&
				request.mode === "file" &&
				request.fileName
					? { "X-Bridge-File-Name": encodeURIComponent(request.fileName) }
					: {}),
				/*
				 * The artifact route's account RECEIPT, as a header and only as a header
				 * (core's `ACCOUNT_RECEIPT_HEADER`). The preview endpoints take the account
				 * this session claims so core can refuse a mismatch; on this GET there is no
				 * body to carry it and a query string would put it in every log between here
				 * and the daemon, which is precisely what core's route refuses to do.
				 */
				...(request.op === "team_bridge.link_preview.artifact"
					? { "X-Link-Preview-Account": request.expectedAccountId }
					: {}),
				Authorization: `Bearer ${token}`,
			},
			body,
			// Private avatars are cached only as authority-scoped renderer blobs.
			// Neither Electron nor an intermediary may persist them across login.
			// A teammate's file is never kept by Electron's HTTP cache either.
			...(request.op === "team_bridge.owner_audit.attachment" ||
			fileLane ||
			request.op === "team_bridge.avatar" ||
			request.op === "team_bridge.endpoint_avatar" ||
			request.op === "team_bridge.notification_avatar"
				? { cache: "no-store" as const }
				: {}),
			redirect: "error",
			signal: AbortSignal.timeout(
				request.op === "team_bridge.notification_avatar" ? 1500 : 120000,
			),
		});
		answered = true;
		const responseType = response.headers.get("content-type") ?? "";
		if (request.op === "team_bridge.link_preview.artifact") {
			// The one byte op whose result main KEEPS ON DISK, so its ceiling is
			// enforced before anything is buffered (`artifact-reader.ts`).
			return {
				response: await readLinkPreviewArtifact(response),
				answered: true,
			};
		}
		if (request.op === "team_bridge.owner_audit.attachment") {
			return {
				response: await readOwnerAuditAttachment(response, request.mode),
				answered: true,
			};
		}
		if (request.op === "team_bridge.attachment" && request.mode === "file") {
			// Bounded and header-checked BEFORE anything is buffered (25 MiB lane).
			return {
				response: await readMemberFileAttachment(response),
				answered: true,
			};
		}
		if (
			request.op === "team_bridge.avatar" ||
			request.op === "team_bridge.endpoint_avatar" ||
			request.op === "team_bridge.notification_avatar"
		) {
			const composite = request.op === "team_bridge.notification_avatar";
			const mime = responseType.split(";")[0].trim().toLowerCase();
			const refuse = (
				status: number,
				code?: "renderer_busy",
			): DesktopMediaOutcome => ({
				response: {
					kind: "error",
					status,
					detail: "The avatar could not be read.",
					...(code ? { code } : {}),
				},
				answered: true,
			});
			// Refusals (including an older runtime's 404) need no body. In
			// particular, never buffer an unbounded JSON/HTML error as an image.
			if (
				!response.ok ||
				!(composite
					? mime === "image/png"
					: TEAM_BRIDGE_ATTACHMENT_TYPES.has(mime)) ||
				!response.body
			) {
				/* The composite's transient refusal is a coded JSON envelope, not an
				 * image. Read ONLY that closed case, bounded like every other error
				 * body; the consumer branches on detail.code (core review M1), never
				 * on the status, which also means an unavailable local transport. */
				let busy = false;
				if (
					composite &&
					response.status === 503 &&
					response.body &&
					mime === "application/json"
				) {
					const reader = response.body.getReader();
					let body = "";
					try {
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							body += new TextDecoder().decode(value, { stream: true });
							if (body.length > 16 * 1024) break;
						}
						if (body.length <= 16 * 1024) {
							const envelope: unknown = JSON.parse(body);
							busy =
								typeof envelope === "object" &&
								envelope !== null &&
								"detail" in envelope &&
								typeof envelope.detail === "object" &&
								envelope.detail !== null &&
								"code" in envelope.detail &&
								envelope.detail.code === "renderer_busy";
						}
					} catch {
						// A malformed refusal keeps the generic bounded-image failure.
					} finally {
						await reader.cancel().catch(() => undefined);
					}
				} else {
					await response.body?.cancel();
				}
				return refuse(
					response.ok ? 502 : response.status,
					busy ? "renderer_busy" : undefined,
				);
			}
			const limit = composite ? 256 * 1024 : 1024 * 1024;
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let length = 0;
			// Content-Length alone cannot bound a chunked (or dishonest) peer.
			// Stop reading at the cap rather than allocate then inspect arrayBuffer.
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					length += value.byteLength;
					if (length > limit) {
						await reader.cancel();
						return refuse(502);
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
			if (!length) return refuse(502);
			const data = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				data.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return {
				response: {
					kind: "bytes",
					status: response.status,
					mimeType: mime,
					data,
					...(composite && response.headers.get("x-avatar-fallback") === "glyph"
						? { fallback: true as const }
						: {}),
				},
				answered: true,
			};
		}
		if (!response.ok) {
			// Error bodies from the backend already suppress reflected secrets;
			// still, only a short detail string is forwarded.
			let detail = "The media request failed.";
			let declaredCode: string | undefined;
			let declaredParams: Record<string, unknown> | undefined;
			if (responseType.includes("application/json")) {
				try {
					const parsedError = (await response.json()) as {
						detail?: unknown;
						message?: unknown;
					};
					const raw = parsedError.detail ?? parsedError.message;
					if (typeof raw === "string") {
						detail = raw.slice(0, 512);
					} else if (typeof raw === "object" && raw !== null) {
						/*
						 * The core's i18n envelope `{code, params, text}` (RFC §2.6): the
						 * sentence is `text` (the newer contract, read before the older
						 * object shape's `message`) and the DECLARED code is carried so the
						 * renderer's media reader can treat it like any other declared
						 * code - the precedence `desktopResult` documents.
						 */
						const envelope = raw as {
							code?: unknown;
							text?: unknown;
							message?: unknown;
						};
						const sentence =
							typeof envelope.text === "string" && envelope.text.trim()
								? envelope.text
								: typeof envelope.message === "string" &&
										envelope.message.trim()
									? envelope.message
									: null;
						if (sentence !== null) detail = sentence.slice(0, 512);
						if (typeof envelope.code === "string") {
							declaredCode = envelope.code;
						}
						const params = (raw as { params?: unknown }).params;
						if (
							typeof params === "object" &&
							params !== null &&
							!Array.isArray(params)
						) {
							declaredParams = scalarParams(params as Record<string, unknown>);
						}
					}
				} catch {
					// Keep the generic detail.
				}
			}
			return {
				response: {
					status: response.status,
					kind: "error",
					detail,
					// A code the refusal DECLARED wins (its own category); otherwise only a
					// path the plane has to ADMIT makes the status a pairing fact:
					// `speech.create` and `agent.export` are outside `/v1/desktop/`, where a
					// 503 is that route's own failure and not this app's pairing.
					code:
						declaredCode !== undefined && isDesktopRefusalCode(declaredCode)
							? declaredCode
							: desktopRefusalCodeForStatus(target.path, response.status),
					/*
					 * A notification-sound upload's refusal is about the FILE (`too_long`,
					 * `unsupported_format` with `params.format`, ...), and the settings
					 * row's copy and remedy switch on that code, never on `detail`. The
					 * pairing `code` above cannot carry it (that table is closed), so
					 * this op alone forwards the daemon's own code and params.
					 */
					...(request.op === "notification_sounds.upload" &&
					declaredCode !== undefined
						? {
								refusal: {
									code: declaredCode.slice(0, 64),
									...(declaredParams ? { params: declaredParams } : {}),
								},
							}
						: {}),
				},
				answered: true,
			};
		}
		if (responseType.includes("application/json")) {
			return {
				response: {
					status: response.status,
					kind: "json",
					body: await response.json(),
				},
				answered: true,
			};
		}
		if (
			(request.op === "team_bridge.attachment" ||
				request.op === "agent.avatar") &&
			!TEAM_BRIDGE_ATTACHMENT_TYPES.has(
				responseType.split(";")[0].trim().toLowerCase(),
			)
		) {
			// A member-gated picture route answering a non-picture is not one of
			// ours; refuse it before any byte reaches the renderer (see the set).
			// The agent avatar shares the set because core stores exactly PNG or
			// JPEG, so anything else (an SVG above all) is not a picture it wrote.
			return {
				response: {
					status: 502,
					kind: "error",
					detail: "The backend returned an unsupported image type.",
				},
				answered: true,
			};
		}
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (
			buffer.byteLength > MAX_DOWNLOAD_BYTES ||
			(request.op === "team_bridge.attachment" &&
				buffer.byteLength > TEAM_BRIDGE_ATTACHMENT_MAX_BYTES)
		) {
			return {
				response: {
					status: 502,
					kind: "error",
					detail: "The backend returned too much data.",
				},
				// The daemon answered; what it sent was over this relay's ceiling.
				answered: true,
			};
		}
		return {
			response: {
				status: response.status,
				kind: "bytes",
				mimeType: responseType || "application/octet-stream",
				data: buffer,
			},
			answered: true,
		};
	} catch {
		return {
			response: {
				status: 503,
				kind: "error",
				detail: DESKTOP_MACHINE_DETAIL.transportFailed,
				code: DESKTOP_REFUSAL_CODE.transportFailed,
			},
			/*
			 * Survives the catch for the same reason as its JSON twin, and with the same
			 * two cases: a body that failed to parse was already `answered: true`, and so
			 * is a failure during the body read. A timeout abort that never got a
			 * response throws out of `fetch` first and returns `false` (review round 2
			 * MINOR-1; review round 3 MINOR-1 found the second case).
			 */
			answered,
		};
	}
}

export async function requestDesktopMedia(
	input: unknown,
	bytes: Uint8Array<ArrayBuffer> | null,
	backendUrl: string,
	token: string | null,
): Promise<DesktopMediaResponse> {
	return (await requestDesktopMediaOutcome(input, bytes, backendUrl, token))
		.response;
}
