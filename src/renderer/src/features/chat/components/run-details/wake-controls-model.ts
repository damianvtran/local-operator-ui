/**
 * The Wakes section's control model: which rows may be cancelled, which ask
 * first, and which are not this app's to stop.
 *
 * Pure by construction, like `monitor-controls-model.ts` and for its reason: a
 * verification surface has to be able to CONSTRUCT the policy rather than
 * approximate it, and a module with no React in its graph is what
 * `node --test` can bundle and drive. The pane's rows, the confirm popover and
 * the Schedules page's wake lines all read their verdict from here, so the
 * three surfaces cannot come to disagree about a row the way two spellings of
 * one rule do.
 *
 * ## The three verdicts, and why a wake needed a third
 *
 * Monitors have two states (cancel behind a confirmation, or a refusal); wakes
 * need three, because one family of rows is NOT the operator's to cancel:
 *
 * - **`managed`** — an `aida-*` row. The chief of staff's engine
 *   (`local_operator/aida/proactive.py`) is the one RE-ARMER of these rows and
 *   the only code that drops them, so a cancel the app offers would be undone
 *   by the next reconcile (and today it is refused with a 422 before any
 *   handler, because the desktop route's `WakeId` pattern is `^w\d{1,4}$` —
 *   an ACCIDENT of the id regex rather than a rule, which is exactly why the
 *   UI does not lean on it). The row shows the managed state and sends
 *   NOTHING. The supported way to stop these is `/aida pause` (`aida.control`),
 *   which the managed sentence names.
 * - **`confirm`** — a row on the chief of staff's own conversation: anything
 *   armed there is plausibly the operator's check-in, and those must not be
 *   droppable by one stray click. This is the fail-closed arm as much as the
 *   identity arm (see below).
 * - **`one-click`** — every other row. The operator asked for one press, with
 *   the monitors' placement, at-rest visibility and row states; the monitor
 *   confirmation was a modal and stays one, so the deviation is deliberate and
 *   is stated in the pull request.
 *
 * ## Why the identity arms are shaped the way they are
 *
 * `aida.status` is a NETWORK read (`session_id` is null until she is first
 * ensured), so a guard that waited on it would be absent exactly while it
 * mattered. The three arms are ordered from the fact that needs no read to the
 * one that needs nothing at all:
 *
 * 1. the id prefix — synchronous, session-independent, always true of an
 *    `aida-*` row;
 * 2. the session being HERS (`sessionId === aida.status.session_id`), when the
 *    read has resolved with a session;
 * 3. any `aida-*` row present in the session's own list — the list is the
 *    pane's payload, so a session carrying engine rows is treated as hers even
 *    when the status read has not answered;
 * 4. FAIL CLOSED: the `aida` capability is enabled but the status read is
 *    unresolved or errored. An unknown identity must not be an unguarded
 *    cancel, and the copy for this arm stays NEUTRAL rather than naming her —
 *    see `wakeConfirmNamesChief`.
 *
 * Arm 4 costs one extra confirmation on every session while the status read is
 * in flight; the read is cached (`staleTime` 30 s) and shared with the sidebar,
 * so in practice it has resolved long before a pane is open. The cost is
 * stated rather than hidden: the alternative is a guard that is missing exactly
 * when the answer is unknown.
 */

/**
 * The ownership prefix of the engine's rows, mirroring
 * `local_operator/aida/proactive.py`'s `ROW_PREFIX` ("aida-"; `is_aida_row` is
 * its one reader there). Rows under it: `aida-cadence` (the daily cadence),
 * `aida-extra-N` (escalation one-shots), `aida-greeting`, `aida-trigger-*`.
 */
export const MANAGED_WAKE_PREFIX = "aida-";

/** Whether an id names a row the engine owns (arm 1; the id-only test). */
export const isManagedWakeId = (wakeId: string): boolean =>
	wakeId.startsWith(MANAGED_WAKE_PREFIX);

/**
 * What the pane and the page know about the chief of staff when they classify a
 * row.
 *
 * A plain prop rather than a hook call, for the monitors' `ChatColumn` reason:
 * the stories inject identity instead of needing providers, and the surfaces
 * stay presentational about a fact the page owns.
 */
export type AidaWakeIdentity = {
	/** `desktopFeatureEnabled(capabilities, "aida", 1)`. */
	capability: boolean;
	/**
	 * Whether `aida.status` has RESOLVED (`isSuccess`). A pending read, an
	 * errored read and a disabled query all read `false` here — the three are
	 * indistinguishable to a guard and all mean "the identity is unknown".
	 */
	statusResolved: boolean;
	/** `aida.status`'s `session_id`, or null when she has none / it is unknown. */
	sessionId: string | null;
	/** The name she is shown under (`useAidaDisplayName`'s answer). */
	name: string;
};

/**
 * A row's identity for everything that has to remember it ACROSS a write.
 *
 * The handle alone is not one: the backend mints the lowest free id, so
 * cancelling `w1` and arming again re-uses `w1` for a DIFFERENT schedule
 * (measured: agent review round 1's F2 / QA round 1's Q1 - the new row rendered
 * `Cancelled` and could not be cancelled). `created_at` is the wire's own
 * discriminator; `?` is the fallback for a payload that did not carry one, and
 * it is deliberately the value that still matches only itself rather than
 * something that could be mistaken for a real instant.
 */
export const wakeRowKey = (row: {
	id: string;
	createdAt: number | null;
}): string => `${row.id}:${row.createdAt ?? "?"}`;

export const WAKE_CONTROL_MODES = ["managed", "confirm", "one-click"] as const;

/** What a row's control column offers. */
export type WakeControlMode = (typeof WAKE_CONTROL_MODES)[number];

/** Everything the classification reads, so one call decides one row. */
export type WakeControlContext = {
	/** The conversation whose wakes are being rendered, or null. */
	sessionId: string | null;
	/** The ids in THIS session's wake list (the pane's or a page row's). */
	wakeIds: readonly string[];
	aida: AidaWakeIdentity;
};

/**
 * Whether the conversation is known to be HERS (arm 2), which is also the only
 * thing that may put her name on a confirmation (`wakeConfirmNamesChief`).
 *
 * Both sides of the comparison must be real ids: a null session (a legacy chat,
 * or a pane with no canonical session yet) is not "equal" to a null hers.
 */
export const sessionIsChiefOfStaff = (
	sessionId: string | null,
	aida: AidaWakeIdentity,
): boolean =>
	sessionId !== null && aida.sessionId !== null && sessionId === aida.sessionId;

/**
 * The verdict for one row.
 *
 * The order is the arms' own (see the header): managed by id, then hers by
 * resolved identity, then hers by the rows she leaves in the list, then the
 * fail-closed arm, then one-click.
 */
export const wakeControlMode = (
	wakeId: string,
	context: WakeControlContext,
): WakeControlMode => {
	if (isManagedWakeId(wakeId)) return "managed";
	if (sessionIsChiefOfStaff(context.sessionId, context.aida)) return "confirm";
	if (context.wakeIds.some(isManagedWakeId)) return "confirm";
	if (context.aida.capability && !context.aida.statusResolved) return "confirm";
	return "one-click";
};

/**
 * Whether a confirmation on this conversation may NAME the chief of staff.
 *
 * Only arm 2 may: the resolved identity is the one fact that says the wake is
 * hers. The session-carries-a-managed-row arm and the fail-closed arm both
 * confirm without claiming anything — "Cancel this wake?" rather than a name
 * the app cannot stand behind, because a sentence that names her over a
 * conversation that is not hers is a false claim, and the whole point of the
 * guard is that it never misplaces her.
 */
export const wakeConfirmNamesChief = (context: WakeControlContext): boolean =>
	sessionIsChiefOfStaff(context.sessionId, context.aida);

/** The quiet state word in a managed row's control column. */
export const managedWakeShortLabel = (name: string): string =>
	`managed by ${name}`;

/**
 * The managed row's sentence: why there is no cancel, and the lever that works.
 *
 * It names `/aida pause` (the `aida.control` route) rather than the cancel that
 * does not exist here: the row is not offering an action, it is explaining why
 * it has none. The name is the operator's own (`useAidaDisplayName`) and the
 * sentence carries NO pronoun and no internal vocabulary — design round 1's D6:
 * `her engine re-arms it` was reading a configurable assistant as fixed-gender
 * and borrowing the code's word for a row the reader is deciding about. The
 * sentence is rendered VISIBLY as the row's note (D2), with the same string on
 * the state's `title`, so there is one copy in two places rather than two.
 */
export const managedWakeNote = (name: string): string =>
	`This wake is ${name}'s own schedule, so it can't be cancelled here. To stop these check-ins, use /aida pause.`;

/**
 * The confirmation's three strings, ONE home for both surfaces that ask.
 *
 * The pane's popover and the Schedules page's modal put the same question in
 * different containers (a small card at the row, a dialog over the page) and
 * must not come to spell it two ways (`docs/composer-wakes.md` section 3's rule,
 * one object one words). `named` is `wakeConfirmNamesChief`'s answer — the only
 * thing that may put her name on the question — and `head` is the wake's own
 * prompt head, which is what "this" points at.
 */
export const wakeConfirmTitle = (named: boolean, name: string): string =>
	named ? `Cancel ${name}'s check-in?` : "Cancel this wake?";

export const wakeConfirmSentence = ({
	named,
	name,
	head,
}: {
	named: boolean;
	name: string;
	/** The wake's prompt head; empty for a message-less schedule. */
	head: string;
}): string => {
	const subject = head ? `“${head}”` : "This wake";
	return named
		? `${subject} will not fire again, and nothing re-creates it. ${name}'s own cadence is unaffected.`
		: `${subject} will not fire again, and nothing re-creates it. The conversation stays.`;
};

export const wakeConfirmActionLabel = (named: boolean): string =>
	named ? "Cancel check-in" : "Cancel wake";

/** What a cancel answered: applied, or the sentence to render where it was asked. */
export type WakeCancelOutcome = { ok: true } | { ok: false; detail: string };

/** What the section needs to offer the cancel (the monitors' shape, one list over). */
export type WakeControls = {
	/**
	 * Cancel one wake by its handle (`w1`..). Resolves the outcome rather than
	 * throwing, because a refusal is a rendered state on this surface (see
	 * `use-wake-controls.ts`).
	 */
	cancel: (wakeId: string) => Promise<WakeCancelOutcome>;
};

/**
 * One attempt's lifecycle, out of React for the monitor family's reason: the
 * property under test is "the conversation's canonical snapshot is re-read
 * EITHER WAY", and that is a promise's `finally`, not a component.
 *
 * Why the resync is not success-only. The monitors' write learned it the hard
 * way (`use-monitor-controls.ts`): a refusal can be the face of a write that
 * LANDED — a retried cancel whose first attempt was answered and whose response
 * was lost gets the honest "no wake with id" about a schedule that is already
 * gone — while a refusal that changed nothing is reconciled by the same re-read
 * at no cost. Without it, a lost response leaves the pane showing a wake the
 * store no longer holds until some later canonical push happens to arrive.
 *
 * And why this is not `useCancelWake`'s `onSuccess` (the Schedules page's
 * hook): that hook converges only a landed write, and widening it would change
 * the PAGE's behaviour from the pane's change — the one thing this lane must
 * not do. The page keeps its hook; the pane's own `use-wake-controls.ts` owns
 * the either-way convergence for its own writes.
 */
export const attemptWakeCancel = async ({
	run,
	describe,
	resync,
}: {
	/** The write itself; rejects on a refusal. */
	run: () => Promise<unknown>;
	/** The refusal's sentence, from `userFacingMessage` and the caller's fallback. */
	describe: (error: unknown) => string;
	/** Re-read the conversation's canonical snapshot. Called on BOTH paths. */
	resync: () => void;
}): Promise<WakeCancelOutcome> => {
	try {
		await run();
		return { ok: true };
	} catch (error) {
		return { ok: false, detail: describe(error) };
	} finally {
		resync();
	}
};
