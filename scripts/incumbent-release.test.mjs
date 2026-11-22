import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
	incumbentReleaseRefusalMessage,
	resolveIncumbentMetadata,
	resolveIncumbentRelease,
	resolveIncumbentZip,
} from "./incumbent-release.mjs";

const repo = "damianvtran/local-operator-ui";
const tag = "v0.60.3";
const arch = "arm64";
const metadataAsset = {
	name: "latest-mac.yml",
	browser_download_url: "https://example.invalid/latest-mac.yml",
};
const zipAsset = {
	name: `local-operator-${arch}.zip`,
	browser_download_url: "https://example.invalid/zip",
};
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve("electron-builder"));
const { load } = createRequire(builder.resolve("app-builder-lib"))("js-yaml");

const secretBody = "API rate limit exceeded for the runner";
const rawPath = "/Users/runner/private/incumbent.yml";
const bodyURL = "https://example.invalid/raw-response";
const RAW_LOCATION = /http|www\.|\/Users\//i;
const ABSENCE_CLAIM = /publishes no|has no matching/i;
const resolve = (fetchImpl) =>
	resolveIncumbentRelease({ repo, tag, fetchImpl });
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });

function assertRefusal(result, reason, asset = "latest-mac.yml", stage = null) {
	assert.deepEqual(result, {
		ok: false,
		reason,
		tag,
		asset,
		...(stage ? { stage } : {}),
	});
	const message = incumbentReleaseRefusalMessage(result);
	assert.ok(message.includes(`failure class: ${reason};`), message);
	assert.ok(message.includes(tag), message);
	assert.ok(message.includes(`probed: ${asset}`), message);
	// The typed `http-<status>` label is allowed, but no other HTTP text is.
	assert.doesNotMatch(
		message.replace(`failure class: ${reason};`, ""),
		RAW_LOCATION,
	);
	if (stage === "metadata")
		assert.ok(message.includes("macOS metadata asset"), message);
	for (const raw of [
		secretBody,
		"Not Found",
		"Internal Server Error",
		"invalid JSON",
	]) {
		assert.ok(!message.includes(raw), message);
	}
	if (!reason.startsWith("missing-")) {
		assert.doesNotMatch(message, ABSENCE_CLAIM);
	}
}

test("a fetch rejection is a sanitized transport refusal, not asset absence", async () => {
	const result = await resolve(() => {
		throw new Error(`${secretBody}: ${bodyURL}`);
	});
	assertRefusal(result, "transport-error");
});

test("a rate-limited 403 is classified without reading or retaining its body", async () => {
	const response = json(
		{ message: secretBody, documentation_url: bodyURL },
		403,
	);
	assertRefusal(await resolve(() => response), "http-403");
	assert.equal(response.bodyUsed, false);
});

test("a 500 is an HTTP refusal, even if the body looks like a release", async () => {
	const response = json(
		{ assets: [metadataAsset], message: "Internal Server Error" },
		500,
	);
	assertRefusal(await resolve(() => response), "http-500");
	assert.equal(response.bodyUsed, false);
});

test("a 200 without an assets array does not prove asset absence", async () => {
	assertRefusal(
		await resolve(() => json({ message: "Not Found", url: bodyURL })),
		"unexpected-payload",
	);
});

test("unparseable JSON and malformed asset lists do not prove asset absence", async () => {
	assertRefusal(
		await resolve(() => new Response(`invalid JSON ${bodyURL}`)),
		"unexpected-payload",
	);
	assertRefusal(
		await resolve(() => json({ assets: [null] })),
		"unexpected-payload",
	);
});

test("only a readable asset list without latest-mac.yml proves metadata absence", async () => {
	assertRefusal(
		await resolve(() => json({ assets: [zipAsset] })),
		"missing-metadata-asset",
	);
});

const resolveMetadata = (fetchImpl, resolvedRelease = {}) =>
	resolveIncumbentMetadata({
		tag,
		arch,
		release: { assets: [metadataAsset, zipAsset] },
		metadataAsset,
		...resolvedRelease,
		parseMetadata: load,
		fetchImpl,
	});

const rawFailure = `${bodyURL} ${rawPath} ${secretBody}`;

test("a metadata download rejection is a sanitized transport refusal", async () => {
	const result = await resolveMetadata(() => {
		throw new Error(rawFailure);
	});
	assertRefusal(result, "transport-error", "latest-mac.yml", "metadata");
});

test("metadata download HTTP errors are classified without reading the body", async () => {
	const response = new Response(rawFailure, { status: 500 });
	const result = await resolveMetadata(() => response);
	assertRefusal(result, "http-500", "latest-mac.yml", "metadata");
	assert.equal(response.bodyUsed, false);
});

test("an invalid metadata asset reference is rejected without fetching", async () => {
	const fetchImpl = () => assert.fail("Invalid metadata reference fetched");
	assertRefusal(
		await resolveMetadata(fetchImpl, {
			metadataAsset: { name: metadataAsset.name },
		}),
		"unexpected-payload",
		"latest-mac.yml",
		"metadata",
	);
});

test("unreadable or malformed metadata is a sanitized refusal", async () => {
	assertRefusal(
		await resolveMetadata(() => ({
			ok: true,
			text: async () => {
				throw new Error(rawFailure);
			},
		})),
		"incumbent-metadata-malformed",
	);
	assertRefusal(
		await resolveMetadata(
			() => new Response(`files: !unknown '${rawFailure}'`),
		),
		"incumbent-metadata-malformed",
	);
});

test("parsed metadata without a files array cannot prove ZIP absence", async () => {
	assertRefusal(
		await resolveMetadata(() => new Response(`note: '${rawFailure}'`)),
		"unexpected-payload",
		"-arm64.zip",
	);
});

test("a release with metadata but no matching native ZIP is a distinct refusal", async () => {
	const result = await resolve(() => json({ assets: [metadataAsset] }));
	assert.equal(result.ok, true);
	const select = (files) =>
		resolveIncumbentZip({
			tag,
			arch,
			release: result.release,
			metadata: { files },
		});
	assertRefusal(
		select([{ url: "local-operator-x64.zip" }]),
		"missing-arch-zip",
		"-arm64.zip",
	);
	assertRefusal(
		select([{ url: zipAsset.name }]),
		"missing-arch-zip",
		"-arm64.zip",
	);
	assertRefusal(select([null]), "unexpected-payload", "-arm64.zip");
});

test("exact GitHub tag is fetched without credentials; metadata and the native ZIP resolve", async () => {
	const release = { assets: [zipAsset, metadataAsset] };
	const result = await resolve((...args) => {
		assert.deepEqual(args, [
			`https://api.github.com/repos/${repo}/releases/tags/${tag}`,
		]);
		return json(release);
	});
	assert.deepEqual(result, { ok: true, release, metadataAsset });
	const entry = { url: zipAsset.name, sha512: "fixture", size: 42 };
	assert.deepEqual(
		await resolveMetadata((...args) => {
			assert.deepEqual(args, [metadataAsset.browser_download_url]);
			return new Response(JSON.stringify({ files: [entry] }));
		}, result),
		{ ok: true, entry, zipAsset },
	);
});
