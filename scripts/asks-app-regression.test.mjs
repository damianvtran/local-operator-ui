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
import { ASKS_CONTROL, expectedRailClose } from "./asks-app-regression.mjs";
import { categoryOf, flagsFor } from "./ci-scope.mjs";

test("the historical source control expects restoration; candidate must empty", () => {
	assert.equal(expectedRailClose("control"), true);
	assert.equal(expectedRailClose("candidate"), false);
	assert.throws(() => expectedRailClose("invented"));
	assert.equal(ASKS_CONTROL, "2461cfa3f3beaa1124727a9de93dfe01c4381b0d");
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
	const waitAt = source.indexOf("await waitForDevtoolsPort(app, api)");
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
