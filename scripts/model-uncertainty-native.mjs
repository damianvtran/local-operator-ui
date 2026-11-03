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
export function assertModelTraffic(attempts, sessionId, readTemplates = []) {
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
			assert(known, `unmodeled native read ${request.path}`);
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
		if (request.method === "POST" && request.path === `${base}/commands`) {
			assert.equal(request.body.command, "model");
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
		assert.deepEqual(Object.keys(request.body).sort(), ["base", "value"]);
		assert.equal(request.body.base, null);
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
		const receipt = { pid: child.pid, birth, root: config, clean: false };
		try {
			try {
				await control("release");
			} catch (error) {
				receipt.releaseError = String(error);
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
							readFileSync(ledger, "utf8").trim().split(/\s+/).filter(Boolean),
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
					!probe.error && [0, 1].includes(probe.status) && !probe.stderr.trim(),
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
			assert(!receipt.releaseError, receipt.releaseError);
			receipt.clean = true;
			return receipt;
		} catch (error) {
			receipt.error = String(error);
			throw error;
		} finally {
			writeFileSync(
				join(output, "owned-core-exit.json"),
				JSON.stringify(receipt, null, 2),
			);
		}
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
			"model-stale-sse",
			"model-settled-1",
			"model-settled-2",
			"model-default-saved",
		],
	},
	coverage:
		"native input/main/preload/renderer with real core; no native pre-B ModelPicker GET or cold-state coverage, historical control, or WCV compositor claim",
	async drive(ctx) {
		const {
			cdp,
			api,
			press,
			wait,
			waitFor,
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
		await press(rowA);
		const input = '[contenteditable="true"][role="textbox"]';
		await press(input);
		await cdp.send("Input.insertText", { text: "/model" });
		for (const type of ["keyDown", "keyUp"])
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "Enter",
				code: "Enter",
				windowsVirtualKeyCode: 13,
			});
		await wait(
			'[...document.querySelectorAll("[cmdk-item]")].some(e=>e.textContent.includes("mock-model-b"))',
		);
		await cdp.evaluate(
			`/* model-case: mark-targets */ (()=>{const row=[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes('mock-model-b'));if(!row)throw Error('real B option absent');row.setAttribute('data-model-case-b','');const check=[...document.querySelectorAll('[role=dialog] [role=checkbox]')].find(e=>/default/i.test(e.parentElement?.textContent||''));if(!check)throw Error('real default checkbox absent');check.setAttribute('data-model-case-default','')})()`,
		);
		const geometry = async (label) => {
			const value = await cdp.evaluate(
				`/* model-case: geometry */ (()=>{const e=document.querySelector('[data-model-case-default]'),d=document.querySelector('[role=dialog]');if(!e||!d)throw Error('real model dialog missing');const r=e.getBoundingClientRect(),b=d.getBoundingClientRect();const description=(d.getAttribute('aria-describedby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ');return{disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',checked:e.getAttribute('aria-checked'),current:description.match(/test\\/mock-model-[ab]/)?.[0]||null,box:{x:r.x,y:r.y,w:r.width,h:r.height},dialog:{w:b.width,h:b.height},neutral:/could not be confirmed/i.test(document.body.innerText)}})()`,
			);
			stamp(label, value);
			return value;
		};
		const before = await geometry("before-geometry");
		assert.equal(
			before.current,
			"test/mock-model-a",
			"rendered initial current model is not A",
		);
		assert.equal(before.checked, "false");
		await frame("model-before");
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
		const consumed = async (carrier, capture, disposition, after) => {
			const authority = selected(capture);
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
			stamp(`consumer-${carrier}`, receipt);
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
		assert.equal((await backend.commandA()).status, 200);
		const stale = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}/events` &&
				selected(c)?.model === "mock-model-a" &&
				c.before_b_request,
		);
		await press("[data-model-case-b]");
		await wait("/could not be confirmed/i.test(document.body.innerText)");
		await fence("model-unknown-1");
		await fence("model-unknown-2");
		const staleCursor = (await trace()).receipts.length;
		await backend.control("release", { indices: [stale.id] });
		await consumed("canonical-sse", stale, "processed", staleCursor);
		await fence("model-stale-sse");
		// This is the REAL ModelPicker GET issued only AFTER unconfirmed command
		// completion. Never replace it with a pre-B cached positive response.
		const fresh = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}` &&
				selected(c)?.cold === false &&
				selected(c)?.model === "mock-model-b" &&
				!c.before_b_request,
		);
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
			`/* model-case: mark-save */ (()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>/^set as default$/i.test(e.textContent.trim()));if(!b)throw Error('explicit default save missing');b.setAttribute('data-model-case-save','')})()`,
		);
		await assertB("before-explicit-save");
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
		stamp("real-model-traffic", afterFrame);
		await backend.control("release");
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
