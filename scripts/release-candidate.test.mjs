#!/usr/bin/env node
/**
 * The verification's inputs, derived from the Release that was published.
 *
 * The cases here are the ones this repository actually presents: an incumbent
 * that is not the previous *tag* (`v0.23.2` was tagged so it could be built,
 * failed its publish and was held out of `latest` with zero assets, so no user
 * ever ran it), and a candidate whose own release must not become its incumbent.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CandidateError, verificationInputs } from "./release-candidate.mjs";

/** The repository's real release list on 2026-09-15, reduced to what the
 * selector reads. */
const archZip = (version) => [
	{ name: `local-operator-ui-${version}-arm64.zip` },
	{ name: `local-operator-ui-${version}-x64.zip` },
	{ name: "latest-mac.yml" },
];
const release = (version, { prerelease = false, assets = null } = {}) => ({
	tag_name: `v${version}`,
	prerelease,
	draft: false,
	published_at: "2026-09-15T10:00:00Z",
	assets: assets ?? archZip(version),
});
const RELEASES = [
	release("0.24.0"),
	release("0.23.5"),
	release("0.23.4"),
	release("0.23.3"),
	release("0.23.2", { prerelease: true, assets: [] }),
	release("0.23.1"),
];

test("the verification's incumbent is the release a user upgrades from", () => {
	// v0.24.0 published: the candidate is the commit its tag names, and the
	// incumbent is v0.23.5 — not v0.23.2, which was tagged, held out of `latest`
	// and shipped no assets, so no user was ever running it.
	assert.deepEqual(
		verificationInputs({
			releaseTag: "v0.24.0",
			sourceSha: "a".repeat(40),
			releases: RELEASES,
		}),
		{ source_sha: "a".repeat(40), incumbent_tag: "v0.23.5" },
	);
	// The same list with v0.23.2 as the candidate: the incumbent steps back past
	// the held release to the last one users actually had.
	assert.equal(
		verificationInputs({
			releaseTag: "v0.23.2",
			sourceSha: "b".repeat(40),
			releases: RELEASES,
		}).incumbent_tag,
		"v0.23.1",
	);
});

test("a verification input that cannot be established is refused", () => {
	for (const input of [
		{ releaseTag: "0.24.0", sourceSha: "a".repeat(40) },
		{ releaseTag: "v0.24.0", sourceSha: "not-a-sha" },
		{ releaseTag: "v0.24.0", sourceSha: "" },
		// Nothing below the first release: there is no incumbent to install.
		{ releaseTag: "v0.1.0", sourceSha: "a".repeat(40) },
	]) {
		assert.throws(
			() => verificationInputs({ ...input, releases: RELEASES }),
			CandidateError,
			JSON.stringify(input),
		);
	}
});
