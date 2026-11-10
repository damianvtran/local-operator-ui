import {
	type CanonicalSessionRow,
	unreadAckableCount,
	unreadAckableRows,
	unreadMarkKind,
} from "@shared/store/canonical-sessions-store";
import { t } from "../../../../i18n";

/*
 * The decisions behind the sidebar's bulk read receipt, kept out of the
 * component for the reason the panel's other decisions are (`chat-search.ts`,
 * `sidebar-catalogue-gate.ts`): a JSX condition and a template literal are not
 * things a test can drive, and both of these have to be exactly right rather
 * than approximately right.
 *
 * The receipt copy in particular is the honest half of the feature. The backend
 * answers a bulk acknowledgement per item, and only the `read` bucket means a
 * mark actually moved; a sentence that said "all done" over a batch the store
 * partly refused would put a cleared mark in the operator's head that is still
 * unread on screen. The no-silent-partial-success rule, at the one surface that
 * renders it.
 */

/*
 * The predicates are RE-EXPORTED, not re-spelled: the store's `markAllRead`
 * enumerates through the same function the control counts with, so the label's
 * number is the set the request will carry by construction rather than by
 * convention (agent review round 1, R1). `unreadMarkKind` is re-exported beside
 * them for the same reason in the other direction: it is the one decision about
 * what a row is DRAWING, so the glyph, the accessible name, the tooltip and the
 * count cannot disagree about it either.
 */
export { unreadAckableCount, unreadAckableRows, unreadMarkKind };

/**
 * Everything the control says, derived from the rows it would clear.
 *
 * THE EXTENT IS STATED BEFORE THE CLICK, and this is where that is decided. The
 * gesture is catalogue-wide (the enumeration rule is deliberately the store's,
 * not the rendered list's, so a filter cannot make the number disagree with the
 * outcome), and an acknowledgement cannot be withdrawn — so the number the
 * request will carry belongs in the control's own words, not only in a tooltip
 * (UX round 1, U1; design D3), and the rows it reaches OUTSIDE the section the
 * control is drawn in are named too.
 *
 * `elsewhere` counts the ackable rows the catalogue does not class `active`. They carry no
 * heading of their own (the sections are Running / Today / This week / Older, by time, and
 * "Previous chats" no longer exists: `scripts/renderer-driver.mjs` notes it), so the copy names
 * them by that class and not by a section. The
 * control sits on the first section that has rows, so those rows are the ones a
 * reader may not have on screen at all — the case the operator's own report does not
 * cover and the one that makes the extent worth a sentence.
 */
export type MarkAllReadCopy = {
	count: number;
	/** The visible label: the number IS the set the request will send. */
	label: string;
	/**
	 * The tooltip. States the full scope, and the one limit a reader cannot
	 * otherwise see: marks with no completion token name no completion and are not
	 * sent, so they would keep their check with nothing on screen explaining it
	 * (design N5).
	 */
	scope: string;
	/**
	 * The accessible name's tail — the rows this control reaches outside its own
	 * section. Empty when there are none, so the ordinary case adds no words.
	 */
	nameSuffix: string;
};

export const markAllReadCopy = (
	rows: CanonicalSessionRow[],
): MarkAllReadCopy => {
	const ackable = unreadAckableRows(rows);
	const count = ackable.length;
	const elsewhere = ackable.filter((row) => !row.active).length;
	/*
	 * A mark the batch cannot name: a DRAWN mark with no token, which is what the
	 * batch request has nothing to send for. Named only when one exists, because
	 * the clause is noise in the ordinary case and the invariant it protects is
	 * that the label's number is the whole set the click sends.
	 *
	 * DERIVED from the shared predicates rather than re-spelling their complements
	 * (review R2-5): `unseen && !completion_token` was that complement, but the two
	 * would drift the moment `unreadAckableRows` tightens — a `kind ===
	 * "complete"` filter, say — and the row would then be counted in both buckets,
	 * which is the same two-literals class round 1 removed from the count above.
	 *
	 * The mark half is `unreadMarkKind` and not bare `unseen`, so this clause names
	 * exactly the rows a reader can SEE a mark on that no click can clear. Under
	 * bare `unseen` it also named rows drawing a spinner or a gate — the same
	 * over-count the control's own label was fixed for — and a sentence promising
	 * an uncleared mark on a row with no mark is the opposite of the honesty this
	 * sentence exists for.
	 */
	const tokenless = rows.filter(
		(row) =>
			unreadMarkKind(row) !== null && unreadAckableRows([row]).length === 0,
	).length;
	/*
	 * Each clause is a SENTENCE that carries its own full stop, and the two are joined
	 * by a space. The previous shape put the terminator in the `elsewhere` arm and
	 * began the tokenless arm with a space, so with BOTH clauses present two sentences
	 * ran together — "…that is not active 1 unread mark with no completion token cannot
	 * be cleared." — and neither clause's own test could see it, because each was
	 * asserted on a roster where only it fired (design D5 / QA Q-1; measured, and the
	 * base renders the same run-on). The comma keeps the first clause inside the
	 * sentence it extends, so the four cases are: neither clause, `elsewhere` alone,
	 * `tokenless` alone, and both.
	 */
	/*
	 * Every sentence is a CATALOGUE message with its own plural and its own full
	 * stop, and the join between two of them is a message too (`scope_joined`): a
	 * template literal here was English in every locale, and so was a hardcoded
	 * space, which is not the separator every script uses. `elsewhere > 0` only
	 * CHOOSES which message speaks; no English fragment is composed in code.
	 */
	const chats =
		elsewhere > 0
			? t("ui.chat.sidebar.mark_all_read.scope_chats_elsewhere", {
					count,
					elsewhere,
				})
			: t("ui.chat.sidebar.mark_all_read.scope_chats", { count });
	return {
		count,
		// Read at call time: the sidebar calls `markAllReadCopy` in its render and
		// subscribes to the locale, so the label follows the language picker.
		label: t("ui.chat.sidebar.mark_all_read.label", { count }),
		scope:
			tokenless > 0
				? t("ui.chat.sidebar.mark_all_read.scope_joined", {
						chats,
						tokenless: t("ui.chat.sidebar.mark_all_read.scope_tokenless", {
							count: tokenless,
						}),
					})
				: chats,
		nameSuffix:
			elsewhere > 0
				? t("ui.chat.sidebar.mark_all_read.name_suffix_elsewhere", {
						elsewhere,
					})
				: "",
	};
};

/*
 * WHERE THE LABEL STOPS FITTING, as the width of the section-heading row's
 * CONTENT BOX (the container the shed class queries), chosen from the label
 * actually drawn.
 *
 * WHY IT DEPENDS ON THE LABEL. One fixed break cannot protect two things at once:
 * English ("Mark all 12 read") must stay spelled at the default sidebar width,
 * while a longer translation ("Tout marquer comme lu (12)", "Đánh dấu tất cả 12
 * đã đọc") takes 50-60px more from the section name next to it, which is the
 * `min-w-0 flex-1 truncate` element and so absorbs whatever the unshrinkable
 * action leaves. Rendered at the 220px floor, both of those languages lost the
 * name entirely. Container conditions cannot read a custom property, so the
 * width is picked here from a fixed ladder of literal classes in the component.
 *
 * THE ARITHMETIC, every figure measured from the 220px Storybook frame rather
 * than guessed:
 *   - the action is the 14px glyph + 4px gap + the text + 8px padding each side,
 *     so 34px + text; the 12px system text measured 5.6px per character
 *     ("Mark all 1 read": 15 chars, 84px; fr "Tout marquer comme lu (1)": 25
 *     chars, 137px), and 5.7 is used to stay on the safe side;
 *   - the name keeps 70px, the width of the widest English section name
 *     ("This week", set in capitals with tracking), plus the row's 4px gap;
 *   - so a label of N characters needs 108 + 5.7 * N, rounded UP to the next
 *     step of the ladder below (the steps exist because the classes must be
 *     literal strings for the stylesheet to contain them).
 * The row's content box is the panel minus 56px (text starts at x=20, the
 * action's right edge is x=184 at a 220px panel). The sidebar runs 220-320 with
 * 260 as the default (`chat-sidebar-layout.ts`), so: every label sheds at the
 * floor (content 164), English including a two-digit count stays spelled at the
 * default (content 204). A label is spelled from a panel of its class plus 56px,
 * derived from the ladder constants: a two-digit French label (26 characters,
 * 256.2 needed) rounds up to the 268 class, so it needs a panel of at least 324,
 * ABOVE the 320 maximum. The same holds for fr, es, hi and ur at any count and for
 * vi and ru with a two-digit count; only vi and ru with one digit (24 characters,
 * 244.8 needed, class 245) are spelled, from a 301px panel. en and zh-CN (class
 * 200) are spelled from 256px. The control is therefore glyph-only at every
 * supported width in fr, es, hi and ur, which is the honest price of not starving the section name: the glyph, the `sr-only`
 * label and the tooltip carry the meaning.
 *
 * NOT GUARANTEED: a LONG section name in a long-label language ("Plus
 * anciennes") can still truncate when the label is spelled, because the name's
 * width depends on the language as well. The ladder protects the name's
 * 70px, not every name.
 */
export const MARK_ALL_READ_SHED_STEPS = [200, 223, 245, 268, 291] as const;
export type MarkAllReadShedWidth = (typeof MARK_ALL_READ_SHED_STEPS)[number];
export const markAllReadShedWidth = (label: string): MarkAllReadShedWidth => {
	const need = 108 + 5.7 * [...label].length;
	return (
		MARK_ALL_READ_SHED_STEPS.find((step) => step >= need) ??
		MARK_ALL_READ_SHED_STEPS[MARK_ALL_READ_SHED_STEPS.length - 1]
	);
};

/** The verdict `markAllRead` resolves with, as the surface reads it. */
export type MarkAllReadReceipt = {
	attempted: number;
	cleared: number;
	superseded: number;
	unknown: number;
	/**
	 * The subset of `unknown` this client knows lives on another device
	 * (`canonical-sessions-store`'s `remoteOwnedIds`): a remote conversation's
	 * item can only answer `unknown` here - its receipt is on its owner - and
	 * the sentence for it must say it clears when that device updates rather
	 * than reporting a failure (operator report, 2026-10-05).
	 */
	deferred: number;
};

/**
 * The deferral sentence: marks that live on another device.
 *
 * ITS OWN SENTENCE, never the unknown remainder's (the "must not read as a
 * failure" rule, operator report 2026-10-05): a remote conversation's item can
 * only answer `unknown` - this root has no completion of its own to compare -
 * and "could not be cleared" is the wrong tense for a mark that clears on its
 * own when the owning device updates. Singular and plural spell their own verb
 * off the same count, like every other clause in the receipt, and the failure
 * arm one control up reuses this sentence for the whole-call class so the two
 * paths cannot say two different things about one fact.
 */
export const markAllReadDeferredSentence = (count: number): string =>
	t("ui.notices.chat.mark_all_read_deferred", { count });

/**
 * The receipt sentence for a bulk acknowledgement.
 *
 * `warning` rather than `success` when NOTHING was cleared: the request
 * succeeded, the write did not happen, and a success toast over an empty result
 * is the misreport this function exists to prevent. The remainder sentences
 * mirror the TUI's `/notifications read` receipt (`Marked 36 completions read. 2
 * have newer results and stay unread.`), so the two surfaces describe one
 * backend decision the same way.
 *
 * The TONE is a glyph and not a different ground, and the words carry the
 * register: `ThemedToastContainer` does not enable sonner's rich colours, so a
 * warning receipt and a success one share their ground, border and ink (design
 * N2). That is why the sentences below lead with the outcome — "Nothing was
 * cleared." — rather than leaving it to the icon.
 */
export const markAllReadReceipt = (
	receipt: MarkAllReadReceipt,
): { tone: "success" | "warning"; message: string } => {
	/*
	 * A claim about the REQUEST, not about the store: the shipped gate hides the
	 * control at zero, so this is the unreachable arm — and "Nothing unread."
	 * would be the one sentence in this contract able to contradict a screen
	 * still showing marks (design N3).
	 */
	if (receipt.attempted === 0)
		return {
			tone: "success",
			message: t("ui.notices.chat.mark_all_read_nothing"),
		};
	/*
	 * `unknown` MINUS `deferred`: the two sentences below would otherwise report
	 * one item twice and, worse, report a deferral as a failure (see the type's
	 * and the sentence's own notes above).
	 */
	const unknown = receipt.unknown - receipt.deferred;
	const remainder = [
		receipt.superseded > 0
			? t("ui.notices.chat.mark_all_read_superseded", {
					count: receipt.superseded,
				})
			: null,
		unknown > 0
			? t("ui.notices.chat.mark_all_read_unknown", { count: unknown })
			: null,
		receipt.deferred > 0 ? markAllReadDeferredSentence(receipt.deferred) : null,
	].filter((sentence): sentence is string => sentence !== null);
	if (receipt.cleared === 0)
		return {
			tone: "warning",
			message: [
				t("ui.notices.chat.mark_all_read_none_cleared"),
				...remainder,
			].join(" "),
		};
	return {
		tone: "success",
		message: [
			t("ui.notices.chat.mark_all_read_cleared", { count: receipt.cleared }),
			...remainder,
		].join(" "),
	};
};
