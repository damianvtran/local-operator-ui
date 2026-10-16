/* Cheap fixture/oracle controls. Native UI acceptance is ONLY the CI app run;
 * this suite never launches Electron or claims rendered evidence. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this suite ships in, for reading the pinned control revision. */
const REPO = dirname(
	dirname(fileURLToPath(new URL("./asks-app-regression.mjs", import.meta.url))),
);
import { test } from "node:test";
import {
	ASK_SESSION_IDS,
	askFixture,
	sessionSnapshot,
	startAsksAppFixture,
} from "./asks-app-fixture.mjs";
import {
	ASKS_CONTROL,
	ASKS_CONTROL_PINNED,
	expectedRailClose,
	resolveAsksControl,
} from "./asks-app-regression.mjs";
import { categoryOf, flagsFor } from "./ci-scope.mjs";

test("the historical source control expects restoration; candidate must empty", () => {
	assert.equal(expectedRailClose("control"), true);
	assert.equal(expectedRailClose("candidate"), false);
	assert.throws(() => expectedRailClose("invented"));
	// The PINNED historical revision is the provenance record; it is no longer
	// what boots (see the rule below), so this asserts the record held rather
	// than that the run uses it.
	assert.equal(ASKS_CONTROL_PINNED, "2461cfa3f3beaa1124727a9de93dfe01c4381b0d");
});

test("the control revision is DERIVED, and satisfies the reuse assertion by construction", () => {
	/*
	 * The rule that keeps the producer alive as `main` moves: the control is the
	 * base the candidate was built from, not a pinned historical commit. A pin
	 * cannot satisfy `prepareControl`'s byte-identity requirement once main has
	 * moved past it, which is exactly how run 38916579072 died
	 * (`control reuse mismatch src/main`).
	 *
	 * Driven against the real repository, not described: whatever
	 * `resolveAsksControl()` returns must be a revision whose four reused parts
	 * are byte-identical to this HEAD's. That is the same assertion the producer
	 * makes at boot, so this test fails for the same reason the producer would.
	 */
	// ASKS_CONTROL, not the resolver: the boot uses the CONSTANT, so asserting on
	// the function would let a caller swap in the pin and keep this green - which
	// is exactly the defect the test exists to catch (mutation-checked by pointing
	// ASKS_CONTROL at ASKS_CONTROL_PINNED, which fails it).
	assert.equal(
		ASKS_CONTROL,
		resolveAsksControl(),
		"the booted control must be the derived one, not a constant that bypasses the derivation",
	);
	const base = ASKS_CONTROL;
	assert.match(
		base,
		/^[0-9a-f]{40}$/,
		`the control must resolve to a full commit sha, got ${JSON.stringify(base)}`,
	);
	/*
	 * THE COMPARISON NEEDS BOTH TREES, AND A SHALLOW CLONE MAY NOT HAVE THE
	 * CONTROL'S. `pnpm test:desktop` runs under `actions/checkout`, whose default
	 * is a depth-1 (or depth-2) fetch: the control commit object is there - it is
	 * the merge base - but its TREE is not, so `git rev-parse <sha>:src/main` dies
	 * with `fatal: path 'src/main' exists on disk, but not in <sha>` and the test
	 * throws instead of reporting what it can. That is a property of the clone,
	 * not of the change: the same test is the real assertion in a full checkout
	 * (a developer's tree, or CI's own npX leg which fetches the control), and it
	 * is still worth running there.
	 *
	 * So the trees are PROBED first, and an unreadable one is reported as skipped
	 * with the reason rather than thrown. The probe is deliberately narrow: a
	 * clone that HAS both trees runs every assertion below unchanged, and the
	 * mutation check for this guard is what proves it still catches a genuine
	 * disagreement (see the PR discussion: pointing ASKS_CONTROL at a revision
	 * whose tree IS present fails it).
	 */
	const readable = [base, "HEAD"].every(
		(rev) =>
			spawnSync("git", ["cat-file", "-e", `${rev}^{tree}`], { cwd: REPO })
				.status === 0,
	);
	if (!readable) {
		console.log(
			`asks-app-regression: the control ${base} or HEAD has no readable tree in this clone (shallow checkout); the byte-identity assertion is skipped here and runs in a full checkout`,
		);
		return;
	}
	for (const part of [
		"src/main",
		"src/preload",
		"electron.vite.config.js",
		"pnpm-lock.yaml",
	]) {
		const atControl = execFileSync("git", ["rev-parse", `${base}:${part}`], {
			encoding: "utf8",
			cwd: REPO,
		}).trim();
		const atHead = execFileSync("git", ["rev-parse", `HEAD:${part}`], {
			encoding: "utf8",
			cwd: REPO,
		}).trim();
		assert.equal(
			atControl,
			atHead,
			`the derived control ${base} disagrees with HEAD on ${part}; the producer would refuse to boot the control leg`,
		);
	}
	/*
	 * And the derivation is not accidental: the branch must not touch the reused
	 * parts, or "the merge-base is byte-identical" would be a coincidence rather
	 * than a property. This is the claim the derivation rests on.
	 */
	const touched = execFileSync(
		"git",
		[
			"diff",
			"--name-only",
			base,
			"HEAD",
			"--",
			"src/main",
			"src/preload",
			"electron.vite.config.js",
			"pnpm-lock.yaml",
		],
		{ encoding: "utf8", cwd: REPO },
	).trim();
	assert.equal(
		touched,
		"",
		`this branch changes the control leg's reused parts, so a merge-base control cannot be byte-identical: ${touched}`,
	);
});
test("synthetic canonical snapshot is open, bounded and session-scoped", () => {
	const ask = askFixture(1000000000000);
	assert.equal(ask.expires_at - ask.created_at, 3600000);
	const a = sessionSnapshot(ASK_SESSION_IDS[0], ask);
	assert.equal(a.payload.frontend.state_version, 1);
	assert.equal(a.payload.frontend.snapshot.asks[0].status, "open");
	assert.equal(
		sessionSnapshot(ASK_SESSION_IDS[1], ask).payload.frontend.snapshot.asks
			.length,
		0,
	);
});
test("real loopback fixture refuses credentials and writes and serves canonical reads", async () => {
	const root = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "asks-contract-"),
	);
	const fixture = await startAsksAppFixture({
		root,
		port: 0,
		token: "synthetic-local-only",
	});
	try {
		assert.equal(
			(await fetch(`${fixture.url}/v1/desktop/sessions`)).status,
			401,
		);
		const headers = { Authorization: "Bearer synthetic-local-only" };
		const sessions = await (
			await fetch(`${fixture.url}/v1/desktop/sessions`, { headers })
		).json();
		assert.deepEqual(
			sessions.result.sessions.map((x) => x.id),
			ASK_SESSION_IDS,
		);
		assert.equal(
			(
				await fetch(
					`${fixture.url}/v1/desktop/sessions/${ASK_SESSION_IDS[0]}/send`,
					{ method: "POST", headers },
				)
			).status,
			405,
		);
		const response = await fetch(
			`${fixture.url}/v1/desktop/sessions/${ASK_SESSION_IDS[0]}/events`,
			{ headers },
		);
		const reader = response.body.getReader();
		let wire = "";
		for (let i = 0; i < 4 && !wire.includes('"type":"snapshot"'); i++) {
			const { value, done } = await reader.read();
			if (done) break;
			wire += new TextDecoder().decode(value);
		}
		await reader.cancel();
		assert(wire.includes('"type":"snapshot"'));
		fixture.setMode("empty");
		assert.deepEqual(
			(
				await (
					await fetch(`${fixture.url}/v1/desktop/asks`, { headers })
				).json()
			).result.asks,
			[],
		);
		fixture.setMode("error");
		assert.equal(
			(await fetch(`${fixture.url}/v1/desktop/asks`, { headers })).status,
			503,
		);
	} finally {
		await fixture.close();
	}
});
test("future asks production and fixture-only deltas select the existing native job", () => {
	for (const path of [
		"src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
		"src/renderer/src/shared/components/common/chat-layout.tsx",
		"src/renderer/src/shared/store/ui-preferences-store.ts",
		"scripts/asks-app-fixture.mjs",
		"scripts/asks-app-regression.mjs",
		"scripts/asks-app-regression.test.mjs",
	]) {
		const flags = flagsFor([categoryOf(path)], [path], false);
		assert.equal(flags.pack, true, `${path} must run native app regression`);
		assert.equal(flags.lint, true);
		assert.equal(flags.types, true);
	}
	const workflow = readFileSync(
		new URL("../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	);
	assert(workflow.includes("needs.changes.outputs.pack != 'false'"));
	assert(
		workflow.includes(
			"needs.audit.result == 'success' || needs.audit.result == 'skipped'",
		),
	);
});
test("existing job performs real native capture and always uploads measurements", () => {
	const workflow = readFileSync(
		new URL("../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	);
	assert(workflow.includes("node scripts/asks-app-regression.mjs"));
	assert(
		workflow.includes(
			"asks-app-regression-${{ github.event.pull_request.number }}",
		),
	);
	const source = readFileSync(
		new URL("./asks-app-regression.mjs", import.meta.url),
		"utf8",
	);
	assert(source.includes("api.launchApp"));
	assert(source.includes("api.capture"));
	assert(!source.includes("window.api ="));
	/*
	 * The order CI caught: attach straight after launch, before the debugging
	 * port was listening. `fetch` then rejected and the rejection escaped the
	 * attach loop as a bare `TypeError: fetch failed`. What is pinned here is the
	 * ORDER - the endpoint wait is called before any attach - and that the wait
	 * does not depend on which driver tree was imported, because the control leg
	 * loads a pinned historical facade that does not export one.
	 */
	/*
	 * The ordering that cost CI seven minutes: the traffic assertions sat AHEAD of
	 * `fixture.close()`, so the first one that threw left the fixture's HTTP
	 * listener open and the step ran on with nothing to do until GitHub killed it.
	 * The close must come first, and the assertions must not run at all over a run
	 * that already failed.
	 */
	const closeAt = source.indexOf(
		"await fixture.close();\n\t\tif (primaryError === null)",
	);
	assert(
		closeAt > 0,
		"the fixture must be closed before the traffic assertions",
	);
	const trafficCallAt = source.indexOf(
		"assertTrafficAllowed(fixture.requests)",
	);
	assert(
		trafficCallAt > closeAt,
		"the traffic assertions must follow the close, or a failure leaks the listener",
	);
	assert(
		source.includes("primaryError = error") &&
			source.includes("primaryError === null"),
		"traffic assertions must be skipped over a run that already failed",
	);
	/*
	 * The auth invariant is "no unauthenticated WRITE", not "every read carries a
	 * bearer": the app's transport omits the header when it holds no token, so a bare
	 * read is ordinary (measured: 7 of 153 requests, `/v1/credentials` and `/health`),
	 * and the fixture answers each 401. Pinned so the guard cannot be tightened back
	 * into a false failure or loosened into admitting a bare write.
	 */
	assert(
		source.includes('request.authenticated || request.method === "GET"'),
		"the auth guard must forbid unauthenticated WRITES, not unauthenticated reads",
	);
	// The Radient proxy is a POST this scene reaches; the fixture models its read
	// operations and the guard admits the route while the turn/answer pattern stays shut.
	assert(
		source.includes("/v1/desktop/radient"),
		"the traffic guard must admit the modelled radient read door",
	);
	const fixtureSource = readFileSync(
		new URL("./asks-app-fixture.mjs", import.meta.url),
		"utf8",
	);
	assert(
		fixtureSource.includes("READ_RADIENT_OPERATIONS") &&
			fixtureSource.includes("Fixture models no radient operation"),
		"the fixture must model the radient reads and refuse the rest by name",
	);

	/*
	 * EVERY `data-tour-tag` THIS PRODUCER PRESSES MUST EXIST IN `src/`. The press
	 * that cost run 38846903646 was `[data-tour-tag="chat-all-chats"]`, a selector
	 * the app has never drawn - `git grep` finds it in the shared driver's own
	 * comments and in NO source file, at this head or the pinned control one - so
	 * the scene waited fifteen seconds for an element that could not appear and the
	 * case died with `Unsettled real UI`. A scene that presses a tag the renderer
	 * does not carry is not a failing app, it is a wrong assertion, and it is
	 * decidable statically: the tags are in the source and the presses are here.
	 */
	// Comments are stripped first: this file describes the defect in prose (the
	// error string the page produced), and a scan that reads its own explanation as
	// an offence is a scan nobody can act on.
	const codeOnly = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

	const pressedTags = [
		...codeOnly.matchAll(/press\(\s*'\[data-tour-tag="([^"]+)"\]/g),
	].map((match) => match[1]);
	assert(
		pressedTags.length > 0,
		"the scan must find the producer's tag presses, or it proves nothing",
	);
	for (const tag of pressedTags) {
		const hits = execFileSync(
			"git",
			["grep", "-l", `data-tour-tag="${tag}"`, "--", "src"],
			{ encoding: "utf8", cwd: REPO, maxBuffer: 32 * 1024 * 1024 },
		).trim();
		assert(
			hits.length > 0,
			`the producer presses [data-tour-tag="${tag}"], which no file under src/ carries`,
		);
	}

	/*
	 * THE BROWSER DOOR IS WAITED FOR, NOT SAMPLED ONCE. Run 38929174267 failed with
	 * `Expected values to be strictly equal: false !== true` on the wing's
	 * `browser()`: the press is synchronous to the store but React's commit of it is
	 * not, so a single immediate read can land on the pre-commit moment - and under
	 * load it did. The wait is bounded and the assertion remains the one gate, so a
	 * door that never opens still fails.
	 */
	const browserFn = source.slice(
		source.indexOf("async function browser()"),
		source.indexOf("async function asks()"),
	);
	assert(
		browserFn.includes("await waitFor("),
		"browser() must WAIT for the pane rather than read it once after the press",
	);
	assert(
		/press\('\[data-panel-rail-item="browser"\]'\)\s*;?\s*\n\s*const opened = await waitFor\(/.test(
			browserFn,
		),
		"the wait must follow the press, so the pane is waited FOR rather than assumed",
	);
	assert(
		browserFn.includes("assert.equal("),
		"the assertion stays the single gate, so a door that never opens still fails",
	);

	/*
	 * NO PAGE-SIDE `window.__loDevDriver.call(...)` WAIT. The verb's return is not a
	 * page promise, so awaiting `.then` inside an expression throws
	 * `TypeError: window.__loDevDriver.call(...).then is not a function` and takes
	 * the case down before any frame - measured on run 38849663528, at the session
	 * helper. State is read through `api.verb`/`cdp.evaluate` from Node, which is the
	 * documented door and what the shared driver's own scenes use.
	 */
	assert(
		!/__loDevDriver\.call\([^)]*\)\.then/.test(codeOnly),
		"a page-side .then on a driver verb is not a promise and throws; read state through the api instead",
	);

	const waitAt = codeOnly.indexOf("await waitForDevtoolsPort(app, api)");
	const attachAt = source.indexOf(
		'api.CdpClient.attach(app.port, "out/renderer/index.html")',
	);
	assert(waitAt > 0, "the producer must wait for the debugging port");
	assert(attachAt > waitAt, "the wait must precede the attach");
	assert(
		source.includes('typeof api?.waitForDevtools === "function"'),
		"the wait must fall back for the pinned historical driver the control leg imports",
	);
	assert(
		!source.includes('CdpClient.attach(app.port, "index.html")'),
		"the target must be the built renderer path the other callers use",
	);
	/*
	 * The control tree is PINNED, so whether its revision is in this clone is a
	 * property of the clone and not of the change: `pnpm test:desktop` runs under
	 * `actions/checkout`'s default depth-1, where 2461cfa3 is a commit this clone
	 * has never seen. Read it when it is here (a developer's tree), say so plainly
	 * when it is not, and never turn a shallow clone into a red test.
	 *
	 * maxBuffer, because the shared driver is a 45k-line file and the default
	 * 1 MiB ceiling turns reading it into an ENOBUFS that reads like a git fault.
	 */
	const present = spawnSync(
		"git",
		["cat-file", "-e", `${ASKS_CONTROL}^{commit}`],
		{ cwd: REPO },
	).status;
	if (present === 0) {
		const historical = execFileSync(
			"git",
			["show", `${ASKS_CONTROL}:scripts/renderer-driver.mjs`],
			{ encoding: "utf8", cwd: REPO, maxBuffer: 32 * 1024 * 1024 },
		);
		assert(
			!historical.includes("waitForDevtools,\n"),
			"the pinned control tree must really lack the exported wait, or the fallback above is untested",
		);
	} else {
		console.log(
			"asks-app-regression: pinned control commit not in this clone (shallow checkout); the fallback is asserted from source only",
		);
	}
});
