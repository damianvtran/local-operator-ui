import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the three product seams behind `scripts/mac-proof-capture.mjs`:
 *
 *   S1  the dev-driver STEP RUNNER: its gate (`resolveDevDriverScript` in
 *       `src/main/dev-driver.ts`) and its walk (`src/main/dev-driver-script.ts`);
 *   S2  the `waitFor` / `openCanvas` (+ `skipOnboarding`) renderer verbs;
 *   S3  the quiet updater on an armed (rig) boot (`devDriverQuietUpdatesReason`).
 *
 * The property that makes each safe to ship is that it is INERT in a normal
 * launch, so that is asserted first and hardest, the same way
 * `dev-driver-gate.test.mjs` pins the driver's own opt-in: the pure modules are
 * bundled in memory from the shipped TypeScript (they import nothing from
 * Electron), and where the wiring lives in `index.ts`/`update-service.ts`/the
 * preload - which no unit can boot - the source is pinned so a refactor that moves
 * a registration out of its gate fails here.
 *
 * What this file cannot see: a real boot. The mac proof harness's own test drives
 * the stdout protocol end to end against a fake app tree; a real Electron boot of
 * the runner is Mac/CI evidence (docs/mac-proof-capture.md, "What is proven where").
 */
async function load(entry) {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
}

const {
	DEV_DRIVER_SCRIPT_ARG,
	DEV_DRIVER_SCRIPT_ENV,
	DEV_DRIVER_SCRIPT_RESULT,
	DEV_DRIVER_SCRIPT_STEP,
	describeDevDriverScript,
	devDriverArgument,
	devDriverQuietUpdatesReason,
	devDriverScriptArgument,
	readDevDriverArgument,
	resolveDevDriverArming,
	resolveDevDriverScript,
} = await load("./src/main/dev-driver");
const {
	DEV_DRIVER_SCRIPT_CAP_MS,
	DEV_DRIVER_SCRIPT_MAX_BYTES,
	DEV_DRIVER_SCRIPT_MAX_STEPS,
	DEV_DRIVER_SCRIPT_VERBS,
	parseDevDriverScript,
	runDevDriverScript,
} = await load("./src/main/dev-driver-script");

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const DEFAULTS = [
	"/Users/op/Library/Application Support/Local Operator",
	"/Users/op/Library/Application Support/local-operator-ui",
];
const identity = (p) => p;
const armedGate = (over = {}) => ({
	env: { [DEV_DRIVER_SCRIPT_ENV]: "/rig/steps.json" },
	armed: true,
	windowMode: "inactive",
	userData: "/rig/profile",
	defaultUserData: DEFAULTS,
	realpath: identity,
	...over,
});

/* ------------------------------------------------------------- S1 gate */

test("S1: a launch that did not ask for a script is inert and silent, armed or not", () => {
	for (const armed of [false, true])
		for (const windowMode of ["normal", "headless", "inactive"]) {
			const gate = resolveDevDriverScript(
				armedGate({ env: {}, armed, windowMode }),
			);
			assert.deepEqual(gate, {
				honoured: false,
				scriptPath: null,
				refusal: null,
			});
			assert.equal(describeDevDriverScript(gate), null);
		}
	// The operator's own launch: unarmed, normal, default profile. Nothing.
	const operator = resolveDevDriverScript(
		armedGate({
			env: {},
			armed: false,
			windowMode: "normal",
			userData: DEFAULTS[0],
		}),
	);
	assert.equal(operator.honoured, false);
	assert.equal(operator.refusal, null);
});

test("S1: every condition refuses on its own, loudly", () => {
	const refusals = [
		["unarmed", armedGate({ armed: false }), /needs the dev driver armed/],
		[
			"normal window",
			armedGate({ windowMode: "normal" }),
			/never runs in a "normal" window/,
		],
		[
			"relative script",
			armedGate({ env: { [DEV_DRIVER_SCRIPT_ENV]: "steps.json" } }),
			/absolute/,
		],
		[
			"default profile",
			armedGate({ userData: DEFAULTS[0] }),
			/default user data/,
		],
		[
			"nested in default profile",
			armedGate({ userData: `${DEFAULTS[0]}/Partitions/x` }),
			/default user data/,
		],
		[
			"containing the default profile",
			armedGate({ userData: "/Users/op/Library" }),
			/default user data/,
		],
		[
			"unpackaged default name",
			armedGate({ userData: DEFAULTS[1] }),
			/default user data/,
		],
		[
			"a symlink to the default profile",
			armedGate({
				userData: "/rig/link",
				realpath: (p) => (p === "/rig/link" ? DEFAULTS[0] : p),
			}),
			/default user data/,
		],
	];
	for (const [name, input, pattern] of refusals) {
		const gate = resolveDevDriverScript(input);
		assert.equal(gate.honoured, false, name);
		assert.match(gate.refusal, pattern, name);
		assert.match(
			describeDevDriverScript(gate),
			/^\[dev-driver-script\] refused: /,
			name,
		);
	}
});

test("S1: an armed inactive or headless launch on a scratch profile is honoured", () => {
	for (const windowMode of ["inactive", "headless"]) {
		const gate = resolveDevDriverScript(armedGate({ windowMode }));
		assert.deepEqual(gate, {
			honoured: true,
			scriptPath: "/rig/steps.json",
			refusal: null,
		});
		assert.equal(
			describeDevDriverScript(gate),
			"[dev-driver-script] ARMED; steps from /rig/steps.json",
		);
	}
	// The real arming function feeds it: `inactive` + opt-in + absolute out arms.
	assert.equal(
		resolveDevDriverArming({
			env: {
				LOCAL_OPERATOR_UI_DEV_DRIVER: "1",
				LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: "/rig/frames",
			},
			windowMode: "inactive",
		}).armed,
		true,
	);
});

test("S1: on a case-insensitive volume a case variant of the default profile refuses (review r1 R1-3)", () => {
	// macOS APFS folds case and fs.realpathSync keeps the caller's spelling, so
	// `local operator` IS the default profile there. main passes
	// caseInsensitive = (platform === "darwin").
	for (const userData of [
		"/Users/op/Library/Application Support/local operator",
		"/Users/op/library/application support/LOCAL OPERATOR/Default",
		"/users/op/library",
	]) {
		const gate = resolveDevDriverScript(
			armedGate({ userData, caseInsensitive: true }),
		);
		assert.equal(gate.honoured, false, userData);
		assert.match(gate.refusal, /default user data/, userData);
		// Case-sensitive (Linux): a different spelling is a different directory.
		assert.equal(
			resolveDevDriverScript(armedGate({ userData })).honoured,
			true,
			userData,
		);
	}
	// NFD vs NFC spellings of the same name fold together too.
	assert.equal(
		resolveDevDriverScript(
			armedGate({
				userData: "/Users/op/Library/Application Support/Caf\u0065\u0301",
				defaultUserData: ["/Users/op/Library/Application Support/caf\u00e9"],
				caseInsensitive: true,
			}),
		).honoured,
		false,
	);
	assert.match(
		read("src/main/index.ts"),
		/realpath: realpathOrSelf,\s*\/\/[^\n]*\n\s*caseInsensitive: process\.platform === "darwin",/,
	);
});

test("S1: the preload's script argument is exact, and never confused with the frames argument", () => {
	assert.equal(devDriverScriptArgument(), DEV_DRIVER_SCRIPT_ARG);
	assert.equal(
		readDevDriverArgument([devDriverArgument("/f")]).script,
		undefined,
	);
	assert.equal(
		readDevDriverArgument([devDriverArgument("/f"), DEV_DRIVER_SCRIPT_ARG])
			.script,
		true,
	);
	// The script flag alone does not arm a bridge: no frames dir, no bridge.
	assert.equal(readDevDriverArgument([DEV_DRIVER_SCRIPT_ARG]), null);
	assert.equal(
		readDevDriverArgument([
			devDriverArgument("/f"),
			`${DEV_DRIVER_SCRIPT_ARG}=x`,
		]).script,
		undefined,
	);
	assert.equal(DEV_DRIVER_SCRIPT_STEP, "dev-driver-script-step");
	assert.equal(DEV_DRIVER_SCRIPT_RESULT, "dev-driver-script-result");
});

/* ------------------------------------------------------------ S1 parse */

test("S1: the step list is validated before anything runs", () => {
	const ok = parseDevDriverScript(
		JSON.stringify({
			steps: [
				{ verb: "setTheme", payload: "localOperatorLight" },
				{
					verb: "waitFor",
					payload: { selector: "x" },
					optional: true,
					timeoutMs: 5000,
				},
				{
					verb: "shutter",
					payload: { label: "conversation-light", capture: "external" },
				},
			],
		}),
	);
	assert.equal(ok.steps.length, 3);
	assert.equal(ok.steps[1].optional, true);
	assert.deepEqual([...DEV_DRIVER_SCRIPT_VERBS].sort(), [
		"navigate",
		"openCanvas",
		"press",
		"setTheme",
		"shutter",
		"skipOnboarding",
		"state",
		"waitFor",
	]);
	const bad = [
		["not json", "{", /not JSON/],
		["no steps", "{}", /non-empty "steps"/],
		[
			"unknown verb",
			JSON.stringify({ steps: [{ verb: "eval", payload: "1" }] }),
			/allowed:/,
		],
		[
			"approval-shaped verb",
			JSON.stringify({ steps: [{ verb: "stageLiveConsents" }] }),
			/allowed:/,
		],
		[
			"too many",
			JSON.stringify({
				steps: Array.from({ length: DEV_DRIVER_SCRIPT_MAX_STEPS + 1 }, () => ({
					verb: "state",
				})),
			}),
			/cap is/,
		],
		[
			"too big",
			JSON.stringify({
				steps: [
					{ verb: "state", payload: "x".repeat(DEV_DRIVER_SCRIPT_MAX_BYTES) },
				],
			}),
			/larger than/,
		],
		[
			"label climbs out",
			JSON.stringify({
				steps: [
					{ verb: "shutter", payload: { label: "../x", capture: "external" } },
				],
			}),
			/label/,
		],
		[
			"repeated label",
			JSON.stringify({
				steps: [1, 2].map(() => ({
					verb: "shutter",
					payload: { label: "a", capture: "external" },
				})),
			}),
			/repeats/,
		],
		[
			"optional shutter",
			JSON.stringify({
				steps: [
					{
						verb: "shutter",
						optional: true,
						payload: { label: "a", capture: "external" },
					},
				],
			}),
			/cannot be optional/,
		],
		[
			"bad capture",
			JSON.stringify({
				steps: [{ verb: "shutter", payload: { label: "a", capture: "cdp" } }],
			}),
			/capture/,
		],
		[
			"timeout over the cap",
			JSON.stringify({
				steps: [{ verb: "state", timeoutMs: DEV_DRIVER_SCRIPT_CAP_MS + 1 }],
			}),
			/timeoutMs/,
		],
	];
	for (const [name, text, pattern] of bad)
		assert.throws(() => parseDevDriverScript(text), pattern, name);
});

/* ------------------------------------------------------------- S1 walk */

/** Deps with a virtual clock; `sleep` yields a macrotask so real work settles first. */
function fakeDeps(over = {}) {
	let clock = 0;
	const lines = [];
	const acks = new Set();
	const calls = [];
	const deps = {
		verbs: async () =>
			[...DEV_DRIVER_SCRIPT_VERBS].filter((v) => v !== "shutter"),
		call: async (verb, payload) => {
			calls.push([verb, payload]);
			return verb === "state"
				? { activeSessionId: "ce618964c88e" }
				: { ok: true };
		},
		capture: async (label) => ({
			path: `/rig/frames/${label}.png`,
			pixels: { width: 2760, height: 1744 },
		}),
		mediaSourceId: () => "window:4242:0",
		windowFacts: () => ({ visible: true, focused: false }),
		outDir: "/rig/frames",
		ackExists: (path) => acks.has(path),
		sleep: (ms) => {
			clock += ms;
			return new Promise((r) => setImmediate(r));
		},
		now: () => clock,
		log: (line) => {
			lines.push(line);
			// The harness: answer each external SHUTTER with its ack.
			const ack = line.match(/ ack=(\S+)$/)?.[1];
			if (ack && !over.withholdAck) acks.add(ack);
		},
		...over,
	};
	return { deps, lines, calls };
}

const script = (steps) => parseDevDriverScript(JSON.stringify({ steps }));

test("S1: a run prints ready, one line per step, SHUTTER lines with the window id, then DONE", async () => {
	const { deps, lines, calls } = fakeDeps();
	const result = await runDevDriverScript(
		script([
			{ verb: "state" },
			{ verb: "setTheme", payload: "localOperatorDark" },
			{
				verb: "shutter",
				payload: { label: "conversation-dark", capture: "external" },
			},
			{
				verb: "shutter",
				payload: { label: "library-dark", capture: "capturepage" },
			},
		]),
		deps,
	);
	assert.deepEqual(result, { ok: true, failedStep: null });
	assert.equal(lines[0], "[dev-driver-script] ready verbs=7");
	assert.equal(
		lines[1],
		'[dev-driver-script] step=1 verb=state ok {"activeSessionId":"ce618964c88e"}',
	);
	assert.equal(
		lines[2],
		'[dev-driver-script] step=2 verb=setTheme ok {"ok":true}',
	);
	assert.equal(
		lines[3],
		"[dev-driver-script] SHUTTER label=conversation-dark media=window:4242:0 visible=true focused=false ack=/rig/frames/conversation-dark.ack",
	);
	assert.match(
		lines[5],
		/^\[dev-driver-script\] SHUTTER label=library-dark capture=capturepage path=\/rig\/frames\/library-dark\.png width=2760 height=1744 visible=true focused=false$/,
	);
	assert.equal(lines.at(-1), "[dev-driver-script] DONE steps=4");
	assert.deepEqual(
		calls.map(([verb]) => verb),
		["state", "setTheme"],
		"shutter is main's, not a renderer verb",
	);
});

test("S1: an optional step's failure is skipped; a required one ends the run with no later frame", async () => {
	const { deps, lines } = fakeDeps({
		call: async (verb) => {
			if (verb === "waitFor")
				throw new Error("nothing matches [data-x] after 10ms of waiting");
			if (verb === "navigate") throw new Error("route never arrived");
			return {};
		},
	});
	const result = await runDevDriverScript(
		script([
			{ verb: "waitFor", payload: "[data-x]", optional: true },
			{ verb: "navigate", payload: "/library" },
			{
				verb: "shutter",
				payload: { label: "library-dark", capture: "external" },
			},
		]),
		deps,
	);
	assert.deepEqual(result, { ok: false, failedStep: 2 });
	assert.match(
		lines[1],
		/^\[dev-driver-script\] step=1 verb=waitFor skipped \(optional\): nothing matches/,
	);
	assert.equal(
		lines[2],
		"[dev-driver-script] step=2 verb=navigate error: route never arrived",
	);
	assert.equal(lines[3], "[dev-driver-script] FAILED step=2");
	assert.ok(
		!lines.some((l) => l.includes("SHUTTER")),
		"no frame after a failed step",
	);
});

test("S1: verbs that never install, and an ack that never comes, fail rather than hang", async () => {
	const never = fakeDeps({ verbs: async () => ["hello"] });
	assert.deepEqual(
		await runDevDriverScript(script([{ verb: "state" }]), never.deps),
		{ ok: false, failedStep: 0 },
	);
	assert.match(never.lines[0], /did not install state within 30000 ms/);

	const noAck = fakeDeps({ withholdAck: true });
	const result = await runDevDriverScript(
		script([{ verb: "shutter", payload: { label: "a", capture: "external" } }]),
		noAck.deps,
	);
	assert.deepEqual(result, { ok: false, failedStep: 1 });
	assert.match(
		noAck.lines.at(-2),
		/no ack at \/rig\/frames\/a\.ack within 60000 ms/,
	);
});

/* ---------------------------------------------- wiring pins (index.ts etc.) */

test("S1 wiring: channels, the script argument, the cap and banners exist only past the gate", () => {
	const index = read("src/main/index.ts");
	// The IPC listener is registered once, inside the runner, after its early return.
	const fn = index.slice(index.indexOf("function startDevDriverScriptOnce("));
	const early = fn.indexOf("devDriverScriptStarted\n\t)\n\t\treturn;");
	const listen = fn.indexOf("ipcMain.on(DEV_DRIVER_SCRIPT_RESULT");
	assert.ok(
		early !== -1 && listen > early,
		"the result listener is not behind the gate's early return",
	);
	assert.equal(
		index.split("DEV_DRIVER_SCRIPT_RESULT").length - 1,
		2,
		"one import, one registration",
	);
	assert.match(
		index,
		/!devDriverScript\.honoured \|\|\n\t\t!devDriverScript\.scriptPath \|\|/,
	);
	// The preload learns of the script only from main's honoured gate.
	assert.match(
		index,
		/\.\.\.\(devDriverScript\.honoured \? \[devDriverScriptArgument\(\)\] : \[\]\)/,
	);
	// Banners: `never` while a script runs, the launch plan otherwise.
	assert.match(
		index,
		/devDriverScript\.honoured \? "never" : windowLaunch\.show,/,
	);
	// Launcher-bound + capped like the S3 visible probe.
	assert.match(
		index,
		/boundedVisibleProbe:\n\t\t\t\taddressOverlayGate\.visible \|\| devDriverScript\.honoured,/,
	);
	assert.match(
		index,
		/if \(devDriverScript\.honoured\) \{\n\t\t\tconst scriptCap = setTimeout\([\s\S]{0,300}?DEV_DRIVER_SCRIPT_CAP_MS\);\n\t\t\tscriptCap\.unref\(\);/,
	);
	// Read from launchEnv, like every launch fact (a .env cannot supply it).
	assert.match(index, /resolveDevDriverScript\(\{\n\t\t\tenv: launchEnv,/);

	const preload = read("src/preload/dev-driver.ts");
	assert.match(
		preload,
		/if \(armed\.script\) installScriptListener\(bridge\);/,
	);
	assert.equal(
		preload.split("ipcRenderer.on(\n\t\tDEV_DRIVER_SCRIPT_STEP").length - 1,
		1,
	);
});

test("S2: the renderer verbs exist in the armed-only table", () => {
	const install = read("src/renderer/src/dev-driver/install.ts");
	const table = install.slice(
		install.indexOf("export function installDevDriver()"),
	);
	assert.match(table, /if \(!bridge\?\.armed\) return \[\];/);
	for (const verb of ["waitFor", "openCanvas", "skipOnboarding"])
		assert.match(table, new RegExp(`\\n\\t\\t${verb}: async \\(`), verb);
	// openCanvas writes the view BEFORE opening, like the canvas door.
	const open = table.slice(table.indexOf("openCanvas: async"));
	assert.ok(
		open.indexOf(".setViewMode(conversationId") <
			open.indexOf("setCanvasOpen(open)"),
	);
});

test("S3: the updater is quiet only on an armed (rig) boot", () => {
	const off = resolveDevDriverArming({ env: {}, windowMode: "normal" });
	assert.equal(devDriverQuietUpdatesReason(off), null);
	const armed = resolveDevDriverArming({
		env: {
			LOCAL_OPERATOR_UI_DEV_DRIVER: "1",
			LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: "/rig/frames",
		},
		windowMode: "inactive",
	});
	assert.match(
		devDriverQuietUpdatesReason(armed),
		/seal repair and app-initiated update checks are skipped/,
	);

	const service = read("src/main/update-service.ts");
	const ctor = service.slice(
		service.indexOf("\tconstructor(\n\t\tmainWindow: BrowserWindow,"),
	);
	const quit = ctor.indexOf("if (this.quietReason) {");
	assert.ok(quit !== -1, "the constructor's quiet branch is missing");
	assert.ok(
		quit < ctor.indexOf("this.repairReachableBundleSeals()"),
		"seal repair runs before the quiet return",
	);
	assert.ok(
		quit < ctor.indexOf("this.startPeriodicUpdateChecks();"),
		"periodic checks start before the quiet return",
	);
	assert.match(ctor.slice(quit, quit + 600), /\n\t\t\treturn;\n/);
	assert.match(
		service,
		/if \(this\.quietReason && options\?\.manual !== true\) \{[\s\S]{0,300}?return null;/,
	);
	assert.match(
		read("src/main/index.ts"),
		/quietReason: devDriverQuietUpdatesReason\(devDriverArming\),/,
	);
});
