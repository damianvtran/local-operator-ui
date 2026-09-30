/**
 * Whether the release notes a payload carries belong to the release the offer
 * names.
 *
 * WHY THIS IS ITS OWN FUNCTION. The panel renders a quote - the release's own
 * lead - under a heading that names a version, so the two have to agree or the
 * card attributes one release's words to another. The producer already keeps
 * them in step: `readServerReleaseNotes(latestVersion)` fetches
 * `/releases/tags/<v latestVersion>` and `parseReleaseResponse` stamps the
 * requested version onto the notes it returns. What this refuses is the path
 * that does not go through the producer at all - a cache file on disk, which is
 * a plain JSON document the app writes and anything can edit - where an entry's
 * stored `version` can disagree with the key it was filed under.
 *
 * A SEPARATE MODULE FOR A REASON THAT IS NOT ARCHITECTURE: the comparison lived
 * inline in the panel's JSX, where deleting it left every suite green (measured
 * in review round 3: `releaseNotes?.version === latestVersion` replaced by
 * `releaseNotes` changed nothing in the focused desktop suite, and the
 * component's own render path needs a DOM no test here builds). As a pure
 * function it is exercised directly, and the panel's job is reduced to calling
 * it.
 *
 * The comparison is EXACT rather than normalised, deliberately: both sides come
 * from the same reading of PyPI's `info.version`, so a difference means the
 * payload is not this offer's - and `releaseTag` already absorbs the `v` prefix
 * on the lookup side, so a tag spelling difference cannot reach here.
 */
export function notesForOffer<T extends { version: string }>(
	notes: T | null | undefined,
	latestVersion: string,
): T | null {
	if (!notes) return null;
	return notes.version === latestVersion ? notes : null;
}
