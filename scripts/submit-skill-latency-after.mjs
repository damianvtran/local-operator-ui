/**
 * submit-skill-latency-after.mjs - keydown -> bubble and keydown -> POST for
 * a send that carries `$skill` mentions.
 *
 * WHAT IT MEASURES. The operator report is "I press enter and it's sometimes a
 * few milliseconds before it sends or even up to a second when there are skills
 * noted in the message too". The observable question is the timeline from ENTER
 * to two visible facts:
 *
 *   A. the user's message committed to the transcript (the bubble)
 *   B. the `sessions.message` request leaving the renderer's transport
 *
 * Both timestamps are the page's own `Date.now()` on the same machine clock: a
 * window-capture-phase `keydown` listener stamps the press (installed after
 * boot, so it precedes the app's own handler), and a `MutationObserver` on
 * document.body stamps the first commit whose text contains this press's
 * NONCE. The nonce is what makes "the bubble" unambiguous without a selector:
 * a unique token in the typed line cannot appear anywhere else until the
 * message renders. The textarea's value is not part of `textContent`, so the
 * text still sitting in the box cannot satisfy the check.
 *
 * B is measured at an HTTP proxy the app is BUILT against, not in-page: the
 * renderer reaches the daemon through Electron IPC to main, and main makes the
 * request. The proxy logs each request's arrival with the same wall clock, so
 * "keydown -> POST issued" includes the IPC hop and main's HTTP stack.
 *
 * THE APP IS THE BUILT ONE, launched by its own Electron in
 * `--window-mode=headless` (never shown, never focused), against an ISOLATED
 * backend this rig starts - scratch HOME/config/logs/profile, its own bearer -
 * with `hosting: test` / `model_name: mock` so the reply costs no tokens. Three
 * SKILL.md files are seeded into the isolated HOME's skills root. Every process
 * this rig starts is reaped by pid on exit, and the window is never raised.
 *
 * THE SELF-CHECK THAT MAKES A SAMPLE COUNT. A skill arm's premise is that the
 * press actually read the skill bodies. The proxy log therefore has to show
 * exactly N `GET /v1/desktop/skills?...name=...` requests in the window this
 * copy counts (keydown->bubble on the baseline rig, keydown->POST here), N
 * being the arm's skill count; the plain arm has to show none, and the warm arm
 * has to show none because react-query's 30s `staleTime` answers from cache. A
 * press that fails its premise is recorded INVALID with the reason and is never
 * counted.
 *
 * THE NEGATIVE CONTROL. `LO_SUB_DELAY_ARMS` (default on) runs first: the proxy
 * holds each `skills` GET for a fixed 200 ms, so a rig that can see the reads
 * must show the gating fact rising by roughly 3 x 200 ms on a 3-skill press:
 * the bubble on the baseline tree, the POST on the fixed tree (see the
 * differences below). If it does not, the rig cannot see the reads and the run
 * stops rather than reporting a table it has not earned.
 *
 * DIFFERENCES FROM THE BASELINE RIG (one change of premise, nothing else). On
 * the fixed tree the reads run BEHIND the bubble: the bubble no longer waits
 * for them, the POST still does. So this copy (a) waits for the POST before it
 * samples it (the baseline could sample it on the same tick only because the
 * POST always preceded the bubble), (b) counts a cold press's reads in the
 * keydown->POST window rather than keydown->bubble, and (c) flips the
 * control's verdict: the held GETs must move the POST by ~3 x 200 ms while the
 * BUBBLE does not move. Same arms, n, seeding, daemon binary, isolation and
 * build as the baseline rig; the POST body is kept per sample so the payload
 * can be compared byte for byte.
 *
 * WHAT IT CANNOT SEE, stated rather than implied:
 *   - It measures the tree it is run in: this copy was run on the fixed tree
 *     for the after column, and the baseline copy on `ccc99372ac` for the
 *     before column.
 *   - The proxy is a plain TCP/HTTP forwarder in front of the backend: it adds
 *     one local hop to every request (~0.2 ms in the samples here). It does not
 *     change ordering, and the submit-latency README's "what these frames do
 *     not prove" note about the Electron IPC hop does not apply to numbers:
 *     this IS the real IPC path, main included.
 *   - Not the packaged/notarised build, not a real provider, and the reply is
 *     the mock model's.
 *
 * HOW TO RUN IT (see docs/evidence/send-skill-latency/README.md for the family,
 * the before/after numbers these copies produced, and why there are two):
 *
 *   LO_SUB_REPO="$(git rev-parse --show-toplevel)" \
 *     node scripts/submit-skill-latency-after.mjs
 *
 * The build this script drives must have been made with
 * `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:11879` (LO_SUB_PROXY_PORT), so
 * the app's transport points at this rig's proxy. Everything else is optional:
 *
 *   LO_SUB_OUT            output dir (default: $LOCAL_OPERATOR_SCRATCHPAD/baseline)
 *   LO_SUB_LABEL          names the run in the record (default: the HEAD sha)
 *   LO_SUB_N              samples per arm (default 12; the brief asks for >= 10)
 *   LO_SUB_ARMS           comma list of arm ids to run (default: all)
 *   LO_SUB_DELAY_ARMS     0 to skip the negative control
 *   LO_SUB_SKILL_DELAY_MS the control's hold per skills GET (default 200)
 *   LO_SUB_BACKEND_BIN    the daemon binary (default: the local-operator checkout's .venv)
 *   LO_SUB_TIMEOUT_S      whole-run bound in seconds (default 1500)
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
	createServer as createHttpServer,
	request as httpRequest,
} from "node:http";
import { createServer as createProbe } from "node:net";
import { loadavg } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.LO_SUB_REPO ?? process.cwd();
const OUT =
	process.env.LO_SUB_OUT ??
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? ".", "baseline");
const LABEL = process.env.LO_SUB_LABEL ?? "run";
const N = Number(process.env.LO_SUB_N ?? 12);
const PROXY_PORT = Number(process.env.LO_SUB_PROXY_PORT ?? 11879);
const SKILL_DELAY_MS = Number(process.env.LO_SUB_SKILL_DELAY_MS ?? 200);
const DELAY_ARMS = process.env.LO_SUB_DELAY_ARMS !== "0";
const BUDGET_S = Number(process.env.LO_SUB_TIMEOUT_S ?? 1500);
const BACKEND_BIN =
	process.env.LO_SUB_BACKEND_BIN ??
	join(
		process.env.HOME ?? "",
		"workspace/repos/local-operator/.venv/bin/local-operator",
	);
const SKILL_NAMES = ["skill-one", "skill-two", "skill-three"];

mkdirSync(OUT, { recursive: true });
const RIG = join(OUT, `rig-${process.pid}`);
const APP_HOME = join(RIG, "app-home");
const BACKEND_HOME = join(RIG, "backend-home");
const CONFIG_DIR = join(RIG, "backend-config");
const LOG_DIR = join(RIG, "backend-logs");
const USER_DATA = join(RIG, "user-data");
const WORK = join(RIG, "work");
for (const dir of [APP_HOME, BACKEND_HOME, CONFIG_DIR, LOG_DIR, WORK])
	mkdirSync(dir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + BUDGET_S * 1000;
const log = (...parts) => console.error(...parts);

/* Strip the ambient markers a run must never inherit (CMUX_* once let a
 * headless test rename the operator's real workspaces; NODE_TEST_CONTEXT makes
 * a nested `node --test` silently run nothing), and XPC_FLAGS: a child that
 * inherits `XPC_FLAGS=0x2` cannot resolve DNS on this fleet. */
const childEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!key.startsWith("CMUX_") &&
			!key.startsWith("LOP_") &&
			key !== "NODE_TEST_CONTEXT" &&
			key !== "XPC_FLAGS",
	),
);
const { withNotificationsOff } = await import(
	pathToFileURL(join(REPO, "scripts/notifications-off.mjs")).href
);
const { withTelemetryOff } = await import(
	pathToFileURL(join(REPO, "scripts/telemetry-off.mjs")).href
);

const freePort = async () => {
	for (;;) {
		const candidate = 9200 + Math.floor(Math.random() * 600);
		const free = await new Promise((resolve) => {
			const probe = createProbe();
			probe.on("error", () => resolve(false));
			probe.listen(candidate, "127.0.0.1", () =>
				probe.close(() => resolve(true)),
			);
		});
		if (free) return candidate;
	}
};
const backendPort = await freePort();
const cdpPort = await freePort();

/* ------------------------------------------------------------------ skills */
const skillsRoot = join(BACKEND_HOME, ".local-operator", "skills");
for (const name of SKILL_NAMES) {
	const dir = join(skillsRoot, name);
	mkdirSync(dir, { recursive: true });
	const body = Array.from(
		{ length: 12 },
		(_, i) => `Step ${i + 1}: ${name} line ${i + 1} of the seeded body.`,
	).join("\n");
	writeFileSync(
		join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: Seeded ${name} for the submit-latency rig.\n---\n\n${body}\n`,
	);
}

/* ------------------------------------------------------------------ backend */
const token = randomUUID().replace(/-/g, "");
writeFileSync(
	join(CONFIG_DIR, "config.yml"),
	"version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n",
);
const backendEnv = withTelemetryOff({
	...childEnv,
	HOME: BACKEND_HOME,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LOCAL_OPERATOR_DESKTOP_TOKEN: token,
});
withNotificationsOff(backendEnv);
const backend = spawn(
	BACKEND_BIN,
	["serve", "--host", "127.0.0.1", "--port", String(backendPort)],
	{
		env: backendEnv,
		cwd: WORK,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	},
);
const backendLog = [];
backend.stdout.on("data", (d) => backendLog.push(`${d}`));
backend.stderr.on("data", (d) => backendLog.push(`${d}`));

const api = async (method, path, body) => {
	const response = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed = null;
	try {
		parsed = JSON.parse(text);
	} catch {}
	return { status: response.status, parsed, text: text.slice(0, 400) };
};
const resultOf = (reply) =>
	reply.parsed?.result ?? reply.parsed?.data ?? reply.parsed;

/* -------------------------------------------------------------------- proxy */
const proxyLog = [];
let skillsDelayMs = 0;
const proxy = createHttpServer((req, res) => {
	const arrival = Date.now();
	const entry = {
		t: arrival,
		method: req.method ?? "",
		path: req.url ?? "",
		done: null,
	};
	proxyLog.push(entry);
	const isSkills =
		req.method === "GET" && (req.url ?? "").startsWith("/v1/desktop/skills");
	/* The message body, so `payloadSkills` can prove the press carried the
	 * SKILL.md blocks a `$name` press is supposed to. A stream can be piped and
	 * read: both see the same chunks. */
	const isMessage = req.method === "POST" && /\/messages$/.test(req.url ?? "");
	if (isMessage) {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			entry.body = Buffer.concat(chunks).toString("utf8");
		});
	}
	const forward = () => {
		const upstream = httpRequest(
			{
				host: "127.0.0.1",
				port: backendPort,
				path: req.url,
				method: req.method,
				headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
			},
			(up) => {
				entry.firstByteAt = Date.now();
				res.writeHead(up.statusCode ?? 502, up.headers);
				/* The response's END, not its arrival: the vocabulary is in hand only
				 * after the body the renderer awaits has been delivered, and the two
				 * are a full daemon scan apart on this route. */
				up.on("end", () => {
					entry.done = Date.now();
				});
				up.pipe(res);
			},
		);
		upstream.on("error", () => {
			try {
				res.destroy();
			} catch {}
		});
		req.pipe(upstream);
	};
	if (isSkills && skillsDelayMs > 0) setTimeout(forward, skillsDelayMs);
	else forward();
});
await new Promise((resolve, reject) => {
	proxy.on("error", reject);
	proxy.listen(PROXY_PORT, "127.0.0.1", resolve);
});

/* --------------------------------------------------------------------- app */
const appEnv = withTelemetryOff({
	...childEnv,
	HOME: APP_HOME,
	LOCAL_OPERATOR_CONFIG_DIR: join(RIG, "app-config"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	VITE_DISABLE_BACKEND_MANAGER: "true",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PROXY_PORT}`,
	LOCAL_OPERATOR_DESKTOP_TOKEN: token,
});
withNotificationsOff(appEnv);
mkdirSync(join(RIG, "app-config"), { recursive: true });
const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${USER_DATA}`,
		"--window-mode=headless",
		"--window-size=1380x900",
	],
	{ env: appEnv, cwd: REPO, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
const appLog = [];
app.stdout.on("data", (d) => appLog.push(`${d}`));
app.stderr.on("data", (d) => appLog.push(`${d}`));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: resolve(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
			);
		return result.result.value;
	}
}

const report = {
	label: LABEL,
	head: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: REPO,
		encoding: "utf8",
	}).trim(),
	proxyPort: PROXY_PORT,
	backendPort,
	rig: { out: OUT, budgetSeconds: BUDGET_S, skillDelayMs: SKILL_DELAY_MS },
	skills: SKILL_NAMES,
	arms: [],
	notes: [],
};
const record = (key, value) => {
	report[key] = value;
	log(`[record] ${key}: ${JSON.stringify(value)}`);
};

let cdp = null;
const reaped = [];
const finish = async (code) => {
	try {
		if (cdp) cdp.ws.close();
	} catch {}
	writeFileSync(
		join(OUT, `samples-${LABEL}.json`),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(join(OUT, `app-${LABEL}.log`), appLog.join(""));
	writeFileSync(join(OUT, `backend-${LABEL}.log`), backendLog.join(""));
	log(`[samples] ${join(OUT, `samples-${LABEL}.json`)}`);
	for (const [name, child] of [
		["app", app],
		["backend", backend],
	]) {
		try {
			process.kill(-child.pid, "SIGKILL");
			reaped.push(`${name}:${child.pid}`);
		} catch {
			try {
				child.kill("SIGKILL");
				reaped.push(`${name}:${child.pid}`);
			} catch {}
		}
	}
	try {
		proxy.close();
	} catch {}
	await sleep(300);
	const alive = [];
	for (const [name, child] of [
		["app", app],
		["backend", backend],
	]) {
		try {
			process.kill(child.pid, 0);
			alive.push(`${name}:${child.pid}`);
		} catch {}
	}
	log(`[reaped] ${reaped.join(", ") || "(none)"}`);
	log(`[alive-after-reap] ${alive.join(", ") || "(none)"}`);
	process.exit(code ?? 0);
};

const target = async () => {
	try {
		const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
		const list = await response.json();
		/* ONLY the app's own renderer. The app also opens a browser panel
		 * (a normal page target on the browser host's port) and a devtools target;
		 * a `pages[0]` fallback measures whichever appeared first, which is a race
		 * the first dry run lost (measured: a 30 s "preload bridge" timeout on the
		 * browser panel). */
		return (
			list.find(
				(entry) =>
					entry.type === "page" &&
					(entry.url ?? "").includes("/renderer/index.html"),
			) ?? null
		);
	} catch {
		return null;
	}
};

const waitFor = async (what, fn, ms = 20_000) => {
	const until = Math.min(Date.now() + ms, deadline);
	while (Date.now() < until) {
		const value = await fn().catch(() => false);
		if (value) return value;
		await sleep(150);
	}
	throw new Error(`timed out waiting for ${what}`);
};

const TEXTAREA = 'textarea[aria-label="Message"]';
const composerReady = `document.querySelector('${TEXTAREA}') !== null`;
const skillGet = (entry) =>
	entry.method === "GET" &&
	(entry.path ?? "").startsWith("/v1/desktop/skills") &&
	(entry.path ?? "").includes("name=");
const skillVocabularyGet = (entry) =>
	entry.method === "GET" &&
	(entry.path ?? "").startsWith("/v1/desktop/skills") &&
	!(entry.path ?? "").includes("name=");
const messagePost = (entry) =>
	entry.method === "POST" && /\/messages$/.test(entry.path ?? "");

const PROBE = `(() => {
	const probe = window.__submitProbe ?? (window.__submitProbe = { pendingNonce: null, current: null, observer: null });
	if (!probe.listening) {
		probe.listening = true;
		window.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
			const box = document.querySelector('${TEXTAREA}');
			window.__submitProbe.current = {
				wall: Date.now(),
				perf: performance.now(),
				nonce: window.__submitProbe.pendingNonce,
				value: box ? box.value : null,
				done: null,
			};
		}, true);
	}
	if (probe.observer) return true;
	/* The document element rather than the body: after a reload this evaluates
	 * before <body> exists (measured on the first dry run), and observing the
	 * root covers the body being inserted. */
	const root = document.documentElement;
	if (!root) return false;
	const observer = new MutationObserver(() => {
		const current = window.__submitProbe.current;
		if (!current || current.done || !current.nonce) return;
		if (!document.body || !document.body.textContent.includes(current.nonce)) return;
		const box = document.querySelector('${TEXTAREA}');
		current.done = {
			wall: Date.now(),
			perf: performance.now(),
			cleared: (box ? box.value : "") === "",
		};
	});
	observer.observe(root, { subtree: true, childList: true, characterData: true });
	probe.observer = observer;
	return true;
})()`;

const armDefs = () => {
	const arms = [];
	if (DELAY_ARMS) {
		arms.push({
			id: "control-delay-200",
			skills: 3,
			cold: true,
			n: 4,
			delay: SKILL_DELAY_MS,
			note: "negative control: skills GETs held, bubble must rise with them",
		});
	}
	arms.push({ id: "plain", skills: 0, cold: false, n: N });
	arms.push({ id: "one-skill-cold", skills: 1, cold: true, n: N });
	arms.push({ id: "three-skills-cold", skills: 3, cold: true, n: N });
	arms.push({ id: "three-skills-warm", skills: 3, cold: false, n: N });
	return arms;
};

const textFor = (skills, nonce) => {
	const marks = SKILL_NAMES.slice(0, skills)
		.map((name) => `$${name}`)
		.join(" ");
	return marks ? `${marks} ${nonce}` : `plain ${nonce}`;
};

const pressKey = async (key, code, keyCode, modifiers = 0) => {
	for (const type of ["keyDown", "keyUp"])
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key,
			code,
			windowsVirtualKeyCode: keyCode,
			nativeVirtualKeyCode: keyCode,
			modifiers,
		});
};
const boxValue = () =>
	cdp.evaluate(
		`(() => { const b = document.querySelector('${TEXTAREA}'); return b ? b.value : null; })()`,
	);
const boxEmpty = async () => (await boxValue()) === "";
/* A press's send can still be in flight when the next round starts (a 7 s
 * press on a loaded host outlives the sample's own wait). The composer refuses
 * a second send while one is in flight, so a press taken then measures the
 * refusal: wait for the box to empty, and clear a leftover draft (the composer
 * persists drafts across a reload) before pressing. */
const ensureIdle = async () => {
	const until = Date.now() + 25_000;
	let cleared = false;
	while (Date.now() < until) {
		if (await boxEmpty()) return cleared;
		const value = await boxValue();
		/* A non-empty box after the wait means a draft survived: clear it the way
		 * a person would, from the caret, one Backspace at a time. */
		if (value) {
			cleared = true;
			for (let i = 0; i < 240 && !(await boxEmpty()); i += 1)
				await pressKey("Backspace", "Backspace", 8);
		}
		await sleep(250);
	}
	return cleared;
};
let coldSettleMs = 250;

const percentiles = (values) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const at = (p) => {
		const index = Math.min(
			sorted.length - 1,
			Math.ceil((p / 100) * sorted.length) - 1,
		);
		return sorted[index];
	};
	return {
		n: sorted.length,
		p50: at(50),
		p95: at(95),
		max: sorted[sorted.length - 1],
		min: sorted[0],
	};
};

const press = async (arm, index) => {
	const nonce = `n${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	const text = textFor(arm.skills, nonce);
	const _pressKey = async (key, code, keyCode, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				windowsVirtualKeyCode: keyCode,
				nativeVirtualKeyCode: keyCode,
				modifiers,
			});
	};
	if (arm.cold) {
		await cdp.send("Page.reload", { ignoreCache: false });
		const reloadedAt = Date.now();
		await waitFor("composer after reload", () => cdp.evaluate(composerReady));
		/* A reload drops the page, and the probe with it: re-install before the
		 * press or the keydown stamp has nowhere to land (measured on the first
		 * dry run of this rig). */
		await waitFor("probe installed", () =>
			cdp.evaluate(PROBE).catch(() => false),
		);
		/* The vocabulary must be in hand before the press, or `planSkillMentions`
		 * sees no names and the read never happens — a false "fast" sample. The
		 * proxy log is the signal: the composer's own list read arriving after the
		 * reload. (It can land before the composer-ready poll returns, so the
		 * boundary is the reload, not the poll.) */
		await waitFor(
			"skill vocabulary read",
			async () =>
				proxyLog.some(
					(entry) =>
						skillVocabularyGet(entry) && entry.t >= reloadedAt && entry.done,
				),
			25_000,
		);
		/* A GET at the proxy is not the vocabulary IN HAND: the response and the
		 * render that stores it both follow, and a press before that parses
		 * `planned` as empty and measures a plain send while calling it a skill
		 * press. The proof is the sample's OWN read count (checked below, 0 vs N);
		 * this settle is the time it needs, and it grows after a sample that came
		 * up short rather than being guessed once. */
		await sleep(coldSettleMs);
	}

	await cdp.evaluate(`(() => {
		const box = document.querySelector('${TEXTAREA}');
		if (!box) return false;
		box.focus();
		window.__submitProbe.pendingNonce = ${JSON.stringify(nonce)};
		window.__submitProbe.current = null;
		return true;
	})()`);
	const cleared = await ensureIdle();
	if (!(await boxEmpty()))
		throw new Error("composer never emptied before the press");
	await cdp.send("Input.insertText", { text });
	await waitFor(
		"typed text settled",
		async () =>
			(await cdp.evaluate(`document.querySelector('${TEXTAREA}').value`)) ===
			text,
	);
	const popup = await cdp.evaluate(
		`document.querySelector('[role="listbox"]') !== null`,
	);
	if (popup) {
		/* Not expected: `Input.insertText` commits the whole line in one edit, so
		 * no mention token is ever mid-edit. If a popup is up anyway, Enter would
		 * pick a row instead of sending — record it rather than measure the wrong
		 * gesture. */
		return { nonce, text, invalid: "mention popup open before Enter" };
	}
	await sleep(80);
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			text: type === "keyDown" ? "\r" : undefined,
			unmodifiedText: type === "keyDown" ? "\r" : undefined,
		});
	}
	await waitFor(
		"keydown stamped",
		async () =>
			await cdp.evaluate(
				`window.__submitProbe.current && window.__submitProbe.current.nonce === ${JSON.stringify(nonce)}`,
			),
		5000,
	);
	const stamp = JSON.parse(
		await cdp.evaluate("JSON.stringify(window.__submitProbe.current)"),
	);
	const settled = await waitFor(
		"bubble commit",
		async () => {
			const value = await cdp.evaluate(
				`window.__submitProbe.current && window.__submitProbe.current.done
					? JSON.stringify(window.__submitProbe.current.done) : null`,
			);
			return value;
		},
		20_000,
	).catch(() => null);
	const done = settled ? JSON.parse(settled) : null;
	/* The fixed tree paints the bubble BEFORE the reads finish, so the POST can
	 * land after the bubble: wait for it (bounded) instead of sampling the tick
	 * the bubble appears. On the baseline this returns at once - the POST was
	 * already there. */
	const post = await waitFor(
		"sessions.message POST",
		async () =>
			proxyLog.find(
				(entry) => messagePost(entry) && entry.t >= stamp.wall - 2,
			) ?? false,
		20_000,
	).catch(() => null);
	/* Reads counted up to the POST, not the bubble: reads behind the bubble are
	 * the fixed behaviour, and a read that arrives after the POST would prove
	 * the POST did not wait for it (counted short, so the sample is INVALID). */
	const readEntries = proxyLog.filter(
		(entry) =>
			skillGet(entry) &&
			entry.t >= stamp.wall - 2 &&
			entry.t <= (post?.t ?? Date.now()),
	);
	const reads = readEntries.length;
	/* Where a read's time went: the daemon's own answer (first byte) versus the
	 * hop. Three serial scans are the defect; this says each one's cost. */
	const readScans = readEntries.map((entry) => ({
		inMs: entry.t - stamp.wall,
		daemonMs: entry.firstByteAt ? entry.firstByteAt - entry.t : null,
		totalMs: entry.done ? entry.done - entry.t : null,
	}));
	/* The payload the press actually carried: every seeded body has a line
	 * `Step 1: <name> line 1`, so finding it is proof the block went. */
	const payloadSkills = post?.body
		? SKILL_NAMES.filter((name) => post.body.includes(`Step 1: ${name} line 1`))
		: null;

	const sample = {
		arm: arm.id,
		index,
		nonce,
		keydownWall: stamp.wall,
		bubbleWall: done?.wall ?? null,
		postWall: post?.t ?? null,
		keydownToBubble: done ? done.wall - stamp.wall : null,
		keydownToPost: post ? post.t - stamp.wall : null,
		cleared: done?.cleared ?? null,
		clearedLeftover: cleared,
		skillReads: reads,
		readScans,
		payloadSkills,
		/* Raw bytes, so the payload can be diffed against the baseline's. */
		postBody: post?.body ?? null,
		typed: stamp.value === text,
		invalid: null,
	};
	if (!done) sample.invalid = "no bubble commit within 20s";
	else if (!post) sample.invalid = "no sessions.message POST seen at the proxy";
	else if (!sample.typed)
		sample.invalid = `keydown saw the wrong text: ${stamp.value}`;
	else if (done.cleared !== true)
		sample.invalid = "composer was not cleared with the bubble";
	else if (arm.skills === 0 && reads !== 0)
		sample.invalid = `plain press read ${reads} skill bodies`;
	else if (arm.skills > 0 && (payloadSkills ?? []).length !== arm.skills)
		sample.invalid = `payload carried ${(payloadSkills ?? []).length} of ${arm.skills} skill bodies`;
	else if (arm.cold && arm.skills > 0 && reads !== arm.skills)
		sample.invalid = `read ${reads} skill bodies, a cold press expects ${arm.skills}`;
	return sample;
};

try {
	/* backend ready */
	await waitFor(
		"backend /v1/capabilities",
		async () => (await api("GET", "/v1/capabilities")).status === 200,
		120_000,
	);
	record(
		"loadavg_start",
		loadavg().map((value) => Number(value.toFixed(2))),
	);
	const capabilities = resultOf(await api("GET", "/v1/capabilities"));
	record(
		"capabilities.session_catalogue",
		capabilities?.features?.session_catalogue ?? null,
	);
	record(
		"capabilities.session_catalogue_ok",
		(capabilities?.features?.session_catalogue ?? 0) >= 3,
	);

	/* renderer target */
	const page = await waitFor("renderer target", target, 180_000);
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve);
		ws.addEventListener("error", reject);
	});
	cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await waitFor(
		"preload bridge",
		() => cdp.evaluate(`typeof window.api?.desktop?.request === "function"`),
		30_000,
	);
	await cdp.evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: 0 },
			version: 0,
		}));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(4000);
	await waitFor(
		"first-run setup cleared",
		() =>
			cdp.evaluate(
				`typeof window.api?.desktop?.request === "function" && !document.querySelector('[role="dialog"]')`,
			),
		60_000,
	);
	const bridge = JSON.parse(
		(await cdp.evaluate(
			`(async () => {
				const r = await window.api.desktop.request({ op: "capabilities" });
				return JSON.stringify(r.body?.result ?? r);
			})()`,
		)) ?? "null",
	);
	record("capabilities.desktop_available", bridge?.desktop_available ?? null);
	if (!bridge?.desktop_available)
		throw new Error("the app is not paired with the backend");

	/* a session on the backend, then the app on its route */
	const created = resultOf(
		await api("POST", "/v1/desktop/sessions", {
			request_id: randomUUID(),
			cwd: WORK,
		}),
	);
	const sessionId = created?.session_id;
	if (!sessionId)
		throw new Error(`no session created: ${JSON.stringify(created)}`);
	record("sessionId", sessionId);
	await cdp.evaluate(`location.hash = "#/chat/${sessionId}"; true`);
	await waitFor("composer", () => cdp.evaluate(composerReady), 60_000);
	await sleep(1200);
	await cdp.evaluate(PROBE);
	record(
		"viewport",
		await cdp.evaluate(
			"JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})",
		),
	);
	record("location", await cdp.evaluate("location.href"));

	/* The app must actually be talking to THIS rig's proxy: without that the
	 * POST timestamp would come from somewhere the rig cannot see, or worse,
	 * from the operator's own backend. */
	await waitFor(
		"the app's own traffic at the proxy",
		async () => proxyLog.some((entry) => entry.path.startsWith("/v1/desktop")),
		30_000,
	);
	record("proxy_saw_app_traffic", true);

	const wanted = process.env.LO_SUB_ARMS;
	const arms = armDefs();
	const selected = arms.filter(
		(arm) => !wanted || wanted.split(",").includes(arm.id),
	);
	/* ROUND-ROBIN, not one arm to completion: this host's load moves by the
	 * minute (the isolated daemon's per-request skill scan measured 380 ms in a
	 * quiet window and 1.6 s under the fleet's load), so an arm measured in one
	 * stretch is not comparable with an arm measured in another. Each round runs
	 * every selected arm once; the warm arm follows the cold 3-skill press that
	 * fills its cache, which is the only order that gives it a warm cache. */
	const order = [
		"three-skills-cold",
		"three-skills-warm",
		"one-skill-cold",
		"plain",
	];
	const byArm = new Map(selected.map((arm) => [arm.id, []]));
	const control = selected.find((arm) => arm.delay);
	const controlSamples = [];
	const runOne = async (arm, samples) => {
		skillsDelayMs = arm.delay ?? 0;
		let sample;
		try {
			sample = await press(arm, samples.length);
		} catch (error) {
			sample = {
				arm: arm.id,
				index: samples.length,
				invalid: `rig error: ${error.message}`,
			};
		}
		log(
			`[${arm.id}] #${samples.length} kd->bubble=${sample.keydownToBubble} kd->post=${sample.keydownToPost} reads=${sample.skillReads} payload=${sample.payloadSkills} ${sample.invalid ?? "ok"}`,
		);
		if (sample.invalid) report.notes.push(`${arm.id}: ${sample.invalid}`);
		samples.push(sample);
		skillsDelayMs = 0;
		/* The store refuses a second send while the first is in flight, and the
		 * bubble paints BEFORE the request goes: a press taken on the next round
		 * would measure that refusal. Wait for every message POST to have been
		 * answered before the next arm starts. */
		await waitFor(
			"the previous send answered",
			async () => !proxyLog.some((entry) => messagePost(entry) && !entry.done),
			25_000,
		).catch(() => null);
		await sleep(150);
		return sample;
	};
	if (control) {
		for (let i = 0; i < control.n; i += 1)
			await runOne(control, controlSamples);
	}
	const rounds = Math.max(
		0,
		...selected.filter((arm) => !arm.delay).map((arm) => arm.n),
	);
	for (let round = 0; round < rounds && Date.now() < deadline; round += 1) {
		for (const id of order) {
			const arm = selected.find(
				(candidate) => candidate.id === id && !candidate.delay,
			);
			const samples = arm ? byArm.get(arm.id) : null;
			if (!arm || !samples || samples.length >= arm.n) continue;
			const sample = await runOne(arm, samples);
			/* A press that came up short of the vocabulary is a settle problem, not
			 * a defect: grow the settle for the next cold press rather than
			 * repeating the same wait. */
			if (
				sample.invalid &&
				/read 0 skill bodies|payload carried 0 of/.test(sample.invalid)
			)
				coldSettleMs = Math.min(6000, coldSettleMs + 600);
			await sleep(300);
		}
	}
	for (const arm of selected) {
		const samples = arm.delay ? controlSamples : (byArm.get(arm.id) ?? []);
		const valid = samples.filter((sample) => !sample.invalid);
		report.arms.push({
			id: arm.id,
			skills: arm.skills,
			cold: arm.cold,
			delayMs: arm.delay ?? 0,
			requested: arm.n,
			attempts: samples.length,
			valid: valid.length,
			samples,
			bubble: percentiles(valid.map((s) => s.keydownToBubble)),
			post: percentiles(valid.map((s) => s.keydownToPost)),
			daemonScan: percentiles(
				valid
					.flatMap((s) => (s.readScans ?? []).map((span) => span.daemonMs))
					.filter((v) => v !== null),
			),
			readsPerPress: percentiles(valid.map((s) => s.skillReads)),
		});
	}

	const lines = [
		`# keydown -> bubble / POST (${LABEL})`,
		"",
		"| arm | n | bubble p50 | bubble p95 | bubble max | POST p50 | POST p95 | POST max | skill GETs/press | daemon scan p50 |",
		"|---|---|---|---|---|---|---|---|---|---|",
	];
	for (const arm of report.arms) {
		const b = arm.bubble ?? {};
		const p = arm.post ?? {};
		lines.push(
			`| ${arm.id} | ${arm.valid}/${arm.requested} | ${b.p50 ?? "-"} | ${b.p95 ?? "-"} | ${b.max ?? "-"} | ${p.p50 ?? "-"} | ${p.p95 ?? "-"} | ${p.max ?? "-"} | ${arm.readsPerPress?.p50 ?? "-"} | ${arm.daemonScan?.p50 ?? "-"} |`,
		);
	}
	const summary = lines.join("\n");
	writeFileSync(join(OUT, `summary-${LABEL}.md`), `${summary}\n`);
	log(summary);
	record(
		"loadavg_end",
		loadavg().map((value) => Number(value.toFixed(2))),
	);
	record("invalid", report.notes.length);

	/* The control's verdict on the FIXED tree: the reads run behind the bubble,
	 * so the held GETs must move the POST by ~3 x 200 ms (they still gate the
	 * send) and the BUBBLE must not move. A bubble that moves with the hold means
	 * the reads were not detached; a POST that does not means they stopped
	 * gating the send. */
	const controlArm = report.arms.find((arm) => arm.id === "control-delay-200");
	const plainArm = report.arms.find((arm) => arm.id === "plain");
	if (
		controlArm &&
		plainArm &&
		controlArm.bubble &&
		plainArm.bubble &&
		controlArm.post &&
		plainArm.post
	) {
		const expected = 3 * SKILL_DELAY_MS;
		const bubbleDelta = controlArm.bubble.p50 - plainArm.bubble.p50;
		const postDelta = controlArm.post.p50 - plainArm.post.p50;
		const bubbleCeiling = plainArm.bubble.p95 + 150;
		record("control_bubble_delta_ms", bubbleDelta);
		record("control_post_delta_ms", postDelta);
		record("control_expected_ms", expected);
		record("control_bubble_ceiling_ms", bubbleCeiling);
		record(
			"control_passes",
			postDelta >= expected * 0.6 && bubbleDelta <= bubbleCeiling,
		);
		if (postDelta < expected * 0.6 || bubbleDelta > bubbleCeiling) {
			report.notes.push(
				`negative control: held reads moved bubble by ${bubbleDelta} ms (ceiling ${bubbleCeiling}) and POST by ${postDelta} ms (expect ~${expected})`,
			);
			await finish(3);
		}
	}
	await finish(0);
} catch (error) {
	report.failure = `${error.stack ?? error.message}`;
	log(`[failure] ${error.message}`);
	await finish(1);
}
