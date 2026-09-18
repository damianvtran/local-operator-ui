/**
 * How a refused MCP remedy is reported, and where its remedy is reachable.
 *
 * ## The dead end this answers
 *
 * Every failure of an MCP control reaches the renderer as ONE sentence the
 * backend chose: `routes/desktop_lifecycle.py` replaces each refusal of
 * `mcp.control` with a fixed 409 string, and `routes/desktop_sessions.py` answers
 * a session it cannot bind with a fixed 503. Both surfaces printed that sentence
 * verbatim through `userFacingMessage`, so pressing `Grant account access`
 * answered with "The MCP control was refused. Check server ownership, transport
 * and current operation state." — three nouns this app shows nowhere else — or
 * with "Session owner is unavailable. Reconnect and reconcile before retrying.",
 * where repeating the identical request was the only control on the dialog. The
 * row's own fixes (`Sign in`, `Reload`, `Remove`, and the key its config
 * declares) sat two screens away with nothing pointing at them (UX review round
 * 2, U1 — the finding this module closes).
 *
 * So this module owns the two halves of that failure:
 *
 * 1. the COPY: one sentence per (phase, cause), in the user's terms, with the
 *    backend's vocabulary and its "reconcile"-class verbs gone;
 * 2. the ROUTING: which of the row's own remedies a failure state offers, and
 *    the one route that reaches the rest.
 *
 * Two surfaces of this app still choose their own controls rather than calling
 * `mcpFailureActions`, and neither is a second copy of this rule (review R4):
 * the key form (`mcp-key-dialog.tsx`) offers the route to the row and nothing
 * else, because `Save and reconnect` IS its retry and the row owns every other
 * control; and the Settings section itself (`mcp-management-section.tsx`) offers
 * no remedy at all, because the row whose control just failed is already on
 * screen, one row below the sentence. What neither may do is author a sentence:
 * both take theirs from `mcpFailure`, which is the half that has one owner.
 *
 * ## Why the sentence is chosen here rather than echoed from the wire
 *
 * The wire cannot be trusted to phrase a remedy, because it collapses causes:
 * `desktop_lifecycle.py` answers every `ValueError` of this op with one string,
 * so a 409 says nothing about which of them happened. What the renderer DOES know
 * is the phase it asked in and the status it got back, which is enough to say
 * something true and specific — and where it is not (a 503 whose sentence is a
 * vetted startup reason rather than the generic one), the server's own words are
 * carried through verbatim rather than paraphrased, which is the same rule the
 * run panel already applies to a diagnosis it cannot restate.
 *
 * ## What is deliberately NOT here
 *
 * `Remove` is never offered from a failure state. It is a scoped write into one
 * of eight config files, it needs a confirmation and the SOURCE FILE's own scope
 * (`mcp-management-section.tsx` reads `owned_scope`, which the panel's row does
 * not carry), and a second place to get that scope wrong is how a project-owned
 * server became unremovable once already. The row this module routes to owns
 * that decision.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_SENTENCE,
	isDesktopRefusalCode,
} from "../../../../../../shared/desktop-contract";
import {
	DesktopControlError,
	UserFacingError,
} from "@shared/api/local-operator/desktop-api";
import { MCP_CONTROL_WORD, type McpRemedy } from "./run-detail-model";

/**
 * The request that failed.
 *
 * The phase decides the first sentence and which remedy is NOT offered again: the
 * one that just failed. `reconnect` and `grant` are separate phases even though
 * one hook starts both (`use-mcp-remedy.ts`), because the sentence for a failed
 * `connect` is not the sentence for a refused sign-in.
 */
export type McpFailurePhase =
	| "probe"
	| "grant"
	| "reconnect"
	| "reload"
	| "add"
	| "key"
	| "cancel"
	| "status"
	| "disconnect"
	| "remove";

/**
 * What the phase could NOT do, as the head of its sentence.
 *
 * Clause-shaped on purpose: each tail below completes it, so the cause is stated
 * once rather than re-spelled ten times. No sentence names an internal concept —
 * not "server ownership", not "transport", not "operation state", and not the
 * session's owner, which no surface of this app shows.
 */
const MCP_FAILURE_LEAD: Record<McpFailurePhase, string> = {
	probe: "This server's sign-in method could not be checked",
	grant: "The sign-in could not be started",
	reconnect: "The server could not be reconnected",
	reload: "This server's configuration could not be re-read",
	add: "The server could not be added",
	key: "The keys were not saved",
	cancel: "The cancellation could not be confirmed",
	status: "The sign-in status could not be refreshed",
	disconnect: "The server could not be disconnected",
	remove: "The server could not be removed",
};

/**
 * The two 503 sentences the APP itself writes, i.e. the request never reached a
 * backend at all.
 *
 * Both are authored at `src/main/desktop-transport.ts` and both mean the same
 * thing: main could not produce an answer. They are listed so a 503 can be told
 * apart from the backend's own 503, which is a fact about one CONVERSATION rather
 * than about the server — the two need different remedies, and the status alone
 * cannot separate them.
 */
const MCP_APP_AUTHORED_503: readonly string[] = [
	/*
	 * Built from the shared machine vocabulary rather than re-typed here. The CODES
	 * below are the primary test - main now declares one on each of its own
	 * synthesised refusals - and these strings are the fallback for a transport that
	 * carries no code (the browser development proxy). One authority for the
	 * sentence, so a reworded machine detail cannot leave a stale copy matching
	 * nothing.
	 */
	DESKTOP_MACHINE_DETAIL.noCredential,
	DESKTOP_MACHINE_DETAIL.transportFailed,
];

/**
 * The backend's generic "this conversation's session is not bound" sentence.
 *
 * `routes/desktop_sessions.py` answers with exactly this when the session's owner
 * cannot be reached, and it is the one 503 sentence that says nothing a reader can
 * act on — so it is replaced by our own rather than carried through as a detail.
 * Any OTHER 503 sentence from the backend reached that raise through
 * `ActionableConnectionError`, whose type is what certifies it as a vetted
 * configuration sentence; those are carried through verbatim.
 */
const MCP_SESSION_UNAVAILABLE = "Session owner is unavailable.";

/** Why a remedy failed, as far as this renderer can honestly tell. */
export type McpFailureCause =
	/** The backend refused the control and did not say which cause it was. */
	| "refused"
	/** The backend refused it because one sign-in per conversation was running. */
	| "busy"
	/** The conversation's session is not running, so nothing could reach it. */
	| "session"
	/** A fact about the SERVER: it did not answer, or answered about itself. */
	| "server"
	/** Nothing here can tell; the sentence says so and the controls stay. */
	| "unknown";

/** What a failure state says, in the one form both surfaces render. */
export type McpFailure = {
	/** The sentence the surface shows. */
	message: string;
	/**
	 * The server's own words, VERBATIM, when they are a reason rather than a
	 * category — `null` whenever our own sentence already says everything true.
	 *
	 * Rendered in machine voice, like every other exception this app prints: a
	 * paraphrase of a diagnosis is a claim nobody can check.
	 */
	detail: string | null;
	/** The cause, so a caller can decide which remedies are honest to offer. */
	cause: McpFailureCause;
	/**
	 * The request that failed.
	 *
	 * Carried with the sentence rather than re-derived at the render site: the
	 * remedies exclude the phase that just failed, and a caller that guessed the
	 * phase wrong would offer the identical request as a second, differently
	 * labelled control — which is the shape of the dead end this replaces.
	 */
	phase: McpFailurePhase;
};

/**
 * Classify a failure and author its sentence.
 *
 * `grantRunning` is the read's own "a sign-in is in flight for this conversation"
 * (`mcpGrantInFlight`), which is the ONE cause of a refusal this surface can name
 * with certainty: the backend allows one grant per session and refuses the rest
 * with the same opaque 409.
 */
export function mcpFailure(
	phase: McpFailurePhase,
	error: unknown,
	grantRunning: boolean,
): McpFailure {
	const lead = MCP_FAILURE_LEAD[phase];
	// Our own client-side refusals are already copy; only the wire's sentences are
	// the ones this module exists to replace.
	if (error instanceof UserFacingError)
		return { message: error.message, detail: null, cause: "unknown", phase };
	if (!(error instanceof DesktopControlError))
		return { message: `${lead}.`, detail: null, cause: "unknown", phase };
	const message = error.message.trim();

	/*
	 * A REFUSAL OF THE PAIRING FAMILY IS ABOUT THE SERVER, and it is checked before
	 * every status-shaped branch below - including the 409 one, whose sentence would
	 * otherwise describe a busy sign-in for a plane that is simply not this app's.
	 *
	 * This is the branch that removes the photographed line. The server answers a
	 * `/v1/desktop/` route with "Desktop controls require a backend started by the
	 * desktop app." and this dialog used to print it VERBATIM as the diagnosis (a
	 * 503 the app did not author was read as "this conversation's session is not
	 * running", and the daemon's own words were carried into `detail`). A server
	 * string is not this app's sentence: the code says which pairing fact it was,
	 * and the shared table says it in the product's voice (design § 5.1).
	 */
	if (isDesktopRefusalCode(error.code))
		return {
			message: `${lead}. ${DESKTOP_REFUSAL_SENTENCE[error.code]}`,
			detail: null,
			cause: "server",
			phase,
		};

	if (error.status === 409)
		return grantRunning
			? {
					message: `${lead}: a sign-in is already running for this conversation, and only one can run at a time. Wait for it to finish, or cancel it from the server's row.`,
					detail: null,
					cause: "busy",
					phase,
				}
			: {
					message: `${lead}: the server refused it without giving a reason, and nothing was changed.`,
					detail: null,
					cause: "refused",
					phase,
				};

	// A 503 the app did not author is the session this conversation needs, not the
	// server: main's own two sentences are the only ones that mean "no answer
	// arrived", and both are checked above by identity rather than by shape.
	//
	// The tail names `Try again` rather than "reopen the conversation", which is the
	// design round's D10 reconciled with the routing rule below: a control request is
	// itself what re-engages a session (`desktop_lifecycle.py` binds the runtime
	// before routing), so the retry the dialog OFFERS is the move that brings the
	// session back — reopening a conversation is not a control on this surface at
	// all, and naming it left the sentence pointing away from the accented control
	// underneath it.
	if (
		error.status === 503 &&
		!isDesktopRefusalCode(error.code) &&
		!MCP_APP_AUTHORED_503.includes(message)
	)
		return {
			message: `${lead} because this conversation's session is not running. Trying again restarts it and repeats this request.`,
			cause: "session",
			phase,
			detail: message.startsWith(MCP_SESSION_UNAVAILABLE) ? null : message,
		};

	// Everything else is a fact about the SERVER, in the app's one shared
	// vocabulary: not answering, not paired, older than this app expects, or a
	// status no surface can advise on. `lead` carries the surface's own scope, and
	// the shared module carries the diagnosis and the remedy.
	return {
		message: backendLoadErrorMessage(`${lead}.`, error),
		detail: null,
		cause: "server",
		phase,
	};
}

/** One of the row's own remedies, as the failure state offers it. */
export type McpFailureAction = {
	kind: "grant" | "key" | "reconnect" | "reload" | "settings";
	label: string;
};

/**
 * Where a failed server's row lives, as a route.
 *
 * `?section=integrations` opens the MCP list and `&mcp=<name>` reveals and scrolls
 * to one row (`settings-page.tsx` reads both, `resolveMcpServerTarget` resolves the
 * argument against the loaded list), so this lands ON the row rather than on a page
 * the reader then has to search. The row carries the controls a failure state may
 * not re-implement: `Remove` with its scope, the server's own `Sign in`/`Reload`,
 * and the setup prompt when the backend sent one.
 */
export const mcpServerSettingsRoute = (name: string): string =>
	`/settings?section=integrations&mcp=${encodeURIComponent(name)}`;

/** The one label for the route to the row, so two surfaces cannot spell it twice. */
export const MCP_SETTINGS_ACTION_LABEL = "Open this server in Settings";

/**
 * The remedies for a state whose fix is the server's own configuration.
 *
 * Two actions and no more: `Reload` re-reads the config (the action that picks up
 * an edit made in an editor or by an agent), and the row in Settings is where the
 * credential map, `Remove` and its scope live. Offered where a probe ANSWERED
 * rather than failed — the state is known and the config is what changes it — and
 * where a status read failed, since nothing the dialog holds can restart a sign-in
 * it cannot see.
 */
export const mcpConfigActions = (): McpFailureAction[] => [
	{ kind: "reload", label: MCP_CONTROL_WORD.reload },
	{ kind: "settings", label: MCP_SETTINGS_ACTION_LABEL },
];

/**
 * The remedies a failure state offers, beyond the retry its own actions row holds.
 *
 * Fixed rules, all of them about honesty rather than convenience:
 *
 * - **A failure about the SERVER offers nothing at all, not even the row's own
 *   remedy.** A server that did not answer, is not paired, or is older than this
 *   app expects already has its remedy in the sentence and in the app-wide banner,
 *   and a route into Settings would fail to load for the same reason — but the
 *   row's own remedy is not an exception to that rule, it is the most tempting
 *   instance of it: `Grant account access` from an unreachable or outdated server
 *   is the same request into the same dead backend, and it answers with a second,
 *   differently-worded failure (QA round 1, Q1, reproduced live on a 404, a 401
 *   and a server that never answered). The guard below therefore runs BEFORE the
 *   row's remedy is pushed, so this state returns `[]` for every phase and every
 *   row.
 * - **The remedy that just failed is not offered again under a second label.** It
 *   is the request the reader has just watched being refused, and naming it twice
 *   is one press advertised as two — the shape that made a retry look like an
 *   escape. What re-offers it is the dialog's `Try again`, which re-runs the
 *   PROBE for the row: a probe that answers puts the dialog back on its own
 *   primary, so a refused sign-in is one press away rather than gone.
 * - **`Reload` is offered wherever a remedy is** — everywhere except the server
 *   cause above, which offers nothing at all. It re-reads the server's config
 *   from disk and writes nothing, so it is the action that picks up the `${NAME}`
 *   reference the copy may be asking for.
 * - **A conversation whose session is not running KEEPS its remedies, and this is
 *   the authoritative reading** (review R1 asked for the two to be reconciled, and
 *   QA Q5 with it; the shipped rule is what the test pins and what the fixture
 *   answered — a control request is itself what re-engages a session,
 *   `desktop_lifecycle.py` binding the runtime before it routes, so the next
 *   `reload` after a session had gone answered 200). Only the request that just
 *   failed is withheld, exactly as for every other cause. The copy leans the same
 *   way: the sentence names `Try again`, which is a control on this surface.
 * - **The row in Settings is last wherever it CAN work**, and it is what remains
 *   when the dialog's own two operations cannot be offered.
 */
export function mcpFailureActions(input: {
	row: { remedy: McpRemedy | null; keyNames: readonly string[] };
	phase: McpFailurePhase;
	cause: McpFailureCause;
	/** Whether this build can take a credential write at all (`mcp_auth`). */
	keyEntryAvailable: boolean;
}): McpFailureAction[] {
	// A server that did not answer, is not paired, or is older than this app
	// expects is the one state nothing here can help, and the sentence is where its
	// remedy lives. This returns BEFORE the row's own remedy is pushed: the row's
	// remedy is not exempt from the rule, it is the case the rule exists for (QA
	// round 1, Q1).
	if (input.cause === "server") return [];
	const actions: McpFailureAction[] = [];
	const remedy = input.row.remedy;
	const grant: McpFailureAction = {
		kind: "grant",
		label: MCP_CONTROL_WORD.grant,
	};
	if (remedy?.kind === "grant" && input.phase !== "grant") actions.push(grant);
	if (
		remedy?.kind === "key" &&
		input.phase !== "key" &&
		input.keyEntryAvailable &&
		input.row.keyNames.length > 0
	)
		actions.push({ kind: "key", label: MCP_CONTROL_WORD.key });
	if (remedy?.kind === "reconnect" && input.phase !== "reconnect")
		actions.push({ kind: "reconnect", label: MCP_CONTROL_WORD.reconnect });
	// Same rule as the row's own remedies: a reload that just failed is not offered
	// again here, and the failure sentence's own outcome is what the reader needs
	// instead of a second press of the identical request.
	if (input.phase !== "reload")
		actions.push({ kind: "reload", label: MCP_CONTROL_WORD.reload });
	actions.push({ kind: "settings", label: MCP_SETTINGS_ACTION_LABEL });
	return actions;
}
