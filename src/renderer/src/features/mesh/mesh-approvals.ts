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

/** The two decisions the record's store accepts (`approve`, `deny`). */
export type ApprovalDecision = "approve" | "deny";

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
	kind: "device" | "machine";
	where: MeshApprovalWhere;
	what: MeshApprovalScopes;
	requestedBy: { surface: string; sessionId: string; deviceId: string };
	/** Epoch seconds, or `null`; `<= 0` reads as "no window" in the labels. */
	expiresAt: number | null;
};

/* ------------------------------------------------------------ the states */

/**
 * The NON-TERMINAL states: an onboarding that is waiting, approved, running or
 * stopped-but-retryable. `connected`/`denied`/`expired` are terminal
 * (`network/approvals.py::TERMINAL_STATES`), and the badge counts everything
 * here — "pending connection/install approvals" in the operator's words covers
 * the whole flight, so the badge stays up through `approved` and `connecting`
 * and drops when the record settles (including a `failed` runner, which is the
 * state a person should not miss).
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

/** The number the rail badge and the tray heading count. */
export function pendingApprovalCount(rows: readonly MeshApprovalRow[]): number {
	return rows.filter((row) => isOpenApproval(row.state)).length;
}

/** `approve` is offered on `requested` alone: every other open state is past the decision. */
export function canApproveApproval(state: string): boolean {
	return state === "requested";
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
			return "Waiting for you";
		case "approved":
			return "Approved";
		case "connecting":
			return "Connecting…";
		case "connected":
			return "Connected";
		case "denied":
			return "Denied";
		case "expired":
			return "Expired";
		case "failed":
			return "Failed";
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
		const kind: MeshApprovalRow["kind"] =
			!isRecord(raw.device) && isRecord(raw.machine) ? "machine" : "device";
		const requestedBy = isRecord(raw.requested_by) ? raw.requested_by : {};
		rows.push({
			approvalId,
			state,
			kind,
			where: where(kind === "machine" ? raw.machine : raw.device),
			what: scopes(raw.what),
			requestedBy: {
				surface: text(requestedBy.surface),
				sessionId: text(requestedBy.session_id),
				deviceId: text(requestedBy.device_id),
			},
			expiresAt: time(raw.expires_at),
		});
	}
	return rows;
}

/* --------------------------------------------------------------- labels */

/**
 * What the row is about, for the card's title and the resolved lines: the device
 * for a `device_onboard` (name, else its id's tail — `deviceLabel`'s one rule),
 * "this machine" for a `local_authority` bootstrap, which is about the reader's
 * own machine by definition.
 */
export function approvalSubject(row: MeshApprovalRow): string {
	if (row.kind === "machine") return "this machine";
	return deviceLabel({ device_id: row.where.deviceId, name: row.where.name });
}

/** The card's title: the record's own verb, sentence case. */
export function approvalTitle(row: MeshApprovalRow): string {
	return row.kind === "machine"
		? "Set up operator authority on this machine"
		: `Onboard ${approvalSubject(row)}`;
}

/**
 * The where line, in the CLI's own order and spelling ("what / where / who" is
 * the card's order in `network/cli.py::_approval_lines`): `user@host via
 * transport (name)`. Absent parts are omitted, and a block that names nothing
 * returns `null` so the surface hides the line rather than drawing "via ".
 */
export function approvalWhereLabel(row: MeshApprovalRow): string | null {
	const { user, host, transport, name } = row.where;
	const parts = [
		host ? (user ? `${user}@${host}` : host) : "",
		transport ? `via ${transport}` : "",
		// The CLI's own `(name)` clause, minus the case where the name IS the host: two
		// identical words read as a stutter, not as information.
		name && name !== host ? `(${name})` : "",
	].filter(Boolean);
	return parts.length ? parts.join(" ") : null;
}

/** The host-key fingerprint, when the record carries one — its own line, monospace. */
export function approvalHostKeyLabel(row: MeshApprovalRow): string | null {
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
		sessionId ? `session ${sessionId.slice(-6)}` : "",
	].filter(Boolean);
	return parts.length ? `asked by ${parts.join(" · ")}` : null;
}

/**
 * The scope chips, in the CLI's own order and wording, so the two surfaces read
 * one sentence: connect / install / install operator anchor / join … as … /
 * trust unattended sessions / grant ….
 */
export function approvalScopeLabels(
	row: MeshApprovalRow,
	networkNames?: ReadonlyMap<string, string>,
): string[] {
	const { connect, install, anchor, networkId, role, unattended, grants } =
		row.what;
	const labels: string[] = [];
	if (connect) labels.push("connect");
	if (install) labels.push("install");
	if (anchor) labels.push("install operator anchor");
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
		labels.push(`join ${named || networkId} as ${role || "?"}`);
	}
	if (unattended) labels.push("trust unattended sessions");
	/* The chip and its gloss must name the capability the same way, or one card
		   states one capability twice under two names (R5-1's `grant unattended`). */
	for (const grant of distinctGrants(grants, unattended))
		labels.push(GRANT_PHRASES[grant]?.term ?? `grant ${grant}`);
	return labels;
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
const GRANT_PHRASES: Record<string, { term: string; gloss: string }> = {
	unattended: {
		term: "trust unattended sessions",
		gloss:
			"sessions you start on that device run without an approval prompt there",
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
		term: "borrow logins there",
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
		gloss: "your sessions may use the logins stored on that device",
	},
};

/**
 * One gloss per scope a reader cannot be expected to know (UX round 1, U2).
 *
 * The card's single sentence explains the GESTURE ("approving signs with this
 * machine's operator key"); what it never said was what each authorised SCOPE
 * means - and the two scopes the design made salient are exactly the two a
 * non-expert cannot interpret. A glossary that names them is cheaper than a
 * user learning them by approving once.
 *
 * Only the scopes that need it appear: `connect`/`install`/`join` are ordinary
 * words, so glossing them would bury the two that are not.
 */
export function approvalScopeGlosses(
	row: MeshApprovalRow,
): { term: string; gloss: string }[] {
	const { anchor, unattended, grants } = row.what;
	const glosses: { term: string; gloss: string }[] = [];
	if (anchor)
		glosses.push({
			term: "install operator anchor",
			/*
			 * THE DIRECTION MATTERS, AND THIS SAID IT BACKWARDS (agent review round 4,
			 * R4-1). A remote anchor is PUBLIC data - the core's own copy for a
			 * verify-only host is "an anchor is installed ... but the private half is
			 * not on this host, so nothing can be SIGNED there" (`network/readiness.py`),
			 * and its shipped sentence is "approvals for offloaded work can be signed
			 * from your devices". The node VERIFIES; it never signs. A gloss saying the
			 * remote is "trusted to sign as you" states the inverse of the authority at
			 * the exact moment the reader consents to it.
			 */
			gloss:
				"that device can check approvals signed on your machines; nothing there can sign",
		});
	if (unattended)
		glosses.push({
			term: "trust unattended sessions",
			/*
			 * THE CONSEQUENCE AND THE RIGHT PARTY (UX round 2, U8; agent review round 4,
			 * R4-2). `onboard.py::step_grants` is explicit - "what the node lets THIS
			 * device do ... both the `approve` scope and the `unattended` scope are
			 * grants the NODE holds about the operator's device id" - and
			 * `CAPABILITY_WORDS["unattended"]` reads "start sessions here without
			 * approval prompts". The prompt that stops being asked is the node's own.
			 */
			gloss:
				"sessions you start on that device run without an approval prompt there",
		});
	for (const grant of distinctGrants(grants, unattended))
		glosses.push(
			GRANT_PHRASES[grant] ?? {
				term: `grant ${grant}`,
				/* The capability is held by YOUR device, about the node (R4-2). */
				gloss: `you may ${grant} on that device`,
			},
		);
	return glosses;
}

/**
 * The scopes that ask for MORE than a connection, and so wear their own register.
 *
 * WHY THIS EXISTS (design round 1, D1). All six chips measured the same
triple - 12px/500, `sunken` ground, one `hairline` border, 23.4px tall, 9.08:1
dark / 7.18:1 light - so `install operator anchor` and `trust unattended
sessions` read exactly like `connect` on the one card whose entire purpose is
informed consent to an operator-key signing gesture. The card is not a summary
of a connection; two of its scopes hand over trust, and the reader has to be
able to see which ones without reading a legend twice.
 *
 * `attention` is the house variant for "read this before you answer" (the state
 * chip on a `requested` record already wears it), so the consequence-bearing
 * scopes borrow a register the surface has already taught the reader, rather
 * than a new one invented here.
 *
 * Keyed by LABEL because that is what the chip renders and what the test can
 * read; the labels are built in one place (`approvalScopeLabels`) and pinned
 * beside this list, so the two cannot drift silently.
 */
const CONSEQUENCE_SCOPE_LABELS: ReadonlySet<string> = new Set([
	"install operator anchor",
	"trust unattended sessions",
]);

export function approvalScopeTone(label: string): "attention" | "neutral" {
	return CONSEQUENCE_SCOPE_LABELS.has(label) ? "attention" : "neutral";
}

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
	if (leftSeconds < 60) return "expires in under a minute";
	const minutes = Math.ceil(leftSeconds / 60);
	if (minutes < 90)
		return minutes === 1
			? "expires in 1 minute"
			: `expires in ${minutes} minutes`;
	const hours = Math.ceil(minutes / 60);
	return hours === 1 ? "expires in 1 hour" : `expires in ${hours} hours`;
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
 * (`lop network approvals run`), so for the states the UI cannot cause, the
 * 30 s mesh cadence is what picks the arrival up; this invalidation is what
 * makes the DECIDED cases immediate.
 */
export function useMeshApprovalDecision() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (ask: {
			approvalId: string;
			decision: ApprovalDecision;
		}): Promise<void> => {
			const request =
				ask.decision === "approve"
					? ({ op: "approvals.approve", approvalId: ask.approvalId } as const)
					: ({ op: "approvals.deny", approvalId: ask.approvalId } as const);
			await desktopResult<unknown>(request);
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
	return "The approvals could not be read.";
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
} {
	const held = error as { code?: unknown; message?: unknown } | null;
	return {
		code: text(held?.code) || "approval_refused",
		sentence: text(held?.message) || "The decision could not be answered.",
	};
}
