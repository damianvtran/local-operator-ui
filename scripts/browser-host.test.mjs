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
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/registry";',
			'export * from "./src/main/browser/state-file";',
			'export * from "./src/main/browser/rpc";',
			'export * from "./src/main/browser/protocol";',
			'export * from "./src/main/browser/approvals";',
			'export * from "./src/main/browser/ownership";',
			'export * from "./src/main/browser/host";',
			'export * from "./src/main/browser/policy/origin-policy";',
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
	configurePslRules,
	domainScopeAvailable,
	registrableDomain,
	safeHttpUrl,
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
		this.navigationHistory = {
			canGoBack: () => false,
			canGoForward: () => false,
			goBack: () => {},
			goForward: () => {},
			length: () => 1,
		};
	}

	isDestroyed() {
		return this.destroyed;
	}

	isLoading() {
		return false;
	}

	reload() {}

	stop() {}

	getURL() {
		return this.url;
	}

	getTitle() {
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
	assert.equal(stat.mode & 0o777, STATE_FILE_MODE, "the record is 0600");
	assert.equal(
		statSync(join(root, "run", "ui-browser")).mode & 0o777,
		STATE_DIR_MODE,
		"the directory is 0700",
	);
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
		readdirSync(join(root, "run", "ui-browser")).filter((name) => name.endsWith(".tmp"))
			.length,
		0,
	);
	writer.clear();
	assert.equal(
		readdirSync(join(root, "run", "ui-browser")).length,
		0,
		"clearing removes the record, so discovery is honest",
	);
});

test("asking for the state path creates nothing", () => {
	const missing = mkdtempSync(join(tmpdir(), "lo-browser-absent-"));
	assert.ok(stateFilePath(missing).endsWith(join("run", "ui-browser", "host.json")));
	assert.deepEqual(
		readdirSync(missing),
		[],
		"path arithmetic alone must not create the directory (the bridge's ENOSPC lesson)",
	);
	rmSync(missing, { recursive: true, force: true });
});

// ---- the loopback RPC ------------------------------------------------------

test("the listener answers only with the key, and never with CORS headers", async () => {
	const unauthorized = await post({ id: "1", method: "status", params: {} }, { key: null });
	assert.equal(unauthorized.status, 401);
	const wrong = await post({ id: "1", method: "status", params: {} }, { key: "nope" });
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
	assert.equal(extraField.status, 422, "an unknown envelope field is refused (extra=forbid)");
	const arrayBody = await post([]);
	assert.equal(arrayBody.status, 422);
	const missingId = await post({ method: "status", params: {} });
	assert.equal(missingId.status, 422);
	const badParams = await post({ id: "1", method: "status", params: 7 });
	assert.equal(badParams.status, 422);
});

test("a dispatched failure comes back as the typed error arm, and an unknown code is downgraded", async () => {
	const response = await post({ id: "9", method: "read", params: { tab: "ui:1:x" } });
	assert.equal(response.status, 200, "a command failure is a 200 with an error arm");
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
	assert.deepEqual(body, { host: "ui", proto: PROTO_VERSION, pid: process.pid });
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	const wrongPath = await post({ id: "1", method: "status", params: {} }, { path: "/" });
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
	assert.equal(registry.activeTab?.tabId, user.tabId, "a user tab is what the user is looking at");
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
	assert.equal(views.get(user.tabId)?.visibility.at(-1), false, "an overlay hides the view");
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
	for (let index = 0; index < 20; index += 1) registry.create({ owner: "user" });
	assert.equal(registry.agentTabCount(), MAX_AGENT_TABS);
	assert.equal(registry.count(), MAX_AGENT_TABS + 20);
});

test("the handle is the capability: a wrong or stale nonce is refused", () => {
	const { registry } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	const token = surfaceToken(agent);
	assert.ok(token && /^ui:1:[0-9a-f]{32}$/.test(token), `token shape: ${token}`);
	assert.equal(registry.requireSurface(token).tabId, agent.tabId);
	const parsed = parseSurface(token);
	assert.ok(parsed);
	// A one-character-short nonce parses as a handle and fails the nonce check.
	assert.throws(
		() => registry.requireSurface(`ui:${agent.tabId}:${parsed.nonce.slice(0, -1)}`),
		(error) => error.code === "tab_closed" && error.data.reason === "unknown_handle",
	);
	// A guessed nonce for a real tab is refused identically to a missing tab.
	assert.throws(
		() => registry.requireSurface(`ui:${agent.tabId}:${"0".repeat(32)}`),
		(error) => error.code === "tab_closed" && error.data.reason === "unknown_handle",
	);
	assert.throws(
		() => registry.requireSurface("ui:999:deadbeef"),
		(error) => error.code === "tab_closed",
	);
	assert.throws(
		() => registry.requireSurface("bridge:1:abc"),
		(error) => error.code === "tab_closed" && error.data.reason === "malformed_handle",
	);
});

test("a user tab has no capability until it is handed over, and revoking removes it", () => {
	const { registry } = makeRegistry();
	const user = registry.create({ owner: "user" });
	assert.equal(surfaceToken(user), null, "no nonce, so nothing to address it by");
	// The session is stored BARE, whatever spelling the caller hands over.
	registry.handOver(user.tabId, "session:b");
	const token = surfaceToken(user);
	assert.ok(token, "the hand-over mints the capability");
	assert.equal(registry.requireSurface(token).tabId, user.tabId);
	assert.equal(user.sessionId, "b", "the stored identity is the bare session id");
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
	assert.equal(restored.owner, "user", "an agent does not silently reclaim a restored tab");
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
		(error) => error.code === "tab_closed" && error.data.reason === "view_destroyed",
	);
	assert.equal(registry.count(), 0, "the record is gone, not a phantom handle");
});

test("destroying a tab releases its webContents exactly once, through the one removal path", () => {
	const { registry, views, removed } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	registry.destroy(agent.tabId);
	assert.equal(views.size, 1);
	assert.deepEqual(removed, [
		{ tabId: agent.tabId, webContentsId: views.get(agent.tabId)?.webContents.id },
	]);
	registry.destroy(agent.tabId);
	assert.equal(removed.length, 1, "a second destroy is a no-op, not a second release");
});

test("two commands on one tab do not interleave: the second reads busy", async () => {
	const { registry } = makeRegistry();
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	let release = () => {};
	const first = registry.lane(agent.tabId, () => new Promise((resolve) => {
		release = () => resolve("first");
	}));
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
	assert.equal(ownsRedacted("ui:3:9999991234567890abcdef1234567890", redacted), false);
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
		if (!order.slice(0, order.indexOf(`cdp:${method}`)).some((entry) => entry.startsWith("load:"))) {
			firstCommandBeforeLoad = method;
		}
		return {};
	};
	await pool.attach(contents);
	assert.equal(firstCommandBeforeLoad, null, "no CDP command was sent before the view had a document");
	assert.ok(order.some((entry) => entry === "load:about:blank"), `order: ${order.join(", ")}`);
	assert.ok(order.includes("cdp:Runtime.enable") && order.includes("cdp:Log.enable"));
});

// ---- the origin gate -------------------------------------------------------

test("nothing is reachable by default, and a decision is what opens it", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-a") });
	const url = safeHttpUrl("https://example.com/page");
	assert.equal(store.originAllowed(url), false);
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:a"),
		(error) => error.code === "origin_not_allowed" && error.data.reason === "unapproved",
	);
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	assert.equal(pending.state, "pending");
	assert.equal(store.pendingEntries().length, 1);
	const decided = store.respond(pending.entry_id, "site");
	assert.equal(decided.state, "allowed");
	assert.equal(store.originAllowed(url), true);
	assert.equal(store.ensureTopLevelAccess(url, "session:a").allowed, true);
	assert.equal(store.pendingEntries().length, 0, "the answered request is no longer pending");
});

test("a one-shot grant is spendable once, by the requester who earned it", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-once") });
	const url = safeHttpUrl("https://once.example/");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(pending.entry_id, "once");
	assert.equal(store.ensureTopLevelAccess(url, "session:a").viaOnceGrant, true);
	assert.equal(store.originAllowed(url), false, "a one-shot grant is not a stored grant");
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
	assert.equal(again.state, "denied", "the user just said no; do not re-prompt on retry");
	assert.throws(
		() => store.ensureTopLevelAccess(url, "session:a"),
		(error) => error.code === "origin_not_allowed" && error.data.reason === "denied",
	);
	assert.equal(store.describe().denied_origins, 1);
});

test("a request displaced by another session's prompt is superseded, not silently forgotten", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-supersede") });
	const first = store.requestAccess("https://a.example/", "session:a", "async", "req-1");
	store.requestAccess("https://b.example/", "session:b", "async", "req-2");
	assert.equal(store.pendingEntries().length, 1, "one prompt slot, replace-don't-queue");
	assert.equal(store.accessStateFor("https://a.example/", "session:a").state, "superseded");
	assert.equal(
		store.accessStateFor("https://a.example/", "session:c").state,
		"none",
		"a third session gets the neutral answer, not someone else's receipt",
	);
	assert.ok(first.entry_id);
});

test("cancelling removes only the caller's own entry", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-cancel") });
	const entry = store.requestAccess("https://c.example/", "session:a", "async", "req-1");
	assert.equal(store.cancelAccess("https://c.example/", "session:b").state, "none");
	assert.equal(store.pendingEntries().length, 1, "another session's cancel did nothing");
	assert.equal(store.cancelAccess("https://c.example/", "session:a").state, "cancelled");
	assert.equal(store.pendingEntries().length, 0);
	assert.ok(entry.entry_id);
});

test("an answered request that is no longer pending cannot be answered again", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-stale") });
	const entry = store.requestAccess("https://d.example/", "session:a", "async", "req-1");
	assert.equal(store.respond(entry.entry_id, "site").state, "allowed");
	assert.throws(
		() => store.respond(entry.entry_id, "deny"),
		(error) => error.code === "internal",
		"a stale answer fails rather than granting whatever is pending now",
	);
});

test("revoking every approval leaves no grant and no pending entry", () => {
	const store = new ApprovalStore({ dir: join(root, "approvals-revoke") });
	const entry = store.requestAccess("https://e.example/", "session:a", "async", "req-1");
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
	assert.equal(registrableDomain(safeHttpUrl("https://news.example.co.uk/")), null);
	const store = new ApprovalStore({ dir: join(root, "approvals-psl") });
	const entry = store.requestAccess("https://news.example.co.uk/", "session:a", "async", "r");
	assert.equal(entry.broad, undefined, "no domain option is offered without rules");
	assert.throws(
		() => store.respond(entry.entry_id, "domain"),
		(error) => error.code === "internal",
		"and a broad decision that was never offerable is refused rather than widened",
	);
	// With rules installed, the same call computes the registrable domain.
	configurePslRules("co.uk\ncom\n");
	assert.equal(domainScopeAvailable(), true);
	assert.equal(registrableDomain(safeHttpUrl("https://news.example.co.uk/")), "example.co.uk");
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
	assert.deepEqual(await ledger.withOwnership("owner_recover", params, async () => ({})), {
		ownership_version: 1,
		state: "unresolved",
	});
	let opened = 0;
	await ledger.withOwnership("open", { ...params, url: "https://example.com/" }, async () => {
		opened += 1;
		ledger.recordAllocation({ ...params, tab: "ui:1:aaa" }, "ui:1:aaa", "allocated");
		return { tab: "ui:1:aaa" };
	});
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
			ledger.withOwnership("tabs", { ...params, owner_generation: "gen-9" }, async () => ({})),
		(error) => error.code === "owner_refused",
	);
	// A missing or malformed proof is refused rather than degrading to legacy.
	await assert.rejects(
		() => ledger.withOwnership("tabs", { ...params, owner_proof: "short" }, async () => ({})),
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
	await ledger.withOwnership("owner_retain", { ...params, reason: "waiting on a build" }, async () => ({}));
	assert.deepEqual(await ledger.withOwnership("owner_finish", params, async () => ({})), {
		state: "retained",
	});
	assert.deepEqual(await ledger.withOwnership("owner_release", params, async () => ({})), {
		state: "released",
		terminal: "completed",
	});
	await assert.rejects(
		() => ledger.withOwnership("goto", params, async () => ({})),
		(error) => error.code === "owner_refused",
		"a finished scope cannot navigate",
	);
	assert.deepEqual(await ledger.withOwnership("tabs", params, async () => ({ tabs: [] })), {
		tabs: [],
	});
	// Retention without a bounded reason is refused: the reason is what a human
	// later reads to decide whether the tab may be closed.
	await assert.rejects(
		() => ledger.withOwnership("owner_retain", { ...params, reason: "" }, async () => ({})),
		(error) => error.code === "owner_refused",
	);
});

// ---- the dispatcher, with a fake browser -----------------------------------

function makeHost(overrides = {}) {
	const { registry, views } = makeRegistry();
	const cdp = {
		attach: async () => {},
		send: async (_contents, method) => {
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
		subscribe: () => () => {},
		detach: async () => {},
		forget: () => {},
		close: async () => {},
	};
	const approvals = new ApprovalStore({ dir: join(root, `approvals-host-${Math.random()}`) });
	const ownership = new OwnershipLedger({
		closeTab: async () => true,
		isLive: () => true,
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
	return { host, registry, views, approvals };
}

test("an agent open on an unapproved origin is refused before the page is touched", async () => {
	const { host, views, registry } = makeHost();
	await assert.rejects(
		() => host.dispatch("open", { url: "https://unapproved.example/", requester: "session:a" }, "req-1"),
		(error) => error.code === "origin_not_allowed",
	);
	assert.equal(registry.count(), 0, "no tab was created for a refused navigation");
	assert.equal(views.size, 0);
});

test("request_access -> answer -> open end to end through the dispatcher", async () => {
	const { host, views } = makeHost();
	const params = { url: "https://approved.example/page", requester: "session:a" };
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
	const theirs = await host.dispatch("tabs", { requester: "session:b" }, "req-5");
	assert.ok(theirs.tabs[0].tab.endsWith("…"), "a listing must not hand out a capability");
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
	await host.dispatch("read", { tab: opened.tab, selector: '";process.exit(1);"' }, "r4");
	assert.ok(view.webContents.worlds[0].code.includes('\\";process.exit(1);\\"'));
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

test("a screenshot of a view with no area is refused with a reason, not a stall", async () => {
	// Measured: `Page.captureScreenshot` on a view that was never given bounds never
	// replies at all (Chromium has nothing to composite), which cost a 15 s ceiling
	// twice before it was explained. The refusal names the cause instead.
	const { host } = makeHost();
	const params = { url: "https://approved.example/", requester: "session:a" };
	await host.dispatch("request_access", params, "r1");
	host.respondToConsent(host.chromeState().pendingConsent[0].entryId, "site");
	const opened = await host.dispatch("open", params, "r2");
	await assert.rejects(
		() => host.dispatch("screenshot", { tab: opened.tab }, "r3"),
		(error) => error.code === "internal" && error.data.reason === "no_content_rect",
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
	const resumed = await host.dispatch("open", { tab: opened.tab, requester: "session:a" }, "r3");
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
	assert.ok(/^ui:\d+:[0-9a-f]{32}$/.test(listed.tabs[0].tab), "the session now holds the handle");
	assert.equal(listed.tabs[0].handed_to_you, true);
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
