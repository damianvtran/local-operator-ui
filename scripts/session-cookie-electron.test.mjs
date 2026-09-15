/**
 * Session-cookie persistence against the REAL runtime.
 *
 * Every other test of this feature runs against a fake jar, which is the right
 * shape for the policy and the ordering but proves nothing about Chromium. This
 * one runs the shipped module inside the pinned Electron binary, twice, against
 * two isolated user-data-dirs — which is what a restart is — and compares the
 * real cookie jars:
 *
 *   process 1  a page sets a battery of cookies; the vault stores the session-only
 *              ones; the jar is recorded before and after, beside what the
 *              ELECTRON cookie API reports (the naive design's entire input)
 *   process 2  a fresh profile: the vault restores, and the jar is compared
 *              attribute by attribute with process 1's
 *   process 3  a fresh profile again, but replaying the API-shaped dump through
 *              `session.cookies.set`: the flattening this feature exists to avoid
 *   process 4  a fresh profile with a refusing cipher against the real snapshot:
 *              nothing is restored
 *
 * WHY IT IS NOT IN `pnpm test:desktop`: that suite is node-only by construction,
 * and this needs a display — Electron will not start on a bare Linux runner, so
 * wiring it into the CI job would either fail there or become a test that always
 * skips. Run it with `pnpm test:session-cookies` on a machine with a session
 * (it launches no window, so it takes no focus).
 *
 * No window is created at any point: the scenario's only surface is an unattached
 * `WebContentsView`, in its own user-data-dir, and the runner is given an
 * environment with the session variables this machine's other sessions use
 * stripped out.
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const scenario = join(here, "session-cookie-electron-scenario.cjs");

/** The identity the two jars are compared by: name, scope and partition. */
const identity = (cookie) =>
	[
		cookie.name,
		cookie.domain,
		cookie.path,
		cookie.partitionKey
			? `${cookie.partitionKey.topLevelSite}|${cookie.partitionKey.hasCrossSiteAncestor}`
			: "unpartitioned",
	].join("\u0001");

/** The attributes this feature promises to carry across a restart. */
const shape = (cookie) => ({
	value: cookie.value,
	domain: cookie.domain,
	path: cookie.path,
	secure: cookie.secure,
	httpOnly: cookie.httpOnly,
	session: cookie.session,
	sameSite: cookie.sameSite ?? "unspecified",
	partitionKey: cookie.partitionKey ?? null,
	priority: cookie.priority ?? "Medium",
	sourceScheme: cookie.sourceScheme ?? null,
	sourcePort: cookie.sourcePort ?? null,
});

const skip =
	process.platform === "linux" && !process.env.DISPLAY
		? "Electron needs a display and this runner has none"
		: undefined;

let root;
let bundlePath;

const runScenario = (mode, env) =>
	new Promise((resolve, reject) => {
		const child = spawn(electronPath, [scenario], {
			env: {
				...env,
				SC_MODE: mode,
				SC_BUNDLE: bundlePath,
				PATH: process.env.PATH,
				// HOME is deliberately NOT overridden: `safeStorage` on macOS reaches the
				// login keychain, and a fake home would turn every restore in this file
				// into the keychain-unavailable path. Isolation comes from the scenario's
				// own `userData` and its own scratch directory, which is where every path
				// it writes is taken from.
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`scenario ${mode} timed out\n${out}\n${err}`));
		}, 90_000);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(new Error(`scenario ${mode} exited ${code}\n${out}\n${err}`));
				return;
			}
			resolve(readFileSync(env.SC_OUT, "utf8"));
		});
	});

/** Run one mode against one profile, and read the JSON it wrote. `profile` names
 * the user-data-dir: two runs that share it are a restart, and two that do not
 * are two app installs. */
let runCounter = 0;
const scenarioResult = async (mode, { profile = mode, ...extra } = {}) => {
	const userData = join(root, `ud-${profile}`);
	mkdirSync(userData, { recursive: true });
	runCounter += 1;
	const out = join(root, `${mode}-${profile}-${runCounter}.json`);
	const json = await runScenario(mode, {
		SC_USER_DATA: userData,
		SC_OUT: out,
		...extra,
	});
	return JSON.parse(json);
};

before(async () => {
	root = mkdtempSync(join(tmpdir(), "lop-session-cookie-electron-"));
	const bundle = await build({
		stdin: {
			contents: 'export * from "./src/main/browser/session-cookies";',
			resolveDir: repoRoot,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	bundlePath = join(root, "vault.mjs");
	writeFileSync(bundlePath, bundle.outputFiles[0].text);
});
after(() => {
	rmSync(root, { recursive: true, force: true });
});

test(
	"a session-only cookie survives a real restart, attributes and all",
	{ skip },
	async () => {
		const first = await scenarioResult("snapshot", { profile: "restart" });
		assert.equal(first.snapshot.written, true);
		assert.ok(
			first.snapshot.saved >= 4,
			`expected a real battery, saved ${first.snapshot.saved}`,
		);

		// The battery has to contain the hard cases or the rest proves nothing.
		const sessionCookies = first.before.filter(
			(cookie) => cookie.session === true,
		);
		const partitioned = sessionCookies.filter((cookie) => cookie.partitionKey);
		assert.ok(
			partitioned.length >= 2,
			"the battery must include partitioned (CHIPS) cookies",
		);
		assert.ok(
			sessionCookies.some(
				(cookie) => (cookie.sameSite ?? "unspecified") === "unspecified",
			),
			"the battery must include an unspecified-SameSite cookie",
		);
		assert.ok(
			sessionCookies.some((cookie) => cookie.httpOnly),
			"the battery must include an HttpOnly cookie",
		);
		assert.ok(
			sessionCookies.some((cookie) => cookie.priority === "High"),
			"the battery must include a non-default priority",
		);
		assert.ok(
			first.before.some((cookie) => cookie.session === false),
			"the battery must include a persistent cookie, to prove it is left alone",
		);

		// A restart: the SAME profile, a new process, and the jar empty of session
		// cookies exactly as Chromium leaves it.
		const second = await scenarioResult("restore", { profile: "restart" });
		assert.equal(second.restore.outcome, "restored");
		assert.deepEqual(second.restore.failed, []);
		assert.deepEqual(
			second.restore.drifted,
			[],
			"no attribute may drift on the way back",
		);

		const restored = new Map(
			second.jar.map((cookie) => [identity(cookie), cookie]),
		);
		const adjustedNames = [];
		for (const cookie of sessionCookies) {
			const live = restored.get(identity(cookie));
			assert.ok(
				live,
				`${cookie.name} was not restored (identity ${identity(cookie)})`,
			);
			const {
				sourceScheme: expectedScheme,
				sourcePort: expectedPort,
				...expected
			} = shape(cookie);
			const { sourceScheme, sourcePort, ...actual } = shape(live);
			assert.deepEqual(
				actual,
				expected,
				`${cookie.name} came back with different attributes`,
			);
			if (sourceScheme !== expectedScheme || sourcePort !== expectedPort) {
				// The ONE documented adjustment: Chromium refuses to create a Secure cookie
				// from an insecure source scheme, so a Secure cookie set from a
				// trustworthy-but-insecure origin comes back with its source scheme raised
				// to match the attribute it keeps. Anything else moving here is a bug.
				assert.equal(
					cookie.secure === true && cookie.sourceScheme !== "Secure",
					true,
					`${cookie.name}: source metadata moved for a reason this design does not allow for`,
				);
				assert.equal(sourceScheme, "Secure");
				assert.equal(sourcePort, 443);
				adjustedNames.push(cookie.name);
			}
		}
		// And the run says out loud which cookies it adjusted.
		assert.deepEqual(
			second.restore.adjusted.map((entry) => entry.name).sort(),
			adjustedNames.sort(),
		);

		// Nothing else may appear, and nothing may be duplicated: the restored jar is
		// the battery's session cookies — which the vault carried — beside the one
		// persistent cookie Chromium keeps on its own. That the vault stored ONLY the
		// session cookies is what the snapshot's own count pins: the jar held more
		// cookies than it saved, and the difference is the persistent one.
		assert.equal(
			first.snapshot.saved,
			sessionCookies.length,
			"the vault stored something other than the session cookies",
		);
		assert.ok(
			first.before.length > sessionCookies.length,
			"the jar had no persistent cookie, so the count above proves nothing",
		);
		assert.equal(
			second.jar
				.filter((cookie) => cookie.session === false)
				.map((cookie) => cookie.name)
				.join(),
			first.before
				.filter((cookie) => cookie.session === false)
				.map((cookie) => cookie.name)
				.join(),
			"the persistent cookies in the jar are the ones Chromium kept, not ones this feature wrote",
		);
		assert.equal(
			new Set(second.jar.map(identity)).size,
			second.jar.length,
			"a restore must not duplicate a cookie",
		);

		// And what is on disk is ciphertext, not a cookie jar.
		const snapshotFile = join(
			root,
			"ud-restart",
			"browser",
			"session-cookies.enc",
		);
		const bytes = readFileSync(snapshotFile);
		for (const cookie of sessionCookies) {
			assert.equal(
				bytes.includes(Buffer.from(cookie.value)),
				false,
				`the value of ${cookie.name} is readable in the stored snapshot`,
			);
		}
		assert.equal(statSync(snapshotFile).mode & 0o777, 0o600);
	},
);

test(
	"the naive channel is not equivalent: it loses the partition key in a real jar",
	{ skip },
	async () => {
		// The same battery and the same snapshot, replayed the way a design built on
		// `session.cookies.get()` -> `set()` would replay it. This is the guard's
		// non-vacuous half: the failure mode is measured against a real jar, not
		// asserted about a stub.
		const first = await scenarioResult("snapshot", { profile: "naive" });
		const apiDump = join(root, "api-view.json");
		writeFileSync(apiDump, JSON.stringify(first.apiView));
		const naive = await scenarioResult("naive-restore", { SC_IN: apiDump });

		// A partitioned cookie was in the battery (asserted above), and the CHIPS
		// partition key is exactly what the Electron cookie API cannot report.
		const original = first.before.find(
			(cookie) => cookie.name === "chips_part",
		);
		assert.ok(
			original?.partitionKey,
			"the battery's partitioned cookie is missing",
		);
		const site = original.partitionKey.topLevelSite;
		const replayed = naive.jar.filter((cookie) => cookie.name === "chips_part");
		assert.ok(
			replayed.length >= 1,
			"the naive replay stored the cookie at all",
		);
		assert.equal(
			replayed.some((cookie) => cookie.partitionKey?.topLevelSite === site),
			false,
			"the naive replay kept the partition key, so this test no longer proves anything",
		);
		assert.equal(
			replayed.every((cookie) => !cookie.partitionKey),
			true,
			"the naive replay stored a partitioned cookie without its key: it is now offered to every top-level site",
		);
	},
);

test(
	"a cipher that refuses restores nothing, even against a real snapshot",
	{ skip },
	async () => {
		const first = await scenarioResult("snapshot", { profile: "refused" });
		assert.equal(first.snapshot.written, true);
		const refused = await scenarioResult("failclosed", { profile: "refused" });
		assert.equal(refused.restore.outcome, "cipher-unavailable");
		assert.equal(refused.restore.restored, 0);
		// Nothing SESSION-shaped may be restored. What is in the jar is the battery's
		// one persistent cookie, which Chromium itself kept — and its presence is the
		// control this test needs: the session cookies were genuinely gone before the
		// restore ran, because they are gone from the same profile.
		assert.deepEqual(
			refused.jar.filter((cookie) => cookie.session === true),
			[],
			"a session cookie was restored without a keychain",
		);
		assert.deepEqual(
			refused.jar.map((cookie) => cookie.name),
			["persistent_a"],
			"only the cookie Chromium persists on its own may be here",
		);
	},
);
