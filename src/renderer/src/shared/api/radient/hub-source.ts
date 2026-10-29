/**
 * The hub source the DESKTOP writes into a skill link's identity.
 *
 * Core approves exactly the base its own config normalises to, and
 * `normalize_radient_api_base_url` (`local_operator/env.py`) COMPLETES a bare
 * origin with `/v1` while leaving any path-bearing base untouched. Appending
 * `/v1` unconditionally (review round 1, minor 6) therefore sends `.../v1/v1`
 * for the very shape core documents, is refused `origin-conflict`, and makes
 * every installed skill read "Not downloaded" because the link join compares
 * against the doubled address.
 *
 * Kept as its own module with no imports so the real function is what a test
 * bundles: the mounted-hook test has to stub the catalogue client, and a test
 * that reimplements the helper pins nothing.
 */
const TRAILING_SLASHES = /\/+$/;

export function hubSourceAddress(origin: string): string {
	const trimmed = origin.replace(TRAILING_SLASHES, "");
	try {
		const { pathname } = new URL(trimmed);
		return pathname === "" || pathname === "/" ? `${trimmed}/v1` : trimmed;
	} catch {
		// Not a URL this runtime can parse: complete it the way core would for
		// the only shape that reaches here from configuration.
		return `${trimmed}/v1`;
	}
}
