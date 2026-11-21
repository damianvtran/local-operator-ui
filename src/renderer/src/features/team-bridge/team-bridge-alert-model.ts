/**
 * The ALERT CARD's read model (Team Integrations RFC §6.1, §10 item 4; design
 * D1/D2; copy finding C2 deferred from agent-server #463).
 *
 * WHY A PURE MODULE. The card is a projection of server-owned `alert_meta`
 * (`TeamBridgeAlertMeta`) whose every field is optional and open-vocabulary, so
 * the decisions - which severity, which status, what the claim strip says, which
 * links are safe to draw - are made here, where a node test can drive each arm
 * without a renderer. The component only paints what this returns.
 *
 * NOTHING HERE TRUSTS VENDOR TEXT WITH AUTHORITY (S-28, S-30, S-35). Labels and
 * link labels are written by whoever can influence a monitor, so they render as
 * plain text, and a link is drawn only when its URL is `https:` AND its parsed
 * hostname equals the host the hub verified - the visible host is the one the
 * click goes to.
 */

import type {
	TeamBridgeAlertMeta,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";

/** The hub's normalised vocabulary (agent-server `integrationhooks/normalize.go`). */
export const TEAM_BRIDGE_ALERT_SEVERITIES = [
	"sev1",
	"sev2",
	"sev3",
	"sev4",
] as const;
export type TeamBridgeAlertSeverity =
	| (typeof TEAM_BRIDGE_ALERT_SEVERITIES)[number]
	| "unknown";
export type TeamBridgeAlertStatus = "firing" | "mitigated" | "resolved";

/**
 * The 3px rail's ink (D2). Resolved overrides severity: a recovered sev1 must
 * stop reading as an emergency at a glance, while its SEV badge keeps the
 * history. Unknown severity is `inkDim`, never a guessed hue.
 */
export type TeamBridgeAlertTone =
	| "danger"
	| "warning"
	| "info"
	| "dim"
	| "success";

export type TeamBridgeAlertClaimView =
	/* No claim block on the wire (today's hub): say nothing about who has it. */
	| { kind: "unreported" }
	| { kind: "unclaimed" }
	| {
			kind: "claimed" | "waiting" | "escalated";
			holder: string | null;
			owner: string | null;
			tier: "T0-passive" | "T0" | "T1" | null;
			statusLine: string | null;
			updatedAt: string | null;
			/** The owner's pending ask, when the hub reports one (U1). */
			ask: { askId: string; sessionId: string } | null;
	  };

export type TeamBridgeAlertLink = {
	label: string | null;
	host: string;
	url: string;
};

export type TeamBridgeAlertCardView = {
	severity: TeamBridgeAlertSeverity;
	status: TeamBridgeAlertStatus | "unknown";
	tone: TeamBridgeAlertTone;
	fireCount: number;
	lastFiredAt: string | null;
	/**
	 * When the hub saw the recovery, for a resolved card only (design D1): on-call
	 * must tell a recovery from a minute ago from one this morning without opening
	 * the thread. Null on any other status, so a stale `resolved_at` left on a
	 * re-fired root can never claim a recovery the badge does not.
	 */
	resolvedAt: string | null;
	isTest: boolean;
	/**
	 * A group card: one claimable root for a burst (`storm`, PR 2d). Null for
	 * every non-storm root, whatever its `grouped_count` says (review R1).
	 */
	group: { total: number; resolved: number } | null;
	labels: { key: string; value: string }[];
	links: TeamBridgeAlertLink[];
	fingerprint: string | null;
	claim: TeamBridgeAlertClaimView;
};

const SEVERITY_SET = new Set<string>(TEAM_BRIDGE_ALERT_SEVERITIES);

export function alertSeverity(
	value: string | undefined,
): TeamBridgeAlertSeverity {
	const v = value?.trim().toLowerCase() ?? "";
	return SEVERITY_SET.has(v) ? (v as TeamBridgeAlertSeverity) : "unknown";
}

/*
 * `mitigated` is forward-compatibility only: the hub's vocabulary today is
 * `firing`/`resolved` (agent-server `integrationhooks/normalize.go`), so no
 * served payload reaches that arm yet (review R4).
 */
export function alertStatus(
	value: string | undefined,
): TeamBridgeAlertStatus | "unknown" {
	const v = value?.trim().toLowerCase();
	return v === "firing" || v === "mitigated" || v === "resolved"
		? v
		: "unknown";
}

export function alertTone(
	severity: TeamBridgeAlertSeverity,
	status: TeamBridgeAlertStatus | "unknown",
): TeamBridgeAlertTone {
	if (status === "resolved") return "success";
	switch (severity) {
		case "sev1":
			return "danger";
		case "sev2":
			return "warning";
		case "sev3":
			return "info";
		default:
			return "dim";
	}
}

/**
 * A link the card may draw, or null. `https:` only, credentials refused, and the
 * URL's own hostname must equal the hub-verified `host` (case-insensitive) - so
 * "Open on app.datadoghq.com" can never open somewhere else.
 */
export function safeAlertLink(link: {
	label?: string;
	host: string;
	url: string;
}): TeamBridgeAlertLink | null {
	let parsed: URL;
	try {
		parsed = new URL(link.url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	if (parsed.username || parsed.password) return null;
	const host = link.host.trim().toLowerCase();
	if (!host || parsed.hostname.toLowerCase() !== host) return null;
	const label = link.label?.trim();
	return { label: label ? label : null, host, url: parsed.toString() };
}

const TIERS = new Set(["T0-passive", "T0", "T1"]);

function claimView(meta: TeamBridgeAlertMeta): TeamBridgeAlertClaimView {
	const summary = meta.claim_summary;
	if (!summary) return { kind: "unreported" };
	const state = summary.state?.trim().toLowerCase();
	if (
		!state ||
		state === "unclaimed" ||
		state === "released" ||
		state === "expired"
	)
		return { kind: "unclaimed" };
	const ask = summary.waiting_approval_for
		? {
				askId: summary.waiting_approval_for.ask_id,
				sessionId: summary.waiting_approval_for.session_id,
			}
		: null;
	const kind = summary.escalated
		? "escalated"
		: ask || state === "waiting_approval"
			? "waiting"
			: "claimed";
	const text = (value: string | undefined) => {
		const v = value?.trim();
		return v ? v : null;
	};
	return {
		kind,
		holder: text(summary.holder_name),
		owner: text(summary.owner_name),
		tier:
			summary.autonomy_tier && TIERS.has(summary.autonomy_tier)
				? (summary.autonomy_tier as "T0-passive" | "T0" | "T1")
				: null,
		statusLine: text(summary.latest_status_line),
		updatedAt: text(summary.updated_at),
		ask,
	};
}

/**
 * The card for a message, or null when the row is not an alert card: only an
 * integration-origin ROOT carrying `alert_meta` is one. A thread reply, or an
 * app's `chat:write` post (no `alert_meta`, S2), stays an ordinary app message.
 */
export function teamBridgeAlertCard(
	message: Pick<TeamBridgeMessage, "origin" | "alert_meta" | "thread_root_id">,
): TeamBridgeAlertCardView | null {
	const meta = message.alert_meta;
	if (!meta || message.origin !== "integration" || message.thread_root_id)
		return null;
	const severity = alertSeverity(meta.severity);
	const status = alertStatus(meta.status);
	/*
	 * GROUP ONLY ON `storm === true` (review R1). The hub clamps `grouped_count`
	 * to >= 1 and writes it on EVERY root (agent-server `normalize.go`,
	 * `hookWriter.meta`, no omitempty), and only storm groups ever increment
	 * `group_resolved_count`. So `grouped_count: 1` is the ordinary single-alert
	 * shape; reading it as a group printed "1 alert, 0 resolved" and hid "Fired 4
	 * times" on every real card.
	 */
	const total = Math.max(meta.grouped_count ?? 0, 0);
	const group =
		meta.storm === true
			? {
					total,
					/* Clamped: a count above the total is a hub race, never "5 of 4". */
					resolved: Math.min(meta.group_resolved_count ?? 0, total),
				}
			: null;
	const key = meta.incident_key?.trim();
	return {
		severity,
		status,
		tone: alertTone(severity, status),
		fireCount: Math.max(meta.fire_count ?? 1, 1),
		lastFiredAt: meta.last_fired_at ?? meta.first_fired_at ?? null,
		resolvedAt: status === "resolved" ? (meta.resolved_at ?? null) : null,
		isTest: meta.is_test === true,
		group,
		labels: (meta.labels ?? [])
			.filter((row): row is { key: string; value: string } => row !== null)
			.map((row) => ({ key: row.key, value: row.value })),
		links: (meta.links ?? [])
			.map((row) => (row ? safeAlertLink(row) : null))
			.filter((row): row is TeamBridgeAlertLink => row !== null),
		fingerprint: key ? key : null,
		claim: claimView(meta),
	};
}

/** `7a3c9f…e1d2`: enough to match a vendor's id by eye, short enough for line D. */
export function shortFingerprint(value: string): string {
	return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * The CTA's guard (U1): the button renders only when the hub names an ask AND
 * that ask is pending in THIS machine's fleet index. That is what makes it the
 * owner's button - an ask lives on the device of the agent's owner, so every
 * other member's fleet index lacks it and draws nothing.
 *
 * THE SESSION COMES FROM THIS DEVICE, NOT THE HUB (review R3). The claim's
 * `session_id` is relayed from the holder's heartbeat, i.e. another endpoint's
 * word; only the `ask_id` is used to match. The session opened is the one this
 * machine's own fleet row records for that ask, so a stale or mismatched hub
 * value can never open the wrong local session. A fleet row with no session has
 * nowhere to go, so it draws no button.
 */
export function alertAskOnThisDevice(
	claim: TeamBridgeAlertClaimView,
	pendingAsks: ReadonlyMap<string, string>,
): { askId: string; sessionId: string } | null {
	if (claim.kind === "unreported" || claim.kind === "unclaimed") return null;
	if (!claim.ask) return null;
	const sessionId = pendingAsks.get(claim.ask.askId);
	return sessionId ? { askId: claim.ask.askId, sessionId } : null;
}

/** `ask_id -> session_id` for this device's OPEN fleet asks (R3's source). */
export function pendingFleetAskSessions(
	rows:
		| readonly {
				ask_id: string;
				session_id?: string | null;
				status: string;
		  }[]
		| null
		| undefined,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const row of rows ?? []) {
		if (row.status !== "open" || !row.ask_id || !row.session_id) continue;
		map.set(row.ask_id, row.session_id);
	}
	return map;
}
