/**
 * The backend's store-failure ladder as ERROR BODIES, and the one copy both halves
 * of the store-refusal evidence rig read.
 *
 * It exists as a module because the sentence is both the SERVER's answer
 * (`store-refusal-evidence.vite.mjs` answers `/__desktop` with it) and the
 * harness's EXPECTATION (`store-refusal-evidence.mjs` asserts the composer holds
 * it verbatim). Two literals would be a rig that agrees with itself while the
 * thing under evidence moved - the failure mode the assertions exist to catch, and
 * the reason the reviewer's round-1 note accepted a separate expectation constant
 * in the driver. One module makes the expectation unfalsifiable for free.
 *
 * WHY THE LENGTH MATTERS MORE THAN THE WORDING. These strings are taken verbatim
 * from the sibling branch (`~/local-operator-worktrees/store-failure-classes`,
 * `local_operator/server/utils/store_failures.py` at `d4109ed35`), with `{root}`
 * filled by this harness's own config-root stand-in. The first version of this rig
 * used deliberately shorter stand-ins - a defensible choice for the copy's wording,
 * and a fatal one for its size: the real 507 sentence runs to ~180 characters once
 * a real config root is in it, which is what fills the composer's capped window at
 * the app's minimum size and pushes the remedy clause out of it. The committed
 * frames showed a state the shipped copy cannot reach (design round 2, D5; QA round
 * 1's Q-1, measured on the real app). A future reword upstream is a one-line update
 * here, and the frames that depend on it are the ones that would be re-captured
 * anyway.
 *
 * What is asserted about the sentence in the frames is the MECHANISM, which holds
 * for any wording: the composer renders whatever the wire carried, verbatim, and the
 * code decides the hint and the held line's register.
 * `scripts/canonical-chat.test.mjs` pins the same split against the codes.
 */

/**
 * The config root the refused request used, as the sibling interpolates it.
 *
 * A realistic absolute path on purpose: the LENGTH is the measurement, and a short
 * stand-in is what hid the narrow-window defect (it is the length of the path that
 * decides how many lines the sentence takes at the app's minimum window).
 */
export const CONFIG_ROOT =
	"/Users/damian/Library/Application Support/local-operator";

/** The three arms, keyed as the harness's `?case=` names them. */
export const STORE_FAILURES = {
	busy: {
		status: 503,
		code: "store_busy",
		message: "Read state is busy right now. It will catch up on its own.",
	},
	"out-of-space": {
		status: 507,
		code: "store_out_of_space",
		message: `This computer is out of disk space, so the message could not be written. Free some space on the volume holding ${CONFIG_ROOT} and send it again.`,
	},
	unavailable: {
		status: 500,
		code: "store_unavailable",
		message: `The session store could not be read or written. Retrying will not help; check ${CONFIG_ROOT} and the disk it is on.`,
	},
};

/**
 * `altered` is not a fourth arm of the ladder; it is the same `store_out_of_space`
 * refusal followed by the operator's own remedy - the text restored, the image
 * dropped, Enter pressed - so its FIRST attempt is that arm and its second never
 * reaches the server at all (the unchanged-payload guard refuses it in the
 * renderer, which is exactly what that frame exists to show).
 */
export const CASE_ALIASES = { altered: "out-of-space" };

/** The ladder's arm for a harness case name, by the same rule the server applies. */
export const failureFor = (caseName) =>
	STORE_FAILURES[CASE_ALIASES[caseName] ?? caseName];
