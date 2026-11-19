/**
 * THE STREAM NEGOTIATION FLAGS THIS APP LAST ANSWERED FOR ITSELF, so the click
 * path can ask for exactly what the pane is about to ask for.
 *
 * WHY THIS MODULE EXISTS, AND WHY IT IS NOT `desktop-api`'s MODULE STATE. A
 * stream subscription negotiates three request flags - `open_frame`,
 * `journal_order` and `peer_journal_source` - and every one of them is the
 * PROJECTION OF ONE ANSWER: the desktop capabilities read (`useDesktopCapabilities`
 * -> `features.*`, through `desktopFeatureEnabled`). The pane derives its flags
 * from that answer in `chat-page.tsx` and nowhere else.
 *
 * The prewarm (`prewarmSessionStream`) has to send the same three flags from the
 * CLICK's task, outside React, before the pane exists. It used to read them off
 * `lastNegotiation` - whatever the previous subscription happened to send - and
 * that is all-`false` until some subscription has already run. So on the FIRST
 * click after app start the prewarm asked for an undeclared stream while the pane
 * asked for a declared one, `takePrewarmedStream` refused (correctly), discarded
 * the connection and opened a second one - the whole benefit of the prewarm,
 * spent, plus a dropped stream nobody consumed. Measured in CI on this PR's own
 * native lane (run 42519743458, `model-uncertainty`): two click-time `/events`
 * attempts, 61 and 69, the first abandoned, and the case's snapshot held by the
 * first connection - `released canonical-sse was dropped/unconsumed`.
 *
 * THE RULE THIS MODULE ENFORCES: the prewarm's flags are the PANE'S flags, so
 * they are recorded from the capabilities answer where that answer ARRIVES
 * (`useDesktopCapabilities`'s query), not read back from an unrelated request.
 * A capability read that never arrived leaves this empty, and the prewarm then
 * asks undeclared - exactly what the pane passes when it has no answer either
 * (`desktopFeatureEnabled(undefined, ...)` is `false`), so the two still agree.
 *
 * WHY A LEAF MODULE. `desktop-hooks.ts` (the producer) imports `desktop-api.ts`
 * (for `desktopResult`), so `desktop-api.ts` cannot import the producer back
 * without a module cycle. This module imports neither and is imported by both,
 * which is the only direction that stays acyclic.
 */

/** The three request flags a session-stream subscription negotiates. */
export type StreamCapabilityFlags = {
	openFrame: boolean;
	journalOrder: boolean;
	peerJournalSource: boolean;
};

let recorded: StreamCapabilityFlags | null = null;

/**
 * Record the flags implied by one capabilities answer.
 *
 * Called ONLY where that answer is produced (see this module's note), so a value
 * read here is an answer this app actually received rather than a guess about
 * what some request once sent. A later answer replaces an earlier one: the read
 * is re-negotiated on an interval precisely because the plane can open, shut or
 * be replaced, and the newest answer is the one the pane will derive from.
 *
 * `null` states that this app holds NO answer - the state before the first
 * capabilities read, and the state a cleared query cache returns to. Recorded as
 * `null` rather than as all-`false` so a reader can tell the two apart, and so a
 * test can isolate a case instead of inheriting the previous one's answer.
 */
export function recordStreamCapabilityFlags(
	flags: StreamCapabilityFlags | null,
): void {
	if (flags === null) {
		recorded = null;
		return;
	}
	recorded = {
		openFrame: flags.openFrame === true,
		journalOrder: flags.journalOrder === true,
		peerJournalSource: flags.peerJournalSource === true,
	};
}

/**
 * Those flags, or `null` when this app has received no capabilities answer yet.
 *
 * `null` rather than all-`false` so a caller can tell "the answer says no" from
 * "there is no answer" - the prewarm treats both as "do not negotiate", but the
 * adoption diagnostic reports which one it was.
 */
export function recordedStreamCapabilityFlags(): StreamCapabilityFlags | null {
	return recorded;
}
