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
 * - `restart-required`: the INSTALL is current and the process serving this app
 *   is running an older build of it. There is nothing to install and there is
 *   nothing to offer, but there is also nothing to affirm: the build the user is
 *   talking to is behind the published release and only a restart of that
 *   process closes the gap. Only the server channel can carry it, because it is
 *   a fact about an install and the process started from it - the app channel has
 *   no such pair.
 * - `unavailable`: the channel could not find out - development mode, an npx
 *   registry fetch with no answer, a fetch or registry failure, a thrown error
 *   (including one the updater filters as a known spurious availability error),
 *   or a server version that could not be read.
 */
export type UpdateChannelStatus =
	| "available"
	| "current"
	| "restart-required"
	| "unavailable";

/**
 * The version strings this app is willing to REASON about.
 *
 * A `current` status is a positive claim - "this channel is not behind" - and a
 * claim is only as good as the readings behind it. `UpdateService.isNewerVersion`
 * is deliberately permissive (it splits on `.` and coerces with `Number`, so a
 * part that is not a number becomes `NaN`, every `NaN` comparison is false, and
 * the pair silently reads as "nothing newer"). That tolerance predates this
 * change and is not this module's to redesign. What it means HERE is that an
 * unreadable string must never reach the comparator on a path that can earn an
 * affirmation: `999.invalid` installed against a published `0.54.43` compared
 * as not-newer and the whole check affirmed that the installation was up to
 * date, which is the same defect class as the reported one - a surface treating
 * "we could not find out" as an answer.
 *
 * So the grammar is asserted BEFORE the comparison, and an unreadable reading
 * becomes `unavailable` rather than a status.
 *
 * What it accepts, derived from what this product actually publishes rather
 * than from a `semver` reading of the spec: one to four numeric dot parts (the
 * backend has published four-part releases, and the launchd rule in
 * `update-install` compares them), an optional `v` prefix (the release tags are
 * `v0.22.3`), and an optional pre-release/build tail - either PEP 440's
 * no-separator forms (`0.1.3b0`, `1.0.0.post1`) or the hyphen/plus forms
 * (`0.1.0-beta.1`, `0.0.0-test`), because the server channel's versions come
 * from PyPI and the app channel's from npm. Verified against every version ever
 * published for `local-operator` on PyPI and `local-operator-ui` on npm: 558 of
 * 558 accepted, so no legitimate past release is reclassified as unreadable.
 *
 * A module-scope literal rather than one built per call, which Biome's
 * `useTopLevelRegex` asks for and which keeps the compiled pattern single.
 */
export const READABLE_VERSION_PATTERN =
	/^v?\d+(\.\d+){0,3}([.-]?(?:a|b|c|rc|alpha|beta|pre|post|dev)[.-]?\d*)?(?:[-+][0-9A-Za-z.-]+)?$/i;

/**
 * Whether a reported version can be compared at all.
 *
 * `null`/`undefined`/`""` are "we did not get a reading" - the same answer as a
 * malformed one, and the caller turns both into `unavailable`. Surrounding
 * whitespace is trimmed, matching `isNewerVersion`'s own normalisation, so a
 * padded health payload is still a reading.
 */
export const isReadableVersion = (value: string | null | undefined): boolean =>
	typeof value === "string" && READABLE_VERSION_PATTERN.test(value.trim());

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
 * offer, `restart-required` means the server actually serving this app is behind
 * the install on disk (a restart picks it up, and the sentence would be a claim
 * about a build the reader is not talking to), and `unavailable` means nobody
 * asked the question.
 */
export const updateCheckAffirmation = (channels: {
	app: UpdateChannelStatus;
	server: UpdateChannelStatus;
}): string | null =>
	channels.app === "current" && channels.server === "current"
		? UP_TO_DATE_AFFIRMATION
		: null;

/**
 * What the SERVER channel decides from.
 *
 * Three readings rather than one, because the defect this rule closes was a
 * check that compared the wrong one. `/health` reports the version of the
 * PROCESS that answered and the install root it was started from (`prefix`, and
 * `install_kind` beside it); the version ON DISK at that root is what an update
 * would move. A check that reads the install the app happens to be attached to
 * by name - the global `local-operator` on `PATH` - can therefore compare a
 * current install against PyPI while a different install, three releases behind,
 * is the one serving the user. That is the reported defect: "Install on disk
 * reports: 0.56.11, running backend reports: 0.56.8, Latest: 0.56.11, Update
 * needed: false" on a machine whose Settings row read 0.56.8.
 *
 * So the subject is the SERVING install: `installVersion` is read from the
 * dist-info at the root the running server reported, and `runningVersion` is the
 * process's own reading of the same install. When the install's own metadata
 * cannot be read, the running reading is the subject instead - it is a reading of
 * the same tree (the process executes the code in that prefix) and it can only
 * be the install's version or older than it, never newer.
 */
export type ServerChannelReadings = {
	/** The version the install serving this app reports on disk, or null. */
	installVersion: string | null;
	/** The version the running server reports on `/health`, or null. */
	runningVersion: string | null;
	/** The published release, or null when it could not be read. */
	publishedVersion: string | null;
	/**
	 * Whether `candidate` is a newer release than `subject`.
	 *
	 * Supplied by the caller rather than re-implemented here, deliberately: the
	 * app has ONE version comparator for its update decisions
	 * (`UpdateService.isNewerVersion`), it is deliberately permissive - it tolerates
	 * the four-part releases the backend has published - and a second ordering
	 * written into this module would be a second answer to "which of these two is
	 * newer" that the app channel never consults.
	 */
	isNewer: (candidate: string, subject: string) => boolean;
};

/**
 * Which of the four states the server channel is in.
 *
 * The status is the verdict; this is the reading it was earned from, and it is
 * what the panel's copy is chosen by. `install-behind` is the only state that may
 * carry an offer, `restart-required` is the only one that carries neither an
 * offer nor an affirmation, and `unreadable` is the one that must never be
 * reported as either.
 */
export type ServerChannelState =
	| "install-behind"
	| "restart-required"
	| "current"
	| "unreadable";

export type ServerChannelVerdict = {
	status: UpdateChannelStatus;
	state: ServerChannelState;
};

/** A reading, trimmed, or null when there is nothing to compare. */
const readable = (value: string | null | undefined): string | null =>
	isReadableVersion(value) ? (value as string).trim() : null;

/**
 * What the server channel may conclude from the readings, and nothing more.
 *
 * Four states, and the order they are decided in is the rule:
 *
 * 1. **unreadable** - the published release or the running server could not be
 *    read. "We could not find out" is not "current", which is the misreading
 *    this module's own history is about (see `UP_TO_DATE_AFFIRMATION`), and it is
 *    not an offer either: a version nobody can read is not one to move to.
 * 2. **install-behind** - the install serving this app is older than the
 *    published release. This is the one state that earns an offer, and the
 *    subject is the serving install rather than whichever install the app could
 *    name.
 * 3. **restart-required** - the install is current and the process serving this
 *    app runs an older build of it. Nothing to install, nothing to offer, and
 *    nothing to affirm: the build the reader is talking to trails the published
 *    release until that process restarts, and an "up to date" sentence here is
 *    the exact contradiction the reported defect produced - a panel that affirms
 *    a server version its own row contradicts.
 * 4. **current** - both readings say the published release, positively read.
 */
export const serverChannelVerdict = ({
	installVersion,
	runningVersion,
	publishedVersion,
	isNewer,
}: ServerChannelReadings): ServerChannelVerdict => {
	const published = readable(publishedVersion);
	const running = readable(runningVersion);
	if (!published || !running)
		return { status: "unavailable", state: "unreadable" };

	const install = readable(installVersion);
	/* The install on disk is the subject; the running reading stands in for it
	 * only when its own metadata could not be read. */
	const subject = install ?? running;
	if (isNewer(published, subject))
		return { status: "available", state: "install-behind" };

	if (install && install !== running && isNewer(install, running))
		return { status: "restart-required", state: "restart-required" };

	return { status: "current", state: "current" };
};

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
