import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SIDEBAR'S OWN PHOTO: the signed-in person's Radient avatar on the account
 * row at the foot of the rail, in place of their initials.
 *
 * Rendered through the SHIPPED `UserProfileSidebar` with only the two desktop
 * seams mocked: the account read (`radient` proxy `account` -> hub `/me`) and the
 * private avatar bytes (`desktop.media` `team_bridge.avatar`). That is the real
 * path: the version comes from `/me`'s `profile.avatar.hash`, and the bytes come
 * through the one shared cache in `use-account-avatar.ts`, fenced to the
 * signed-in account.
 *
 * States: photo present; no photo (initials, no fetch); signed out (generic
 * mark, no fetch); a failed byte read or an older core's 404 (initials); and an
 * account switch A -> B, which must never show A's photo on B's row.
 *
 * Assertions compare strings and booleans, never DOM nodes: a failing
 * `assert.equal(node, ...)` makes node's assert `util.inspect` a live jsdom
 * node, which walks the whole window graph (measured 2026-10-26: tens of GB).
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that refuse to be read out of context.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.__RIG_ENV__ = {
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
	VITE_RADIENT_SERVER_BASE_URL: "https://api.example.invalid/v1",
	VITE_RADIENT_CLIENT_ID: "rig",
	VITE_GOOGLE_CLIENT_ID: "rig.apps.googleusercontent.com",
	VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
	VITE_MICROSOFT_TENANT_ID: "common",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
	VITE_LOG_LEVEL: "info",
};

const A = "2fc3a222-9e22-4c85-8b94-0b11c81972f7";
const B = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const HASH_A = "0123456789abcdef";
const HASH_B = "fedcba9876543210";

/** `/me`'s body as the hub writes it (agent-server #216: profile.avatar). */
function me(id, name, hash) {
	return {
		account: {
			id,
			tenant_id: "ten_1",
			email: `${name.toLowerCase().replace(" ", ".")}@example.test`,
			name,
			role: "owner",
			...(hash ? { profile: { avatar: { source: "uploaded", hash } } } : {}),
		},
		identity: { email: "x@example.test", provider: "google" },
	};
}
const envelope = (body) => ({
	status: 200,
	body: { result: { data: { msg: "ok", result: body } } },
});
const SIGNED_OUT = {
	status: 401,
	body: {
		detail: {
			code: "radient_no_credential",
			message: "Sign in to Radient to access your account",
		},
	},
};

/** The account read's answer, per test. */
let account = null;
/** What the avatar relay answers: "bytes" | "error" | "not-found" |
 *  "error-once" (a transient 502, then bytes: core restarting, hub blip). */
let avatarMode = "bytes";
const avatarRequests = [];

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.control?.operation === "account")
				return account ? envelope(account) : SIGNED_OUT;
			if (request?.op === "capabilities")
				return {
					status: 200,
					body: {
						result: { desktop_available: true, features: { radient: 1 } },
					},
				};
			return { status: 503, body: { detail: "not part of this test" } };
		},
		media: async (request) => {
			if (request.op !== "team_bridge.avatar")
				return { kind: "error", status: 503, detail: "not part of this test" };
			avatarRequests.push({ ...request });
			if (avatarMode === "error-once" && avatarRequests.length === 1)
				return { kind: "error", status: 502, detail: "upstream restarting" };
			if (avatarMode === "error")
				return { kind: "error", status: 502, detail: "upstream failed" };
			if (avatarMode === "not-found")
				// An older core (< 0.90.13) has no relay route.
				return { kind: "error", status: 404, detail: "Not Found" };
			return {
				kind: "bytes",
				data: new Uint8Array([request.accountId === A ? 0xa : 0xb, 1, 2]),
				mimeType: "image/png",
			};
		},
	},
};

let blobSeq = 0;
const liveBlobs = new Map();
URL.createObjectURL = (blob) => {
	const url = `blob:test/${++blobSeq}`;
	liveBlobs.set(url, blob);
	return url;
};
URL.revokeObjectURL = (url) => liveBlobs.delete(url);
// Radix Avatar shows the image only once it has LOADED (`complete` and a
// non-zero `naturalWidth`); jsdom never decodes, so report an image with a src
// as a decoded 64 px picture.
for (const [prop, value] of [
	["complete", (img) => Boolean(img.getAttribute("src"))],
	["naturalWidth", (img) => (img.getAttribute("src") ? 64 : 0)],
]) {
	Object.defineProperty(globalThis.window.HTMLImageElement.prototype, prop, {
		configurable: true,
		get() {
			return value(this);
		},
	});
}

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { MemoryRouter } from "react-router-dom";
			export { UserProfileSidebar } from "./src/renderer/src/shared/components/navigation/user-profile-sidebar";
			export { radientUserKeys, beginRadientAuthorityTransition } from "./src/renderer/src/shared/hooks/radient-account-authority";
			export { radientAccountAvatarVersion } from "./src/renderer/src/shared/hooks/use-account-avatar";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	`./_sidebar-avatar-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const m = await import(bundlePath.href);
await unlink(bundlePath);

async function mount({ expanded = true } = {}) {
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (props) =>
		act(async () =>
			root.render(
				m.createElement(
					m.QueryClientProvider,
					{ client },
					m.createElement(
						m.MemoryRouter,
						{ initialEntries: ["/chat"] },
						m.createElement(m.UserProfileSidebar, props),
					),
				),
			),
		);
	await render({ expanded });
	return {
		client,
		container,
		render,
		img: () => container.querySelector("img")?.getAttribute("src") ?? null,
		fallback: () =>
			container.querySelector("button span span")?.textContent ?? null,
		async teardown() {
			await act(async () => root.unmount());
			container.remove();
			client.clear();
		},
	};
}

async function until(check, what, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		if (check()) return;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
	}
}
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 100));
	});
const reset = (next, mode = "bytes") => {
	account = next;
	avatarMode = mode;
	avatarRequests.length = 0;
};

test("a photo replaces the initials, read through the fenced private relay, in both rail states", async () => {
	for (const expanded of [true, false]) {
		reset(me(A, "Ada Lovelace", HASH_A));
		const s = await mount({ expanded });
		try {
			await until(() => s.img() !== null, "the photo");
			const src = s.img();
			assert.ok(src.startsWith("blob:test/"), `a private blob URL, got ${src}`);
			assert.equal(liveBlobs.get(src)?.type, "image/png");
			assert.deepEqual(avatarRequests, [
				{
					op: "team_bridge.avatar",
					expectedAccountId: A,
					accountId: A,
					hash: HASH_A,
					size: 64,
				},
			]);
			assert.ok(
				!s.container.querySelector("img").className.includes("border"),
				"no border on the photo (borderless chrome)",
			);
		} finally {
			await s.teardown();
		}
	}
});

test("no photo on the account keeps the initials and fetches nothing", async () => {
	reset(me(A, "Ada Lovelace", null));
	const s = await mount();
	try {
		await until(
			() => s.container.textContent.includes("Ada Lovelace"),
			"the name",
		);
		await settle();
		assert.equal(s.img(), null);
		assert.ok(s.container.textContent.includes("AL"), "initials stay");
		assert.equal(avatarRequests.length, 0);
	} finally {
		await s.teardown();
	}
});

test("signed out: no photo and no avatar request", async () => {
	reset(null);
	const s = await mount();
	try {
		await settle();
		await settle();
		assert.equal(s.img(), null);
		assert.equal(avatarRequests.length, 0);
	} finally {
		await s.teardown();
	}
});

test("a failed byte read, or an older core without the relay, falls back to initials", async () => {
	for (const mode of ["error", "not-found"]) {
		reset(me(A, "Ada Lovelace", HASH_A), mode);
		const s = await mount();
		try {
			await until(() => avatarRequests.length === 1, `the ${mode} read`);
			await settle();
			assert.equal(s.img(), null, `${mode}: no image`);
			assert.ok(s.container.textContent.includes("AL"), `${mode}: initials`);
		} finally {
			await s.teardown();
		}
	}
});

/*
 * AGENT REVIEW ROUND 1, M1: the account row never unmounts, so a failed read
 * used to stick until the next sign-in or reload. The hook now retries ONCE after
 * `FAILED_READ_RETRY_MS` (3 s) for the own-account row only. These run in real
 * time (two bounded waits of ~3.5 s) rather than under mocked timers, because the
 * row's account read, Radix's image load and the retry all have to interleave the
 * way they do in the app.
 */
test("a transient failure on the always-mounted row recovers with exactly one retry", async () => {
	reset(me(A, "Ada Lovelace", HASH_A), "error-once");
	const s = await mount();
	try {
		await until(() => avatarRequests.length === 1, "the first, failing read");
		await settle();
		assert.equal(s.img(), null, "initials while the backoff runs");
		assert.equal(avatarRequests.length, 1, "no immediate re-request");
		await until(() => s.img() !== null, "the retried photo", 8_000);
		assert.ok(s.img().startsWith("blob:test/"), `got ${s.img()}`);
		assert.equal(avatarRequests.length, 2, "one retry, not a loop");
	} finally {
		await s.teardown();
	}
});

test("a permanent failure costs exactly two reads and then stays on initials", async () => {
	reset(me(A, "Ada Lovelace", HASH_A), "not-found");
	const s = await mount();
	try {
		await until(() => avatarRequests.length === 2, "the retry", 8_000);
		// Long enough for a third read to have fired if the retry looped.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 3_600));
		});
		assert.equal(avatarRequests.length, 2, "bounded: no storm on a 404");
		assert.equal(s.img(), null);
		assert.ok(s.fallback()?.includes("AL"), "initials stay");
	} finally {
		await s.teardown();
	}
});

test("an account switch A -> B never shows A's photo on B's row", async () => {
	reset(me(A, "Ada Lovelace", HASH_A));
	const s = await mount();
	try {
		await until(() => s.img() !== null, "A's photo");
		const photoA = s.img();
		// The sign-in flow's own transition: authority goes pending, the cache
		// revokes, then the next read settles B.
		account = me(B, "Bea Okafor", HASH_B);
		await act(async () => {
			m.beginRadientAuthorityTransition(s.client);
		});
		assert.equal(liveBlobs.has(photoA), false, "A's blob is revoked at once");
		await act(async () => {
			await s.client.invalidateQueries({ queryKey: m.radientUserKeys.user() });
		});
		// Every frame on the way to B either shows no photo or B's photo.
		const deadline = Date.now() + 10_000;
		for (;;) {
			const src = s.img();
			assert.ok(src !== photoA, "A's photo is never rendered after the switch");
			if (src !== null && s.container.textContent.includes("Bea Okafor")) break;
			if (Date.now() > deadline) throw new Error("timed out waiting for B");
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
			});
		}
		const last = avatarRequests.at(-1);
		assert.equal(last.accountId, B);
		assert.equal(last.expectedAccountId, B);
		assert.ok(
			avatarRequests.every((r) => r.accountId === r.expectedAccountId),
			"no request ever asks for one account's photo under another's fence",
		);
		assert.equal(liveBlobs.get(s.img())?.size, 3);
	} finally {
		await s.teardown();
	}
});

test("the version comes from /me's profile.avatar and refuses a disagreeing or malformed one", () => {
	const v = m.radientAccountAvatarVersion;
	assert.deepEqual(v(me(A, "A", HASH_A).account), {
		accountId: A,
		hash: HASH_A,
	});
	assert.equal(v(me(A, "A", null).account), null, "no profile");
	assert.equal(v(undefined), null);
	assert.equal(
		v({ id: A, profile: { avatar: { source: "none", hash: HASH_A } } }),
		null,
		"an explicit removal",
	);
	assert.equal(v({ id: A, profile: { avatar: { hash: "XYZ" } } }), null);
	assert.equal(v({ id: "../x", profile: { avatar: { hash: HASH_A } } }), null);
	assert.deepEqual(
		v({
			id: A,
			avatar_url: `/v1/accounts/${A}/avatar?v=${HASH_A}`,
			profile: { avatar: { hash: HASH_A } },
		}),
		{ accountId: A, hash: HASH_A },
		"a decorated avatar_url that agrees",
	);
	assert.equal(
		v({
			id: A,
			avatar_url: `/v1/accounts/${A}/avatar?v=${HASH_B}`,
			profile: { avatar: { hash: HASH_A } },
		}),
		null,
		"a decorated avatar_url that disagrees with the hash",
	);
});
