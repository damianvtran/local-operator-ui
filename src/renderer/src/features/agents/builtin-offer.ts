/**
 * The built-ins offer's signature, and the read side of a persisted dismissal.
 *
 * WHY THIS IS A MODULE RATHER THAN TWO CALL-SITE EXPRESSIONS. The signature is
 * the storage FORMAT of the dismissal, and two places have to agree on it
 * forever: the write (the chat sidebar's dismiss control) and the read (does
 * the offer show?). Spelling it once is the same reason `install-builtin-batch.ts`
 * exists next door — the rule a later reader or a behavioural test holds lives
 * outside the component that happens to call it first.
 *
 * THE SIGNATURE IS THE SORTED NAMES, NOT A COUNT AND NOT A BOOLEAN. A count
 * would re-arm on an install made somewhere else (the set narrowed without the
 * offer changing its claim); a boolean would stay dismissed through a catalogue
 * that gained a NEW built-in — the one arrival this offer exists to announce.
 * Sorted because the catalogue's order is the backend's business: the same
 * names arriving in a different order are the same offer and must not re-arm
 * the block. Joined with a newline, which no profile name carries, so two
 * different name lists cannot collide into one signature the way a plain
 * concatenation could ("ab"+"c" and "a"+"bc" are one string).
 */

/**
 * The signature of one built-ins offer: the names on offer, sorted, one per line.
 */
export const builtinOfferSignature = (
	builtins: readonly { name: string }[],
): string =>
	builtins
		.map((builtin) => builtin.name)
		.sort()
		.join("\n");

/**
 * Whether the reader has dismissed THIS offer.
 *
 * DISMISSING IS A STATEMENT ABOUT THE CURRENT STATE, and the key says so:
 * `chat-status.ts` states the precedent for the connection strip's pill (a
 * dismissal is "keyed on the state the reader dismissed rather than on a
 * boolean they set once"), and this follows it — a catalogue that GAINS a
 * built-in is a different offer, so the block returns and the arrival is
 * announced, while the same catalogue stays dismissed across restarts, which
 * is exactly what persists.
 *
 * The read side validates as it decides: the stored value arrives from
 * `localStorage`, which is not a setter's path out (zustand's persist
 * rehydrates PAST the setters), so a tampered or hand-edited value is rejected
 * HERE rather than trusted from the store's type — the job `parseSidebarView`
 * does one field over, folded into the comparison because a signature is a
 * plain string and the only question asked of it is equality with the offer on
 * screen. The empty-signature guard is the degenerate case of the same rule:
 * with nothing on offer there is no state to have dismissed, so a
 * default-stored `""` must not read as a dismissal of an empty catalogue.
 */
export const builtinOfferDismissed = (
	stored: unknown,
	signature: string,
): boolean =>
	typeof stored === "string" && signature.length > 0 && stored === signature;
