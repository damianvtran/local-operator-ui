#!/usr/bin/env node
/**
 * The two inputs the signed-update exercise needs, derived from one fact: which
 * Release was just published.
 *
 * WHAT IT ANSWERS, and why the answer is derived rather than passed in:
 *
 *  - **the candidate** is the commit the published tag points at. Resolved from
 *    the tag itself — through `resolveTagSha`, the same function the publish
 *    workflow trusts — rather than taken from whatever dispatched this run, so
 *    there is nothing here for a payload to get wrong or to forge: the commit
 *    being signed is the commit the release shipped.
 *  - **the incumbent** is the newest release *below* the candidate that a user
 *    could actually have been running — published, not a pre-release, carrying the
 *    architecture-matched archive its feed needs. That is what "upgraded from"
 *    means, and taking the newest release instead would exercise an upgrade no
 *    user performs (the candidate itself), while taking the newest *tag* would
 *    exercise one out of an install that never existed (`v0.23.2` here: tagged,
 *    held out of `latest`, zero assets).
 *
 * A missing incumbent is a refusal, not a default. The exercise downloads and
 * installs the incumbent before it touches the candidate, so running it against a
 * tag that cannot be installed would report a failure about the VM rather than
 * about the release.
 */
import { isEntryPoint } from "./entry-point.mjs";
import {
	fetchReleases,
	selectIncumbentAnchor,
	tagVersion,
} from "./release-baseline.mjs";
import {
	ValidationError,
	createApi,
	resolveTagSha,
} from "./validate-release.mjs";

/** Thrown when the inputs cannot be established, which must fail rather than be
 * approximated: the harness reports BLOCKED for a missing capability, and an
 * input this script invented is not a capability. */
export class CandidateError extends Error {}

/** The pure half: given the release list and the candidate, name the incumbent. */
export function verificationInputs({ releaseTag, sourceSha, releases }) {
	const version = tagVersion(releaseTag);
	if (!version)
		throw new CandidateError(`Not a vX.Y.Z release tag: ${releaseTag}`);
	if (!/^[0-9a-f]{40}$/.test(sourceSha ?? ""))
		throw new CandidateError(`Not a full commit SHA: ${sourceSha}`);
	const incumbent = selectIncumbentAnchor(releases, {
		below: version,
		exclude: releaseTag,
	});
	if (!incumbent) {
		throw new CandidateError(
			`No published release below ${releaseTag} carries an architecture-matched archive, so there is nothing for a user to upgrade from and the exercise has no incumbent`,
		);
	}
	return { source_sha: sourceSha, incumbent_tag: incumbent.tag };
}

function main() {
	const arg = (name) => {
		const index = process.argv.indexOf(name);
		return index < 0 ? null : (process.argv[index + 1] ?? null);
	};
	const repository =
		arg("--repository") ??
		process.env.GITHUB_REPOSITORY ??
		"damianvtran/local-operator-ui";
	try {
		const releaseTag = arg("--release-tag");
		if (!releaseTag) throw new CandidateError("--release-tag is required");
		const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
		if (!token)
			throw new CandidateError("GH_TOKEN is required to resolve the tag");
		// A tag this repository does not have is the caller's input being wrong, not
		// a tool failure: `resolveTagSha` reports it as a `ValidationError` whose text
		// is already this project's own copy ("GitHub metadata lookup failed"), so it
		// is re-raised as a named refusal rather than printed as a stack trace.
		let sourceSha;
		try {
			sourceSha = resolveTagSha(createApi(repository, token), releaseTag);
		} catch (error) {
			if (error instanceof ValidationError)
				throw new CandidateError(
					`Could not resolve the release tag ${releaseTag}: ${error.message}`,
				);
			throw error;
		}
		const result = verificationInputs({
			releaseTag,
			sourceSha,
			releases: fetchReleases(repository),
		});
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error(
			error instanceof CandidateError
				? `Verification inputs refused: ${error.message}`
				: `Verification inputs failed: ${error.stack ?? error.message}`,
		);
		process.exit(1);
	}
}

if (isEntryPoint(import.meta.url)) {
	main();
}
