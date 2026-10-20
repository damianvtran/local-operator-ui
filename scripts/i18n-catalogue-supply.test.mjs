import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The catalogue-supply rules, driven through the SHIPPED module.
 *
 * The loader's point is what happens around the happy fetch: a 404, an
 * unreachable backend, an empty map and a corrupt cache all have to leave the
 * renderer in a state where an unknown identity reaches the envelope's own
 * `text`, never a key and never a startup exception. The fake fetcher and fake
 * storage keep this a unit test; the real-path probe in the report drives the
 * same functions against a real server.
 */
const bundle = await build({
	stdin: {
		contents: `
			export {
				createCatalogueSupply,
				parseWireCatalogueBundle,
				readCachedBundle,
				resolveCatalogueLocale,
				writeCachedBundle,
			} from "./src/i18n/catalogue-supply";
			export {
				clearRegisteredCatalogues,
				renderMessage,
				setLocale,
			} from "./src/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});

const bundlePath = new URL(
	"./_i18n-catalogue-supply.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const {
	clearRegisteredCatalogues,
	createCatalogueSupply,
	parseWireCatalogueBundle,
	readCachedBundle,
	renderMessage,
	resolveCatalogueLocale,
	setLocale,
	writeCachedBundle,
} = mod;

const CACHE_KEY = "lop.i18n.wire.v1:";
const FRENCH = "Ce paramètre n’est pas déclaré.";
const IDENTITY = "wire.errors.settings.not_registered";
const sha = (char) => char.repeat(64);

function payload(locale = "fr", messages = { [IDENTITY]: FRENCH }) {
	return {
		locale,
		messages,
		namespaces: { "wire.errors.settings": sha("b") },
		deferred: [
			{
				namespace: "wire.settings",
				content_sha256: sha("c"),
				bytes: 77176,
				keys: 770,
			},
		],
		content_sha256: sha("a"),
	};
}

class FakeStorage {
	constructor(entries = []) {
		this.map = new Map(entries);
	}
	get length() {
		return this.map.size;
	}
	key(index) {
		return [...this.map.keys()][index] ?? null;
	}
	getItem(key) {
		return this.map.has(key) ? this.map.get(key) : null;
	}
	setItem(key, value) {
		this.map.set(key, String(value));
	}
	removeItem(key) {
		this.map.delete(key);
	}
	keys() {
		return [...this.map.keys()];
	}
}

function fresh() {
	clearRegisteredCatalogues();
	setLocale("fr");
}

test("a fetched bundle is registered and an identity renders its French text", async () => {
	fresh();
	const fetches = [];
	const supply = createCatalogueSupply({
		fetchBundle: async (locale) => {
			fetches.push(locale);
			return payload(locale);
		},
		storage: new FakeStorage(),
	});
	await supply.load("fr");
	assert.deepEqual(fetches, ["fr"]);
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), {
		status: "rendered",
		text: FRENCH,
	});
});

test("a cached bundle is registered before the fetch, and survives a failed fetch", async () => {
	fresh();
	const storage = new FakeStorage();
	writeCachedBundle(storage, payload());
	const supply = createCatalogueSupply({
		fetchBundle: async () => {
			throw new Error("backend unreachable");
		},
		storage,
	});
	await supply.load("fr");
	// The fetch failed, but cache-first registration already answered.
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), {
		status: "rendered",
		text: FRENCH,
	});
});

test("404/unreachable with no cache registers nothing and never throws", async () => {
	fresh();
	const warnings = [];
	const supply = createCatalogueSupply({
		fetchBundle: async () => {
			throw new Error("404");
		},
		storage: new FakeStorage(),
		warn: (message) => warnings.push(message),
	});
	await supply.load("fr");
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), { status: "unknown" });
	assert.deepEqual(warnings, []);
});

test("an empty message map registers no keys and degrades to text", async () => {
	fresh();
	const supply = createCatalogueSupply({
		fetchBundle: async () => payload("fr", {}),
		storage: new FakeStorage(),
	});
	await supply.load("fr");
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), { status: "unknown" });
});

test("corrupt cached JSON is discarded, not thrown at startup", async () => {
	fresh();
	const storage = new FakeStorage([[`${CACHE_KEY}fr`, "{not json"]]);
	const supply = createCatalogueSupply({
		fetchBundle: async () => payload(),
		storage,
		warn: () => {},
	});
	await supply.load("fr");
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), {
		status: "rendered",
		text: FRENCH,
	});
	const stored = storage.getItem(`${CACHE_KEY}fr`);
	assert.ok(stored?.startsWith('{"version":1'));
});

test("a cached JSON object that is not a bundle is discarded, not registered", async () => {
	fresh();
	const notABundle = JSON.stringify({
		version: 1,
		savedAt: Date.now(),
		bundle: { locale: "fr", messages: [FRENCH] },
	});
	const storage = new FakeStorage([[`${CACHE_KEY}fr`, notABundle]]);
	const supply = createCatalogueSupply({
		fetchBundle: async () => {
			throw new Error("offline");
		},
		storage,
		warn: () => {},
	});
	await supply.load("fr");
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), { status: "unknown" });
	assert.equal(
		storage.getItem(`${CACHE_KEY}fr`),
		null,
		"corrupt entry removed",
	);
});

test("a malformed payload is ignored with a diagnostic, never registered", async () => {
	fresh();
	const warnings = [];
	const storage = new FakeStorage();
	const supply = createCatalogueSupply({
		fetchBundle: async () => ({
			...payload(),
			messages: { [IDENTITY]: 42 },
		}),
		storage,
		warn: (message) => warnings.push(message),
	});
	await supply.load("fr");
	assert.deepEqual(renderMessage(IDENTITY, {}, "fr"), { status: "unknown" });
	assert.equal(warnings.length, 1);
	assert.equal(storage.length, 0, "nothing persisted");
});

test("switching locale registers the new locale without dropping the first", async () => {
	fresh();
	const supply = createCatalogueSupply({
		fetchBundle: async (locale) =>
			payload(locale, { [IDENTITY]: `${FRENCH} (${locale})` }),
		storage: new FakeStorage(),
	});
	await supply.load("fr");
	await supply.load("es");
	assert.equal(renderMessage(IDENTITY, {}, "fr").text, `${FRENCH} (fr)`);
	assert.equal(renderMessage(IDENTITY, {}, "es").text, `${FRENCH} (es)`);
});

test("persistent cache keeps the two most recent locales", async () => {
	fresh();
	const storage = new FakeStorage();
	const supply = createCatalogueSupply({
		fetchBundle: async (locale) => payload(locale),
		storage,
	});
	for (const locale of ["fr", "es", "hi"]) {
		await supply.load(locale);
	}
	const cached = storage.keys().filter((key) => key.startsWith(CACHE_KEY));
	assert.equal(cached.length, 2);
	assert.ok(cached.includes(`${CACHE_KEY}hi`), "the newest locale is kept");
});

test("the payload parser rejects a bundle with a bad hash or a non-wire namespace", () => {
	assert.ok(parseWireCatalogueBundle(payload()));
	const badHash = { ...payload(), content_sha256: "nope" };
	assert.equal(parseWireCatalogueBundle(badHash), null);
	const badNamespace = {
		...payload(),
		namespaces: { "ui.chat": sha("b") },
	};
	assert.equal(parseWireCatalogueBundle(badNamespace), null);
});

test("writeCachedBundle is a no-op without storage", () => {
	writeCachedBundle(null, payload());
	assert.equal(readCachedBundle(null, "fr"), null);
});

test("a changed bundle replaces the locale map, dropping a removed key", async () => {
	fresh();
	const storage = new FakeStorage();
	const removed = "wire.errors.removed.key";
	writeCachedBundle(storage, {
		...payload("fr", {
			[IDENTITY]: "ANCIEN TEXTE",
			[removed]: "Texte supprimé côté backend",
		}),
		content_sha256: sha("d"),
	});
	const supply = createCatalogueSupply({
		fetchBundle: async () => payload("fr"),
		storage,
	});
	await supply.load("fr");
	assert.equal(renderMessage(IDENTITY, {}, "fr").text, FRENCH);
	assert.deepEqual(renderMessage(removed, {}, "fr"), { status: "unknown" });
});

test("a payload holding a client-owned key is rejected", () => {
	assert.equal(
		parseWireCatalogueBundle(
			payload("fr", { "ui.chat.title": "Titre pirate" }),
		),
		null,
	);
});

test("a cache entry holding a client-owned key is discarded, not registered", () => {
	fresh();
	const storage = new FakeStorage();
	writeCachedBundle(
		storage,
		payload("fr", { "ui.chat.title": "Titre pirate" }),
	);
	assert.equal(readCachedBundle(storage, "fr"), null);
	assert.equal(storage.getItem(`${CACHE_KEY}fr`), null);
});

test("eviction keeps the two most recently READ locales", async () => {
	fresh();
	const storage = new FakeStorage();
	const seed = (locale, savedAt) =>
		storage.setItem(
			`${CACHE_KEY}${locale}`,
			JSON.stringify({ version: 1, savedAt, bundle: payload(locale) }),
		);
	seed("fr", 100);
	seed("es", 200);
	assert.ok(readCachedBundle(storage, "fr"), "fr is readable");
	const supply = createCatalogueSupply({
		fetchBundle: async (locale) => payload(locale),
		storage,
	});
	await supply.load("hi");
	const cached = storage
		.keys()
		.filter((key) => key.startsWith(CACHE_KEY))
		.sort();
	assert.deepEqual(cached, [`${CACHE_KEY}fr`, `${CACHE_KEY}hi`]);
});

test("the sync hook prefers the resolved backend tag over the device tag", () => {
	assert.equal(resolveCatalogueLocale("fr", "en-US"), "fr");
	assert.equal(resolveCatalogueLocale(undefined, "en-US"), "en-US");
	assert.equal(resolveCatalogueLocale("  ", "en-US"), "en-US");
});
