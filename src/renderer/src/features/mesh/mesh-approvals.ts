/**
 * The Mesh tab's approval surface: the device-local onboarding records, read
 * and answered.
 *
 * WHAT THIS IS (remote-onboarding design §2, as shipped in `local_operator/network/approvals.py`):
 * one durable, signed record per onboarding request — `device_onboard` carries a
 * `device` block (host, user, transport, host-key fingerprint), `local_authority`
 * carries a `machine` block — kept on THIS machine under
 * `<config>/network/approvals/`. The desktop plane serves three routes for it
 * (`GET /v1/desktop/approvals` and the two decision posts) and
 * `features.approvals` is what says a backend has them; this module is the
 * renderer half: the row normaliser, the state vocabulary and the two writes.
 *
 * WHY THE RAIL MAY POLL THIS READ, when the mesh store's own header forbids the
 * rail an interval for `networks.list` (review round 2, R2-1: that read dials
 * every peer). THIS ONE DIALS NOTHING. `approval_rows` is a cold scan of the
 * device-local directory — the store's own words: "the badge must answer on a
 * machine whose relay is down, which is exactly why the store lives in a flat
 * directory rather than behind the running relay" — so an always-mounted
 * interval costs one local scan per tick and no socket at all. It is also the
 * ONE read whose fact is "a human is waiting": the browser sidebar's badge is
 * push-live for the same reason, and a badge that only moved when the tab was
 * open would not be a notification. `MESH_APPROVAL_POLL_MS` is
 * `CAPABILITY_RENEGOTIATE_MS`'s number (the cadence of the app's faster watch)
 * and half the catalogue watch, because the read is local and the wait is a
 * person's.
 *
 * THE PAGE RIDES THE RAIL'S OBSERVER (the inverse of the networks split, for the
 * same reason: one poll, one entry). The rail polls; the tray on `/mesh` reads
 * the same cache entry with `poll: false` and is refetched by the decisions'
 * own invalidation. On a device in no network the rail has no row and so asks
 * for nothing — the page still makes ONE read on mount, which is what lets a
 * `local_authority` record (a local bootstrap, not a mesh fact) be answered
 * there, and the read is `is_dir`-safe so it creates nothing.
 *
 * WHY EVERYTHING IS NORMALISED HERE, not cast: the same boundary rule
 * `mesh-types.ts` states at length — `desktopResult` casts its envelope, so a
 * sparse row becomes a typed object with a missing field and the first reader
 * to touch it throws, which above `/mesh` means the app root's error boundary
 * replaces the whole window. A row that cannot be keyed or described (no id, no
 * state) is DROPPED; every other field degrades to the empty answer for its
 * type.
 *
 * WHY THE DECISIONS DO NOT PARSE THEIR ANSWER: the decision's `state` is the
 * record's new state, but the row that matters on screen is the LIST's — so the
 * settle invalidates the read and the list stays the ONE authority for what
 * state the record is in. A second copy kept beside it is how "approved" on a
 * button and "denied" in the store come to be visible at once.
 */

import {
	type DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "../../../../i18n/messages";
import {
	CREDENTIAL_APPROVAL_DIGEST,
	CREDENTIAL_APPROVAL_OPERATIONS,
	type DesktopRequest,
} from "../../../../shared/desktop-contract";
import { meshKeys } from "./mesh-store";
import { deviceLabel, flag, strings, text, time } from "./mesh-types";

/** The approvals read's own cache entry. One key, one read, two observers. */
export const meshApprovalKeys = {
	approvals: ["desktop", "mesh", "approvals"] as const,
};

/**
 * The rail's cadence. See this file's header for why an interval is right here
 * where the catalogue's is not — the read dials no peer, and the fact is a
 * person waiting on the other end.
 */
export const MESH_APPROVAL_POLL_MS = 15_000;

/**
 * The decisions a card can send: the store's two (`approve`, `deny`), plus
 * `apply` - the retry of a typed credential card that was SIGNED but whose apply
 * did not finish (`apply-credential`). `apply` never signs anything.
 */
export type ApprovalDecision = "approve" | "deny" | "apply";

export type CredentialApprovalOperation =
	(typeof CREDENTIAL_APPROVAL_OPERATIONS)[number];

/**
 * The structured facts a typed credential card discloses BEFORE it is signed
 * (`finite_share.disclosure` / `inheritance.disclosure` on the backend - the same
 * dict the CLI renders), normalised to what this surface words. Only facts the
 * card states are kept; the backend's digest covers the whole dict, so nothing
 * here is re-serialised or sent back.
 */
export type MeshCredentialDisclosure = {
	operation: CredentialApprovalOperation;
	/** Finite share: the credential key (`github`). Inheritance: "". */
	credentialKey: string;
	/** Inheritance: provider / account / org (`""` org = any org). */
	provider: string;
	account: string;
	org: string;
	/** Finite share: `device` or `session`. */
	scope: string;
	recipient: { deviceId: string; name: string; keyFingerprint: string };
	withdrawalCount: number;
	untilRevoked: boolean;
	futureLogins: boolean;
	installsOrJoins: boolean;
	/** Inheritance only; `null` when the disclosure does not say. */
	copiesCredential: boolean | null;
	/** Inheritance only: the capability the recipient still needs and this does not grant. */
	requiresCapability: string;
};

/** An apply phase's outcome, as the backend's `approval_copy.outcome` words it. */
export type MeshApplyOutcome = {
	code: string;
	/** The ONLY signal that may offer "Try again" (backend UX U2). */
	retryable: boolean;
	reason: string;
	remedy: string;
};

/**
 * The row's `typed_approval` block (`desktop_approval.row_fields`), present only on
 * a credential row from a backend with `features.credential_approvals`.
 */
export type MeshTypedApproval = {
	action: string;
	operation: CredentialApprovalOperation | null;
	/** VERBATIM from the wire - never trimmed, never recomputed (see `typedApproval`). */
	requestDigest: string;
	disclosureDigest: string;
	disclosure: MeshCredentialDisclosure | null;
	assurance: string;
	unprovenHuman: boolean;
	signableHere: boolean;
	refusal: string;
	refusalMessage: string;
	applyOutcome: MeshApplyOutcome | null;
};

/** The where-block, under whichever key the row's kind spells it. */
export type MeshApprovalWhere = {
	deviceId: string;
	name: string;
	host: string;
	user: string;
	transport: string;
	hostKeyFp: string;
};

/**
 * The scope block (`what`), structured rather than pre-worded: the copy lives in
 * the surfaces, and a new scope the wire grows is a change HERE, in one place,
 * rather than in a string some composer wrote.
 */
export type MeshApprovalScopes = {
	connect: boolean;
	install: boolean;
	anchor: boolean;
	networkId: string;
	role: string;
	unattended: boolean;
	grants: string[];
};

export type MeshApprovalRow = {
	approvalId: string;
	/** Verbatim from the store: `requested`/`approved`/`connecting`/`connected`/`denied`/`expired`/`failed`. */
	state: string;
	/** Which where-block this row carries — the record's own kind is the difference. */
	kind: "device" | "machine" | "credential" | "unknown";
	/** Authored by the backend from the signed request, never reconstructed here. */
	summary?: string;
	details?: string[];
	/** A restriction only: true is NOT authority to sign a new request kind. */
	canApproveHere?: boolean;
	approveRemedy?: string;
	where: MeshApprovalWhere;
	what: MeshApprovalScopes;
	requestedBy: { surface: string; sessionId: string; deviceId: string };
	/** Epoch seconds, or `null`; `<= 0` reads as "no window" in the labels. */
	expiresAt: number | null;
	/** The typed credential approval block, when the backend served one. */
	typed?: MeshTypedApproval;
};

/* ------------------------------------------------------------ the states */

/**
 * The NON-TERMINAL states: an onboarding that is waiting, approved, running or
 * stopped-but-retryable. `connected`/`denied`/`expired` are terminal
 * (`network/approvals.py::TERMINAL_STATES`), so this is the set a record can
 * still move out of — the store's own line between a live record and history.
 */
const OPEN_STATES: ReadonlySet<string> = new Set([
	"requested",
	"approved",
	"connecting",
	"failed",
]);

export function isOpenApproval(state: string): boolean {
	return OPEN_STATES.has(state);
}

/**
 * THE WAITING SET: `requested` is the ONE state that asks the OPERATOR for
 * something.
 *
 * WHY THIS SPLIT EXISTS (operator round, 2026-10-03). The badge and the tray
 * heading used to count the whole non-terminal flight, so a record the operator
 * had already approved still sat under "1 waiting" beside an `Approved` chip
 * with `Deny` still offered — a screenshot the operator read as one
 * contradictory state. "A spent approval is a record, not a prompt": every
 * other state is a fact the surface reports, only `requested` is a decision it
 * waits on. So the count says waiting, the live panel draws waiting, and the
 * settled states are records (`mesh-approvals-tray.tsx` renders that split).
 */
export function isWaitingApproval(state: string): boolean {
	return state === "requested";
}

/**
 * The number the rail badge and the tray heading count: records WAITING ON THE
 * OPERATOR, and nothing else — one number with one meaning on both surfaces,
 * because a badge that counted more would disagree with the panel it opens.
 *
 * (It counted the whole flight before the 2026-10-03 split; the store's own
 * "failed is the state a person should not miss" concern now rides the tray's
 * settled-approvals section, which states it with a quiet dot in the closed
 * summary rather than by opening itself — operator ask, 2026-10-13.)
 */
export function waitingApprovalCount(rows: readonly MeshApprovalRow[]): number {
	return rows.filter((row) => isWaitingApproval(row.state)).length;
}

/**
 * What the surface knows about the backend that decides which credential writes
 * exist: `features.credential_approvals >= 1`. Passed in rather than read here so
 * the gate stays a pure function of the row and the negotiated feature.
 */
export type ApprovalCapabilities = { credentialApprovals?: boolean };

function wellFormedDigests(typed: MeshTypedApproval): boolean {
	return (
		CREDENTIAL_APPROVAL_DIGEST.test(typed.requestDigest) &&
		CREDENTIAL_APPROVAL_DIGEST.test(typed.disclosureDigest)
	);
}

/**
 * The typed block is one this build can ECHO: a credential operation the route's
 * body model accepts, and two digests in its exact pattern. A block that fails
 * this cannot produce a valid request, so no control that would send one is drawn.
 */
function echoable(
	row: MeshApprovalRow,
): row is MeshApprovalRow & { typed: MeshTypedApproval } {
	return (
		row.kind === "credential" &&
		row.typed !== undefined &&
		row.typed.action === "approve-credential" &&
		row.typed.operation !== null &&
		wellFormedDigests(row.typed)
	);
}

/** `approve` is offered on `requested` alone: every other open state is past the decision. */
export function canApproveApproval(
	row: MeshApprovalRow,
	{ credentialApprovals = false }: ApprovalCapabilities = {},
): boolean {
	if (row.state !== "requested") return false;
	/*
	 * A CREDENTIAL CARD IS APPROVED ONLY THROUGH ITS TYPED ROUTE, and only when
	 * every one of these holds:
	 *  - the backend advertises `credential_approvals` (without it there is no
	 *    route that accepts the body, and the bodiless `/approve` is refused for
	 *    these records by design);
	 *  - the server says THIS host may sign it (`signable_here`: the assurance
	 *    policy, the state and a describable record, decided server-side);
	 *  - the block is echoable, and its disclosure parsed for the same operation,
	 *    so the card can state what the signature binds before offering it.
	 * `can_approve_here` is deliberately NOT read for these rows: the backend keeps
	 * it `false` so an older renderer never offers a bodiless Approve, and that
	 * stays true however new this renderer is.
	 */
	if (row.kind === "credential")
		return (
			credentialApprovals &&
			echoable(row) &&
			row.typed.signableHere &&
			row.typed.disclosure?.operation === row.typed.operation
		);
	// Legacy device/machine cards retain their existing signing route. Neither
	// an optimistic optional field nor an unknown/new intent enables that route.
	return (
		row.canApproveHere !== false &&
		(row.kind === "device" || row.kind === "machine")
	);
}

/**
 * Whether a SIGNED credential card's apply may be sent again (`apply-credential`).
 *
 * Only after the decision (`approved`, or `failed` once a run stopped), and only
 * when an outcome said the SAME card can still succeed: the row's persisted
 * `apply_outcome.retryable`, or the last decision's own outcome (`retryable`
 * here) - the backend's rule that `retryable` is the only signal for "Try again",
 * because a permanent refusal retried is a loop a person cannot get out of.
 */
export function canRetryCredentialApply(
	row: MeshApprovalRow,
	{ credentialApprovals = false }: ApprovalCapabilities = {},
	retryable = false,
): boolean {
	return (
		credentialApprovals &&
		echoable(row) &&
		(row.state === "approved" || row.state === "failed") &&
		(retryable || row.typed.applyOutcome?.retryable === true)
	);
}

/**
 * The request one decision sends, or `null` when this row cannot send it.
 *
 * THE ONE PLACE A DECISION BECOMES A WIRE REQUEST, so the rule "a credential row
 * never reaches the bodiless `/approve`" is enforced where the request is built,
 * not only where the button is drawn. The typed body is the row's own operation
 * and digests, copied unchanged: the server recomputes both from the record on
 * disk and refuses a mismatch before it signs, so an echo of what was SHOWN is
 * the whole point - a digest computed here would bind nothing the server served.
 */
export function approvalDecisionRequest(
	row: MeshApprovalRow,
	decision: ApprovalDecision,
	capabilities: ApprovalCapabilities = {},
	retryable = false,
): DesktopRequest | null {
	const approvalId = row.approvalId;
	if (decision === "deny") return { op: "approvals.deny", approvalId };
	if (row.kind === "device" || row.kind === "machine")
		return decision === "approve" && canApproveApproval(row, capabilities)
			? { op: "approvals.approve", approvalId }
			: null;
	const allowed =
		decision === "approve"
			? canApproveApproval(row, capabilities)
			: canRetryCredentialApply(row, capabilities, retryable);
	if (!allowed || !echoable(row) || row.typed.operation === null) return null;
	return {
		op:
			decision === "approve"
				? "approvals.approveCredential"
				: "approvals.applyCredential",
		approvalId,
		operation: row.typed.operation,
		requestDigest: row.typed.requestDigest,
		disclosureDigest: row.typed.disclosureDigest,
	};
}

/**
 * `deny` is offered on every open state, and the store's matrix is why it is not
 * narrower: a deny is allowed while no receipt exists (nothing ran), MID-RUN
 * (the write lands and the runner stops at its next step check), and on a
 * `failed` record the operator no longer wants (abandoned, write-once).
 */
export function canDenyApproval(state: string): boolean {
	return isOpenApproval(state);
}

/** The chip's word for a state. Unknown states render verbatim rather than blank. */
export function approvalStateLabel(state: string): string {
	switch (state) {
		case "requested":
			return t("ui.mesh.mesh_approvals.waiting_for_you");
		case "approved":
			return t("ui.mesh.mesh_approvals.approved");
		case "connecting":
			return t("ui.mesh.mesh_approvals.connecting");
		case "connected":
			return t("ui.mesh.mesh_approvals.connected");
		case "denied":
			return t("ui.mesh.mesh_approvals.denied");
		case "expired":
			return t("ui.mesh.mesh_approvals.expired");
		case "failed":
			return t("ui.mesh.mesh_approvals.failed");
		default:
			return state;
	}
}

/* ------------------------------------------------------------ the rows */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function where(value: unknown): MeshApprovalWhere {
	const block = isRecord(value) ? value : {};
	return {
		deviceId: text(block.device_id),
		name: text(block.name),
		host: text(block.host),
		user: text(block.user),
		transport: text(block.transport),
		hostKeyFp: text(block.host_key_fp),
	};
}

/** A wire string kept EXACTLY as sent (no trim): for values that are echoed back. */
function verbatim(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function credentialOperation(
	value: unknown,
): CredentialApprovalOperation | null {
	return (CREDENTIAL_APPROVAL_OPERATIONS as readonly unknown[]).includes(value)
		? (value as CredentialApprovalOperation)
		: null;
}

function disclosure(value: unknown): MeshCredentialDisclosure | null {
	if (!isRecord(value)) return null;
	const operation = credentialOperation(value.operation);
	if (operation === null) return null;
	const recipient = isRecord(value.recipient) ? value.recipient : {};
	const lifetime = isRecord(value.grant_lifetime) ? value.grant_lifetime : {};
	const requires = isRecord(value.requires_capability)
		? value.requires_capability
		: {};
	return {
		operation,
		credentialKey: text(value.credential_key),
		provider: text(value.provider),
		account: text(value.account),
		org: text(value.org),
		scope: text(value.scope),
		recipient: {
			deviceId: text(recipient.device_id),
			name: text(recipient.name),
			keyFingerprint: text(recipient.key_fingerprint),
		},
		withdrawalCount: Array.isArray(value.withdrawals)
			? value.withdrawals.length
			: 0,
		untilRevoked: lifetime.kind === "until_revoked",
		// Each of these is a consequence the card states, so an absent or malformed
		// value reads as the answer that claims the MOST: never a narrower grant
		// than the backend may have meant.
		futureLogins: value.future_logins !== false,
		installsOrJoins: value.installs_or_joins !== false,
		copiesCredential:
			typeof value.copies_credential === "boolean"
				? value.copies_credential
				: null,
		requiresCapability: text(requires.name),
	};
}

function applyOutcome(value: unknown): MeshApplyOutcome | null {
	if (!isRecord(value)) return null;
	return {
		code: text(value.code),
		retryable: value.retryable === true,
		reason: text(value.reason),
		remedy: text(value.remedy),
	};
}

/**
 * `typed_approval`, normalised; `undefined` when the row carries none.
 *
 * THE DIGESTS ARE KEPT VERBATIM - not trimmed, not lower-cased, not rebuilt. They
 * are echoed to the server, which compares them byte for byte with what it
 * recomputes from the record; a "cleaned" digest is a different digest, and one
 * that only matched after cleaning would mean the row and the server disagreed.
 * A malformed one is kept as-is too, so the gate (`canApproveApproval`) refuses
 * it by its pattern rather than this parser quietly repairing it.
 */
function typedApproval(value: unknown): MeshTypedApproval | undefined {
	if (!isRecord(value)) return undefined;
	return {
		action: text(value.action),
		operation: credentialOperation(value.operation),
		requestDigest: verbatim(value.request_digest),
		disclosureDigest: verbatim(value.disclosure_digest),
		disclosure: disclosure(value.disclosure),
		assurance: text(value.assurance),
		// Fail toward the disclosure: only an explicit `false` hides it.
		unprovenHuman: value.unproven_human !== false,
		signableHere: value.signable_here === true,
		refusal: text(value.refusal),
		refusalMessage: text(value.refusal_message),
		applyOutcome: applyOutcome(value.apply_outcome),
	};
}

function scopes(value: unknown): MeshApprovalScopes {
	const what = isRecord(value) ? value : {};
	return {
		connect: flag(what.connect, false),
		install: flag(what.install, false),
		anchor: isRecord(what.anchor),
		networkId: text(what.network_id),
		role: text(what.role),
		unattended: flag(what.unattended, false),
		grants: strings(what.grant),
	};
}

/**
 * `GET /v1/desktop/approvals`, normalised — store order (oldest first) kept.
 *
 * THE ORDER IS THE STORE'S and is not re-sorted: the oldest record is the first
 * one to expire, and a surface that re-sorted would disagree with the CLI's own
 * listing about which request comes first.
 */
export function approvalRows(value: unknown): MeshApprovalRow[] {
	const source = Array.isArray(value)
		? value
		: ((value as { approvals?: unknown } | null)?.approvals ?? []);
	if (!Array.isArray(source)) return [];
	const rows: MeshApprovalRow[] = [];
	for (const raw of source) {
		if (!isRecord(raw)) continue;
		const approvalId = text(raw.approval_id);
		const state = text(raw.state);
		// No identity, no row; no state, no row either — every reader of the
		// state makes a claim with it, and the chip has nothing honest to say.
		if (!approvalId || !state) continue;
		/*
		 * WHICH BLOCK IS PRESENT DECIDES THE KIND, which is the store's own rule
		 * (`badge_row`: "the kind is the difference a reader keys on, rather than
		 * a renamed key hiding which machine the block is about"). A row with
		 * neither reads as `device` — the kind v1 mints — and renders its empty
		 * where-fields as nothing rather than inventing one.
		 */
		// #2435 is a signed intent INSIDE device_onboard, not a new where-block.
		// Presence is enough to close the generic signing path even if the intent
		// is malformed; only the backend can interpret and disclose signed scope.
		// A finite share (`credential_finite_share`) is the same class of signed
		// intent inside `device_onboard`: classifying it `device` headed it
		// "Onboard <device>" and offered the generic signing route. Either key, or
		// a typed block naming the credential action, makes it a credential row.
		const typed = typedApproval(raw.typed_approval);
		const credential =
			(isRecord(raw.what) &&
				(Object.prototype.hasOwnProperty.call(
					raw.what,
					"credential_inheritance",
				) ||
					Object.prototype.hasOwnProperty.call(
						raw.what,
						"credential_finite_share",
					))) ||
			typed?.action === "approve-credential";
		const explicitKind = Object.prototype.hasOwnProperty.call(raw, "kind")
			? text(raw.kind)
			: undefined;
		const kind: MeshApprovalRow["kind"] =
			credential || explicitKind === "credential_inheritance"
				? "credential"
				: explicitKind !== undefined &&
						!["device_onboard", "local_authority"].includes(explicitKind)
					? "unknown"
					: !isRecord(raw.device) && isRecord(raw.machine)
						? "machine"
						: "device";
		const requestedBy = isRecord(raw.requested_by) ? raw.requested_by : {};
		rows.push({
			approvalId,
			state,
			kind,
			summary: text(raw.summary) || undefined,
			// Do not silently omit a malformed line from a security disclosure and
			// make the remaining text look complete. React renders plain strings.
			details:
				Array.isArray(raw.details) &&
				raw.details.every((line) => typeof line === "string")
					? raw.details.slice()
					: undefined,
			canApproveHere: Object.prototype.hasOwnProperty.call(
				raw,
				"can_approve_here",
			)
				? raw.can_approve_here === true
				: undefined,
			approveRemedy: text(raw.approve_remedy) || undefined,
			where: where(kind === "machine" ? raw.machine : raw.device),
			what: scopes(raw.what),
			requestedBy: {
				surface: text(requestedBy.surface),
				sessionId: text(requestedBy.session_id),
				deviceId: text(requestedBy.device_id),
			},
			expiresAt: time(raw.expires_at),
			...(typed && kind === "credential" ? { typed } : {}),
		});
	}
	return rows;
}

/* --------------------------------------------------------------- labels */

/**
 * What the row is about, for the summary sentence and the record rows: the
 * device for a `device_onboard` (name, else its id's tail — `deviceLabel`'s one
 * rule), "this machine" for a `local_authority` bootstrap, which is about the
 * reader's own machine by definition.
 */
export function approvalSubject(row: MeshApprovalRow): string {
	if (row.kind === "machine") return t("ui.mesh.mesh_approvals.this_machine");
	return deviceLabel({ device_id: row.where.deviceId, name: row.where.name });
}

/**
 * The summary sentence: what this record is actually asking, in one line of
 * plain language, BEFORE any detail (operator round, 2026-10-03 — the
 * complaint, verbatim: "six capability chips + three definition lines must be
 * assembled by the reader").
 *
 * WHY IT IS THE CARD'S ONLY ALWAYS-VISIBLE COPY, AND WHY IT IS COMPLETE. The
 * old card led with a title, a where line, a chip per scope and up to three
 * definition rows, and the reader had to assemble the ask from all of it. This
 * sentence is built from the record's own scopes in the CLI's order, so it
 * states what the decision covers — trust-bearing scopes included, which the
 * chips used to leave to a legend — while the precise per-scope consequences
 * stay one disclosure away (`approvalScopeEntries`).
 *
 * The join clause names the network the page already shows when it has it (the
 * same `networkNames` fallback `approvalScopeEntries` uses, UX round 1 U1).
 *
 * IT IS ONE SENTENCE, NOT ALWAYS ONE RENDERED LINE (design round 1, D6): at
 * the app's own width the longest shape — a device onboarding carrying every
 * clause — wraps to a second line, which is the sentence's own length and not
 * a layout defect; the narrow pass photographs the same wrap at 1024x768. It
 * leads the WAITING card; a record row leads with `approvalHead` alone, because
 * a spent record is not asking anything any more (UX round 1, U2).
 */
export function approvalSummary(
	row: MeshApprovalRow,
	networkNames?: ReadonlyMap<string, string>,
): string {
	if (
		row.kind === "credential" ||
		row.kind === "unknown" ||
		row.canApproveHere === false
	) {
		// A typed disclosure states the ask in this app's own words; the backend's
		// `summary` is the CLI-shaped sentence kept for renderers that predate it.
		const typedHead = credentialHead(row);
		if (typedHead) return typedHead;
		if (row.summary) return row.summary;
		if (row.kind === "credential" || row.kind === "unknown")
			return approvalHead(row);
	}
	const head = approvalHead(row);
	const clauses = approvalScopeEntries(row, networkNames).map(
		(entry) => entry.clause,
	);
	if (!clauses.length)
		return t("ui.mesh.mesh_approvals.approval_title", { head });
	return t("ui.mesh.mesh_approvals.approval_title_with_clauses", {
		head,
		clauses: joinClauses(clauses),
	});
}

/**
 * The ask's own title — "Onboard studio-mini" / "Set up operator authority on
 * this machine" — which is both the summary sentence's head and the line a
 * RECORD row leads with (UX round 1, U2). A spent record answers "what was this
 * about" in one look; the six-clause decision-time sentence is not repeated per
 * row, because the decision is already made and the archive is a list, not a
 * stack of asks (the reader who wants the scope-by-scope detail has the
 * Details disclosure on every row).
 */
export function approvalHead(row: MeshApprovalRow): string {
	if (row.kind === "credential")
		return (
			credentialHead(row) ||
			row.summary ||
			t("ui.mesh.approval.credential_title")
		);
	if (row.kind === "unknown")
		return row.summary || t("ui.mesh.approval.unknown_title");
	if (row.canApproveHere === false && row.summary) return row.summary;
	return row.kind === "machine"
		? t("ui.mesh.mesh_approvals.set_up_operator_authority_on_this_machine")
		: t("ui.mesh.mesh_approvals.onboard_subject", {
				subject: approvalSubject(row),
			});
}

/**
 * Brand spellings for the credential keys a finite share names. The key is a
 * store identifier (`github`), and the ask reads better with the product's own
 * name; an unlisted key is shown as it is rather than guessed at. Proper nouns,
 * not copy, so they do not go through the catalogue.
 */
const CREDENTIAL_BRANDS: Readonly<Record<string, string>> = {
	github: "GitHub",
	gitlab: "GitLab",
};

function credentialName(key: string): string {
	return CREDENTIAL_BRANDS[key.toLowerCase()] ?? key;
}

/** The device a typed credential card names: its name, else its id's tail. */
export function credentialRecipientLabel(row: MeshApprovalRow): string {
	const recipient = row.typed?.disclosure?.recipient;
	return deviceLabel({
		device_id: recipient?.deviceId ?? "",
		name: recipient?.name ?? "",
	});
}

/**
 * The typed card's one-line ask ("Share your GitHub login with studio-mini"),
 * from the structured disclosure the signature binds; `null` without one, so
 * the callers fall back to the backend's summary exactly as before.
 */
function credentialHead(row: MeshApprovalRow): string | null {
	const facts = row.kind === "credential" ? row.typed?.disclosure : null;
	if (!facts) return null;
	const device = credentialRecipientLabel(row);
	if (facts.operation === "credential_finite_share")
		return t("ui.mesh.approval.head_finite_share", {
			credential: credentialName(facts.credentialKey),
			device,
		});
	return t("ui.mesh.approval.head_inheritance", {
		provider: credentialName(facts.provider),
		account: facts.account,
		device,
	});
}

/**
 * What approving a typed credential card does, one consequence per line, for the
 * Details disclosure. Built from the SAME facts the CLI renders
 * (`finite_share.details` / `inheritance.details`), in its order: who may use it,
 * for how long, what it does not do, what it undoes. Empty without a disclosure.
 */
export function credentialConsequences(row: MeshApprovalRow): string[] {
	const facts = row.kind === "credential" ? row.typed?.disclosure : null;
	if (!facts) return [];
	const device = credentialRecipientLabel(row);
	const lines: string[] = [];
	if (facts.operation === "credential_finite_share") {
		lines.push(
			facts.scope === "session"
				? t("ui.mesh.approval.scope_session", { device })
				: t("ui.mesh.approval.scope_device", { device }),
		);
	} else {
		lines.push(
			facts.org
				? t("ui.mesh.approval.org_limited", { org: facts.org })
				: t("ui.mesh.approval.org_any"),
		);
		if (facts.copiesCredential === false)
			lines.push(t("ui.mesh.approval.not_copied", { device }));
	}
	if (facts.untilRevoked) lines.push(t("ui.mesh.approval.until_revoked"));
	lines.push(
		facts.futureLogins
			? t("ui.mesh.approval.future_logins_covered")
			: t("ui.mesh.approval.future_logins_not_shared"),
	);
	lines.push(
		facts.installsOrJoins
			? t("ui.mesh.approval.installs_something")
			: t("ui.mesh.approval.installs_nothing"),
	);
	if (facts.requiresCapability === "broker_credential")
		lines.push(t("ui.mesh.approval.needs_broker", { device }));
	if (facts.withdrawalCount > 0)
		lines.push(
			t("ui.mesh.approval.undoes_withdrawals", {
				count: facts.withdrawalCount,
				device,
			}),
		);
	return lines;
}

/**
 * The clauses joined the way a sentence lists them: commas within the list, a
 * semicolon before the last — "a, b; c". One clause renders bare; the head's
 * colon already introduced the list.
 *
 * WHY A SEMICOLON AND NOT `and` (design round 1, D6): the last two onboarding
 * clauses are "run sessions there without an approval prompt" and "answer
 * approval prompts there", and an `and` between them parses first as *without*
 * both things — a garden path on the one sentence that carries the ask. The
 * semicolon splits the tail so no clause's verb can be read as shared with its
 * neighbour, whatever clauses a later scope table puts last.
 */
function joinClauses(clauses: readonly string[]): string {
	if (clauses.length === 1) return clauses[0];
	return t("ui.mesh.mesh_approvals.join_clauses", {
		clauses: clauses.slice(0, -1).join(", "),
		last: clauses[clauses.length - 1],
	});
}

/**
 * The where line, in the CLI's own order and spelling ("what / where / who" is
 * the card's order in `network/cli.py::_approval_lines`): `user@host via
 * transport (name)`. Absent parts are omitted, and a block that names nothing
 * returns `null` so the surface hides the line rather than drawing "via ".
 */
export function approvalWhereLabel(row: MeshApprovalRow): string | null {
	if (row.kind === "credential" || row.kind === "unknown") return null;
	const { user, host, transport, name } = row.where;
	const parts = [
		host ? (user ? `${user}@${host}` : host) : "",
		transport ? t("ui.mesh.mesh_approvals.via_transport", { transport }) : "",
		// The CLI's own `(name)` clause, minus the case where the name IS the host: two
		// identical words read as a stutter, not as information.
		name && name !== host ? `(${name})` : "",
	].filter(Boolean);
	return parts.length ? parts.join(" ") : null;
}

/** The host-key fingerprint, when the record carries one — its own line, monospace. */
export function approvalHostKeyLabel(row: MeshApprovalRow): string | null {
	if (row.kind === "credential" || row.kind === "unknown") return null;
	return row.where.hostKeyFp || null;
}

/**
 * The who line: the SURFACE that filed the request (`cli`, `desktop`, …) and the
 * session that asked, when the record names one. The id is shown by its tail,
 * the app's own rule for a session a user has not named.
 */
export function approvalRequesterLabel(row: MeshApprovalRow): string | null {
	const { surface, sessionId } = row.requestedBy;
	const parts = [
		surface || "",
		sessionId
			? t("ui.mesh.mesh_approvals.session_suffix", {
					suffix: sessionId.slice(-6),
				})
			: "",
	].filter(Boolean);
	return parts.length
		? t("ui.mesh.mesh_approvals.asked_by", { requester: parts.join(" · ") })
		: null;
}

/**
 * The record's scopes, each with the three strings a surface needs: the CLI's
 * label (`term`), the short clause `approvalSummary` joins into its sentence
 * (`clause`), and the full consequence the details disclosure shows
 * (`consequence`).
 *
 * ONE LIST, THREE READERS, ONE ORDER — the CLI's own (`connect` / `install` /
 * `install operator anchor` / `join … as …` / `trust unattended sessions` /
 * `grant …`, `network/cli.py::_approval_lines`), so the summary, the details
 * and the CLI's listing cannot disagree about what a record carries.
 *
 * WHY CONSEQUENCES AND NOT CHIPS (operator round, 2026-10-03): "the capability
 * list reads as a list of consequences, not a wall of chips". `connect` and
 * `install` are ordinary words, but they are still consequences of approving,
 * so they get sentences of their own beside the scopes that always had glosses
 * (anchor / unattended / grants — U2's frozen wording, reused verbatim, so
 * seven review rounds of direction fixes are not re-litigated here).
 */
export type MeshApprovalScopeEntry = {
	/** The CLI's own label for the scope. */
	term: string;
	/** The short clause `approvalSummary` joins into its sentence. */
	clause: string;
	/** The full consequence sentence for the details disclosure. */
	consequence: string;
};

export function approvalScopeEntries(
	row: MeshApprovalRow,
	networkNames?: ReadonlyMap<string, string>,
): MeshApprovalScopeEntry[] {
	// The inheritance anchor identifies the signer, not an onboarding grant.
	// Never reinterpret opaque signed intent as generic install/anchor scopes.
	if (row.kind === "credential" || row.kind === "unknown") return [];
	const { connect, install, anchor, networkId, role, unattended, grants } =
		row.what;
	const entries: MeshApprovalScopeEntry[] = [];
	if (connect)
		entries.push({
			term: "connect",
			clause: row.where.transport
				? t("ui.mesh.mesh_approvals.connect_over", {
						transport: row.where.transport,
					})
				: t("ui.mesh.mesh_approvals.connect_to_it"),
			consequence: row.where.transport
				? t("ui.mesh.mesh_approvals.may_connect_over", {
						transport: row.where.transport,
					})
				: t("ui.mesh.mesh_approvals.this_machine_may_connect_to_it"),
		});
	if (install)
		entries.push({
			term: "install",
			clause:
				row.kind === "machine"
					? t("ui.mesh.mesh_approvals.install_local_operator")
					: t("ui.mesh.mesh_approvals.install_local_operator_there"),
			consequence:
				row.kind === "machine"
					? t(
							"ui.mesh.mesh_approvals.local_operator_is_installed_on_this_machine",
						)
					: t("ui.mesh.mesh_approvals.local_operator_is_installed_on_it"),
		});
	if (anchor)
		entries.push({
			term: t("ui.mesh.mesh_approvals.install_operator_anchor"),
			/*
			 * THE DIRECTION MATTERS, AND THIS SAID IT BACKWARDS ONCE (agent review round 4,
			 * R4-1). A remote anchor is PUBLIC data — the core's own copy for a verify-only
			 * host is "an anchor is installed … but the private half is not on this host,
			 * so nothing can be SIGNED there" (`network/readiness.py`). The node VERIFIES;
			 * it never signs. A gloss saying the remote is "trusted to sign as you" states
			 * the inverse of the authority at the exact moment the reader consents to it.
			 */
			clause: t(
				"ui.mesh.mesh_approvals.check_approvals_signed_on_your_machines",
			),
			consequence: t(
				"ui.mesh.mesh_approvals.that_device_can_check_approvals_signed_on",
			),
		});
	if (networkId) {
		/*
		 * THE NETWORK'S NAME WHEN THE PAGE HAS IT, its id only as the fallback
		 * (UX round 1, U1). The chip used to say `join net_9f8e7d6c5b4a as drive`
		 * while the canvas in the same frame labelled that network `damian-mesh`,
		 * so one screen carried two names for one object and the chip that asks
		 * for consent used the opaque one - "which network am I joining?" was
		 * unanswerable at the decision point. The id is still the honest fallback:
		 * the approvals read and the mesh read are independent queries, so a tray
		 * that painted before the canvas has nothing else to name it with, and an
		 * id is better than a blank.
		 */
		const named = networkNames?.get(networkId);
		const label = t("ui.mesh.mesh_approvals.join_network", {
			network: named || networkId,
			role: role || "?",
		});
		entries.push({
			term: label,
			clause: label,
			consequence: t("ui.mesh.mesh_approvals.joins_network", {
				network: named || networkId,
				role: role || "?",
			}),
		});
	}
	if (unattended)
		entries.push({
			term: t("ui.mesh.mesh_approvals.trust_unattended_sessions"),
			/*
			 * THE CONSEQUENCE AND THE RIGHT PARTY (UX round 2, U8; agent review round 4,
			 * R4-2). `onboard.py::step_grants` is explicit - "what the node lets THIS
			 * device do ... both the `approve` scope and the `unattended` scope are
			 * grants the NODE holds about the operator's device id" - and
			 * `CAPABILITY_WORDS["unattended"]` reads "start sessions here without
			 * approval prompts". The prompt that stops being asked is the node's own.
			 */
			clause: t(
				"ui.mesh.mesh_approvals.run_sessions_there_without_an_approval_prompt",
			),
			consequence: t(
				"ui.mesh.mesh_approvals.sessions_you_start_on_that_device_run",
			),
		});
	/* The clause and the consequence must name the capability the same way as
		   the term, or one card states one capability under two names (R5-1's
		   `grant unattended`). */
	for (const grant of distinctGrants(grants, unattended)) {
		const phrase = grantPhrases()[grant];
		entries.push({
			term:
				phrase?.term ?? t("ui.mesh.mesh_approvals.grant_capability", { grant }),
			clause:
				grantClauses()[grant] ??
				t("ui.mesh.mesh_approvals.use_capability", { grant }),
			/* The capability is held by YOUR device, about the node (R4-2). */
			consequence:
				phrase?.gloss ??
				t("ui.mesh.mesh_approvals.may_use_capability", { grant }),
		});
	}
	return entries;
}

/**
 * The grants that earn their own chip and gloss (agent review round 5, R5-1).
 *
 * WHY DEDUPE, AND WHY DROP `unattended`. The CLI's `--grant` is repeatable and
 * unfiltered, and `onboard.py::step_grants` folds `unattended` in from the flag
 * as well, so a request can arrive carrying the same capability twice or with
 * `unattended` as a grant beside the flag that already means it. Both lists here
 * are keyed by the label they render, so a duplicate is a duplicate React key -
 * and `grant unattended` would gloss as "you may unattended on that device":
 * ungrammatical, and a second, worse copy of the sentence the `trust unattended
 * sessions` scope already writes correctly.
 */
function distinctGrants(
	grants: readonly string[],
	unattended: boolean,
): string[] {
	const seen = new Set<string>();
	for (const grant of grants) {
		const token = String(grant ?? "").trim();
		if (!token) continue;
		if (unattended && token === "unattended") continue;
		seen.add(token);
	}
	return [...seen];
}

/**
 * The capability tokens that need their own sentence, not the generic template.
 *
 * WHY `unattended` IS SPECIAL. Every other capability is a verb the template can
 * carry ("you may approve on that device"), but `unattended` is not one: the
 * generic form produced "you may unattended on that device". It is reachable in
 * BOTH shapes - the `unattended` flag, and `--grant unattended` with the flag
 * false (the CLI does not filter the list) - and in the second the flag's own
 * chip is not drawn, so the grant is the only place the capability is stated.
 * Mapping the token keeps one correct sentence for one capability instead of
 * dropping it or mis-writing it.
 */
// These grant descriptions are read after a locale switch without a new approval read.
const grantPhrases = (): Record<string, { term: string; gloss: string }> => ({
	unattended: {
		term: t("ui.mesh.mesh_approvals.trust_unattended_sessions"),
		gloss: t("ui.mesh.mesh_approvals.sessions_you_start_on_that_device_run"),
	},
	/*
	 * THE OTHER NON-VERB IN THE CORE'S GRANTABLE SET (agent review round 6,
	 * R6-1). `CAPABILITY_WORDS["broker_credential"]` reads "borrow this device's
	 * logins", and the direction here is the same as every other grant: the NODE
	 * granted THIS device the capability, so the reader may borrow the logins
	 * stored THERE. Everything else in the set is a verb the template already
	 * carries ("you may approve on that device"); these two are not, and a raw
	 * token inside a sentence is how a consent card stops being readable.
	 */
	broker_credential: {
		term: t("ui.mesh.mesh_approvals.borrow_logins_there"),
		/*
		 * NO "ON THAT DEVICE" IN THE GLOSS (agent review round 7, R7-1). The
		 * capability is checked in a PEER frame's chokepoint (`types.OP_CAPABILITY`
		 * maps `net_broker` -> `broker_credential`; `credentials/client.py` refuses a
		 * revoked borrower), and the design's own sequence puts the SESSION on the
		 * borrower's side dialing the owner's relay (`docs/design/mesh-credentials.md`,
		 * the credential-broker sequence). So the session doing the borrowing is the
		 * reader's OWN - saying "your sessions on that device" described a local use
		 * that needs no capability at all.
		 */
		gloss: t("ui.mesh.mesh_approvals.your_sessions_may_use_the_logins_stored"),
	},
});

/**
 * The summary clause for a capability token, so the sentence stays a sentence.
 *
 * MIRRORS THE CORE'S OWN TABLE: `types.CAPABILITY_WORDS` already maps every
 * grantable token to words ("steer a running turn here"), and this is that table
 * with the direction rule every gloss on this card follows (R4-2): the node
 * granted THIS device the capability, so the clause reads from the reader's
 * side - the same `here` to `there` flip `GRANT_PHRASES`' glosses already carry.
 * A token the core grows later falls back to the honest generic rather than
 * rendering a raw identifier inside a sentence.
 */
const grantClauses = (): Record<string, string> => ({
	list: t("ui.mesh.mesh_approvals.see_its_sessions"),
	view: t("ui.mesh.mesh_approvals.watch_a_session_there"),
	prompt: t("ui.mesh.mesh_approvals.send_prompts_to_a_session_there"),
	steer: t("ui.mesh.mesh_approvals.steer_a_running_turn_there"),
	stop: t("ui.mesh.mesh_approvals.stop_a_session_there"),
	slash: t("ui.mesh.mesh_approvals.run_slash_commands_there"),
	delete: t("ui.mesh.mesh_approvals.archive_or_delete_a_session_there"),
	move: t("ui.mesh.mesh_approvals.move_sessions_to_or_from_there"),
	broker_credential: t("ui.mesh.mesh_approvals.borrow_the_logins_stored_there"),
	approve: t("ui.mesh.mesh_approvals.answer_approval_prompts_there"),
	unattended: t(
		"ui.mesh.mesh_approvals.run_sessions_there_without_an_approval_prompt",
	),
});

/**
 * "expires in 42 minutes" — the record's ONE window (§2.1: 60 minutes by
 * default), rounded UP to the next unit so the copy never claims less time than
 * is left, which is the browser consent card's own rule for the same reason.
 * `null` when there is no window or it has passed (a passed window folds to
 * `expired` server-side anyway; this is the belt beside that brace).
 */
export function approvalRemainingLabel(
	expiresAtSeconds: number | null,
	nowSeconds: number,
): string | null {
	if (expiresAtSeconds === null || expiresAtSeconds <= 0) return null;
	const leftSeconds = expiresAtSeconds - nowSeconds;
	if (leftSeconds <= 0) return null;
	if (leftSeconds < 60)
		return t("ui.mesh.mesh_approvals.expires_in_under_a_minute");
	const minutes = Math.ceil(leftSeconds / 60);
	if (minutes < 90)
		return t("ui.mesh.mesh_approvals.expires_minutes", { count: minutes });
	const hours = Math.ceil(minutes / 60);
	return t("ui.mesh.mesh_approvals.expires_hours", { count: hours });
}

/* ---------------------------------------------------------------- hooks */

/**
 * `GET /v1/desktop/approvals`, normalised.
 *
 * `poll` is the RAIL's true and the PAGE's false — see this file's header. It
 * mirrors the networks hook's rider configuration exactly (infinite `staleTime`,
 * no focus refetch), so whichever observer is the poller, the other one rides
 * the same cache entry and a settled decision refetches both through one key.
 */
export function useMeshApprovals(
	enabled: boolean,
	{ poll = true }: { poll?: boolean } = {},
) {
	return useQuery({
		queryKey: meshApprovalKeys.approvals,
		enabled,
		queryFn: async () =>
			approvalRows(await desktopResult<unknown>({ op: "approvals.list" })),
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? MESH_APPROVAL_POLL_MS : false,
		refetchOnWindowFocus: poll,
	});
}

/**
 * The two decisions. See this file's header for why the answer is not parsed:
 * the LIST is the one authority for the record's state, and the settle is what
 * makes it current.
 *
 * BOTH READS THE ANSWER CAN CONTRADICT ARE INVALIDATED: the approvals (the
 * record's own state) and the mesh reads (a `connected` record is a device that
 * now exists in the topology — `networks`/`peers` are how "the device appears on
 * the network" reaches the canvas). The runner itself is agent-driven
 * (`lop network approvals run <approval>`), so for the states the UI cannot cause,
 * the 30 s mesh cadence is what picks the arrival up; this invalidation is what
 * makes the DECIDED cases immediate.
 */
export function useMeshApprovalDecision() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (ask: {
			approvalId: string;
			decision: ApprovalDecision;
			/** Built by `approvalDecisionRequest`, the one place a decision becomes a request. */
			request: DesktopRequest;
		}): Promise<void> => {
			const answer = await desktopResult<unknown>(ask.request);
			// The ONE answer this reads (the header's rule otherwise holds): a typed
			// approve that SIGNED but whose apply refused answers 200 with
			// `applied.ok: false`, and the list cannot always say so - a card refused
			// before its run started stays `approved` with no receipt. Thrown, so it
			// reaches the card through the same refusal path every other one takes.
			if (ask.request.op === "approvals.approveCredential") {
				const unapplied = unappliedPhase(answer);
				if (unapplied) throw unapplied;
			}
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: meshApprovalKeys.approvals });
			void client.invalidateQueries({ queryKey: meshKeys.networks });
			void client.invalidateQueries({ queryKey: meshKeys.peers });
		},
	});
}

/**
 * The sentence a failed approvals READ shows.
 *
 * Same rule as `meshErrorMessage`: the authored sentence (the transport's or the
 * backend's) is preferred over a composed one, and the composed fallback names
 * the read rather than the mesh, because this read can fail while the mesh is
 * fine (and the reverse).
 */
export function approvalErrorMessage(error: unknown): string {
	const authored = (error as Partial<DesktopControlError> | null)?.message;
	if (typeof authored === "string" && authored.trim()) return authored.trim();
	return t("ui.mesh.mesh_approvals.the_approvals_could_not_be_read");
}

/**
 * The refusal a FAILED DECISION carries, as the two facts the card renders
 * (agent review round 1, finding 1).
 *
 * The same preference `approvalErrorMessage` states - the authored sentence
 * (the backend's or the transport's) over a composed one - read structurally so
 * both of a decision's failure classes land here: the desktop plane's refusals
 * (`{code, message}` under `detail`: no signing surface, a declined prompt, a
 * conflict or expiry) and the transport's own synthesised deadline ("may or may
 * not have landed … answering it again is safe").
 *
 * THE CODE TRAVELS WITH THE SENTENCE because it is the machine category a
 * support conversation and a log agree on - the mesh's move refusals already
 * render theirs, and this is the same kind of surface.
 *
 * The fallback is only reachable for a failure that carried neither (an IPC
 * rejection with no message): it states what this surface knows rather than
 * inventing a cause, and the next `mutate` call clears the whole refusal.
 */
export function approvalRefusal(error: unknown): {
	code: string;
	sentence: string;
	retryable: boolean;
} {
	const held = error as {
		code?: unknown;
		message?: unknown;
		detail?: unknown;
		applyOutcome?: unknown;
	} | null;
	/*
	 * AN APPLY-PHASE REFUSAL CARRIES ITS OWN OUTCOME: the approve answer's
	 * `applied` block (thrown by the mutation as `applyOutcome`), or the
	 * `apply-credential` 409's `apply_outcome` (on the transport error's `detail`).
	 * Its `reason` and `remedy` are the backend's desktop-safe sentences, so they
	 * are preferred over `message`, which stays CLI-shaped for compatibility.
	 */
	const outcome = applyOutcome(
		held?.applyOutcome ??
			(isRecord(held?.detail) ? held.detail.apply_outcome : undefined),
	);
	const outcomeSentence = outcome
		? [outcome.reason, outcome.remedy].filter(Boolean).join(" ")
		: "";
	return {
		code: outcome?.code || text(held?.code) || "approval_refused",
		sentence:
			outcomeSentence ||
			text(held?.message) ||
			t("ui.mesh.mesh_approvals.decision_could_not_be_answered"),
		retryable: outcome?.retryable === true,
	};
}

/**
 * The `applied: {ok: false, ...}` phase of an `approve-credential` answer, as an
 * error `approvalRefusal` reads; `null` when the apply succeeded or the answer has
 * no phase block (nothing to report beyond the list's own state).
 */
export function unappliedPhase(answer: unknown): {
	code: string;
	message: string;
	applyOutcome: unknown;
} | null {
	const applied = isRecord(answer) ? answer.applied : undefined;
	if (!isRecord(applied) || applied.ok !== false) return null;
	return {
		code: text(applied.code),
		message: text(applied.message),
		applyOutcome: applied,
	};
}
