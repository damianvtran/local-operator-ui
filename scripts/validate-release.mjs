#!/usr/bin/env node
/**
 * Validate that a release targets an existing, published, immutable release.
 * Read-only: no secrets printed, no mutations, no publish.
 *
 * Env: RELEASE_TAG, EXPECTED_SOURCE_SHA (required for manual dispatch),
 * EXPECTED_RELEASE_ID (required by upload), IS_MANUAL_DISPATCH, GH_TOKEN
 * These pins are independent of the event: upload must detect a moved tag or
 * a deleted/recreated release even when it runs after a normal release event.
 * Output: GITHUB_OUTPUT lines source_sha, release_tag, release_id, prerelease.
 *
 * The returned object also carries the Release's `body`, which is NOT one of those
 * outputs (`emitOutputs` writes its four fields by name): `release-state.mjs`
 * refuses a release whose writeup is GitHub's generated draft rather than prose
 * from `.github/RELEASE_TEMPLATE.md`, and reading the body here means that verdict
 * is made against the same response this validation pinned, not a second read that
 * could describe a different body.
 *
 * THE RELEASE ID HAS TWO SPELLINGS, and the pin below reads both because the
 * producers disagree about which one they hold. The REST object validated here
 * spells one release twice: `id` is the NUMERIC database id (`389357596`) and
 * `node_id` is the GraphQL global id (`RE_kwDOOCmy184XNSAc`). A `release` event's
 * `github.event.release.id` is the numeric one, while `gh release view --json id`
 * is the NODE one -- which is not what its own name suggests, and which a hand-run
 * repair quoting that command will supply. That same mismatch is what cost
 * v0.24.2's first automatic release its run: the dispatch that carried the node id
 * (and is deleted with `.github/workflows/auto-release.yml`) compared it against
 * the numeric id here, so every later job was skipped against a tag and a Release
 * that already existed.
 *
 * The invariant, stated so the next reader does not have to rediscover which
 * spelling is which: a supplied identifier must identify the SAME release this
 * validator pins, and the two spellings of one release are accepted or refused
 * together. Only the numeric spelling is ever PASSED ON -- that is what
 * `upload-release.mjs` and `release-state.mjs` require of their own pins, so
 * tolerance for the node id belongs at this input and nowhere downstream.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isEntryPoint } from "./entry-point.mjs";

// Published prereleases use the same pipeline as stable releases.
const TAG_RE =
	/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

class ValidationError extends Error {}

function fail(msg) {
	throw new ValidationError(msg);
}

function validateInputs(tag, expectedSha, isManual, token) {
	if (!tag || !TAG_RE.test(tag))
		fail(`RELEASE_TAG must match vX.Y.Z, got: ${tag}`);
	if (!token) fail("GH_TOKEN required for read-only API calls");
	if (isManual && (!expectedSha || !SHA_RE.test(expectedSha))) {
		fail(
			`EXPECTED_SOURCE_SHA must be a full 40-char hex SHA for manual dispatch, got: ${expectedSha || "(empty)"}`,
		);
	}
	if (!isManual && expectedSha && !SHA_RE.test(expectedSha)) {
		fail(
			`EXPECTED_SOURCE_SHA must be a full 40-char hex SHA or empty for release event, got: ${expectedSha}`,
		);
	}
}

/**
 * Does `expectedReleaseId` name the release the API returned?
 *
 * Both spellings of one release are the same answer (see the header); a value
 * naming neither is a different release, or a transposed digit, and is refused.
 * An absent pin is not this function's business: whether one is required is
 * settled by `validateInputs` and by each caller's own pins.
 */
function matchReleaseId(release, expectedReleaseId) {
	const expected = String(expectedReleaseId ?? "").trim();
	if (!expected) return { matches: true, spelling: "" };
	const nodeId = typeof release.node_id === "string" ? release.node_id : "";
	if (expected === String(release.id))
		return { matches: true, spelling: "numeric id" };
	if (nodeId && expected === nodeId)
		return { matches: true, spelling: "node id" };
	return { matches: false, nodeId };
}

function createApi(repo, token) {
	return (path) => {
		try {
			return JSON.parse(
				execFileSync("gh", ["api", `repos/${repo}${path}`], {
					env: { ...process.env, GH_TOKEN: token },
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
					// A page of releases is not a small response: 92 releases carrying
					// their bodies and asset lists measured 1.75 MB in this repository,
					// over Node's 1 MiB default. Exceeding that surfaces as ENOBUFS,
					// which the catch below would report as a failed lookup on a read
					// that actually succeeded -- and the release-window checks fail
					// closed on an unreadable release.
					maxBuffer: 32 * 1024 * 1024,
				}),
			);
		} catch {
			// Do not echo subprocess output: it can include authentication details.
			fail(`GitHub metadata lookup failed: ${path}`);
		}
	};
}

function resolveTagSha(api, tag) {
	const ref = api(`/git/ref/tags/${encodeURIComponent(tag)}`);
	if (ref?.ref !== `refs/tags/${tag}`) {
		fail(`Unexpected ref format: expected refs/tags/${tag}`);
	}
	if (!ref.object) fail("Missing tag object");
	let sha = ref.object.sha;
	if (ref.object.type === "tag") {
		const tagObj = api(`/git/tags/${sha}`);
		if (tagObj.object.type !== "commit")
			fail(`Annotated tag points to ${tagObj.object.type}, expected commit`);
		sha = tagObj.object.sha;
	} else if (ref.object.type !== "commit") {
		fail(`Tag ref points to ${ref.object.type}, expected commit`);
	}
	if (!SHA_RE.test(sha)) fail("Tag must resolve to a full 40-char commit SHA");
	return sha;
}

function validateRelease(
	api,
	tag,
	expectedSha,
	isManual,
	expectedReleaseId = "",
) {
	const tagSha = resolveTagSha(api, tag);
	console.log(`Tag ${tag} resolves to commit ${tagSha}`);

	const release = api(`/releases/tags/${encodeURIComponent(tag)}`);
	if (!release) fail(`Missing release ${tag}`);
	if (release.tag_name !== tag)
		fail(
			`Release tag_name ${release.tag_name} does not match requested ${tag}`,
		);
	if (release.draft !== false || !release.published_at)
		fail(`Release ${tag} is a draft or not published`);
	if (!Number.isSafeInteger(release.id) || release.id <= 0)
		fail("Missing valid release ID");
	const pin = matchReleaseId(release, expectedReleaseId);
	if (!pin.matches) {
		// Both spellings are named in the refusal, because the reader of this line
		// is looking at a payload whose spelling is the thing that is wrong.
		const nodeDetail = pin.nodeId ? ` (node id ${pin.nodeId})` : "";
		fail(
			`Release ID ${release.id} does not match expected release ID ${expectedReleaseId}${nodeDetail}`,
		);
	}
	if (pin.spelling === "node id")
		console.log(
			`Expected release ID ${expectedReleaseId} is the node id of release ${release.id}: the same release, in the other spelling`,
		);
	console.log(
		`Release ${tag} (id ${release.id}) state: published, prerelease: ${release.prerelease}`,
	);

	if (isManual && !expectedSha)
		fail("EXPECTED_SOURCE_SHA required for manual dispatch");
	if (expectedSha && tagSha !== expectedSha) {
		fail(`Tag SHA ${tagSha} does not match expected source SHA ${expectedSha}`);
	}

	const pkg = JSON.parse(
		Buffer.from(
			api(`/contents/package.json?ref=${tagSha}`).content,
			"base64",
		).toString(),
	);
	if (pkg.name !== "local-operator-ui")
		fail(
			`package.json name mismatch: expected local-operator-ui, got ${pkg.name}`,
		);
	const expectedVersion = tag.slice(1);
	if (pkg.version !== expectedVersion)
		fail(
			`package.json version mismatch: expected ${expectedVersion}, got ${pkg.version}`,
		);
	console.log(`package.json name=${pkg.name} version=${pkg.version} OK`);

	return {
		source_sha: tagSha,
		release_tag: tag,
		// Always the numeric id, whatever spelling the pin arrived in: every
		// consumer downstream of this output requires that one (see the header).
		release_id: release.id,
		prerelease: release.prerelease,
		// Read from the response above rather than fetched again: the writeup gate in
		// `release-state.mjs` must judge the body this validation saw.
		body: release.body,
	};
}

function emitOutputs(result) {
	const outFile = process.env.GITHUB_OUTPUT;
	if (outFile) {
		writeFileSync(
			outFile,
			[
				`source_sha=${result.source_sha}`,
				`release_tag=${result.release_tag}`,
				`release_id=${result.release_id}`,
				`prerelease=${result.prerelease}`,
			].join("\n") + "\n",
			{ flag: "a" },
		);
	} else {
		console.log(JSON.stringify(result));
	}
}

// Main execution (skip when imported for testing)
if (isEntryPoint(import.meta.url)) {
	const tag = process.env.RELEASE_TAG;
	const expectedSha = process.env.EXPECTED_SOURCE_SHA || "";
	const isManual = process.env.IS_MANUAL_DISPATCH === "true";
	const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY || "damianvtran/local-operator-ui";

	try {
		validateInputs(tag, expectedSha, isManual, token);
		const api = createApi(repo, token);
		const result = validateRelease(
			api,
			tag,
			expectedSha,
			isManual,
			process.env.EXPECTED_RELEASE_ID,
		);
		emitOutputs(result);
		console.log("Validation passed");
	} catch (e) {
		if (e instanceof ValidationError) {
			console.error(e.message);
			process.exit(1);
		}
		throw e;
	}
}

// Export for testing
export {
	validateInputs,
	validateRelease,
	resolveTagSha,
	createApi,
	ValidationError,
};
