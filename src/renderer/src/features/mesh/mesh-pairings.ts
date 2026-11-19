/**
 * Mesh pairing cards: two devices pairing from the Mesh approvals tray instead of
 * a terminal (`features.mesh_pairing`, core PR #4259, docs/DESKTOP_API.md "Mesh
 * pairing cards").
 *
 * WHY. The operator asked that pairing "does NOT require running terminal
 * commands, ideally it should be through the UI mesh approvals". Before this, the
 * only place either person could see or answer the six-digit ceremony was a
 * terminal (`lop network confirm`, `lop network join --confirm`), and a daemon
 * inviter showed nothing at all until the joiner had typed - so nobody saw it.
 *
 * THE CEREMONY, as the cards draw it. Both devices derive the SAME six digits.
 * Each card shows ITS OWN code under "Show this code on <peer>" and, when it is
 * this device's turn, an EMPTY input under "Type the code shown on <peer>":
 *
 *   inviter `awaiting_joiner`        shows its code; nothing to answer (no controls:
 *                                    core refuses either decision here)
 *   joiner  `awaiting_confirmation`  shows its code + input (types the inviter's)
 *   joiner  `waiting_for_other_device` after a local match: waits for the inviter
 *   inviter `awaiting_confirmation`  shows its code + input + reduce-only shares
 *
 * THE INPUT IS NEVER PRE-FILLED. On an honest run the digits typed equal the
 * card's own code - the code is not a secret (core design F4) and typing it is a
 * reflex guard, not the boundary. The boundary is the app attestation main makes
 * before it forwards an answer (`src/main/mesh-pairing-attest.ts`); this module
 * never sees a socket and cannot attest.
 *
 * WHAT A CARD CANNOT LEARN FROM THE READ. A ceremony's card disappears from
 * `GET /v1/desktop/mesh/pairings` when it ends - admitted, declined, expired or
 * abandoned alike. So the terminal states (joined, declined, expired) are this
 * module's own bookkeeping: the hook remembers the last row it saw and what the
 * person answered, and `pairingOutcome` names what the disappearance most likely
 * meant. Those are stated as what the app OBSERVED ("this device answered and
 * the card closed"), never as a relay verdict it did not read.
 *
 * Offers render from the structured `offers.state/items`, never from core's
 * English sentence, so every state is keyed copy in every locale.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DesktopFeedFrame } from "../../../../shared/desktop-session-contract";
import { meshApprovalKeys } from "./mesh-approvals";
import { meshKeys } from "./mesh-store";

/* ---------------------------------------------------------------- types */

export type MeshPairingSide = "inviter" | "joiner";
export type MeshPairingStage =
	| "awaiting_joiner"
	| "awaiting_confirmation"
	| "waiting_for_other_device";

export type MeshPairingOffer = {
	key: string;
	label: string;
	kind: string;
	/** Whether the offer starts selected (core's `share`). */
	share: boolean;
};

export type MeshPairingRow = {
	/** `<side>:<invite_id>`: the card's identity across reads. */
	id: string;
	side: MeshPairingSide;
	stage: MeshPairingStage;
	inviteId: string;
	networkId: string;
	networkName: string;
	peerDeviceId: string;
	peerName: string;
	/** The invite's role (inviter only; "" on the joiner). */
	role: string;
	/** THIS device's own derivation, shown for the other device's person to type. */
	code: string;
	fingerprint: string;
	offers: { state: string; items: MeshPairingOffer[] };
	expiresAt: number;
	attemptsLeft: number;
	/** Per-ceremony, per-stage tag the attestation binds; echoed on the answer. */
	nonce: string;
	canAnswerHere: boolean;
	/** `""` | `unsupported_host` | `no_app_attestation` (or a newer core's word). */
	answerUnavailable: string;
};

export const meshPairingKeys = {
	pairings: ["desktop", "mesh", "pairings"] as const,
	eligibility: ["desktop", "mesh", "pairings", "eligibility"] as const,
};

/**
 * Re-read cadence while at least one card is open, in ms.
 *
 * The feed names only the OLDEST open card (`approvals.pairing_id`), so a stage
 * flip (inviter `awaiting_joiner` → `awaiting_confirmation` once the joiner typed)
 * on a card that is already open publishes no frame. Two seconds is the phone
 * pairing card's own in-flight cadence (`use-phone-pairing.ts`,
 * `DECISION_IN_FLIGHT_REFRESH_MS`) for the same reason; the read is device-local
 * (relay control socket + small files) and dials no peer. With no card open the
 * read does not poll at all: the feed frame is what opens one.
 */
export const MESH_PAIRING_OPEN_REFRESH_MS = 2_000;

/** How long a terminal outcome stays on the tray after its card closed, in ms. */
export const MESH_PAIRING_OUTCOME_MS = 60_000;

/* ---------------------------------------------------------------- parsing */

const SIDES = new Set<MeshPairingSide>(["inviter", "joiner"]);
const STAGES = new Set<MeshPairingStage>([
	"awaiting_joiner",
	"awaiting_confirmation",
	"waiting_for_other_device",
]);
const PAIRING_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CODE = /^[0-9]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function offer(value: unknown): MeshPairingOffer | null {
	if (!isRecord(value)) return null;
	const key = text(value.key);
	if (!key) return null;
	return {
		key,
		label: text(value.label) || key,
		kind: text(value.kind),
		share: value.share !== false,
	};
}

/**
 * One wire row → a card, or null for any row this build cannot answer safely.
 * Strict where the answer echoes a value back (ids, nonce, code); tolerant of
 * display fields a newer core may add or leave blank.
 */
export function parsePairingRow(value: unknown): MeshPairingRow | null {
	if (!isRecord(value)) return null;
	const side = value.side as MeshPairingSide;
	const stage = value.stage as MeshPairingStage;
	const inviteId = text(value.invite_id);
	const code = text(value.code);
	if (!SIDES.has(side) || !STAGES.has(stage)) return null;
	if (!PAIRING_ID.test(inviteId) || !CODE.test(code)) return null;
	const nonce = text(value.nonce);
	if (nonce && !PAIRING_ID.test(nonce)) return null;
	const expiresAt = Number(value.expires_at);
	if (!Number.isFinite(expiresAt)) return null;
	const offers = isRecord(value.offers) ? value.offers : {};
	const items = Array.isArray(offers.items) ? offers.items : [];
	const attempts = Number(value.attempts_left);
	return {
		id: text(value.id) || `${side}:${inviteId}`,
		side,
		stage,
		inviteId,
		networkId: text(value.network_id),
		networkName: text(value.network_name) || text(value.network_id),
		peerDeviceId: text(value.peer_device_id),
		peerName: text(value.peer_name) || text(value.peer_device_id),
		role: text(value.role),
		code,
		fingerprint: text(value.fingerprint),
		offers: {
			state: text(offers.state),
			items: items
				.map(offer)
				.filter((item): item is MeshPairingOffer => item !== null),
		},
		expiresAt,
		attemptsLeft: Number.isFinite(attempts) ? Math.max(0, attempts) : 0,
		nonce,
		// No nonce = a pre-schema-3 record: nothing an attestation could bind.
		canAnswerHere: value.can_answer_here === true && nonce !== "",
		answerUnavailable: text(value.answer_unavailable),
	};
}

/** `{pairings: [...]}` → the cards, oldest first as core served them. */
export function pairingRows(value: unknown): MeshPairingRow[] {
	const list = isRecord(value) ? value.pairings : null;
	if (!Array.isArray(list)) return [];
	return list
		.map(parsePairingRow)
		.filter((row): row is MeshPairingRow => row !== null);
}

/* ---------------------------------------------------------------- the card's view */

/** What the card asks of the person, derived from side + stage + host. */
export type PairingCardMode =
	/** Inviter stage 1: show the code; the joiner types it there. Decline only. */
	| "show_code"
	/** This device's turn: show the code AND take the other device's. */
	| "type_code"
	/** The joiner matched; the inviter's person still has to type. */
	| "waiting_other";

export function pairingCardMode(row: MeshPairingRow): PairingCardMode {
	if (row.side === "inviter" && row.stage === "awaiting_joiner")
		return "show_code";
	if (row.stage === "waiting_for_other_device") return "waiting_other";
	return "type_code";
}

/**
 * Whether this host can answer at all. `can_answer_here` is false both for a
 * host that cannot attest (`answer_unavailable` set) and for a stage that takes
 * no answer; only the first is "use the terminal".
 */
export function pairingNeedsTerminal(row: MeshPairingRow): boolean {
	return row.answerUnavailable !== "";
}

/** The card's title. */
export function pairingTitle(row: MeshPairingRow): string {
	return row.side === "inviter"
		? t("ui.mesh.pairing.title.inviter", {
				peer: row.peerName,
				network: row.networkName,
			})
		: t("ui.mesh.pairing.title.joiner", {
				peer: row.peerName,
				network: row.networkName,
			});
}

/** Seconds left on the card's own clock (core's `expires_at`, wall clock). */
export function pairingSecondsLeft(
	row: MeshPairingRow,
	nowSeconds: number,
): number {
	return Math.max(0, Math.floor(row.expiresAt - nowSeconds));
}

/** "4 min left" / "45 s left", ICU-plural keyed. */
export function pairingTimeLeft(seconds: number): string {
	return seconds >= 120
		? t("ui.mesh.pairing.time_left_minutes", {
				count: Math.floor(seconds / 60),
			})
		: t("ui.mesh.pairing.time_left_seconds", { count: seconds });
}

/**
 * The offers line(s), from the structured state - never core's sentence.
 *
 * ONE vocabulary on both sides since core #4259's remediation (QA Q2 there):
 * `listed` (items to show), `empty` (nothing offered), `absent` /
 * `skipped_peer_unsupported` (one build cannot carry a list). An inviter row from
 * a core before that remediation says `sent` for both of the first two, so it is
 * read as `listed`/`empty` by its items (code review F1).
 *
 * THE INVITER'S VIEW IS ALSO ITS SHARE LIST: `pairingShares` admits with exactly
 * the items drawn here, so a state this build does not know draws "nothing will
 * be shared" and shares nothing - never an invisible list.
 */
export type PairingOffersView =
	| { kind: "list"; items: MeshPairingOffer[]; editable: boolean }
	| { kind: "sentence"; sentence: string }
	| { kind: "none" };

export function pairingOffersView(row: MeshPairingRow): PairingOffersView {
	const { state, items } = row.offers;
	if (row.side === "inviter") {
		// Keyed on the STATE, as core asks: `empty` draws "nothing" even if a row
		// carried items; only `listed` (or a legacy `sent`) with items draws a list.
		if ((state === "listed" || state === "sent") && items.length > 0)
			return {
				kind: "list",
				items,
				// Reduce-only toggles exist only on the turn that answers.
				editable: pairingCardMode(row) === "type_code",
			};
		if (state === "skipped_peer_unsupported")
			return {
				kind: "sentence",
				sentence: t("ui.mesh.pairing.offers.owner_peer_older"),
			};
		return {
			kind: "sentence",
			sentence: t("ui.mesh.pairing.offers.owner_none"),
		};
	}
	if (state === "listed" && items.length > 0)
		return { kind: "list", items, editable: false };
	if (state === "empty" || (state === "listed" && items.length === 0))
		return { kind: "sentence", sentence: t("ui.mesh.pairing.offers.none") };
	if (state === "absent")
		return { kind: "sentence", sentence: t("ui.mesh.pairing.offers.absent") };
	return { kind: "none" };
}

/**
 * The share keys an inviter admits with: the items the card DRAWS, minus what
 * the person removed (code review F1). Nothing drawn, nothing shared - core
 * requires the list on an inviter admit and `[]` serves none.
 */
export function pairingShares(
	row: MeshPairingRow,
	removed: ReadonlySet<string>,
): string[] | undefined {
	if (row.side !== "inviter") return undefined;
	const view = pairingOffersView(row);
	if (view.kind !== "list") return [];
	return view.items
		.filter((item) => item.share && !removed.has(item.key))
		.map((item) => item.key)
		.sort();
}

/* ---------------------------------------------------------------- refusals */

/** A failed answer, as the card renders it. */
export type PairingRefusal =
	| { kind: "mismatch"; attemptsLeft: number }
	| { kind: "needs_app" }
	/** Bring the window forward and press the button again; `action` names it. */
	| { kind: "foreground"; action?: PairingAction }
	| { kind: "build" }
	| { kind: "expired" }
	| { kind: "not_ready" }
	/** Nothing answered on this device's side; trying again is safe. */
	| { kind: "relay"; action?: PairingAction }
	/**
	 * The card is no longer open: core's 409 `pairing_answered` (answered from the
	 * other device, a terminal or a second click), or main's read no longer has
	 * it. A neutral close, never an error to retry - nothing was recorded.
	 */
	| { kind: "closed" }
	/** The card moved on while the person answered (new stage, new words): look again. */
	| { kind: "changed"; action?: PairingAction }
	/**
	 * The person cancelled main's native confirmation sheet. Not an error: no
	 * sentence, nothing sent; focus returns to the button (UX review U7).
	 */
	| { kind: "cancelled"; action?: PairingAction }
	| { kind: "other"; sentence: string };

/** The button a refusal asks the person to press again. */
export type PairingAction = "admit" | "confirm" | "decline";

/** The provenance refusals a person can fix by bringing the window forward and clicking. */
const FOREGROUND_REASONS = new Set([
	"window_not_visible",
	"window_not_focused",
	"no_window",
	"no_user_action",
	// The one-shot confirmation was missing, stale or for another card: a fresh
	// press mints a new one (security review round 1, US-R1-1).
	"no_confirmation",
	"confirmation_mismatch",
	// The window's DevTools or a debugger session is open NOW. Not a build
	// property: closing it and pressing again works, so this is never the
	// permanent "this build cannot" dead end (code review round 2, M2).
	"devtools_open",
	"debugger_attached",
	// Another pairing's native sheet is open; this press raised none.
	"sheet_open",
]);

/**
 * Main reached the listener stage and it did not answer in time or closed on the
 * frame: the app may well be able to attest, so this is "try again", never "this
 * build cannot" (UX review U1: a signed Mac with a slow listener was told it was
 * a development build).
 */
const RETRYABLE_ATTEST_REASONS = new Set([
	"listener_unavailable",
	"frame_refused",
	"timeout",
	// Main's own read of the cards failed before it could show the sheet.
	"pairing_read_failed",
]);

export function pairingRefusal(error: unknown): PairingRefusal {
	const control = error instanceof DesktopControlError ? error : null;
	const code =
		control?.code ??
		(isRecord(error) && typeof error.code === "string" ? error.code : "");
	const body = control?.detail as Record<string, unknown> | undefined;
	switch (code) {
		case "sas_mismatch": {
			const left = Number(body?.attempts_left);
			return {
				kind: "mismatch",
				attemptsLeft: Number.isFinite(left) ? Math.max(0, left) : 0,
			};
		}
		case "pairing_needs_app":
			return { kind: "needs_app" };
		case "pairing_attest_refused": {
			const reason = typeof body?.reason === "string" ? body.reason : "";
			if (FOREGROUND_REASONS.has(reason)) return { kind: "foreground" };
			if (reason === "expired") return { kind: "expired" };
			if (RETRYABLE_ATTEST_REASONS.has(reason)) return { kind: "relay" };
			if (reason === "pairing_closed") return { kind: "closed" };
			if (reason === "pairing_changed") return { kind: "changed" };
			// Not macOS, not packaged, a driver/debug launch, DevTools, or a listener
			// that refused THIS process: this build cannot attest, full stop.
			return { kind: "build" };
		}
		case "pairing_expired":
		case "no_pending_pairing":
			return { kind: "expired" };
		case "pairing_not_ready":
			return { kind: "not_ready" };
		// Core #4259: a duplicate answer on a card that already closed (409).
		case "pairing_answered":
			return { kind: "closed" };
		case "relay_unavailable":
			return { kind: "relay" };
		default: {
			const sentence =
				error instanceof Error && error.message.trim()
					? error.message.trim()
					: t("ui.mesh.pairing.error.unknown");
			return { kind: "other", sentence };
		}
	}
}

export function pairingRefusalSentence(
	refusal: PairingRefusal,
	row: Pick<MeshPairingRow, "peerName">,
): string {
	switch (refusal.kind) {
		case "mismatch":
			return refusal.attemptsLeft > 0
				? t("ui.mesh.pairing.error.mismatch", {
						count: refusal.attemptsLeft,
					})
				: t("ui.mesh.pairing.error.mismatch_spent");
		case "needs_app":
			return t("ui.mesh.pairing.error.needs_app");
		case "foreground":
			return t("ui.mesh.pairing.error.foreground", {
				action: refusal.action ?? "other",
			});
		case "build":
			return t("ui.mesh.pairing.error.build");
		case "expired":
			return t("ui.mesh.pairing.error.expired");
		case "not_ready":
			return t("ui.mesh.pairing.waiting.inviter", { peer: row.peerName });
		case "relay":
			return t("ui.mesh.pairing.error.relay");
		case "closed":
			return t("ui.mesh.pairing.error.closed");
		case "changed":
			return t("ui.mesh.pairing.error.changed", {
				action: refusal.action ?? "other",
			});
		case "cancelled":
			return "";
		case "other":
			return refusal.sentence;
	}
}

/* ---------------------------------------------------------------- outcomes */

/** What the person last did on a card, so its disappearance can be named. */
export type PairingAnswerRecord = {
	decision: "admit" | "decline";
	/** Core's 200 `status`, or `sas_mismatch` with no attempts left. */
	status: "sent" | "waiting_for_other_device" | "refused" | "spent";
};

/** A card that closed, as the tray keeps showing it for a moment. */
export type PairingOutcome = {
	id: string;
	row: MeshPairingRow;
	kind:
		| "joined"
		| "admitted"
		| "declined"
		| "spent"
		| "expired"
		| "finished"
		| "ended";
	at: number;
};

/**
 * Why a card the read stopped serving most likely closed.
 *
 * Stated as what THIS device observed: an inviter that admitted with a matching
 * code ("admitted"), a joiner whose waiting card closed after its own match
 * ("joined" once the mesh read shows the network, "finished" until then - the
 * inviter admitted, declined or let the window close), a decline, three
 * wrong codes, the clock running out, or a close with no answer from here.
 */
export function pairingOutcome(
	row: MeshPairingRow,
	answer: PairingAnswerRecord | undefined,
	nowSeconds: number,
	joinedNetwork: boolean,
): PairingOutcome["kind"] {
	if (answer?.decision === "decline" || answer?.status === "refused")
		return "declined";
	if (answer?.status === "spent") return "spent";
	if (row.side === "inviter" && answer?.status === "sent") return "admitted";
	if (row.side === "joiner" && row.stage === "waiting_for_other_device")
		// This device matched; the inviter answered or the window closed. Which one
		// is the mesh read's to say (the network appears), so until then: finished.
		return joinedNetwork ? "joined" : "finished";
	if (row.expiresAt <= nowSeconds + 1) return "expired";
	return "ended";
}

export function pairingOutcomeSentence(outcome: PairingOutcome): string {
	const values = {
		peer: outcome.row.peerName,
		network: outcome.row.networkName,
	};
	switch (outcome.kind) {
		case "joined":
			return t("ui.mesh.pairing.result.joined", values);
		case "admitted":
			return t("ui.mesh.pairing.result.admitted", values);
		case "declined":
			return t("ui.mesh.pairing.result.declined", values);
		case "spent":
			return t("ui.mesh.pairing.result.spent", values);
		case "expired":
			// A joiner cannot start an invite; it asks the inviter for one (UX U5).
			return outcome.row.side === "inviter"
				? t("ui.mesh.pairing.result.expired", values)
				: t("ui.mesh.pairing.result.expired_joiner", values);
		case "finished":
			return t("ui.mesh.pairing.result.finished", values);
		case "ended":
			return t("ui.mesh.pairing.result.ended", values);
	}
}

/* ---------------------------------------------------------------- hooks */

/**
 * The open card id the feed last named: `undefined` until a frame says anything
 * (an older core never does), `null` for "none open". Every naming frame also
 * re-reads the cards, so a new ceremony draws at feed latency.
 */
export function useFeedMeshPairing(
	enabled: boolean,
): string | null | undefined {
	const client = useQueryClient();
	const [named, setNamed] = useState<string | null | undefined>(undefined);
	useEffect(() => {
		const feed = globalThis.window?.api?.desktop?.feed;
		if (!enabled || !feed) return;
		return feed.subscribe((frame: DesktopFeedFrame) => {
			let id: string | null | undefined;
			if (frame.type === "open") id = frame.payload.approvals_pairing_id;
			else if (frame.type === "approvals") id = frame.payload.pairing_id;
			if (id === undefined) return;
			setNamed(id);
			void client.invalidateQueries({ queryKey: meshPairingKeys.pairings });
		});
	}, [enabled, client]);
	return named;
}

/**
 * Whether the badge/tab should read the cards now, from the feed's word.
 *
 * `null` ("none open") is the only answer that skips the read. `undefined` - the
 * feed has not spoken since this renderer subscribed, which is EVERY launch and
 * reload with a pairing already open (QA round 1, Q1: the badge stayed dark) -
 * reads the list once, and keeps the cards' cadence only if it found any; phone
 * pairing makes the same move (`pairing-model.ts` `livePairingCard`).
 */
export function pairingReadWanted(feedId: string | null | undefined): boolean {
	return feedId !== null;
}

/** Cards still inside their window: the only ones that count as waiting (design D4). */
export function livePairingRows(
	rows: readonly MeshPairingRow[],
	nowSeconds: number,
): MeshPairingRow[] {
	return rows.filter((row) => pairingSecondsLeft(row, nowSeconds) > 0);
}

/**
 * The badge's pairing count: live cards in the read, and at least one while the
 * feed names a card the read has not caught up with (a fresh ceremony lights the
 * badge at feed latency, never at read latency).
 */
export function pairingBadgeCount(
	rows: readonly MeshPairingRow[] | undefined,
	feedId: string | null | undefined,
	nowSeconds: number,
): number {
	// The feed said "none open": the read is switched off, so whatever it cached
	// is the past and counts for nothing (code review round 2, M1).
	if (feedId === null) return 0;
	const live = livePairingRows(rows ?? [], nowSeconds).length;
	if (
		typeof feedId === "string" &&
		!(rows ?? []).some((row) => row.id === feedId)
	)
		return Math.max(1, live);
	return live;
}

/**
 * The rail badge's pairing count (`sidebar-navigation.tsx`), as one hook so the
 * badge's whole rule - read while the feed has not said "none", count live cards,
 * never wait on the read for a card the feed named - is tested as the sidebar
 * runs it (QA round 1, Q1). The read shares the tab's query key and cadence.
 */
export function useMeshPairingBadgeCount(enabled: boolean): number {
	const feedId = useFeedMeshPairing(enabled);
	const read = useMeshPairings(enabled && pairingReadWanted(feedId));
	if (!enabled) return 0;
	return pairingBadgeCount(read.data, feedId, Math.floor(Date.now() / 1000));
}

/** What main says about THIS launch's ability to attest (`pairings.eligibility`). */
export type PairingEligibility = {
	eligible: boolean;
	/** Main's static refusal (`not_macos`, `not_packaged`, ...), or "" when eligible. */
	reason: string;
};

/**
 * Main's STATIC attest eligibility, read once per session (design D1 / UX U1).
 *
 * A launch that can never attest - not macOS, an unpackaged/dev build, a debug or
 * driver switch, a headless/inactive window - is known before anyone types, so
 * the card disables its input and buttons and names the terminal fallback up
 * front. `staleTime: Infinity` because nothing it reads changes while the process
 * lives. A failed read is `null` ("unknown"): the card stays answerable and main
 * still refuses at the click, so an unknown never hides a working path.
 */
export function useMeshPairingEligibility(enabled: boolean) {
	return useQuery({
		queryKey: meshPairingKeys.eligibility,
		enabled,
		queryFn: async (): Promise<PairingEligibility> => {
			const result = await desktopResult<{
				eligible?: unknown;
				reason?: unknown;
			}>({ op: "pairings.eligibility" });
			return {
				eligible: result?.eligible === true,
				reason: typeof result?.reason === "string" ? result.reason : "",
			};
		},
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
}

/** `GET /v1/desktop/mesh/pairings`; polls only while a card is open. */
export function useMeshPairings(enabled: boolean) {
	return useQuery({
		queryKey: meshPairingKeys.pairings,
		enabled,
		queryFn: async () =>
			pairingRows(await desktopResult<unknown>({ op: "pairings.list" })),
		retry: false,
		staleTime: 1_000,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			enabled && (query.state.data?.length ?? 0) > 0
				? MESH_PAIRING_OPEN_REFRESH_MS
				: false,
	});
}

export type PairingAnswerAsk = {
	row: MeshPairingRow;
	decision: "admit" | "decline";
	/** Six typed digits to admit; ignored for a decline. */
	code: string;
	shares?: string[];
};

/**
 * One answer. NEVER RETRIED: a replayed admit with a wrong code is a second
 * strike on a 3-attempt budget shared with the wire.
 *
 * TWO HOPS, both answered by main (`desktop-ipc.ts`): `pairings.confirm` sends
 * the EXACT answer; main shows it on a native sheet worded from its own read of
 * the card and mints a one-shot token only when the person presses the sheet's
 * action button (security review round 2, US-R2-1). `pairings.answer` then
 * sends the IDENTICAL answer with the token - main consumes it, re-checks the
 * card, sender document and focus, attests and only then forwards. A refused or
 * cancelled confirm sends no answer; a cancel resolves `{status: "cancelled"}`.
 * `deadline` here is the card's expiry as an UPPER BOUND - main picks the real one.
 */
export function useMeshPairingAnswer() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async (ask: PairingAnswerAsk) => {
			const admit = ask.decision === "admit";
			// The EXACT answer, sent twice: main freezes it for its native sheet and
			// refuses an answer that differs from it (security review round 2).
			const exact = {
				side: ask.row.side,
				inviteId: ask.row.inviteId,
				nonce: ask.row.nonce,
				decision: ask.decision,
				code: admit ? ask.code : "",
				...(ask.row.side === "inviter" && ask.shares !== undefined
					? { shares: ask.shares }
					: {}),
			};
			const confirmed = await desktopResult<{
				confirmation?: unknown;
				cancelled?: unknown;
			}>({ op: "pairings.confirm", ...exact });
			// The person cancelled the sheet: nothing was minted and nothing is sent.
			if (confirmed?.cancelled === true)
				return { status: "cancelled" } as const;
			const confirmation = confirmed?.confirmation;
			// Main answers 200 only with a token; anything else is not an answer.
			if (typeof confirmation !== "string" || confirmation === "")
				throw new Error(t("ui.mesh.pairing.error.unknown"));
			const result = await desktopResult<{
				status?: unknown;
				attempts_left?: unknown;
			}>({
				op: "pairings.answer",
				...exact,
				deadline: Math.floor(ask.row.expiresAt),
				confirmation,
			});
			const status = result?.status;
			return {
				status:
					status === "waiting_for_other_device" || status === "refused"
						? status
						: "sent",
			} as const;
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: meshPairingKeys.pairings });
			void client.invalidateQueries({ queryKey: meshApprovalKeys.approvals });
			void client.invalidateQueries({ queryKey: meshKeys.networks });
		},
	});
}

/**
 * Keep the cards the read stopped serving as short-lived outcomes.
 *
 * Pure bookkeeping over successive reads: `previous` is the last list, `rows` the
 * new one; a card in `previous` and not in `rows` becomes an outcome. A card id
 * that reappears (a retried invite) drops its outcome.
 */
export function foldPairingOutcomes(input: {
	previous: readonly MeshPairingRow[];
	rows: readonly MeshPairingRow[];
	outcomes: readonly PairingOutcome[];
	answers: ReadonlyMap<string, PairingAnswerRecord>;
	nowMs: number;
	joinedNetworks: ReadonlySet<string>;
}): PairingOutcome[] {
	const live = new Set(input.rows.map((row) => row.id));
	const kept = input.outcomes.filter(
		(outcome) =>
			!live.has(outcome.id) &&
			input.nowMs - outcome.at < MESH_PAIRING_OUTCOME_MS,
	);
	const known = new Set(kept.map((outcome) => outcome.id));
	for (const row of input.previous) {
		if (live.has(row.id) || known.has(row.id)) continue;
		kept.push({
			id: row.id,
			row,
			kind: pairingOutcome(
				row,
				input.answers.get(row.id),
				Math.floor(input.nowMs / 1000),
				input.joinedNetworks.has(row.networkId),
			),
			at: input.nowMs,
		});
	}
	return kept;
}

/** A once-a-second wall clock while `active`, for the time-left lines. */
export function useSecondClock(active: boolean): number {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);
	useEffect(() => {
		if (!active) return;
		setNow(Math.floor(Date.now() / 1000));
		timer.current = setInterval(
			() => setNow(Math.floor(Date.now() / 1000)),
			1_000,
		);
		return () => {
			if (timer.current) clearInterval(timer.current);
			timer.current = null;
		};
	}, [active]);
	return now;
}
