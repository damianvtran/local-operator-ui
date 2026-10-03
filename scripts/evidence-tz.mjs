/**
 * The timezone the evidence capture path pins every frame to, in one place.
 *
 * WHY A PIN AT ALL. A frame that prints a time is a function of the zone it
 * was captured in, so a re-shoot on another host - or the same host after a
 * move - diffs as a FAKE RENDERING REGRESSION rather than as a re-shoot.
 * Measured, not hypothetical: the committed `chat-turn-collapse` fifty print
 * `Oct 9, 2025, 4:54 AM` (a generation captured under America/New_York), while
 * a capture in the host's own zone (Europe/London, where the fleet sat at the
 * time) reads `9:54 AM` for the same fixture - and re-shooting `collapsed`
 * alone under `TZ=America/New_York` reproduced the committed reading exactly,
 * so those bytes are not re-derivable in the host's own zone (docs/evidence/
 * manifest.json, the 2026-10-03 fold note). PR #805's review named the same
 * class: "another zone would read as a rendering regression rather than a
 * re-shoot", which is why the pin is a property of the capture path rather
 * than an incantation every capturer remembers to type (both live-set
 * READMEs still teach the hand-typed prefix this module replaces).
 *
 * WHY AMERICA/NEW_YORK, AND NOT UTC. It is the zone the committed generations
 * carry - the set above, and the live sets whose READMEs pin it by hand today
 * (`docs/evidence/chat-turn-collapse-live/`, `docs/evidence/
 * canvas-file-freshness/`). UTC is defensible as a neutral pivot and wrong
 * for exactly that reason: it would shift every committed time-printing frame
 * by one reading, so a re-shoot under the pin would diff against the very set
 * it exists to reproduce.
 *
 * WHY THE PIN BEATS AN AMBIENT `TZ=` RATHER THAN DEFERRING TO IT. The
 * acceptance this exists for is "the same story captured under two host zones
 * produces IDENTICAL frames", so an ambient zone is the variance the pin
 * removes, never a choice it honours. This is where it deliberately DIVERGES
 * from `withNotificationsOff`'s pass-a-caller's-value-through contract: there
 * both values are legitimate and overwriting would decide something about the
 * operator's desktop; here a frame in the ambient zone is the defect, and its
 * next reader cannot tell it from a regression.
 *
 * WHERE IT APPLIES, AND HOW. Both rigs that photograph committed frames read
 * the zone from here and spell it nowhere else:
 *
 *   - `capture-evidence.mjs` sets `process.env.TZ` at the head of `main()`
 *     (never at module scope: tests import that file, and an import that
 *     re-zones its importer is a side effect nobody asked for) and hands
 *     `pinnedEvidenceEnv(process.env)` to its Chrome spawn explicitly.
 *   - `renderer-driver.mjs` pins its own process the same way and names
 *     `TZ: EVIDENCE_TZ` in the app launch env. Its `canvas-freshness` scene
 *     reads the PAGE's own zone by design and computes its expectation in the
 *     page from the same instant, so both sides move together under the pin
 *     and that check stays a check (verified by reading, not assumed).
 *
 * WHAT DELIBERATELY DOES NOT COME THROUGH HERE. A person's own app
 * (`pnpm start`/`dev`) and an interactive Storybook are theirs and carry
 * their machine's zone; nothing here reaches those. A rig that MEANS to
 * observe a different zone has no spelling today - the honest path is to say
 * so in review rather than to weaken this default.
 */

/**
 * The zone every committed evidence frame is captured under.
 *
 * A literal, never read from the environment: the module note above is the
 * measurement behind the value, and changing it re-zones every future capture
 * against every committed set - a decision about the sets' reproducibility
 * rather than a knob. `evidence-tz.test.mjs` pins the literal so the change
 * cannot be made absent-mindedly.
 */
export const EVIDENCE_TZ = "America/New_York";

/**
 * A copy of `env` with `TZ` pinned to `EVIDENCE_TZ`.
 *
 * A function of its input - the `resolveThemeSettleMs(…, env = process.env)`
 * house pattern - so the pin can be exercised against an ambient zone without
 * booting a rig, and so the process environment is read where the caller
 * means it rather than captured at import time.
 *
 * A COPY, never the caller's object mutated: a rig that built its env once
 * must not be able to re-zone the object a second caller already holds.
 */
export const pinnedEvidenceEnv = (env = process.env) => ({
	...env,
	TZ: EVIDENCE_TZ,
});
