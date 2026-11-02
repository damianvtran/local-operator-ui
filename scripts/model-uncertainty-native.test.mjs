const MISSING_CORE_PATTERN = /published core/;
const MISSING_BUILD_PATTERN = /build receipt/;
/** Pure producer/policy doors. No Electron, app build, backend or dependency install. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	assertModelTraffic,
	buildReceipt,
	modelUncertaintyCase,
	runOwnedModelCase,
	startModelBackend,
	verifyModelBuild,
	verifyModelExitArtifacts,
} from "./model-uncertainty-native.mjs";

const sid = "aaaaaaaaaaaa";

test("owned orchestration joins app/core before acceptance on success, failure and early refusal", async () => {
	for (const mode of ["success", "failure", "refusal"]) {
		const seen = [];
		const operation = runOwnedModelCase({
			run: async () => {
				seen.push("body");
				if (mode === "refusal") throw Error("early refusal");
				seen.push("app-drained");
				return mode === "failure" ? 1 : 0;
			},
			backend: {
				close: async () => {
					seen.push("core-closing");
					await new Promise((resolve) => setImmediate(resolve));
					seen.push("core-joined");
					return { clean: true };
				},
			},
			accept: async () => {
				seen.push("accept");
			},
		});
		if (mode === "success") {
			await operation;
			assert.deepEqual(seen, [
				"body",
				"app-drained",
				"core-closing",
				"core-joined",
				"accept",
			]);
		} else {
			await assert.rejects(operation);
			assert.equal(seen.at(-1), "core-joined");
			assert(!seen.includes("accept"));
		}
	}
	await assert.rejects(
		runOwnedModelCase({
			run: async () => 0,
			backend: { close: async () => ({ clean: false }) },
			accept: async () => assert.fail("unclean acceptance"),
		}),
	);
});

test("actual legacy exiting helper cannot pass the mandatory joined artifact gate", () => {
	const source = readFileSync(
		new URL("./renderer-driver.mjs", import.meta.url),
		"utf8",
	);
	const extract = (name) => {
		const start = source.indexOf(`async function ${name}(`);
		assert(start > 0);
		return source.slice(start, source.indexOf("\n}\n", start) + 3);
	};
	const root = mkdtempSync(join(tmpdir(), "model-exit-contract-"));
	const program = `import { writeFileSync } from 'node:fs'; const liveBoots=new Set();const reaping={running:false};const say=()=>{};const stopApp=async()=>{};const thisRunsProcesses=()=>({measured:true,lines:[]});const wait=async()=>{}; ${extract("drainLiveBoots")} ${extract("reapLiveBoots")} try { await reapLiveBoots({code:0,why:'negative'}); } finally { writeFileSync(${JSON.stringify(join(root, "core-close-marker"))},'closed'); }`;
	execFileSync(process.execPath, ["--input-type=module", "-e", program], {
		timeout: 5000,
	});
	assert.throws(() => readFileSync(join(root, "core-close-marker")));
	assert.throws(() => verifyModelExitArtifacts(root));
	// Exercise the extracted non-exiting primitive too: the same outer finally
	// must now join and leave its explicit marker, without loading Electron.
	const safe = program.replace(
		"await reapLiveBoots({code:0,why:'negative'});",
		"await drainLiveBoots({why:'positive'});",
	);
	execFileSync(process.execPath, ["--input-type=module", "-e", safe], {
		timeout: 5000,
	});
	assert.equal(readFileSync(join(root, "core-close-marker"), "utf8"), "closed");
	writeFileSync(
		join(root, "owned-core-exit.json"),
		JSON.stringify({
			clean: true,
			pid: 1,
			birth: "synthetic",
			descendants: [],
		}),
	);
	writeFileSync(
		join(root, "owned-app-exit.json"),
		JSON.stringify({ clean: true, stopped: 1 }),
	);
	writeFileSync(
		join(root, "measurements.json"),
		JSON.stringify({ frames: [{ label: "acceptance", verdict: "PASS" }] }),
	);
	assert.equal(verifyModelExitArtifacts(root).app.stopped, 1);
	writeFileSync(
		join(root, "owned-app-exit.json"),
		JSON.stringify({ clean: true, stopped: 0 }),
	);
	assert.throws(() => verifyModelExitArtifacts(root));
});
test("real model case is explicit opt-in and candidate-scoped, never part of old default matrix", () => {
	assert.equal(modelUncertaintyCase.backendMode, "real-core");
	assert.equal(modelUncertaintyCase.optInOnly, true);
	assert.equal(modelUncertaintyCase.frames.control, undefined);
	assert.equal(modelUncertaintyCase.frames.candidate.length, 7);
	assert(
		!modelUncertaintyCase.frames.candidate.some((label) =>
			label.includes("cold"),
		),
		"no native cold/pre-B GET claim without a real consumer",
	);
	const source = readFileSync(
		new URL("./asks-app-regression.mjs", import.meta.url),
		"utf8",
	);
	assert(source.includes("!entry.optInOnly"));
	assert(source.includes("startAsksAppFixture({ root: scratch, token })"));
});
test("missing compiled receipt refuses before native runtime or backend setup", () => {
	assert.throws(
		() => verifyModelBuild("/not-a-product", undefined),
		MISSING_BUILD_PATTERN,
	);
});
test("stale compiled bytes refuse before any native executable is resolved", () => {
	// A metadata-only fake tree calibrates rejection, never native success.
	const root = mkdtempSync(join(tmpdir(), "model-build-contract-"));
	const env = {
		...process.env,
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.invalid",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.invalid",
	};
	const git = (...args) =>
		execFileSync("git", ["-C", root, ...args], { env, stdio: "pipe" });
	for (const directory of ["src", "out/main", "out/preload", "out/renderer"])
		mkdirSync(join(root, directory), { recursive: true });
	writeFileSync(join(root, "src/main.ts"), "fixture-source");
	writeFileSync(join(root, "pnpm-lock.yaml"), "fixture-lock");
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ optionalDependencies: { electron: "45.1.0" } }),
	);
	for (const file of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		writeFileSync(join(root, file), "fixture-compiled");
	git("init", "-q");
	git("add", ".");
	git("commit", "-qm", "test: seal metadata fixture");
	const receipt = join(root, "receipt.json");
	writeFileSync(receipt, JSON.stringify(buildReceipt(root)));
	writeFileSync(join(root, "out/renderer/index.html"), "stale-or-mutated");
	const previous = process.env.MODEL_CASE_EXPECTED_HEAD;
	process.env.MODEL_CASE_EXPECTED_HEAD = git("rev-parse", "HEAD")
		.toString()
		.trim();
	try {
		assert.throws(
			() => verifyModelBuild(root, receipt),
			(error) => error.message.includes("compiled inputs/outputs"),
		);
	} finally {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "MODEL_CASE_EXPECTED_HEAD");
		else process.env.MODEL_CASE_EXPECTED_HEAD = previous;
	}
});
test("missing core refuses without manufacturing a fixture", async () => {
	const old = process.env.LOCAL_OPERATOR_CORE_PYTHON;
	try {
		process.env.LOCAL_OPERATOR_CORE_PYTHON = "/missing-owned-core/python";
		await assert.rejects(
			startModelBackend({ output: "/not-created" }),
			MISSING_CORE_PATTERN,
		);
	} finally {
		if (old === undefined)
			Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_CORE_PYTHON");
		else process.env.LOCAL_OPERATOR_CORE_PYTHON = old;
	}
});
test("new write policy is exact for session, model, keys and bodies", () => {
	const row = {
		method: "POST",
		path: `/v1/desktop/sessions/${sid}/commands`,
		body: {
			request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			command: "model",
			args: "test/mock-model-b",
		},
	};
	assert.doesNotThrow(() => assertModelTraffic([row], sid));
	assert.throws(() =>
		assertModelTraffic(
			[{ ...row, path: "/v1/desktop/sessions/bbbbbbbbbbbb/commands" }],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[{ ...row, body: { ...row.body, args: "test/wrong" } }],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[
				{
					method: "PATCH",
					path: "/v1/settings/api_key",
					body: { value: "never", base: null },
				},
			],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[
				{
					method: "PATCH",
					path: "/v1/settings/model_name",
					body: { value: "mock-model-a", base: null },
				},
			],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic([{ method: "GET", path: "/unmodeled-endpoint" }], sid),
	);
	assert.throws(() =>
		assertModelTraffic(
			[{ method: "DELETE", path: `/v1/desktop/sessions/${sid}` }],
			sid,
		),
	);
});
test("Python transport contracts preserve genuine bytes and never enforce the candidate default fence", () => {
	const output = execFileSync(
		"python3",
		[new URL("./model_uncertainty_backend_test.py", import.meta.url).pathname],
		{
			encoding: "utf8",
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
			timeout: 20_000,
		},
	);
	assert.equal(typeof output, "string");
});
function oracleContext(mode = "happy") {
	const sid = "aaaaaaaaaaaa";
	const frames = [];
	const stamps = [];
	const calls = [];
	const receipts = [];
	const attempts = [];
	const payload = (model, epoch, seq) => ({
		epoch,
		seq,
		payload: {
			cold: false,
			frontend: { snapshot: { selected_model: { model_id: model } } },
		},
	});
	const stale = {
		id: 1,
		path: `/v1/desktop/sessions/${sid}/events`,
		before_b_request: true,
		body: `data: ${JSON.stringify(payload("mock-model-a", "epoch-A", 1))}`,
	};
	const fresh = {
		id: 2,
		path: `/v1/desktop/sessions/${sid}`,
		before_b_request: false,
		body: JSON.stringify({ result: payload("mock-model-b", "epoch-B", 2) }),
	};
	let phase = "before";
	let disabled = false;
	let current = "test/mock-model-a";
	let saved = false;
	let armed = false;
	let late = false;
	let lateArmed = false;
	const released = new Set();
	const addPatch = () => {
		attempts.push({
			method: "PATCH",
			path: "/v1/settings/model_name",
			observer: false,
			body: { value: "mock-model-a", base: null },
		});
	};
	const trace = () => {
		const result = {
			armed,
			fault: false,
			receipts: receipts.map((x) => ({ ...x })),
		};
		if (mode === "late-after-read" && phase === "unknown" && !lateArmed) {
			late = true;
			lateArmed = true;
		}
		return result;
	};
	const state = () => {
		const result = {
			attempts: attempts.map((x) => ({ ...x })),
			commit: phase === "before" ? null : { durable: "mock-model-b" },
			captures: [stale, ...(phase === "before" ? [] : [fresh])],
		};
		if (late) {
			late = false;
			addPatch();
		}
		return result;
	};
	const geometry = () => ({
		disabled,
		checked: "false",
		current,
		neutral: phase !== "before",
		box: { x: 1, y: 1, w: 20, h: 20 },
		dialog: { w: 400, h: 300 },
	});
	const allowedFrames = new Set(modelUncertaintyCase.frames.candidate);
	return {
		frames,
		stamps,
		calls,
		api: {
			verb: async (_cdp, name, arg = {}) => {
				assert.equal(name, "modelAuthority", "unknown fake verb");
				assert(
					Object.keys(arg).every((k) => k === "start"),
					"unknown fake observer argument",
				);
				if (arg.start === true) {
					armed = true;
					receipts.length = 0;
				}
				return trace();
			},
		},
		cdp: {
			send: async (name, args) => {
				assert(
					["Input.insertText", "Input.dispatchKeyEvent"].includes(name),
					"unknown fake input",
				);
				if (name === "Input.insertText") assert.equal(args.text, "/model");
			},
			evaluate: async (source) => {
				if (source.includes("model-case: geometry")) return geometry();
				if (
					source.includes("model-case: mark-targets") ||
					source.includes("model-case: mark-save")
				)
					return;
				assert.fail("unknown fake page predicate");
			},
		},
		wait: async (predicate) => {
			calls.push(["wait", predicate]);
			if (
				predicate ===
				'document.querySelectorAll("[data-tour-tag=chat-session-row]").length===1'
			)
				return;
			if (
				predicate ===
				'[...document.querySelectorAll("[cmdk-item]")].some(e=>e.textContent.includes("mock-model-b"))'
			)
				return;
			if (
				predicate === "/could not be confirmed/i.test(document.body.innerText)"
			) {
				assert.equal(phase, "unknown");
				return;
			}
			assert.fail("unknown fake wait predicate");
		},
		waitFor: async (predicate) => {
			for (let n = 0; n < 3; n++) if (await predicate()) return;
			return;
		},
		press: async (selector) => {
			calls.push(["press", selector]);
			if (
				selector === '[data-tour-tag="chat-session-row"]' ||
				selector === '[contenteditable="true"][role="textbox"]'
			)
				return;
			if (selector === "[data-model-case-b]") {
				assert.equal(phase, "before");
				phase = "unknown";
				disabled = true;
				if (mode === "old-receipt-only")
					receipts.push({
						carrier: "canonical-sse",
						sessionId: sid,
						epoch: "epoch-A",
						seq: 1,
						disposition: "processed",
					});
				attempts.push({
					method: "POST",
					path: `/v1/desktop/sessions/${sid}/commands`,
					observer: false,
					body: {
						request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						command: "model",
						args: "test/mock-model-b",
					},
				});
				return;
			}
			if (selector === "[data-model-case-default]") {
				if (!disabled) {
					receipts.push({
						carrier: "default-save",
						sessionId: "",
						epoch: null,
						seq: null,
						disposition: "invoked",
					});
					addPatch();
				}
				return;
			}
			if (selector === "[data-model-case-save]") {
				assert.equal(current, "test/mock-model-b");
				assert.equal(disabled, false);
				saved = true;
				receipts.push({
					carrier: "default-save",
					sessionId: "",
					epoch: null,
					seq: null,
					disposition: "invoked",
				});
				for (const [key, value] of [
					["hosting", "test"],
					["model_name", "mock-model-b"],
				])
					attempts.push({
						method: "PATCH",
						path: `/v1/settings/${key}`,
						observer: false,
						body: { value, base: null },
					});
				return;
			}
			assert.fail("unknown fake input selector");
		},
		frame: async (label) => {
			assert(allowedFrames.has(label), "unknown fake frame");
			frames.push(label);
			if (mode === "during-stale-frame" && label === "model-stale-sse")
				disabled = false;
			if (mode === "late-after-frame" && label === "model-unknown-1")
				addPatch();
			if (mode === "late-saved-frame" && label === "model-default-saved")
				addPatch();
		},
		stamp: (label, value) => stamps.push({ label, value }),
		realBackend: {
			sessionId: sid,
			readTemplates: [],
			commandA: async () => ({ status: 200 }),
			state: async () => state(),
			defaultValues: async () => ({
				hosting: "test",
				model_name: saved ? "mock-model-b" : "mock-model",
			}),
			waitCapture: async (predicate) => {
				const found = [stale, ...(phase === "before" ? [] : [fresh])].find(
					predicate,
				);
				assert(found, "actual predicate did not match a genuine fake carrier");
				return found;
			},
			control: async (op, arg = {}) => {
				assert(
					["configure", "release"].includes(op),
					"unknown fake backend op",
				);
				if (op === "configure") return;
				if (!arg.indices) return;
				for (const id of arg.indices) {
					if (released.has(id)) continue;
					released.add(id);
					if (id === 1) {
						phase = "stale";
						if (mode !== "unconsumed-sse" && mode !== "old-receipt-only")
							receipts.push({
								carrier: "canonical-sse",
								sessionId: sid,
								epoch: "epoch-A",
								seq: 1,
								disposition: "processed",
							});
						if (mode === "early-sse") disabled = false;
					} else if (id === 2) {
						phase = "fresh";
						if (mode !== "unconsumed-get")
							receipts.push({
								carrier: "model-get",
								sessionId: sid,
								epoch: "epoch-B",
								seq: 2,
								disposition: "live",
							});
						disabled = false;
						if (mode !== "rendered-A") current = "test/mock-model-b";
					} else assert.fail("unknown fake release id");
				}
			},
		},
	};
}

test("actual native drive accepts only consumed SSE + real post-ACK B with explicit two writes", async () => {
	const ctx = oracleContext();
	await modelUncertaintyCase.drive(ctx);
	assert.deepEqual(ctx.frames, modelUncertaintyCase.frames.candidate);
	assert.equal(
		ctx.calls.filter(
			(x) => x[0] === "press" && x[1] === "[data-model-case-default]",
		).length,
		3,
	);
});
for (const mode of [
	"early-sse",
	"during-stale-frame",
	"unconsumed-sse",
	"old-receipt-only",
	"unconsumed-get",
	"rendered-A",
	"late-after-read",
	"late-after-frame",
	"late-saved-frame",
]) {
	test(`actual native drive rejects ${mode}`, async () => {
		const ctx = oracleContext(mode);
		await assert.rejects(modelUncertaintyCase.drive(ctx));
	});
}

test("observer is ordinary-mode NOOP and armed receipts retain only bounded metadata", async () => {
	const { transformSync } = await import("esbuild");
	const raw = readFileSync(
		new URL(
			"../src/renderer/src/dev-driver/model-authority-observer.ts",
			import.meta.url,
		),
		"utf8",
	);
	const output = transformSync(raw, { loader: "ts", format: "esm" }).code;
	const observer = await import(
		`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
	);
	const previous = globalThis.window;
	try {
		Reflect.deleteProperty(globalThis, "window");
		observer.armModelAuthorityObserver();
		observer.observeModelAuthority({
			carrier: "canonical-sse",
			sessionId: "aaaaaaaaaaaa",
			epoch: "e",
			seq: 1,
			disposition: "processed",
		});
		assert.deepEqual(observer.readModelAuthorityObserver(), {
			armed: false,
			fault: false,
			receipts: [],
		});
		globalThis.window = { __loDevDriver: { armed: true } };
		observer.armModelAuthorityObserver();
		const input = {
			carrier: "model-get",
			sessionId: "aaaaaaaaaaaa",
			epoch: "e",
			seq: 2,
			disposition: "live",
			payload: "MUST_NOT_RETAIN",
			authorization: "MUST_NOT_RETAIN",
		};
		const before = JSON.stringify(input);
		observer.observeModelAuthority(input);
		assert.equal(JSON.stringify(input), before);
		assert.deepEqual(
			Object.keys(observer.readModelAuthorityObserver().receipts[0]).sort(),
			["carrier", "disposition", "epoch", "seq", "sessionId"],
		);
		const copy = observer.readModelAuthorityObserver();
		copy.receipts.length = 0;
		assert.equal(observer.readModelAuthorityObserver().receipts.length, 1);
		for (let n = 0; n < 256; n++) observer.observeModelAuthority(input);
		assert.equal(observer.readModelAuthorityObserver().fault, true);
		assert.equal(observer.readModelAuthorityObserver().receipts.length, 256);
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
		else globalThis.window = previous;
	}
});

test("strict oracle context rejects unknown predicates/verbs rather than defaulting to success", async () => {
	const ctx = oracleContext();
	await assert.rejects(ctx.wait("unknown predicate"));
	await assert.rejects(ctx.cdp.evaluate("unknown predicate"));
	await assert.rejects(ctx.api.verb(null, "unknown"));
});
