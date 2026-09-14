/**
 * What one whole update check is allowed to say.
 *
 * The defect this exists to remove: a check that runs the app channel and the
 * server channel independently let each channel speak for the whole. The two
 * affirmations ("You are up to date", "The server is up to date") were rendered
 * by whichever renderer event arrived last, so a user whose server trailed
 * their app - the operator's report, application 0.22.1 against server 0.54.43
 * with 0.54.44 published - got the "Server update available" panel and "You are
 * up to date" in the same turn.
 *
 * The rule: an "up to date" sentence is a statement about the WHOLE check, so
 * it may only be earned by a check that positively proved it on BOTH channels.
 * It is never earned by a channel that had an update to offer, and never by a
 * channel that could not find out - "we could not find out" is not an answer,
 * and the whole `unavailable` status below is that third value made explicit
 * rather than folded into "current".
 *
 * Pure by construction: no electron import, so the main-process graph, the
 * preload/renderer types and `scripts/*.test.mjs` can all reach the rule
 * without an Electron fixture standing between them and the decision.
 */

/**
 * What one channel's check found out.
 *
 * - `available`: the channel found a newer release than the one running.
 * - `current`: the channel positively found nothing newer.
 * - `unavailable`: the channel could not find out - development mode, an npx
 *   registry fetch with no answer, a fetch or registry failure, a thrown error
 *   (including one the updater filters as a known spurious availability error),
 *   or a server version that could not be read.
 */
export type UpdateChannelStatus = "available" | "current" | "unavailable";

export type UpdateCheckVerdict = {
	app: UpdateChannelStatus;
	server: UpdateChannelStatus;
	/**
	 * The one sentence the whole check earns, or null when it earns none.
	 *
	 * Null is the ordinary case, not a failure: a check that found an update
	 * has nothing to affirm, and neither has one that could not find out.
	 */
	affirmation: string | null;
};

/**
 * The single sentence both channels being current earns.
 *
 * One sentence rather than one per channel, because the reader's question is
 * about their installation and the app's two halves are not separately
 * meaningful to them: "the app is up to date" while the server is behind is
 * exactly the contradiction this file exists to prevent.
 */
export const UP_TO_DATE_AFFIRMATION =
	"The application and server are up to date";

/**
 * The affirmation a pair of channel statuses earns, or null.
 *
 * Both channels must be `current`: `available` means there is something to
 * offer, and `unavailable` means nobody asked the question.
 */
export const updateCheckAffirmation = (channels: {
	app: UpdateChannelStatus;
	server: UpdateChannelStatus;
}): string | null =>
	channels.app === "current" && channels.server === "current"
		? UP_TO_DATE_AFFIRMATION
		: null;

/**
 * A verdict from the two channel statuses.
 *
 * The affirmation is derived here rather than passed in, so no caller can
 * hold a verdict whose sentence disagrees with its own statuses.
 */
export const updateCheckVerdict = (channels: {
	app: UpdateChannelStatus;
	server: UpdateChannelStatus;
}): UpdateCheckVerdict => ({
	app: channels.app,
	server: channels.server,
	affirmation: updateCheckAffirmation(channels),
});
