#!/usr/bin/env node
/** Bounded unit tests for validate-release.mjs — dependency-injected API, no network. */
import { validateInputs, validateRelease, resolveTagSha, ValidationError } from "./validate-release.mjs";

const SHA = "3becfb9c462f6adb1f47f9815767f5522755f849";
const TAG = "v0.14.1";
let failures = 0;
let passes = 0;

function ok(name) { passes++; console.log(`PASS: ${name}`); }
function fail(name, msg) { failures++; console.error(`FAIL: ${name}: ${msg}`); }

function expectThrow(fn, name, pattern) {
  try {
    fn();
    fail(name, "expected throw but succeeded");
  } catch (e) {
    if (!(e instanceof ValidationError)) {
      fail(name, `expected ValidationError, got ${e.constructor.name}: ${e.message}`);
    } else if (e.message.includes(pattern) || e.message.match(new RegExp(pattern))) {
      ok(name);
    } else {
      fail(name, `wrong error: ${e.message}`);
    }
  }
}

function mockApi(responses) {
  return (path) => {
    for (const [key, val] of Object.entries(responses)) {
      if (path === key || path.startsWith(key)) return val;
    }
    throw new Error(`unmocked path: ${path}`);
  };
}

// --- Input validation ---
console.log("--- Input validation ---");

expectThrow(() => validateInputs("", SHA, true, "t"), "empty tag", "vX.Y.Z");
expectThrow(() => validateInputs("0.14.1", SHA, true, "t"), "tag without v", "vX.Y.Z");
expectThrow(() => validateInputs("v0.14", SHA, true, "t"), "incomplete version", "vX.Y.Z");
expectThrow(() => validateInputs("v0.14.1-beta", SHA, true, "t"), "prerelease suffix", "vX.Y.Z");
expectThrow(() => validateInputs(TAG, "abc", true, "t"), "short SHA", "40-char");
expectThrow(() => validateInputs(TAG, "", true, "t"), "empty SHA manual", "40-char");
try { validateInputs(TAG, "", false, "t"); ok("empty SHA release event valid"); } catch (e) { fail("empty SHA release event", e.message); }
expectThrow(() => validateInputs(TAG, "abc", false, "t"), "invalid SHA release event", "40-char");
expectThrow(() => validateInputs(TAG, SHA, true, ""), "missing token", "GH_TOKEN");
expectThrow(() => validateInputs(TAG, SHA, false, ""), "missing token release", "GH_TOKEN");
try { validateInputs(TAG, SHA, true, "t"); ok("valid manual inputs"); } catch (e) { fail("valid manual", e.message); }
try { validateInputs(TAG, "", false, "t"); ok("valid release inputs"); } catch (e) { fail("valid release", e.message); }

// --- Tag resolution ---
console.log("--- Tag resolution ---");

const lightweightRef = { ref: `refs/tags/${TAG}`, object: { sha: SHA, type: "commit" } };
const annotatedRef = { ref: `refs/tags/${TAG}`, object: { sha: "annotated1234567890123456789012345678901234", type: "tag" } };
const annotatedTagObj = { object: { sha: SHA, type: "commit" } };

expectThrow(() => resolveTagSha(mockApi({ "/git/ref/tags/v0.14.1": { ref: "refs/heads/main", object: { sha: SHA, type: "commit" } } }), TAG), "wrong ref format", "Unexpected ref");
expectThrow(() => resolveTagSha(mockApi({ "/git/ref/tags/v0.14.1": { ref: `refs/tags/${TAG}`, object: { sha: SHA, type: "blob" } } }), TAG), "non-commit ref", "expected commit");

try {
  const sha = resolveTagSha(mockApi({ "/git/ref/tags/v0.14.1": lightweightRef }), TAG);
  if (sha === SHA) ok("lightweight tag resolution"); else fail("lightweight", `got ${sha}`);
} catch (e) { fail("lightweight tag", e.message); }

try {
  const sha = resolveTagSha(mockApi({
    "/git/ref/tags/v0.14.1": annotatedRef,
    "/git/tags/annotated1234567890123456789012345678901234": annotatedTagObj,
  }), TAG);
  if (sha === SHA) ok("annotated tag peeling"); else fail("annotated", `got ${sha}`);
} catch (e) { fail("annotated tag", e.message); }

// --- Release validation ---
console.log("--- Release validation ---");

const publishedRelease = { id: 383131955, tag_name: TAG, draft: false, prerelease: false };
const draftRelease = { id: 123, tag_name: TAG, draft: true, prerelease: false };
const wrongTagRelease = { id: 123, tag_name: "v0.14.0", draft: false, prerelease: false };
const validPkg = { content: Buffer.from(JSON.stringify({ name: "local-operator-ui", version: "0.14.1" })).toString("base64") };
const wrongNamePkg = { content: Buffer.from(JSON.stringify({ name: "other", version: "0.14.1" })).toString("base64") };
const wrongVersionPkg = { content: Buffer.from(JSON.stringify({ name: "local-operator-ui", version: "0.14.0" })).toString("base64") };

const happyApi = mockApi({
  "/git/ref/tags/v0.14.1": lightweightRef,
  "/releases/tags/v0.14.1": publishedRelease,
  "/contents/package.json?ref=": validPkg,
});

try {
  const result = validateRelease(happyApi, TAG, SHA, true);
  if (result.source_sha === SHA && result.release_id === 383131955) ok("happy path manual");
  else fail("happy manual", JSON.stringify(result));
} catch (e) { fail("happy manual", e.message); }

try {
  const result = validateRelease(happyApi, TAG, "", false);
  if (result.source_sha === SHA) ok("happy path release event");
  else fail("happy release", JSON.stringify(result));
} catch (e) { fail("happy release", e.message); }

expectThrow(() => validateRelease(mockApi({
  "/git/ref/tags/v0.14.1": lightweightRef,
  "/releases/tags/v0.14.1": draftRelease,
}), TAG, SHA, true), "draft release rejected", "draft");

expectThrow(() => validateRelease(mockApi({
  "/git/ref/tags/v0.14.1": lightweightRef,
  "/releases/tags/v0.14.1": wrongTagRelease,
}), TAG, SHA, true), "tag_name mismatch rejected", "tag_name");

expectThrow(() => validateRelease(mockApi({
  "/git/ref/tags/v0.14.1": lightweightRef,
  "/releases/tags/v0.14.1": publishedRelease,
  "/contents/package.json?ref=": wrongNamePkg,
}), TAG, SHA, true), "package name mismatch rejected", "name mismatch");

expectThrow(() => validateRelease(mockApi({
  "/git/ref/tags/v0.14.1": lightweightRef,
  "/releases/tags/v0.14.1": publishedRelease,
  "/contents/package.json?ref=": wrongVersionPkg,
}), TAG, SHA, true), "package version mismatch rejected", "version mismatch");

expectThrow(() => validateRelease(happyApi, TAG, "0".repeat(40), true), "SHA mismatch manual rejected", "does not match");

// --- Summary ---
console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log("All validation tests passed");
