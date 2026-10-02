/**
 * The speech store: keys, the generation guard, the cache cap and the object
 * URL's life.
 *
 * WHAT THIS FILE IS, exactly: the store driven through its own public actions
 * (`speak`, `stopSpeech`, `playSpeech`), with the two pieces of the outside
 * world it touches stubbed AT THE BOUNDARY THE APP USES THEM:
 *
 *   - `Audio` is a fake element, so a press can be observed starting and a
 *     `play()` that resolves is what releases the press (jsdom's own element
 *     logs "not implemented" and the real decoder is QA's business - the E2E
 *     playback capture is scheduled for the QA round, not claimed here);
 *   - `URL.createObjectURL`/`revokeObjectURL` are recorded, because "the URL
 *     that is playing is the URL that is revoked" is the defect this store
 *     previously shipped (it rebuilt a URL from the cached blob and revoked
 *     that one, releasing nothing);
 *   - the toast channel is a recorder, because the store's catch is what
 *     raises the reader-visible failure and the sentence it passes is the
 *     store's answer, not the component's.
 *
 * The generation cases are the point of the file: a slow first response must
 * not start playing after a second press - whichever surface the second press
 * came from, which is exactly why the guard lives in the store and not in a
 * button (the pressed control can now cancel itself, but ANOTHER surface is
 * still live).
 *
 * Its second subject is DISMISSAL (UX round 1, U1): a toolbar that goes away
 * takes its key's audio with it, and the paid synthesis of a cancelled fetch
 * is still kept for a later press (agent review round 1, MINOR-1).
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The regex literals this file uses, hoisted: `scripts/` is held to
 * `useTopLevelRegex` (the fixture filters, and the assertions on the sentences
 * the store composes).
 */
const TOAST_MANAGER_MODULE = /@shared\/utils\/toast-manager/;
const ANY_SPECIFIER = /.*/;
const SELECTION_KEY = /^sel:conv-1:[0-9a-f]{8}$/;
const NO_AUDIO_SENTENCE = /no audio data received/;

/* The stores persist through `localStorage` at module scope. */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/* ------------------------------------------------------------- the fakes */

/** Every fake element this file created, in construction order. */
const fakeAudios = [];
class FakeAudio {
	constructor(src) {
		this.src = src;
		this.played = false;
		this.paused = false;
		this.onended = null;
		this.onerror = null;
		fakeAudios.push(this);
	}
	play() {
		this.played = true;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	/** What a real element would fire when the audio finishes. */
	fireEnded() {
		this.onended?.();
	}
}
globalThis.Audio = FakeAudio;

const urls = { created: [], revoked: [] };
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => {
	const url = `blob:test/${urls.created.length}`;
	urls.created.push(url);
	return url;
};
URL.revokeObjectURL = (url) => {
	urls.revoked.push(url);
};

/* ------------------------------------------------------------ the bundle */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/speech-store";\n' +
			'export { SPEECH_FAILURE_COPY, SPEECH_PLAYBACK_COPY } from "./src/renderer/src/shared/lib/speech-errors";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: ["@tanstack/react-query"],
	plugins: [
		{
			name: "toast-recorder",
			setup(builder) {
				builder.onResolve({ filter: TOAST_MANAGER_MODULE }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: ANY_SPECIFIER, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						const channel = () => (globalThis.__speechToasts ??= { errors: [], infos: [] });
						export const showErrorToast = (message) => { channel().errors.push(message); return "toast"; };
						export const showInfoToast = (message) => { channel().infos.push(message); return "toast"; };
						export const showSuccessToast = (message) => { channel().infos.push(message); return "toast"; };
						export const showWarningToast = (message) => { channel().infos.push(message); return "toast"; };
						export const dismissToast = () => {};
						export const resetToastDedup = () => {};
					`,
				}));
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
});
const bundlePath = new URL(
	`./_speech-store-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const {
	AUDIO_CACHE_LIMIT,
	messageSpeechKey,
	selectionSpeechKey,
	SPEECH_FAILURE_COPY,
	SPEECH_PLAYBACK_COPY,
	useSpeechStore,
} = mod;

const store = useSpeechStore;
const state = () => store.getState();

globalThis.__speechToasts = { errors: [], infos: [] };
const toasts = () => globalThis.__speechToasts;

const reset = () => {
	store.setState({
		audioCache: new Map(),
		heardKeys: new Set(),
		loadingKey: null,
		playingKey: null,
		error: null,
		audioElement: null,
		currentUrl: null,
		generation: 0,
	});
	fakeAudios.length = 0;
	urls.created.length = 0;
	urls.revoked.length = 0;
	toasts().errors.length = 0;
	toasts().infos.length = 0;
};

/* ------------------------------------------------------------- the keys */

test("the key helpers name the two families", () => {
	assert.equal(messageSpeechKey("m-1"), "msg:m-1");
	assert.match(selectionSpeechKey("conv-1", "hello"), SELECTION_KEY);
	assert.equal(
		selectionSpeechKey("conv-1", "hello"),
		selectionSpeechKey("conv-1", "hello"),
		"the same words under the same scope are the same entry",
	);
	assert.notEqual(
		selectionSpeechKey("conv-1", "hello"),
		selectionSpeechKey("conv-1", "hello!"),
		"one character is a different utterance",
	);
	assert.notEqual(
		selectionSpeechKey("conv-1", "hello"),
		selectionSpeechKey("conv-2", "hello"),
		"the same words in another conversation are not the same entry",
	);
});

/* ------------------------------------------------------- a normal press */

test("a press fetches, caches, plays, and owns the playing slot", () => {
	reset();
	return (async () => {
		await state().speak("msg:a", async () => new Blob(["audio"]));
		assert.equal(state().playingKey, "msg:a");
		assert.equal(state().loadingKey, null);
		assert.equal(state().error, null);
		assert.ok(
			state().audioCache.has("msg:a"),
			"the fetched audio is cached for replay",
		);
		assert.equal(fakeAudios.length, 1);
		assert.equal(fakeAudios[0].played, true, "the element was started");
		assert.equal(
			fakeAudios[0].src,
			urls.created[0],
			"the element plays the URL this press created",
		);
	})();
});

test("a cached key replays without a fetch", () => {
	reset();
	return (async () => {
		await state().speak("msg:a", async () => new Blob(["audio"]));
		let fetchedAgain = false;
		await state().speak("msg:a", async () => {
			fetchedAgain = true;
			return new Blob(["other"]);
		});
		assert.equal(fetchedAgain, false, "the fetcher is not consulted on a hit");
		assert.equal(fakeAudios.length, 2, "a second element carries the replay");
		assert.equal(state().playingKey, "msg:a");
	})();
});

test("stopSpeech revokes the URL the element was built from", () => {
	reset();
	return (async () => {
		await state().speak("msg:a", async () => new Blob(["audio"]));
		const url = urls.created[0];
		const createdBeforeStop = urls.created.length;
		state().stopSpeech();
		assert.equal(fakeAudios[0].paused, true, "the element is paused");
		assert.deepEqual(
			urls.revoked,
			[url],
			"the URL the element held is the one revoked",
		);
		assert.equal(
			urls.created.length,
			createdBeforeStop,
			"stop creates no URL of its own - the old bug's second, unrevoked URL",
		);
		assert.equal(state().playingKey, null);
		assert.equal(state().audioElement, null);
	})();
});

test("a finished element clears the slot and revokes its URL", () => {
	reset();
	return (async () => {
		await state().speak("msg:a", async () => new Blob(["audio"]));
		fakeAudios[0].fireEnded();
		assert.equal(state().playingKey, null);
		assert.equal(state().audioElement, null);
		assert.deepEqual(urls.revoked, [urls.created[0]]);
	})();
});

/* --------------------------------------------------------- the races */

test("a slow first response does not start after a second press", () => {
	reset();
	return (async () => {
		let releaseFirst;
		const first = state().speak(
			"msg:first",
			() =>
				new Promise((resolve) => {
					releaseFirst = resolve;
				}),
		);
		const second = state().speak(
			"msg:second",
			async () => new Blob(["second"]),
		);
		await second;
		assert.equal(
			state().playingKey,
			"msg:second",
			"the newer press owns the slot",
		);

		const elementsBefore = fakeAudios.length;
		releaseFirst(new Blob(["first"]));
		await first;
		assert.equal(
			fakeAudios.length,
			elementsBefore,
			"the stale response never builds an element",
		);
		assert.equal(
			state().playingKey,
			"msg:second",
			"and never takes the slot back",
		);
		assert.equal(
			state().audioCache.has("msg:first"),
			true,
			"a superseded response is still cached: the synthesis was paid for (MINOR-1)",
		);
	})();
});

test("a stale failure is silent: the newer press owns the state", () => {
	reset();
	return (async () => {
		let rejectFirst;
		const first = state().speak(
			"msg:first",
			() =>
				new Promise((_resolve, reject) => {
					rejectFirst = reject;
				}),
		);
		await state().speak("msg:second", async () => new Blob(["second"]));

		rejectFirst(new Error("Failed to fetch"));
		await first;
		assert.equal(
			toasts().errors.length,
			0,
			"no toast for a press that was replaced",
		);
		assert.equal(state().error, null);
		assert.equal(state().playingKey, "msg:second");
	})();
});

/* ------------------------------------------------------- the failures */

test("a designed refusal reaches the reader verbatim through the one toast channel", () => {
	reset();
	return (async () => {
		await state().speak("msg:x", async () => {
			throw new Error(
				"Speech is temporarily unavailable. Try again in a moment.",
			);
		});
		assert.equal(
			state().error,
			"Speech is temporarily unavailable. Try again in a moment.",
		);
		assert.equal(state().loadingKey, null, "the press settles out of loading");
		assert.equal(state().playingKey, null);
		assert.deepEqual(
			toasts().errors,
			["Speech is temporarily unavailable. Try again in a moment."],
			"the daemon's designed sentence is kept character-for-character",
		);
	})();
});

test("every designed refusal is kept verbatim (the daemon's set, pinned across repos)", () => {
	/*
	 * The full set `local-operator` #1835 ships, plus agent-server's own base 503
	 * and the two spellings #1835's `bcca80808` retired (both skew entries, kept
	 * because the shipped daemons in the field still emit them until that PR
	 * reaches users), so the mapper's allowlist and the daemon's sentences
	 * cannot drift apart silently. A change on either side must move both - that
	 * is the point of pinning the literals here.
	 *
	 * The four BYO vendor refusals are #1922's additions (`_VENDOR_REFUSAL_SENTENCES`
	 * formatted with `_RUNG_VENDOR_LABELS`, read at that PR's round-2 remediation head
	 * `e4f8d9e8`) - the 401 the daemon answers when the reader's own vendor key was
	 * refused, and the 402 it answers when that vendor's balance is empty (classified
	 * from the vendor's response body, since ElevenLabs calls an exhausted quota 401
	 * and OpenAI calls it 429). Pinned here on the same contract: a change to the
	 * vendor list or a vendor's wording must move this array in the same commit.
	 */
	const designed = [
		"Your Radient sign-in has stopped working. Sign in again in Settings.",
		"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
		"Speech is unavailable right now. Try again in a moment.",
		"Speech is temporarily unavailable. Try again in a moment.",
		"Speech is temporarily unavailable.",
		"Sign in to Radient in Settings to enable speaking aloud.",
		"This conversation's agent is no longer available.",
		"ElevenLabs refused your API key. Replace it.",
		"Your ElevenLabs credit balance is too low for speech. Add credits with ElevenLabs to continue.",
		"OpenAI refused your API key. Replace it.",
		"Your OpenAI credit balance is too low for speech. Add credits with OpenAI to continue.",
		"Your Radient sign-in has stopped working. Sign in again in the settings page.",
		"Sign in to Radient in the settings page to enable text to speech.",
	];
	return (async () => {
		for (const sentence of designed) {
			reset();
			// eslint-disable-next-line no-await-in-loop
			await state().speak("msg:d", async () => {
				throw new Error(sentence);
			});
			assert.deepEqual(toasts().errors, [sentence], sentence);
		}
	})();
});

test("a fetcher that answers nothing is a failure, not a silent success", () => {
	reset();
	return (async () => {
		await state().speak("msg:x", async () => null);
		assert.equal(state().playingKey, null);
		assert.match(state().error ?? "", NO_AUDIO_SENTENCE);
		assert.deepEqual(
			toasts().errors,
			[SPEECH_FAILURE_COPY],
			"the transport's words stay out of the reader's sentence",
		);
	})();
});

test("an unmapped upstream diagnostic is mapped, with the detail only in the console (U3/C5)", () => {
	reset();
	return (async () => {
		const raw =
			"Speech generation failed upstream: Upstream responded 503 with no body.";
		const logged = [];
		const original = console.error;
		console.error = (...args) => {
			logged.push(args.join(" "));
		};
		try {
			await state().speak("msg:x", async () => {
				throw new Error(raw);
			});
		} finally {
			console.error = original;
		}
		assert.deepEqual(
			toasts().errors,
			[SPEECH_FAILURE_COPY],
			"the support diagnostic never reads as copy",
		);
		assert.equal(state().error, raw, "the raw detail is kept for the tests");
		assert.ok(
			logged.some((line) => line.includes("Upstream responded 503")),
			"and it goes to the console",
		);
	})();
});

test("a playback failure raises the error toast through the same channel (C1)", () => {
	reset();
	return (async () => {
		await state().speak("msg:e", async () => new Blob(["audio"]));
		assert.equal(state().playingKey, "msg:e");
		const original = console.error;
		console.error = () => {};
		try {
			fakeAudios[0].onerror();
		} finally {
			console.error = original;
		}
		assert.deepEqual(
			toasts().errors,
			[SPEECH_PLAYBACK_COPY],
			"a fetched-then-unplayable press must not look like nothing happened",
		);
		assert.equal(state().playingKey, null, "and the slot is released");
	})();
});

/* ------------------------------------------------------------ the cache */

test("the cache is capped, oldest untouched first", () => {
	reset();
	return (async () => {
		for (let i = 0; i < AUDIO_CACHE_LIMIT + 5; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			await state().speak(`msg:${i}`, async () => new Blob([String(i)]));
		}
		assert.equal(state().audioCache.size, AUDIO_CACHE_LIMIT);
		assert.equal(
			state().audioCache.has("msg:0"),
			false,
			"the oldest left first",
		);
		assert.equal(
			state().audioCache.has(`msg:${AUDIO_CACHE_LIMIT + 4}`),
			true,
			"the newest stayed",
		);
	})();
});

test("a hit refreshes an entry's place, so the in-use entry survives eviction", () => {
	reset();
	return (async () => {
		for (let i = 0; i < AUDIO_CACHE_LIMIT; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			await state().speak(`msg:${i}`, async () => new Blob([String(i)]));
		}
		let fetched = false;
		await state().speak("msg:0", async () => {
			fetched = true;
			return new Blob(["unused"]);
		});
		assert.equal(fetched, false, "the refresh is a cache hit");
		await state().speak("msg:new", async () => new Blob(["new"]));
		assert.equal(
			state().audioCache.has("msg:0"),
			true,
			"the refreshed entry survived",
		);
		assert.equal(
			state().audioCache.has("msg:1"),
			false,
			"the oldest untouched entry left",
		);
	})();
});

/* ------------------------------------------------------------ dismissal */

test("dismiss cancels an in-flight fetch: its response is cached, never played (U1)", () => {
	reset();
	return (async () => {
		let release;
		const pending = state().speak(
			"sel:conv-1:deadbeef",
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		assert.equal(state().loadingKey, "sel:conv-1:deadbeef");
		state().dismiss("sel:conv-1:deadbeef");
		assert.equal(
			state().loadingKey,
			null,
			"the control returns to rest immediately, not at the response's leisure",
		);
		release(new Blob(["late"]));
		await pending;
		assert.equal(
			state().playingKey,
			null,
			"a dismissed press never starts playing",
		);
		assert.equal(fakeAudios.length, 0, "no element is built for it");
		assert.ok(
			state().audioCache.has("sel:conv-1:deadbeef"),
			"the paid synthesis is still cached for a later press",
		);
		assert.equal(
			state().heardKeys.has("sel:conv-1:deadbeef"),
			false,
			"and the reader never heard it, so the resting label stays Speak aloud (U-r2-3)",
		);
	})();
});

test("a re-press after a cancel joins the same paid fetch instead of buying it twice (agent MINOR-1)", () => {
	reset();
	return (async () => {
		let calls = 0;
		let release;
		const fetcher = () => {
			calls += 1;
			return new Promise((resolve) => {
				release = resolve;
			});
		};
		const first = state().speak("msg:dedupe", fetcher);
		state().dismiss("msg:dedupe");
		const second = state().speak("msg:dedupe", fetcher);
		assert.equal(
			calls,
			1,
			"the re-press joined the in-flight fetch: no second billed synthesis",
		);
		release(new Blob(["once"]));
		await Promise.all([first, second]);
		assert.equal(calls, 1, "still one call after the join resolves");
		assert.equal(
			state().playingKey,
			"msg:dedupe",
			"and the joined response plays for the newer press",
		);
		assert.equal(
			state().heardKeys.has("msg:dedupe"),
			true,
			"playback started, so this key is heard and reads as Replay speech from here (U-r2-3)",
		);
	})();
});

test("dismiss stops this key's playback and touches no other key", () => {
	reset();
	return (async () => {
		await state().speak("msg:a", async () => new Blob(["a"]));
		await state().speak("msg:b", async () => new Blob(["b"]));
		assert.equal(state().playingKey, "msg:b");
		state().dismiss("msg:a");
		assert.equal(
			state().playingKey,
			"msg:b",
			"another key's playback is untouched by the dismissal",
		);
		state().dismiss("msg:b");
		assert.equal(
			state().playingKey,
			null,
			"the dismissed key's playback stops",
		);
		assert.equal(fakeAudios[1].paused, true, "its element is paused");
	})();
});

/* --------------------------------------------------------- playSpeech */

test("playSpeech keeps its signature and speaks under the message key", () => {
	reset();
	return (async () => {
		// Seeded, so the wrapper's cache-hit path is exercised without the relay.
		store.setState({ audioCache: new Map([["msg:a1", new Blob(["cached"])]]) });
		await state().playSpeech("a1", "c1", "the words");
		assert.equal(state().playingKey, "msg:a1");
		assert.equal(fakeAudios.length, 1);
		assert.equal(fakeAudios[0].played, true);
	})();
});

test("a playSpeech miss fails through the store's own disclosure", () => {
	reset();
	return (async () => {
		await state().playSpeech("missing", "c1", "the words");
		assert.equal(state().playingKey, null);
		assert.equal(state().loadingKey, null);
		assert.equal(
			toasts().errors.length,
			1,
			"the reader sees the failure, wherever it came from",
		);
	})();
});

/* Keep the process's own URL helpers for whatever runs after this file. */
process.on("exit", () => {
	URL.createObjectURL = realCreate;
	URL.revokeObjectURL = realRevoke;
});
