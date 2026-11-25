/**
 * Meet Aida - the bookend step (first-run onboarding, U1/D12; split out of the
 * old "extras" step in the stage refresh).
 *
 * It has NO BODY. The horizon returns to full strength and the mark to its intro
 * size (the stage's `bookend`), the title says who she is, and the footer's
 * primary is "Meet <name>": the press that asks her to say hello. The search
 * half of the old step is its own step now, because it leaves the sequence when
 * Radient is connected while she does not.
 *
 * NO NAME FIELD (unchanged from the extras step): Aida asks, in her first
 * conversation, and records the answer where every session reads it.
 */

import { t } from "@shared/i18n";

/**
 * The step's heading and sentence.
 *
 * TWO SENTENCES, ONE TRUE AT A TIME (code review round 1's contract addendum,
 * point 1): the first promises a greeting she still owes; the second is what an
 * install says when her hello was already delivered or skipped, where the
 * promise would describe a first meeting the user has already had. Which one is
 * owed comes from the ledger's state word on her status document
 * (`aidaOwesGreeting`), never inferred here.
 */
export function meetAidaCopy(
	name: string,
	oweGreeting: boolean,
): { title: string; subtitle: string } {
	return {
		title: t("ui.onboarding.modal.title.meet", { name }),
		subtitle: oweGreeting
			? t("ui.onboarding.meet.owed")
			: t("ui.onboarding.meet.done"),
	};
}
