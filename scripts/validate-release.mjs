#!/usr/bin/env node
/**
 * Validate that a release targets an existing, published, immutable release.
 * Read-only: no secrets printed, no mutations, no publish.
 *
 * Env: RELEASE_TAG, EXPECTED_SOURCE_SHA (required for manual dispatch), IS_MANUAL_DISPATCH, GH_TOKEN
 * Output: GITHUB_OUTPUT lines source_sha, release_tag, release_id, prerelease
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const TAG_RE = /^v\d+\.\d+\.\d+$/;
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
  return (path) => JSON.parse(
    execFileSync("gh", ["api", `repos/${repo}${path}`, "--jq", "."], {
      env: { ...process.env, GH_TOKEN: token },
      encoding: "utf8",
    }),
  );
}

function resolveTagSha(api, tag) {
  const ref = api(`/git/ref/tags/${tag}`);
  if (!ref.ref || !ref.ref.endsWith(`/tags/${tag}`)) {
    fail(`Unexpected ref format: ${ref.ref}, expected .../tags/${tag}`);
  }
  let sha = ref.object.sha;
  if (ref.object.type === "tag") {
    const tagObj = api(`/git/tags/${sha}`);
    if (tagObj.object.type !== "commit") fail(`Annotated tag points to ${tagObj.object.type}, expected commit`);
    sha = tagObj.object.sha;
  } else if (ref.object.type !== "commit") {
    fail(`Tag ref points to ${ref.object.type}, expected commit`);
  }
  return sha;
}

function validateRelease(api, tag, expectedSha, isManual) {
  const tagSha = resolveTagSha(api, tag);
  console.log(`Tag ${tag} resolves to commit ${tagSha}`);

  const release = api(`/releases/tags/${tag}`);
  if (release.tag_name !== tag) fail(`Release tag_name ${release.tag_name} does not match requested ${tag}`);
  if (release.draft) fail(`Release ${tag} is a draft; refusing dispatch`);
  console.log(`Release ${tag} (id ${release.id}) state: published, prerelease: ${release.prerelease}`);

  if (isManual && tagSha !== expectedSha) {
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
if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.env.RELEASE_TAG;
  const expectedSha = process.env.EXPECTED_SOURCE_SHA || "";
  const isManual = process.env.IS_MANUAL_DISPATCH === "true";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || "damianvtran/local-operator-ui";

  try {
    validateInputs(tag, expectedSha, isManual, token);
    const api = createApi(repo, token);
    const result = validateRelease(api, tag, expectedSha, isManual);
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
export { validateInputs, validateRelease, resolveTagSha, ValidationError };
