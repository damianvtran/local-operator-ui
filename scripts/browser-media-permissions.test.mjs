/**
 * Camera and microphone in the driven browser: the user-mediated per-origin
 * decision (`src/main/browser/media-permissions.ts`) and the session handlers
 * that route `media` to it (`src/main/browser/profile.ts`).
 *
 * WHAT THESE TESTS ARE: the shipped TypeScript, bundled in memory with esbuild,
 * driven through the SAME two Electron handlers the real install registers (a
 * fake Session keeps them), with a stand-in for macOS TCC and a real temp file
 * for the remembered decisions. They pin the invariants review cannot see:
 * only a trusted decision on the live prompt grants; the check and request
 * handlers agree; nothing but `media` is widened; a cross-origin frame cannot
 * borrow the page's grant; an agent-owned tab never gets a silent grant; a
 * held callback is always answered exactly once.
 *
 * WHAT THEY ARE NOT: native proof that Chromium starts a capture, or that the
 * chrome renders the band (the IPC sender check is `ipc.ts`'s and is covered
 * by its own tests).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/profile";',
			'export * from "./src/main/browser/media-permissions";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const { installBrowserSessionHandlers, MediaPermissions, mediaOriginOf } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const GRANT_LIKE = /grant|allow|approve/i;
const AGENT_DECIDE = /mediaPermissions?\.decide|media-permission-decide/;
const SENDER_CHECK = /authorize\(event\)/;
const LOGS_MEDIA_TYPES = /details\.mediaTypes\.join\(","\)/;
const DISPOSES_MEDIA = /mediaPermissions\.dispose\(\)/;
const OPENS_FIXED_PANE = /shell\.openExternal\(SYSTEM_SETTINGS_URL\[pane\]\)/;

const MEET = "https://meet.google.com";
const MEET_URL = `${MEET}/abc-defg-hij`;

function fakeSession() {
	const handlers = {};
	return {
		handlers,
		setUserAgent() {},
		setPermissionRequestHandler(fn) {
			handlers.request = fn;
		},
		setPermissionCheckHandler(fn) {
			handlers.check = fn;
		},
		on() {},
		removeListener() {},
		webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {} },
	};
}

/** A webContents fake: the request handler reads the tab's top-level URL. */
function view(id, url = MEET_URL) {
	return { id, getURL: () => url, isDestroyed: () => false, send() {} };
}

/** One host: a temp store, a TCC stand-in, a registry of two tabs (1 = user's,
 * 2 = agent's) and the session handlers wired the way `index.ts` wires them. */
function rig({ tcc = { audio: "granted", video: "granted" }, ask } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "lop-media-perm-"));
	const filePath = join(dir, "browser", "media-permissions.json");
	const asked = [];
	const changes = { count: 0 };
	const system = {
		status: (kind) => tcc[kind],
		ask: async (kind) => {
			asked.push(kind);
			const granted = ask ? ask(kind) : false;
			tcc[kind] = granted ? "granted" : "denied";
			return granted;
		},
	};
	const tabs = new Map([
		[11, { tabId: 1, owner: "user" }],
		[22, { tabId: 2, owner: "agent" }],
	]);
	const make = () =>
		new MediaPermissions({
			filePath,
			system,
			tabFor: (id) => tabs.get(id) ?? null,
			onChanged: () => changes.count++,
		});
	const media = make();
	const session = fakeSession();
	const seen = [];
	installBrowserSessionHandlers(session, {
		onPermissionRequested: (d) => seen.push(d),
		media: {
			request: (input, cb) => media.request(input, cb),
			check: (input) => media.check(input),
		},
	});
	const request = (contents, mediaTypes, extra = {}) => {
		const answers = [];
		session.handlers.request(contents, "media", (v) => answers.push(v), {
			isMainFrame: true,
			requestingUrl: contents.getURL(),
			securityOrigin: new URL(contents.getURL()).origin,
			mediaTypes,
			...extra,
		});
		return answers;
	};
	const check = (contents, mediaType, origin = MEET) =>
		session.handlers.check(contents, "media", origin, {
			isMainFrame: true,
			requestingUrl: contents.getURL(),
			mediaType,
		});
	return {
		dir,
		filePath,
		media,
		make,
		session,
		seen,
		asked,
		tcc,
		changes,
		request,
		check,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("allow grants the held request, is remembered, and the check agrees", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	assert.equal(r.check(user, "audio"), false, "no decision yet: check denies");
	const answers = r.request(user, ["video", "audio"]);
	assert.deepEqual(answers, [], "the callback is HELD while the user decides");
	const prompt = r.media.viewFor(1);
	assert.equal(prompt.kind, "prompt");
	assert.equal(prompt.origin, MEET);
	assert.deepEqual(prompt.kinds, ["audio", "video"]);
	assert.equal(prompt.ownerKind, "user");

	assert.equal(
		await r.media.decide(1, prompt.id, "allow", { trusted: true }),
		true,
	);
	assert.deepEqual(answers, [true]);
	assert.equal(r.media.viewFor(1), null);
	assert.equal(r.check(user, "audio"), true);
	assert.equal(r.check(user, "video"), true);
	assert.equal(
		r.check(user, "unknown"),
		false,
		"an unnamed device is never true",
	);

	// Persisted under the profile's state dir, and read back by a new host.
	const stored = JSON.parse(readFileSync(r.filePath, "utf8"));
	assert.deepEqual(stored.origins[MEET], { audio: "allow", video: "allow" });
	const restarted = r.make();
	assert.equal(
		restarted.check({
			webContentsId: 11,
			topUrl: MEET_URL,
			requestingOrigin: MEET,
			mediaType: "video",
		}),
		true,
	);
	// The next visit is granted without a prompt.
	assert.deepEqual(r.request(user, ["audio", "video"]), [true]);
	assert.equal(r.media.viewFor(1), null);
	assert.ok(r.seen.some((d) => d.permission === "media" && d.granted === true));
});

test("block denies, is remembered, and later requests are denied without a prompt", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	const answers = r.request(user, ["audio"]);
	const prompt = r.media.viewFor(1);
	assert.equal(
		await r.media.decide(1, prompt.id, "block", { trusted: true }),
		true,
	);
	assert.deepEqual(answers, [false]);
	assert.equal(r.check(user, "audio"), false);
	assert.deepEqual(r.request(user, ["audio"]), [false]);
	// U2: no new prompt, but the BLOCKED band (not a silent dead end).
	assert.equal(
		r.media.viewFor(1)?.kind,
		"blocked",
		"a blocked site does not re-prompt",
	);
	assert.equal(r.media.decisions().origins[MEET].audio, "block");
});

test("dismiss denies this request and remembers nothing", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const answers = r.request(view(11), ["audio", "video"]);
	const prompt = r.media.viewFor(1);
	await r.media.decide(1, prompt.id, "dismiss", { trusted: true });
	assert.deepEqual(answers, [false]);
	assert.deepEqual(r.media.decisions().origins, {});
	r.request(view(11), ["audio"]);
	assert.equal(r.media.viewFor(1)?.kind, "prompt", "the site may ask again");
});

test("every non-media permission is still denied by both handlers", (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	for (const permission of [
		"notifications",
		"geolocation",
		"clipboard-read",
		"display-capture",
		"midi",
		"fullscreen",
	]) {
		const answers = [];
		r.session.handlers.request(user, permission, (v) => answers.push(v), {
			isMainFrame: true,
			requestingUrl: MEET_URL,
		});
		assert.deepEqual(answers, [false], permission);
		assert.equal(
			r.session.handlers.check(user, permission, MEET, {
				requestingUrl: MEET_URL,
			}),
			false,
			permission,
		);
	}
	assert.equal(r.media.viewFor(1), null, "no prompt for a non-media ask");
});

test("without the media hook, media stays denied (no silent grant)", () => {
	const session = fakeSession();
	installBrowserSessionHandlers(session, {});
	const answers = [];
	session.handlers.request(view(11), "media", (v) => answers.push(v), {
		mediaTypes: ["audio"],
		securityOrigin: MEET,
	});
	assert.deepEqual(answers, [false]);
	assert.equal(
		session.handlers.check(view(11), "media", MEET, { mediaType: "audio" }),
		false,
	);
});

test("only a trusted decision on the LIVE prompt can grant (agent/synthetic path)", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const answers = r.request(view(11), ["audio", "video"]);
	const prompt = r.media.viewFor(1);
	// A synthetic click (`isTrusted: false`) is refused and the prompt stays.
	assert.equal(
		await r.media.decide(1, prompt.id, "allow", { trusted: false }),
		false,
	);
	// A forged or stale id is refused, even trusted.
	assert.equal(
		await r.media.decide(1, "not-the-id", "allow", { trusted: true }),
		false,
	);
	// The id is bound to its tab.
	assert.equal(
		await r.media.decide(2, prompt.id, "allow", { trusted: true }),
		false,
	);
	assert.deepEqual(answers, [], "nothing answered yet");
	assert.equal(r.check(view(11), "audio"), false);
	assert.deepEqual(r.media.decisions().origins, {});
	assert.equal(r.media.viewFor(1)?.id, prompt.id, "the prompt is still up");
	// The module exposes no grant path other than `decide`.
	const grantish = Object.getOwnPropertyNames(
		MediaPermissions.prototype,
	).filter((name) => GRANT_LIKE.test(name) && name !== "grantThroughSystem");
	assert.deepEqual(grantish, []);
});

test("the decide channel is the IPC layer's alone: no agent RPC names it", () => {
	const sources = [
		"src/main/browser/rpc.ts",
		"src/main/browser/host.ts",
		"src/main/browser/protocol.ts",
	]
		.map((p) => readFileSync(p, "utf8"))
		.join("\n");
	assert.doesNotMatch(sources, AGENT_DECIDE);
	const ipc = readFileSync("src/main/browser/ipc.ts", "utf8");
	const handler = ipc.slice(
		ipc.indexOf('"browser-media-permission-decide",\n\t\tasync'),
	);
	assert.match(handler.slice(0, 400), SENDER_CHECK, "sender-checked");
});

test("an agent-owned tab is never granted silently, and its allow is one-shot", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	// The user allowed Meet on their own tab.
	r.request(view(11), ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "allow", { trusted: true });
	const agent = view(22);
	assert.equal(
		r.check(agent, "audio"),
		false,
		"remembered allow does not apply",
	);
	const answers = r.request(agent, ["audio"]);
	const prompt = r.media.viewFor(2);
	assert.equal(prompt?.ownerKind, "agent", "the agent's tab prompts again");
	await r.media.decide(2, prompt.id, "allow", { trusted: true });
	assert.deepEqual(answers, [true]);
	// Its allow is not persisted (video was never asked on the user's tab).
	r.request(agent, ["video"]);
	await r.media.decide(2, r.media.viewFor(2).id, "allow", { trusted: true });
	assert.equal(r.media.decisions().origins[MEET].video, undefined);
});

test("cross-origin frames and insecure origins are denied without a prompt", (t) => {
	const r = rig();
	t.after(r.cleanup);
	const answers = r.request(view(11), ["audio"], {
		isMainFrame: false,
		securityOrigin: "https://evil.example",
		requestingUrl: "https://evil.example/frame",
	});
	assert.deepEqual(answers, [false]);
	assert.equal(r.media.viewFor(1), null);
	assert.equal(r.check(view(11), "audio", "https://evil.example"), false);
	assert.deepEqual(r.request(view(11, "http://example.com/"), ["audio"]), [
		false,
	]);
	assert.equal(
		mediaOriginOf("http://localhost:5173/x"),
		"http://localhost:5173",
	);
	assert.equal(mediaOriginOf("http://example.com"), null);
	assert.equal(mediaOriginOf("file:///etc/passwd"), null);
	// A webContents that is not a registry tab (popup, overlay) is denied.
	assert.deepEqual(r.request(view(99), ["audio"]), [false]);
});

test("navigation, tab close and dispose answer a held request false, exactly once", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const first = r.request(view(11), ["audio"]);
	const coalesced = r.request(view(11), ["audio"]);
	const stale = r.media.viewFor(1);
	r.media.clearTab(1); // main-frame navigation
	assert.deepEqual(first, [false]);
	assert.deepEqual(coalesced, [false]);
	assert.equal(
		await r.media.decide(1, stale.id, "allow", { trusted: true }),
		false,
	);
	assert.deepEqual(first, [false], "never answered twice");
	const closed = r.request(view(11), ["video"]);
	r.media.forget(1);
	assert.deepEqual(closed, [false]);
	const pending = r.request(view(11), ["video"]);
	r.media.dispose();
	assert.deepEqual(pending, [false]);
	assert.deepEqual(r.request(view(11), ["video"]), [false], "disposed denies");
});

test("macOS TCC: not-determined asks the OS; denied refuses and raises the System Settings notice", async (t) => {
	// The OS says yes when asked.
	const yes = rig({
		tcc: { audio: "not-determined", video: "granted" },
		ask: () => true,
	});
	t.after(yes.cleanup);
	const a = yes.request(view(11), ["audio", "video"]);
	await yes.media.decide(1, yes.media.viewFor(1).id, "allow", {
		trusted: true,
	});
	assert.deepEqual(
		yes.asked,
		["audio"],
		"only the undetermined device is asked",
	);
	assert.deepEqual(a, [true]);

	// The OS has camera turned off for the app.
	const no = rig({ tcc: { audio: "granted", video: "denied" } });
	t.after(no.cleanup);
	const b = no.request(view(11), ["audio", "video"]);
	await no.media.decide(1, no.media.viewFor(1).id, "allow", { trusted: true });
	assert.deepEqual(
		b,
		[false],
		"a call that asked for both does not start with one",
	);
	assert.deepEqual(
		no.asked,
		[],
		"a denied device is not re-asked (macOS would not show it)",
	);
	const notice = no.media.viewFor(1);
	assert.equal(notice.kind, "system-blocked");
	assert.deepEqual(notice.kinds, ["video"]);
	assert.equal(no.check(view(11), "video"), false, "check agrees with the OS");
	assert.equal(no.check(view(11), "audio"), true);
	// A remembered allow with TCC still off denies again and re-raises the notice.
	await no.media.decide(1, notice.id, "dismiss", { trusted: true });
	assert.equal(no.media.viewFor(1), null);
	assert.deepEqual(no.request(view(11), ["video"]), [false]);
	assert.equal(no.media.viewFor(1)?.kind, "system-blocked");
});

test("forget site and clear-everything erase remembered decisions; a corrupt store fails closed", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	r.request(view(11), ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "allow", { trusted: true });
	r.media.forgetOrigin(`${MEET}/any/path`);
	assert.equal(r.check(view(11), "audio"), false);
	r.request(view(11), ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "block", { trusted: true });
	r.media.clearAll();
	assert.deepEqual(r.media.decisions().origins, {});
	writeFileSync(r.filePath, "{not json");
	assert.deepEqual(r.make().decisions().origins, {});
	writeFileSync(
		r.filePath,
		JSON.stringify({
			version: 1,
			origins: {
				"http://evil.example": { audio: "allow" },
				[MEET]: { audio: "yes" },
			},
		}),
	);
	assert.deepEqual(
		r.make().decisions().origins,
		{},
		"insecure origins and bad values are dropped",
	);
});

/** A TCC stand-in whose `ask` stays open until the test resolves it, so an OS
 * prompt can be outlived by a navigation or tab close (review R2). */
function heldAsk() {
	const waiting = [];
	return {
		ask: async () => new Promise((resolve) => waiting.push(resolve)),
		answer: async (granted) => {
			for (const resolve of waiting.splice(0)) resolve(granted);
			await new Promise((resolve) => setImmediate(resolve));
		},
	};
}

test("Q1/U1: a <usermedia> element request (no mediaTypes) prompts for camera + microphone, two requests share one prompt", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	// Measured on Electron 45.1.0: each element click sends TWO `media` requests
	// whose details carry no `mediaTypes` key at all.
	const first = r.request(user, undefined);
	const second = r.request(user, []);
	assert.deepEqual(first, [], "held, not denied");
	assert.deepEqual(second, []);
	const prompt = r.media.viewFor(1);
	assert.equal(prompt?.kind, "prompt");
	assert.deepEqual(prompt.kinds, ["audio", "video"]);
	await r.media.decide(1, prompt.id, "allow", { trusted: true });
	assert.deepEqual(
		[first, second],
		[[true], [true]],
		"one decision answers both",
	);
	assert.equal(r.media.viewFor(1), null, "no second prompt");
	assert.deepEqual(r.media.decisions().origins[MEET], {
		audio: "allow",
		video: "allow",
	});
	// The page's follow-up getUserMedia is now granted without a prompt.
	assert.deepEqual(r.request(user, ["audio", "video"]), [true]);
	// A request naming only devices that are not camera/microphone stays denied.
	assert.deepEqual(r.request(user, ["screen"]), [false]);
	// R3: the report names what the request named ([] for the element's).
	const reports = r.seen.filter((d) => d.source === "request");
	assert.deepEqual(reports[0].mediaTypes, []);
});

test("R3: the check report carries the device it was asked about", (t) => {
	const r = rig();
	t.after(r.cleanup);
	r.check(view(11), "video");
	const report = r.seen.find((d) => d.source === "check");
	assert.deepEqual(report.mediaTypes, ["video"]);
	const index = readFileSync("src/main/browser/index.ts", "utf8");
	assert.match(index, LOGS_MEDIA_TYPES, "the log line prints it");
});

test("R1: a decision settles the tab's other waiting requests from the same origin", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	// Allow mic+cam also grants a mic-only request queued behind it.
	const both = r.request(user, ["audio", "video"]);
	const mic = r.request(user, ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "allow", { trusted: true });
	assert.deepEqual([both, mic], [[true], [true]]);
	assert.equal(r.media.viewFor(1), null, "the user is not asked again");

	// Block mic+cam also denies a camera-only request queued behind it.
	const r2 = rig();
	t.after(r2.cleanup);
	const both2 = r2.request(user, ["audio", "video"]);
	const cam = r2.request(user, ["video"]);
	await r2.media.decide(1, r2.media.viewFor(1).id, "block", { trusted: true });
	assert.deepEqual([both2, cam], [[false], [false]]);
	assert.equal(r2.media.viewFor(1), null);

	// A mic-only Allow does NOT settle a waiting mic+cam request: camera is
	// still undecided, so that one keeps asking.
	const r3 = rig();
	t.after(r3.cleanup);
	const mic3 = r3.request(user, ["audio"]);
	const both3 = r3.request(user, ["audio", "video"]);
	await r3.media.decide(1, r3.media.viewFor(1).id, "allow", { trusted: true });
	assert.deepEqual(mic3, [true]);
	assert.deepEqual(both3, [], "still waiting");
	assert.deepEqual(r3.media.viewFor(1)?.kinds, ["audio", "video"]);
});

test("R1 merge rule: decisions are per device, so a later Block cannot clobber another device's Allow", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	r.request(user, ["video"]);
	await r.media.decide(1, r.media.viewFor(1).id, "allow", { trusted: true });
	r.request(user, ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "block", { trusted: true });
	assert.deepEqual(r.media.decisions().origins[MEET], {
		video: "allow",
		audio: "block",
	});
	assert.deepEqual(r.request(user, ["video"]), [true], "camera still allowed");
	assert.deepEqual(
		r.request(user, ["audio", "video"]),
		[false],
		"any block denies",
	);
});

test("U2: a remembered Block raises the blocked band; a trusted Allow there recovers without Forget", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	r.request(user, ["audio", "video"]);
	await r.media.decide(1, r.media.viewFor(1).id, "block", { trusted: true });
	assert.equal(r.media.viewFor(1), null, "the Block itself shows nothing");
	// The user clicks Meet's button again: denied at once, band explains it.
	assert.deepEqual(r.request(user, ["audio", "video"]), [false]);
	const band = r.media.viewFor(1);
	assert.equal(band?.kind, "blocked");
	assert.deepEqual(band.kinds, ["audio", "video"]);
	assert.equal(band.origin, MEET);
	// An untrusted Allow changes nothing.
	assert.equal(
		await r.media.decide(1, band.id, "allow", { trusted: false }),
		false,
	);
	assert.equal(r.media.decisions().origins[MEET].audio, "block");
	// A human Allow flips the remembered answer; the next attempt is granted.
	assert.equal(
		await r.media.decide(1, band.id, "allow", { trusted: true }),
		true,
	);
	assert.equal(r.media.viewFor(1), null);
	assert.deepEqual(r.media.decisions().origins[MEET], {
		audio: "allow",
		video: "allow",
	});
	assert.deepEqual(r.request(user, ["audio", "video"]), [true]);
});

test("U2: dismissing the blocked band hides it for the tab until it navigates; agent tabs get none", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const user = view(11);
	r.request(user, ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "block", { trusted: true });
	r.request(user, ["audio"]);
	const band = r.media.viewFor(1);
	assert.equal(
		await r.media.decide(1, band.id, "dismiss", { trusted: true }),
		true,
	);
	assert.equal(r.media.viewFor(1), null);
	assert.deepEqual(r.request(user, ["audio"]), [false]);
	assert.equal(r.media.viewFor(1), null, "dismissed per tab");
	r.media.clearTab(1); // navigation
	r.request(user, ["audio"]);
	assert.equal(r.media.viewFor(1)?.kind, "blocked", "back after navigation");
	// An agent-owned tab is denied by the user's Block with no band.
	assert.deepEqual(r.request(view(22), ["audio"]), [false]);
	assert.equal(r.media.viewFor(2), null);
});

test("Q2: Block on an agent-owned tab is one-shot, not persisted", async (t) => {
	const r = rig();
	t.after(r.cleanup);
	const agent = view(22);
	const a = r.request(agent, ["audio"]);
	await r.media.decide(2, r.media.viewFor(2).id, "block", { trusted: true });
	assert.deepEqual(a, [false]);
	assert.equal(r.media.decisions().origins[MEET], undefined, "nothing stored");
	// The user's own tab still prompts.
	r.request(view(11), ["audio"]);
	assert.equal(r.media.viewFor(1)?.kind, "prompt");
});

test("R2: an OS ask that outlives navigation or tab close answers false and raises no notice", async (t) => {
	for (const [label, leave] of [
		["navigation", (m) => m.clearTab(1)],
		["tab close", (m) => m.forget(1)],
	]) {
		for (const granted of [true, false]) {
			const held = heldAsk();
			const r = rig({ tcc: { audio: "not-determined", video: "granted" } });
			t.after(r.cleanup);
			r.media.options.system.ask = held.ask;
			const answers = r.request(view(11), ["audio"]);
			const deciding = r.media.decide(1, r.media.viewFor(1).id, "allow", {
				trusted: true,
			});
			await new Promise((resolve) => setImmediate(resolve));
			leave(r.media);
			await held.answer(granted);
			await deciding;
			assert.deepEqual(answers, [false], `${label}, OS said ${granted}`);
			assert.equal(r.media.viewFor(1), null, `${label}: no stale notice`);
		}
	}
});

test("R2: the normal stop path disposes the media permissions", () => {
	const index = readFileSync("src/main/browser/index.ts", "utf8");
	const stop = index.slice(
		index.indexOf("unregisterBrowserIpc();\n\t\t\t\tdetachSessionHandlers();"),
	);
	assert.match(stop.slice(0, 400), DISPOSES_MEDIA);
});

test("U6/D3: Open System Settings resolves a LIVE notice to a fixed pane URL only", async (t) => {
	const { SYSTEM_SETTINGS_URL } = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	assert.deepEqual(SYSTEM_SETTINGS_URL, {
		camera:
			"x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
		microphone:
			"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
	});
	const r = rig({ tcc: { audio: "denied", video: "granted" } });
	t.after(r.cleanup);
	r.request(view(11), ["audio"]);
	await r.media.decide(1, r.media.viewFor(1).id, "allow", { trusted: true });
	const notice = r.media.viewFor(1);
	assert.equal(notice.kind, "system-blocked");
	assert.equal(r.media.systemSettingsPaneFor(1, notice.id), "microphone");
	assert.equal(r.media.systemSettingsPaneFor(1, "forged"), null);
	assert.equal(r.media.systemSettingsPaneFor(2, notice.id), null);
	const ipc = readFileSync("src/main/browser/ipc.ts", "utf8");
	const handler = ipc.slice(
		ipc.indexOf('"browser-media-permission-open-settings",\n\t\tasync'),
	);
	assert.match(handler.slice(0, 300), SENDER_CHECK, "sender-checked");
	const index = readFileSync("src/main/browser/index.ts", "utf8");
	assert.match(index, OPENS_FIXED_PANE);
});
