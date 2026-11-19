import { DesktopControlError } from "@shared/api/local-operator/desktop-api";

/**
 * The legacy arm's evidence that a refused sentence is about an alias. Hoisted
 * out of `aliasConflict` because it runs once per rendered failure and the
 * literal would otherwise be rebuilt on every call
 * (`lint/performance/useTopLevelRegex`).
 */
const LEGACY_ALIAS_MENTION = /alias/i;

/**
 * Whether a failed pull/subscribe is an ALIAS collision, which is the one write
 * refusal with a remedy the generic failure sentences cannot name: choose
 * another local alias. Any other refusal gets the cause-neutral copy.
 *
 * Two arms, and both are load-bearing while the fleet is mixed-version:
 *
 *  - `alias-occupied` is the dedicated code current core answers an alias
 *    collision with (the publish preview already used it for the same refusal).
 *    It is authoritative ON ITS OWN — the message is never read — so the
 *    remedy survives core rewording the sentence, which is exactly how this
 *    classifier broke once: it matched the word "alias" in prose that a
 *    reworded core no longer said.
 *  - `origin-conflict` + a message naming the alias is the pre-`alias-occupied`
 *    contract. A core that predates the dedicated code collapses an alias
 *    collision and a confirmed-origin conflict onto that one code, so only the
 *    sentence tells them apart. The arm stays until every supported core emits
 *    the dedicated code; dropping it early would silently regress the remedy
 *    for users on an older core.
 *
 * The legacy arm's message test is deliberately exact about "alias" and
 * nothing broader: `origin-conflict` ALSO covers a source/scope mismatch,
 * where renaming the local skill is the wrong advice (review round 1, minor
 * 7), so that class must keep the generic sentence.
 *
 * Lifted out of `components/hub-skills-library.tsx` so the routing can be
 * proved in the desktop suite (`scripts/hub-skill-alias.test.mjs`) rather than
 * only through a rendered frame — the component file itself is not unit-lane
 * material because it pulls in React and the whole i18n runtime.
 */
export function aliasConflict(error: unknown): boolean {
	if (!(error instanceof DesktopControlError)) return false;
	if (error.code === "alias-occupied") return true;
	return (
		error.code === "origin-conflict" && LEGACY_ALIAS_MENTION.test(error.message)
	);
}
