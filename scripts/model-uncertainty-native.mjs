const REGEX_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;
const REQUEST_ID_PATTERN =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/**
 * One opt-in real-backend case for the existing asks native producer.
 * This module never boots Electron on import. The old fixture/policy stays
 * separate: model/default writes must reach real core, not a permissive mock.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { installedElectronBinary } from "./electron-runtime-path.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

export function verifyModelExitArtifacts(output) {
	const core = JSON.parse(readFileSync(join(output, "owned-core-exit.json")));
	const app = JSON.parse(readFileSync(join(output, "owned-app-exit.json")));
	const measurement = JSON.parse(
		readFileSync(join(output, "measurements.json")),
	);
	assert.equal(core.clean, true, "joined core exit receipt missing");
	assert.equal(app.clean, true, "joined app exit receipt missing");
	assert.equal(app.stopped, 1, "the single owned native app was not joined");
	assert(
		Number.isInteger(core.pid) &&
			core.pid > 0 &&
			typeof core.birth === "string",
		"owned core PID/birth witness missing",
	);
	assert(
		Array.isArray(core.descendants),
		"owned descendant settlement witness missing",
	);
	assert(
		measurement.frames.some(
			(frame) => frame.label === "acceptance" && frame.verdict === "PASS",
		),
		"case acceptance absent after cleanup",
	);
	return { core, app };
}

/** A case cannot report PASS until both owned lifetimes have joined. */
export async function runOwnedModelCase({ run, backend, accept }) {
	let failure;
	let code;
	try {
		code = await run();
		if (code !== 0) throw new Error(`model case failed (${code})`);
	} catch (error) {
		failure = error;
	}
	let receipt;
	try {
		receipt = await backend.close();
		assert.equal(
			receipt?.clean,
			true,
			"owned backend exit/descendants not settled",
		);
	} catch (error) {
		failure = failure
			? new AggregateError([failure, error], "case and cleanup failed")
			: error;
	}
	if (failure) throw failure;
	await accept(receipt);
	return code;
}

export const MODEL_CORE_VERSION = "0.94.15";
export const MODEL_CORE_REF = "a8c96c2ac1d71b776f40ed68ae5a2322bbe3c1ed";
const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const git = (root, ...args) =>
	execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** A receipt made immediately after CI's canonical build, not a stale out/ guess. */
export function buildReceipt(root) {
	const pkg = JSON.parse(readFileSync(join(root, "package.json")));
	const sourceSpecs = [
		"src",
		"package.json",
		"pnpm-lock.yaml",
		"electron.vite.config.*",
		"tsconfig*.json",
		"postcss.config.*",
		"tailwind.config.*",
	];
	assert.equal(
		git(root, "status", "--porcelain", "--", ...sourceSpecs),
		"",
		"compiled source inputs are not committed/clean",
	);
	const inputs = git(root, "ls-files", ...sourceSpecs)
		.split("\n")
		.filter(Boolean);
	const walk = (dir) =>
		readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? walk(`${dir}/${entry.name}`)
				: [`${dir}/${entry.name}`],
		);
	for (const name of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		assert(existsSync(join(root, name)), `missing compiled product ${name}`);
	const outputs = walk("out").sort();
	for (const name of outputs)
		assert(existsSync(join(root, name)), `missing compiled product ${name}`);
	return {
		sourceHead: git(root, "rev-parse", "HEAD"),
		sourceTree: git(root, "rev-parse", "HEAD:src"),
		lock: hash(readFileSync(join(root, "pnpm-lock.yaml"))),
		electron: pkg.optionalDependencies.electron,
		inputs: Object.fromEntries(
			inputs.map((p) => [p, hash(readFileSync(join(root, p)))]),
		),
		outputs: Object.fromEntries(
			outputs.map((p) => [p, hash(readFileSync(join(root, p)))]),
		),
	};
}

export function verifyModelBuild(root, receiptPath) {
	assert(
		receiptPath && existsSync(receiptPath),
		"model case requires the reviewed CI build receipt",
	);
	if (process.env.CI) {
		assert(
			process.env.MODEL_CASE_EXPECTED_HEAD,
			"CI must name its exact compiled checkout",
		);
		assert.equal(
			git(root, "rev-parse", "HEAD"),
			process.env.MODEL_CASE_EXPECTED_HEAD,
		);
	}
	assert.deepEqual(
		buildReceipt(root),
		JSON.parse(readFileSync(receiptPath)),
		"compiled inputs/outputs or frozen head changed",
	);
	const electron = JSON.parse(
		readFileSync(join(root, "node_modules/electron/package.json")),
	);
	const pkg = JSON.parse(readFileSync(join(root, "package.json")));
	assert.equal(
		electron.version,
		pkg.optionalDependencies.electron,
		"wrong pinned Electron",
	);
	// This producer requires the real installed dist, not an ambient override.
	return installedElectronBinary(root, null);
}

/** Dedicated policy, never used to loosen the existing asks read-only policy. */
export function assertModelTraffic(
	attempts,
	sessionId,
	readTemplates = [],
	feedOpens = [],
	proof = {},
) {
	const base = `/v1/desktop/sessions/${sessionId}`;
	const reads = new Set([
		"/health",
		"/v1/capabilities",
		"/v1/settings",
		"/v1/credentials",
		"/v1/desktop/capabilities",
		"/v1/desktop/models",
		"/v1/desktop/sessions",
		"/v1/desktop/events",
		"/v1/desktop/agents",
		"/v1/desktop/teams",
		"/v1/desktop/projects",
		"/v1/desktop/attention",
		"/v1/desktop/tags",
		"/v1/desktop/notifications",
		"/v1/desktop/commands",
		"/v1/desktop/peers",
		"/v1/desktop/status",
		base,
		`${base}/events`,
		`${base}/checkpoints`,
		`${base}/todos`,
		`${base}/jobs`,
		`${base}/approvals`,
		`${base}/permissions`,
		`${base}/usage`,
		`${base}/cost`,
		`${base}/supplements`,
		`${base}/notes`,
		`${base}/system-prompt`,
	]);
	for (const request of attempts.filter((x) => !x.observer)) {
		if (request.method === "GET") {
			const known =
				reads.has(request.path) ||
				readTemplates.some((template) => {
					const pattern = template
						.split("/")
						.map((part) =>
							part === "{session_id}"
								? sessionId
								: part.startsWith("{")
									? "[^/]+"
									: part.replace(REGEX_ESCAPE_PATTERN, "\\$&"),
						)
						.join("/");
					return new RegExp(`^${pattern}$`).test(request.path);
				});
			if (!known) {
				const resident =
					/^\/v1\/desktop\/sessions\/([a-f0-9]{12})(\/command-entities)?$/.exec(
						request.path,
					);
				assert(
					resident && resident[1] !== sessionId,
					`unmodeled native read ${request.path}`,
				);
				assert.deepEqual(
					request.query,
					resident[2] ? { command: "effort" } : {},
				);
				assert.equal(request.query_empty, !resident[2]);
				assert(!request.query_invalid);
				assert.equal(request.response_status, 200);
				assert(
					Number.isInteger(request.delivery_order) &&
						request.delivery_order > request.order,
				);
				const ownedList = proof.listWitnesses?.some((w) => {
					const list = attempts.find((a) => a.index === w.request_index);
					return (
						typeof proof.scopeId === "string" &&
						w.scope_id === proof.scopeId &&
						w.response_status === 200 &&
						list?.observer === false &&
						list.method === "GET" &&
						list.path === "/v1/desktop/sessions" &&
						list.response_status === 200 &&
						Number.isInteger(list.order) &&
						Number.isInteger(w.delivery_order) &&
						list.order < w.delivery_order &&
						w.delivery_order < request.order &&
						w.rows?.some(
							(row) =>
								row.id === resident[1] &&
								row.local === true &&
								row.peer_null === true,
						)
					);
				});
				assert(
					ownedList,
					"resident read lacks earlier delivered owned local LIST witness",
				);
			}
			continue;
		}
		if (request.path === "/v1/desktop/presence") {
			// Notification lease/attendance writes belong to the app's ORIGINAL
			// authenticated feed, not to arbitrary backend membership or a future ID.
			assert.equal(request.method, "POST");
			assert.equal(request.query_empty, true);
			const body = request.body;
			assert(body && typeof body === "object" && !Array.isArray(body));
			assert.deepEqual(Object.keys(body).sort(), [
				"can_notify",
				"can_notify_kinds",
				"session_id",
				"subscription_id",
				"window",
			]);
			assert.equal(body.can_notify, true);
			assert.deepEqual(body.can_notify_kinds, ["complete", "error"]);
			assert(["", sessionId].includes(body.session_id));
			assert(
				body.window &&
					typeof body.window === "object" &&
					!Array.isArray(body.window),
			);
			assert.deepEqual(Object.keys(body.window).sort(), [
				"exists",
				"focused",
				"minimized",
				"visible",
			]);
			assert(
				Object.values(body.window).every((value) => typeof value === "boolean"),
			);
			assert(
				typeof body.subscription_id === "string" &&
					body.subscription_id.length > 0 &&
					body.subscription_id.length <= 64,
			);
			const witness = feedOpens.find((open) => {
				const feed = attempts.find((a) => a.index === open.request_index);
				return (
					open.subscription_id === body.subscription_id &&
					open.delivered === true &&
					open.response_status === 200 &&
					feed?.observer === false &&
					feed.method === "GET" &&
					feed.path === "/v1/desktop/events" &&
					Number.isInteger(feed.order) &&
					Number.isInteger(open.open_order) &&
					Number.isInteger(request.order) &&
					feed.order < open.open_order &&
					open.open_order < request.order &&
					(open.close_order === null ||
						(Number.isInteger(open.close_order) &&
							open.close_order > request.order))
				);
			});
			assert(
				witness,
				"presence lacks earlier live owned app-feed open witness",
			);
			assert.equal(
				request.response_status,
				200,
				"presence lease was not accepted",
			);
			continue;
		}
		if (
			request.method === "POST" &&
			[
				"/v1/desktop/claim",
				"/v1/desktop/radient",
				`${base}/watch`,
				`${base}/warm`,
				`${base}/unwatch`,
			].includes(request.path)
		)
			continue;
		if (request.path === "/v1/desktop/sessions/preview") {
			assert.equal(request.method, "POST");
			assert.equal(request.query_empty, true);
			assert.equal(request.response_status, 200);
			assert(
				Number.isInteger(request.delivery_order) &&
					request.delivery_order > request.order,
			);
			assert.equal(
				attempts.filter((a) => !a.observer && a.path === request.path).length,
				1,
			);
			const body = request.body;
			assert(body && typeof body === "object");
			assert(
				Object.keys(body).every((k) =>
					["request_id", "cwd", "target", "model"].includes(k),
				),
			);
			assert.match(body.request_id, REQUEST_ID_PATTERN);
			assert(
				!attempts.some(
					(a) => a !== request && a.body?.request_id === body.request_id,
				),
				"preview UUID reused",
			);
			if (body.cwd === "~") {
				assert.match(proof.serverHomeId ?? "", /^[a-f0-9]{64}$/);
				assert.equal(request.server_home_id, proof.serverHomeId);
			} else {
				assert.equal(body.cwd, proof.fixtureCwd);
			}
			assert.equal(request.cwd_owned, true);
			assert(
				typeof proof.scopeId === "string" && request.scope_id === proof.scopeId,
			);
			assert.equal(proof.defaultSynthetic, true);
			assert(body.target === undefined || body.target === null);
			assert(body.model === undefined || body.model === null);
			continue;
		}
		if (request.method === "POST" && request.path === `${base}/commands`) {
			assert.equal(request.body.command, "model");
			if (request.body.args === "") {
				assert.deepEqual(Object.keys(request.body).sort(), [
					"args",
					"command",
					"images",
					"request_id",
				]);
				assert.deepEqual(request.body.images, []);
				assert.match(request.body.request_id, REQUEST_ID_PATTERN);
				assert.equal(request.query_empty, true);
				assert.equal(request.response_status, 200);
				assert.deepEqual(request.native_action, {
					kind: "native_action",
					destination: "session.model",
					session_id: sessionId,
				});
				const b = attempts.find(
					(a) =>
						!a.observer &&
						a.path === request.path &&
						a.body?.args === "test/mock-model-b",
				);
				assert(
					b &&
						Number.isInteger(request.order) &&
						Number.isInteger(request.delivery_order) &&
						request.order < request.delivery_order &&
						request.delivery_order < b.order,
					"bare model receipt must precede B intent",
				);
				assert.notEqual(request.body.request_id, b.body.request_id);
				assert.equal(
					attempts.filter(
						(a) =>
							!a.observer && a.path === request.path && a.body?.args === "",
					).length,
					1,
				);
				continue;
			}
			assert.equal(request.body.args, "test/mock-model-b");
			assert(
				Object.keys(request.body).every((key) =>
					["request_id", "command", "args", "images"].includes(key),
				),
			);
			assert.match(request.body.request_id, REQUEST_ID_PATTERN);
			if (request.body.images) assert.deepEqual(request.body.images, []);
			continue;
		}
		assert.equal(
			request.method,
			"PATCH",
			`unmodeled native mutation ${request.path}`,
		);
		assert(
			["/v1/settings/hosting", "/v1/settings/model_name"].includes(
				request.path,
			),
			`unsafe settings key ${request.path}`,
		);
		const keys = Object.keys(request.body).sort();
		assert(
			(keys.length === 1 && keys[0] === "value") ||
				(keys.length === 2 && keys[0] === "base" && keys[1] === "value"),
		);
		if (Object.hasOwn(request.body, "base"))
			assert.equal(request.body.base, null);
		assert.equal(request.query_empty, true);
		assert.equal(request.response_status, 200);
		assert(
			Number.isInteger(proof.saveBarrierOrder) &&
				Number.isInteger(request.order) &&
				request.order > proof.saveBarrierOrder,
			"default write preceded explicit gesture barrier",
		);
		assert(
			Number.isInteger(request.delivery_order) &&
				request.delivery_order > request.order,
		);
		assert.deepEqual(
			attempts
				.filter((a) => !a.observer && a.method === "PATCH")
				.map((a) => a.path),
			["/v1/settings/hosting", "/v1/settings/model_name"],
		);
		const settingsWrites = attempts.filter(
			(a) => !a.observer && a.method === "PATCH",
		);
		assert(
			settingsWrites[0].delivery_order < settingsWrites[1].order,
			"model_name write preceded hosting acceptance",
		);
		assert.equal(
			request.body.value,
			request.path.endsWith("/hosting") ? "test" : "mock-model-b",
		);
	}
}

/** The real backend's Python boundary: never inherit an ambient installed-app
 * bytecode prefix. PYTHONPATH is reintroduced ONLY for this run's owned guard.
 * Exported so the hostile-prefix control executes this exact builder, not a copy.
 */
export function modelBackendPythonEnv({ scratch, token, observerToken }) {
	const home = join(scratch, "home");
	return pythonChildEnv({
		base: {
			MODEL_CASE_GUARD_LOG: join(scratch, "blocked-network.ndjson"),
			MODEL_CASE_FIXTURE_CWD: scratch,
			MODEL_CASE_CHILD_PIDS: join(scratch, "owned-child-pids"),
			PATH: process.env.PATH,
			HOME: home,
			TMPDIR: join(scratch, "tmp"),
			LOCAL_OPERATOR_CONFIG_DIR: join(home, ".local-operator"),
			LOCAL_OPERATOR_DESKTOP_TOKEN: token,
			MODEL_CASE_OBSERVER_TOKEN: observerToken,
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			LOCAL_OPERATOR_UI_TELEMETRY: "off",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
			LANG: "en_US.UTF-8",
		},
		prefix: join(scratch, "pycache"),
		extra: { PYTHONPATH: `${join(scratch, "guards")}:${SCRIPT_ROOT}` },
	});
}

export async function startModelBackend({ output }) {
	const python = process.env.LOCAL_OPERATOR_CORE_PYTHON;
	const bin = process.env.LOCAL_OPERATOR_CORE_BIN;
	assert(
		python && bin && existsSync(python) && existsSync(bin),
		"published core executable/interpreter missing",
	);
	assert.equal(
		dirname(resolve(python)),
		dirname(resolve(bin)),
		"core executable/interpreter roots disagree",
	);
	const scratchBase =
		process.env.LOCAL_OPERATOR_SCRATCHPAD || process.env.RUNNER_TEMP;
	assert(scratchBase, "owned scratch root required");
	const scratch = mkdtempSync(join(scratchBase, "model-native-"));
	const home = join(scratch, "home");
	const config = join(home, ".local-operator");
	mkdirSync(config, { recursive: true });
	mkdirSync(join(scratch, "tmp"), { recursive: true });
	const token = randomBytes(32).toString("base64url");
	const observerToken = randomBytes(32).toString("base64url");
	const guards = join(scratch, "guards");
	mkdirSync(guards);
	writeFileSync(
		join(guards, "sitecustomize.py"),
		"from model_uncertainty_backend import restrict_network\nrestrict_network()\n",
	);
	const env = modelBackendPythonEnv({ scratch, token, observerToken });
	writeFileSync(
		join(config, "config.yml"),
		"values:\n  hosting: test\n  model_name: mock-model\n  language: en\n",
	);
	// Only this exact predeclared synthetic default may authorize neutral preview.
	assert.equal(
		readFileSync(join(config, "config.yml"), "utf8"),
		"values:\n  hosting: test\n  model_name: mock-model\n  language: en\n",
	);
	const policyScope = {
		scopeId: createHash("sha256").update(realpathSync(config)).digest("hex"),
		fixtureCwd: realpathSync(scratch),
		defaultSynthetic: true,
		serverHomeId: createHash("sha256").update(realpathSync(home)).digest("hex"),
	};
	// Parent declarations precede child startup/requests. The recorder verifies
	// actual server HOME/config/fixture independently; no request supplies them.
	assert.equal(realpathSync(env.HOME), realpathSync(home));
	env.MODEL_CASE_EXPECTED_SERVER_HOME = realpathSync(home);
	env.MODEL_CASE_EXPECTED_SERVER_SCOPE = policyScope.scopeId;
	// Seed with the production writer/parser and capture stamp. These are INITIAL
	// cached rows; the real live pass is allowed to answer empty and is held.
	const seed =
		"import dataclasses; from local_operator.model import catalogue as c,discovery as d; p={'capture':d.listing_capture_version('test'),'models':[dataclasses.asdict(d.DiscoveredModel(id=m,name=m,context_window=8192)) for m in ('mock-model-a','mock-model-b')]}; c.cached_listing(d._cache_key('test'),lambda:p)";
	execFileSync(python, ["-c", seed], { cwd: scratch, env, stdio: "pipe" });
	const helper = join(SCRIPT_ROOT, "model_uncertainty_backend.py");
	const child = spawn(python, [helper], {
		cwd: scratch,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const birthProbe = spawnSync(
		"ps",
		["-p", String(child.pid), "-o", "lstart="],
		{ encoding: "utf8" },
	);
	const birth = birthProbe.status === 0 ? birthProbe.stdout.trim() : null;
	const pending = new Map();
	let counter = 0;
	const logs = [];
	const saveLog = (line) => {
		logs.push(line);
		if (logs.join("\n").length > 4_000_000) {
			child.kill("SIGTERM");
			for (const waiter of pending.values())
				waiter.reject(Error("owned core log bound exceeded"));
			return;
		}
		writeFileSync(join(scratch, "backend.log"), logs.join("\n"));
	};
	createInterface({ input: child.stdout }).on("line", (line) => {
		if (!line.startsWith("MODEL_CASE_CONTROL ")) {
			saveLog(line);
			return;
		}
		const answer = JSON.parse(line.slice("MODEL_CASE_CONTROL ".length));
		const waiter = pending.get(answer.id);
		if (waiter) {
			pending.delete(answer.id);
			answer.ok ? waiter.resolve(answer) : waiter.reject(Error(answer.error));
		}
	});
	createInterface({ input: child.stderr }).on("line", saveLog);
	const closed = new Promise((done) =>
		child.once("exit", (code, signal) => done({ code, signal })),
	);
	const control = (op, fields = {}) =>
		new Promise((resolveAnswer, reject) => {
			const id = ++counter;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(Error(`core control ${op} timed out`));
			}, 10_000);
			pending.set(id, {
				resolve: (x) => {
					clearTimeout(timer);
					resolveAnswer(x);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			child.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
		});
	const request = async (
		path,
		{ method = "GET", body, observer = true, auth = true } = {},
	) => {
		const response = await fetch(`http://127.0.0.1:8080${path}`, {
			method,
			headers: {
				...(auth ? { authorization: `Bearer ${token}` } : {}),
				...(observer ? { "x-model-case-observer": observerToken } : {}),
				"content-type": "application/json",
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(25_000),
		});
		const text = await response.text();
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			data = { rawError: text };
		}
		return { status: response.status, data };
	};
	const performCloseOwnedCore = async () => {
		const errors = [];
		const receipt = { pid: child.pid, birth, root: config, clean: false };
		// Output can be unwritable precisely when cleanup matters most. Diagnostic
		// failures remain failures, but must never strand the owned process group.
		try {
			// Persist original bounded capture state BEFORE cleanup releases senders.
			// Attempts never include auth headers/tokens; this rig owns synthetic data.
			mkdirSync(output, { recursive: true });
			try {
				writeFileSync(
					join(output, "backend-capture-state.json"),
					JSON.stringify(await control("state")),
				);
			} catch (error) {
				errors.push(error);
				writeFileSync(
					join(output, "backend-capture-state.json"),
					JSON.stringify({ diagnosticError: String(error) }),
				);
			}
			writeFileSync(
				join(output, "backend-diagnostic.log"),
				logs.join("\n").slice(-64_000),
			);
		} catch (error) {
			errors.push(error);
		} finally {
			try {
				try {
					await control("release");
				} catch (error) {
					receipt.releaseError = String(error);
					errors.push(error);
				}
				if (child.exitCode === null && child.signalCode === null) {
					const now = spawnSync(
						"ps",
						["-p", String(child.pid), "-o", "lstart="],
						{ encoding: "utf8" },
					);
					if (birth && now.status === 0 && now.stdout.trim() === birth)
						child.kill("SIGTERM");
					else child.stdin.end(); // no signal without a birth witness; join the private owner EOF path
				}
				let timer;
				try {
					Object.assign(
						receipt,
						await Promise.race([
							closed,
							new Promise((_, reject) => {
								timer = setTimeout(
									() => reject(Error("owned core exit deadline")),
									15_000,
								);
							}),
						]),
					);
				} finally {
					clearTimeout(timer);
				}
				const ledger = join(scratch, "owned-child-pids");
				const pids = existsSync(ledger)
					? [
							...new Set(
								readFileSync(ledger, "utf8")
									.trim()
									.split(/\s+/)
									.filter(Boolean),
							),
						]
					: [];
				assert(
					pids.every((pid) => /^[1-9][0-9]*$/.test(pid)),
					"invalid owned descendant ledger",
				);
				const until = Date.now() + 5000;
				for (;;) {
					if (pids.length === 0) break;
					const probe = spawnSync("ps", ["-p", pids.join(","), "-o", "pid="], {
						encoding: "utf8",
					});
					assert(
						!probe.error &&
							[0, 1].includes(probe.status) &&
							!probe.stderr.trim(),
						"owned descendant observation unavailable",
					);
					if (!probe.stdout.trim()) break;
					assert(
						Date.now() < until,
						"owned descendants have not settled; no unknown-PID signal fallback",
					);
					await delay(100);
				}
				receipt.descendants = pids;
				receipt.joined = true;
				assert(!receipt.releaseError, receipt.releaseError);
				receipt.clean = errors.length === 0;
			} catch (error) {
				errors.push(error);
			} finally {
				if (errors.length) receipt.error = errors.map(String).join("; ");
				try {
					writeFileSync(
						join(output, "owned-core-exit.json"),
						JSON.stringify(receipt, null, 2),
					);
				} catch (error) {
					errors.push(error);
				}
			}
		}
		// The memoized promise settles ONLY after cleanup, even when no receipt can
		// be written. Never replace the original I/O error with a cleanup exception.
		if (errors.length)
			throw new AggregateError(
				errors,
				"owned core diagnostics or cleanup failed",
			);
		return receipt;
	};
	let closePromise;
	const closeOwnedCore = () => {
		if (!closePromise) closePromise = performCloseOwnedCore();
		return closePromise;
	};
	let sessionId;
	let readTemplates = [];
	try {
		assert(birth, "owned core birth witness unavailable");
		const deadline = Date.now() + 30_000;
		for (;;) {
			try {
				const x = await request("/health");
				if (x.status === 200) break;
			} catch {}
			assert(child.exitCode === null, "owned core exited before ready");
			assert(Date.now() < deadline, "owned core ready deadline expired");
			await delay(100);
		}
		assert.equal((await request("/v1/settings", { auth: false })).status, 401);
		const schema = await request("/openapi.json");
		assert.equal(schema.status, 200);
		readTemplates = Object.entries(schema.data.paths)
			.filter(([, methods]) => methods.get)
			.map(([path]) => path);
		const catalogue = await request(
			"/v1/desktop/models?live=false&scope=usable",
		);
		assert.equal(catalogue.status, 200);
		assert.deepEqual(
			catalogue.data.result.models
				.filter((m) => m.provider === "test")
				.map((m) => m.model_id)
				.sort(),
			["mock-model-a", "mock-model-b"],
		);
		const created = await request("/v1/desktop/sessions", {
			method: "POST",
			body: {
				request_id: randomUUID(),
				cwd: scratch,
				model: { provider: "test", model_id: "mock-model-a" },
			},
		});
		assert.equal(created.status, 200);
		sessionId = created.data.result.session_id;
		const cold = await request(`/v1/desktop/sessions/${sessionId}`);
		assert.equal(cold.data.result.payload.cold, true);
		await control("configure", {
			session_id: sessionId,
			hold_first_snapshot: false,
			hold_live_catalogue: true,
		});
	} catch (error) {
		try {
			await closeOwnedCore();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"core setup and cleanup failed",
			);
		}
		throw error;
	}
	const state = () => control("state");
	const waitCapture = async (predicate) => {
		const end = Date.now() + 20_000;
		for (;;) {
			const x = await state();
			const found = x.captures.find(predicate);
			if (found) return found;
			const opens = x.captures.filter(
				(c) => c.path.endsWith("/events") && c.before_b_request && !selected(c),
			);
			if (opens.length)
				await control("release", { indices: opens.map((c) => c.id) });
			assert(
				Date.now() < end,
				"required genuine carrier not captured; no native frame may substitute for it",
			);
			await delay(100);
		}
	};
	const commandA = () =>
		request(`/v1/desktop/sessions/${sessionId}/commands`, {
			method: "POST",
			body: {
				request_id: randomUUID(),
				command: "model",
				args: "test/mock-model-a",
			},
		});
	return {
		sessionId,
		scratch,
		token,
		readTemplates,
		policyScope,
		records: join(config, "run", "serve"),
		state,
		control,
		request,
		waitCapture,
		commandA,
		async defaultValues() {
			const script =
				"import yaml,json,sys; from pathlib import Path; v=yaml.safe_load((Path(sys.argv[1])/'config.yml').read_text())['values']; print(json.dumps({k:v[k] for k in ('hosting','model_name')}))";
			return JSON.parse(
				execFileSync(python, ["-c", script, config], {
					env,
					cwd: scratch,
					encoding: "utf8",
				}),
			);
		},
		close: closeOwnedCore,
	};
}

function selected(capture) {
	const objects = [];
	try {
		objects.push(JSON.parse(capture.body));
	} catch {
		for (const line of capture.body.split("\n"))
			if (line.startsWith("data: ")) {
				try {
					objects.push(JSON.parse(line.slice(6)));
				} catch {}
			}
	}
	const find = (x) => {
		if (!x || typeof x !== "object") return null;
		if (x.selected_model?.model_id) return { model: x.selected_model.model_id };
		for (const value of Object.values(x)) {
			const got = find(value);
			if (got) return got;
		}
		return null;
	};
	for (const object of objects) {
		const result = object.result?.payload || object.payload;
		const found = find(object);
		if (found) {
			const envelope = object.result ?? object;
			return {
				...found,
				cold: result?.cold,
				sessionId: envelope.session_id,
				epoch: envelope.epoch,
				seq: envelope.seq,
			};
		}
	}
	return null;
}

export const modelUncertaintyCase = {
	backendMode: "real-core",
	optInOnly: true,
	legs: ["candidate"],
	route: "/chat",
	purpose:
		"Real native model ACK loss, causally consumed canonical SSE, fresh reconciliation GET and durable explicit default save against owned core",
	frames: {
		candidate: [
			"model-before",
			"model-unknown-1",
			"model-unknown-2",
			"model-b-sse-get-pending",
			"model-settled-1",
			"model-settled-2",
			"model-default-saved",
		],
	},
	coverage:
		"native input/main/preload/renderer with real core; initial A consumed once, then B-SSE while picker GET pending; delayed native stale-A, pre-B ModelPicker GET, cold-state, historical control and WCV compositor NOT covered",
	async drive(ctx) {
		const {
			cdp,
			api,
			press,
			wait,
			waitFor,
			pressEscape,
			frame,
			stamp,
			realBackend: backend,
		} = ctx;
		assert(backend);
		const trace = async (start = false) => {
			const result = await api.verb(
				cdp,
				"modelAuthority",
				start ? { start: true } : {},
			);
			assert.equal(result.armed, true, "real consumer observer is not armed");
			assert.equal(result.fault, false, "consumer witness failed/truncated");
			return result;
		};
		const consumed = async (
			carrier,
			capture,
			disposition,
			after,
			record = true,
		) => {
			const authority = selected(capture);
			assert.equal(
				authority?.sessionId,
				backend.sessionId,
				"carrier is not this session",
			);
			assert.equal(
				typeof authority?.epoch,
				"string",
				"original carrier has no epoch witness",
			);
			assert.equal(
				typeof authority?.seq,
				"number",
				"original carrier has no seq witness",
			);
			let receipt;
			await waitFor(async () => {
				const observed = await trace();
				receipt = observed.receipts
					.slice(after)
					.find(
						(r) =>
							r.carrier === carrier &&
							r.sessionId === backend.sessionId &&
							r.epoch === authority.epoch &&
							r.seq === authority.seq &&
							r.disposition === disposition,
					);
				return Boolean(receipt);
			}, 15_000);
			assert(
				receipt,
				`released ${carrier} was dropped/unconsumed; no frame substitutes for completion`,
			);
			// This receipt describes a transition AFTER the most recent frame,
			// not authority already depicted by that frame.
			if (record) stamp(`post-frame-transition:consumer-${carrier}`, receipt);
			return receipt;
		};
		await trace(true);
		// Native chat opens on SSE, not a sessions.get. Warm A through owned
		// setup; the genuine cold HTTP proof remains separately labelled.
		assert.equal((await backend.commandA()).status, 200);
		/*
		 * A by ID, in the chats region. A fresh real-core profile also lists the
		 * resident agent sessions (measured on v0.94.15: Librarian and Aida, bound
		 * to their agents, beside our unbound A), so a document-wide row count is
		 * not "A is drawn" - CI run 41535781273 timed out on exactly that. The
		 * asks case may count all rows only because its fake backend serves two
		 * sessions and no residents. Still EXACTLY one: a duplicate A is a bug.
		 */
		const rowA = `[data-sidebar-region="chats"] [data-session-row=${JSON.stringify(backend.sessionId)}] [data-tour-tag="chat-session-row"]`;
		await wait(
			`document.querySelectorAll(${JSON.stringify(rowA)}).length===1`,
			// Self-diagnosing failure: per-region counts plus each drawn row's id
			// and visible text, so the next CI run says what WAS on screen.
			`/* model-case: row-census */ JSON.stringify([...document.querySelectorAll('[data-tour-tag="chat-session-row"]')].map(e=>({region:e.closest('[data-sidebar-region]')?.getAttribute('data-sidebar-region')??null,session:e.closest('[data-session-row]')?.getAttribute('data-session-row')??null,text:(e.textContent||'').trim().slice(0,60)})))`,
		);
		/*
		 * A IS BELOW THE FOLD on a real core: the sidebar body
		 * (`[data-sidebar-region="scroller"]`, overflow-y:auto) draws the entity
		 * sections before the chats list, so in the 1380x900 window A's centre sat
		 * at y=920 and the pointer gate rightly refused it (CI 41554454323). The
		 * asks case never meets this - two fake sessions, no residents. Scroll the
		 * row into view inside that container, as a user would, then let `press`
		 * re-read and hit-test the point; the gate is never bypassed.
		 */
		const reveal = await cdp.evaluate(
			`/* model-case: reveal-row */ (()=>{const r=document.querySelector(${JSON.stringify(rowA)});const s=r&&r.closest('[data-sidebar-region="scroller"]');if(!r||!s)return {found:Boolean(r),scroller:Boolean(s)};r.scrollIntoView({block:'nearest'});const b=r.getBoundingClientRect();return {found:true,scroller:true,scrollTop:s.scrollTop,clientHeight:s.clientHeight,scrollHeight:s.scrollHeight,rowTop:b.top,rowBottom:b.bottom,innerHeight:innerHeight}})()`,
		);
		assert(
			reveal?.found && reveal?.scroller,
			`row A is not inside the sidebar scroller: ${JSON.stringify(reveal)}`,
		);
		await backend.control("configure", {
			session_id: backend.sessionId,
			hold_reads: true,
			drop_b_ack: false,
		});
		const initialCursor = (await trace()).receipts.length;
		try {
			await press(rowA);
		} catch (error) {
			// The scroller's own numbers say whether the scroll ran out of extent
			// or something else covered the point.
			error.message += ` - after reveal: ${JSON.stringify(reveal)}`;
			throw error;
		}
		/*
		 * SELECTORS ARE MAIN'S, pinned by `model-uncertainty-native.test.mjs`
		 * against the source files (CI 41560884417 found the first stale one):
		 * the composer is a <textarea> inside `chat-input-textarea`
		 * (message-input.tsx; renderer-driver's own spelling), and picker rows
		 * are `role="option"` in the picker dialog (picker-host.tsx).
		 */
		// Hold the ORIGINAL native subscription snapshot, then consume it once
		// for baseline A. A no-op A->A command is not an event producer.
		const initialA = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}/events` &&
				c.before_b_request &&
				selected(c)?.model === "mock-model-a",
		);
		await backend.control("release", { indices: [initialA.id] });
		const initialReceipt = await consumed(
			"canonical-sse",
			initialA,
			"processed",
			initialCursor,
			false,
		);
		const input = '[data-tour-tag="chat-input-textarea"] textarea';
		await press(input);
		await cdp.send("Input.insertText", { text: "/model" });
		const enter = async () => {
			for (const type of ["keyDown", "keyUp"])
				await cdp.send("Input.dispatchKeyEvent", {
					type,
					key: "Enter",
					code: "Enter",
					windowsVirtualKeyCode: 13,
				});
		};
		await enter();
		/*
		 * renderer-driver's `/fast` flow: Enter may first only complete the slash
		 * popup's row, leaving the popup up and no dialog. Then Escape the popup
		 * and send the completed command with one more Enter - never a third.
		 */
		const dialogOpen = () =>
			cdp.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`);
		await waitFor(dialogOpen, 5_000);
		if (!(await dialogOpen())) {
			const popup = await cdp.evaluate(
				`Boolean(document.querySelector('[role="listbox"][aria-label="Command arguments"], [role="listbox"][aria-label="Slash commands"]'))`,
			);
			if (popup) {
				await pressEscape();
				await enter();
			}
		}
		await wait(
			`[...document.querySelectorAll('[role="dialog"] [role="option"]')].some(e=>e.textContent.includes("mock-model-b"))`,
			`/* model-case: picker-census */ JSON.stringify({dialog:Boolean(document.querySelector('[role="dialog"]')),title:document.querySelector('[role="dialog"] h2')?.textContent??null,options:[...document.querySelectorAll('[role="dialog"] [role="option"]')].map(e=>(e.textContent||'').trim().slice(0,40)),composer:document.querySelector('[data-tour-tag="chat-input-textarea"] textarea')?.value??null})`,
		);
		await cdp.evaluate(
			`/* model-case: mark-targets */ (()=>{const row=[...document.querySelectorAll('[role="dialog"] [role="option"]')].find(e=>e.textContent.includes('mock-model-b'));if(!row)throw Error('real B option absent');row.setAttribute('data-model-case-b','');const check=[...document.querySelectorAll('[role=dialog] [role=checkbox]')].find(e=>/default/i.test(e.parentElement?.textContent||''));if(!check)throw Error('real default checkbox absent');check.setAttribute('data-model-case-default','')})()`,
		);
		const geometry = async (label, record = true) => {
			const value = await cdp.evaluate(
				`/* model-case: geometry */ (()=>{const e=document.querySelector('[data-model-case-default]'),d=document.querySelector('[role=dialog]');if(!e||!d)throw Error('real model dialog missing');const r=e.getBoundingClientRect(),b=d.getBoundingClientRect();const description=(d.getAttribute('aria-describedby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');return{disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',checked:e.getAttribute('aria-checked'),current:description.match(/test\\/mock-model-[ab]/)?.[0]||null,box:{x:r.x,y:r.y,w:r.width,h:r.height},dialog:{w:b.width,h:b.height},neutral:/could not be confirmed/i.test(document.body.innerText)}})()`,
			);
			if (record) stamp(`post-frame:${label}`, value);
			return value;
		};
		const before = await geometry("before-geometry", false);
		assert.equal(
			before.current,
			"test/mock-model-a",
			"rendered initial current model is not A",
		);
		assert.equal(before.checked, "false");
		await frame("model-before");
		stamp("captured-before-geometry", before);
		stamp("post-frame:initial-A-consumer", {
			captureId: initialA.id,
			authority: selected(initialA),
			receipt: initialReceipt,
		});
		const noWrites = async () => {
			const observed = await trace();
			assert.equal(
				observed.receipts.filter((r) => r.carrier === "default-save").length,
				0,
				"default-save handler invoked before explicit allowed save",
			);
			const state = await backend.state();
			assert.equal(
				state.attempts.filter((r) => !r.observer && r.method === "PATCH")
					.length,
				0,
				"late/early default PATCH observed",
			);
			assert.equal(state.commit?.durable, "mock-model-b");
		};
		const fence = async (label) => {
			await frame(label);
			// Frame/capture itself can yield to a late consumer. Assert AFTER it,
			// then use a real gesture and a driver settlement before counting.
			const after = await geometry(`${label}-after-frame`);
			assert.equal(after.disabled, true, `${label}: early unlock after frame`);
			assert.equal(
				after.neutral,
				true,
				`${label}: uncertainty feedback missing`,
			);
			await press("[data-model-case-default]");
			await noWrites();
			const afterInput = await geometry(`${label}-after-input`);
			assert.equal(
				afterInput.disabled,
				true,
				`${label}: early unlock after gesture`,
			);
			assert.equal(afterInput.neutral, true);
		};
		await backend.control("configure", {
			session_id: backend.sessionId,
			hold_reads: true,
			drop_b_ack: true,
		});
		await press("[data-model-case-b]");
		await wait("/could not be confirmed/i.test(document.body.innerText)");
		await fence("model-unknown-1");
		await fence("model-unknown-2");
		const bSse = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}/events` &&
				!c.before_b_request &&
				selected(c)?.model === "mock-model-b",
		);
		const bAuthority = selected(bSse);
		assert.equal(bAuthority.sessionId, backend.sessionId);
		const commit = (await backend.state()).commit;
		assert.equal(
			bAuthority.epoch,
			commit.epoch,
			"B SSE belongs to a different session generation",
		);
		assert(
			bAuthority.seq > selected(initialA).seq,
			"B SSE must advance the baseline sequence",
		);
		// This is the REAL ModelPicker GET issued only AFTER unconfirmed command
		// completion. Never replace it with a pre-B cached positive response.
		const fresh = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}` &&
				selected(c)?.cold === false &&
				selected(c)?.model === "mock-model-b" &&
				!c.before_b_request,
		);
		const bSseCursor = (await trace()).receipts.length;
		await backend.control("release", { indices: [bSse.id] });
		await consumed("canonical-sse", bSse, "processed", bSseCursor);
		await fence("model-b-sse-get-pending");
		await noWrites();
		const freshCursor = (await trace()).receipts.length;
		await backend.control("release", { indices: [fresh.id] });
		await consumed("model-get", fresh, "live", freshCursor);
		const assertB = async (label) => {
			const value = await geometry(label);
			assert.equal(
				value.current,
				"test/mock-model-b",
				"backend B is not rendered current B",
			);
			assert.equal(
				value.disabled,
				false,
				"fresh real B consumer did not unlock",
			);
			await noWrites();
		};
		// Receipt completion precedes React commit. Only a DOM read can prove
		// B is rendered and the checkbox is enabled; waitFor's facts are not it.
		const settledStart = Date.now();
		await wait(
			`/* model-case: settled-B */ (()=>{const d=document.querySelector('[role="dialog"]'),e=document.querySelector('[data-model-case-default]');if(!d||!e)return false;const text=(d.getAttribute('aria-describedby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');return text.includes('test/mock-model-b')&&e.disabled!==true&&e.getAttribute('aria-disabled')!=='true'&&!/could not be confirmed/i.test(d.innerText)})()`,
			`/* model-case: settlement-census */ (()=>{const d=document.querySelector('[role="dialog"]'),e=document.querySelector('[data-model-case-default]');const ids=(d?.getAttribute('aria-describedby')||'').split(/\\s+/).filter(Boolean),text=ids.map(id=>document.getElementById(id)?.textContent||'').join(' ');const neutral=/could not be confirmed/i;const box=e?.getBoundingClientRect();const dialogs=[...document.querySelectorAll('[role="dialog"]')].slice(0,4).map(n=>({id:n.id,title:n.getAttribute('aria-label'),labelledBy:n.getAttribute('aria-labelledby')}));const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n,location=null,reads=0;while((n=walker.nextNode())&&reads++<2000){if(neutral.test(n.textContent)){const p=n.parentElement;location={text:n.textContent.slice(0,256),tag:p?.tagName,role:p?.getAttribute('role'),region:p?.closest('[data-sidebar-region]')?.getAttribute('data-sidebar-region'),inDialog:!!d?.contains(p)};break;}}return JSON.stringify({elapsedMs:Date.now()-${settledStart},dialogExists:!!d,checkboxExists:!!e,dialogConnected:!!d?.isConnected,checkboxConnected:!!e?.isConnected,descriptionIds:ids.slice(0,8),descriptionText:text.slice(0,512),descriptionHasB:text.includes('test/mock-model-b'),disabled:e?.disabled??null,disabledPass:!!e&&e.disabled!==true,ariaDisabled:e?.getAttribute('aria-disabled')??null,ariaDisabledPass:!!e&&e.getAttribute('aria-disabled')!=='true',checked:e?.getAttribute('aria-checked')??null,checkboxDialogId:e?.closest('[role="dialog"]')?.id??null,sameDialog:!!d&&!!e&&e.closest('[role="dialog"]')===d,neutralGlobal:neutral.test(document.body.innerText),neutralDialog:neutral.test(d?.innerText||''),box:box?{x:box.x,y:box.y,w:box.width,h:box.height}:null,dialogs,uncertaintyLocation:location,locationScanCapped:reads>=2000});})()`,
		);
		await assertB("fresh-consumed-geometry");
		const pending = await backend.state();
		await backend.control("configure", {
			session_id: backend.sessionId,
			hold_reads: false,
			hold_live_catalogue: true,
		});
		await backend.control("release", {
			indices: pending.captures
				.filter((c) => c.path !== "/v1/desktop/models")
				.map((c) => c.id),
		});
		for (const label of ["model-settled-1", "model-settled-2"]) {
			await frame(label);
			await assertB(`${label}-after-frame`);
		}
		await cdp.evaluate(
			`/* model-case: mark-save */ (()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>/^set current model as default$/i.test(e.textContent.trim()));if(!b)throw Error('explicit default save missing');b.setAttribute('data-model-case-save','')})()`,
		);
		await assertB("before-explicit-save");
		const saveBarrierOrder = (await backend.state()).evidence_order;
		await press("[data-model-case-save]");
		const until = Date.now() + 10_000;
		for (;;) {
			const values = await backend.defaultValues();
			if (values.hosting === "test" && values.model_name === "mock-model-b")
				break;
			assert(Date.now() < until, "actual default YAML did not settle to B");
			await delay(100);
		}
		const traffic = await backend.state();
		assertModelTraffic(
			traffic.attempts,
			backend.sessionId,
			backend.readTemplates,
			traffic.feed_opens,
			{
				...backend.policyScope,
				listWitnesses: traffic.list_witnesses,
				saveBarrierOrder,
			},
		);
		assert.equal(
			traffic.attempts.filter(
				(a) =>
					!a.observer &&
					a.path === `/v1/desktop/sessions/${backend.sessionId}/commands` &&
					a.body?.args === "",
			).length,
			1,
			"exactly one native model picker open required",
		);
		const modelB = traffic.attempts.filter(
			(r) =>
				!r.observer &&
				r.method === "POST" &&
				r.path.endsWith("/commands") &&
				r.body?.args === "test/mock-model-b",
		);
		assert.equal(modelB.length, 1, "model B intent automatically replayed");
		const patches = traffic.attempts.filter(
			(r) => !r.observer && r.method === "PATCH",
		);
		assert.deepEqual(
			patches.map((r) => r.path),
			["/v1/settings/hosting", "/v1/settings/model_name"],
		);
		assert.equal(
			(await trace()).receipts.filter((r) => r.carrier === "default-save")
				.length,
			1,
		);
		await frame("model-default-saved");
		const final = await geometry("saved-after-frame");
		assert.equal(final.current, "test/mock-model-b");
		const afterFrame = await backend.state();
		assert.equal(
			afterFrame.attempts.filter((r) => !r.observer && r.method === "PATCH")
				.length,
			2,
			"late extra PATCH after saved frame",
		);
		stamp("post-frame:real-model-traffic", afterFrame);
		// Catalogue responses are deliberately irrelevant to this acceptance
		// cell. Keep them held until the app is drained; backend.close releases
		// them for cleanup only, after no renderer can issue a late mutation.
		stamp("post-frame:held-through-app-drain", {
			carrier: "catalogue",
			consumptionClaim: false,
		});
	},
};

if (isEntryPoint(import.meta.url) && process.argv.includes("--help")) {
	// A safe workflow-table probe must not seal outputs or bootstrap any backend.
	console.log("model-uncertainty-native: --write-build-receipt <path>");
} else if (
	isEntryPoint(import.meta.url) &&
	process.argv.includes("--write-build-receipt")
) {
	const root = process.cwd();
	const dest = process.argv[process.argv.indexOf("--write-build-receipt") + 1];
	assert(dest);
	writeFileSync(dest, JSON.stringify(buildReceipt(root), null, 2));
}
