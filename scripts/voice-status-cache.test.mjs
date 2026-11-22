import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * SESSION VOICE'S SLOT HAS ONE SOURCE OF TRUTH: THE `["desktop", "voice"]` QUERY
 * ENTRY (voice QA round 1, Q2).
 *
 * The failure this pins: after a switch A -> B, navigating back to A painted A as
 * voice-on for ~25 s (3/3). `useVoiceStatus` re-applied its cached GET - still
 * naming A - into the store on every remount, and nothing had updated that
 * entry: the control POST's answer and the feed's `voice` frame wrote only the
 * store. The test mounts the SHIPPED hook against a stubbed desktop transport,
 * switches through the shipped `controlVoice`, unmounts, remounts, and reads
 * what the remounted reader sees BEFORE any refetch can answer (the stubbed GET
 * is held open, so only the cache can be speaking).
 */

const mountBundle = await build({
	stdin: {
		contents: `
			export { useVoiceStatus, useVoiceProviders, controlVoice, applyVoiceActive, voiceKeys } from "./src/renderer/src/features/voice/use-voice-status";
			export { readVoiceProviderStatus, isVoiceRefusalCode, VOICE_REFUSAL_CODES } from "./src/shared/desktop-contract";
			export { useVoiceStore } from "./src/renderer/src/features/voice/voice-store";
			export { useVoiceSwitchStore } from "./src/renderer/src/features/voice/use-voice-switch";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
	},
	write: false,
});
const mountPath = new URL(
	`./_voice-status-cache-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

const disposers = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

const A = "a1a1a1a1a1a1";
const B = "b2b2b2b2b2b2";
const slot = (sessionId) =>
	sessionId ? { session_id: sessionId, enabled_at: 1_790_000_000_000 } : null;
const statusBody = (sessionId) => ({
	active: slot(sessionId),
	settings: { max_spoken_chars: 800 },
});

async function rig({ switchOn = true, voiceLevel = 2 } = {}) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const server = { holder: A, holdGets: false, gets: 0, extra: {} };
	dom.window.api = {
		desktop: {
			request: async (request) => {
				if (request.op === "voice.status") {
					server.gets += 1;
					if (server.holdGets) return new Promise(() => undefined);
					return {
						status: 200,
						body: { result: { ...statusBody(server.holder), ...server.extra } },
					};
				}
				if (request.op === "voice.control") {
					const replaced =
						request.action === "enable" && server.holder !== request.sessionId
							? server.holder
							: null;
					server.holder =
						request.action === "enable" ? request.sessionId : null;
					return {
						status: 200,
						body: { result: { active: slot(server.holder), replaced } },
					};
				}
				return { status: 404, body: { detail: "rig: no op" } };
			},
		},
	};
	const mod = await import(`${mountPath.href}?${Math.random()}`);
	// The switch is OFF by default (89804f3b1) and gates the status query; these
	// cases are about voice ON. Each rig imports a fresh module, so no leakage.
	mod.useVoiceSwitchStore.setState({ enabled: switchOn });
	const { createRoot } = await import("react-dom/client");
	/*
	 * `gcTime: Infinity` because an unmounted query otherwise arms a 5-minute
	 * collection timer, which holds this file's process open after the last test
	 * (measured: the file never exited without `--test-force-exit`).
	 */
	const client = new mod.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(mod.desktopKeys.capabilities, {
		desktop_available: true,
		features: { voice: voiceLevel },
	});
	const seen = { current: null };
	const Probe = () => {
		seen.current = mod.useVoiceStatus();
		return null;
	};
	let root = null;
	const mount = async () => {
		root = createRoot(dom.window.document.getElementById("root"));
		await act(async () => {
			root.render(
				React.createElement(
					mod.QueryClientProvider,
					{ client },
					React.createElement(Probe),
				),
			);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	};
	const unmount = async () => {
		await act(async () => root.unmount());
	};
	disposers.push(() => {
		client.clear();
		dom.window.close();
	});
	return { mod, client, server, seen, mount, unmount, dom };
}

/*
 * `features.voice` 2 is the level that has the speech route (the backend's own
 * comment, local_operator/server/features.py): a renderer on a backend at 1 has
 * a voice toggle but nothing to hear or speak with, so it shows no voice at all.
 */
test("CAPABILITY: a backend on features.voice 1 serves no voice - the status is never read", async () => {
	const { server, seen, mount, unmount } = await rig({ voiceLevel: 1 });
	await mount();
	assert.equal(server.gets, 0, "voice.status is not asked");
	assert.equal(seen.current.activeSessionId, null);
	await unmount();
});

test("CAPABILITY: a backend on features.voice 2 is read", async () => {
	const { server, mount, unmount } = await rig({ voiceLevel: 2 });
	await mount();
	assert.ok(server.gets >= 1);
	await unmount();
});

test("Q2: a view remounted after a switch shows the NEW holder, before any refetch", async () => {
	const { mod, client, server, seen, mount, unmount } = await rig();
	await mount();
	assert.equal(seen.current.activeSessionId, A, "first read: A holds");
	await unmount();

	// The switch, through the shipped control path, while A's view is gone.
	const result = await mod.controlVoice("enable", B, client);
	assert.equal(result.replaced, A);
	assert.equal(
		client.getQueryData(mod.voiceKeys.status).active.session_id,
		B,
		"the control answer wrote the one cache entry",
	);

	// Any refetch the remount triggers never answers: only the cache can speak.
	server.holdGets = true;
	await mount();
	assert.equal(seen.current.activeSessionId, B, "the remounted reader sees B");
	assert.equal(
		mod.useVoiceStore.getState().active?.session_id,
		B,
		"the store was not rolled back to A by the remount",
	);
	await unmount();
});

test("Q2: a feed frame updates the same entry, so a remount agrees with the feed", async () => {
	const { mod, client, server, seen, mount, unmount } = await rig();
	await mount();
	assert.equal(seen.current.activeSessionId, A);
	await unmount();

	// Out of band: another window (or the API) moved the slot; the feed says so.
	server.holder = B;
	mod.applyVoiceActive(slot(B), client);
	server.holdGets = true;
	await mount();
	assert.equal(seen.current.activeSessionId, B);

	// And a disable via the feed clears it for every reader.
	mod.applyVoiceActive(null, client);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
	assert.equal(seen.current.activeSessionId, null);
	await unmount();
});

test("Q2: a GET already in flight when the slot moves cannot land the old holder", async () => {
	const { mod, client, server, seen, mount, unmount } = await rig();
	await mount();
	// A slow read starts while A holds...
	let release;
	server.holdGets = false;
	const slowAnswer = new Promise((resolve) => {
		release = resolve;
	});
	window.api.desktop.request = (
		(original) => async (request) =>
			request.op === "voice.status"
				? slowAnswer.then(() => ({
						status: 200,
						body: { result: statusBody(A) },
					}))
				: original(request)
	)(window.api.desktop.request);
	const refetch = client.invalidateQueries({ queryKey: mod.voiceKeys.status });
	// ...and the slot moves before it answers.
	await mod.controlVoice("enable", B, client);
	release();
	await refetch.catch(() => undefined);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	assert.equal(
		seen.current.activeSessionId,
		B,
		"the stale answer was cancelled, not applied",
	);
	await unmount();
});

test("SWITCH: with the switch off no GET /voice is made and the holder stays null", async () => {
	const { mod, server, seen, mount, unmount } = await rig({ switchOn: false });
	await mount();
	assert.equal(server.gets, 0, "no voice.status request while off");
	assert.equal(mod.useVoiceStore.getState().active, undefined, "never applied");
	assert.equal(seen.current.activeSessionId, null);
	await unmount();
});

/*
 * THE ONE SPEECH PROVIDER (backend `speech.provider`, `GET /v1/desktop/voice`).
 * `provider` is the choice (null = none chosen) and `providers` says whether each
 * could serve; an older backend sends neither, and that must read as "no choice"
 * and "no readiness", never as ready.
 */
const READY = { ready: true, reason: null };
const NO_KEY = { ready: false, reason: "No ElevenLabs API key is stored." };

test("PROVIDER: the reader keeps a chosen provider and each one's readiness", () => {
	return import(`${mountPath.href}?${Math.random()}`).then((mod) => {
		assert.deepEqual(
			mod.readVoiceProviderStatus({
				active: null,
				provider: "elevenlabs",
				providers: { radient: READY, elevenlabs: NO_KEY },
			}),
			{
				provider: "elevenlabs",
				providers: { radient: READY, elevenlabs: NO_KEY },
			},
		);
		assert.equal(
			mod.readVoiceProviderStatus({ provider: null, providers: null }).provider,
			null,
		);
	});
});

test("PROVIDER: an older backend, junk and an old stored value all read as 'none chosen'", async () => {
	const mod = await import(`${mountPath.href}?${Math.random()}`);
	const none = { provider: null, providers: null };
	for (const input of [
		undefined,
		null,
		"x",
		7,
		{},
		{ active: null },
		{ provider: "openai" },
		{ provider: "local" },
		{ provider: "byok" },
		{ provider: 3 },
	]) {
		assert.deepEqual(mod.readVoiceProviderStatus(input), none, String(input));
	}
	// A readiness entry that is not {ready: boolean} is "not ready", with no
	// sentence invented for it; a missing one is "not ready" too.
	const partial = mod.readVoiceProviderStatus({
		provider: "radient",
		providers: { radient: { ready: "yes" }, elevenlabs: { ready: true } },
	});
	assert.deepEqual(partial.providers.radient, { ready: false, reason: null });
	assert.deepEqual(partial.providers.elevenlabs, { ready: true, reason: null });
	const missing = mod.readVoiceProviderStatus({
		provider: "radient",
		providers: { radient: READY },
	});
	assert.deepEqual(missing.providers.elevenlabs, {
		ready: false,
		reason: null,
	});
});

test("PROVIDER: the provider-unset refusal is a declared voice code", async () => {
	const mod = await import(`${mountPath.href}?${Math.random()}`);
	assert.equal(mod.isVoiceRefusalCode("voice_provider_unset"), true);
});

test("PROVIDER: the Settings reader sees provider and readiness with the voice switch OFF", async () => {
	const { mod, server, mount, unmount, dom } = await rig({ switchOn: false });
	server.extra = {
		provider: "radient",
		providers: { radient: READY, elevenlabs: NO_KEY },
	};
	const seen = { current: null };
	const { createRoot } = await import("react-dom/client");
	const client = new mod.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(mod.desktopKeys.capabilities, {
		desktop_available: true,
		features: { voice: 2 },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				mod.QueryClientProvider,
				{ client },
				React.createElement(() => {
					seen.current = mod.useVoiceProviders();
					return null;
				}),
			),
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	assert.equal(server.gets, 1, "the settings read asks once");
	assert.equal(seen.current.provider, "radient");
	assert.deepEqual(seen.current.providers.elevenlabs, NO_KEY);
	await act(async () => root.unmount());
	void mount;
	void unmount;
});
