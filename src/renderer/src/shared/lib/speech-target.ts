/**
 * @file speech-target.ts
 * @description
 * What a speak press synthesises AGAINST, and why a conversation's own identity
 * is not the answer.
 *
 * THE TWO SIDES NAME DIFFERENT THINGS BY THE SAME WORD. The pane's identity
 * (`panelIdentityFor`: the canonical session id, or a draft key before the
 * create hop) is what this app calls the `agentId` it hands the transcript -
 * `/chat/<id>` is the route, and every surface below it reads that one value.
 * The daemon's speech route resolves its `agent_id` in the AGENT REGISTRY, which
 * is a scan of `<config root>/agents/<id>/agent.yml`. Sessions and agents are
 * different namespaces: a conversation's id is a 12-hex session name, an agent's
 * is a UUID, and the two sets never intersect. So a press that sends the pane
 * identity asks the registry for a session, misses, and is refused with the
 * daemon's unknown-agent sentence - the toast this module exists to stop
 * printing for a conversation that is perfectly resolvable.
 *
 * WHAT IS RESOLVABLE, in the daemon's own terms:
 *
 *  - the conversation's ROLE AGENT (`SessionBinding.agent`, the catalogue row's
 *    durable binding, `agents/<uuid>/agent.yml` on disk) - the most specific
 *    target, and the one that carries a voice (the daemon's `determine_voice`
 *    classifies the AGENT's name and description, so a conversation with no
 *    binding has nothing to classify);
 *  - the AGENT-LESS route (`POST /v1/tools/speech`, the `speech.create` op),
 *    which needs no registry entry at all - the target for every conversation
 *    that is not bound to a role (`binding.agent` null, which is the ordinary
 *    shape of a conversation the operator opened himself), and the fallback
 *    when a binding names an agent the registry no longer holds (an agent
 *    deleted, or a daemon whose config root moved).
 *
 * SO THE PRESS RESOLVES IN THAT ORDER: the binding when there is one, the
 * agent-less route when there is not - and the unknown-agent refusal itself is
 * the last rung (see `fetchSpeechFor` in `speech-store.ts`): a binding that has
 * gone stale fails over to the agent-less route rather than telling the reader
 * their conversation is gone.
 *
 * `binding.agent` MAY BE THE EMPTY STRING, which is why the predicate below
 * tests its LENGTH rather than its truthiness: the daemon writes "" for "no
 * agent" on a team-bound session, and an empty path segment would build
 * `/v1/agents//speech`.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { SessionBinding } from "../../../../shared/desktop-session-contract";

/** The row fields this rule reads. Structural, so stories and tests can pass one. */
export type SpeechBindableRow = {
	binding?: SessionBinding | null;
};

/**
 * The registry agent a conversation's row names, or null when it names none.
 *
 * A pure rule rather than a hook, because the fallback's own tests drive it
 * directly; `useSpeechAgentFor` is the subscription the surfaces use.
 */
export function speechAgentForRow(
	row: SpeechBindableRow | null | undefined,
): string | null {
	const agent = row?.binding?.agent;
	return typeof agent === "string" && agent.length > 0 ? agent : null;
}

/**
 * The speech agent for the conversation a surface is mounted in, read live from
 * the catalogue.
 *
 * LIVE RATHER THAN THREADED, deliberately: a binding can arrive or move while a
 * transcript is on screen (an agent attached to the conversation, the row's
 * first catalogue read landing after the pane mounted), and a value captured at
 * mount would keep pressing the stale target until a remount. It is a primitive,
 * so the subscription re-renders only when the agent genuinely changes.
 *
 * `conversationId` is the pane identity the surfaces already hold - which is
 * also why a DRAFT (a `draft:<uuid>` key, no catalogue row yet) resolves to null
 * and takes the agent-less route: there is no binding to find, and the press
 * still works.
 */
export function useSpeechAgentFor(
	conversationId: string | null | undefined,
): string | null {
	return useCanonicalSessionsStore((state) =>
		conversationId
			? speechAgentForRow(
					state.sessions.find((row) => row.session_id === conversationId),
				)
			: null,
	);
}
