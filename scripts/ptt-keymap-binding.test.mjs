import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PUSH-TO-TALK ROW -> THE RENDERER'S BINDING (the keymap seam's own test).
 *
 * `keymap.push_to_talk` (local-operator, the bare-modifier hold family) stores
 * one of six tokens; this file drives the shipped resolver through its real
 * read path - `refreshPushToTalkBinding()` asks the desktop transport
 * (`settings.list`), the resolver answers from what came back - and pins:
 *
 *   1. the DEFAULT behaviour does not move: the registry's default token
 *      (`alt-right-hold`) resolves to today's binding on every platform
 *      (macOS `AltRight`/"Right-Option", elsewhere `MetaRight`/"Right-Command");
 *   2. the label FOLLOWS the token (the registry's own per-platform scheme),
 *      so no second hand-written string can teach a binding the matcher does
 *      not use;
 *   3. unset/unknown/invalid values and a dead transport fall back - the
 *      composer never crashes, and both tooltips always have a label;
 *   4. a transport blip does not clobber a binding that was already resolved.
 *
 * The transport is stubbed at the module boundary (the in-repo pattern: an
 * esbuild fixture for `@shared/api/local-operator/desktop-api`), because what
 * this file is about is the mapping contract, not IPC; the live read path is
 * exercised by the STT rig's session F.
 */

const fixtures = {
	"desktop-api": `
		export function desktopResult(request) {
			return globalThis.__transport(request);
		}
	`,
};

const bundle = await build({
	stdin: {
		contents:
			'export { resolvePushToTalkBinding, refreshPushToTalkBinding, pushToTalkBindingForToken } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			name: "headless-fixtures",
			setup(builder) {
				builder.onResolve(
					{ filter: /^@shared\/api\/local-operator\/desktop-api$/ },
					() => ({ path: "desktop-api", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
					contents: fixtures[args.path],
					loader: "js",
				}));
			},
		},
	],
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundlePath = new URL(`./_ptt-keymap-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	resolvePushToTalkBinding,
	refreshPushToTalkBinding,
	pushToTalkBindingForToken,
} = await import(bundlePath.href);
await unlink(bundlePath);

/** The renderer reads `navigator.platform` per call; drive it per case. */
const setPlatform = (platform) =>
	Object.defineProperty(globalThis, "navigator", {
		value: { platform },
		configurable: true,
	});

const DARWIN = "MacIntel";
const WIN32 = "Win32";
const LINUX = "Linux x86_64";

let transportCalls = 0;
/** What `settings.list` answers next; `null` means "throw" (a dead plane). */
let nextSettings = null;
globalThis.__transport = async () => {
	transportCalls += 1;
	if (nextSettings === null) throw new Error("settings plane unreachable");
	return nextSettings;
};

const rowFor = (value) => ({
	sections: [],
	settings: [{ key: "keymap.push_to_talk", value }],
});

/** Resolve after one read returning `value` (or a failure when `null`). */
const resolvedWith = async (value) => {
	nextSettings = value === null ? null : rowFor(value);
	await refreshPushToTalkBinding();
	return resolvePushToTalkBinding();
};

const DEFAULTS = {
	[DARWIN]: { code: "AltRight", label: "Right-Option" },
	[WIN32]: { code: "MetaRight", label: "Right-Command" },
	[LINUX]: { code: "MetaRight", label: "Right-Command" },
};

test("before any read, the resolver serves today's platform default", () => {
	for (const platform of [DARWIN, WIN32, LINUX]) {
		setPlatform(platform);
		assert.deepEqual(
			resolvePushToTalkBinding(),
			DEFAULTS[platform],
			`${platform}: the cold resolver must not depend on the read`,
		);
	}
});

test("a dead transport on a cold start falls back rather than throwing", async () => {
	for (const platform of [DARWIN, WIN32, LINUX]) {
		setPlatform(platform);
		const binding = await resolvedWith(null);
		assert.deepEqual(binding, DEFAULTS[platform]);
	}
});

/*
 * THE TABLE. Every token on every platform family, from the shipped resolver.
 * The label column is the registry's own scheme (alt -> Option/Command,
 * meta -> Command/Win/Super, ctrl -> Control); the settings surface renders
 * the same scheme with " (hold)" appended.
 */
const TABLE = {
	[DARWIN]: {
		"alt-right-hold": { code: "AltRight", label: "Right-Option" },
		"alt-left-hold": { code: "AltLeft", label: "Left-Option" },
		"meta-right-hold": { code: "MetaRight", label: "Right-Command" },
		"meta-left-hold": { code: "MetaLeft", label: "Left-Command" },
		"ctrl-right-hold": { code: "ControlRight", label: "Right-Control" },
		"ctrl-left-hold": { code: "ControlLeft", label: "Left-Control" },
	},
	[WIN32]: {
		"alt-right-hold": { code: "MetaRight", label: "Right-Command" },
		"alt-left-hold": { code: "MetaLeft", label: "Left-Command" },
		"meta-right-hold": { code: "MetaRight", label: "Right-Win" },
		"meta-left-hold": { code: "MetaLeft", label: "Left-Win" },
		"ctrl-right-hold": { code: "ControlRight", label: "Right-Control" },
		"ctrl-left-hold": { code: "ControlLeft", label: "Left-Control" },
	},
	[LINUX]: {
		"alt-right-hold": { code: "MetaRight", label: "Right-Command" },
		"alt-left-hold": { code: "MetaLeft", label: "Left-Command" },
		"meta-right-hold": { code: "MetaRight", label: "Right-Super" },
		"meta-left-hold": { code: "MetaLeft", label: "Left-Super" },
		"ctrl-right-hold": { code: "ControlRight", label: "Right-Control" },
		"ctrl-left-hold": { code: "ControlLeft", label: "Left-Control" },
	},
};

test("every stored token resolves to its code and label on every platform", async () => {
	for (const platform of [DARWIN, WIN32, LINUX]) {
		setPlatform(platform);
		for (const [token, expected] of Object.entries(TABLE[platform])) {
			const binding = await resolvedWith(token);
			assert.deepEqual(binding, expected, `${platform} ${token}`);
		}
	}
});

test("the default token IS the platform default on every platform", async () => {
	for (const platform of [DARWIN, WIN32, LINUX]) {
		setPlatform(platform);
		assert.deepEqual(
			await resolvedWith("alt-right-hold"),
			DEFAULTS[platform],
			platform,
		);
	}
});

test("case and whitespace are normalised the way the registry normalises", async () => {
	setPlatform(DARWIN);
	assert.deepEqual(await resolvedWith(" Alt-Left-Hold "), {
		code: "AltLeft",
		label: "Left-Option",
	});
});

test("unknown, invalid and non-string values fall back to the platform default", async () => {
	setPlatform(DARWIN);
	for (const value of [
		"space",
		"alt-middle-hold",
		"alt-left-hold-x",
		"",
		"   ",
		null,
		undefined,
		7,
		{ token: "alt-right-hold" },
		["alt-right-hold"],
	]) {
		assert.deepEqual(
			await resolvedWith(value),
			DEFAULTS[DARWIN],
			JSON.stringify(value),
		);
	}
	/* And the leaf mapper agrees with the resolver about what is not a token. */
	assert.equal(pushToTalkBindingForToken("meta-right"), null);
	assert.equal(pushToTalkBindingForToken(null), null);
});

test("a transport blip keeps the binding that was already resolved", async () => {
	setPlatform(DARWIN);
	assert.deepEqual(await resolvedWith("ctrl-left-hold"), {
		code: "ControlLeft",
		label: "Left-Control",
	});
	const afterBlip = await resolvedWith(null);
	assert.deepEqual(
		afterBlip,
		{ code: "ControlLeft", label: "Left-Control" },
		"a missed read must not silently revert a user's binding",
	);
});

test("concurrent refreshes share one transport call", async () => {
	setPlatform(WIN32);
	nextSettings = rowFor("meta-left-hold");
	const before = transportCalls;
	await Promise.all([
		refreshPushToTalkBinding(),
		refreshPushToTalkBinding(),
		refreshPushToTalkBinding(),
	]);
	assert.equal(transportCalls - before, 1);
	assert.deepEqual(resolvePushToTalkBinding(), {
		code: "MetaLeft",
		label: "Left-Win",
	});
});
