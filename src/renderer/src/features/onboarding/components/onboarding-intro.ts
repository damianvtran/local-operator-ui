/**
 * @file onboarding-intro.ts
 * @description
 * The first-run stage's opening: the brand mark and helix fade in, the welcome
 * line enters, and after a beat the helix rises into the sign-in step's header
 * slot ("passes through to the sign-in", operator 2026-11-24).
 *
 * ## The phases
 *
 * - `intro`   - mark, helix and welcome copy; the steps are mounted but hidden
 *               and inert, so nothing remounts at the hand-off.
 * - `handoff` - the horizon slot travels to its resting place (a transform, see
 *               onboarding-stage.css) while the step's header, body and footer
 *               enter on a stagger. Pointer input is off until it settles.
 * - `steps`   - the wizard proper.
 *
 * The CSS owns every visual; this hook owns only WHEN each phase starts, so the
 * timeline is two numbers a test can read rather than a chain of animationend
 * events that a reduced-motion or hidden window never fires.
 *
 * ## Constraints
 *
 * - SKIPPABLE: any key (not a bare modifier), any pointer press or wheel during
 *   the intro jumps straight to a compressed hand-off. Listened for once.
 * - REDUCED MOTION: no intro at all. The stage opens on the sign-in final
 *   frame; the welcome carried no information the flow needs.
 * - Only from the first step: a user resuming setup on step 3 is not shown a
 *   welcome that "passes through to the sign-in" they already did.
 */

import { useEffect, useState } from "react";

export type StagePhase = "intro" | "handoff" | "steps";

/** How long the intro holds before the hand-off starts (design § 4.1). */
export const INTRO_HOLD_MS = 2200;
/** The hand-off's full length, through the last staggered entrance (§ 4.2). */
export const HANDOFF_MS = 920;
/** A skipped hand-off: one 240ms beat plus a frame of slack (§ 4.2, Skip). */
export const SKIPPED_HANDOFF_MS = 260;

/**
 * How the intro should behave. `auto` is the product; `hold` freezes on the
 * intro's final frame and `skip` starts on the steps - both exist for Storybook
 * captures and tests, which must photograph a deterministic frame.
 */
export type IntroMode = "auto" | "hold" | "skip";

/** Keys that never count as "pressed a key" on their own. */
const MODIFIER_KEYS = new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta",
	"CapsLock",
	"Fn",
	"OS",
]);

/** Whether this keydown should skip the intro. */
export function skipsIntro(event: Pick<KeyboardEvent, "key">): boolean {
	return !MODIFIER_KEYS.has(event.key);
}

function prefersReducedMotion(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
		);
	} catch {
		return false;
	}
}

/** The phase the stage opens in. */
export function initialStagePhase(
	mode: IntroMode,
	playIntro: boolean,
	reducedMotion: boolean,
): StagePhase {
	if (mode === "hold") return "intro";
	if (mode === "skip" || !playIntro || reducedMotion) return "steps";
	return "intro";
}

/**
 * Drive the phases. `playIntro` is read when the stage OPENS; later changes
 * (the user moving through steps) do not replay it.
 */
export function useStageIntro(
	open: boolean,
	playIntro: boolean,
	mode: IntroMode = "auto",
): { phase: StagePhase; skipped: boolean } {
	const [phase, setPhase] = useState<StagePhase>(() =>
		initialStagePhase(mode, playIntro, prefersReducedMotion()),
	);
	const [skipped, setSkipped] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the intro is decided once per open; `playIntro` changing mid-flow must not replay it.
	useEffect(() => {
		if (!open || mode !== "auto" || phase !== "intro") return undefined;
		let hold = 0;
		const startHandoff = (wasSkipped: boolean) => {
			detach();
			window.clearTimeout(hold);
			setSkipped(wasSkipped);
			setPhase("handoff");
		};
		const onKey = (event: KeyboardEvent) => {
			if (!skipsIntro(event)) return;
			// The key that skips the intro does nothing else: Escape must not also
			// end setup, Enter must not press a button that is still hidden.
			event.preventDefault();
			event.stopPropagation();
			startHandoff(true);
		};
		const onPointer = () => startHandoff(true);
		const detach = () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("wheel", onPointer, true);
		};
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("wheel", onPointer, {
			capture: true,
			passive: true,
		});
		hold = window.setTimeout(() => startHandoff(false), INTRO_HOLD_MS);
		return () => {
			detach();
			window.clearTimeout(hold);
		};
	}, [open, mode]);

	/*
	 * The hand-off lands on its own effect, keyed on the phase, so nothing that
	 * re-renders the stage mid-flight can strand it in `handoff`.
	 */
	useEffect(() => {
		if (phase !== "handoff") return undefined;
		const id = window.setTimeout(
			() => setPhase("steps"),
			skipped ? SKIPPED_HANDOFF_MS : HANDOFF_MS,
		);
		return () => window.clearTimeout(id);
	}, [phase, skipped]);

	return { phase, skipped };
}
