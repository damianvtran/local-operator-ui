import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const packageRequire = createRequire(
	require.resolve("electron-chrome-extensions"),
);
const root = dirname(
	dirname(dirname(require.resolve("electron-chrome-extensions"))),
);
const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// Chrome's runtime.lastError strings, verbatim.
const INVALID_NAME = "Invalid native messaging host name specified.";
const NOT_FOUND = "Specified native messaging host not found.";
const FORBIDDEN = "Access to the specified native messaging host is forbidden.";
const EXITED = "Native host has exited.";
const sentinel = "SYNTHETIC-SECRET-DO-NOT-LOG";
function ipc() {
	const emitter = new EventEmitter();
	emitter.handlers = new Map();
	emitter.handle = (name, fn) => emitter.handlers.set(name, fn);
	return emitter;
}
/**
 * `authorize`: the embedder's authorizeNativeMessaging predicate (undefined =
 * none bound). `real`: {home, userData} run the REAL fs/spawn against a
 * scratch home, so a synthetic stdio host can be launched end to end;
 * without it, host lookup and spawn are counting fakes.
 */
async function adapter(
	format,
	authorize,
	permissions = ["nativeMessaging"],
	extra = {},
	real = null,
) {
	const handlers = ipc();
	const logs = [];
	let hostAccess = 0;
	const extension = {
		id: extensionId,
		manifest: {
			permissions,
			manifest_version: 3,
			action: { default_popup: "popup/index.html" },
		},
		url: `chrome-extension://${extensionId}/`,
		path: "/synthetic",
	};
	const ses = Object.assign(new EventEmitter(), {
		extensions: Object.assign(new EventEmitter(), {
			getExtension: () => extension,
			getAllExtensions: () => [extension],
		}),
		serviceWorkers: new EventEmitter(),
		cookies: new EventEmitter(),
		registerPreloadScript() {},
		getPreloads: () => [],
		isPersistent: () => true,
		protocol: { handle() {} },
	});
	const electron = {
		app: Object.assign(new EventEmitter(), {
			getPath: () => real?.userData ?? "/synthetic",
			isReady: () => true,
		}),
		ipcMain: handlers,
		session: { defaultSession: ses },
		nativeTheme: new EventEmitter(),
		webContents: { getAllWebContents: () => [] },
	};
	const file = join(
		root,
		"dist",
		format === "cjs" ? "cjs/index.js" : "esm/index.mjs",
	);
	let code = readFileSync(file, "utf8");
	if (format === "esm")
		code = (await transform(code, { format: "cjs", platform: "node" })).code;
	const module = { exports: {} };
	vm.runInNewContext(code, {
		module,
		exports: module.exports,
		__dirname: dirname(file),
		__filename: file,
		process,
		Buffer,
		URL,
		fetch,
		Response,
		setTimeout,
		clearTimeout,
		queueMicrotask,
		console: Object.fromEntries(
			["log", "warn", "error", "debug"].map((name) => [
				name,
				(...args) => logs.push(args),
			]),
		),
		require: (id) => {
			if (id === "electron") return electron;
			if (id === "debug")
				return Object.assign(
					() =>
						(...args) =>
							logs.push(args),
					{ formatters: {} },
				);
			if (real && id === "node:os")
				return { ...require(id), homedir: () => real.home };
			if (real && id === "node:child_process")
				return {
					...require(id),
					spawn(...args) {
						hostAccess++;
						return require(id).spawn(...args);
					},
				};
			if (real && id === "node:fs") return require(id);
			if (id === "node:child_process")
				return {
					spawn() {
						hostAccess++;
						throw new Error("synthetic spawn reached");
					},
				};
			if (id === "node:fs")
				return {
					...require(id),
					promises: {
						...require(id).promises,
						async readFile() {
							hostAccess++;
							throw Object.assign(new Error("synthetic host lookup reached"), {
								code: "ENOENT",
							});
						},
					},
				};
			return packageRequire(id);
		},
	});
	const options = { session: ses, modulePath: root, ...extra };
	if (authorize !== undefined) options.authorizeNativeMessaging = authorize;
	const instance = new module.exports.ElectronChromeExtensions(options);
	return {
		ses,
		handlers,
		logs,
		instance,
		electron,
		extension,
		hostAccess: () => hostAccess,
	};
}
for (const format of ["cjs", "esm"]) {
	test(`${format}: notifications follow the manifest permission, with no global deny`, async () => {
		for (const permissions of [["notifications"], []]) {
			const rig = await adapter(format, undefined, permissions);
			let constructed = 0;
			let shown = 0;
			rig.electron.Notification = class extends EventEmitter {
				constructor() {
					super();
					constructed++;
				}
				show() {
					shown++;
				}
			};
			const sender = {
				session: rig.ses,
				getURL: () => `${rig.extension.url}popup/index.html`,
			};
			const call = rig.handlers.handlers.get("crx-msg")(
				{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
				extensionId,
				"notifications.create",
				{
					type: "basic",
					iconUrl: "data:image/png;base64,AA==",
					title: "SYNTHETIC-NOTIFICATION-TITLE",
					message: "SYNTHETIC-NOTIFICATION-BODY",
				},
			);
			if (permissions.length) assert.equal(await call, "guid");
			else
				await assert.rejects(call, /requires an extension with notifications/);
			assert.equal(constructed, permissions.length ? 1 : 0);
			assert.equal(shown, permissions.length ? 1 : 0);
			assert.equal(
				JSON.stringify(rig.logs).includes("SYNTHETIC-NOTIFICATION-BODY"),
				false,
			);
		}
	});
	test(`${format}: public action popup override prevents dependency owned window creation`, async () => {
		const requests = [];
		const rig = await adapter(format, undefined, ["nativeMessaging"], {
			openActionPopup: (details) => requests.push(details),
		});
		let nativeWindows = 0;
		const parent = Object.assign(new EventEmitter(), {
			id: 7,
			isDestroyed: () => false,
			isFocused: () => true,
			getSize: () => [1280, 720],
			getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
			getPosition: () => [0, 0],
			isAlwaysOnTop: () => false,
			isFullScreen: () => false,
			isMinimized: () => false,
			isMaximized: () => false,
		});
		const tab = Object.assign(new EventEmitter(), {
			id: 10,
			session: rig.ses,
			isDestroyed: () => false,
			isCurrentlyAudible: () => false,
			isLoading: () => false,
			getTitle: () => "Synthetic",
			getURL: () =>
				"https://example.test/sign-in?code=SYNTHETIC-URL-QUERY#SYNTHETIC-URL-FRAGMENT",
			getType: () => "window",
		});
		rig.electron.BrowserWindow = class {
			constructor() {
				nativeWindows++;
				throw new Error("Uncontrolled native popup");
			}
			static getAllWindows() {
				return [parent];
			}
			static getFocusedWindow() {
				return parent;
			}
		};
		rig.electron.webContents.fromId = (id) => (id === tab.id ? tab : undefined);
		rig.instance.addTab(tab, parent);
		rig.ses.extensions.emit("extension-loaded", {}, rig.extension);
		const event = {
			type: "frame",
			sender: {
				session: rig.ses,
				getURL: () => `${rig.extension.url}popup/index.html`,
			},
			senderFrame: { url: `${rig.extension.url}popup/index.html` },
		};
		await rig.handlers.handlers.get("crx-msg")(
			event,
			extensionId,
			"browserAction.openPopup",
			{ windowId: parent.id },
		);
		assert.equal(nativeWindows, 0);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].extensionId, extensionId);
		assert.equal(requests[0].url, `${rig.extension.url}popup/index.html`);
		assert.equal(requests[0].parent, parent);
		const frame = { parent: null, processId: 1, routingId: 2 };
		frame.top = frame;
		tab.emit("did-start-navigation", {
			url: tab.getURL(),
			isSameDocument: false,
			frame,
		});
		const background = Object.assign(new EventEmitter(), {
			session: rig.ses,
			getType: () => "backgroundPage",
			getURL: tab.getURL,
		});
		rig.electron.app.emit("web-contents-created", {}, background);
		assert.equal(
			JSON.stringify(rig.logs).includes("SYNTHETIC-URL-QUERY"),
			false,
		);
		assert.equal(
			JSON.stringify(rig.logs).includes("SYNTHETIC-URL-FRAGMENT"),
			false,
		);
	});
	for (const authorize of [undefined, () => false, () => true]) {
		test(`${format}: an invalid host name never reaches lookup, spawn or the predicate (${typeof authorize})`, async () => {
			let asked = 0;
			const rig = await adapter(
				format,
				authorize &&
					((details) => {
						asked++;
						return authorize(details);
					}),
			);
			for (const type of ["frame", "service-worker"]) {
				const sender = {
					session: rig.ses,
					getURL: () => `chrome-extension://${extensionId}/popup.html`,
					send() {},
					isDestroyed: () => false,
				};
				const worker = {
					...sender,
					scope: `chrome-extension://${extensionId}/`,
					ipc: ipc(),
				};
				rig.ses.serviceWorkers.getWorkerFromVersionID = () => worker;
				rig.ses.serviceWorkers.emit("running-status-changed", {
					runningStatus: "starting",
					versionId: 1,
				});
				const route = type === "frame" ? rig.handlers : worker.ipc;
				const event = {
					type,
					sender,
					senderFrame: { url: sender.getURL() },
					session: rig.ses,
					serviceWorker: worker,
				};
				for (let attempt = 0; attempt < 2; attempt++) {
					for (const [operation, args] of [
						["runtime.connectNative", ["connection", `../../${sentinel}`]],
						[
							"runtime.sendNativeMessage",
							[`../../${sentinel}`, { secret: sentinel }],
						],
					]) {
						const result = await route.handlers.get("crx-msg")(
							event,
							extensionId,
							operation,
							...args,
						);
						assert.equal(result.nativeMessagingError, INVALID_NAME);
					}
				}
			}
			assert.equal(rig.hostAccess(), 0);
			assert.equal(asked, 0);
			assert.equal(JSON.stringify(rig.logs).includes(sentinel), false);
		});
	}
	test(`${format}: an unresolvable host is "not found" before the predicate is asked`, async () => {
		let asked = 0;
		const rig = await adapter(format, () => {
			asked++;
			return true;
		});
		const sender = {
			session: rig.ses,
			getURL: () => `chrome-extension://${extensionId}/popup.html`,
			ipc: ipc(),
			send() {},
		};
		const result = await rig.handlers.handlers.get("crx-msg")(
			{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
			extensionId,
			"runtime.connectNative",
			"synthetic-connection",
			"synthetic_app",
		);
		assert.ok(rig.hostAccess() > 0, "the lookup ran");
		assert.equal(result.nativeMessagingError, NOT_FOUND);
		assert.equal(asked, 0, "no consent question for a host that is not there");
	});
	test(`${format}: missing nativeMessaging permission still rejected`, async () => {
		const rig = await adapter(format, () => true, []);
		const sender = {
			session: rig.ses,
			getURL: () => `chrome-extension://${extensionId}/popup.html`,
		};
		await assert.rejects(
			rig.handlers.handlers.get("crx-msg")(
				{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
				extensionId,
				"runtime.sendNativeMessage",
				"app",
				{},
			),
		);
		assert.equal(rig.hostAccess(), 0);
	});
}

/**
 * End-to-end through the REAL patched library: a synthetic stdio host (a
 * tiny Node echo program) is installed into a scratch userData's
 * NativeMessagingHosts directory and launched by the library's own spawn.
 * Nothing touches the operator's real Chrome host directory: `os.homedir()`
 * is the scratch home for the library under test.
 */
async function hostRig(t, format, authorize, origins) {
	const base = await mkdtemp(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "native-host-"),
	);
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = join(base, "home");
	const userData = join(base, "userData");
	const dir = join(userData, "NativeMessagingHosts");
	await mkdir(dir, { recursive: true });
	await mkdir(home, { recursive: true });
	const program = join(base, "bin", "echo-host.js");
	await mkdir(dirname(program), { recursive: true });
	await writeFile(
		program,
		`#!${process.execPath}
let buffer = Buffer.alloc(0);
const frame = (value) => {
	const body = Buffer.from(JSON.stringify(value));
	const head = Buffer.alloc(4);
	head.writeUInt32LE(body.length);
	return Buffer.concat([head, body]);
};
process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	while (buffer.length >= 4) {
		const length = buffer.readUInt32LE(0);
		if (buffer.length < 4 + length) return;
		const message = JSON.parse(buffer.subarray(4, 4 + length).toString());
		buffer = buffer.subarray(4 + length);
		if (message.exit) process.exit(0);
		const reply = { echo: message, origin: process.argv[2], cwd: process.cwd(), pid: process.pid, big: "€".repeat(message.big ?? 0) };
		// "twice": two frames in ONE write, the case upstream dropped.
		process.stdout.write(message.twice ? Buffer.concat([frame(reply), frame({ second: true })]) : frame(reply));
	}
});
`,
	);
	await chmod(program, 0o755);
	await writeFile(
		join(dir, `${HOST}.json`),
		JSON.stringify({
			name: HOST,
			description: "Synthetic Echo Host",
			path: program,
			type: "stdio",
			allowed_origins: origins ?? [`chrome-extension://${extensionId}/`],
		}),
	);
	const asked = [];
	const rig = await adapter(
		format,
		authorize &&
			((details) => {
				asked.push(details);
				return authorize(details);
			}),
		["nativeMessaging"],
		{},
		{ home, userData },
	);
	// A failed assertion must not leave a synthetic host (or this test file)
	// running: close whatever the library still holds.
	t.after(() => rig.instance.disconnectNativeHosts(extensionId));
	const sent = [];
	const sender = Object.assign(new EventEmitter(), {
		session: rig.ses,
		getURL: () => `chrome-extension://${extensionId}/background.html`,
		ipc: ipc(),
		send: (channel, ...args) => sent.push([channel, ...args]),
		isDestroyed: () => false,
	});
	const call = (operation, ...args) =>
		rig.handlers.handlers.get("crx-msg")(
			{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
			extensionId,
			operation,
			...args,
		);
	return { ...rig, asked, sent, sender, call, program };
}
const HOST = "com.local_operator.test_echo";
// The library runs in a vm realm: compare its objects structurally.
const plain = (value) => JSON.parse(JSON.stringify(value));
async function until(predicate, what) {
	const deadline = Date.now() + 10_000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

for (const format of ["cjs", "esm"]) {
	test(`${format}: allowed host round-trips over a Port (framing, UTF-8, cwd, origin) and revoke kills it`, async (t) => {
		const rig = await hostRig(t, format, () => true);
		assert.equal(
			await rig.call("runtime.connectNative", "port-1", HOST),
			undefined,
		);
		assert.equal(rig.asked.length, 1);
		assert.deepEqual(
			{ ...rig.asked[0], host: { ...rig.asked[0].host } },
			{
				extensionId,
				application: HOST,
				senderUrl: `chrome-extension://${extensionId}/background.html`,
				host: {
					name: HOST,
					description: "Synthetic Echo Host",
					path: rig.program,
				},
			},
		);
		const replies = () =>
			rig.sent.filter(([channel]) => channel === "crx-native-msg-port-1");
		// 300k three-byte characters: a ~900 KB reply spans many pipe reads.
		rig.sender.ipc.emit(
			"crx-native-msg-port-1",
			{},
			{ hello: "wörld ✓", big: 300_000 },
		);
		await until(() => replies().length === 1, "the large reply");
		const [, reply] = replies()[0];
		assert.deepEqual(plain(reply.echo), { hello: "wörld ✓", big: 300_000 });
		assert.equal(reply.big.length, 300_000);
		assert.equal(reply.origin, `chrome-extension://${extensionId}/`);
		assert.equal(reply.cwd, await realpath(dirname(rig.program)));
		rig.sender.ipc.emit("crx-native-msg-port-1", {}, { twice: true });
		await until(() => replies().length === 3, "both frames of one write");
		assert.deepEqual(plain(replies()[2][1]), { second: true });
		assert.ok(alive(reply.pid));
		assert.equal(rig.instance.disconnectNativeHosts(extensionId, HOST), 1);
		await until(() => !alive(reply.pid), "the revoked host to exit");
		assert.deepEqual(
			rig.sent.find(
				([channel]) => channel === "crx-native-msg-port-1-disconnect",
			),
			["crx-native-msg-port-1-disconnect", FORBIDDEN],
		);
		assert.equal(rig.instance.disconnectNativeHosts(extensionId, HOST), 0);
	});

	test(`${format}: a refused or foreign host never spawns; host exit disconnects with Chrome's lastError`, async (t) => {
		const refused = await hostRig(t, format, () => false);
		assert.deepEqual(
			{ ...(await refused.call("runtime.connectNative", "port-1", HOST)) },
			{ nativeMessagingError: FORBIDDEN },
		);
		assert.deepEqual(
			{ ...(await refused.call("runtime.sendNativeMessage", HOST, { a: 1 })) },
			{ nativeMessagingError: FORBIDDEN },
		);
		assert.equal(refused.hostAccess(), 0, "no spawn without consent");
		// A predicate that throws is a refusal, not a crash.
		const throwing = await hostRig(t, format, () => {
			throw new Error("synthetic");
		});
		assert.equal(
			(await throwing.call("runtime.connectNative", "port-1", HOST))
				.nativeMessagingError,
			FORBIDDEN,
		);
		// allowed_origins without this extension: forbidden BEFORE consent.
		const foreign = await hostRig(t, format, () => true, [
			`chrome-extension://${"b".repeat(32)}/`,
		]);
		assert.equal(
			(await foreign.call("runtime.connectNative", "port-1", HOST))
				.nativeMessagingError,
			FORBIDDEN,
		);
		assert.equal(foreign.asked.length, 0);
		assert.equal(foreign.hostAccess(), 0);
		// The host itself exits: the port hears "Native host has exited.".
		const rig = await hostRig(t, format, () => true);
		await rig.call("runtime.connectNative", "port-2", HOST);
		rig.sender.ipc.emit("crx-native-msg-port-2", {}, { exit: true });
		await until(
			() =>
				rig.sent.some(
					([channel]) => channel === "crx-native-msg-port-2-disconnect",
				),
			"the exit disconnect",
		);
		assert.deepEqual(
			rig.sent.find(
				([channel]) => channel === "crx-native-msg-port-2-disconnect",
			),
			["crx-native-msg-port-2-disconnect", EXITED],
		);
	});

	test(`${format}: sendNativeMessage answers once and closes the host; unload and frame teardown close ports`, async (t) => {
		const rig = await hostRig(t, format, () => true);
		const reply = await rig.call("runtime.sendNativeMessage", HOST, {
			ping: "π",
		});
		assert.deepEqual(plain(reply.echo), { ping: "π" });
		await until(() => !alive(reply.pid), "the one-shot host to exit");
		// A host that exits without answering resolves with lastError, never hangs.
		assert.deepEqual(
			{
				...(await rig.call("runtime.sendNativeMessage", HOST, { exit: true })),
			},
			{ nativeMessagingError: EXITED },
		);
		// Disable/remove (extension-unloaded) ends the extension's hosts.
		await rig.call("runtime.connectNative", "port-3", HOST);
		rig.sender.ipc.emit("crx-native-msg-port-3", {}, { n: 1 });
		await until(
			() => rig.sent.some(([channel]) => channel === "crx-native-msg-port-3"),
			"port-3 reply",
		);
		const pid3 = rig.sent.find(
			([channel]) => channel === "crx-native-msg-port-3",
		)[1].pid;
		rig.ses.extensions.emit("extension-unloaded", {}, rig.extension);
		await until(() => !alive(pid3), "unload to end the host");
		// The calling page going away ends its port's host, as in Chrome.
		await rig.call("runtime.connectNative", "port-4", HOST);
		rig.sender.ipc.emit("crx-native-msg-port-4", {}, { n: 2 });
		await until(
			() => rig.sent.some(([channel]) => channel === "crx-native-msg-port-4"),
			"port-4 reply",
		);
		const pid4 = rig.sent.find(
			([channel]) => channel === "crx-native-msg-port-4",
		)[1].pid;
		rig.sender.emit("destroyed");
		await until(() => !alive(pid4), "frame teardown to end the host");
	});

	test(`${format}: messages posted while consent is pending reach the host in order`, async (t) => {
		// Regression (found by the real Electron probe): 1Password posts on the
		// Port immediately after connectNative; those messages arrive while the
		// host is still being resolved/consented and were dropped.
		let answer;
		const rig = await hostRig(
			t,
			format,
			() =>
				new Promise((resolve) => {
					answer = resolve;
				}),
		);
		const connecting = rig.call("runtime.connectNative", "port-6", HOST);
		rig.sender.ipc.emit("crx-native-msg-port-6", {}, { n: 1 });
		rig.sender.ipc.emit("crx-native-msg-port-6", {}, { n: 2 });
		await until(() => answer, "the consent question");
		answer(true);
		assert.equal(await connecting, undefined);
		const replies = () =>
			rig.sent.filter(([channel]) => channel === "crx-native-msg-port-6");
		await until(() => replies().length === 2, "both early messages answered");
		assert.deepEqual(
			replies().map(([, reply]) => plain(reply.echo)),
			[{ n: 1 }, { n: 2 }],
		);
		assert.equal(rig.sender.ipc.listenerCount("crx-native-msg-port-6"), 1);
	});

	test(`${format}: a port closed while consent is pending never spawns its host`, async (t) => {
		let answer;
		const rig = await hostRig(
			t,
			format,
			() =>
				new Promise((resolve) => {
					answer = resolve;
				}),
		);
		const connecting = rig.call("runtime.connectNative", "port-5", HOST);
		await until(() => answer, "the consent question");
		await rig.call("runtime.disconnectNative", "port-5");
		answer(true);
		assert.equal(await connecting, undefined);
		assert.equal(rig.hostAccess(), 0);
	});
}
