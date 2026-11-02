const REGEX_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;
const REQUEST_ID_PATTERN =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/**
 * One opt-in real-backend case for the existing asks native producer.
 * This module never boots Electron on import. The old fixture/policy stays
 * separate: model/default writes must reach real core, not a permissive mock.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
	const binary = readFileSync(
		join(root, "node_modules/electron/path.txt"),
		"utf8",
	).trim();
	assert(
		existsSync(join(root, "node_modules/electron/dist", binary)),
		"native executable absent; do not bootstrap from this producer",
	);
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
	const token = randomBytes(32).toString("base64url");
	const observerToken = randomBytes(32).toString("base64url");
	const guards = join(scratch, "guards");
	mkdirSync(guards);
	writeFileSync(
		join(guards, "sitecustomize.py"),
		"from model_uncertainty_backend import restrict_network\nrestrict_network()\n",
	);
	const env = {
		MODEL_CASE_GUARD_LOG: join(scratch, "blocked-network.ndjson"),
		MODEL_CASE_CHILD_PIDS: join(scratch, "owned-child-pids"),
		PYTHONPATH: `${guards}:${SCRIPT_ROOT}`,
		PATH: process.env.PATH,
		HOME: home,
		LOCAL_OPERATOR_CONFIG_DIR: config,
		LOCAL_OPERATOR_DESKTOP_TOKEN: token,
		MODEL_CASE_OBSERVER_TOKEN: observerToken,
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		PYTHONDONTWRITEBYTECODE: "1",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		LANG: "en_US.UTF-8",
	};
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
	let sessionId;
	let readTemplates = [];
	try {
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
			hold_first_snapshot: true,
			hold_live_catalogue: true,
		});
	} catch (error) {
		child.kill("SIGTERM");
		await closed;
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
		async close() {
			try {
				await control("release");
			} finally {
				child.kill("SIGTERM");
				const result = await Promise.race([
					closed,
					delay(15_000).then(() => {
						throw Error(
							`owned core ${child.pid} did not exit; no global kill fallback`,
						);
					}),
				]);
				writeFileSync(
					join(output, "owned-core-exit.json"),
					JSON.stringify(result),
				);
			}
		},
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
		if (found) return { ...found, cold: result?.cold };
	}
	return null;
}

export const modelUncertaintyCase = {
	backendMode: "real-core",
	optInOnly: true,
	legs: ["candidate"],
	route: "/chat",
	purpose:
		"Real native model ACK loss, causal old authority, fenced defaults and durable explicit save against owned published core",
	frames: {
		candidate: [
			"model-before",
			"model-unknown-1",
			"model-unknown-2",
			"model-cold",
			"model-stale",
			"model-settled-1",
			"model-settled-2",
			"model-default-saved",
		],
	},
	coverage:
		"native input/main/preload/renderer and actual core handlers; not external browser/WCV compositor",
	async drive(ctx) {
		const { cdp, press, wait, frame, stamp, realBackend: backend } = ctx;
		assert(backend);
		await wait(
			'document.querySelectorAll("[data-tour-tag=chat-session-row]").length===1',
		);
		await press('[data-tour-tag="chat-session-row"]');
		const cold = await backend.waitCapture(
			(c) => selected(c)?.cold === true && c.before_b_request,
		);
		assert.equal((await backend.commandA()).status, 200);
		const input = '[contenteditable="true"][role="textbox"]';
		await press(input);
		await cdp.send("Input.insertText", { text: "/model" });
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await wait(
			'[...document.querySelectorAll("[cmdk-item]")].some(e=>e.textContent.includes("mock-model-b"))',
		);
		await cdp.evaluate(
			`(()=>{const b=[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes('mock-model-b'));b.setAttribute('data-model-case-b','');const checks=[...document.querySelectorAll('[role=checkbox]')];const d=checks.find(e=>(e.closest('label')?.textContent||e.parentElement?.textContent||'').toLowerCase().includes('default'));if(!d)throw Error('real default checkbox missing');d.setAttribute('data-model-case-default','')})()`,
		);
		const geometry = async (label) => {
			const x = await cdp.evaluate(
				`(()=>{const e=document.querySelector('[data-model-case-default]'),d=document.querySelector('[role=dialog]');if(!e||!d)throw Error('real model dialog missing');const r=e.getBoundingClientRect(),b=d.getBoundingClientRect();return{disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',checked:e.getAttribute('aria-checked'),box:{x:r.x,y:r.y,w:r.width,h:r.height},dialog:{w:b.width,h:b.height},neutral:/could not be confirmed/i.test(document.body.innerText)}})()`,
			);
			stamp(label, x);
			return x;
		};
		assert.equal((await geometry("before-geometry")).checked, "false");
		await frame("model-before");
		await backend.control("configure", {
			session_id: backend.sessionId,
			hold_reads: true,
			drop_b_ack: true,
		});
		assert.equal((await backend.commandA()).status, 200);
		const stale = await backend.waitCapture(
			(c) =>
				c.path.endsWith("/events") &&
				selected(c)?.model === "mock-model-a" &&
				c.before_b_request,
		);
		await press("[data-model-case-b]");
		await wait("/could not be confirmed/i.test(document.body.innerText)");
		for (const label of ["model-unknown-1", "model-unknown-2"]) {
			assert.equal((await geometry(label)).disabled, true);
			await frame(label);
		}
		const noWrites = async () => {
			const x = await backend.state();
			assert.equal(
				x.attempts.filter((a) => !a.observer && a.method === "PATCH").length,
				0,
			);
			assert.equal(x.commit?.durable, "mock-model-b");
		};
		await press("[data-model-case-default]");
		await noWrites();
		await backend.control("release", { indices: [cold.id] });
		await noWrites();
		assert.equal((await geometry("cold-geometry")).disabled, true);
		await frame("model-cold");
		await backend.control("release", { indices: [stale.id] });
		await noWrites();
		assert.equal((await geometry("stale-geometry")).disabled, true);
		await frame("model-stale");
		const fresh = await backend.waitCapture(
			(c) =>
				c.path === `/v1/desktop/sessions/${backend.sessionId}` &&
				selected(c)?.cold === false &&
				selected(c)?.model === "mock-model-b" &&
				!c.before_b_request,
		);
		await backend.control("release", { indices: [fresh.id] });
		const pendingAuthority = await backend.state();
		await backend.control("configure", {
			session_id: backend.sessionId,
			hold_reads: false,
			hold_live_catalogue: true,
		});
		await backend.control("release", {
			indices: pendingAuthority.captures
				.filter((c) => c.path !== "/v1/desktop/models")
				.map((c) => c.id),
		});
		await wait(
			'document.querySelector("[data-model-case-default]")?.disabled===false',
		);
		for (const label of ["model-settled-1", "model-settled-2"]) {
			assert.equal((await geometry(label)).disabled, false);
			await frame(label);
		}
		await cdp.evaluate(
			`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>/^set as default$/i.test(e.textContent.trim()));if(!b)throw Error('explicit default save missing');b.setAttribute('data-model-case-save','')})()`,
		);
		await press("[data-model-case-save]");
		const until = Date.now() + 10_000;
		for (;;) {
			const v = await backend.defaultValues();
			if (v.hosting === "test" && v.model_name === "mock-model-b") break;
			assert(Date.now() < until, "actual default YAML did not settle to B");
			await delay(100);
		}
		const traffic = await backend.state();
		assertModelTraffic(
			traffic.attempts,
			backend.sessionId,
			backend.readTemplates,
		);
		const mutations = traffic.attempts.filter(
			(a) => !a.observer && a.method === "POST" && a.path.endsWith("/commands"),
		);
		assert.equal(mutations.length, 1);
		const patches = traffic.attempts.filter(
			(a) => !a.observer && a.method === "PATCH",
		);
		assert.deepEqual(
			patches.map((a) => a.path),
			["/v1/settings/hosting", "/v1/settings/model_name"],
		);
		stamp("real-model-traffic", traffic);
		await frame("model-default-saved");
		await backend.control("release");
	},
};

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
	process.argv.includes("--write-build-receipt")
) {
	const root = process.cwd();
	const dest = process.argv[process.argv.indexOf("--write-build-receipt") + 1];
	assert(dest);
	writeFileSync(dest, JSON.stringify(buildReceipt(root), null, 2));
}
