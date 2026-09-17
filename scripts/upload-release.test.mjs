#!/usr/bin/env node
/**
 * The attach path's recovery branches, driven against a local stub endpoint and a
 * fixture `gh`.
 *
 * WHY A STUB RATHER THAN A RELEASE. Every branch that matters here is a property of
 * the UPLOAD ENDPOINT: it creates an asset record the moment an upload starts
 * (`state: "starter"`), it can stall, it can answer 5xx, it refuses a duplicate name.
 * This path cannot be exercised against the real thing without cutting a release, and
 * on 2026-09-16 cutting one was exactly what could not be done: after v0.26.5
 * published at 12:15Z, four attempts by three sessions died at this step, because a
 * POST of the 158 MB arm64 dmg stalled, the job hung until it failed, and the
 * `starter` record it left behind made every later attempt fail over a name it held.
 * So the endpoint is stubbed locally and each of those branches is a case below:
 *
 *   (a) the first attempt stalls, the second succeeds -> the upload is retried (the
 *       `starter` record the stalled attempt left is removed first, or the retry's own
 *       POST would be refused over the duplicate name) and the run is green;
 *   (b) a `starter` asset is already on the release -> deleted and re-uploaded;
 *   (c) a complete asset of the same name and size -> skipped, nothing re-uploaded;
 *   (d) a complete asset of the same name at a different size -> refused by name, with
 *       both sizes, and nothing uploaded.
 *
 * WHAT IS REAL HERE. The transport is `streamUpload` itself -- a streamed request
 * body, a `content-length` taken from the file, a per-attempt deadline -- and the
 * retry policy is `uploadArtifact`'s own, driven with a test-sized deadline and
 * backoff. The stub sees the real bytes the real client sent, which is why the
 * assertions below can read the received byte count and the request headers rather
 * than a restatement of what the code is assumed to send.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	streamUpload,
	uploadArtifact,
	uploadRelease,
} from "./upload-release.mjs";

const REPO = "damianvtran/local-operator-ui";
const RELEASE_ID = 389357596;
const TAG = "v0.26.5";
const SHA = "3becfb9c462f6adb1f47f9815767f5522755f849";
const TOKEN = "fixture-token";

const UPLOAD_SCRIPT = fileURLToPath(
	new URL("../scripts/upload-release.mjs", import.meta.url),
);

/**
 * The endpoint, as a stub: `respond(request, index)` answers for one request, and
 * returning nothing at all (`undefined` or `null`) means ACCEPT THE REQUEST AND NEVER
 * ANSWER IT -- the stall that broke v0.26.5, where the client has to give up on its
 * own deadline because the endpoint never will.
 *
 * Requests are recorded as they arrive, including the byte count actually received,
 * so a case can assert what the client sent rather than what it meant to send.
 */
async function withStubEndpoint(respond, run) {
	const requests = [];
	const sockets = new Set();
	const server = createServer((request, response) => {
		sockets.add(request.socket);
		let bytes = 0;
		request.on("data", (chunk) => {
			bytes += chunk.length;
		});
		// An aborted attempt is a case under test, not an error: the client closing the
		// socket mid-body is what a timeout looks like from this side.
		request.on("error", () => {});
		request.on("end", () => {
			const record = {
				url: request.url,
				contentLength: request.headers["content-length"],
				transferEncoding: request.headers["transfer-encoding"],
				contentType: request.headers["content-type"],
				authorization: request.headers.authorization,
				bytes,
			};
			requests.push(record);
			const answer = respond(record, requests.length - 1);
			if (!answer) return;
			setTimeout(() => {
				if (response.writableEnded) return;
				response.writeHead(answer.status, {
					"content-type": "application/json",
				});
				response.end(answer.body ?? "");
			}, answer.delayMs ?? 0);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	try {
		return await run({ baseUrl, requests });
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
	}
}

/**
 * The release as GitHub reports it: one asset list that the stubbed endpoint, the
 * deletion path and the reads all agree on. A case that leaves a `starter` record
 * behind mutates this list the way the endpoint would, so "what is already attached"
 * is one mutable truth rather than a fixture per call.
 */
function releaseState(assets = []) {
	const state = {
		assets: [...assets],
		removed: [],
		uploads: 0,
	};
	state.api = (path) => {
		if (path.startsWith(`/releases/${RELEASE_ID}/assets?`)) {
			// The page comes from the query's own `page=` parameter: `per_page=` carries the
			// same substring, so splitting on `page=` reads the page size as the page.
			const page = Number(path.match(/[?&]page=(\d+)$/)?.[1] ?? "0");
			return page === 1 ? state.assets : [];
		}
		throw new Error(`Unexpected API path: ${path}`);
	};
	// The endpoint's view of a started upload: the record exists (and is incomplete)
	// before a single byte is acknowledged.
	state.beginUpload = (asset) => {
		state.assets = [...state.assets, asset];
	};
	state.completeUpload = (asset) => {
		state.assets = [
			...state.assets.filter((existing) => existing.id !== asset.id),
			asset,
		];
	};
	state.remove = (asset) => {
		state.removed.push(asset);
		state.assets = state.assets.filter((existing) => existing.id !== asset.id);
	};
	// The reads the attach path makes beyond the asset list: the tag, the release and
	// the package.json at the tag, as `validate-release.mjs` pins them.
	state.attachApi = (path) => {
		if (path === `/git/ref/tags/${TAG}`) {
			return { ref: `refs/tags/${TAG}`, object: { type: "commit", sha: SHA } };
		}
		if (path === `/releases/tags/${TAG}`) {
			return {
				id: RELEASE_ID,
				tag_name: TAG,
				draft: false,
				prerelease: true,
				published_at: "2026-09-16T12:15:00Z",
				body: "## What's New\n\nfixture\n",
			};
		}
		if (path === `/contents/package.json?ref=${SHA}`) {
			return {
				content: Buffer.from(
					JSON.stringify({
						name: "local-operator-ui",
						version: TAG.slice(1),
					}),
				).toString("base64"),
			};
		}
		return state.api(path);
	};
	return state;
}

function writeArtifact(dir, name, bytes) {
	const path = join(dir, name);
	writeFileSync(path, Buffer.alloc(bytes, 7));
	return path;
}

/**
 * A case's world: a temporary directory holding the artifact, torn down whatever the
 * case does. `body` receives the directory and the base URL of the stub endpoint.
 */
async function withArtifactDir(body) {
	const dir = mkdtempSync(join(tmpdir(), "upload-release-test-"));
	try {
		return await body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// The attempt/backoff budget the cases below run with: the real policy, at a size a
// test can afford. Nothing waits for real backoff -- the sleep is a no-op -- so a
// retry is proven by the requests the stub saw, not by elapsed time.
const TEST_RETRY = {
	attempts: 2,
	backoffMs: 1,
	sleep: () => {},
	log: () => {},
};

test("(a) a stalled attempt is retried, and the starter record it left is removed first", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 4096);
		const state = releaseState();
		await withStubEndpoint(
			(_request, index) => {
				if (index === 0) {
					// The upload begins, so the record exists; then the endpoint never
					// answers. This is the state the next attempt must repair, because
					// GitHub refuses a duplicate name and the retry's POST would be
					// refused over this very record.
					state.beginUpload({
						id: 9001,
						name: "app.dmg",
						state: "starter",
						size: 0,
					});
					return null;
				}
				state.completeUpload({
					id: 9002,
					name: "app.dmg",
					state: "uploaded",
					size: 4096,
				});
				return {
					status: 201,
					body: JSON.stringify({ id: 9002, name: "app.dmg" }),
				};
			},
			async ({ baseUrl, requests }) => {
				const uploaded = await uploadRelease({
					api: state.attachApi,
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: RELEASE_ID,
					files: [path],
					upload: (releaseId, artifact) =>
						streamUpload({
							baseUrl,
							repo: REPO,
							releaseId,
							artifact,
							token: TOKEN,
							timeoutMs: 250,
						}),
					remove: state.remove,
					...TEST_RETRY,
				});
				assert.equal(uploaded.release_id, RELEASE_ID);
				// Two attempts, and the second one carried the whole file.
				assert.equal(requests.length, 2);
				assert.deepEqual(
					requests.map((request) => request.bytes),
					[4096, 4096],
				);
				assert.match(
					requests[0].url,
					/releases\/389357596\/assets\?name=app\.dmg$/,
				);
				assert.equal(requests[0].authorization, `Bearer ${TOKEN}`);
				assert.equal(requests[0].contentType, "application/octet-stream");
			},
		);
		// The wreckage was removed before the retry, and what is left on the release is
		// the complete asset the endpoint acknowledged.
		assert.deepEqual(
			state.removed.map((asset) => asset.id),
			[9001],
		);
		assert.deepEqual(
			state.assets.map((asset) => [asset.name, asset.state, asset.size]),
			[["app.dmg", "uploaded", 4096]],
		);
	});
});

test("(a) a 5xx is retried, and the endpoint's own message is reported when it is not", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 1024);
		const state = releaseState();
		await withStubEndpoint(
			(_request, index) =>
				index === 0
					? { status: 502, body: '{"message":"Bad Gateway"}' }
					: {
							status: 201,
							body: JSON.stringify({ id: 9003, name: "app.dmg" }),
						},
			async ({ baseUrl, requests }) => {
				const logs = [];
				await uploadRelease({
					api: state.attachApi,
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: RELEASE_ID,
					files: [path],
					upload: (releaseId, artifact) =>
						streamUpload({
							baseUrl,
							repo: REPO,
							releaseId,
							artifact,
							token: TOKEN,
							timeoutMs: 5000,
						}),
					remove: state.remove,
					...TEST_RETRY,
					log: (line) => logs.push(line),
				});
				assert.equal(requests.length, 2);
				assert.match(
					logs.join("\n"),
					/Attempt 1 of 2 failed for app\.dmg: app\.dmg: HTTP 502 from the upload endpoint: Bad Gateway; retrying in 1 ms/,
				);
			},
		);
	});
});

test("(a) an exhausted retry budget reports the status and the file, never a collision", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 512);
		const state = releaseState();
		await withStubEndpoint(
			() => ({ status: 503, body: '{"message":"Service Unavailable"}' }),
			async ({ baseUrl, requests }) => {
				let failure;
				try {
					await uploadArtifact({
						api: state.api,
						releaseId: RELEASE_ID,
						artifact: { path, name: "app.dmg", size: 512 },
						attempt: (artifact) =>
							streamUpload({
								baseUrl,
								repo: REPO,
								releaseId: RELEASE_ID,
								artifact,
								token: TOKEN,
								timeoutMs: 5000,
							}),
						remove: state.remove,
						attempts: 3,
						backoffMs: 1,
						sleep: () => {},
						log: () => {},
					});
				} catch (error) {
					failure = error;
				}
				assert.ok(failure, "a 5xx on every attempt must fail the run");
				assert.match(
					failure.message,
					/Asset upload failed on attempt 3 of 3: app\.dmg: HTTP 503 from the upload endpoint: Service Unavailable/,
				);
				// The word that sent a reader hunting for an asset name conflict while the
				// real fault was an upload that never finished.
				assert.doesNotMatch(failure.message, /collision/i);
				assert.equal(requests.length, 3);
			},
		);
	});
});

test("(a) a stall that never clears fails on the deadline, naming the file and the timeout", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 256);
		const state = releaseState();
		await withStubEndpoint(
			() => null,
			async ({ baseUrl, requests }) => {
				let failure;
				try {
					await uploadArtifact({
						api: state.api,
						releaseId: RELEASE_ID,
						artifact: { path, name: "app.dmg", size: 256 },
						attempt: (artifact) =>
							streamUpload({
								baseUrl,
								repo: REPO,
								releaseId: RELEASE_ID,
								artifact,
								token: TOKEN,
								timeoutMs: 200,
							}),
						remove: state.remove,
						attempts: 2,
						backoffMs: 1,
						sleep: () => {},
						log: () => {},
					});
				} catch (error) {
					failure = error;
				}
				assert.ok(failure, "a stall must not be reported as success");
				// Bounded, and it says which bound: the job that hung until the runner's
				// own limit had neither a deadline nor a retry to name.
				assert.match(failure.message, /app\.dmg: TimeoutError/);
				assert.match(failure.message, /after a 0\.2s attempt deadline/);
				assert.match(failure.message, /attempt 2 of 2/);
				assert.equal(requests.length, 2);
			},
		);
	});
});

test("(a) a 4xx is an answer, not a fault to wait out: one attempt, the endpoint's message", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 128);
		const state = releaseState();
		await withStubEndpoint(
			() => ({
				status: 422,
				body: '{"message":"Validation Failed","errors":[{"message":"already_exists"}]}',
			}),
			async ({ baseUrl, requests }) => {
				let failure;
				try {
					await uploadArtifact({
						api: state.api,
						releaseId: RELEASE_ID,
						artifact: { path, name: "app.dmg", size: 128 },
						attempt: (artifact) =>
							streamUpload({
								baseUrl,
								repo: REPO,
								releaseId: RELEASE_ID,
								artifact,
								token: TOKEN,
								timeoutMs: 5000,
							}),
						remove: state.remove,
						attempts: 3,
						backoffMs: 1,
						sleep: () => {},
						log: () => {},
					});
				} catch (error) {
					failure = error;
				}
				assert.ok(failure, "a 422 must fail the run");
				assert.match(
					failure.message,
					/attempt 1 of 3: app\.dmg: HTTP 422 from the upload endpoint: Validation Failed; already_exists/,
				);
				assert.equal(requests.length, 1);
			},
		);
	});
});

test("(b) a starter asset already on the release is deleted and re-uploaded", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 2048);
		const state = releaseState([
			{ id: 9101, name: "app.dmg", state: "starter", size: 0 },
		]);
		await withStubEndpoint(
			() => ({ status: 201, body: JSON.stringify({ id: 9102 }) }),
			async ({ baseUrl, requests }) => {
				const logs = [];
				await uploadRelease({
					api: state.attachApi,
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: RELEASE_ID,
					files: [path],
					upload: (releaseId, artifact) =>
						streamUpload({
							baseUrl,
							repo: REPO,
							releaseId,
							artifact,
							token: TOKEN,
							timeoutMs: 5000,
						}),
					remove: state.remove,
					...TEST_RETRY,
					log: (line) => logs.push(line),
				});
				assert.equal(requests.length, 1);
				assert.match(
					logs.join("\n"),
					/Removed an incomplete upload of app\.dmg \(asset 9101, state starter\)/,
				);
				assert.match(
					logs.join("\n"),
					/Uploaded app\.dmg \(2048 bytes\) to release 389357596 \[HTTP 201\]/,
				);
			},
		);
		assert.deepEqual(
			state.removed.map((asset) => asset.id),
			[9101],
		);
	});
});

test("(c) a complete asset of the same name and size is skipped, not re-uploaded", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 4096);
		const state = releaseState([
			{ id: 9201, name: "app.dmg", state: "uploaded", size: 4096 },
		]);
		await withStubEndpoint(
			() => ({ status: 201, body: "" }),
			async ({ baseUrl, requests }) => {
				const logs = [];
				await uploadRelease({
					api: state.attachApi,
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: RELEASE_ID,
					files: [path],
					upload: (releaseId, artifact) =>
						streamUpload({
							baseUrl,
							repo: REPO,
							releaseId,
							artifact,
							token: TOKEN,
							timeoutMs: 5000,
						}),
					remove: state.remove,
					...TEST_RETRY,
					log: (line) => logs.push(line),
				});
				// A re-run over an intact release writes nothing at all.
				assert.equal(requests.length, 0);
				assert.match(
					logs.join("\n"),
					/Already attached at this size, nothing to upload: app\.dmg \(4096 bytes, asset 9201\)/,
				);
			},
		);
		assert.deepEqual(state.removed, []);
		assert.deepEqual(state.assets, [
			{ id: 9201, name: "app.dmg", state: "uploaded", size: 4096 },
		]);
	});
});

test("(d) a complete asset of this name at another size is refused, naming both sizes", async () => {
	await withArtifactDir(async (dir) => {
		const path = writeArtifact(dir, "app.dmg", 4096);
		const state = releaseState([
			{ id: 9301, name: "app.dmg", state: "uploaded", size: 999 },
		]);
		await withStubEndpoint(
			() => ({ status: 201, body: "" }),
			async ({ baseUrl, requests }) => {
				let failure;
				try {
					await uploadRelease({
						api: state.attachApi,
						tag: TAG,
						expectedSha: SHA,
						expectedReleaseId: RELEASE_ID,
						files: [path],
						upload: (releaseId, artifact) =>
							streamUpload({
								baseUrl,
								repo: REPO,
								releaseId,
								artifact,
								token: TOKEN,
								timeoutMs: 5000,
							}),
						remove: state.remove,
						...TEST_RETRY,
					});
				} catch (error) {
					failure = error;
				}
				assert.ok(
					failure,
					"a complete asset at another size must stop the run",
				);
				assert.match(
					failure.message,
					/app\.dmg is already attached to this release with a different size: attached 999 bytes, this build's 4096 bytes/,
				);
				// Refused before any write: not uploaded, not deleted.
				assert.equal(requests.length, 0);
			},
		);
		assert.deepEqual(state.removed, []);
		assert.deepEqual(
			state.assets.map((asset) => [asset.id, asset.size]),
			[[9301, 999]],
		);
	});
});

/**
 * The whole entry point, as the workflow drives it: the real script, a fixture `gh` as
 * the only one on PATH, artifacts laid out by the download-artifact step, and the
 * upload pointed at the stub. This is the case that proves the two behaviours nothing
 * else can: that a re-run repairs a partially-attached release end to end (the
 * DELETE it sends, the bytes it streams, and the artifact it leaves alone), and that
 * the repair still refuses to touch a complete asset.
 */
test("the CLI repairs a partially-attached release: starter deleted, same-size skipped, the rest uploaded", async () => {
	const dir = mkdtempSync(join(tmpdir(), "upload-release-cli-"));
	try {
		const artifacts = join(dir, "artifacts");
		const files = {
			"macos-artifacts/app.dmg": 1_048_576,
			"macos-artifacts/latest-mac.yml": 64,
			"windows-artifacts/app.exe": 4096,
			"windows-artifacts/latest.yml": 32,
			"linux-artifacts/app.deb": 2048,
			"linux-artifacts/latest-linux.yml": 16,
		};
		for (const [relative, bytes] of Object.entries(files)) {
			const path = join(artifacts, relative);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, Buffer.alloc(bytes, 7));
		}
		// What the failed attempt of 2026-09-16 left behind: the mac dmg completed on
		// v0.26.5, while the windows installer's upload stalled and was never
		// finished -- the two states a re-run has to tell apart.
		const state = releaseState([
			{ id: 9301, name: "app.dmg", state: "uploaded", size: 1_048_576 },
			{ id: 9302, name: "app.exe", state: "starter", size: 0 },
		]);
		const calls = join(dir, "calls");
		const fixtures = join(dir, "fixtures.json");
		const fixturesFixture = {
			[`/git/ref/tags/${TAG}`]: {
				ref: `refs/tags/${TAG}`,
				object: { type: "commit", sha: SHA },
			},
			[`/releases/tags/${TAG}`]: state.attachApi(`/releases/tags/${TAG}`),
			[`/contents/package.json?ref=${SHA}`]: state.attachApi(
				`/contents/package.json?ref=${SHA}`,
			),
			[`/releases/${RELEASE_ID}/assets?per_page=100&page=1`]: state.assets,
		};
		const writeFixtures = () =>
			writeFileSync(
				fixtures,
				JSON.stringify({
					...fixturesFixture,
					[`/releases/${RELEASE_ID}/assets?per_page=100&page=1`]: state.assets,
				}),
			);
		writeFixtures();
		// The fixture `gh` is the only one on the child's PATH, so a silent fallback to
		// the real CLI -- and a live DELETE against the operator's repository -- cannot
		// happen. A DELETE is applied to the fixtures the reads answer from, because
		// that is what the endpoint would do.
		writeFileSync(
			join(dir, "gh"),
			`#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS_FILE, JSON.stringify(args) + '\\n');
const fixtures = JSON.parse(readFileSync(process.env.FIXTURES_FILE, 'utf8'));
if (args.includes('--method')) {
  const target = args[args.length - 1].slice(('repos/' + process.env.GITHUB_REPOSITORY).length);
  if (args[2] !== 'DELETE' || !target.startsWith('/releases/assets/')) {
    process.stderr.write('unexpected write ' + args.join(' ') + '\\n');
    process.exit(1);
  }
  const id = Number(target.split('/').pop());
  const assetsPath = '/releases/${RELEASE_ID}/assets?per_page=100&page=1';
  const assets = fixtures[assetsPath].filter((asset) => asset.id !== id);
  writeFileSync(process.env.FIXTURES_FILE, JSON.stringify({ ...fixtures, [assetsPath]: assets }));
  process.exit(0);
}
const key = args[1].slice(('repos/' + process.env.GITHUB_REPOSITORY).length);
if (!(key in fixtures)) {
  process.stderr.write('unexpected path ' + key + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(fixtures[key]));
`,
			{ mode: 0o755 },
		);
		let failure;
		await withStubEndpoint(
			() => ({ status: 201, body: JSON.stringify({ id: 9400 }) }),
			async ({ baseUrl, requests }) => {
				const { code, stdout, stderr } = await runCli(UPLOAD_SCRIPT, {
					cwd: dir,
					env: {
						PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
						CALLS_FILE: calls,
						FIXTURES_FILE: fixtures,
						ARTIFACTS_DIR: artifacts,
						GITHUB_UPLOADS_URL: baseUrl,
						GITHUB_REPOSITORY: REPO,
						GH_TOKEN: TOKEN,
						RELEASE_TAG: TAG,
						EXPECTED_SOURCE_SHA: SHA,
						EXPECTED_RELEASE_ID: String(RELEASE_ID),
					},
				});
				if (code !== 0) failure = `${stdout}\n${stderr}`;
				assert.equal(code, 0, failure);
				// Uploaded: everything except the complete mac dmg.
				assert.deepEqual(
					requests
						.map((request) =>
							new URL(request.url, "http://stub").searchParams.get("name"),
						)
						.sort(),
					[
						"app.deb",
						"app.exe",
						"latest-linux.yml",
						"latest-mac.yml",
						"latest.yml",
					],
				);
				// Each streamed body carried the file's own byte count, taken from disk
				// rather than from a buffer of it.
				for (const request of requests) {
					const name = new URL(request.url, "http://stub").searchParams.get(
						"name",
					);
					const onDisk = statSync(join(artifacts, platformDir(name), name));
					assert.equal(request.bytes, onDisk.size, name);
					assert.equal(request.contentLength, String(onDisk.size), name);
					// A length-delimited streamed body, not an unbounded chunked one: the
					// endpoint can tell a truncated upload from a complete file.
					assert.equal(request.transferEncoding, undefined, name);
				}
				assert.match(
					stdout,
					/Already attached at this size, nothing to upload: app\.dmg \(1048576 bytes, asset 9301\)/,
				);
				assert.match(
					stdout,
					/Removed an incomplete upload of app\.exe \(asset 9302, state starter\)/,
				);
			},
		);
		// The one write the repair made to the release's records, addressed by ID.
		assert.deepEqual(
			readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter((argv) => argv.includes("--method")),
			[["api", "--method", "DELETE", `repos/${REPO}/releases/assets/9302`]],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** The artifacts directory an artifact's name belongs to, as the workflow lays it out. */
function platformDir(name) {
	if (name.startsWith("latest-mac") || name.endsWith(".dmg"))
		return "macos-artifacts";
	if (name.startsWith("latest-linux") || name.endsWith(".deb"))
		return "linux-artifacts";
	return "windows-artifacts";
}

/** The CLI, run to completion: the exit code and both streams are what a run reports. */
function runCli(script, { cwd, env }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [script], { cwd, env });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}
