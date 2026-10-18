import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkDesignKit } from "./check-design-kit.mjs";

/*
 * The parity gate's own cases.
 *
 * Why these exist: the gate is the only thing that keeps `docs/design-kit/`
 * honest as a record — the slice (this tree's copy of the kit's brand data),
 * the lock (what the kit shipped at the ref), and the palettes the app renders
 * from are three things that can silently disagree, and each disagreement is a
 * different failure with a different fix. A gate that reads the wrong path, or
 * that passes a lock nothing re-checked, looks exactly like a gate that passes,
 * so each rule is pinned here in the direction that should fail — plus the
 * repository's own tree, which is what CI asserts on every pull request.
 *
 * Two deliberate shapes. The remote half cannot be exercised against the
 * network in tests, so an injected fake fetch returns the REAL slice bytes and
 * records its calls — "clean" here means the remote leg actually ran and
 * matched. And the brand half runs for real: the fixtures are scratch copies
 * in `mkdtemp`, mutated per case, never the repository's own tree.
 *
 * The three verdicts are asserted DISTINCT in the last case: the pin lying
 * (exit 1), brand values edited locally (exit 1), and a fetch that could not
 * look (exit 2, UNVERIFIED — never a pass and never drift).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLICE = join(ROOT, "docs", "design-kit");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Scratch roots, removed when the file's tests finish. */
const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A scratch copy of everything the gate reads — the slice, plus the two theme
 * files it re-derives — so a case's mutations never touch the real tree.
 */
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "lo-design-kit-"));
	scratch.push(root);
	cpSync(SLICE, join(root, "docs", "design-kit"), { recursive: true });
	const themeDir = join(root, "src", "renderer", "src", "shared", "themes");
	mkdirSync(join(themeDir, "palettes"), { recursive: true });
	cpSync(
		join(
			ROOT,
			"src",
			"renderer",
			"src",
			"shared",
			"themes",
			"palette-contract.ts",
		),
		join(themeDir, "palette-contract.ts"),
	);
	cpSync(
		join(
			ROOT,
			"src",
			"renderer",
			"src",
			"shared",
			"themes",
			"palettes",
			"local-operator.ts",
		),
		join(themeDir, "palettes", "local-operator.ts"),
	);
	return root;
}

/** The real slice bytes for one file — what an honest remote returns. */
const realSlice = (name) => readFileSync(join(SLICE, name));

/** Flip one hex digit so a hash is provably not the one the file has. */
const mangle = (hash) => `${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`;

/**
 * A fake anonymous fetch over the kit's raw.githubusercontent.com URLs, the
 * network seam the gate takes as `options.fetch`. Returns the real slice bytes
 * unless `tamper` names a file (whose bytes then differ from every hash), or
 * `fail` is set (a network error, for the could-not-verify cases). The calls
 * are recorded so a test can prove the remote leg actually ran.
 */
function kitRemote({ tamper = {}, fail = false } = {}) {
	const calls = [];
	const fn = async (url) => {
		calls.push(url);
		if (fail) throw new TypeError("fetch failed");
		const name = url.split("/").pop();
		if (name in tamper) return new Response(tamper[name], { status: 200 });
		return new Response(realSlice(name), { status: 200 });
	};
	return { fn, calls };
}

test("the repository's own slice matches its lock and the kit at the locked ref", async () => {
	const remote = kitRemote();
	const result = await checkDesignKit({ fetch: remote.fn });
	assert.equal(result.exitCode, 0);
	assert.deepEqual(result.findings, []);
	assert.deepEqual(result.unverified, []);
	// The pin is the kit and the tag a consumer can quote, and every file it
	// claims is one this repository actually vendors — an empty or partial
	// lock would otherwise pass silently.
	assert.equal(result.lock.kit, "damianvtran/local-operator-design");
	assert.equal(result.lock.version, "1.2.0");
	assert.equal(result.lock.ref, "v1.2.0");
	assert.deepEqual(Object.keys(result.lock.files).sort(), [
		"LICENSE",
		"app-family.json",
		"divergences.json",
	]);
	for (const [name, expected] of Object.entries(result.lock.files)) {
		assert.equal(sha256(realSlice(name)), expected, name);
	}
	// The remote leg ran, once per locked file, against the kit's own raw URLs.
	assert.equal(remote.calls.length, 3);
	for (const url of remote.calls) {
		assert.ok(
			url.startsWith(
				"https://raw.githubusercontent.com/damianvtran/local-operator-design/v1.2.0/",
			),
			url,
		);
	}
});

test("a lock hash that no longer matches its file fails as the pin lying", async () => {
	const root = fixture();
	const lockPath = join(root, "docs", "design-kit", "lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	lock.files["app-family.json"] = mangle(lock.files["app-family.json"]);
	writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
	const result = await checkDesignKit({ root, fetch: kitRemote().fn });
	assert.equal(result.exitCode, 1);
	const message = result.findings.find((f) => f.startsWith("the pin is lying"));
	assert.ok(
		message,
		`no family-1 message in ${JSON.stringify(result.findings)}`,
	);
	assert.match(
		message,
		/docs\/design-kit\/app-family\.json has sha256 [0-9a-f]{64}, but lock\.json records [0-9a-f]{64}/,
	);
	assert.match(message, /divergences\.json/);
});

test("a slice file edited by hand fails as the pin lying", async () => {
	const root = fixture();
	const file = join(root, "docs", "design-kit", "app-family.json");
	writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
	const result = await checkDesignKit({ root, fetch: kitRemote().fn });
	assert.equal(result.exitCode, 1);
	assert.equal(result.findings.length, 1);
	assert.match(
		result.findings[0],
		/docs\/design-kit\/app-family\.json has sha256 [0-9a-f]{64}, but lock\.json records [0-9a-f]{64}/,
	);
});

test("a file beside the locked slice fails as the pin lying", async () => {
	const root = fixture();
	writeFileSync(join(root, "docs", "design-kit", "notes.md"), "notes\n");
	const result = await checkDesignKit({ root, fetch: kitRemote().fn });
	assert.equal(result.exitCode, 1);
	assert.match(
		result.findings[0],
		/notes\.md sits beside the locked slice but is not in lock\.json/,
	);
});

test("a palette value edited without the kit fails as brand drift", async () => {
	const root = fixture();
	const palettePath = join(
		root,
		"src",
		"renderer",
		"src",
		"shared",
		"themes",
		"palettes",
		"local-operator.ts",
	);
	const source = readFileSync(palettePath, "utf8");
	assert.equal(
		source.split('"#137742"').length - 1,
		1,
		"the fixture expects exactly one #137742 in the light palette",
	);
	writeFileSync(palettePath, source.replace('"#137742"', '"#137743"'));
	const result = await checkDesignKit({ root, fetch: kitRemote().fn });
	assert.equal(result.exitCode, 1);
	const message = result.findings.find((f) =>
		f.includes("someone edited brand values locally"),
	);
	assert.ok(
		message,
		`no family-2 message in ${JSON.stringify(result.findings)}`,
	);
	assert.match(
		message,
		/\/palettes\/localOperatorLight\/values\/accent: this tree "#137743" vs vendored "#137742"/,
	);
	assert.match(message, /divergences\.json/);
});

test("a kit that no longer ships the locked bytes fails as the pin lying", async () => {
	const remote = kitRemote({ tamper: { "app-family.json": "tampered\n" } });
	const result = await checkDesignKit({ fetch: remote.fn });
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.unverified, []);
	assert.equal(result.findings.length, 1);
	assert.match(
		result.findings[0],
		/v1\.2\.0 on damianvtran\/local-operator-design ships app-family\.json with sha256 [0-9a-f]{64}, but lock\.json records [0-9a-f]{64}/,
	);
});

test("a fetch that cannot look is could-not-verify, never a pass and never drift", async () => {
	const result = await checkDesignKit({ fetch: kitRemote({ fail: true }).fn });
	assert.equal(result.exitCode, 2);
	assert.deepEqual(result.findings, []);
	assert.equal(result.unverified.length, 3);
	for (const line of result.unverified) {
		assert.match(line, /the pin is UNVERIFIED \(not verified-false\)/);
		assert.match(line, /rerun with network/);
	}
});

test("a non-200 answer is could-not-verify rather than drift", async () => {
	const notFound = async () => new Response("not found", { status: 404 });
	const result = await checkDesignKit({ fetch: notFound });
	assert.equal(result.exitCode, 2);
	assert.deepEqual(result.findings, []);
	assert.match(result.unverified[0], /answered HTTP 404/);
});

test("a network error is retried once before it counts as could-not-verify", async () => {
	let attempts = 0;
	const flaky = async (url) => {
		attempts += 1;
		if (attempts === 1) throw new TypeError("fetch failed");
		const name = url.split("/").pop();
		return new Response(realSlice(name), { status: 200 });
	};
	const result = await checkDesignKit({ fetch: flaky });
	assert.equal(result.exitCode, 0);
	assert.equal(attempts, 4, "one retry for one of the three fetches");
});

test("the two drift messages are distinct from each other and from the network message", async () => {
	// Family 1: the lock's record for app-family.json no longer matches the
	// file — and family 2: a palette value edited without the kit, in one run.
	const root = fixture();
	const lockPath = join(root, "docs", "design-kit", "lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	lock.files["app-family.json"] = mangle(lock.files["app-family.json"]);
	writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
	const palettePath = join(
		root,
		"src",
		"renderer",
		"src",
		"shared",
		"themes",
		"palettes",
		"local-operator.ts",
	);
	writeFileSync(
		palettePath,
		readFileSync(palettePath, "utf8").replace('"#137742"', '"#137743"'),
	);
	const drift = await checkDesignKit({ root, fetch: kitRemote().fn });
	const pin = drift.findings.find((f) => f.startsWith("the pin is lying"));
	const brand = drift.findings.find((f) =>
		f.includes("someone edited brand values locally"),
	);
	const network = (
		await checkDesignKit({ fetch: kitRemote({ fail: true }).fn })
	).unverified[0];
	assert.ok(pin && brand && network);
	assert.match(pin, /divergences\.json/);
	assert.match(brand, /divergences\.json/);
	assert.notEqual(pin, brand);
	assert.notEqual(pin, network);
	assert.notEqual(brand, network);
});
