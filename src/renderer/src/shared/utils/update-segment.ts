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
 * A same-triple respelling is also not a crossing, for the reason the module
 * header gives: it is the same version with a different suffix, not an arrival.
 * `PATCH` is therefore "any ORDERABLE difference", which is every release the
 * feed can actually offer - the offer only exists when main found a newer
 * version - and preserves the pre-preference behaviour for the default.
 */
export const segmentCrossed = (
	followed: FollowedSegment,
	running: string | null | undefined,
	available: string | null | undefined,
): boolean => {
	const from = parseVersionTriple(running);
	const to = parseVersionTriple(available);
	if (!from || !to) return false;
	if (from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) return false;
	if (followed === FollowedSegment.MAJOR) return from[0] !== to[0];
	if (followed === FollowedSegment.MINOR) {
		return from[0] !== to[0] || from[1] !== to[1];
	}
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
		description: "Patch, minor and major versions",
	},
	[FollowedSegment.MINOR]: {
		label: "Minor and major only",
		description: "Skip patch releases",
	},
	[FollowedSegment.MAJOR]: {
		label: "Major versions only",
		description: "Skip patch and minor releases",
	},
};

/** Narrow an unknown value (a persisted one, a test fixture) to a segment. */
export const isFollowedSegment = (value: unknown): value is FollowedSegment =>
	typeof value === "string" &&
	(FOLLOWED_SEGMENTS as readonly string[]).includes(value);
