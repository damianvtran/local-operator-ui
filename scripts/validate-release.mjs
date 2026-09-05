#!/usr/bin/env node
/**
 * Validate that a release targets an existing, published, immutable release.
 * Read-only: no secrets printed, no mutations, no publish.
 *
 * Env: RELEASE_TAG, EXPECTED_SOURCE_SHA (required for manual dispatch),
 * EXPECTED_RELEASE_ID (required by upload), IS_MANUAL_DISPATCH, GH_TOKEN
 * These pins are independent of the event: upload must detect a moved tag or
 * a deleted/recreated release even when it runs after a normal release event.
 * Output: GITHUB_OUTPUT lines source_sha, release_tag, release_id, prerelease
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Published prereleases use the same pipeline as stable releases.
const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

class ValidationError extends Error {}

function fail(msg) {
  throw new ValidationError(msg);
}

function validateInputs(tag, expectedSha, isManual, token) {
  if (!tag || !TAG_RE.test(tag)) fail(`RELEASE_TAG must match vX.Y.Z, got: ${tag}`);
  if (!token) fail("GH_TOKEN required for read-only API calls");
  if (isManual && (!expectedSha || !SHA_RE.test(expectedSha))) {
    fail(`EXPECTED_SOURCE_SHA must be a full 40-char hex SHA for manual dispatch, got: ${expectedSha || "(empty)"}`);
  }
  if (!isManual && expectedSha && !SHA_RE.test(expectedSha)) {
    fail(`EXPECTED_SOURCE_SHA must be a full 40-char hex SHA or empty for release event, got: ${expectedSha}`);
  }
}

function createApi(repo, token) {
  return (path) => {
    try {
      return JSON.parse(execFileSync("gh", ["api", `repos/${repo}${path}`], {
        env: { ...process.env, GH_TOKEN: token },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
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
    if (tagObj.object.type !== "commit") fail(`Annotated tag points to ${tagObj.object.type}, expected commit`);
    sha = tagObj.object.sha;
  } else if (ref.object.type !== "commit") {
    fail(`Tag ref points to ${ref.object.type}, expected commit`);
  }
  if (!SHA_RE.test(sha)) fail("Tag must resolve to a full 40-char commit SHA");
  return sha;
}

function validateRelease(api, tag, expectedSha, isManual, expectedReleaseId = "") {
  const tagSha = resolveTagSha(api, tag);
  console.log(`Tag ${tag} resolves to commit ${tagSha}`);

  const release = api(`/releases/tags/${encodeURIComponent(tag)}`);
  if (!release) fail(`Missing release ${tag}`);
  if (release.tag_name !== tag) fail(`Release tag_name ${release.tag_name} does not match requested ${tag}`);
  if (release.draft !== false || !release.published_at) fail(`Release ${tag} is a draft or not published`);
  if (!Number.isSafeInteger(release.id) || release.id <= 0) fail("Missing valid release ID");
  if (expectedReleaseId && String(release.id) !== String(expectedReleaseId)) {
    fail(`Release ID ${release.id} does not match expected release ID ${expectedReleaseId}`);
  }
  console.log(`Release ${tag} (id ${release.id}) state: published, prerelease: ${release.prerelease}`);

  if (isManual && !expectedSha) fail("EXPECTED_SOURCE_SHA required for manual dispatch");
  if (expectedSha && tagSha !== expectedSha) {
    fail(`Tag SHA ${tagSha} does not match expected source SHA ${expectedSha}`);
  }

  const pkg = JSON.parse(Buffer.from(api(`/contents/package.json?ref=${tagSha}`).content, "base64").toString());
  if (pkg.name !== "local-operator-ui") fail(`package.json name mismatch: expected local-operator-ui, got ${pkg.name}`);
  const expectedVersion = tag.slice(1);
  if (pkg.version !== expectedVersion) fail(`package.json version mismatch: expected ${expectedVersion}, got ${pkg.version}`);
  console.log(`package.json name=${pkg.name} version=${pkg.version} OK`);

  return { source_sha: tagSha, release_tag: tag, release_id: release.id, prerelease: release.prerelease };
}

function emitOutputs(result) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    writeFileSync(outFile, [
      `source_sha=${result.source_sha}`,
      `release_tag=${result.release_tag}`,
      `release_id=${result.release_id}`,
      `prerelease=${result.prerelease}`,
    ].join("\n") + "\n", { flag: "a" });
  } else {
    console.log(JSON.stringify(result));
  }
}

// Main execution (skip when imported for testing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.env.RELEASE_TAG;
  const expectedSha = process.env.EXPECTED_SOURCE_SHA || "";
  const isManual = process.env.IS_MANUAL_DISPATCH === "true";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || "damianvtran/local-operator-ui";

  try {
    validateInputs(tag, expectedSha, isManual, token);
    const api = createApi(repo, token);
    const result = validateRelease(api, tag, expectedSha, isManual, process.env.EXPECTED_RELEASE_ID);
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
export { validateInputs, validateRelease, resolveTagSha, createApi, ValidationError };
