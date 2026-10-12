#!/usr/bin/env node
/**
 * Temporary, opt-in Linux evidence for #1002, NOT a replacement Desktop gate.
 *
 * One checkout/dependency tree, three read-only git-show overlays on the fixed
 * mainfold base. No source tree, compiler snapshot or dependency copy is made.
 * Base has no new contract: its fixture2 + dispatcher3 are explicitly NOT the
 * same assertion workload as pre/head's AST3 + SSR7 + dispatcher3. Pre and head
 * do share that workload; the pre relocation keeps its AST in the render file.
 * Success cannot explain or cure a full-suite execution ceiling.
 *
 * This file also serves as the opt-in --import preload. Per-PID JSONL survives
 * TAP buffering/log truncation: BEGIN, liveness, END and TEARDOWN expose worker
 * progress and handle TYPES, never environment values or socket contents.
 * The existing dispatcher/keeper/memory guard remain intact. Our separate wall
 * bound owns the launcher group, tracks descendants by PID/start identity, and
 * reaps detached groups as well; killing only the launcher would orphan them.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	createRequire,
	registerHooks,
	syncBuiltinESMExports,
} from "node:module";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

export const BASE = "6734447f7f778e763fbcdf0d537650acf500cccf";
const PRE = "683684d6c3e4d3585b1cb8401c3fec3428c12f03";
const ANCESTOR = "85caf40c12d6d35e828b0445f45d659f2c027388";
const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);
const TRACE_ENV = "LOCAL_OPERATOR_UI_ONBOARDING_TRACE_DIR";
const MAP_ENV = "LOCAL_OPERATOR_UI_ONBOARDING_MAP";
export const WALL_MS = 180_000;
const PATHS = [
	"i18n/baseline.json",
	"package.json",
	"scripts/i18n/check-strings.test.mjs",
	"scripts/onboarding-default-model.test.mjs",
	"scripts/onboarding-i18n-contract.test.mjs",
	"src/i18n/catalogues/en/ui.onboarding.json",
	"src/i18n/keys.gen.ts",
	...[
		"onboarding-dialog.tsx",
		"onboarding-modal.tsx",
		"steps/connect-provider-step.tsx",
		"steps/default-model-plan.ts",
		"steps/default-model-step.tsx",
		"steps/extras-step.tsx",
		"steps/search-api-step.tsx",
	].map((file) => `src/renderer/src/features/onboarding/components/${file}`),
];
const NATIVE =
	"literal argument of a real t\\(\\) call|exact producers|modal.s titles";
const RENDER =
	"every key.s committed English|connect intro renders|free-pool detail renders|both chief-of-staff branches render|acquisition link renders|model summary names|parameters render";
const DISPATCH =
	"runner forwards|explicit --test-concurrency|ambient NODE_TEST_CONTEXT";

export function validSha(value) {
	if (!/^[a-f0-9]{40}$/.test(value ?? ""))
		throw new Error("Expected a full lowercase commit SHA");
	return value;
}
export function validPath(value) {
	if (
		typeof value !== "string" ||
		!/^[\w./-]+$/.test(value) ||
		value.startsWith("-") ||
		isAbsolute(value) ||
		value.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error("Unsafe relative control path");
	}
	return value;
}
function within(root, path) {
	const rel = relative(resolve(root), resolve(path));
	return (
		rel !== "" &&
		rel !== ".." &&
		!rel.startsWith(`..${sep}`) &&
		!isAbsolute(rel)
	);
}
export function validOutput(
	path,
	temporaryRoot = process.env.RUNNER_TEMP ?? tmpdir(),
) {
	if (!isAbsolute(path) || !within(temporaryRoot, path) || within(ROOT, path))
		throw new Error(
			"Diagnostic output must be outside the checkout, inside the temporary root",
		);
	return path;
}
export function safeArgv(argv) {
	const known = new Set([
		"node",
		"run-desktop-tests.mjs",
		"onboarding-desktop-diagnostic.mjs",
		"run-desktop-tests.test.mjs",
		"check-strings.test.mjs",
		"onboarding-i18n-contract.test.mjs",
		"passes.test.mjs",
		"fails.test.mjs",
		"reports-env.test.mjs",
	]);
	return argv.map((arg) => {
		if (known.has(basename(arg))) return basename(arg);
		if (/^--test(?:-concurrency=\d+|-reporter=tap)?$/.test(arg)) return arg;
		if (arg.startsWith("--test-name-pattern="))
			return "--test-name-pattern=[selected]";
		return "[redacted]";
	});
}
export function classify(
	code,
	signal,
	wall,
	interrupted,
	summary,
	memoryBreach = false,
) {
	if (interrupted) return "interrupted";
	if (wall) return "wall-bound";
	if (code === 137 && memoryBreach) return "memory-bound";
	if (code === 137) return "unattributed-sigkill";
	if (signal) return "signal";
	if (code !== 0) return "assertion-or-launch-failure";
	return summary ? "completed" : "missing-summary";
}
function json(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function git(args) {
	return execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	});
}
function content(sha, path) {
	validSha(sha);
	validPath(path);
	if (!git(["ls-tree", sha, "--", path]).trim()) return null;
	return git(["show", `${sha}:${path}`]);
}
function control(side, head) {
	const map = Object.fromEntries(
		PATHS.map((path) => [path, content(BASE, path)]),
	);
	if (side === "head")
		return Object.fromEntries(PATHS.map((path) => [path, content(head, path)]));
	if (side === "pre") {
		const paths = git(["diff", "--name-only", ANCESTOR, PRE])
			.trim()
			.split("\n");
		for (const path of paths) {
			validPath(path);
			if (!PATHS.includes(path))
				throw new Error("Unexpected historical control delta");
			if (path !== "package.json") map[path] = content(PRE, path);
		}
		// The historical package's version/list is NOT a same-base composition.
		// Derive the one registration-token delta against the fixed base instead.
		const original = map["package.json"];
		const token = " scripts/onboarding-i18n-contract.test.mjs";
		const current = content(head, "package.json");
		if (
			current.split(token).length !== 2 ||
			current.replace(token, "") !== original
		)
			throw new Error(
				"Package registration delta no longer equals fixed base + one token",
			);
		map["package.json"] = current;
	}
	return map;
}

function preload() {
	const dir = validOutput(process.env[TRACE_ENV]);
	mkdirSync(dir, { recursive: true });
	const traceFile = join(dir, `${process.pid}.jsonl`);
	// Ambient test context also reaches wrappers/keepers. A worker is identified
	// only when the loader sees the actual entry-point test module, using the
	// same physical-file comparison as our own CLI (not an argv spelling).
	let worker = false;
	const trace = (event, extra = {}) =>
		appendFileSync(
			traceFile,
			`${JSON.stringify({ event, at: new Date().toISOString(), pid: process.pid, ppid: process.ppid, worker, argv: safeArgv([...process.execArgv, ...process.argv]), ...handles(), ...extra })}\n`,
		);
	const handles = () => ({
		handles: process
			._getActiveHandles()
			.map((handle) =>
				/^[\w]{1,64}$/.test(handle.constructor?.name ?? "")
					? handle.constructor.name
					: "Unknown",
			),
		resources: process.getActiveResourcesInfo(),
	});
	trace("BEGIN", {
		argv: safeArgv([...process.execArgv, ...process.argv]),
		...handles(),
	});
	const tick = setInterval(() => trace("ALIVE", handles()), 5_000);
	tick.unref();
	process.on("beforeExit", (code) => trace("END", { code, ...handles() }));
	process.on("exit", (code) => trace("TEARDOWN", { code, ...handles() }));
	globalThis.__onboardingTrace = trace;

	const require = createRequire(join(ROOT, "package.json"));
	const fs = require("node:fs");
	const originalRead = fs.readFileSync;
	const mapPath = validOutput(process.env[MAP_ENV]);
	const map = JSON.parse(originalRead(mapPath, "utf8"));
	for (const path of Object.keys(map)) {
		validPath(path);
		if (!PATHS.includes(path)) throw new Error("Unexpected overlay path");
	}
	const reads = new Set();
	const read = (path) => {
		const rel = relative(
			ROOT,
			resolve(path instanceof URL ? fileURLToPath(path) : String(path)),
		);
		if (!Object.hasOwn(map, rel)) return undefined;
		if (!reads.has(rel)) {
			reads.add(rel);
			trace("OVERLAY_READ", { path: rel });
		}
		return map[rel];
	};
	fs.readFileSync = function (path, options) {
		const text = read(path);
		if (text === undefined) return originalRead.call(this, path, options);
		if (text === null) {
			const error = new Error("Control path absent");
			error.code = "ENOENT";
			throw error;
		}
		const encoding = typeof options === "string" ? options : options?.encoding;
		return encoding ? Buffer.from(text).toString(encoding) : Buffer.from(text);
	};
	syncBuiltinESMExports();
	const esbuild = require("esbuild");
	globalThis.__onboardingFS = { readFile: read };
	globalThis.__onboardingBuild = (options) =>
		esbuild.build({
			...options,
			plugins: [
				...(options.plugins ?? []),
				{
					name: "onboarding-control",
					setup(build) {
						build.onLoad({ filter: /\.(ts|tsx|json)$/ }, (args) => {
							const contents = read(args.path);
							if (contents === undefined) return undefined;
							if (contents === null)
								return { errors: [{ text: "Control path absent" }] };
							return {
								contents,
								loader: args.path.endsWith(".json")
									? "json"
									: args.path.endsWith(".tsx")
										? "tsx"
										: "ts",
							};
						});
					},
				},
			],
		});
	registerHooks({
		load(url, context, next) {
			if (
				!worker &&
				process.env.NODE_TEST_CONTEXT &&
				url.startsWith("file:") &&
				url.endsWith(".test.mjs") &&
				isEntryPoint(url)
			) {
				worker = true;
				trace("BEGIN", { phase: "file-entry", ...handles() });
			}
			const got = next(url, context);
			if (
				!url.startsWith("file:") ||
				!url.includes("/scripts/") ||
				!url.endsWith(".mjs")
			)
				return got;
			const path = fileURLToPath(url);
			const replacement = read(path);
			if (replacement === null) throw new Error("Control module absent");
			let source = replacement ?? Buffer.from(got.source).toString();
			if (path.endsWith("/scripts/i18n/check-strings.mjs")) {
				if (!source.includes("new API({ cwd: repo })"))
					throw new Error("Native overlay target absent");
				source = source
					.replace(
						"new API({ cwd: repo })",
						'(globalThis.__onboardingTrace("SNAPSHOT_BEGIN"), new API({ cwd: repo, fs: globalThis.__onboardingFS }))',
					)
					.replace(
						"return { api, snapshot };",
						'globalThis.__onboardingTrace("SNAPSHOT_READY"); return { api, snapshot };',
					);
			}
			if (
				/\/scripts\/onboarding-(default-model|i18n-contract)\.test\.mjs$/.test(
					path,
				)
			) {
				source = source
					.replace(
						'import { build } from "esbuild";',
						"const build = globalThis.__onboardingBuild;",
					)
					.replace(
						'const esbuild = require_("esbuild");',
						"const esbuild = { build: globalThis.__onboardingBuild };",
					);
			}
			return { ...got, source };
		},
	});
}

function table() {
	return execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,rss="], {
		encoding: "utf8",
		timeout: 2_000,
	})
		.trim()
		.split("\n")
		.map((line) => {
			const [pid, ppid, pgid, rssKb] = line.trim().split(/\s+/).map(Number);
			return { pid, ppid, pgid, rssKb };
		});
}
function identity(pid) {
	try {
		// Linux starttime is stable across reparenting and detects PID reuse.
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
	} catch {
		return null;
	}
}
function kill(pid, signal) {
	try {
		process.kill(pid, signal);
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}
async function probe(side, head, out) {
	const dir = join(out, side);
	mkdirSync(dir, { recursive: true });
	const map = join(dir, "overlay.json");
	json(map, control(side, head));
	// A hosted job's auth/runtime tokens are not fixture inputs. An allowlist
	// also excludes all ambient CMUX/LOP/node context without logging values.
	const publicKeys = new Set([
		"PATH",
		"CI",
		"GITHUB_ACTIONS",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"TERM",
		"RUNNER_TEMP",
	]);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => publicKeys.has(key)),
	);
	Object.assign(env, {
		HOME: join(dir, "home"),
		TMPDIR: join(dir, "tmp"),
		RUNNER_TEMP: process.env.RUNNER_TEMP ?? tmpdir(),
		LOCAL_OPERATOR_CONFIG_DIR: join(dir, "home/.local-operator"),
		LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB: "1500",
		NODE_OPTIONS: `--import=${SELF}`,
		[TRACE_ENV]: join(dir, "trace"),
		[MAP_ENV]: map,
	});
	mkdirSync(env.HOME, { recursive: true });
	mkdirSync(env.TMPDIR, { recursive: true });
	const pattern =
		side === "base" ? `fixture|${DISPATCH}` : `${NATIVE}|${RENDER}|${DISPATCH}`;
	const files = [
		"scripts/i18n/check-strings.test.mjs",
		...(side === "base" ? [] : ["scripts/onboarding-i18n-contract.test.mjs"]),
		"scripts/run-desktop-tests.test.mjs",
	];
	// No concurrency override: actual CI governor/default width is announced by
	// the unchanged dispatcher. The same hosted worker runs all controls.
	const argv = [
		"scripts/run-desktop-tests.mjs",
		"--test-reporter=tap",
		`--test-name-pattern=${pattern}`,
		...files,
	];
	const log = join(dir, "runner.log");
	const child = spawn(process.execPath, argv, {
		cwd: ROOT,
		env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const owned = new Map();
	let wall = false;
	let interrupted = null;
	let samplingFailed = false;
	const start = Date.now();
	const sample = () => {
		try {
			const rows = table();
			let changed = true;
			while (changed) {
				changed = false;
				for (const row of rows) {
					const previous = owned.get(row.pid);
					if (previous && identity(row.pid) !== previous.id) continue;
					if (row.pid !== child.pid && !owned.has(row.ppid)) continue;
					const id = identity(row.pid);
					if (id && !owned.has(row.pid)) {
						owned.set(row.pid, { ...row, id });
						changed = true;
					}
				}
			}
			const current = rows.filter(
				(row) => owned.get(row.pid)?.id === identity(row.pid),
			);
			appendFileSync(
				join(dir, "processes.jsonl"),
				`${JSON.stringify({ at: new Date().toISOString(), processes: current })}\n`,
			);
			return current;
		} catch {
			samplingFailed = true;
			return [];
		}
	};
	const reap = (signal) => {
		sample();
		// Signal owned session groups only while their leaders' identities still
		// match. Then reap verified individual strays whose leader already exited.
		for (const [pid, row] of owned)
			if (pid === row.pgid && identity(pid) === row.id) kill(-pid, signal);
		for (const [pid, row] of owned)
			if (identity(pid) === row.id) kill(pid, signal);
	};
	const forward = (signal) => {
		interrupted = signal;
		reap("SIGTERM");
	};
	const onTerm = () => forward("SIGTERM");
	const onInt = () => forward("SIGINT");
	process.on("SIGTERM", onTerm);
	process.on("SIGINT", onInt);
	child.stdout.on("data", (chunk) => appendFileSync(log, chunk));
	child.stderr.on("data", (chunk) => appendFileSync(log, chunk));
	sample();
	const ticker = setInterval(sample, 500);
	const bound = setTimeout(() => {
		wall = true;
		reap("SIGTERM");
	}, WALL_MS);
	// Escalation remains armed when a signalled launcher ignores TERM. Its
	// keeper handles detached test groups; our identity ledger covers strays.
	const escalation = setInterval(() => {
		if (wall || interrupted) reap("SIGKILL");
	}, 2_000);
	let result;
	try {
		result = await new Promise((resolveResult, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => resolveResult({ code, signal }));
		});
	} finally {
		clearInterval(ticker);
		clearTimeout(bound);
		clearInterval(escalation);
		reap("SIGTERM");
		await new Promise((done) => setTimeout(done, 100));
		reap("SIGKILL");
		process.removeListener("SIGTERM", onTerm);
		process.removeListener("SIGINT", onInt);
	}
	const text = readFileSync(log, "utf8");
	const pass = Number(text.match(/^# pass (\d+)$/m)?.[1]);
	const fail = Number(text.match(/^# fail (\d+)$/m)?.[1]);
	const expected = side === "base" ? 5 : 13;
	const status = classify(
		result.code,
		result.signal,
		wall,
		interrupted,
		Number.isFinite(pass) && fail === 0 && pass === expected,
		text.includes("MEMORY LIMIT EXCEEDED"),
	);
	const remaining = [...owned]
		.filter(([pid, row]) => identity(pid) === row.id)
		.map(([pid]) => pid);
	const record = {
		side,
		head,
		base: BASE,
		pre: side === "pre" ? PRE : null,
		argv,
		launcherPid: child.pid,
		wallMs: Date.now() - start,
		boundMs: WALL_MS,
		memoryBudgetMb: 1500,
		...result,
		status,
		pass: Number.isFinite(pass) ? pass : null,
		fail: Number.isFinite(fail) ? fail : null,
		expected,
		samplingFailed,
		remaining,
	};
	json(join(dir, "result.json"), record);
	return record;
}

export async function main(head, output) {
	validSha(head);
	validOutput(output);
	if (process.platform !== "linux")
		throw new Error("Process identity diagnostic requires Linux");
	if (!process.versions.node.startsWith("22."))
		throw new Error("Diagnostic requires installed Node22");
	if (git(["rev-parse", "HEAD"]).trim() !== head)
		throw new Error("Checkout must equal pinned PR head, not merge ref");
	if (
		git(["rev-parse", `${BASE}:pnpm-lock.yaml`]).trim() !==
		git(["rev-parse", `${head}:pnpm-lock.yaml`]).trim()
	)
		throw new Error("Base/head dependency locks differ");
	mkdirSync(output, { recursive: true });
	const matrix = {
		head,
		base: BASE,
		node: process.version,
		limitations:
			"Selected, unequal base5 versus pre/head13 assertions; one shared dependency tree and hosted worker. No full-suite coverage or demonstrated ceiling cure. Interrupted status alone does not establish GitHub cancellation; read primary job annotations.",
		results: [],
	};
	json(join(output, "matrix.json"), matrix);
	for (const side of ["base", "pre", "head"]) {
		matrix.results.push(await probe(side, head, output));
		json(join(output, "matrix.json"), matrix);
		console.log(JSON.stringify(matrix.results.at(-1)));
		if (matrix.results.at(-1).status === "interrupted") break;
	}
	return matrix.results.length === 3 &&
		matrix.results.every(
			(result) =>
				result.status === "completed" &&
				!result.samplingFailed &&
				result.remaining.length === 0,
		)
		? 0
		: 1;
}
if (process.env[TRACE_ENV]) preload();
else if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv[2], process.argv[3]);
	} catch (error) {
		console.error(`onboarding diagnostic: ${error.message}`);
		process.exitCode = 1;
	}
}
