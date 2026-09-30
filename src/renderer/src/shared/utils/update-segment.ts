/**
 * How much of a version change counts as news, for the update indicator.
 *
 * Pure TypeScript with no React, DOM or store imports, so `pnpm test:desktop`
 * bundles this file directly and drives the rules (the same way
 * `update-manual-state.ts` and the transcript reducer are driven). That matters
 * because this decides whether the app speaks at all: the whole point of the
 * preference is that a user who follows only majors stops hearing about every
 * patch release, and "stopped hearing about a real change" is not a bug anybody
 * reports - they just stop trusting the indicator.
 *
 * WHY THIS IS NOT A STRING COMPARISON. The naive spelling of "does the patch
 * differ?" is `running.patch !== available.patch` on `split(".")` of both
 * versions, and it is wrong in the one case that matters: `Number("unknown")`
 * and `Number("dev")` are `NaN`, and EVERY comparison against `NaN` is false, so
 * an unorderable pair reads as "the segment did not change" for a coarse
 * preference and as "every segment changed" for a `!=` on the raw parts. Neither
 * is a fact this app established. `compareVersions` in `src/main/update-install.ts`
 * answers `null` for exactly these pairs and makes every caller decide what to do
 * with it rather than being handed a made-up ordering; the rule here is the same
 * one, and the answer it forces is the quiet one - an unorderable pair never
 * notifies (see `segmentCrossed`).
 *
 * THE TRIPLE IS THE UNIT, matching that module's own reader
 * (`VERSION_TRIPLE_REGEX`): a leading `v` is noise the app and the server do not
 * agree on, and a pre-release or build suffix is part of the spelling rather than
 * a fourth number. A same-triple respelling is therefore not an arrival, which is
 * the same verdict `targetStanding` reaches for it ("same-triple ... NOT an
 * arrival") - one rule about what counts as having moved, not two.
 */

/**
 * Which part of the version a surface announces on.
 *
 * The names are the version component the follower cares about, and the
 * semantics read downward from the coarsest (opposite to the numeric order):
 * `PATCH` is every release, `MINOR` is a minor or major step, `MAJOR` is a major
 * step only.
 */
export enum FollowedSegment {
	PATCH = "patch",
	MINOR = "minor",
	MAJOR = "major",
}

/** The selectable values, coarsest-last, for a settings control to iterate. */
export const FOLLOWED_SEGMENTS: readonly FollowedSegment[] = [
	FollowedSegment.PATCH,
	FollowedSegment.MINOR,
	FollowedSegment.MAJOR,
];

/**
 * `patch`, because that is what the app did before this preference existed:
 * every release either surface published raised the notice. A default that
 * changed behaviour for people who never open Settings would be a silent
 * regression dressed as a new feature.
 */
export const DEFAULT_FOLLOWED_SEGMENT = FollowedSegment.PATCH;

/** `x.y.z` at the start of a version string, with an optional leading `v`. */
const VERSION_TRIPLE_REGEX = /^v?(\d+)\.(\d+)\.(\d+)/;

export type VersionTriple = readonly [number, number, number];

/**
 * The orderable triple of a version string, or null when there is not one.
 *
 * Null is the honest answer rather than a zero triple: `"unknown"` (the
 * renderer's own placeholder for a version it has not read yet), a dev stamp and
 * a git-describe build all land here, and a caller that got `[0,0,0]` for them
 * would compare against a version number nothing ever published.
 */
export const parseVersionTriple = (
	value: string | null | undefined,
): VersionTriple | null => {
	if (typeof value !== "string") return null;
	const match = VERSION_TRIPLE_REGEX.exec(value.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * Whether `to` is above `from`, lexicographically over the orderable triple.
 *
 * The direction, and it is a fix rather than a tidy-up (review R6): the gate used
 * to ask "is there a difference at this segment", and a difference is symmetric -
 * so an `available` OLDER than `running` announced itself on every setting.
 * `PATCH`'s justification for that ("the offer only exists when main found a newer
 * version") is a property of the app channel, and it is not one the SERVER channel
 * has: its `running` is the daemon's own reading against a `latestVersion` main
 * compared against the INSTALLED version, so the pair is not guaranteed ordered.
 * An offer that is not newer is not an arrival on any surface.
 */
const isAbove = (to: VersionTriple, from: VersionTriple): boolean => {
	if (to[0] !== from[0]) return to[0] > from[0];
	if (to[1] !== from[1]) return to[1] > from[1];
	return to[2] > from[2];
};

/**
 * Whether this pair moves the BREAKING step, in the sense a caret range means it.
 *
 * Before 1.0 the leading non-zero segment is the SECOND one, so that is where the
 * breaking step lives: npm's own caret range says `^0.31.0` allows `0.31.4` and
 * not `0.32.0`, and this product's two channels are both 0.x today (app 0.3x,
 * server 0.5x/0.6x). Treating the first position as the only major step made
 * "Breaking changes only" a MUTE SWITCH for the whole 0.x era - every release the
 * product can publish is silently withheld while the label reads like an ordinary
 * noise filter (reviews R7, U7). `0.x -> 1.0` moves the first position and is a
 * breaking step on either reading, which is why the two branches meet there.
 */
const breakingStep = (from: VersionTriple, to: VersionTriple): boolean =>
	from[0] === 0 && to[0] === 0 ? from[1] !== to[1] : from[0] !== to[0];

/**
 * Whether this pair moves the minor position or above.
 *
 * Unchanged by the 0.x reading, and the CONSEQUENCE is worth stating rather than
 * discovering: at 0.x a minor-position move is both the minor step and the
 * breaking one, so "Minor and major only" and "Breaking changes only" announce
 * exactly the same releases for as long as the product stays 0.x - and both still
 * keep their literal promise to skip patches. There is no third granularity to
 * sell at 0.x, and inventing one (calling a patch-position move a "minor" step)
 * would make `Skip patch releases` false instead.
 */
const minorOrMajorStep = (from: VersionTriple, to: VersionTriple): boolean =>
	from[0] !== to[0] || from[1] !== to[1];

/**
 * Whether an available version crosses the segment a surface is following.
 *
 * `running` is the version in use, `available` the one on offer, and the answer
 * is "should the unsolicited indicator speak about this pair".
 *
 * UNORDERABLE IS NEVER A NOTIFY, and that is the deliberate half. A pair this
 * cannot order has not been shown to differ at any segment - the offer itself
 * came from the main process, which did its own comparison, so declining here
 * withholds a *notification* and never the offer: an explicit check still reports
 * it (see the settings button, which opens the detail regardless of this gate),
 * and the update can still be performed by hand. The alternative - treating the
 * unparseable side as "a difference" - is how a machine whose version reads
 * `unknown` for a frame would be told it is a major release behind.
 *
 * ORDER IS THE OTHER HALF: an offer at or below the running version is not an
 * arrival, so it is silent on every setting (`isAbove` above).
 *
 * A same-triple respelling is also not a crossing, for the reason the module
 * header gives: it is the same version with a different suffix, not an arrival.
 * `PATCH` is therefore "any NEWER orderable version", which is every release the
 * feed can actually offer, and preserves the pre-preference behaviour for the
 * default.
 */
export const segmentCrossed = (
	followed: FollowedSegment,
	running: string | null | undefined,
	available: string | null | undefined,
): boolean => {
	const from = parseVersionTriple(running);
	const to = parseVersionTriple(available);
	if (!from || !to) return false;
	if (!isAbove(to, from)) return false;
	if (followed === FollowedSegment.MAJOR) return breakingStep(from, to);
	if (followed === FollowedSegment.MINOR) return minorOrMajorStep(from, to);
	return true;
};

/**
 * What each value means, in the words the settings control prints.
 *
 * `description` is written as the CONSEQUENCE rather than as the version
 * component: a person choosing here is deciding how often they want to be
 * interrupted, and "patch" versus "minor" is vocabulary from a build tool. The
 * segment name survives as the secondary line, because it is the word they will
 * see in a release note or a support thread.
 */
export const FOLLOWED_SEGMENT_COPY: Record<
	FollowedSegment,
	{ label: string; description: string }
> = {
	[FollowedSegment.PATCH]: {
		label: "Every release",
		description: "Patch, minor and major versions.",
	},
	[FollowedSegment.MINOR]: {
		label: "Minor and major only",
		description: "Skips patch releases.",
	},
	[FollowedSegment.MAJOR]: {
		label: "Breaking changes only",
		/*
		 * TRUE FOR A 0.x PRODUCT, which the old wording was not: "Skip patch and
		 * minor releases" reads as a filter over three named steps, and on a 0.x
		 * product the minor step IS the breaking one - so the old sentence promised a
		 * choice the product could not honour and the setting looked like a mute
		 * switch (reviews R7, U7). The consequence is stated instead of the version
		 * components, the same rule the other two descriptions follow.
		 */
		description:
			"Skips patches and minors. Before 1.0 a new minor is a breaking change.",
	},
};

/** Narrow an unknown value (a persisted one, a test fixture) to a segment. */
export const isFollowedSegment = (value: unknown): value is FollowedSegment =>
	typeof value === "string" &&
	(FOLLOWED_SEGMENTS as readonly string[]).includes(value);
