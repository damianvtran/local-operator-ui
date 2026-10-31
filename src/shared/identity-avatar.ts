/*
 * THE ONE AVATAR RESOLVER FOR A TEAM BRIDGE IDENTITY (2026-10-30).
 *
 * WHY IT EXISTS. In production, "Aida (Damian Tran)" showed Damian's face on
 * message rows and in the profile card, and Sherman's chief of staff showed
 * Sherman's photo. Every surface resolved a picture from the directory row it
 * was given, and an agent's directory row IS its owner's row (the agent rides
 * on `member.agent`). So the photo lookup used the owner's `account_id`, and
 * the Bot glyph each surface passed in was only a FALLBACK that a loaded photo
 * replaced. Each surface had its own `agent ? <Bot/> : …` fallback, and one
 * forgotten branch on a new surface was all it took to regress.
 *
 * THE RULE, ENFORCED HERE AND NOWHERE ELSE:
 *   - A human resolves to their own account avatar (hash-pinned, same-account).
 *   - An agent resolves by ENDPOINT: first the agent's own published picture,
 *     then `src: null`, which every renderer draws as the agent glyph. An agent
 *     NEVER resolves to an account avatar. The owner's account id rides on the
 *     identity for keying and labels only, and is never read for pixels.
 *
 * The result type makes the wrong answer impossible to express: an agent's
 * `src` can only be `{ type: "endpoint" }` or null.
 * `scripts/identity-avatar.test.mjs` fails if any input, including an agent
 * whose owner has a photo, or whose `avatar_url` names an account, resolves an
 * agent to an account picture.
 *
 * THE ENDPOINT SEAM (absent today, and WIDER THAN THIS FILE). Agents cannot
 * publish a picture yet. When they can, the hub publishes it on the
 * directory's agent object as a relative, hash-pinned `avatar_url` of the form
 * `/v1/messaging/endpoints/<endpoint_id>/avatar?v=<16 hex>` — the route
 * agent-server already serves (`BridgeEndpointAvatarPointer.AvatarURL`), the
 * same shape and closure as the account route. This file parses that shape and
 * refuses one whose endpoint differs from the identity's.
 *
 * LANDING IT IS NOT A ONE-LINE CHANGE, and this note exists so the next reader
 * does not plan it as one:
 *   1. the directory must send `agent.avatar_url` (validated at the boundary by
 *      `teamBridgeDirectoryAgentSchema` in `team-bridge-contract.ts`);
 *   2. an ENDPOINT-scoped byte relay must exist in main and core — today the
 *      only one is account-scoped (`desktop-media.ts` `team_bridge.avatar` →
 *      `TeamBridgeApi.avatarBytes`, keyed by `accountId` + `expectedAccountId`),
 *      and `useIdentityAvatar` draws an endpoint `src` as the glyph because
 *      there is nothing to fetch it with;
 *   3. the notification sender parser drops any `avatar` on a `person_agent`
 *      (`team-bridge-notify.ts`), so a banner needs an endpoint source admitted
 *      there before an agent picture can reach an OS notification at all.
 * Until all three land, an agent keeps the glyph — and it must never fall back
 * to the owner's account picture in the meantime.
 *
 * Shared by the renderer (plates, profile card) and the notification sender
 * descriptor, so a desktop banner and a message row cannot disagree.
 */

/** Hub `createAccount` assigns UUIDs; core also admits legacy `acc_…` ids. */
const ACCOUNT_ID = String.raw`(?:acc_[A-Za-z0-9_-]{1,64}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})`;
/*
 * Endpoint ids on the wire are opaque but bounded (`id` in the contract is
 * 1-128 chars); keep the transport-safe subset only. Accepting escaped path
 * segments would widen a closed route. agent-server mints `bep_<hex>`, which
 * this covers, and its own builder path-escapes the id — escaping is a no-op
 * inside this charset, so a served URL always matches here.
 */
const ENDPOINT_ID = String.raw`[A-Za-z0-9_-]{1,128}`;

export const ACCOUNT_AVATAR_URL = new RegExp(
	String.raw`^\/v1\/accounts\/(${ACCOUNT_ID})\/avatar\?v=([0-9a-f]{16})$`,
);
/*
 * THE SERVED ROUTE, not a guess: agent-server publishes this exact shape from
 * `BridgeEndpointAvatarPointer.AvatarURL`
 * (`internal/models/bridge_endpoint_avatar.go`), and all three verbs live under
 * `/v1/messaging/endpoints/:endpointid/avatar`
 * (`internal/controllers/messaging_endpoint_avatars.go`). A resolver written
 * against `/v1/endpoints/…` would parse nothing the hub ever sends, and the
 * failure is silent — plates would keep the glyph forever while the tests stayed
 * green against the same wrong fixture (agent review round 1, F1).
 */
export const ENDPOINT_AVATAR_URL = new RegExp(
	String.raw`^\/v1\/messaging\/endpoints\/(${ENDPOINT_ID})\/avatar\?v=([0-9a-f]{16})$`,
);

type AccountProfileAvatar = {
	avatar?: { source?: string; hash?: string } | null;
} | null;

/** Who is being pictured. `kind` decides the resolution path, not the caller. */
export type AvatarIdentity =
	| {
			kind: "human";
			account_id: string;
			/** The directory's hash-pinned account avatar path, if any. */
			avatar_url?: string;
			profile?: AccountProfileAvatar;
	  }
	| {
			kind: "agent";
			/** The OWNER's account. Keying and labels only, never pixels. */
			account_id: string;
			/** The agent's endpoint; null when the directory has not named it. */
			endpoint_id: string | null;
			/**
			 * SEAM: the agent's OWN published picture (endpoint-scoped). Absent
			 * today; see the module comment. Never the owner's `avatar_url`.
			 */
			avatar_url?: string;
	  };

export type AccountAvatarSource = {
	type: "account";
	accountId: string;
	hash: string;
};
export type EndpointAvatarSource = {
	type: "endpoint";
	endpointId: string;
	hash: string;
};

/** `src: null` means: draw the identity's own placeholder (glyph/initial). */
export type ResolvedIdentityAvatar =
	| { kind: "human"; src: AccountAvatarSource | null }
	| { kind: "agent"; src: EndpointAvatarSource | null };

export function resolveIdentityAvatar(
	identity: AvatarIdentity,
): ResolvedIdentityAvatar {
	if (identity.kind === "agent") {
		return { kind: "agent", src: endpointAvatar(identity) };
	}
	return { kind: "human", src: accountAvatar(identity) };
}

function endpointAvatar(
	identity: Extract<AvatarIdentity, { kind: "agent" }>,
): EndpointAvatarSource | null {
	if (!identity.endpoint_id || typeof identity.avatar_url !== "string")
		return null;
	const match = ENDPOINT_AVATAR_URL.exec(identity.avatar_url);
	// Another endpoint's picture is refused, never shown under this agent.
	if (!match || match[1] !== identity.endpoint_id) return null;
	return { type: "endpoint", endpointId: match[1], hash: match[2] };
}

function accountAvatar(
	identity: Extract<AvatarIdentity, { kind: "human" }>,
): AccountAvatarSource | null {
	// The person said "no picture": a lingering URL must not override that.
	if (identity.profile?.avatar?.source === "none") return null;
	if (typeof identity.avatar_url !== "string") return null;
	const match = ACCOUNT_AVATAR_URL.exec(identity.avatar_url);
	if (!match || match[1] !== identity.account_id) return null;
	// The URL and the profile hash both come from the directory. A
	// disagreement is refused rather than shown under another version's key.
	const profileHash = identity.profile?.avatar?.hash;
	if (identity.profile?.avatar && profileHash !== match[2]) return null;
	return { type: "account", accountId: match[1], hash: match[2] };
}

/**
 * A directory row as an identity of the given kind.
 *
 * WHY THE KIND IS AN ARGUMENT. An agent and its owner share ONE directory row
 * (the agent rides on `member.agent`), so the row alone cannot say which of
 * the two a surface is picturing. That ambiguity is exactly what put owners'
 * faces on their agents. Every caller states the kind. For an agent, only
 * the agent object's own fields are read: the row's `avatar_url` and
 * `profile` belong to the owner and are never copied across.
 */
export function directoryIdentity(
	member: {
		account_id: string;
		avatar_url?: string;
		profile?: AccountProfileAvatar;
		agent?: { endpoint_id?: string; avatar_url?: unknown } | null;
	},
	kind: "human" | "agent",
	endpointId?: string | null,
): AvatarIdentity {
	if (kind === "agent") {
		const ownPicture = member.agent?.avatar_url;
		return {
			kind: "agent",
			account_id: member.account_id,
			endpoint_id: endpointId ?? member.agent?.endpoint_id ?? null,
			...(typeof ownPicture === "string" ? { avatar_url: ownPicture } : {}),
		};
	}
	return {
		kind: "human",
		account_id: member.account_id,
		avatar_url: member.avatar_url,
		profile: member.profile,
	};
}
