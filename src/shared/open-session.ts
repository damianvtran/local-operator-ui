/**
 * `--open-session <id>`: the launch argument that names a conversation to show.
 *
 * WHY IT EXISTS. `lop resume-click`'s third rung launches the desktop app when
 * it is not running, and the whole point of that rung is that the user lands on
 * the conversation the banner was about rather than on whatever they last read.
 * The id therefore has to survive two hops: the click's argv into the app's
 * process (first-run launch), and a second launch's `commandLine` into the app
 * that already owns the single-instance lock. Both are argv, so one parser
 * serves both.
 *
 * IT IS ALSO READ BY PRELOAD, for the second reason this module exists: the
 * initial conversation has to be known BEFORE the renderer's first paint. A
 * recreated window rehydrates its persisted `activeSessionId` and paints THAT
 * conversation first, so delivering this id as a post-load IPC showed the user
 * the wrong conversation and then swapped it — which reads as a click that
 * landed on the wrong row (B3). Main passes it through
 * `webPreferences.additionalArguments`, which puts it in the renderer process's
 * own argv where preload can read it synchronously.
 *
 * Both spellings are accepted (`--open-session=<id>` and `--open-session <id>`)
 * because the two producers write different ones: the backend's launch command
 * and macOS's `open --args` both pass a separated pair, while
 * `additionalArguments` is simplest as a single token. Accepting one and
 * producing the other is how a flag silently becomes a no-op.
 */

/** The flag name, spelled once for the producers and the readers. */
export const OPEN_SESSION_FLAG = "--open-session";

/**
 * `--open-catalogue`: the launch argument that means "the LIST, not a
 * conversation".
 *
 * WHY IT IS A THIRD INTENT AND NOT A SPELLING OF THE OTHER TWO (review round 2,
 * R2-1). A burst digest's click names several conversations, so the window it
 * recreates must open on the catalogue rather than on one of them. Main already
 * models that as `null`, and the EXISTING-window path sends exactly that. The
 * CREATE path had no way to say it: with no argv flag, `null` is also what an
 * ordinary launch looks like, and the renderer's rule for that case is "restore
 * the conversation you last had open". One value, two intents, so a windowless
 * digest click restored whatever was last read instead of listing the
 * conversations the banner was about.
 *
 * An empty `--open-session=` would have been a fourth spelling whose meaning the
 * parser has to decide, and the parser is the last place that decision belongs.
 */
export const OPEN_CATALOGUE_FLAG = "--open-catalogue";

/**
 * What a process's argv asks its window to open.
 *
 * The THREE intents as one type, because the defect this exists to prevent was
 * two of them sharing a value. Every reader — main at module load, preload, and
 * the renderer's hydration rule — resolves argv through :func:`readLaunchTarget`
 * rather than re-deriving the precedence, so "what was this window asked for"
 * has one answer instead of three that can disagree.
 */
export type LaunchTarget =
	| { kind: "restore" }
	| { kind: "session"; sessionId: string }
	| { kind: "catalogue" };

/**
 * A canonical session id.
 *
 * Validated HERE rather than at the far side, because an id from a process's
 * argv is the least trusted string this app handles: it reaches the renderer's
 * navigation and the backend's route, and a malformed one would either be a
 * confusing 404 or, worse, address something that is not a conversation. An
 * invalid value is treated as absent, so a bad launch degrades to "open the
 * app" rather than to a broken start.
 */
const SESSION_ID = /^[a-f0-9]{12}$/;

/**
 * The conversation this argument vector asks for, or null.
 *
 * The LAST occurrence wins, matching the convention every other flag in this
 * app follows: a later argument is a more recent intent, and a launcher that
 * appends rather than replaces must not be overruled by an earlier default.
 */
export function readOpenSessionArgv(argv: readonly string[]): string | null {
	let found: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === OPEN_SESSION_FLAG) {
			const next = argv[index + 1];
			if (next !== undefined) found = next;
			continue;
		}
		if (argument.startsWith(`${OPEN_SESSION_FLAG}=`)) {
			found = argument.slice(OPEN_SESSION_FLAG.length + 1);
		}
	}
	return found !== null && SESSION_ID.test(found) ? found : null;
}

/**
 * What this argument vector asks for, precedence included.
 *
 * A NAMED CONVERSATION OUTRANKS THE CATALOGUE, deliberately: naming one is the
 * more specific instruction, so a launcher passing both is asking to land on
 * that conversation rather than on the list. Main never sets both — this is the
 * rule for a call that got it wrong, and it fails toward the destination the
 * user can act on rather than toward an empty pane.
 *
 * An id that does not validate counts as ABSENT (see
 * :func:`readOpenSessionArgv`), so a bad launch that also carries a catalogue
 * flag degrades to the catalogue rather than to a broken start.
 */
export function readLaunchTarget(argv: readonly string[]): LaunchTarget {
	const sessionId = readOpenSessionArgv(argv);
	if (sessionId) return { kind: "session", sessionId };
	if (argv.includes(OPEN_CATALOGUE_FLAG)) return { kind: "catalogue" };
	return { kind: "restore" };
}
