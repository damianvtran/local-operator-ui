/**
 * Contract tests for the browser host's main-process core.
 *
 * The shipped TypeScript is bundled in memory with esbuild and driven against
 * real loopback HTTP and real filesystem state, the same way
 * `desktop-contract.test.mjs` tests the desktop transport. What that buys here is
 * coverage of the pieces that would otherwise need a browser to test at all: the
 * token-is-the-capability rule, the agent-tab cap, the per-tab command lane, the
 * origin gate's refusal shapes, the ownership fence, and the RPC's four security
 * rules.
 *
 * WHAT THESE TESTS ARE NOT: proof that the feature works. Electron IPC here is a
 * fake, the views are fakes, and nothing in this file has ever loaded a page. The
 * real run — a real window, a real page, real CDP — is the app-level evidence in
 * the PR, and this file exists so a regression in the RULES is caught without
 * needing one.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/registry";',
			// `session-store` is here for the capture rule alone: what a change capture
			// contains is a property of `captureTabs`, and a restore's own capture is what
			// round 2's B2 was about.
			'export * from "./src/main/browser/session-store";',
			'export * from "./src/main/browser/state-file";',
			'export * from "./src/main/browser/rpc";',
			'export * from "./src/main/browser/protocol";',
			'export * from "./src/main/browser/approvals";',
			'export * from "./src/main/browser/ownership";',
			'export * from "./src/main/browser/host";',
			'export * from "./src/main/browser/settle";',
			'export * from "./src/main/browser/log-capture";',
			'export * from "./src/main/browser/actions/gate";',
			// The vendored driver modules. Their app-side counterparts live in
			// `policy/adapter.ts`, which this bundle reaches through `host`.
			'export * from "./src/main/browser/vendor/driver/origin-policy";',
			'export * from "./src/main/browser/vendor/driver/psl.gen";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `host.ts` and `rpc.ts` reference `node:crypto`/`node:http` normally, and the
	// browser modules import Electron only as TYPES, so no fixture is needed.
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	TabRegistry,
	MAX_AGENT_TABS,
	captureTabs,
	surfaceToken,
	parseSurface,
	redactToken,
	ownsRedacted,
	BrowserStateWriter,
	stateFilePath,
	mintSessionKey,
	keysMatch,
	STATE_FILE_MODE,
	STATE_DIR_MODE,
	startRpcServer,
	RPC_PATH,
	KEY_HEADER,
	PROTO_VERSION,
	ERROR_CODES,
	ApprovalStore,
	OwnershipLedger,
	BrowserHost,
	CdpPool,
	isReportableLoadFailure,
	configurePslRules,
	domainScopeAvailable,
	registrableDomain,
	safeHttpUrl,
	navigateView,
	settle,
} = mod;

/** A fake `WebContentsView` with the shape the registry and the driver read. */
class FakeWebContents extends EventEmitter {
	constructor(id) {
		super();
		this.id = id;
		this.url = "about:blank";
		this.title = "";
		this.destroyed = false;
		this.loaded = [];
		this.worlds = [];
		this.isolatedResult = "";
		this.debugger = new FakeDebugger(this);
		this.#history = {
			canGoBack: () => false,
			canGoForward: () => false,
			goBack: () => {},
			goForward: () => {},
			length: () => 1,
		};
	}

	#history;

	isDestroyed() {
		return this.destroyed;
	}

	/**
	 * Electron throws `Object has been destroyed` from every accessor on a dead
	 * WebContents. Reproduced here because it is exactly what the guards under
	 * test exist for: a fake that answers politely cannot fail a missing guard.
	 */
	#assertAlive() {
		if (this.destroyed) throw new Error("Object has been destroyed");
	}

	get navigationHistory() {
		this.#assertAlive();
		return this.#history;
	}

	isLoading() {
		this.#assertAlive();
		return false;
	}

	reload() {}

	stop() {}

	getURL() {
		this.#assertAlive();
		return this.url;
	}

	getTitle() {
		this.#assertAlive();
		return this.title;
	}

	async loadURL(url) {
		this.loaded.push(url);
		this.url = url;
		// A real load emits its events asynchronously; emit them on the next tick so
		// the settle that is armed BEFORE `loadURL` is already listening.
		setImmediate(() => this.emit("did-finish-load"));
	}

	close() {
		this.destroyed = true;
		this.emit("destroyed");
	}

	async executeJavaScriptInIsolatedWorld(worldId, scripts) {
		this.worlds.push({ worldId, code: scripts[0]?.code ?? "" });
		return this.isolatedResult;
	}
}

/** A fake CDP debugger: enough to satisfy the driver's attach path. */
class FakeDebugger {
	constructor(contents) {
		this.contents = contents;
		this.attached = false;
		this.commands = [];
	}

	attach() {
		this.attached = true;
	}

	detach() {
		this.attached = false;
	}

	isAttached() {
		return this.attached;
	}

	async sendCommand(method) {
		this.commands.push(method);
		if (method === "Runtime.evaluate") return { result: { value: 1 } };
		return {};
	}

	on() {}

	removeListener() {}
}

class FakeView {
	constructor(id) {
		this.webContents = new FakeWebContents(id);
		this.bounds = [];
		this.visibility = [];
	}

	setBounds(rect) {
		this.bounds.push(rect);
	}

	setVisible(visible) {
		this.visibility.push(visible);
	}

	getBounds() {
		return this.bounds.at(-1) ?? { x: 0, y: 0, width: 0, height: 0 };
	}
}

function makeRegistry() {
	const views = new Map();
	const removed = [];
	let nextWebContentsId = 100;
	const registry = new TabRegistry(
		(_options, tabId) => {
			const view = new FakeView(nextWebContentsId++);
			views.set(tabId, view);
			return view;
		},
		(tabId, webContentsId) => removed.push({ tabId, webContentsId }),
		() => {},
	);
	return { registry, views, removed };
}

let root = "";
let server;
let sessionKey = "";
const requests = [];

before(async () => {
	root = mkdtempSync(join(tmpdir(), "lo-browser-host-"));
	server = await startRpcServer({
		key: (sessionKey = mintSessionKey()),
		dispatch: async (method, params, requestId) => {
			requests.push({ method, params, requestId });
			if (method === "status") return { ok: true };
			if (method === "read") {
				// An UNTYPED failure, which is what a bug in an action looks like from
				// here: the transport must turn it into `internal` rather than leak a
				// code the session's model would reject and silently drop.
				throw new Error("the tab is gone");
			}
			throw new Error("unsupported");
		},
		log: () => {},
	});
});

after(async () => {
	await server?.close();
	rmSync(root, { recursive: true, force: true });
});

function rpcUrl(path = RPC_PATH) {
	return `http://127.0.0.1:${server.port}${path}`;
}

async function post(body, { key = sessionKey, path = RPC_PATH } = {}) {
	const response = await fetch(rpcUrl(path), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(key === null ? {} : { [KEY_HEADER]: key }),
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
	return {
		status: response.status,
		headers: response.headers,
		json: await response.json().catch(() => null),
	};
}

// ---- the state file --------------------------------------------------------

test("the state file is 0600 under 0700 and publishes the port and key", () => {
	const path = stateFilePath(root);
	const writer = new BrowserStateWriter(
		path,
		() => ({ tabs: 2, agentTabs: 1, profileDir: "/scratch/profile" }),
		{ appVersion: "0.21.0" },
	);
	writer.start(51234, sessionKey);
	const stat = statSync(path);
	// The LITERALS, deliberately, not the exported constants: comparing the file
	// against `STATE_FILE_MODE` made the assertion unable to fail — mutating the
	// constant to 0o644 kept the suite green while the message still claimed 0600
	// (R4). The constants are asserted separately, as intent.
	assert.equal(stat.mode & 0o777, 0o600, "the record is 0600");
	assert.equal(
		statSync(join(root, "run", "ui-browser")).mode & 0o777,
		0o700,
		"the directory is 0700",
	);
	assert.equal(STATE_FILE_MODE, 0o600);
	assert.equal(STATE_DIR_MODE, 0o700);
	const body = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(body.host, "ui");
	assert.equal(body.proto, PROTO_VERSION);
	assert.equal(body.port, 51234);
	assert.equal(body.pid, process.pid);
	assert.equal(body.tabs, 2);
	assert.equal(body.agent_tabs, 1);
	assert.equal(body.profile_dir, "/scratch/profile");
	assert.ok(
		typeof body.session_key === "string" && body.session_key.length >= 32,
		"the key satisfies the Python model's minimum length",
	);
	assert.ok(body.heartbeat_at > 0 && body.started_at > 0);
	// The staged write leaves no temp file behind: a leftover `.tmp` beside the
	// record would be picked up by nothing, but it is evidence the rename path ran.
	assert.equal(
		readdirSync(join(root, "run", "ui-browser")).filter((name) =>
			name.endsWith(".tmp"),
		).length,
		0,
	);
	writer.clear();
	assert.equal(
		readdirSync(join(root, "run", "ui-browser")).length,
		0,
		"clearing removes the record, so discovery is honest",
	);
});

test("a record whose mode was widened is repaired on the next write", () => {
	const path = stateFilePath(root);
	const writer = new BrowserStateWriter(
		path,
		() => ({ tabs: 0, agentTabs: 0, profileDir: "/scratch/profile" }),
		{ appVersion: "0.21.0" },
	);
	writer.start(51235, sessionKey);
	// `writeFileSync`'s mode applies only at creation, and `mkdirSync`'s is subject
	// to the umask and does nothing to a directory that already exists — so a
	// record or a directory that arrived world-readable (a restore, an older
	// build, a different umask) would stay that way forever without the repair the
	// write path performs. Both halves are asserted, because the file's happens to
	// be re-created by the staged rename while the directory's is only the chmod.
	const dir = join(root, "run", "ui-browser");
	chmodSync(path, 0o644);
	chmodSync(dir, 0o755);
	assert.equal(statSync(path).mode & 0o777, 0o644);
	assert.equal(statSync(dir).mode & 0o777, 0o755);
	writer.publishNow();
	assert.equal(
		statSync(path).mode & 0o777,
		0o600,
		"the next write re-asserts the mode the code intends",
	);
	assert.equal(
		statSync(dir).mode & 0o777,
		0o700,
		"and the directory it lives in, which nothing else repairs",
	);
	writer.clear();
});

test("asking for the state path creates nothing", () => {
	const missing = mkdtempSync(join(tmpdir(), "lo-browser-absent-"));
	assert.ok(
		stateFilePath(missing).endsWith(join("run", "ui-browser", "host.json")),
	);
	assert.deepEqual(
		readdirSync(missing),
		[],
		"path arithmetic alone must not create the directory (the bridge's ENOSPC lesson)",
	);
	rmSync(missing, { recursive: true, force: true });
});

// ---- the loopback RPC ------------------------------------------------------

test("the listener answers only with the key, and never with CORS headers", async () => {
	const unauthorized = await post(
		{ id: "1", method: "status", params: {} },
		{ key: null },
	);
	assert.equal(unauthorized.status, 401);
	const wrong = await post(
		{ id: "1", method: "status", params: {} },
		{ key: "nope" },
	);
	assert.equal(wrong.status, 401);
	assert.equal(
		wrong.headers.get("access-control-allow-origin"),
		null,
		"no CORS header: this is what stops the app's own renderer reaching this port",
	);
	const good = await post({ id: "abc", method: "status", params: {} });
	assert.equal(good.status, 200);
	assert.deepEqual(good.json, { id: "abc", ok: true, result: { ok: true } });
	assert.equal(good.headers.get("access-control-allow-origin"), null);
	// A preflight for the same path is not answered with CORS permissions either;
	// the app's renderer uses `webSecurity: true`, so the browser enforces this.
	const preflight = await fetch(rpcUrl(), { method: "OPTIONS" });
	assert.equal(preflight.headers.get("access-control-allow-origin"), null);
	assert.notEqual(preflight.status, 200);
});

test("the listener binds loopback only, and nothing else on this machine can reach it", async () => {
	// Design 11.7 rule 1, and the only one of the four rules that had NO assertion
	// anywhere: mutating the bind to `0.0.0.0` left the whole suite at 40 pass / 0
	// fail (R3). An agent-driving endpoint on every interface is a remote-control
	// surface for the operator's authenticated jar, so the address the OS resolved
	// is asserted here rather than left to a reader of `rpc.ts`.
	assert.equal(
		server.address,
		"127.0.0.1",
		"the resolved bind address, not the argument the code passed",
	);

	// The refusal is measured, not inferred: connect to a NON-loopback address of
	// this machine. A host with no non-loopback IPv4 (a container, a machine with
	// only lo up) cannot run this probe, and says so rather than passing silently.
	const lan = Object.values(networkInterfaces())
		.flat()
		.find((entry) => entry && entry.family === "IPv4" && !entry.internal);
	if (!lan) {
		// eslint-disable-next-line no-console
		console.error(
			"NOTE: no non-loopback IPv4 on this machine, so the off-host refusal was not measured here",
		);
		return;
	}
	const refused = await new Promise((resolve) => {
		const socket = connect({
			host: lan.address,
			port: server.port,
			timeout: 2_000,
		});
		socket.once("connect", () => {
			socket.destroy();
			resolve("CONNECTED");
		});
		socket.once("error", (error) => resolve(error.code ?? String(error)));
		socket.once("timeout", () => {
			socket.destroy();
			resolve("TIMEOUT");
		});
	});
	assert.notEqual(
		refused,
		"CONNECTED",
		`a connection to ${lan.address}:${server.port} must be refused (got ${refused})`,
	);
});

test("malformed envelopes are refused at the boundary, not half-interpreted", async () => {
	const unknownMethod = await post({ id: "1", method: "teleport", params: {} });
	assert.equal(unknownMethod.status, 422);
	const badBody = await post("{not json");
	assert.equal(badBody.status, 422);
	const extraField = await post({
		id: "1",
		method: "status",
		params: {},
		extra: true,
	});
	assert.equal(
		extraField.status,
		422,
		"an unknown envelope field is refused (extra=forbid)",
	);
	const arrayBody = await post([]);
	assert.equal(arrayBody.status, 422);
	const missingId = await post({ method: "status", params: {} });
	assert.equal(missingId.status, 422);
	const badParams = await post({ id: "1", method: "status", params: 7 });
	assert.equal(badParams.status, 422);
});

test("a dispatched failure comes back as the typed error arm, and an unknown code is downgraded", async () => {
	const response = await post({
		id: "9",
		method: "read",
		params: { tab: "ui:1:x" },
	});
	assert.equal(
		response.status,
		200,
		"a command failure is a 200 with an error arm",
	);
	assert.equal(response.json.ok, false);
	assert.equal(response.json.id, "9");
	assert.ok(
		ERROR_CODES.includes(response.json.error.code),
		`the code is one the session knows: ${response.json.error.code}`,
	);
});

test("health identifies the process without the key, and only the process", async () => {
	const response = await fetch(rpcUrl("/health"));
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.deepEqual(body, {
		host: "ui",
		proto: PROTO_VERSION,
		pid: process.pid,
	});
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	const wrongPath = await post(
		{ id: "1", method: "status", params: {} },
		{ path: "/" },
	);
	assert.equal(wrongPath.status, 404);
});

test("the key comparison is length-safe and exact", () => {
	assert.equal(keysMatch(sessionKey, sessionKey), true);
	assert.equal(keysMatch(sessionKey.slice(0, -1), sessionKey), false);
	assert.equal(keysMatch(`${sessionKey}x`, sessionKey), false);
	assert.equal(keysMatch(undefined, sessionKey), false);
	assert.equal(keysMatch(1234, sessionKey), false);
});

// ---- the tab registry ------------------------------------------------------

test("an agent tab never becomes the active tab, and a user tab does", () => {
	const { registry, views } = makeRegistry();
	const user = registry.create({ owner: "user" });
	assert.equal(
		registry.activeTab?.tabId,
		user.tabId,
		"a user tab is what the user is looking at",
	);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	assert.equal(
		registry.activeTab?.tabId,
		user.tabId,
		"an agent open must not steal the active tab (design 11.4)",
	);
	// Only the ACTIVE tab is visible; the background one keeps its own bounds but
	// paints nothing, which is what stops an agent's page covering the app's UI.
	registry.setContentRect({ x: 0, y: 0, width: 800, height: 600 });
	assert.equal(views.get(user.tabId)?.visibility.at(-1), true);
	assert.equal(views.get(agent.tabId)?.visibility.at(-1), false);
	assert.equal(views.get(user.tabId)?.bounds.at(-1)?.width, 800);
	registry.setViewVisible(false);
	assert.equal(
		views.get(user.tabId)?.visibility.at(-1),
		false,
		"an overlay hides the view",
	);
	registry.activate(agent.tabId);
	assert.equal(registry.activeTab?.tabId, agent.tabId);
});

test("agent tabs are capped at eight and user tabs are not capped at all", () => {
	const { registry } = makeRegistry();
	for (let index = 0; index < MAX_AGENT_TABS; index += 1) {
		registry.create({ owner: "agent", sessionId: `session:${index}` });
	}
	assert.throws(
		() => registry.create({ owner: "agent", sessionId: "session:9" }),
		(error) => error.code === "tab_limit",
		"a ninth agent tab is refused with the tool's own code",
	);
	for (let index = 0; index < 20; index += 1)
		registry.create({ owner: "user" });
	assert.equal(registry.agentTabCount(), MAX_AGENT_TABS);
	assert.equal(registry.count(), MAX_AGENT_TABS + 20);
});

test("the handle is the capability: a wrong or stale nonce is refused", () => {
	const { registry } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	const token = surfaceToken(agent);
	assert.ok(
		token && /^ui:1:[0-9a-f]{32}$/.test(token),
		`token shape: ${token}`,
	);
	assert.equal(registry.requireSurface(token).tabId, agent.tabId);
	const parsed = parseSurface(token);
	assert.ok(parsed);
	// A one-character-short nonce parses as a handle and fails the nonce check.
	assert.throws(
		() =>
			registry.requireSurface(`ui:${agent.tabId}:${parsed.nonce.slice(0, -1)}`),
		(error) =>
			error.code === "tab_closed" && error.data.reason === "unknown_handle",
	);
	// A guessed nonce for a real tab is refused identically to a missing tab.
	assert.throws(
		() => registry.requireSurface(`ui:${agent.tabId}:${"0".repeat(32)}`),
		(error) =>
			error.code === "tab_closed" && error.data.reason === "unknown_handle",
	);
	assert.throws(
		() => registry.requireSurface("ui:999:deadbeef"),
		(error) => error.code === "tab_closed",
	);
	assert.throws(
		() => registry.requireSurface("bridge:1:abc"),
		(error) =>
			error.code === "tab_closed" && error.data.reason === "malformed_handle",
	);
});

test("a user tab has no capability until it is handed over, and revoking removes it", () => {
	const { registry } = makeRegistry();
	const user = registry.create({ owner: "user" });
	assert.equal(
		surfaceToken(user),
		null,
		"no nonce, so nothing to address it by",
	);
	// The session is stored BARE, whatever spelling the caller hands over.
	registry.handOver(user.tabId, "session:b");
	const token = surfaceToken(user);
	assert.ok(token, "the hand-over mints the capability");
	assert.equal(registry.requireSurface(token).tabId, user.tabId);
	assert.equal(
		user.sessionId,
		"b",
		"the stored identity is the bare session id",
	);
	assert.equal(registry.mayDrive(user, "b"), true);
	assert.equal(registry.mayDrive(user, "c"), false);
	registry.revokeHandOver(user.tabId);
	assert.equal(surfaceToken(user), null);
	assert.throws(
		() => registry.requireSurface(token),
		(error) => error.code === "tab_closed",
		"the revoked handle fails, and the session's recovery is open",
	);
});

test("a restored tab is the user's, with no capability, whatever it was before", () => {
	const { registry } = makeRegistry();
	const restored = registry.create({
		owner: "agent",
		sessionId: "session:a",
		restored: true,
	});
	assert.equal(
		restored.owner,
		"user",
		"an agent does not silently reclaim a restored tab",
	);
	assert.equal(restored.nonce, null);
	assert.equal(surfaceToken(restored), null);
	assert.equal(restored.restored, true);
});

test("a dead view fails closed and the record is dropped", () => {
	const { registry, views } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	const token = surfaceToken(agent);
	views.get(agent.tabId)?.webContents.close();
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "tab_closed" && error.data.reason === "view_destroyed",
	);
	assert.equal(registry.count(), 0, "the record is gone, not a phantom handle");
});

test("destroying a tab releases its webContents exactly once, through the one removal path", () => {
	const { registry, views, removed } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	registry.destroy(agent.tabId);
	assert.equal(views.size, 1);
	assert.deepEqual(removed, [
		{
			tabId: agent.tabId,
			webContentsId: views.get(agent.tabId)?.webContents.id,
		},
	]);
	registry.destroy(agent.tabId);
	assert.equal(
		removed.length,
		1,
		"a second destroy is a no-op, not a second release",
	);
});

test("two commands on one tab do not interleave: the second reads busy", async () => {
	const { registry } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	let release = () => {};
	const first = registry.lane(
		agent.tabId,
		() =>
			new Promise((resolve) => {
				release = () => resolve("first");
			}),
	);
	await assert.rejects(
		() => registry.lane(agent.tabId, async () => "second"),
		(error) => error.code === "busy",
		"a busy tab refuses rather than queueing silently",
	);
	release();
	assert.equal(await first, "first");
	assert.equal(await registry.lane(agent.tabId, async () => "third"), "third");
});

test("a navigation epoch makes the refs taken before it unusable", () => {
	const { registry } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	agent.refs = { e1: { backendNodeId: 7, epoch: agent.epoch } };
	const before = agent.epoch;
	registry.bumpEpoch(agent.tabId);
	assert.equal(agent.epoch, before + 1);
	// The ref survives so the refusal can say WHY, but it no longer matches the
	// tab's epoch, which is what `resolveNode` checks before pushing a node id.
	assert.equal(agent.refs.e1.epoch, before);
	assert.notEqual(agent.refs.e1.epoch, agent.epoch);
});

test("redaction keeps a caller's own handle recognisable and nobody else's", () => {
	const token = "ui:3:abcdef1234567890abcdef1234567890";
	const redacted = redactToken(token);
	assert.equal(redacted, "ui:3:abcdef…");
	assert.equal(ownsRedacted(token, redacted), true);
	assert.equal(
		ownsRedacted("ui:3:9999991234567890abcdef1234567890", redacted),
		false,
	);
	assert.equal(ownsRedacted(token, token), true);
});

test("the driver gives a brand-new view a document before it arms the debugger", async () => {
	// Measured on Electron 44: a fresh WebContents has no renderer process, and CDP
	// commands to it never get a reply — `Runtime.enable` on a view that has never
	// navigated timed out at 8s and answered only once a load happened. So `attach`
	// must navigate to about:blank first, and this test fails if that ever goes away.
	const { CdpPool } = await import(
		`data:text/javascript;base64,${Buffer.from(
			(
				await build({
					stdin: {
						contents: 'export * from "./src/main/browser/cdp";',
						resolveDir: process.cwd(),
					},
					bundle: true,
					format: "esm",
					platform: "node",
					write: false,
				})
			).outputFiles[0].text,
		).toString("base64")}`
	);
	const pool = new CdpPool();
	const contents = new FakeWebContents(500);
	// A fresh WebContents reports an EMPTY url until its first navigation; that is
	// the signal `attach` keys on.
	contents.url = "";
	// The ledger the fake debugger keeps: which command arrived first.
	let firstCommandBeforeLoad = null;
	const order = [];
	const originalLoad = contents.loadURL.bind(contents);
	contents.loadURL = async (url) => {
		order.push(`load:${url}`);
		return originalLoad(url);
	};
	contents.debugger.sendCommand = async (method) => {
		order.push(`cdp:${method}`);
		if (
			!order
				.slice(0, order.indexOf(`cdp:${method}`))
				.some((entry) => entry.startsWith("load:"))
		) {
			firstCommandBeforeLoad = method;
		}
		return {};
	};
	await pool.attach(contents);
	assert.equal(
		firstCommandBeforeLoad,
		null,
		"no CDP command was sent before the view had a document",
	);
	assert.ok(
		order.some((entry) => entry === "load:about:blank"),
		`order: ${order.join(", ")}`,
	);
	assert.ok(
		order.includes("cdp:Runtime.enable") && order.includes("cdp:Log.enable"),
	);
});

// ---- the origin gate -------------------------------------------------------

test("nothing is reachable by default, and a decision is what opens it", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-a") });
	const url = safeHttpUrl("https://example.com/page");
	assert.equal(store.originAllowed(url), false);
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:a"),
		(error) =>
			error.code === "origin_not_allowed" && error.data.reason === "unapproved",
	);
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	assert.equal(pending.state, "pending");
	assert.equal(store.pendingEntries().length, 1);
	const decided = store.respond(pending.entry_id, "site");
	assert.equal(decided.state, "allowed");
	assert.equal(store.originAllowed(url), true);
	assert.equal(store.ensureTopLevelAccess(url, "session:a").allowed, true);
	assert.equal(
		store.pendingEntries().length,
		0,
		"the answered request is no longer pending",
	);
});

// The two tests below are the BROAD-grant half of the gate. Every other
// assertion in this file grants the exact origin, which is exactly how the
// vendored `storedOriginAllowed(origins, url, hostGrants?, siteGrants?)` came to
// be called with `siteGrants` in the third slot: the call still compiled (the
// slot is `unknown` and optional), the stored grant was still counted by
// `status`, and nothing here asked the gate a question the bug could answer
// differently.

test('a stored loopback "host" grant opens the gate, so the user is not asked twice', () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-host-grant") });
	const url = safeHttpUrl("http://127.0.0.1:54321/page");
	const entry = store.requestAccess(url.href, "session:a", "async", "req-1");
	assert.deepEqual(
		entry.broad,
		{ scope: "host", key: "127.0.0.1" },
		"loopback gets the host option",
	);
	assert.equal(store.respond(entry.entry_id, "domain").scope, "host");
	assert.equal(
		store.describe().broad_grants,
		1,
		"the user's answer WAS stored",
	);
	assert.equal(store.originAllowed(url), true, "and the gate has to honour it");
	assert.equal(store.ensureTopLevelAccess(url, "session:a").allowed, true);
	// A host grant is host-wide by definition: another port of the same loopback
	// host is covered, so a second session is answered from the grant rather than
	// being handed `{"state":"none"}` and a fresh prompt.
	const anotherPort = safeHttpUrl("http://127.0.0.1:59999/");
	assert.equal(store.originAllowed(anotherPort), true);
	assert.equal(
		store.accessStateFor(anotherPort.href, "session:b").state,
		"allowed",
		"no re-prompt",
	);
	// Host-wide, not blanket: an unrelated origin is still refused.
	assert.equal(store.originAllowed(safeHttpUrl("https://example.com/")), false);
	assert.throws(
		() =>
			store.ensureTopLevelAccess(
				safeHttpUrl("https://example.com/"),
				"session:b",
			),
		(error) => error.code === "origin_not_allowed",
	);
});

test('a stored broad "domain" grant opens the whole registrable domain, and only it', () => {
	configurePslRules("com\n");
	try {
		const store = new ApprovalStore({
			dir: join(root, "approvals-domain-grant"),
		});
		const url = safeHttpUrl("https://news.example.com/story");
		const entry = store.requestAccess(url.href, "session:a", "async", "req-1");
		assert.deepEqual(entry.broad, { scope: "domain", key: "example.com" });
		assert.equal(store.respond(entry.entry_id, "domain").scope, "domain");
		assert.equal(store.originAllowed(url), true);
		// The sibling host is the whole point of a domain grant.
		const sibling = safeHttpUrl("https://shop.example.com/");
		assert.equal(store.originAllowed(sibling), true);
		assert.equal(
			store.ensureTopLevelAccess(sibling, "session:a").allowed,
			true,
		);
		assert.equal(
			store.accessStateFor(sibling.href, "session:b").state,
			"allowed",
		);
		// A different registrable domain is not covered by it.
		const unrelated = safeHttpUrl("https://example.org/");
		assert.equal(store.originAllowed(unrelated), false);
		assert.throws(
			() => store.ensureTopLevelAccess(unrelated, "session:a"),
			(error) => error.code === "origin_not_allowed",
		);
	} finally {
		configurePslRules(null);
	}
});

test("a one-shot grant is spendable once, by the requester who earned it", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-once") });
	const url = safeHttpUrl("https://once.example/");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(pending.entry_id, "once");
	assert.equal(store.ensureTopLevelAccess(url, "session:a").viaOnceGrant, true);
	assert.equal(
		store.originAllowed(url),
		false,
		"a one-shot grant is not a stored grant",
	);
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:a"),
		(error) => error.code === "origin_not_allowed",
		"and it is spent, not renewable",
	);
});

test("a one-shot grant is not spendable by another session", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-bind") });
	const url = safeHttpUrl("https://bound.example/");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(pending.entry_id, "once");
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:b"),
		(error) => error.code === "origin_not_allowed",
		"one approval is not a fleet-wide permission",
	);
	// The other session also reads the pending state as none, not allowed.
	assert.equal(store.accessStateFor(url.href, "session:b").state, "none");
});

test("a denial is durable and stops the re-prompt", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-deny") });
	const url = safeHttpUrl("https://denied.example/");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(pending.entry_id, "deny");
	const again = store.requestAccess(url.href, "session:a", "async", "req-2");
	assert.equal(
		again.state,
		"denied",
		"the user just said no; do not re-prompt on retry",
	);
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:a"),
		(error) =>
			error.code === "origin_not_allowed" && error.data.reason === "denied",
	);
	assert.equal(store.describe().denied_origins, 1);
});

test("a request displaced by another session's prompt is superseded, not silently forgotten", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-supersede") });
	const first = store.requestAccess(
		"https://a.example/",
		"session:a",
		"async",
		"req-1",
	);
	store.requestAccess("https://b.example/", "session:b", "async", "req-2");
	assert.equal(
		store.pendingEntries().length,
		1,
		"one prompt slot, replace-don't-queue",
	);
	assert.equal(
		store.accessStateFor("https://a.example/", "session:a").state,
		"superseded",
	);
	assert.equal(
		store.accessStateFor("https://a.example/", "session:c").state,
		"none",
		"a third session gets the neutral answer, not someone else's receipt",
	);
	assert.ok(first.entry_id);
});

test("cancelling removes only the caller's own entry", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-cancel") });
	const entry = store.requestAccess(
		"https://c.example/",
		"session:a",
		"async",
		"req-1",
	);
	assert.equal(
		store.cancelAccess("https://c.example/", "session:b").state,
		"none",
	);
	assert.equal(
		store.pendingEntries().length,
		1,
		"another session's cancel did nothing",
	);
	assert.equal(
		store.cancelAccess("https://c.example/", "session:a").state,
		"cancelled",
	);
	assert.equal(store.pendingEntries().length, 0);
	assert.ok(entry.entry_id);
});

test("an answered request that is no longer pending cannot be answered again", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-stale") });
	const entry = store.requestAccess(
		"https://d.example/",
		"session:a",
		"async",
		"req-1",
	);
	assert.equal(store.respond(entry.entry_id, "site").state, "allowed");
	assert.throws(
		() => store.respond(entry.entry_id, "deny"),
		(error) => error.code === "internal",
		"a stale answer fails rather than granting whatever is pending now",
	);
});

test("revoking every approval leaves no grant and no pending entry", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-revoke") });
	const entry = store.requestAccess(
		"https://e.example/",
		"session:a",
		"async",
		"req-1",
	);
	store.respond(entry.entry_id, "site");
	assert.equal(store.grants().length, 1);
	const removed = store.revokeAll();
	assert.equal(removed, 1);
	assert.equal(store.originAllowed(safeHttpUrl("https://e.example/")), false);
	assert.equal(store.describe().allowed_origins, 0);
});

test("the broad-domain scope is unavailable — not silently wrong — without the suffix list", () => {
	configurePslRules(null);
	assert.equal(domainScopeAvailable(), false);
	assert.equal(
		registrableDomain(safeHttpUrl("https://news.example.co.uk/")),
		null,
	);
	const store = new ApprovalStore({ dir: join(root, "approvals-psl") });
	const entry = store.requestAccess(
		"https://news.example.co.uk/",
		"session:a",
		"async",
		"r",
	);
	assert.equal(
		entry.broad,
		undefined,
		"no domain option is offered without rules",
	);
	assert.throws(
		() => store.respond(entry.entry_id, "domain"),
		(error) => error.code === "internal",
		"and a broad decision that was never offerable is refused rather than widened",
	);
	// With rules installed, the same call computes the registrable domain.
	configurePslRules("co.uk\ncom\n");
	assert.equal(domainScopeAvailable(), true);
	assert.equal(
		registrableDomain(safeHttpUrl("https://news.example.co.uk/")),
		"example.co.uk",
	);
	configurePslRules(null);
});

// ---- the ownership fence ---------------------------------------------------

test("the ownership fence refuses a stale generation and replays a lost open", async () => {
	const ledger = new OwnershipLedger({
		closeTab: async () => true,
		isLive: (token) => token === "ui:1:aaa",
	});
	const params = {
		requester: "session:a",
		owner_proof: "p".repeat(32),
		owner_generation: "gen-1",
		allocation_id: "alloc-1",
	};
	// Unresolved: not an error, an answer.
	assert.deepEqual(
		await ledger.withOwnership("owner_recover", params, async () => ({})),
		{
			ownership_version: 1,
			state: "unresolved",
		},
	);
	let opened = 0;
	await ledger.withOwnership(
		"open",
		{ ...params, url: "https://example.com/" },
		async () => {
			opened += 1;
			ledger.recordAllocation(
				{ ...params, tab: "ui:1:aaa" },
				"ui:1:aaa",
				"allocated",
			);
			return { tab: "ui:1:aaa" };
		},
	);
	assert.equal(opened, 1);
	// A lost response is replayed by allocation id rather than creating a second tab.
	const replay = await ledger.withOwnership(
		"open",
		{ ...params, url: "https://example.com/" },
		async () => {
			opened += 1;
			return {};
		},
	);
	assert.equal(replay.replayed, true);
	assert.equal(opened, 1, "no second tab was opened");
	assert.equal(replay.tab, "ui:1:aaa");
	// Another PROOF is another owner, not an intruder: it gets its own empty scope
	// rather than a refusal or a view of this one.
	const stranger = await ledger.withOwnership(
		"tabs",
		{ ...params, owner_proof: "q".repeat(32) },
		async () => ({ tabs: "mine" }),
	);
	assert.deepEqual(stranger, { tabs: "mine" });
	// The SAME proof with a different session is refused.
	await assert.rejects(
		() =>
			ledger.withOwnership(
				"tabs",
				{ ...params, requester: "session:someone-else" },
				async () => ({}),
			),
		(error) => error.code === "owner_refused",
	);
	// A stale generation is refused.
	await assert.rejects(
		() =>
			ledger.withOwnership(
				"tabs",
				{ ...params, owner_generation: "gen-9" },
				async () => ({}),
			),
		(error) => error.code === "owner_refused",
	);
	// A missing or malformed proof is refused rather than degrading to legacy.
	await assert.rejects(
		() =>
			ledger.withOwnership(
				"tabs",
				{ ...params, owner_proof: "short" },
				async () => ({}),
			),
		(error) => error.code === "owner_refused",
	);
});

test("retain outlives a finish, and a terminal scope refuses everything but close and tabs", async () => {
	const ledger = new OwnershipLedger({
		closeTab: async () => true,
		isLive: () => true,
	});
	const params = {
		requester: "session:a",
		owner_proof: "p".repeat(32),
		owner_generation: "gen-1",
		allocation_id: "alloc-1",
	};
	await ledger.withOwnership(
		"owner_retain",
		{ ...params, reason: "waiting on a build" },
		async () => ({}),
	);
	assert.deepEqual(
		await ledger.withOwnership("owner_finish", params, async () => ({})),
		{
			state: "retained",
		},
	);
	assert.deepEqual(
		await ledger.withOwnership("owner_release", params, async () => ({})),
		{
			state: "released",
			terminal: "completed",
		},
	);
	await assert.rejects(
		() => ledger.withOwnership("goto", params, async () => ({})),
		(error) => error.code === "owner_refused",
		"a finished scope cannot navigate",
	);
	assert.deepEqual(
		await ledger.withOwnership("tabs", params, async () => ({ tabs: [] })),
		{
			tabs: [],
		},
	);
	// Retention without a bounded reason is refused: the reason is what a human
	// later reads to decide whether the tab may be closed.
	await assert.rejects(
		() =>
			ledger.withOwnership(
				"owner_retain",
				{ ...params, reason: "" },
				async () => ({}),
			),
		(error) => error.code === "owner_refused",
	);
});

// ---- the dispatcher, with a fake browser -----------------------------------

function makeHost(overrides = {}) {
	const { registry, views } = makeRegistry();
	const cdp = {
		attach: async () => {},
		send: async (_contents, method, params) => {
			// Recorded so a test can assert WHICH capture the driver asked for: the
			// two paths differ only in this flag, so the flag is the contract.
			cdp.calls.push({ method, params });
			if (method === "Accessibility.getFullAXTree") {
				return {
					nodes: [
						{
							nodeId: "1",
							role: { value: "button" },
							name: { value: "Submit" },
							backendDOMNodeId: 42,
						},
					],
				};
			}
			if (method === "Page.captureScreenshot") return { data: "iVBORw0KGgo=" };
			return {};
		},
		calls: [],
		subscribe: () => () => {},
		detach: async () => {},
		forget: () => {},
		close: async () => {},
	};
	const approvals = new ApprovalStore({
		dir: join(root, `approvals-host-${Math.random()}`),
	});
	const ownership = new OwnershipLedger({
		closeTab: async (token) => {
			registry.destroy(registry.requireSurface(token).tabId);
			return true;
		},
		isLive: (token) => {
			try {
				registry.requireSurface(token);
				return true;
			} catch {
				return false;
			}
		},
		mayAdopt: (token, requester) => {
			const record = registry.requireSurface(token);
			return (
				record.handedTo === requester.slice("session:".length) &&
				!record.allocationId
			);
		},
	});
	const host = new BrowserHost({
		registry,
		cdp,
		approvals,
		ownership,
		log: () => {},
		onChanged: () => {},
		facts: () => ({
			proto: PROTO_VERSION,
			appVersion: "0.21.0",
			profileDir: "/scratch",
			profilePersistent: true,
			userAgent: "test",
			domainScope: false,
		}),
		...overrides,
	});
	return { host, registry, views, approvals, cdp };
}

test("real dispatcher records allocation, fences peers, recovers and finishes exactly its tab", async () => {
	const { host, registry } = makeHost();
	const owner = {
		requester: "session:alice",
		owner_proof: "a".repeat(40),
		owner_generation: "g1",
		allocation_id: "allocation-a",
	};
	const url = "https://approved.example/";
	await host.dispatch("request_access", { ...owner, url }, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", { ...owner, url }, "open");
	assert.equal(
		(await host.dispatch("read", { ...owner, tab: opened.tab }, "read")).url,
		url,
	);
	assert.equal(
		(await host.dispatch("open", { ...owner, url }, "retry")).tab,
		opened.tab,
	);
	assert.equal(registry.count(), 1);
	await assert.rejects(
		() =>
			host.dispatch(
				"read",
				{ ...owner, owner_generation: "stale", tab: opened.tab },
				"stale",
			),
		{ code: "owner_refused" },
	);
	await assert.rejects(
		() =>
			host.dispatch(
				"read",
				{ ...owner, requester: "session:bob", tab: opened.tab },
				"peer",
			),
		{ code: "owner_refused" },
	);
	assert.equal(
		(await host.dispatch("owner_recover", owner, "recover")).tab,
		opened.tab,
	);
	assert.equal(
		(await host.dispatch("owner_finish", owner, "finish")).state,
		"closed",
	);
	assert.equal(registry.count(), 0);
	assert.equal(
		(await host.dispatch("owner_finish", owner, "finish-retry")).state,
		"closed",
	);
});

test("current unapproved document refuses every driven read and input after autonomous navigation", async () => {
	const { host, registry } = makeHost();
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	registry.requireSurface(opened.tab).view.webContents.url =
		"https://forbidden.example/";
	for (const method of [
		"read",
		"snapshot",
		"screenshot",
		"click",
		"type",
		"scroll",
		"logs",
	]) {
		await assert.rejects(
			() =>
				host.dispatch(
					method,
					{ ...params, tab: opened.tab, selector: "input", text: "private" },
					method,
				),
			{ code: "origin_not_allowed" },
		);
	}
});

test("a document round trip cannot return the unapproved document's text", async () => {
	// Review round 1, R4: entry and return each compare only the URL CURRENT at
	// that instant, so a page that leaves for an unapproved origin and comes
	// straight back is invisible to both while the result in hand came from the
	// other document. The epoch is the fact that proves "the same document
	// throughout", so the call is held to the one it started on.
	const { host, registry } = makeHost();
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	assert.equal(
		(await host.dispatch("read", { ...params, tab: opened.tab }, "ok")).url,
		"https://approved.example/",
	);

	// The page leaves and comes back while the read's own isolated-world call is
	// in flight: at the return check the URL is the approved one again.
	record.view.webContents.executeJavaScriptInIsolatedWorld = async () => {
		record.view.webContents.url = "https://forbidden.example/";
		registry.bumpEpoch(record.tabId);
		record.view.webContents.url = "https://approved.example/";
		return "FORBIDDEN-SECRET-MARKER";
	};
	await assert.rejects(
		() => host.dispatch("read", { ...params, tab: opened.tab }, "round-trip"),
		(error) =>
			error.code === "origin_not_allowed" && error.data.reason === "changed",
	);
});

/**
 * Arm the three DOM answers a `click` needs, and let the caller reproduce what
 * Electron does once the click's own handler has run and the navigation it
 * started commits: the document moves and `did-navigate` bumps the tab's epoch.
 * Those two facts are the ones the guard has to tell apart from a navigation the
 * PAGE started on its own.
 */
function installClickFixture(cdp, onNavigate) {
	const answers = {
		"DOM.getDocument": { root: { nodeId: 1 } },
		"DOM.querySelector": { nodeId: 2 },
		"DOM.resolveNode": { object: { objectId: "obj-1" } },
	};
	const send = cdp.send;
	cdp.send = async (contents, method, params) => {
		if (method in answers) {
			cdp.calls.push({ method, params });
			return answers[method];
		}
		if (
			method === "Runtime.callFunctionOn" &&
			String(params?.functionDeclaration ?? "").includes("pointerover")
		) {
			onNavigate();
		}
		return send(contents, method, params);
	};
}

test("a click that follows an approved link reports the page it landed on", async () => {
	// QA round 2, Q2. `click` and `type` are document-scoped AND the actions that
	// navigate, so a link-following click bumps the very `documentEpoch` the guard
	// compared against: every such click on an approved origin was refused with
	// `reason:"changed"` while the page had in fact navigated. The baseline follows
	// the action's own navigation, and the document it landed on is authorized in
	// place of the one it left.
	const { host, cdp, registry } = makeHost();
	const params = {
		url: "https://approved.example/sameonly",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	installClickFixture(cdp, () => {
		record.view.webContents.url = "https://approved.example/next";
		registry.bumpEpoch(record.tabId);
	});
	const result = await host.dispatch(
		"click",
		{ ...params, tab: opened.tab, selector: "#gosame" },
		"click",
	);
	assert.equal(result.navigated, true, "the navigation was not reported");
	assert.equal(
		result.url,
		"https://approved.example/next",
		"the result did not describe the page the click landed on",
	);
});

test("a form submit on the approved origin reports the page it landed on", async () => {
	// The same defect through the form path QA measured (`type` into a field, then
	// click the submit control): the submit is the click's own navigation.
	const { host, cdp, registry } = makeHost();
	const params = {
		url: "https://approved.example/sameform",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	installClickFixture(cdp, () => {
		record.view.webContents.url = "https://approved.example/after?q=qa";
		registry.bumpEpoch(record.tabId);
	});
	const typed = await host.dispatch(
		"type",
		{ ...params, tab: opened.tab, selector: "#q", text: "qa" },
		"type",
	);
	assert.equal(typed.url, "https://approved.example/sameform");
	const submitted = await host.dispatch(
		"click",
		{ ...params, tab: opened.tab, selector: "#fsubsame" },
		"submit",
	);
	assert.equal(submitted.navigated, true, "the submit was not reported");
	assert.equal(submitted.url, "https://approved.example/after?q=qa");
});

test("a click that would reach an unapproved origin fails the hop before it is fetched", async () => {
	// The refusal half of the same cut, and the one thing that must not change:
	// adopting the landing document is not an exemption from authorizing it. The
	// per-hop gate fails the Document request before it leaves, so nothing reaches
	// the unapproved origin and the document the result describes is still the
	// authorized one. (The envelope for a hop the gate refused is whatever the gate
	// produced before this guard existed — `withOriginGate` only re-labels an
	// error — so this test pins the mechanism and the state, not a code that the
	// action was already answering.)
	const { host, cdp, registry } = makeHost();
	// The gate subscribes per webContents; holding the handler is how the test
	// drives the hop a real page would attempt.
	let hop = null;
	cdp.subscribe = (_contentsId, handler) => {
		hop = handler;
		return () => {
			hop = null;
		};
	};
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	installClickFixture(cdp, () => {
		assert.ok(hop, "the navigation gate was not armed around the click");
		hop("Fetch.requestPaused", {
			requestId: "hop-1",
			request: { url: "https://forbidden.example/" },
		});
	});
	const result = await host.dispatch(
		"click",
		{ ...params, tab: opened.tab, selector: "#escape" },
		"click",
	);
	const failed = cdp.calls.filter(
		(call) => call.method === "Fetch.failRequest",
	);
	assert.equal(failed.length, 1, "the refused hop was not failed");
	assert.equal(failed[0].params.requestId, "hop-1");
	assert.equal(failed[0].params.errorReason, "BlockedByClient");
	assert.deepEqual(
		cdp.calls.filter(
			(call) =>
				call.method === "Fetch.continueRequest" &&
				call.params.requestId === "hop-1",
		),
		[],
		"the unapproved hop was allowed to reach its origin",
	);
	assert.equal(
		record.view.webContents.url,
		"https://approved.example/",
		"the refused hop navigated anyway",
	);
	assert.equal(
		result.url,
		"https://approved.example/",
		"the result described a document the action was not authorized for",
	);
});

test("a click whose document lands on an unapproved origin still fails the result check", async () => {
	// The other half of the same cut, and the reason adopting the epoch is not a
	// blanket pass: if the document the result comes from is not authorized, the
	// result is refused — by the same check that refuses a read on that page.
	const { host, cdp, registry } = makeHost();
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	installClickFixture(cdp, () => {
		record.view.webContents.url = "https://forbidden.example/";
		registry.bumpEpoch(record.tabId);
	});
	await assert.rejects(
		() =>
			host.dispatch(
				"click",
				{ ...params, tab: opened.tab, selector: "#escape" },
				"click",
			),
		(error) =>
			error.code === "origin_not_allowed" &&
			error.data.reason === "unapproved",
	);
});

test("a document change under any non-navigating action discards its result", async () => {
	// QA round 2 measured that the epoch guard was covered for `read` only, and
	// that gap is why a blocker inside it passed the suite. The page's own round
	// trip (review round 1, R4) is replayed for every member of the family, at the
	// one point they all pass through — `perform` — so the hook is the action's own
	// in-flight window rather than one action's implementation detail.
	const { host, registry } = makeHost();
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	const record = registry.requireSurface(opened.tab);
	record.view.webContents.isolatedResult = "hello";
	// `screenshot` refuses a zero-area view before it captures anything, so the
	// view needs the page area the app's chrome reports in a real run.
	record.view.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
	const perform = host.perform.bind(host);
	host.perform = async (method, methodParams, requestId) => {
		const result = await perform(method, methodParams, requestId);
		// The page leaves for an unapproved origin and returns, leaving an approved
		// URL for the result check to see — the shape a URL-only check cannot catch.
		record.view.webContents.url = "https://forbidden.example/";
		registry.bumpEpoch(record.tabId);
		record.view.webContents.url = "https://approved.example/";
		return result;
	};
	for (const [method, extra] of [
		["read", { selector: "body" }],
		["snapshot", {}],
		["screenshot", {}],
		["scroll", { direction: "down" }],
		["logs", {}],
	]) {
		await assert.rejects(
			() =>
				host.dispatch(
					method,
					{ ...params, tab: opened.tab, ...extra },
					method,
				),
			(error) =>
				error.code === "origin_not_allowed" &&
				error.data.reason === "changed",
			`${method} returned a result from a document it did not authorize`,
		);
	}
});

test("the per-hop gate is armed for the actions that can navigate, and only those", async () => {
	// Review round 1, R5, as a RULING: `Fetch.enable` intercepts the page's own
	// Document-stage loads too, so arming it around an action that cannot change
	// which document is current fails third-party frames on the page the user is
	// watching for no consent gain. It stays for the pair that navigates because
	// the PAGE decides to, and `open`/`goto` arm it from the navigation itself.
	// The two other actions are not in this list because they are not
	// document-scoped at all.
	const { host, cdp, registry } = makeHost();
	// The three DOM answers the click/type/selector-scroll paths need and the
	// shared fixture does not provide; supplying them here keeps the fixture
	// untouched for every other test.
	const answers = {
		"DOM.getDocument": { root: { nodeId: 1 } },
		"DOM.querySelector": { nodeId: 2 },
		"DOM.resolveNode": { object: { objectId: "obj-1" } },
	};
	const send = cdp.send;
	cdp.send = async (contents, method, params) => {
		if (method in answers) {
			cdp.calls.push({ method, params });
			return answers[method];
		}
		return send(contents, method, params);
	};
	const params = {
		url: "https://approved.example/",
		requester: "session:alice",
	};
	await host.dispatch("request_access", params, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "open");
	registry.requireSurface(opened.tab).view.webContents.isolatedResult = "hello";
	const armed = () =>
		cdp.calls.filter((call) => call.method === "Fetch.enable").length;
	assert.equal(armed(), 1, "the navigation armed the gate exactly once");

	const cases = [
		["read", { selector: "body" }],
		["snapshot", {}],
		["screenshot", {}],
		["scroll", { direction: "down" }],
		["logs", {}],
	];
	for (const [method, extra] of cases) {
		const before = armed();
		await host.dispatch(method, { ...params, tab: opened.tab, ...extra }, method);
		assert.equal(armed(), before, `${method} armed the navigation gate`);
	}
	for (const method of ["click", "type"]) {
		const before = armed();
		await host.dispatch(
			method,
			{ ...params, tab: opened.tab, selector: "body", text: "x" },
			method,
		);
		assert.equal(armed(), before + 1, `${method} did not arm the navigation gate`);
	}
});

test("native handover grants only its requester a fenced owner allocation", async () => {
	const { host, registry } = makeHost();
	await host.newTab();
	await host.navigateActive("https://approved.example/");
	const user = registry.activeTab;
	host.handOver(user.tabId, "alice");
	const tab = surfaceToken(user);
	const owner = {
		requester: "session:alice",
		owner_proof: "a".repeat(40),
		owner_generation: "g1",
		allocation_id: "adoption-a",
		tab,
	};
	await assert.rejects(
		() =>
			host.dispatch(
				"open",
				{ ...owner, requester: "session:bob", owner_proof: "b".repeat(40) },
				"wrong-owner",
			),
		{ code: "owner_refused" },
	);
	await assert.rejects(() => host.dispatch("open", owner, "unapproved"), {
		code: "origin_not_allowed",
	});
	await host.dispatch(
		"request_access",
		{ ...owner, url: "https://approved.example/" },
		"request",
	);
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	assert.equal((await host.dispatch("open", owner, "adopt")).tab, tab);
	assert.equal(
		(await host.dispatch("read", owner, "read")).url,
		"https://approved.example/",
	);
	assert.equal(registry.count(), 1);
	host.revokeHandOver(user.tabId);
	await assert.rejects(() => host.dispatch("read", owner, "revoked"), {
		code: "tab_closed",
	});
	assert.equal(
		(await host.dispatch("owner_finish", owner, "finish")).state,
		"closed",
	);
	assert.equal(
		registry.count(),
		1,
		"revoking handover returns the tab to the human; stale cleanup cannot close it",
	);
});

test("re-adopting a handed-over tab after an in-page navigation still reads its document", async () => {
	// Review round 1, R1: the adopt-without-URL pre-check passed `record.epoch`
	// where every writer and every other reader uses `record.documentEpoch`. Both
	// are bumped by a top-level navigation, but only `epoch` is bumped by an
	// in-page one, so after any same-document history change the two disagreed,
	// the live receipt missed, and the call fell into `admit()` — which, with the
	// once grant already spent, threw `origin_not_allowed` for a document the
	// session could still read. The field the RECEIPT was minted with is the one
	// that has to be compared, so this pins that the re-adopt keeps working.
	const { host, registry } = makeHost();
	await host.newTab();
	await host.navigateActive("https://approved.example/");
	const user = registry.activeTab;
	host.handOver(user.tabId, "alice");
	const tab = surfaceToken(user);
	const owner = {
		requester: "session:alice",
		owner_proof: "a".repeat(40),
		owner_generation: "g1",
		allocation_id: "in-page-a",
		tab,
	};
	// `request_access` carries no `tab`: it is not a surface command, and the
	// ownership gate would check the handle against an allocation that does not
	// exist until the adoption journals one.
	await host.dispatch(
		"request_access",
		{ requester: owner.requester, url: "https://approved.example/" },
		"request",
	);
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	assert.equal((await host.dispatch("open", owner, "adopt")).tab, tab);

	// An in-page navigation: `epoch` moves, `documentEpoch` does not.
	registry.bumpEpoch(registry.requireSurface(tab).tabId, false);
	assert.equal(
		(await host.dispatch("read", owner, "after-in-page")).url,
		"https://approved.example/",
	);
	assert.equal((await host.dispatch("open", owner, "re-adopt")).tab, tab);
});

test("a token that ends drops the document receipt it was granted", async () => {
	// Review round 1, N1: a receipt is bounded by the life of its TOKEN, and the
	// chrome's close and the hand-over's nonce re-mint both ended one without
	// dropping it. The store has no public reader for the map, and the property
	// under test IS "the store was told", so the drop is observed at its call.
	// The third path — a webContents that dies on its own — is the same one-line
	// call in `index.ts:wiredestroyed`, which needs Electron and so is verified by
	// reading rather than here.
	const { host, registry } = makeHost();
	await host.newTab();
	await host.navigateActive("https://approved.example/");
	const user = registry.activeTab;
	host.handOver(user.tabId, "alice");
	const tab = surfaceToken(user);
	const owner = {
		requester: "session:alice",
		owner_proof: "a".repeat(40),
		owner_generation: "g1",
		allocation_id: "drop-a",
		tab,
	};
	// `request_access` carries no `tab`: it is not a surface command, and the
	// ownership gate would check the handle against an allocation that does not
	// exist until the adoption journals one.
	await host.dispatch(
		"request_access",
		{ requester: owner.requester, url: "https://approved.example/" },
		"request",
	);
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	await host.dispatch("open", owner, "adopt");

	const dropped = [];
	const forget = host.approvals.forgetDocument.bind(host.approvals);
	host.approvals.forgetDocument = (token) => {
		dropped.push(token);
		forget(token);
	};
	// A nonce re-mint orphans the receipt the old handle was granted.
	host.revokeHandOver(user.tabId);
	assert.deepEqual(dropped, [tab], "the hand-over revocation dropped nothing");

	// And the chrome's own close button, on a tab that still holds a handle. The
	// hand-over is enough: `closeTab` drops whatever token the record holds, with
	// no allocation needed to reach the path.
	dropped.length = 0;
	await host.newTab();
	const fresh = registry.activeTab;
	host.handOver(fresh.tabId, "bob");
	const freshToken = surfaceToken(fresh);
	assert.ok(freshToken, "a handed-over tab has a handle");
	host.closeTab(fresh.tabId);
	assert.deepEqual(dropped, [freshToken], "the chrome's close dropped nothing");
});

test("allow once authorizes one requester document until the next navigation", async () => {
	const { host, registry } = makeHost();
	const owner = {
		requester: "session:alice",
		owner_proof: "a".repeat(40),
		owner_generation: "g1",
		allocation_id: "once-a",
		url: "https://approved.example/",
	};
	await host.dispatch("request_access", owner, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	const opened = await host.dispatch("open", owner, "open");
	for (const method of ["read", "snapshot", "screenshot"]) {
		await host.dispatch(
			method,
			{ ...owner, tab: opened.tab, selector: "input", text: "synthetic" },
			method,
		);
	}
	registry.bumpEpoch(registry.requireSurface(opened.tab).tabId);
	await assert.rejects(
		() => host.dispatch("read", { ...owner, tab: opened.tab }, "next-document"),
		{ code: "origin_not_allowed" },
	);
});

/*
 * THE PER-ORIGIN CONTROLS, WHICH ARE THE ONES A USER CLICKS (QA round 2, Q1).
 *
 * The title above used to be "...until navigation or revocation" and its last act
 * was `host.approvals.revokeAll()`: the bulk path, not the control the Sites sheet
 * and "Forget this site" both run. So a per-origin revoke that left an unspent
 * once grant live passed a suite whose own title said otherwise - the negative
 * control passing is what hid the hole (QA's finding, and round 2's B1). This test
 * is that claim asked of the buttons: both entry points in the host, not the store
 * directly, and the count reported back to the user is asserted too because the
 * sheet renders it.
 */
test("both per-origin controls a user clicks retire an unspent once grant", async () => {
	for (const control of ["revokeApproval", "forgetSite"]) {
		// `forgetSite` is the two-mechanism control, so the host needs the storage half:
		// recording it here also lets the log line's count be asserted rather than
		// assumed.
		const cleared = [];
		const { host } = makeHost({
			forgetSiteData: async (origin) => {
				cleared.push(origin);
			},
		});
		const owner = {
			requester: "session:alice",
			url: "https://approved.example/",
		};
		await host.dispatch("request_access", owner, "request");
		host.respondToConsent(
			host.chromeState().pendingConsent[0].entryId,
			"once",
		);
		// The grant is live but unspent, which is the state a revoke has to retire:
		// it admits the origin without ever having written a durable row.
		assert.equal(
			host.approvals.originAllowed(new URL(owner.url)),
			false,
			"a once grant leaves no durable approval behind",
		);

		const report = await host[control](owner.url);

		assert.equal(
			report.removed > 0,
			true,
			`${control} must report the authority it retired, because the sheet renders that number`,
		);
		assert.throws(
			() =>
				host.approvals.ensureTopLevelAccess(
					new URL(owner.url),
					owner.requester,
				),
			{ code: "origin_not_allowed" },
			`${control} must retire the unspent once grant, not only the durable rows`,
		);
		assert.equal(
			cleared.length,
			control === "forgetSite" ? 1 : 0,
			control === "forgetSite"
				? "forget-site clears the stored data as well as the approval"
				: "the plain revoke leaves stored data alone (design 9.4)",
		);
	}

	// The BULK control is pinned here too, because it is the limb the old test
	// exercised: removing it above must not quietly drop its coverage.
	const { host } = makeHost();
	const owner = { requester: "session:alice", url: "https://approved.example/" };
	await host.dispatch("request_access", owner, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	assert.equal(host.revokeAllApprovals().removed > 0, true);
	assert.throws(
		() =>
			host.approvals.ensureTopLevelAccess(
				new URL(owner.url),
				owner.requester,
			),
		{ code: "origin_not_allowed" },
	);
});

test("an explicit deny stops a live receipt immediately", async () => {
	// Review round 1, R2: `documentAllowed` short-circuited on `originAllowed` and
	// then accepted a matching receipt WITHOUT consulting an explicit deny, and the
	// deny arm of `respond` did not invalidate anything — so a user pressing Deny
	// left the agent reading the very document it had just been refused, which is
	// the "authority the user withdrew is still live" class this host exists to
	// close. Reproduced with the reviewer's shape: a once grant admits the
	// document, a SECOND requester's prompt for the same origin is denied, and the
	// first requester's live receipt must stop working.
	const { host } = makeHost();
	const owner = { requester: "session:alice", url: "https://approved.example/" };
	await host.dispatch("request_access", owner, "request");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "once");
	const opened = await host.dispatch("open", owner, "open");
	assert.equal(
		(await host.dispatch("read", { ...owner, tab: opened.tab }, "read")).url,
		"https://approved.example/",
	);

	// A different requester asks for the same origin; the user says no.
	const second = await host.dispatch(
		"request_access",
		{ requester: "session:bob", url: "https://approved.example/other" },
		"second",
	);
	assert.equal(second.state, "pending", "the second requester is prompted");
	host.respondToConsent(second.entry_id, "deny");

	// The live receipt is for the denied origin, so it is dead now — for its own
	// drafter as much as for anyone else.
	await assert.rejects(
		() => host.dispatch("read", { ...owner, tab: opened.tab }, "denied"),
		(error) => error.code === "origin_not_allowed" && error.data.reason === "denied",
	);
});

test("shipped PSL covers public/private suffixes, wildcards, exceptions and loopback scopes", () => {
	configurePslRules(mod.PSL_RULES);
	try {
		assert.equal(domainScopeAvailable(), true);
		for (const [host, expected] of [
			["co.uk", null],
			["example.co.uk", "example.co.uk"],
			["github.io", null],
			["alice.github.io", "alice.github.io"],
			["b.ck", null],
			["a.b.ck", "a.b.ck"],
			["www.ck", "www.ck"],
			["city.kawasaki.jp", "city.kawasaki.jp"],
		]) {
			assert.equal(
				registrableDomain(new URL(`https://${host}/`)),
				expected,
				host,
			);
		}
		assert.equal(mod.broadGrantFor(new URL("https://co.uk/")), null);
		assert.equal(
			mod.broadGrantFor(new URL("http://localhost:8123/")).scope,
			"host",
		);
	} finally {
		configurePslRules(null);
	}
});

test("background agent views keep bounded render area away from the browser route", async () => {
	const { registry } = makeRegistry();
	const user = registry.create({ owner: "user" });
	const agent = registry.create({ owner: "agent", sessionId: "alice" });
	assert.ok(agent.view.getBounds().width > 0);
	assert.ok(agent.view.getBounds().height > 0);
	assert.equal(agent.view.visibility.at(-1), false);
	registry.setContentRect(null);
	assert.ok(agent.view.getBounds().width <= 1920);
	assert.equal(user.view.visibility.at(-1), false);
	registry.setContentRect({ x: 0, y: 10, width: 800, height: 600 });
	registry.destroy(user.tabId);
	// The user's tab going away hands presentation to NOBODY. Activating the agent
	// tab here was the defect review round 1 (R3) found: it became `active` AND
	// `presented`, laid out with the content rect — the very state `create`'s own
	// rule forbids (only a USER tab may be active). With no user tab left there is
	// no surface for the user to be looking at, so nothing is presented and the
	// agent tab keeps its bounded background viewport.
	assert.equal(registry.activeTab, null);
	assert.equal(agent.view.visibility.at(-1), false);
	assert.ok(agent.view.getBounds().width <= 1920);
});

test("a closed active user tab hands presentation to the last USER tab, or to nothing", async () => {
	// Review round 1, R3, from the other side: with user tabs on both sides of an
	// agent tab, the successor is the last USER one — `list().at(-1)` would have
	// picked the agent tab created after it.
	const { registry } = makeRegistry();
	const first = registry.create({ owner: "user" });
	const agent = registry.create({ owner: "agent", sessionId: "alice" });
	const last = registry.create({ owner: "user" });
	registry.setContentRect({ x: 0, y: 0, width: 800, height: 600 });
	assert.equal(registry.activeTab, last);

	registry.destroy(last.tabId);
	assert.equal(registry.activeTab, first);
	assert.equal(first.view.visibility.at(-1), true);
	assert.equal(agent.view.visibility.at(-1), false);

	registry.destroy(first.tabId);
	assert.equal(registry.activeTab, null);
	assert.equal(agent.view.visibility.at(-1), false);
});

test("an agent open on an unapproved origin is refused before the page is touched", async () => {
	const { host, views, registry } = makeHost();
	await assert.rejects(
		() =>
			host.dispatch(
				"open",
				{ url: "https://unapproved.example/", requester: "session:a" },
				"req-1",
			),
		(error) => error.code === "origin_not_allowed",
	);
	assert.equal(
		registry.count(),
		0,
		"no tab was created for a refused navigation",
	);
	assert.equal(views.size, 0);
});

test("request_access -> answer -> open end to end through the dispatcher", async () => {
	const { host, views } = makeHost();
	const params = {
		url: "https://approved.example/page",
		requester: "session:a",
	};
	const request = await host.dispatch("request_access", params, "req-1");
	assert.equal(request.state, "pending");
	const pending = host.chromeState().pendingConsent;
	assert.equal(pending.length, 1);
	host.respondToConsent(pending[0].entryId, "site");
	const awaited = await host.dispatch("await_access", params, "req-2");
	assert.equal(awaited.state, "allowed");
	const opened = await host.dispatch("open", params, "req-3");
	assert.ok(/^ui:1:[0-9a-f]{32}$/.test(opened.tab), `handle: ${opened.tab}`);
	assert.equal(opened.url, params.url);
	assert.equal(views.get(1)?.webContents.loaded.at(-1), params.url);
	// The tab is listed to its owner with a FULL handle, and to another session
	// redacted.
	const mine = await host.dispatch("tabs", { requester: "session:a" }, "req-4");
	assert.equal(mine.tabs[0].tab, opened.tab);
	const theirs = await host.dispatch(
		"tabs",
		{ requester: "session:b" },
		"req-5",
	);
	assert.ok(
		theirs.tabs[0].tab.endsWith("…"),
		"a listing must not hand out a capability",
	);
	// And the handle still drives.
	const read = await host.dispatch("read", { tab: opened.tab }, "req-6");
	assert.equal(read.text, "", "the fake page returns an empty document");
	const closed = await host.dispatch("close", { tab: opened.tab }, "req-7");
	assert.equal(closed.closed, opened.tab);
	assert.equal(host.registry.count(), 0);
});

test("read runs in an isolated world, and snapshot refs carry the tab's epoch", async () => {
	const { host, registry } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	const entry = host.chromeState().pendingConsent[0];
	host.respondToConsent(entry.entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	const view = registry.requireSurface(opened.tab).view;
	view.webContents.isolatedResult = "hello";
	await host.dispatch("read", { tab: opened.tab, selector: "body" }, "r3");
	assert.equal(view.webContents.worlds.length, 1);
	assert.equal(
		view.webContents.worlds[0].worldId,
		999,
		"the read ran in an isolated world, never the main one",
	);
	assert.ok(view.webContents.worlds[0].code.includes('"body"'));
	// A selector is passed as a JSON string literal, so a hostile one cannot become
	// code.
	view.webContents.worlds = [];
	await host.dispatch(
		"read",
		{ tab: opened.tab, selector: '";process.exit(1);"' },
		"r4",
	);
	assert.ok(
		view.webContents.worlds[0].code.includes('\\";process.exit(1);\\"'),
	);
	const snap = await host.dispatch("snapshot", { tab: opened.tab }, "r5");
	assert.equal(snap.refs, 1);
	assert.match(snap.snapshot, /button "Submit" \[e1\]/);
	assert.equal(registry.requireSurface(opened.tab).refs.e1.epoch, snap.epoch);
});

test("a ref from before a navigation is refused with element_not_found", async () => {
	const { host, registry } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	await host.dispatch("snapshot", { tab: opened.tab }, "r3");
	// The page navigates under the agent's feet.
	registry.bumpEpoch(registry.requireSurface(opened.tab).tabId);
	await assert.rejects(
		() => host.dispatch("click", { tab: opened.tab, ref: "e1" }, "r4"),
		(error) =>
			error.code === "element_not_found" &&
			/the page navigated since that snapshot/.test(error.message),
		"a pre-navigation ref must fail with the reason, not click whatever is there now",
	);
});

test("screenshot keeps the {data, url, title} shape Python validates", async () => {
	const { host } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	// The chrome reports its content area; a capture of a view with no area is the
	// case the next test covers.
	host.setContentRect({ x: 0, y: 0, width: 1024, height: 768 });
	const shot = await host.dispatch("screenshot", { tab: opened.tab }, "r3");
	assert.equal(typeof shot.data, "string");
	assert.equal(shot.data, "iVBORw0KGgo=");
	assert.equal(shot.url, params.url);
	assert.equal(typeof shot.title, "string");
});

test("a background tab captures without a route, without activation, through the product's own path", async () => {
	const { host, registry, cdp } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	const record = registry.requireSurface(opened.tab);
	// No content rect was ever reported (the user is not on the browser route) and
	// the product never activates an agent's tab, so this is the default path.
	assert.equal(record.presented, false);
	assert.equal(registry.activeTabId, null);
	assert.ok(
		record.view.getBounds().width > 0 && record.view.getBounds().height > 0,
		"a background view still has a bounded render area",
	);
	const shot = await host.dispatch(
		"screenshot",
		{ ...params, tab: opened.tab },
		"r3",
	);
	assert.equal(shot.data, "iVBORw0KGgo=");
	// The flag IS the contract: `captureBeyondViewport: false` needs a composited
	// surface a hidden view does not have, and then never answers (measured).
	assert.deepEqual(
		cdp.calls.filter((call) => call.method === "Page.captureScreenshot").at(-1)
			?.params,
		{
			format: "png",
			captureBeyondViewport: true,
			clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
		},
	);
	assert.equal(
		record.view.visibility.at(-1),
		false,
		"capturing must not present the view",
	);
	assert.equal(
		registry.activeTabId,
		null,
		"capturing must not select or raise a tab",
	);

	// A second owner's background tab captures its own pixels, still unattended.
	// No second prompt: the site grant already covers the origin for anyone.
	const other = { url: "https://approved.example/", requester: "session:b" };
	const second = await host.dispatch("open", other, "r4");
	assert.notEqual(second.tab, opened.tab);
	assert.equal(
		(await host.dispatch("screenshot", { ...other, tab: second.tab }, "r5"))
			.data,
		"iVBORw0KGgo=",
	);
	assert.equal(registry.activeTabId, null);

	// The presented path is unchanged: a shown tab is still captured over CDP.
	registry.activate(record.tabId);
	host.setContentRect({ x: 0, y: 0, width: 800, height: 600 });
	assert.equal(registry.requireSurface(opened.tab).presented, true);
	assert.equal(
		(await host.dispatch("screenshot", { ...params, tab: opened.tab }, "r6"))
			.data,
		"iVBORw0KGgo=",
	);
	assert.deepEqual(
		cdp.calls.filter((call) => call.method === "Page.captureScreenshot").at(-1)
			?.params,
		{ format: "png", captureBeyondViewport: false },
		"a presented capture keeps the narrower composited-surface capture, with no clip",
	);
});

test("a background capture retries a stalled attempt, and does not retry a real failure", async () => {
	const { host, registry, cdp } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	const record = registry.requireSurface(opened.tab);
	assert.equal(record.presented, false);

	// The measured shape: a hidden view's capture has no frame for THIS call and
	// never answers, and the next call answers. Assert both halves of the contract.
	const realSend = cdp.send;
	let captures = 0;
	let seenDeadline;
	cdp.send = async (contents, method, sent, options) => {
		if (method !== "Page.captureScreenshot") return realSend(contents, method, sent, options);
		captures += 1;
		seenDeadline = options?.deadlineMs;
		if (captures === 1) {
			const stalled = new Error("Page.captureScreenshot did not respond within 5000ms");
			stalled.data = { stalled: "Page.captureScreenshot" };
			throw stalled;
		}
		return realSend(contents, method, sent, options);
	};
	assert.equal((await host.dispatch("screenshot", { ...params, tab: opened.tab }, "r3")).data, "iVBORw0KGgo=");
	assert.equal(captures, 2, "a stalled background capture is retried exactly once");
	assert.equal(
		seenDeadline,
		5000,
		"each attempt carries its own bounded ceiling, so the retries fit the action budget",
	);

	// A failure that is NOT a stall is the real answer and must not be retried.
	captures = 0;
	cdp.send = async (contents, method, sent, options) => {
		if (method === "Page.captureScreenshot") {
			captures += 1;
			throw Object.assign(new Error("tab is gone"), { code: "tab_closed" });
		}
		return realSend(contents, method, sent, options);
	};
	await assert.rejects(() => host.dispatch("screenshot", { ...params, tab: opened.tab }, "r4"));
	assert.equal(captures, 1, "a typed failure is reported, not retried");
});

test("a corrupted zero-area view is refused rather than stalling", async () => {
	// Measured: `Page.captureScreenshot` on a view that was never given bounds never
	// replies at all (Chromium has nothing to composite), which cost a 15 s ceiling
	// twice before it was explained. The refusal names the cause instead.
	const { host, registry } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	registry
		.requireSurface(opened.tab)
		.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
	await assert.rejects(
		() => host.dispatch("screenshot", { tab: opened.tab }, "r3"),
		(error) =>
			error.code === "internal" && error.data.reason === "no_content_rect",
	);
	// With the chrome's rect reported, the capture is attempted again.
	host.setContentRect({ x: 0, y: 0, width: 800, height: 600 });
	const shot = await host.dispatch("screenshot", { tab: opened.tab }, "r4");
	assert.equal(shot.data, "iVBORw0KGgo=");
});

test("an open with no URL resumes the tab it is given and navigates nothing", async () => {
	const { host, registry, views } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	const loadsBefore = views.get(1)?.webContents.loaded.length ?? 0;
	const resumed = await host.dispatch(
		"open",
		{ tab: opened.tab, requester: "session:a" },
		"r3",
	);
	assert.equal(resumed.tab, opened.tab, "the same tab, not a second one");
	assert.equal(resumed.resumed, true);
	assert.equal(registry.count(), 1);
	assert.equal(
		views.get(1)?.webContents.loaded.length,
		loadsBefore,
		"a resume with no URL must not navigate the tab anywhere",
	);
});

test("close without a handle refuses ambiguity instead of guessing", async () => {
	const { host } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const first = await host.dispatch("open", params, "r2");
	await host.dispatch("open", params, "r3");
	await assert.rejects(
		() => host.dispatch("close", {}, "r4"),
		(error) =>
			error.code === "tab_ambiguous" &&
			// The message names redacted handles, never a full token: naming one would
			// let any session close any tab.
			error.message.includes(redactToken(first.tab)) &&
			!error.message.includes(first.tab),
	);
	await host.dispatch("close", { tab: first.tab }, "r5");
	const remaining = host.registry.count();
	assert.equal(remaining, 1);
	const last = await host.dispatch("close", {}, "r6");
	assert.ok(last.closed);
});

test("a user tab is not drivable until it is handed over, then it is", async () => {
	const { host } = makeHost();
	const state = await host.newTab();
	assert.equal(state.tabs.length, 1);
	const tabId = state.tabs[0].tabId;
	const guess = `ui:${tabId}:${"a".repeat(32)}`;
	await assert.rejects(
		() => host.dispatch("read", { tab: guess }, "r1"),
		(error) => error.code === "tab_closed",
		"a guessed handle cannot read a user's tab",
	);
	host.handOver(tabId, "session:a");
	const listed = await host.dispatch("tabs", { requester: "session:a" }, "r2");
	assert.ok(
		/^ui:\d+:[0-9a-f]{32}$/.test(listed.tabs[0].tab),
		"the session now holds the handle",
	);
	assert.equal(listed.tabs[0].handed_to_you, true);
	await host.navigateActive("https://approved.example/");
	await assert.rejects(
		() => host.dispatch("read", { tab: listed.tabs[0].tab }, "unapproved"),
		{ code: "origin_not_allowed" },
	);
	await host.dispatch(
		"request_access",
		{ url: "https://approved.example/", requester: "session:a" },
		"approval",
	);
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const read = await host.dispatch("read", { tab: listed.tabs[0].tab }, "r3");
	assert.equal(typeof read.text, "string");
	host.revokeHandOver(tabId);
	await assert.rejects(
		() => host.dispatch("read", { tab: listed.tabs[0].tab }, "r4"),
		(error) => error.code === "tab_closed",
	);
});

test("status publishes where the jar is and whether the broad scope exists", async () => {
	const { host } = makeHost();
	const status = await host.dispatch("status", {}, "r1");
	assert.equal(status.host, "ui");
	assert.equal(status.proto, PROTO_VERSION);
	assert.equal(status.profile_dir, "/scratch");
	assert.equal(status.domain_scope, false);
	assert.equal(status.agent_limit, MAX_AGENT_TABS);
	assert.equal(typeof status.approvals, "object");
});

test("the URL bar's own navigation is refused for a non-http scheme", async () => {
	const { host } = makeHost();
	await host.newTab();
	await assert.rejects(
		() => host.navigateActive("file:///etc/passwd"),
		(error) => error.code === "nav_failed",
	);
	await assert.rejects(
		() => host.navigateActive("javascript:alert(1)"),
		(error) => error.code === "nav_failed",
	);
	const state = await host.navigateActive("example.com");
	assert.equal(state.url, "https://example.com/");
});

// ---- the navigation wait: the settle's event mapping (R1) and its budget (Q1)

/**
 * A debugger the test can drive: `Debugger` is an EventEmitter in Electron, and
 * the listener count on it is the property R2 is about, so the fake has to be
 * one too.
 */
class EmittingDebugger extends EventEmitter {
	constructor() {
		super();
		this.attached = false;
	}

	attach() {
		this.attached = true;
	}

	detach() {
		this.attached = false;
	}

	isAttached() {
		return this.attached;
	}

	async sendCommand() {
		return {};
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("settle follows the REAL Electron event shapes: a sub-frame in-page navigation does not settle the wait", async () => {
	const contents = new FakeWebContents(901);
	let outcome = null;
	const done = settle(contents, 5_000).then(
		() => {
			outcome = "resolved";
		},
		(error) => {
			outcome = error;
		},
	);
	// The real signature (electron.d.ts:16907-16911, Electron 44.3.0):
	// (event, url, isMainFrame, frameProcessId, frameRoutingId). A hash change
	// inside an embedded frame must NOT settle the main frame's wait — binding the
	// url as `isMainFrame` is the R1 defect, and it made this line resolve.
	contents.emit(
		"did-navigate-in-page",
		{},
		"https://page.example/#ad-frame",
		false,
		2,
		7,
	);
	await tick();
	assert.equal(
		outcome,
		null,
		"a SUB-FRAME's in-page navigation must not settle a navigation",
	);
	contents.emit(
		"did-navigate-in-page",
		{},
		"https://page.example/#main",
		true,
		1,
		3,
	);
	await done;
	assert.equal(
		outcome,
		"resolved",
		"the MAIN frame's in-page navigation settles it",
	);
});

test("settle types a main-frame load failure, and ignores a sub-frame's or an aborted one", async () => {
	const subFrame = new FakeWebContents(902);
	let subOutcome = null;
	const subDone = settle(subFrame, 5_000).then(
		() => {
			subOutcome = "resolved";
		},
		(error) => {
			subOutcome = error;
		},
	);
	// An ad iframe that fails to load must not abort a navigation that in fact
	// succeeded; ABORTED (-3) is Chromium reporting a navigation the page itself
	// superseded, which is normal on any site that redirects client-side.
	subFrame.emit(
		"did-fail-load",
		{},
		-105,
		"NAME_NOT_RESOLVED",
		"https://ad.example/",
		false,
	);
	subFrame.emit(
		"did-fail-load",
		{},
		-3,
		"ERR_ABORTED",
		"https://page.example/",
		true,
	);
	await tick();
	assert.equal(
		subOutcome,
		null,
		"neither a sub-frame failure nor ERR_ABORTED is a failure",
	);
	subFrame.emit("did-finish-load");
	await subDone;
	assert.equal(subOutcome, "resolved");

	const mainFrame = new FakeWebContents(903);
	const failed = settle(mainFrame, 5_000);
	failed.catch(() => {});
	setImmediate(() =>
		mainFrame.emit(
			"did-fail-load",
			{},
			-105,
			"NAME_NOT_RESOLVED",
			"https://nope.example/",
			true,
		),
	);
	await assert.rejects(failed, (error) => {
		assert.equal(
			error.code,
			"nav_failed",
			"a main-frame net error is typed, not a timeout",
		);
		assert.equal(error.data.error_code, -105);
		return true;
	});
});

test("a hung page ends as the typed nav_timeout inside the published budget", async () => {
	const contents = new FakeWebContents(904);
	// A server that accepts the connection and never answers: Electron's `loadURL`
	// promise never settles for it, which is why the settle (not a deadline around
	// the load) has to be the thing that reports the failure.
	contents.loadURL = () => new Promise(() => {});
	const ctx = {
		cdp: { send: async () => ({}), subscribe: () => () => {} },
		log: () => {},
	};
	const started = Date.now();
	await assert.rejects(
		() =>
			navigateView(
				ctx,
				{ webContents: contents },
				new URL("http://127.0.0.1:9/slow"),
				"session:a",
				() => true,
				120,
			),
		(error) => {
			assert.equal(
				error.code,
				"nav_timeout",
				"the typed code, not `internal` + data.stalled",
			);
			assert.equal(error.data.timeout_ms, 120);
			return true;
		},
	);
	const elapsed = Date.now() - started;
	assert.ok(
		elapsed < 1_000,
		`the wait is the settle's own ceiling, not a second one stacked on top (took ${elapsed}ms)`,
	);
});

// ---- the debugger attachment (R2) ------------------------------------------

test("re-attaching after a devtools detach delivers every event exactly once", async () => {
	// Bundled on their own, like the test above: `CdpPool` is not exported from the
	// main bundle, and the log ring buffer is module state, so the driver and the
	// reader have to come from the SAME copy of the module.
	const { CdpPool, drainLogs } = await import(
		`data:text/javascript;base64,${Buffer.from(
			(
				await build({
					stdin: {
						contents:
							'export * from "./src/main/browser/cdp";\nexport * from "./src/main/browser/log-capture";',
						resolveDir: process.cwd(),
					},
					bundle: true,
					format: "esm",
					platform: "node",
					write: false,
				})
			).outputFiles[0].text,
		).toString("base64")}`
	);
	const pool = new CdpPool();
	const contents = new FakeWebContents(905);
	contents.debugger = new EmittingDebugger();
	const events = [];
	const unsubscribe = pool.subscribe(contents.id, (method) =>
		events.push(method),
	);
	const consoleLine = (value) => {
		contents.debugger.emit("message", {}, "Runtime.consoleAPICalled", {
			type: "log",
			args: [{ type: "string", value }],
		});
	};

	await pool.attach(contents);
	consoleLine("hello");
	assert.deepEqual(
		events,
		["Runtime.consoleAPICalled"],
		"one line, one delivery",
	);

	// The DevTools case (design 10.6), which this PR's own transcript contains:
	// Electron DETACHES the session rather than refusing the attach.
	contents.debugger.emit("detach", {}, "target closed");
	assert.equal(pool.isAttached(contents.id), false);
	await pool.attach(contents);
	assert.equal(pool.isAttached(contents.id), true);

	consoleLine("hello");
	assert.equal(
		contents.debugger.listenerCount("message"),
		1,
		"one `message` listener, not one per attach cycle",
	);
	assert.deepEqual(
		events,
		["Runtime.consoleAPICalled", "Runtime.consoleAPICalled"],
		"the subscriber is called once per event, not once per stale listener",
	);
	assert.equal(
		drainLogs(contents.id).filter((entry) => entry.text === "hello").length,
		2,
		"`logs` returns each console line once",
	);
	unsubscribe();
	await pool.detach(contents.id);
	assert.equal(
		contents.debugger.listenerCount("message"),
		0,
		"a detached view keeps no listeners at all",
	);
});

// ---- the tab registry's cap and the strip's projection (N2, N3) -------------

test("a hand-over cannot push the agent-owned count past the cap", () => {
	const { registry } = makeRegistry();
	for (let index = 0; index < MAX_AGENT_TABS; index += 1) {
		registry.create({
			owner: "agent",
			sessionId: "a",
			url: "https://example.com/",
		});
	}
	const userTab = registry.create({
		owner: "user",
		url: "https://example.com/",
	});
	assert.equal(registry.agentTabCount(), MAX_AGENT_TABS);
	assert.throws(
		() => registry.handOver(userTab.tabId, "session:a"),
		(error) => error.code === "tab_limit",
		"the cap `open` enforces is the cap `status` reports",
	);
	// Re-handing an ALREADY agent-owned tab does not change the count, so the cap
	// must not refuse the one hand-over that adds no agent tab.
	const agentTab = registry.list().find((record) => record.owner === "agent");
	registry.handOver(agentTab.tabId, "session:b");
	assert.equal(registry.agentTabCount(), MAX_AGENT_TABS);
});

test("the strip's projection survives an active tab whose view has died", async () => {
	const { host, registry } = makeHost();
	await host.newTab();
	const activeId = registry.activeTab.tabId;
	// Destroyed WITHOUT going through the registry: the window in which
	// `chromeState()` used to throw "Object has been destroyed" out of an IPC
	// handler and blank the whole strip (N2).
	registry.activeTab.view.webContents.destroyed = true;
	const state = host.chromeState();
	assert.equal(
		state.activeTabId,
		activeId,
		"the tab is still named, so the strip can drop it",
	);
	assert.equal(state.url, "");
	assert.equal(state.canGoBack, false);
});

// ---- the ownership refusal (Q2) --------------------------------------------

test("owner_* without a proof is refused with the extension's own answer", async () => {
	const { host } = makeHost();
	for (const method of [
		"owner_recover",
		"owner_retain",
		"owner_finish",
		"owner_release",
	]) {
		await assert.rejects(
			() => host.dispatch(method, { requester: "session:qa" }, "req-q2"),
			(error) => {
				assert.equal(
					error.code,
					"owner_refused",
					`${method} must not answer \`internal\``,
				);
				assert.match(error.message, /missing private browser ownership proof/);
				return true;
			},
		);
	}
	// The legitimate path is untouched: a well-formed proof with no prior scope.
	const recovered = await host.dispatch(
		"owner_recover",
		{
			requester: "session:qa",
			owner_proof: "p".repeat(43),
			owner_generation: "g1",
		},
		"req-q2b",
	);
	assert.deepEqual(recovered, { ownership_version: 1, state: "unresolved" });
});

// ---- restore is allocated up front and bounded (review round 1, R5) ---------

/** A registry whose every page load never settles, so nothing about the restore
 * pass can be observed as accidental progress. */
function makeHangingRegistry() {
	const views = new Map();
	const registry = new TabRegistry(
		(_options, tabId) => {
			const view = new FakeView(tabId);
			// The one thing a real page can do that no bound can wait out.
			view.webContents.loadURL = () => new Promise(() => {});
			views.set(tabId, view);
			return view;
		},
		() => {},
		() => {},
	);
	return { registry, views };
}

test("a restore allocates the whole strip before it returns, and serves while a page hangs", async () => {
	const { registry, views } = makeHangingRegistry();
	const { host } = makeHost({ registry });
	const recorded = [
		{ owner: "user", active: false, entries: [{ url: "https://example.com/a" }], activeIndex: 0 },
		{ owner: "user", active: true, entries: [{ url: "https://example.com/b" }], activeIndex: 0 },
	];

	const state = host.restoreTabs(recorded);

	// Allocated, and the recorded active tab, before any page has loaded.
	assert.equal(views.size, 2, "one view per recorded tab, immediately");
	assert.equal(state.tabs.length, 2, "and the strip is complete on the first read");
	const active = state.tabs.find((tab) => tab.active);
	assert.equal(
		active.url === "about:blank" || active.tabId === state.activeTabId,
		true,
		"the recorded active tab is the active one, even though its page has not loaded",
	);
	assert.equal(
		registry.activeTab.tabId,
		state.tabs[1].tabId,
		"the SECOND recorded tab was the active one and it did not lose its place",
	);

	// The claim the round-1 finding is about: the host serves while a page hangs.
	// Nothing here waits on `whenRestored`, and the page never answers.
	const status = await host.dispatch("status", {}, "restore-status");
	assert.ok(status && typeof status === "object", "the host answered while a page was hung");

	// And the hydration pass is genuinely still outstanding, rather than having
	// finished silently: it is a background obligation, not a startup gate.
	const settled = await Promise.race([
		host.whenRestored().then(() => "settled"),
		Promise.resolve("still-loading"),
	]);
	assert.equal(settled, "still-loading", "the restore is still in flight, and the host did not wait for it");
});

test("an empty restore still comes back as the blank tab it always did", async () => {
	const { host, registry } = makeHost();
	const state = host.restoreTabs([]);
	assert.equal(state.tabs.length, 1, "a first run opens one blank tab");
	assert.equal(registry.count(), 1);
	await host.whenRestored();
});

/*
 * Round 2's B2, at the layer it was found: the capture the RESTORE itself fires.
 *
 * `restoreTabs` allocates every view and settles the active tab synchronously,
 * then calls `onChanged` — before a single `history.restore()` has run, because
 * the pages load under the host's own background budget. The view a capture reads
 * has no history yet, so before this round that first capture was empty by
 * construction: `sessionStore.record([])`, and 500 ms later a `session.json`
 * holding no tabs — over the very file the restore was reading. A window close or
 * a kill inside that window persisted the truncation for good.
 *
 * The fake view here has NO `getAllEntries`/`getActiveIndex` at all, which is the
 * strictest form of "no history yet": the tab still has to be captured, from the
 * row it was restored from.
 */
test("the change capture a restore fires already carries every tab, before a page commits (review round 2, B2)", () => {
	const snapshots = [];
	const views = new Map();
	let nextWebContentsId = 900;
	const registry = new TabRegistry(
		(_options, tabId) => {
			const view = new FakeView(nextWebContentsId++);
			views.set(tabId, view);
			return view;
		},
		() => {},
		() =>
			snapshots.push(
				captureTabs(registry.list(), registry.activeTab?.tabId ?? null),
			),
	);
	const { host } = makeHost({ registry });
	const recorded = [
		{
			owner: "user",
			active: true,
			entries: [{ url: "https://example.com/a" }],
			activeIndex: 0,
		},
		{
			owner: "agent",
			active: false,
			entries: [{ url: "https://example.com/b" }],
			activeIndex: 0,
		},
	];

	host.restoreTabs(recorded);

	assert.ok(
		snapshots.length > 0,
		"a restore changes the strip, so it fires the capture",
	);
	assert.deepEqual(
		snapshots.at(-1).map((tab) => tab.entries[0].url),
		["https://example.com/a", "https://example.com/b"],
		"the capture the restore fires holds every tab, so the write it schedules cannot truncate the file",
	);
	assert.equal(
		snapshots.at(-1)[1].owner,
		"user",
		"and a restored tab comes back the user's whatever the file said, so the row is state and not authority",
	);
});

// ---- a refused load is published, per tab (design round 1, D1) --------------

test("a main-frame load refusal is published for its tab, and cleared by the next load", () => {
	const { host, registry } = makeHost();
	const first = registry.create({ owner: "user" });
	const second = registry.create({ owner: "agent", sessionId: "alice" });
	assert.equal(host.chromeState().navFailure, null, "a healthy tab reports no failure");

	host.recordLoadFailure(second.tabId, {
		code: -324,
		description: "ERR_EMPTY_RESPONSE",
		url: "http://127.0.0.1:9/",
	});
	let state = host.chromeState();
	assert.equal(
		state.navFailure,
		null,
		"the failure panel belongs to the tab the user is looking at, not to a background tab",
	);
	assert.equal(
		state.tabs.find((tab) => tab.tabId === second.tabId).failed,
		true,
		"but the strip marks the tab that failed, because its page area says nothing on its own",
	);
	assert.equal(
		state.tabs.find((tab) => tab.tabId === first.tabId).failed,
		false,
		"and only that tab",
	);

	host.recordLoadFailure(first.tabId, {
		code: -324,
		description: "ERR_EMPTY_RESPONSE",
		url: "http://127.0.0.1:9/",
	});
	state = host.chromeState();
	assert.equal(state.navFailure.description, "ERR_EMPTY_RESPONSE");
	assert.equal(state.navFailure.url, "http://127.0.0.1:9/", "the attempted address rides with it");

	host.clearLoadFailure(first.tabId);
	state = host.chromeState();
	assert.equal(state.navFailure, null, "the next navigation on that tab retires the failure");
	assert.equal(state.tabs.find((tab) => tab.tabId === first.tabId).failed, false);

	// A closed tab cannot leave a failure behind for whatever reuses the id.
	host.recordLoadFailure(first.tabId, {
		code: -105,
		description: "ERR_NAME_NOT_RESOLVED",
		url: "http://nope.invalid/",
	});
	host.closeTab(first.tabId);
	assert.equal(host.chromeState().navFailure, null, "a closed tab's failure goes with it");
});

test("a refused load is reported only when it is one a user can act on", () => {
	// ERR_ABORTED is a stop, a redirect hop and a superseded navigation - browsing
	// working, not a refusal - and ERR_ABORTED is emitted far more often than any
	// other code on a normal session.
	assert.equal(isReportableLoadFailure(-3), false, "ERR_ABORTED is not a failure to show");
	assert.equal(isReportableLoadFailure(0), false, "a zero code names no failure");
	assert.equal(isReportableLoadFailure(-324), true);
	assert.equal(isReportableLoadFailure(-105), true);
});

// ---- who is asking travels as an id and nothing else (D2) -------------------

test("a pending request names its requesting session, and never a non-session identity", () => {
	const { host } = makeHost();
	host.approvals.requestAccess("https://login.example.com/", "session:alice");
	let state = host.chromeState();
	assert.equal(
		state.pendingConsent[0].requesterSessionId,
		"alice",
		"the bare session id travels, so the chrome can resolve the conversation title",
	);
	assert.ok(
		!JSON.stringify(state.pendingConsent).includes("session:alice"),
		"and the raw requester identity does not",
	);

	// A requester that is NOT a session identity is an authority-boundary value -
	// the context falls back to a request id - and must never be published.
	host.approvals.cancelAccess("https://login.example.com/", "session:alice");
	host.approvals.requestAccess("https://login.example.com/", "request-7f3a");
	state = host.chromeState();
	assert.equal(
		state.pendingConsent[0].requesterSessionId,
		null,
		"an internal request id is not a conversation and is not rendered as one",
	);
});

/**
 * The body of the first function whose declaration contains `signature`.
 *
 * Brace matching rather than a regex because this file asserts about SCOPE: the
 * question is which function a call sits inside, and a regex cannot ask that.
 */
function functionBody(source, signature) {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `${signature} is gone from src/main/index.ts`);
	const open = source.indexOf("{", start);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		const character = source[index];
		if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(open, index + 1);
		}
	}
	throw new Error(`unbalanced braces after ${signature}`);
}

test("the browser host is attached inside the window factory, so every creation path gets it", () => {
	/*
	 * REVIEW ROUND 2, R2-2; STRENGTHENED IN ROUND 3, R3-5.
	 *
	 * The browser host used to be started at two call sites — the initial launch
	 * and the dock `activate` — while the click/viewer/second-instance path in
	 * `openSessionInWindow` created a window and started nothing. After the last
	 * window closed, a notification click therefore recreated chat with the
	 * browser capability silently missing, and activating the now-existing window
	 * could not repair it because the dock handler is gated on zero windows.
	 *
	 * Round 2 attached it in `setupMainWindowWithUpdateService`, which is where
	 * the two callers happened to converge — but round 3's review found that a
	 * chat window constructed any other way still would have passed this test,
	 * because the assertion was about the setup function's body rather than about
	 * the window. The host is now attached where the window is BUILT, so the
	 * property is "every window this file creates gets a host" rather than
	 * "whoever builds a window is expected to remember".
	 *
	 * A source assertion, deliberately: `index.ts` is the Electron entry point and
	 * boots the app, which this suite must never do (its own module docstring's
	 * rule). What it still cannot prove is that a real window comes up with a
	 * working host — that is the native lifecycle evidence, and this records the
	 * shape the code must keep for it.
	 */
	const source = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

	const createCalls = source.match(/=\s*createWindow\(/g) ?? [];
	assert.equal(
		createCalls.length,
		1,
		`${createCalls.length} window-creation call sites; every one must go through the factory so the host is attached`,
	);

	/*
	 * COUNT THE CONSTRUCTION, NOT THE CALL SHAPE (review round 4, R4-4). The
	 * assertion above counts assignment-shaped calls to the factory, so a second
	 * window built with `new BrowserWindow(...)` somewhere else would satisfy it
	 * AND the factory assertion below — and ship exactly the R2-2 defect this
	 * test exists to catch, because that window would have no host. Every
	 * construction in this file is asserted to be the factory's own.
	 */
	const constructions = source.match(/new BrowserWindow\(/g) ?? [];
	assert.equal(
		constructions.length,
		1,
		`${constructions.length} windows are constructed in this file; a window built outside the factory would have no browser host`,
	);
	assert.match(
		functionBody(source, "function createWindow("),
		/new BrowserWindow\(/,
		"the factory no longer constructs the window, so the one construction above belongs to something else",
	);

	const factory = functionBody(source, "function createWindow(");
	assert.match(
		factory,
		/attachBrowserHostToWindow\?\.\(/,
		"the window factory no longer attaches the browser host — a window built by it has no browser capability",
	);

	// The seam itself has to be ASSIGNED, and assigned inside the ready path: the
	// host's state (version, userData path, renderer URL) only exists there, and a
	// pointer left null would attach nothing while this file's factory assertion
	// above still passed.
	assert.match(
		source,
		/attachBrowserHostToWindow = \(window\) => \{\s*\n\s*void startBrowserHostForWindow\(window\);/,
		"the browser host seam is never assigned, so the factory's attach calls nothing",
	);

	// The setup must NOT attach: that is the shape round 2 had, and it is what let
	// a differently-built window through. Asserted in the negative so a later
	// re-introduction of the old arrangement fails here.
	const setup = functionBody(source, "function setupMainWindowWithUpdateService(");
	assert.doesNotMatch(
		setup,
		/startBrowserHostForWindow\(/,
		"the shared setup attaches the host again; the attach belongs to the window factory, not to one caller of it",
	);

	// ONE invocation and one declaration: a second invocation elsewhere is the
	// duplicate registration #160 warned about.
	const hostUses = source.match(/startBrowserHostForWindow\(/g) ?? [];
	assert.equal(
		hostUses.length,
		2,
		"expected the declaration plus exactly one call site, the seam assignment in the ready path",
	);
});
