/**
 * The desktop community surface's pure rules (RFC v2.4 §5.1-§5.5, frames D1-D7,
 * D20).
 *
 * WHY A SEPARATE MODEL. Every decision a reviewer needs to trust lives here,
 * away from React: which trial card a free user sees (and that the community
 * join is never withheld), which channel is read-only, what each sender-only
 * outcome is and when the draft survives it, how history pages merge, and which
 * reads an event invalidates. The node tests (`scripts/community-model.test.mjs`)
 * pin each arm without a renderer, the house pattern of
 * `team-bridge-trial-model.ts`.
 *
 * WHAT IS DELIBERATELY NOT HERE. DMs, contact requests, agent approvals,
 * private-channel invites, settings and staff tools are later lanes; their
 * seams are typed (`CommunityRequestsSeam`, `CommunityRailSection`) so those
 * lanes add arms rather than reshaping these.
 */
import type {
	CommunityChannel,
	CommunityEventBatch,
	CommunityFailure,
	CommunityMessage,
	CommunityRefusalCategory,
	CommunitySubmission,
} from "@shared/api/local-operator/community-api";

/* ===================================================== D1: no Team plan entry */

/** `private_access` of RFC §5.1 (what the private Team Bridge can offer). */
export type CommunityPrivateAccess =
	| "available"
	| "no_org"
	| "no_team_plan"
	| "other_unavailable"
	| "unknown";

/** `trial_offer` of RFC §5.1. */
export type CommunityTrialOffer =
	| "eligible"
	| "checkout_open"
	| "reconciling"
	| "owner_required"
	| "ineligible"
	| "unknown";

/** `community_access` of RFC §5.1. */
export type CommunityAccess = "joinable" | "joined" | "unavailable";

/** The trial card's one state (RFC §5.1 "Entry paths, by state"). */
export type CommunityTrialCard =
	/** Signed in, no Radient organization: Console org creation first. */
	| { kind: "create_org"; url: string }
	/** A member who is not an owner/admin: no checkout, ask an owner. */
	| { kind: "ask_owner"; orgName: string | null }
	/** Owner/admin, eligible: Console checkout pinned to the selected org. */
	| { kind: "start"; url: string; tenantId: string; orgName: string | null }
	/** Checkout already open elsewhere: resume that session, never a second. */
	| { kind: "resume"; url: string; tenantId: string }
	/** Payment done, subscription event not yet seen. */
	| { kind: "reconciling" };

/** What the no-plan entry (D1) renders. */
export type CommunityNoPlanView =
	/** RFC §5.1: signed out offers sign-in and nothing else. */
	| { kind: "signed_out" }
	/** A quiet placeholder while the plan is being read (no flash of copy). */
	| { kind: "checking"; community: CommunityAccess }
	/** "Couldn't check your Team plan · Retry" - never a commercial claim. */
	| { kind: "plan_check_failed"; community: CommunityAccess }
	/** Existing Team access is never hidden by the upsell. */
	| { kind: "has_team" }
	| {
			kind: "offer";
			/** `null` = no trial card (ineligible): community join only. */
			trial: CommunityTrialCard | null;
			community: CommunityAccess;
	  };

/** The Console page that creates an organization (the trial follows there). */
export const CONSOLE_CREATE_ORG_URL =
	"https://console.radienthq.com/dashboard/organizations/new";

/**
 * Decide the D1 entry from the three independent RFC §5.1 states.
 *
 * The rules this function exists to keep:
 * - signed out answers sign-in only (nothing else is offered until sign-in);
 * - an outage answers `plan_check_failed`, never "you don't have a plan";
 * - `available` is `has_team`: the upsell never covers existing access;
 * - every other arm keeps the community join, whatever billing says - "billing
 *   failures never disable community join";
 * - the checkout URL is pinned to the SELECTED org (never the Console's
 *   default), which is why `subscribeUrl` takes the tenant.
 */
export function communityNoPlanView(input: {
	signedIn: boolean | "unknown";
	privateAccess: CommunityPrivateAccess;
	trialOffer: CommunityTrialOffer;
	communityAccess: CommunityAccess;
	selectedTenantId: string | null;
	selectedOrgName: string | null;
	subscribeUrl: (tenantId: string) => string;
}): CommunityNoPlanView {
	if (input.signedIn === false) return { kind: "signed_out" };
	const community = input.communityAccess;
	if (input.signedIn === "unknown") return { kind: "checking", community };
	if (input.privateAccess === "available") return { kind: "has_team" };
	if (input.privateAccess === "unknown") return { kind: "checking", community };
	if (input.privateAccess === "other_unavailable")
		return { kind: "plan_check_failed", community };
	if (input.privateAccess === "no_org")
		return {
			kind: "offer",
			trial: { kind: "create_org", url: CONSOLE_CREATE_ORG_URL },
			community,
		};
	// no_team_plan: the trial card follows the offer state.
	const tenantId = input.selectedTenantId;
	switch (input.trialOffer) {
		case "eligible":
			return {
				kind: "offer",
				trial: tenantId
					? {
							kind: "start",
							url: input.subscribeUrl(tenantId),
							tenantId,
							orgName: input.selectedOrgName,
						}
					: null,
				community,
			};
		case "checkout_open":
			return {
				kind: "offer",
				trial: tenantId
					? { kind: "resume", url: input.subscribeUrl(tenantId), tenantId }
					: null,
				community,
			};
		case "reconciling":
			return { kind: "offer", trial: { kind: "reconciling" }, community };
		case "owner_required":
			return {
				kind: "offer",
				trial: { kind: "ask_owner", orgName: input.selectedOrgName },
				community,
			};
		case "ineligible":
			return { kind: "offer", trial: null, community };
		case "unknown":
			return { kind: "plan_check_failed", community };
	}
}

/** The membership fields the D1 inputs read (`MembershipSummary`). */
export type CommunityMembershipRow = {
	tenant_id: string;
	tenant_name?: string;
	role: string;
	status: "active" | "pending" | "disabled";
	is_home?: boolean;
	plan?: { status: string } | null;
};

/**
 * `private_access` and the selected org from the memberships read.
 *
 * - pending is `unknown` (a placeholder, never a premature "no plan");
 * - a failed read is `other_unavailable` (the retryable plan-check failure);
 * - no ACTIVE membership at all is `no_org`;
 * - an active membership on a Team plan (`active` / `past_due`, agent-server's
 *   entitlement pair) is `available`, otherwise `no_team_plan`.
 *
 * The selected org is the home org when it is active, else the first active
 * row: the checkout must be pinned to an org the reader can see named on the
 * card, never the Console's own default.
 */
export function privateAccessFromMemberships(input: {
	pending: boolean;
	failed: boolean;
	memberships: readonly CommunityMembershipRow[] | null | undefined;
}): {
	access: CommunityPrivateAccess;
	selected: CommunityMembershipRow | null;
} {
	if (input.failed) return { access: "other_unavailable", selected: null };
	if (input.pending || !input.memberships)
		return { access: "unknown", selected: null };
	const active = input.memberships.filter((row) => row.status === "active");
	if (active.length === 0) return { access: "no_org", selected: null };
	if (
		active.some(
			(row) => row.plan?.status === "active" || row.plan?.status === "past_due",
		)
	)
		return { access: "available", selected: null };
	const selected = active.find((row) => row.is_home) ?? active[0];
	return { access: "no_team_plan", selected };
}

/**
 * `trial_offer` from the trial eligibility read and the selected org's role.
 *
 * The eligibility read is the authority when it answers. When it cannot (an
 * older server, the route absent, a failed read) the Console still decides
 * eligibility at checkout, so an owner/admin keeps the Console route and a
 * member is told to ask an owner: an unreadable eligibility must neither
 * invent a refusal nor hide the community. A PENDING read is the caller's
 * `checking` state (it passes `privateAccess: "unknown"`), not an arm here.
 */
export function trialOfferFrom(input: {
	eligibility: { eligible: boolean; reason: string | null } | null;
	selected: CommunityMembershipRow | null;
}): CommunityTrialOffer {
	const canBuy =
		input.selected?.role === "owner" || input.selected?.role === "admin";
	if (input.eligibility) {
		if (input.eligibility.eligible)
			return canBuy ? "eligible" : "owner_required";
		const reason = input.eligibility.reason;
		if (reason === "not_owner") return "owner_required";
		if (reason === "checkout_open") return "checkout_open";
		if (reason === "reconciling") return "reconciling";
		return "ineligible";
	}
	return canBuy ? "eligible" : "owner_required";
}

/* ================================================================ channels */

/**
 * The launch channels in the order the RFC lists them (§5.3, canon "Initial
 * channels"); any other channel sorts after them by name. Order is by NAME
 * because the contract carries no rank, and these five are provisioned by a
 * reviewed registry change with exactly these names.
 */
export const COMMUNITY_INITIAL_CHANNELS = [
	"welcome-and-rules",
	"general",
	"help",
	"feedback",
	"show-and-tell",
] as const;

export const COMMUNITY_WELCOME_CHANNEL = "welcome-and-rules";
export const COMMUNITY_GENERAL_CHANNEL = "general";

function channelRank(name: string): number {
	const index = (COMMUNITY_INITIAL_CHANNELS as readonly string[]).indexOf(name);
	return index === -1 ? COMMUNITY_INITIAL_CHANNELS.length : index;
}

export function sortChannels(
	channels: readonly CommunityChannel[],
): CommunityChannel[] {
	return [...channels].sort(
		(a, b) =>
			channelRank(a.name) - channelRank(b.name) || a.name.localeCompare(b.name),
	);
}

/**
 * One rail section. `dms` and `requests` are seams for the DM and requests
 * lanes: this PR renders Requests as a placeholder entry only.
 */
export type CommunityRailSection = "channels" | "private" | "dms" | "requests";

/**
 * The rail's channel sections: joined public channels, then private rooms the
 * reader belongs to. Archived channels and channels the reader has not joined
 * stay in Browse, never in the rail. A channel whose `member` is absent (an
 * older hub) is treated as joined only when it is public, since a private room
 * is listed to members alone.
 */
export function railChannels(channels: readonly CommunityChannel[]): {
	channels: CommunityChannel[];
	private: CommunityChannel[];
} {
	const visible = sortChannels(channels).filter(
		(channel) => !channel.archived && channel.member !== false,
	);
	return {
		channels: visible.filter((channel) => channel.visibility === "public"),
		private: visible.filter((channel) => channel.visibility === "private"),
	};
}

/** The sum the switcher shows on the community row (its own unread count). */
export function communityUnreadTotal(
	channels: readonly CommunityChannel[] | undefined,
): number {
	return (channels ?? []).reduce(
		(total, channel) =>
			total + (channel.member === false ? 0 : (channel.unread ?? 0)),
		0,
	);
}

/** Where a fresh join lands: #welcome-and-rules, else the first rail channel. */
export function landingChannel(
	channels: readonly CommunityChannel[],
): CommunityChannel | null {
	const rail = railChannels(channels);
	return (
		rail.channels.find((c) => c.name === COMMUNITY_WELCOME_CHANNEL) ??
		rail.channels[0] ??
		rail.private[0] ??
		null
	);
}

/**
 * Whether the reader may post here, and if not, why (the composer's replacement
 * copy). `locked` is the contract's member-read-only flag: #welcome-and-rules
 * is locked for members and staff post there (D4). A `read_only` community
 * stops every member post.
 */
export type CommunityPostingState =
	| "open"
	| "locked"
	| "archived"
	| "community_read_only";

export function postingState(
	channel: Pick<CommunityChannel, "locked" | "archived"> | null,
	communityState: "active" | "read_only",
): CommunityPostingState {
	if (communityState === "read_only") return "community_read_only";
	if (channel?.archived) return "archived";
	if (channel?.locked) return "locked";
	return "open";
}

/** The audience label under the composer (RFC §5.3: always stated). */
export type CommunityAudience =
	| { kind: "all_members" }
	| { kind: "all_members_staff_post" }
	| { kind: "private_channel" };

export function composerAudience(
	channel: Pick<CommunityChannel, "visibility" | "locked"> | null,
): CommunityAudience {
	if (channel?.visibility === "private") return { kind: "private_channel" };
	if (channel?.locked) return { kind: "all_members_staff_post" };
	return { kind: "all_members" };
}

/* ================================================================= browse */

export type CommunityBrowseFilter = "all" | "joined" | "not_joined" | "private";

/**
 * Browse's client-side filter over the channel directory. The server search
 * (`q`) narrows the page first; this applies the D5 chips, which the contract's
 * `filter` does not all have (`not_joined` is the complement of `joined`).
 * Private channels the reader is not in are never listed (R3), so a private
 * row here is always a membership.
 */
export function browseChannels(
	channels: readonly CommunityChannel[],
	filter: CommunityBrowseFilter,
	query = "",
): CommunityChannel[] {
	const needle = query.trim().toLowerCase();
	return sortChannels(channels).filter((channel) => {
		if (channel.archived) return false;
		if (channel.visibility === "private" && channel.member === false)
			return false;
		if (filter === "joined" && channel.member === false) return false;
		if (filter === "not_joined" && channel.member !== false) return false;
		if (filter === "private" && channel.visibility !== "private") return false;
		if (!needle) return true;
		return (
			channel.name.toLowerCase().includes(needle) ||
			(channel.purpose ?? "").toLowerCase().includes(needle)
		);
	});
}

/* =============================================================== timeline */

/**
 * Merge newest-first history pages into one oldest-first list.
 *
 * Pages overlap when an event refetches the newest page under older ones, so a
 * message is keyed by id and the highest `revision` wins (an edit replaces its
 * row in place). Ordered by `seq`, the server's per-conversation sequence,
 * never by client clocks.
 */
export function mergeHistory(
	pages: readonly { items: readonly CommunityMessage[] }[],
): CommunityMessage[] {
	const byId = new Map<string, CommunityMessage>();
	for (const page of pages)
		for (const message of page.items) {
			const prior = byId.get(message.id);
			if (!prior || (message.revision ?? 0) >= (prior.revision ?? 0))
				byId.set(message.id, message);
		}
	return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Top-level rows: replies live in their thread, not the channel timeline. */
export function timelineMessages(
	messages: readonly CommunityMessage[],
): CommunityMessage[] {
	return messages.filter((message) => !message.thread_root_id);
}

/**
 * A thread's loaded replies, oldest first.
 *
 * The local door has no thread-history op yet (the hub's `threads/{root_id}`
 * route is not in the member allowlist), so a thread shows the replies the
 * channel's loaded pages carry; `reply_count` on the root says how many exist,
 * and the pane states when more are older than what is loaded.
 */
export function threadReplies(
	messages: readonly CommunityMessage[],
	rootId: string,
): CommunityMessage[] {
	return messages.filter((message) => message.thread_root_id === rootId);
}

/** The message's reactions after the reader toggles `emoji` (optimistic). */
export function toggleReaction(
	message: CommunityMessage,
	emoji: string,
): { reactions: NonNullable<CommunityMessage["reactions"]>; remove: boolean } {
	const reactions = [...(message.reactions ?? [])];
	const index = reactions.findIndex((r) => r.emoji === emoji);
	if (index === -1) {
		reactions.push({ emoji, count: 1, mine: true });
		return { reactions, remove: false };
	}
	const current = reactions[index];
	if (current.mine) {
		const count = current.count - 1;
		if (count <= 0) reactions.splice(index, 1);
		else reactions[index] = { ...current, count, mine: false };
		return { reactions, remove: true };
	}
	reactions[index] = { ...current, count: current.count + 1, mine: true };
	return { reactions, remove: false };
}

/** Whether the reader authored this message (edit and delete are theirs only). */
export function isOwnMessage(
	message: CommunityMessage,
	selfPublicId: string | null,
): boolean {
	return Boolean(
		selfPublicId &&
			message.author.kind === "human" &&
			message.author.public_id === selfPublicId,
	);
}

/* =============================================== D7: sender-only outcomes */

/**
 * The composer's phase. Every non-idle phase is SENDER-ONLY: it lives in the
 * composer, never as a timeline row, and nobody else sees it (D7).
 *
 * `keepDraft` is the rule the user feels most: the draft is cleared ONLY when
 * the post is published. A refusal, a limit, a moderation outage, a cancel or
 * a lost answer all leave the exact text in the box to edit or retry.
 */
export type ComposerPhase =
	| { kind: "idle" }
	/** Waiting for the verdict; `cancelling` once Cancel was pressed. */
	| { kind: "checking"; key: string; cancelling: boolean }
	| {
			kind: "refused";
			category: CommunityRefusalCategory;
			reference: string;
	  }
	/** `until` is an epoch-ms instant; the countdown is derived from it. */
	| { kind: "rate_limited"; until: number; scope: string | null }
	| { kind: "moderation_unavailable" }
	| { kind: "images_unavailable" }
	| { kind: "guidelines_changed"; version: string | null }
	| { kind: "too_large" }
	| { kind: "cancelled" }
	/** The verdict was not reached in time; nothing was posted. */
	| { kind: "expired" }
	| { kind: "offline" }
	| { kind: "error" };

export type ComposerResult = { phase: ComposerPhase; clearDraft: boolean };

const idle: ComposerPhase = { kind: "idle" };

/** The phase after the hub answered a submission (or its status read). */
export function phaseAfterSubmission(
	outcome: CommunitySubmission,
): ComposerResult {
	switch (outcome.state) {
		case "published":
			return { phase: idle, clearDraft: true };
		case "checking":
			return {
				phase: {
					kind: "checking",
					key: outcome.idempotency_key,
					cancelling: false,
				},
				clearDraft: false,
			};
		case "refused":
			return outcome.refusal
				? {
						phase: {
							kind: "refused",
							category: outcome.refusal.category,
							reference: outcome.refusal.reference,
						},
						clearDraft: false,
					}
				: { phase: { kind: "error" }, clearDraft: false };
		case "cancelled":
			return { phase: { kind: "cancelled" }, clearDraft: false };
		case "expired":
			return { phase: { kind: "expired" }, clearDraft: false };
	}
}

/** The phase after a submission call failed. The draft always survives. */
export function phaseAfterFailure(
	failure: CommunityFailure,
	now: number,
): ComposerPhase {
	switch (failure.kind) {
		case "refused":
			return {
				kind: "refused",
				category: failure.category,
				reference: failure.reference,
			};
		case "rate_limited":
			return {
				kind: "rate_limited",
				until: now + failure.retryAfterS * 1000,
				scope: failure.scope,
			};
		case "moderation_unavailable":
			return { kind: "moderation_unavailable" };
		case "images_unavailable":
			return { kind: "images_unavailable" };
		case "guidelines_changed":
			return { kind: "guidelines_changed", version: failure.guidelinesVersion };
		case "payload_too_large":
			return { kind: "too_large" };
		case "unreachable":
			return { kind: "offline" };
		default:
			return { kind: "error" };
	}
}

/** Whole seconds left on a posting limit, never negative. */
export function secondsLeft(phase: ComposerPhase, now: number): number {
	if (phase.kind !== "rate_limited") return 0;
	return Math.max(0, Math.ceil((phase.until - now) / 1000));
}

/**
 * Whether Send is allowed in this phase. Checking blocks a second send (one
 * attempt in flight per composer); a running limit blocks until it ends.
 */
export function canSend(
	phase: ComposerPhase,
	now: number,
	text: string,
): boolean {
	if (!text.trim()) return false;
	if (phase.kind === "checking") return false;
	if (phase.kind === "rate_limited" && secondsLeft(phase, now) > 0)
		return false;
	return true;
}

/** The user-facing label key for a refusal category (canon "Refusal categories"). */
export const REFUSAL_CATEGORY_KEY = {
	unsafe_or_illegal: "ui.community.outcome.category.unsafe_or_illegal",
	harassment_or_abuse: "ui.community.outcome.category.harassment_or_abuse",
	spam_or_promotion: "ui.community.outcome.category.spam_or_promotion",
	private_information: "ui.community.outcome.category.private_information",
} as const satisfies Record<CommunityRefusalCategory, string>;

/* ================================================================= events */

/** What one long-poll batch asks the surface to re-read. */
export type CommunityInvalidation = {
	/** The community list (switcher) and bootstrap (membership, state). */
	community: boolean;
	/** The channel directory (rail, unread counts, Browse). */
	channels: boolean;
	/** Conversations whose history must be re-read. */
	conversations: string[];
};

/**
 * Events are content-free invalidations (the contract: ids and kinds only); the
 * surface refetches through the authorized reads. `request_changed` and
 * `approval_changed` belong to the requests/approvals lanes and invalidate
 * nothing here yet.
 */
export function invalidationsFor(
	batch: Pick<CommunityEventBatch, "events">,
): CommunityInvalidation {
	const out: CommunityInvalidation = {
		community: false,
		channels: false,
		conversations: [],
	};
	const conversations = new Set<string>();
	for (const event of batch.events) {
		switch (event.type) {
			case "conversation_changed":
				if (event.conversation_id) conversations.add(event.conversation_id);
				else out.channels = true;
				break;
			case "unread_changed":
				out.channels = true;
				break;
			case "membership_changed":
				out.channels = true;
				out.community = true;
				break;
			case "community_changed":
				out.community = true;
				break;
			case "request_changed":
			case "approval_changed":
				break;
		}
	}
	out.conversations = [...conversations];
	return out;
}

/**
 * The wait before the next long poll after a failed one: 1 s doubling to 30 s.
 * A healthy poll re-arms at once (the hub holds it up to 25 s), so this only
 * paces a daemon or hub that is answering errors - it must never hammer it.
 */
export function eventsBackoffMs(failures: number): number {
	if (failures <= 0) return 0;
	return Math.min(30_000, 1000 * 2 ** (failures - 1));
}

/* ================================================================== images */

export const COMMUNITY_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;

/**
 * Why a picked file cannot be attached, before anything is read or sent
 * (canon: PNG/JPEG/WebP, <= 5 MiB, 4 per message). Pixel size (4096 px) is the
 * hub's check; it answers `payload_too_large` or a refusal for it.
 */
export function imageRejection(
	file: { type: string; size: number },
	alreadyAttached: number,
	limits: { maxBytes: number; maxImages: number },
): "type" | "size" | "count" | null {
	if (alreadyAttached >= limits.maxImages) return "count";
	if (!(COMMUNITY_IMAGE_TYPES as readonly string[]).includes(file.type))
		return "type";
	if (file.size > limits.maxBytes) return "size";
	return null;
}

/**
 * The name an attached image shows: server-generated style (`image-1.png`),
 * never the user's file name (RFC decision 7), so a local path or a name that
 * says more than the picture never reaches other members.
 */
export function attachmentName(index: number, contentType: string): string {
	const ext =
		contentType === "image/jpeg"
			? "jpg"
			: contentType === "image/webp"
				? "webp"
				: "png";
	return `image-${index + 1}.${ext}`; // i18n: ignore server-style file name (RFC decision 7), not prose
}

/* ================================================================ requests */

/**
 * The Requests entry's seam. DM requests, contact requests and agent approvals
 * arrive with their lanes; until then the rail shows the entry with no count
 * and the pane says what will appear there.
 */
export type CommunityRequestsSeam =
	| { available: false }
	| {
			available: true;
			count: number;
	  };
