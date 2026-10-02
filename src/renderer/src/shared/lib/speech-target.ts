/**
 * WHERE A SPEAK PRESS IS AIMED.
 *
 * THE DEFECT THIS MODULE EXISTS FOR. A press used to be aimed at the identity
 * the pane is on - the canonical session id the app calls `agentId` and puts in
 * `/chat/<id>` - and the daemon's speech route resolves its `agent_id` in the
 * AGENT REGISTRY, which is a scan of `<config root>/agents/<id>/agent.yml`.
 * Sessions and agents are different namespaces: a conversation's id is 12-hex,
 * an agent's is a UUID, and the two sets never intersect. So a press that sent
 * the pane identity asked the registry for a session, missed, and was refused
 * with the daemon's unknown-agent sentence - on a fresh conversation and after a
 * daemon rotation alike.
 *
 * THE SECOND HALF, WHICH IS WHY THIS MODULE RESOLVES RATHER THAN FORWARDS: the
 * conversation's own binding (`SessionBinding.agent`, the catalogue row's durable
 * binding) is the agent's DISPLAY NAME - more precisely, the PROFILE name, which
 * is what the daemon validates a launch target against and writes into the
 * attachment. Every writer of an attachment writes a name
 * (`desktop_profiles.validate_target` returns `profile_detail(...)["name"]`, the
 * TUI writes `agent_name`, the bootstrap writes its `ROLE_NAME`), and the daemon
 * says why: *"Names deliberately remain the runtime's attachment keys; registry
 * IDs describe provenance, never conversation identity."* The speech route
 * resolves by id only, so forwarding the binding verbatim reached the same 404 by
 * a different road.
 *
 * MEASURED END TO END on an isolated daemon, which is what fixed the resolution's
 * shape (agent review round 1, Q1, and the round-1 remediation):
 *
 * ```
 * POST /v1/desktop/sessions {target: {kind: "agent", name: "aida"}}
 *   -> result.binding = {"agent": "aida", "team": null}
 *      sessions/6573865cb86e/attachment.json = {"agent": "aida", "team": ""}
 * GET  /v1/desktop/profiles        -> aida: source "installed", agent_id 1d9c4467-…
 * POST /v1/agents/aida/speech      -> 404 {"detail":"This conversation's agent is no longer available."}
 * POST /v1/agents/1d9c4467-…/speech -> 401  (past the registry, at the credential step)
 * ```
 *
 * So the binding is a PROFILE name, the profile row publishes the agent id beside
 * it, and only the id reaches the agent. That map is the first rung below.
 *
 * WHAT IS RESOLVABLE, in the daemon's own terms:
 *
 *  - the conversation's ROLE AGENT, reached as its REGISTRY ID - the most
 *    specific target, and the one that carries a voice (the daemon's
 *    `determine_voice` classifies the AGENT's name and description, so a
 *    conversation with no binding has nothing to classify);
 *  - the AGENT-LESS route (`POST /v1/tools/speech`, the `speech.create` op),
 *    which needs no registry entry at all - the target for every conversation
 *    that is not bound to a role (`binding.agent` null, the ordinary shape of a
 *    conversation the operator opened himself), and the fallback when a binding
 *    names an agent the registry no longer holds.
 *
 * SO THE PRESS RESOLVES IN THAT ORDER: resolve the binding to a registry id,
 * take the agent route when that succeeds, the agent-less route when it does
 * not - and the unknown-agent refusal stays the last rung (`fetchSpeechFor` in
 * `speech-store.ts`): an id that went stale between the lookup and the call
 * fails over rather than telling the reader their conversation is gone.
 *
 * NAME AND ID ARE BOTH ACCEPTED, deliberately. Today every writer publishes a
 * name, but `agent_id` is published beside it as provenance, so a runtime that
 * starts writing ids into the binding must not silently lose the agent voice:
 * the lookup tries the NAME through the catalogue's own name query, and falls
 * back to reading the value as an ID.
 *
 * THE THIRD RUNG, for a binding that is already a registry id (`agent_id` is
 * published beside every profile name, so a runtime that starts writing ids into
 * the attachment must not silently lose the agent voice): the value read as an
 * ID.
 *
 * `binding.agent` MAY BE THE EMPTY STRING, which is why the predicate below
 * tests its LENGTH rather than its truthiness: the daemon writes "" for "no
 * agent" on a team-bound session, and an empty path segment would build
 * `/v1/agents//speech`.
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { apiConfig } from "@shared/config";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { SessionBinding } from "../../../../shared/desktop-session-contract";

/** The row fields this rule reads. Structural, so stories and tests can pass one. */
export type SpeechBindableRow = {
	binding?: SessionBinding | null;
};

/**
 * The agent a conversation's row is bound to, as the daemon spells it - its
 * attachment key, which is a profile DISPLAY NAME today (see the header). It is
 * deliberately NOT an id, and `fetchSpeechAgentId` is what turns it into one.
 *
 * A pure rule rather than a hook, because the resolution's own tests drive it
 * directly; `useSpeechBindingFor` is the subscription the surfaces use.
 */
export function speechBindingForRow(
	row: SpeechBindableRow | null | undefined,
): string | null {
	const agent = row?.binding?.agent;
	return typeof agent === "string" && agent.length > 0 ? agent : null;
}

/**
 * As much of a PROFILE row as the lookup reads (`/v1/desktop/profiles`).
 *
 * THIS IS THE MAP THAT MATTERS, and the round-1 measurement is why. A
 * conversation's binding is a PROFILE name: the daemon validates a launch target
 * against its profiles and writes the resolved name into the attachment. The
 * profile row publishes the agent id beside it (`agent_id`), which is the same
 * registry id `POST /v1/agents/<id>/speech` resolves. Measured on a live daemon:
 * a conversation created on the target `aida` carries
 * `attachment.json = {"agent": "aida", "team": ""}`, the `aida` profile (source
 * `installed`) publishes `agent_id 1d9c4467-...`, `POST /v1/agents/aida/speech`
 * answers 404 with the unknown-agent sentence, and
 * `POST /v1/agents/1d9c4467-.../speech` resolves the agent and reaches the
 * credential step.
 *
 * `agent_id` IS NULL for a builtin profile that has never been installed - there
 * is no agent on disk for the speech route to resolve, so `null` is the honest
 * answer and the press takes the agent-less route.
 */
export type SpeechProfileRow = {
	/** The profile name the daemon writes into a binding. */
	name: string;
	/** The registry agent this profile is backed by, or null for a bare builtin. */
	agent_id?: string | null;
};

/** The registry id a profile row names, or `null` when it has no agent. */
export function profileSpeechAgentId(
	binding: string | null,
	profiles: readonly SpeechProfileRow[] | null | undefined,
): string | null {
	if (!binding) return null;
	const row = (profiles ?? []).find((profile) => profile.name === binding);
	return row?.agent_id ?? null;
}

/** As much of a `/v1/agents` row as the lookup reads. */
export type SpeechCatalogueAgent = {
	/** The registry id the speech route resolves. */
	id: string;
	/** The display name the agents registry holds. */
	name: string;
};

/** As much of a `/v1/agents` answer as the lookup reads. */
export type SpeechCataloguePage = {
	agents: readonly SpeechCatalogueAgent[];
	/** How many agents matched the query in total, before the page was cut. */
	total?: number;
};

/**
 * How many name-matched candidates the lookup asks for.
 *
 * Generous on purpose: the filter runs server-side, so this bounds a registry
 * whose agents nearly all share one name - not the registry itself (a real one
 * measured 46 agents, every name distinct).
 */
export const SPEECH_AGENT_LOOKUP_PAGE = 100;

/**
 * The registry id an AGENTS-REGISTRY page resolves the binding to, or `null`.
 *
 * The SECOND rung, for a binding that names an AGENT rather than a profile: the
 * TUI writes `agent_name` into the attachment, and this is the map for that
 * writer. Name first, then id; EXACT on both limbs, because the query's match is
 * a case-insensitive substring and a namesake caught in it is not this
 * conversation's agent.
 *
 * A TRUNCATED page is not searched: when the answer says it matched more rows
 * than it returned, the row being asked for may be on another page, and
 * answering `null` hands the press to the agent-less route (which speaks) rather
 * than to a namesake (which does not sound like this agent).
 */
export function resolveSpeechAgentId(
	binding: string | null,
	page: SpeechCataloguePage | null | undefined,
): string | null {
	if (!binding) return null;
	const rows = page?.agents ?? [];
	const total = page?.total;
	if (typeof total === "number" && total > rows.length) {
		const onPage = rows.find(
			(row) => row.name === binding || row.id === binding,
		);
		return onPage?.id ?? null;
	}
	const named = rows.find((row) => row.name === binding);
	if (named) return named.id;
	const identified = rows.find((row) => row.id === binding);
	return identified ? identified.id : null;
}

/** One authenticated read, or `null` - never a throw, at any rung. */
async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
	try {
		return await read();
	} catch {
		return null;
	}
}

/**
 * Resolve the conversation's binding to the registry id the speech route takes.
 *
 * THREE RUNGS, cheapest and most specific first, and every one of them EXACT:
 *
 *  1. the PROFILE row's `agent_id` - the daemon's own map for a role binding,
 *     and the rung a conversation created by the desktop app or the bootstrap
 *     lands on;
 *  2. the AGENTS REGISTRY by name - the map for a binding that names an agent
 *     (the TUI writes `agent_name`), asked with the name as a server-side filter
 *     so the registry is narrowed before the page is cut;
 *  3. the value read as an ID - for a runtime that publishes registry ids in the
 *     binding rather than names.
 *
 * An unreachable catalogue answers `null` at every rung rather than throwing:
 * this runs inside a press the reader already made, and a lookup that cannot be
 * made is not a reason to refuse to speak - the agent-less route needs none of
 * it, and that is what the press falls back to.
 */
export async function fetchSpeechAgentId(
	binding: string | null,
): Promise<string | null> {
	if (!binding) return null;
	const client = createLocalOperatorClient(apiConfig.baseUrl);

	const profile = await quietly(async () => {
		/*
		 * The list route the sidebar, the agents page and the project picker all
		 * read - one query, the app's own, rather than a second spelling of it.
		 * `desktopResult` throws on a non-2xx, which `quietly` turns into this
		 * rung's `null`.
		 */
		const { profiles } = await desktopResult<{ profiles: SpeechProfileRow[] }>({
			op: "profiles.list",
		});
		return profileSpeechAgentId(binding, profiles);
	});
	if (profile) return profile;

	const catalogue = await quietly(async () => {
		const answer = await client.agents.listAgents(
			1,
			SPEECH_AGENT_LOOKUP_PAGE,
			binding,
		);
		return answer.status < 400
			? resolveSpeechAgentId(binding, answer.result ?? null)
			: null;
	});
	if (catalogue) return catalogue;

	const direct = await quietly(async () => {
		const answer = await client.agents.getAgent(binding);
		return answer.status < 400 ? (answer.result?.id ?? null) : null;
	});
	return direct;
}

/**
 * The speech binding for the conversation a surface is mounted in, read live
 * from the catalogue.
 *
 * LIVE RATHER THAN THREADED, deliberately: a binding can arrive or move while a
 * transcript is on screen (an agent attached to the conversation, the row's
 * first catalogue read landing after the pane mounted), and a value captured at
 * mount would keep pressing the stale target until a remount. It is a primitive,
 * so the subscription re-renders only when the binding genuinely changes.
 *
 * `conversationId` is the pane identity the surfaces already hold - which is
 * also why a DRAFT (a `draft:<uuid>` key, no catalogue row yet) resolves to null
 * and takes the agent-less route: there is no binding to find, and the press
 * still works.
 *
 * THE CATALOGUE THE CLIENT HOLDS is the only source for a conversation's binding
 * (measured: `/v1/desktop/sessions` answers a page, not an id lookup, and a
 * session snapshot carries the transcript, not the row), so a conversation whose
 * row is not in the held page answers `null` here and speaks through the
 * agent-less route: a VOICE the press does not get, never a press it cannot make.
 */
export function useSpeechBindingFor(
	conversationId: string | null | undefined,
): string | null {
	return useCanonicalSessionsStore((state) =>
		conversationId
			? speechBindingForRow(
					state.sessions.find((row) => row.session_id === conversationId),
				)
			: null,
	);
}
