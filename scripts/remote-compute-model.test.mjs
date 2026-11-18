/**
 * Remote compute as VALUES: which state the picker's row is in, what the sheet will
 * let a user do, what the run card says about money and time, and which remedy a
 * refusal earns.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT A DOM SUITE. Every rule in this family is a
 * CLAIM a user acts on - "this is ready", "that run holds $5.09", "the binding is
 * recorded but not enforced" - and a claim written into JSX can only be checked by
 * looking at a picture. So the claims are pure functions
 * (`remote-compute-model.ts`, `remote-compute-types.ts`), the components paint them,
 * and this file pins them without a browser. What it cannot say - that the row sits
 * in the picker under a rule, that the sheet's disabled row is legible, that a press
 * opens the menu - is the stories' and the captured frames' job.
 *
 * THE WIRE IS THE OTHER HALF. `remoteCall` and the seven request schemas are checked
 * here too, because a path built wrong (an unencoded id, a body with a null network
 * where "nobody chose" was meant) is a request that fails at run time with a message
 * nobody wrote. The endpoint assertions read `desktopEndpoint`, which is the same
 * function main's transport uses, so the test and the app cannot drift.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/remote-compute/remote-compute-model";',
			'export * from "./src/renderer/src/features/remote-compute/remote-compute-types";',
			'export * from "./src/renderer/src/features/remote-compute/remote-compute-store";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { t } from "@shared/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": "./src/renderer/src/shared" },
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	radientRowView,
	cloudRunReady,
	liveRuns,
	remoteSheetModel,
	summarisePrompt,
	remoteRunCardModel,
	remoteRemedy,
	remoteRetrySeconds,
	remoteRunPhase,
	remoteRunStatusKnown,
	remoteComputeRead,
	remoteRun,
	remoteRunList,
	remoteRunEnvelope,
	remoteRunPollMs,
	REMOTE_RUN_POLL_MS,
	REMOTE_RUN_POLL_GRACE_MS,
	remoteCall,
	RemoteRefusal,
	desktopEndpoint,
	desktopRequestSchema,
} = module;

/* --------------------------------------------------------------- the fixtures */

const NETWORK = { network_id: "n_4a1c", name: "devmesh", role: "admin" };
const OTHER = { network_id: "n_91cc", name: "homelab", role: "read" };

/** A run in flight, started `ageS` seconds ago. */
const live = (over = {}) => ({
	id: "9f2c1a04e7b3",
	name: "fix the failing test",
	tier: "cloud_run",
	status: "running",
	started_at: Date.now() - 252_000,
	deadline_at: Date.now() + 6_948_000,
	metered_seconds: 252,
	charged_usd: 0,
	hold_usd: 5.09,
	network_id: null,
	...over,
});

/** A read with everything a ready state needs, then whatever the case overrides. */
const read = (over = {}) =>
	remoteComputeRead({
		enabled: true,
		account: { state: "signed-in", label: "operator@example.com" },
		networks: [NETWORK],
		capacity: [{ tier: "cloud_run", ready: true, detail: {} }],
		pricing: null,
		active: [],
		offered: true,
		...over,
	});

const NOW = Date.now();
const answered = (value) => ({ state: "answered", value });

/* ------------------------------------------------------------- the picker row */

test("state A: the family is off, so there is no row at all", () => {
	assert.deepEqual(
		radientRowView({ read: answered(read({ enabled: false })), now: NOW }),
		{
			kind: "hidden",
		},
	);
});

test("the read in flight says checking, never a guess about readiness", () => {
	const view = radientRowView({ read: { state: "loading" }, now: NOW });
	assert.equal(view.kind, "loading");
	assert.match(view.sentence, /checking/);
});

test("state B: signed out is an on-ramp with its own sentence", () => {
	for (const state of ["signed-out", "expired"]) {
		const view = radientRowView({
			read: answered(read({ account: { state, label: "" } })),
			now: NOW,
		});
		assert.equal(view.kind, "sign-in", state);
		assert.equal(view.label, "sign in to use");
		assert.match(view.sentence, /starts the sign-in/);
	}
});

test("state B also covers a read that carries no account at all", () => {
	const view = radientRowView({
		read: answered(read({ account: null })),
		now: NOW,
	});
	assert.equal(view.kind, "sign-in");
});

test("state C: ready, and the row claims readiness only", () => {
	const view = radientRowView({ read: answered(read()), now: NOW });
	assert.equal(view.kind, "ready");
	assert.equal(view.label, "ready");
	// No money and no duration in the calm state: both would be facts it does not have.
	assert.doesNotMatch(view.label, /\$|\d/);
});

test("state D: the aggregate carries the count, the oldest age and the held sum", () => {
	const two = [
		live({ id: "a", started_at: NOW - 252_000, hold_usd: 5.09 }),
		live({ id: "b", started_at: NOW - 60_000, hold_usd: 2.5 }),
	];
	const view = radientRowView({
		read: answered(read({ active: two })),
		now: NOW,
	});
	assert.equal(view.kind, "runs");
	assert.equal(view.count, 2);
	assert.equal(view.label, "2 runs · 4m 12s · held $7.59");
	assert.match(view.sentence, /2 runs in flight · 4m 12s · held \$7\.59/);
});

test("state D saturates the count at nine and never the money", () => {
	const many = Array.from({ length: 11 }, (_, index) =>
		live({ id: `run-${index}`, started_at: NOW - 60_000, hold_usd: 1 }),
	);
	const view = radientRowView({
		read: answered(read({ active: many })),
		now: NOW,
	});
	assert.equal(view.kind, "runs");
	assert.equal(view.capped, true);
	assert.match(view.label, /^9\+ runs · 1m · held \$11\.00$/);
	assert.doesNotMatch(view.label, /11 runs/);
});

test("state D drops the seconds, never the run, when the window is narrow", () => {
	const view = radientRowView({
		read: answered(read({ active: [live()] })),
		now: NOW,
		narrow: true,
	});
	assert.equal(view.kind, "runs");
	assert.equal(view.label, "1 run · 4m · held $5.09");
});

test("a run that publishes no hold contributes nothing rather than $0.00", () => {
	const view = radientRowView({
		read: answered(read({ active: [live({ hold_usd: null })] })),
		now: NOW,
	});
	assert.equal(view.kind, "runs");
	assert.doesNotMatch(view.label, /held|\$/);
});

test("a run that never started contributes no age either", () => {
	const view = radientRowView({
		read: answered(read({ active: [live({ started_at: null })] })),
		now: NOW,
	});
	assert.equal(view.kind, "runs");
	assert.equal(view.label, "1 run · held $5.09");
});

test("state E: capacity unavailable, with the retry as its affordance", () => {
	for (const value of [
		read({ capacity: [] }),
		read({ capacity: [{ tier: "cloud_run", ready: false }] }),
	]) {
		const view = radientRowView({ read: answered(value), now: NOW });
		assert.equal(view.kind, "capacity");
		assert.equal(view.label, "capacity unavailable");
		assert.equal(view.why, "retry");
	}
	const failed = radientRowView({ read: { state: "failed" }, now: NOW });
	assert.equal(failed.kind, "capacity");
});

test("state F: no network is its own state, with the remedy and no promise", () => {
	const view = radientRowView({
		read: answered(read({ networks: [] })),
		now: NOW,
	});
	assert.equal(view.kind, "network");
	assert.equal(view.label, "needs a network");
	assert.equal(view.why, "create one");
	assert.match(view.sentence, /lop network init/);
});

test("state G: the deployment's own switch is off and it outranks the account", () => {
	const view = radientRowView({
		read: answered(
			read({ offered: false, account: { state: "signed-out", label: "" } }),
		),
		now: NOW,
	});
	assert.equal(view.kind, "not-offered");
	assert.equal(view.label, "not offered by this deployment");
});

test("a deployment that does not say whether it offers the family still offers it", () => {
	const view = radientRowView({
		read: answered(read({ offered: null })),
		now: NOW,
	});
	assert.equal(view.kind, "ready");
});

test("live runs are the in-flight ones, whatever the surface", () => {
	const rows = [
		remoteRun(live({ id: "a", status: "running" })),
		remoteRun(live({ id: "b", status: "succeeded" })),
		remoteRun(live({ id: "c", status: "queued" })),
		remoteRun(live({ id: "d", status: "cancelled" })),
	];
	assert.deepEqual(
		liveRuns(rows).map((run) => run.id),
		["a", "c"],
	);
});

test("an unknown status is read as in flight rather than settled", () => {
	assert.equal(remoteRunPhase("hibernating"), "in-flight");
	assert.equal(remoteRunStatusKnown("hibernating"), false);
	assert.equal(remoteRunPhase("Succeeded"), "succeeded");
});

/* -------------------------------------------------------------- the tier plan */

test("cloud run is ready only when the capacity names that tier as ready", () => {
	assert.equal(cloudRunReady(read()), true);
	assert.equal(
		cloudRunReady(read({ capacity: [{ tier: "dedicated", ready: true }] })),
		false,
	);
	assert.equal(
		cloudRunReady(read({ capacity: [{ tier: "cloud_run", ready: false }] })),
		false,
	);
});

/* -------------------------------------------------------------- the sheet */

test("one network is pre-selected; the tiers are live", () => {
	const model = remoteSheetModel({
		value: read(),
		prompt: "fix the importer",
		directory: "/src/importer",
		chosenNetworkId: null,
	});
	assert.equal(model.network.chosen?.network_id, NETWORK.network_id);
	assert.equal(model.network.label, "devmesh · admin");
	assert.equal(model.network.ambiguous, false);
	assert.equal(model.submit.enabled, true);
	assert.equal(model.submit.why, null);
});

test("two networks and no choice stand the tiers down and say why", () => {
	const model = remoteSheetModel({
		value: read({ networks: [NETWORK, OTHER] }),
		prompt: "fix the importer",
		directory: "/src/importer",
		chosenNetworkId: null,
	});
	assert.equal(model.network.chosen, null);
	assert.equal(model.network.ambiguous, true);
	const cloud = model.tiers.find((row) => row.tier === "cloud_run");
	assert.equal(cloud.disabled, true);
	assert.equal(cloud.why, "choose a network");
	assert.equal(model.submit.enabled, false);
	assert.equal(model.submit.why, "Choose a network first.");
});

test("a chosen network makes the same sheet submittable", () => {
	const model = remoteSheetModel({
		value: read({ networks: [NETWORK, OTHER] }),
		prompt: "fix the importer",
		directory: "/src/importer",
		chosenNetworkId: OTHER.network_id,
	});
	assert.equal(model.network.chosen?.network_id, OTHER.network_id);
	assert.equal(model.submit.enabled, true);
});

test("the tier list is the design's: cloud run live, dedicated and spot disabled", () => {
	const model = remoteSheetModel({
		value: read(),
		prompt: "fix the importer",
		directory: "/src/importer",
		chosenNetworkId: null,
	});
	assert.deepEqual(
		model.tiers.map((row) => [row.tier, row.title, row.disabled]),
		[
			["cloud_run", "Cloud run", false],
			["dedicated", "Dedicated", true],
		],
	);
	const dedicated = model.tiers[1];
	assert.equal(dedicated.why, "coming soon");
	assert.equal(dedicated.spot?.title, "Spot");
	assert.equal(dedicated.spot?.why, "coming soon");
	// The spot option belongs UNDER dedicated, not beside it as a third tier.
	assert.equal(model.tiers.length, 2);
});

test("the binding sentence says recorded and never claims enforcement", () => {
	const model = remoteSheetModel({
		value: read(),
		prompt: "p",
		directory: "/d",
		chosenNetworkId: null,
	});
	assert.match(model.network.note, /recorded/);
	assert.match(model.network.note, /not restricted/);
	for (const forbidden of ["isolat", "segmented", "private", "secure"]) {
		assert.doesNotMatch(
			model.network.note.toLowerCase(),
			new RegExp(forbidden),
		);
	}
});

test("an empty composer or no directory stands the submit down with its own reason", () => {
	const emptyPrompt = remoteSheetModel({
		value: read(),
		prompt: "   ",
		directory: "/src/importer",
		chosenNetworkId: null,
	});
	assert.equal(emptyPrompt.submit.enabled, false);
	assert.equal(emptyPrompt.submit.why, "Type a prompt in the composer first.");
	assert.equal(emptyPrompt.prompt.summary, "");

	const noDirectory = remoteSheetModel({
		value: read(),
		prompt: "fix it",
		directory: "",
		chosenNetworkId: null,
	});
	assert.equal(noDirectory.submit.enabled, false);
	assert.equal(
		noDirectory.submit.why,
		"This conversation has no directory yet.",
	);
});

test("the prompt summary is the first line, elided, and never the payload", () => {
	const long = `${"a".repeat(200)}\nsecond line`;
	assert.equal(summarisePrompt(long).length, 141);
	assert.ok(summarisePrompt(long).endsWith("…"));
	assert.equal(summarisePrompt("one\ntwo"), "one");
	assert.equal(summarisePrompt(""), "");
});

/* -------------------------------------------------------------- the run card */

test("a live run prints its age from the server's start and the hold it carries", () => {
	const model = remoteRunCardModel(remoteRun(live()), {
		now: Date.now() + 60_000,
		networkName: null,
	});
	assert.equal(model.status, "Running");
	assert.equal(model.phase, "in-flight");
	assert.equal(model.elapsed, "5m 12s");
	assert.equal(model.amount?.kind, "held");
	assert.equal(model.amount?.text, "held $5.09");
	assert.deepEqual(model.actions, { cancel: true, delete: false });
	assert.equal(model.binding, "no network recorded");
});

test("a settled run prints its charge, not its old hold, and offers Forget", () => {
	const model = remoteRunCardModel(
		remoteRun(
			live({
				status: "succeeded",
				charged_usd: 0.62,
				network_id: NETWORK.network_id,
			}),
		),
		{ now: Date.now(), networkName: "devmesh" },
	);
	assert.equal(model.phase, "succeeded");
	assert.equal(model.elapsed, null);
	assert.equal(model.amount?.kind, "charged");
	assert.equal(model.amount?.text, "charged $0.62");
	assert.deepEqual(model.actions, { cancel: false, delete: true });
	assert.equal(model.binding, "recorded against devmesh; not enforced");
});

test("a run that states no amounts prints none, and an unknown status prints its token", () => {
	const model = remoteRunCardModel(
		remoteRun(
			live({ status: "hibernating", hold_usd: null, charged_usd: null }),
		),
		{ now: Date.now(), networkName: null },
	);
	assert.equal(model.amount, null);
	assert.equal(model.status, "hibernating");
	assert.equal(model.statusKnown, false);
});

test("an unnamed run is titled for what it is rather than left blank", () => {
	const model = remoteRunCardModel(remoteRun(live({ name: "" })), {
		now: Date.now(),
		networkName: null,
	});
	assert.equal(model.title, "Untitled run");
});

/* --------------------------------------------------------------- the polling */

test("a live run is polled at five seconds, and polling stops when it cannot move", () => {
	const running = remoteRun(live());
	assert.equal(remoteRunPollMs(running, NOW), REMOTE_RUN_POLL_MS);

	const settled = remoteRun(live({ status: "succeeded" }));
	assert.equal(remoteRunPollMs(settled, NOW), false);

	// Past its own deadline by more than the grace: the record is not worth a request.
	const expiring = remoteRun(
		live({ deadline_at: NOW - REMOTE_RUN_POLL_GRACE_MS - 1_000 }),
	);
	assert.equal(remoteRunPollMs(expiring, NOW), false);
	// Inside the grace it keeps reading: a settle can land after the deadline.
	const justExpired = remoteRun(
		live({ deadline_at: NOW - REMOTE_RUN_POLL_GRACE_MS + 1_000 }),
	);
	assert.equal(remoteRunPollMs(justExpired, NOW), REMOTE_RUN_POLL_MS);

	// No deadline means nobody told us when it ends, so it keeps being watched.
	assert.equal(
		remoteRunPollMs(remoteRun(live({ deadline_at: null })), NOW),
		REMOTE_RUN_POLL_MS,
	);
});

/* --------------------------------------------------------------- the refusals */

test("each refusal code chooses an affordance and never a wording", () => {
	assert.equal(remoteRemedy("not_configured"), "sign-in");
	assert.equal(remoteRemedy("insufficient_credits"), "add-credits");
	for (const code of [
		"run_limit",
		"run_busy",
		"capacity_unavailable",
		"admission_unavailable",
	]) {
		assert.equal(remoteRemedy(code), "retry", code);
	}
	assert.equal(remoteRemedy("unpushed_commit"), "push-branch");
	assert.equal(remoteRemedy("not_found"), "refresh");
	assert.equal(remoteRemedy("run_finished"), "refresh");
	// An unrecognised code gets the server's sentence and no button: a retry that
	// re-spends money is the wrong default for something this client has not seen.
	assert.equal(remoteRemedy("idempotency_conflict"), "none");
	assert.equal(remoteRemedy("preview_not_enabled"), "none");
	assert.equal(remoteRemedy("tier_not_available"), "none");
});

test("the retry countdown is the route's own Retry-After, or nothing", () => {
	assert.equal(remoteRetrySeconds({ retryAfterMs: 12_500 }), 13);
	assert.equal(remoteRetrySeconds({ retryAfterMs: 0 }), null);
	assert.equal(remoteRetrySeconds({ retryAfterMs: null }), null);
	assert.equal(remoteRetrySeconds({}), null);
});

/* ----------------------------------------------------------------- the wire */

const endpoint = (request) => desktopEndpoint(request);

test("this family's refusal envelope is read, not translated", async () => {
	const reply = async (status, body) => {
		globalThis.window = {
			api: { desktop: { request: async () => ({ status, body }) } },
		};
		return remoteCall({ op: "remote_compute.runs" }).then(
			() => null,
			(error) => error,
		);
	};

	// The route's own sentence wins, and `retry_after` is SECONDS on the wire.
	const refused = await reply(429, {
		error: {
			code: "run_limit",
			message: "Too many runs are live.",
			retry_after: 30,
		},
	});
	assert.ok(refused instanceof RemoteRefusal);
	assert.equal(refused.code, "run_limit");
	assert.equal(refused.message, "Too many runs are live.");
	assert.equal(refused.retryAfterMs, 30_000);
	assert.equal(remoteRemedy(refused.code), "retry");

	// A bodiless 404 is a record that is gone: `not_found`, whose remedy is a re-read.
	const gone = await reply(404, null);
	assert.equal(gone.code, "not_found");
	assert.equal(remoteRemedy(gone.code), "refresh");

	// A 2xx unwraps `result`, which is the envelope every route here answers in.
	globalThis.window = {
		api: {
			desktop: {
				request: async () => ({ status: 200, body: { result: { runs: [] } } }),
			},
		},
	};
	assert.deepEqual(await remoteCall({ op: "remote_compute.runs" }), {
		runs: [],
	});
	Reflect.deleteProperty(globalThis, "window");
});

test("the capability read is one GET and the runs are one GET each", () => {
	assert.deepEqual(endpoint({ op: "remote_compute.read" }), {
		path: "/v1/desktop/remote-compute",
		method: "GET",
	});
	assert.deepEqual(endpoint({ op: "remote_compute.runs" }), {
		path: "/v1/desktop/remote-compute/runs",
		method: "GET",
	});
	assert.deepEqual(
		endpoint({ op: "remote_compute.run", runId: "9f2c1a04e7b3" }),
		{
			path: "/v1/desktop/remote-compute/runs/9f2c1a04e7b3",
			method: "GET",
		},
	);
});

test("the start sends the tier the picker offers, and omits what nobody chose", () => {
	const minimal = endpoint({
		op: "remote_compute.start",
		directory: "~",
		prompt: "fix it",
		tier: "cloud_run",
	});
	assert.deepEqual(minimal, {
		path: "/v1/desktop/remote-compute/runs",
		method: "POST",
		body: { directory: "~", prompt: "fix it", tier: "cloud_run" },
	});
	// `network_id: null` would say "bound to nothing" where the truth is "nobody chose".
	assert.equal("network_id" in minimal.body, false);

	const full = endpoint({
		op: "remote_compute.start",
		directory: "/src/importer",
		prompt: "fix it",
		tier: "cloud_run",
		networkId: NETWORK.network_id,
		maxHours: 2,
		idempotencyKey: "8a1f4c2e-1b2d-4c3e-9f00-123456789abc",
	});
	assert.deepEqual(full.body, {
		directory: "/src/importer",
		prompt: "fix it",
		tier: "cloud_run",
		max_hours: 2,
		network_id: NETWORK.network_id,
		// The key the retry must REPEAT, under the route's own field name.
		idempotency_key: "8a1f4c2e-1b2d-4c3e-9f00-123456789abc",
	});
});

test("cancel, delete and the two artifact probes use their own verbs", () => {
	assert.equal(
		endpoint({ op: "remote_compute.cancel", runId: "r1" }).method,
		"POST",
	);
	assert.equal(
		endpoint({ op: "remote_compute.cancel", runId: "r1" }).path,
		"/v1/desktop/remote-compute/runs/r1/cancel",
	);
	assert.equal(
		endpoint({ op: "remote_compute.delete", runId: "r1" }).method,
		"DELETE",
	);
	assert.equal(
		endpoint({ op: "remote_compute.logs", runId: "r1" }).path,
		"/v1/desktop/remote-compute/runs/r1/logs",
	);
	assert.equal(
		endpoint({ op: "remote_compute.results", runId: "r1" }).path,
		"/v1/desktop/remote-compute/runs/r1/results",
	);
});

test("a run id cannot become a path fragment, and the tier is a closed set", () => {
	const schema = desktopRequestSchema;
	assert.equal(
		schema.safeParse({ op: "remote_compute.run", runId: "../peers" }).success,
		false,
	);
	assert.equal(
		schema.safeParse({ op: "remote_compute.run", runId: "" }).success,
		false,
	);
	assert.equal(
		schema.safeParse({ op: "remote_compute.delete", runId: "a/b" }).success,
		false,
	);
	// `dedicated` is drawn disabled, so a request naming it is a client bug.
	assert.equal(
		schema.safeParse({
			op: "remote_compute.start",
			directory: "/d",
			prompt: "p",
			tier: "dedicated",
		}).success,
		false,
	);
	assert.equal(
		schema.safeParse({
			op: "remote_compute.start",
			directory: "/d",
			prompt: "p",
			tier: "cloud_run",
			maxHours: 9,
		}).success,
		false,
	);
});

/* ------------------------------------------------------------ the normalisers */

test("the off answer is the switch and nothing else", () => {
	const value = remoteComputeRead({ enabled: false });
	assert.equal(value.enabled, false);
	assert.deepEqual(value.networks, []);
	assert.deepEqual(value.active, []);
	assert.equal(value.account, null);
	// A missing flag is not an on switch.
	assert.equal(remoteComputeRead({}).enabled, false);
});

test("the read is normalised, not cast: unknown shapes cannot take a window down", () => {
	const value = remoteComputeRead({
		enabled: true,
		account: { state: "signed-in", label: "operator@example.com" },
		networks: [
			{ network_id: "n_1", name: "devmesh", role: "admin" },
			{ name: "no id" },
		],
		capacity: [{ tier: "cloud_run", ready: true }, { ready: true }],
		pricing: null,
		active: [{ id: "r1" }, { name: "no id" }],
	});
	assert.equal(value.account?.state, "signed-in");
	assert.deepEqual(
		value.networks.map((row) => row.network_id),
		["n_1"],
	);
	assert.deepEqual(
		value.capacity.map((row) => row.tier),
		["cloud_run"],
	);
	assert.deepEqual(
		value.active.map((run) => run.id),
		["r1"],
	);
	assert.equal(value.pricing, null);
	// A run row with nothing but an id is still a row, with its gaps stated as gaps.
	assert.equal(value.active[0].hold_usd, null);
	assert.equal(value.active[0].started_at, null);
});

test("an account state this client does not know is no account, not a wrong one", () => {
	assert.equal(
		remoteComputeRead({ enabled: true, account: { state: "suspended" } })
			.account,
		null,
	);
});

test("instants read in seconds or milliseconds and keep their meaning", () => {
	const seconds = remoteRun({ id: "r1", started_at: 1_789_400_000 });
	const millis = remoteRun({ id: "r1", started_at: 1_789_400_000_000 });
	assert.equal(seconds.started_at, 1_789_400_000_000);
	assert.equal(millis.started_at, 1_789_400_000_000);
	const iso = remoteRun({ id: "r1", deadline_at: "2026-11-17T12:00:00.000Z" });
	assert.equal(iso.deadline_at, Date.parse("2026-11-17T12:00:00.000Z"));
});

test("the runs list drops duplicate ids and carries the server's verdict", () => {
	const list = remoteRunList({
		runs: [
			{ id: "a", status: "running" },
			{ id: "a", status: "succeeded" },
			{ id: "b", status: "queued" },
		],
		server: "signed-out",
	});
	assert.deepEqual(
		list.runs.map((run) => run.id),
		["a", "b"],
	);
	assert.equal(list.runs[0].status, "running");
	assert.equal(list.server, "signed-out");
	// The switch being off is its own verdict, not a failure.
	assert.equal(
		remoteRunList({ runs: [], server: "disabled" }).server,
		"disabled",
	);
	// A verdict this client does not know says nothing it cannot back.
	assert.equal(
		remoteRunList({ runs: [], server: "banana" }).server,
		"unavailable",
	);
});

test("the run envelope reads both the wrapped and the bare shape", () => {
	assert.equal(remoteRunEnvelope({ run: { id: "a" } })?.id, "a");
	assert.equal(remoteRunEnvelope({ id: "b" })?.id, "b");
	assert.equal(remoteRunEnvelope({ run: null }), null);
	assert.equal(remoteRunEnvelope(null), null);
});

/* ------------------------------------------------------------ the catalogues */

/*
 * THE COPY IS CHECKED WHERE IT IS A CLAIM, not where it is a wording. These two
 * assertions exist because the design of record names them as the surface's
 * load-bearing sentences, and a translator or a refactor could quietly invert either.
 */
test("every locale carries every key, with the same placeholders", () => {
	const base = "src/i18n/catalogues";
	const english = JSON.parse(
		readFileSync(`${base}/en/ui.chat.remote_compute.json`, "utf8"),
	);
	const locales = ["fr", "es", "zh-CN", "ru", "vi", "ur", "hi"];
	for (const locale of locales) {
		const messages = JSON.parse(
			readFileSync(`${base}/${locale}/ui.chat.remote_compute.json`, "utf8"),
		);
		assert.deepEqual(
			Object.keys(messages).sort(),
			Object.keys(english).sort(),
			locale,
		);
		for (const [key, value] of Object.entries(messages)) {
			for (const placeholder of english[key].match(
				/\{[a-zA-Z_][a-zA-Z0-9_]*/g,
			) ?? []) {
				assert.ok(
					value.includes(placeholder),
					`${locale} ${key} lost ${placeholder}`,
				);
			}
		}
	}
});

test("no locale's binding sentence claims enforcement", () => {
	const locales = ["en", "fr", "es", "zh-CN", "ru", "vi", "ur", "hi"];
	const forbidden = ["isolat", "segmented", "private", "restricted by it and"];
	for (const locale of locales) {
		const messages = JSON.parse(
			readFileSync(
				`src/i18n/catalogues/${locale}/ui.chat.remote_compute.json`,
				"utf8",
			),
		);
		const note =
			messages["ui.chat.remote_compute.sheet.network.recorded"].toLowerCase();
		for (const word of forbidden) {
			assert.equal(note.includes(word), false, `${locale} claims ${word}`);
		}
	}
});
