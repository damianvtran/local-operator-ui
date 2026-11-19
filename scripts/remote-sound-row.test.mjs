/**
 * The Files panel's sound row for a PEER-held file (review round 1, R1-1).
 *
 * WHAT THIS FILE HOLDS: UI invariant I3-1 on the one sink the first cut
 * missed. A remote row's `path` is the OWNER's display path; the audio band's
 * player routed a path row without a digest to `FinderPathSound`, which read
 * that path from THIS disk (`window.api.readFileBytes`) on mount and played
 * whatever was there. The fixed player never reads it: an unreadable row states
 * its reason, and a readable one plays from the content route, on a press.
 *
 * REAL: `AudioDocumentPlayer`, the shared `SoundPlayer`, `use-file-blob-url`,
 * the refcounted blob cache, the media relay client (`desktopMedia`) and the
 * English catalogue, bundled from source and mounted with React in JSDOM.
 * SUBSTITUTED: the preload bridge (`window.api.desktop.media` answered here,
 * `window.api.readFileBytes` a spy) and `Audio` (a fake, so nothing plays).
 * The local path row is the negative control: it DOES reach the spy, which
 * proves the spy is wired.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, mock, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

class FakeAudio {
	constructor() {
		this.src = null;
		this.paused = true;
		this.currentTime = 0;
		this.duration = 0;
		this.volume = 1;
		this.playbackRate = 1;
		this.preload = "";
	}
	play() {
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute() {}
	load() {}
}
globalThis.Audio = FakeAudio;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class SilentResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = SilentResizeObserver;
dom.window.ResizeObserver = SilentResizeObserver;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const blobs = { created: 0, revoked: 0 };
URL.createObjectURL = () => `blob:remote-sound-${blobs.created++}`;
URL.revokeObjectURL = () => {
	blobs.revoked += 1;
};

const MEDIA = [];
const READS = [];
// A test may answer the content route itself (`contentAnswer`); null = bytes.
let contentAnswer = null;
globalThis.window.api = {
	readFileBytes: async (path) => {
		READS.push(path);
		return { success: true, data: new Uint8Array([1, 2, 3]), sizeBytes: 3 };
	},
	desktop: {
		media: async (request) => {
			MEDIA.push(request);
			if (request.op === "sessions.files.content" && contentAnswer)
				return contentAnswer(request);
			if (request.op === "sessions.files.content")
				return {
					status: 200,
					kind: "bytes",
					mimeType: "audio/mpeg",
					data: new Uint8Array([73, 68, 51]),
				};
			return { status: 404, kind: "error", detail: "none" };
		},
	},
};

const { act } = await import("react");
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AudioDocumentPlayer } from "./src/renderer/src/features/chat/components/canvas/audio-document-player";
export function mountRow(container, doc) {
	const root = createRoot(container);
	root.render(createElement(AudioDocumentPlayer, { doc, label: doc.title }));
	return root;
}
`;
const bundle = await build({
	stdin: { contents: ENTRY, resolveDir: process.cwd(), sourcefile: "rs.mjs" },
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_remote-sound-row-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mountRow } = await import(bundlePath.href);
after(() => unlink(bundlePath));

const settle = async (rounds = 6) => {
	for (let i = 0; i < rounds; i += 1)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
};

const OWNER_PATH = "~/Music/song.mp3";
const remoteDoc = (unreadable) => ({
	id: "row-1",
	title: "song.mp3",
	path: OWNER_PATH,
	content: "",
	type: "audio",
	remote: {
		fileId: "00000000000000a1",
		sessionId: "aaaaaaaaaaaa",
		deviceName: "lop-remote-node-2",
		readKind: unreadable ? null : "path",
		unreadable,
		ownerPath: OWNER_PATH,
		sizeBytes: 3,
	},
});

const mount = async (doc) => {
	const container = document.createElement("div");
	document.body.append(container);
	let root;
	await act(async () => {
		root = mountRow(container, doc);
	});
	await settle();
	return { container, root };
};

test("negative control: a LOCAL path sound reads its path from this disk", async () => {
	READS.length = 0;
	const { root } = await mount({
		id: "local",
		title: "local.mp3",
		path: "/home/me/local.mp3",
		content: "",
		type: "audio",
	});
	assert.deepEqual(READS, ["/home/me/local.mp3"], "the spy is wired");
	await act(async () => root.unmount());
});

test("an UNREADABLE remote sound states its reason and never reads the owner path", async () => {
	READS.length = 0;
	MEDIA.length = 0;
	const { container, root } = await mount(remoteDoc("outside_session_files"));
	assert.deepEqual(READS, [], "I3-1: readFileBytes never sees the owner path");
	assert.equal(MEDIA.length, 0, "nothing is fetched for a refused row");
	assert.ok(container.textContent.includes("lop-remote-node-2's workspace"));
	await act(async () => root.unmount());
});

test("a READABLE remote sound plays from the content route on a press, never from this disk", async () => {
	READS.length = 0;
	MEDIA.length = 0;
	const before = { ...blobs };
	const { container, root } = await mount(remoteDoc(null));
	assert.deepEqual(READS, [], "I3-1: nothing read on mount");
	assert.equal(MEDIA.length, 0, "listing a sound is not a reason to fetch it");
	const play = container.querySelector("[data-remote-sound-play]");
	assert.ok(play, "an idle Play control");
	await act(async () => {
		play.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
	assert.deepEqual(READS, [], "I3-1: nothing read on play either");
	assert.deepEqual(MEDIA, [
		{
			op: "sessions.files.content",
			sessionId: "aaaaaaaaaaaa",
			fileId: "00000000000000a1",
		},
	]);
	assert.ok(container.querySelector("[data-sound-player]"), "the player");
	await act(async () => root.unmount());
	await settle();
	assert.equal(
		blobs.created - before.created,
		blobs.revoked - before.revoked,
		"the row's object URL is released with it",
	);
});

/*
 * Review round 2, R2-3: a sound over the relay's read window could only fail
 * on its press, with the generic read sentence. It says what the canvas open
 * says instead, and nothing is fetched.
 */
test("R2-3: a remote sound over 32 MiB says it is too large to open, offers no Play, fetches nothing", async () => {
	MEDIA.length = 0;
	const doc = remoteDoc(null);
	doc.remote.sizeBytes = 33 * 1024 * 1024;
	const { container, root } = await mount(doc);
	assert.equal(container.querySelector("[data-remote-sound-play]"), null);
	assert.ok(
		container.textContent.includes(
			"Too large to open from lop-remote-node-2. Download it to this device instead.",
		),
		container.textContent,
	);
	assert.equal(MEDIA.length, 0);
	await act(async () => root.unmount());
});

/*
 * UX round 2, U2-1: the pressed sound rides the transcript's 504 backoff under
 * "Fetching from <device>…", tells "still fetching" from "offline" at the end,
 * and offers Retry, which reads again.
 */
test("U2-1: a remote sound's 504 is retried on the backoff, then 'still fetching' with a Retry that reads again", async (t) => {
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => {
		mock.timers.reset();
		contentAnswer = null;
	});
	const flush = async (rounds = 6) => {
		for (let i = 0; i < rounds; i += 1)
			await act(async () => {
				await new Promise((resolve) => setImmediate(resolve));
			});
	};
	MEDIA.length = 0;
	contentAnswer = async () => ({
		status: 504,
		kind: "error",
		detail: "Still fetching.",
		refusal: { code: "attachment_fetch_pending" },
	});
	const container = document.createElement("div");
	document.body.append(container);
	let root;
	await act(async () => {
		root = mountRow(container, remoteDoc(null));
	});
	await flush();
	await act(async () => {
		container
			.querySelector("[data-remote-sound-play]")
			.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.ok(container.textContent.includes("Fetching from lop-remote-node-2…"));
	for (const delay of [2000, 4000, 8000, 16000]) {
		await act(async () => mock.timers.tick(delay));
		await flush();
	}
	assert.equal(MEDIA.length, 5, "five attempts, the transcript's schedule");
	assert.ok(
		container.textContent.includes(
			"Still fetching from lop-remote-node-2. Try again in a moment.",
		),
		container.textContent,
	);
	assert.ok(!container.textContent.includes("isn't answering"), "not offline");
	const retry = container.querySelector("[data-remote-sound-retry]");
	assert.ok(retry, "a Retry action");
	contentAnswer = null;
	await act(async () => {
		retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.equal(MEDIA.length, 6, "Retry reads again");
	assert.ok(container.querySelector("[data-sound-player]"), "and the player");
	await act(async () => root.unmount());
});
