import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The MAIN process's locale: where it reads from, what it refuses, and what its
 * notifications then say (agent review round 1, R1-1).
 *
 * WHY THESE CASES ARE EXECUTED RATHER THAN GREPPED. The defect was that main had
 * no locale source at all: `ui.notices.main.*` was keyed, the catalogues were
 * bundled, and every banner still read English because nothing ever wrote the
 * store in that process. So the tests drive the shipped `createMainLocale`
 * against a fake configured transport and then read the SHIPPED notice builders,
 * which is the same path production takes: backend answer -> locale store ->
 * `t()` at draw time.
 *
 * The transport is a fake by construction; the catalogue values compared below
 * are read from the real files, so a key renamed in one place fails here.
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/main/main-locale";
			export {
				installLaunchHoldNotice,
				buildWatchdogPlan,
				watchdogMessages,
				WATCHDOG_ELAPSED_TOKEN,
			} from "./src/main/update-install";
			export {
				applyBackendLanguage,
				applyCapabilities,
				applyDeviceLocale,
				currentLocaleState,
				isLanguageTag,
				resolveLocale,
				setLocale,
			} from "./src/i18n/locale";
			export { CONSENT_TITLE, consentBody } from "./src/main/browser/consent-notifier";
			export {
				isAcceptedLanguageEdit,
				registerDesktopIPC,
			} from "./src/main/desktop-ipc";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
						export const ipcMain = {
							handle: (name, handler) => globalThis.__mainLocaleHandlers.set(name, handler),
						};
						export const shell = { openExternal: async () => {} };
						export class Notification {
							static isSupported() { return false; }
							constructor() {}
							show() {}
						}
					`,
					loader: "js",
				}));
			},
		},
	],
});
const main = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	createMainLocale,
	deviceLocaleFor,
	applyHoldLocale,
	installLaunchHoldNotice,
	buildWatchdogPlan,
	watchdogMessages,
	WATCHDOG_ELAPSED_TOKEN,
	setLocale,
	currentLocaleState,
	isLanguageTag,
	resolveLocale,
	isAcceptedLanguageEdit,
	registerDesktopIPC,
	CONSENT_TITLE,
	consentBody,
} = main;

const CATALOGUES = {
	en: JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.notices.json", "utf8"),
	),
	fr: JSON.parse(
		readFileSync("src/i18n/catalogues/fr/ui.notices.json", "utf8"),
	),
	ru: JSON.parse(
		readFileSync("src/i18n/catalogues/ru/ui.notices.json", "utf8"),
	),
	ur: JSON.parse(
		readFileSync("src/i18n/catalogues/ur/ui.notices.json", "utf8"),
	),
};

const marker = { targetVersion: "0.42.0" };
const noticeFor = (locale) => ({
	title: CATALOGUES[locale]["ui.notices.main.update_hold_title"],
});
const consentTitleFor = (locale) =>
	CATALOGUES[locale]["ui.notices.main.consent_title"];

/** A capabilities answer in the shape the desktop transport returns. */
const answer = (language, features = { i18n: 1 }) => ({
	status: 200,
	body: { result: { language, features } },
});

const appWith = (readings) => ({
	getPreferredSystemLanguages: readings.preferred,
	getSystemLocale: readings.system,
	getLocale: readings.app,
});

const reset = () => setLocale("en");

test("the device reading follows Electron's order and skips unusable tags", () => {
	reset();
	assert.equal(
		deviceLocaleFor(
			appWith({
				preferred: () => ["", "not a tag", "de-DE"],
				system: () => "fr-FR",
				app: () => "en-US",
			}),
		),
		"de-DE",
		"the first VALID preferred system language, not the system locale",
	);
	assert.equal(
		deviceLocaleFor(
			appWith({
				preferred: () => {
					throw new Error("host cannot read");
				},
				system: () => "fr-FR",
			}),
		),
		"fr-FR",
		"a throwing getter falls through to the next reading",
	);
	assert.equal(
		deviceLocaleFor(appWith({ preferred: () => ["sl/ash"], system: () => "" })),
		undefined,
		"an unusable reading is not a device tag",
	);
	// `navigator.language` is deliberately not this module's source: under Node it
	// follows LANG/ICU, not the macOS preferred list.
	const previousNavigator = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator",
	);
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { language: "ja-JP" },
	});
	try {
		assert.equal(
			deviceLocaleFor(appWith({ system: () => "de-DE" })),
			"de-DE",
			"the main process must not read navigator.language",
		);
	} finally {
		if (previousNavigator)
			Object.defineProperty(globalThis, "navigator", previousNavigator);
		else
			Object.defineProperty(globalThis, "navigator", {
				configurable: true,
				value: undefined,
			});
	}
});

test("before any capabilities answer, a notification speaks the device reading", async () => {
	reset();
	const locale = createMainLocale({
		app: appWith({ preferred: () => ["fr", "en-US"] }),
		request: async () => answer("ru"),
		log: () => {},
	});
	assert.equal(locale.applyDevice(), true);
	assert.deepEqual(currentLocaleState(), { locale: "fr", source: "device" });
	// The claim this test exists for: the FIRST notice - raised before the backend's
	// answer settles - is already in the OS's language, not English.
	assert.equal(installLaunchHoldNotice(marker).title, noticeFor("fr").title);
	// A reconnect then moves it to the backend's authoritative tag.
	await locale.refresh();
	assert.equal(installLaunchHoldNotice(marker).title, noticeFor("ru").title);
	reset();
});

test("a configured backend's resolved tag reaches the hold and consent payloads", async () => {
	reset();
	let reply = answer("fr");
	const locale = createMainLocale({
		app: appWith({ system: () => "en-US" }),
		request: async () => reply,
		log: () => {},
	});
	const hold = installLaunchHoldNotice(marker);
	assert.equal(hold.title, CATALOGUES.en["ui.notices.main.update_hold_title"]);

	await locale.refresh();
	assert.equal(currentLocaleState().source, "backend");
	assert.equal(installLaunchHoldNotice(marker).title, noticeFor("fr").title);
	assert.equal(CONSENT_TITLE(), consentTitleFor("fr"));
	assert.match(consentBody(1, "example.com"), /exemple|example/);

	// A later answer is authoritative: the in-app language change is what this
	// whole path exists to follow.
	reply = answer("ru");
	await locale.refresh();
	assert.equal(installLaunchHoldNotice(marker).title, noticeFor("ru").title);
	assert.equal(CONSENT_TITLE(), consentTitleFor("ru"));

	reply = answer("ur");
	await locale.refresh();
	assert.equal(CONSENT_TITLE(), consentTitleFor("ur"));
	reset();
});

test("an older backend or an unusable tag falls back to the device, and a failed read keeps state", async () => {
	reset();
	const app = appWith({ system: () => "de-DE" });
	let reply = answer("fr");
	const locale = createMainLocale({
		app,
		request: async () => reply,
		log: () => {},
	});
	await locale.refresh();
	assert.equal(currentLocaleState().locale, "fr");

	// 200 without the feature: the backend does not own a language answer, which
	// is the renderer's own rule (`resolveLocale`) too.
	reply = { status: 200, body: { result: { language: "ru", features: {} } } };
	await locale.refresh();
	assert.deepEqual(currentLocaleState(), { locale: "de-DE", source: "device" });

	// Back to a real answer, then every failure shape must leave it alone.
	reply = answer("ur");
	await locale.refresh();
	assert.equal(currentLocaleState().locale, "ur");
	for (const failure of [
		{ status: 500, body: { detail: "boom" } },
		{ status: 404 },
		{ status: 200, body: null },
	]) {
		reply = failure;
		await locale.refresh();
		assert.equal(
			currentLocaleState().locale,
			"ur",
			`a ${failure.status} read must not change the locale`,
		);
	}
	reply = null;
	const throwing = createMainLocale({
		app,
		request: async () => {
			throw new Error("socket refused");
		},
		log: () => {},
	});
	await throwing.refresh();
	assert.equal(currentLocaleState().locale, "ur");

	// A structurally invalid tag is not applied even with the feature on.
	reply = answer("fr/../../etc");
	const invalid = createMainLocale({
		app,
		request: async () => reply,
		log: () => {},
	});
	await invalid.refresh();
	assert.deepEqual(currentLocaleState(), { locale: "de-DE", source: "device" });
	reset();
});

test("an invalidated read reruns once and the newest answer wins", async () => {
	reset();
	const replies = [answer("fr"), answer("ru")];
	let calls = 0;
	let release = null;
	const locale = createMainLocale({
		app: appWith({ system: () => "en-US" }),
		request: () => {
			const index = Math.min(calls, replies.length - 1);
			calls += 1;
			if (calls === 1) {
				return new Promise((resolve) => {
					release = () => resolve(replies[index]);
				});
			}
			return Promise.resolve(replies[index]);
		},
		log: () => {},
	});
	const first = locale.refresh();
	// Two invalidations while the first read is in flight: one request, one rerun.
	void locale.refresh();
	void locale.refresh();
	assert.equal(calls, 1, "a coalesced refresh must not open a second request");
	release();
	await first;
	assert.equal(calls, 2, "the invalidation reruns exactly once");
	assert.equal(currentLocaleState().locale, "ru", "the newest answer wins");
	reset();
});

test("an accepted language write is a re-read trigger; the value it carried is irrelevant", async () => {
	globalThis.__mainLocaleHandlers = new Map();
	const frame = { url: "file:///app/index.html" };
	const contents = { mainFrame: frame };
	const owner = { webContents: contents, isDestroyed: () => false };
	let languageReads = 0;
	registerDesktopIPC(
		() => owner,
		"file:///app/index.html",
		async () => ({ status: 200, body: { result: { ok: true } } }),
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		() => {
			languageReads += 1;
		},
	);
	const invoke = globalThis.__mainLocaleHandlers.get("desktop-request");
	const event = { sender: contents, senderFrame: frame };

	// The renderer's value is never read by main; only the op/key and the 2xx.
	await invoke(event, {
		op: "settings.edit",
		key: "language",
		value: "../../evil",
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		languageReads,
		1,
		"an accepted edit triggers exactly one re-read",
	);

	await invoke(event, { op: "settings.reset", key: "language" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(languageReads, 2, "a reset of the same key triggers a re-read");

	for (const payload of [
		{ op: "settings.edit", key: "keymap.quickSend", value: "Cmd+K" },
		{ op: "settings.edit", key: "theme", value: "dark" },
	]) {
		await invoke(event, payload);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(
			languageReads,
			2,
			`${payload.key} must not trigger a language read`,
		);
	}

	assert.equal(
		isAcceptedLanguageEdit(
			{ op: "settings.edit", key: "language" },
			{ status: 400 },
		),
		false,
		"a refused edit changed nothing, so nothing is re-read",
	);
	assert.equal(
		isAcceptedLanguageEdit(
			{ op: "settings.edit", key: "language" },
			{ status: 204 },
		),
		true,
	);
});

test("the hold applies the marker's tag, then the device for a legacy marker, never junk", () => {
	reset();
	const app = appWith({ system: () => "de-DE" });

	assert.equal(applyHoldLocale({ language: "fr" }, app), "marker");
	assert.equal(installLaunchHoldNotice(marker).title, noticeFor("fr").title);

	// Legacy (pre-version) marker: no field at all. The device reading answers.
	assert.equal(applyHoldLocale({}, app), "device");
	assert.equal(currentLocaleState().locale, "de-DE");

	// A hand-edited or corrupt field is not a language: device again, not junk.
	assert.equal(applyHoldLocale({ language: "fr/../../x" }, app), "device");
	assert.equal(currentLocaleState().locale, "de-DE");

	// Nothing usable: keep whatever the process had rather than inventing one.
	setLocale("ru");
	assert.equal(applyHoldLocale({ language: 42 }, appWith({})), "kept");
	assert.equal(currentLocaleState().locale, "ru");
	reset();
});

test("tag validation accepts BCP-47 shapes and refuses data", () => {
	for (const tag of ["en", "fr-CA", "zh-Hans-CN", "es-419", "ur"])
		assert.equal(isLanguageTag(tag), true, tag);
	for (const bad of ["", " en", "en ", "fr/CA", "en_US", "--", 42, null])
		assert.equal(isLanguageTag(bad), false, String(bad));
	assert.deepEqual(resolveLocale(answer("fr").body.result), {
		locale: "fr",
		source: "backend",
	});
});

test("the watchdog's localized sentences travel as data, not shell syntax", () => {
	reset();
	const hostile = [
		"Hostile \"double\" 'single' `touch /tmp/pwned` $(touch /tmp/pwned)",
		"100% literal and {elapsed}",
		"newline follows",
		"second line",
	].join("\n");
	const plan = buildWatchdogPlan({
		appBundlePath: "/tmp/Fixture.app",
		executableName: "Fixture",
		appPid: 123,
		shipItJob: null,
		messages: {
			appWait: hostile,
			appWaitFallback: watchdogMessages().appWaitFallback,
			installing: watchdogMessages().installing,
			stillInstalling: watchdogMessages().stillInstalling,
			takingLonger: watchdogMessages().takingLonger,
		},
	});
	const envValue = plan.env.LO_UPDATE_WATCHDOG_MSG_APP_WAIT;
	/*
	 * The value is the sentence with `%` escaped and the elapsed token converted:
	 * that is what makes it a safe `printf` FORMAT rather than text inside quotes.
	 */
	assert.ok(
		envValue.includes("Hostile \"double\" 'single' `touch /tmp/pwned`"),
	);
	assert.ok(envValue.includes("100%% literal and %s"));
	assert.ok(envValue.includes("\nsecond line"));
	assert.equal(
		plan.script.includes("touch /tmp/pwned"),
		false,
		"a translation must never be interpolated into the script's source",
	);
	assert.match(
		plan.script,
		/notify "\$\(printf "\$LO_UPDATE_WATCHDOG_MSG_APP_WAIT" "\$\(elapsed_text\)"\)"/,
	);
	assert.ok(plan.env.LO_UPDATE_WATCHDOG_MSG_INSTALLING.length > 0);
	assert.equal(
		watchdogMessages().appWait.includes(WATCHDOG_ELAPSED_TOKEN),
		true,
		"the shipped English sentence keeps the elapsed token the script converts",
	);
});

test("the index wires the refresh on every source, including with no window", () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	const feed = source.slice(
		source.indexOf("backendService.observeDesktopFeed("),
		source.indexOf("backendService.providePresenceContext("),
	);
	const configRefresh = feed.indexOf(
		"frame.payload.changed_keys.includes(LANGUAGE_SETTING_KEY)",
	);
	const windowRead = feed.indexOf("const window = mainWindow;");
	assert.ok(configRefresh > 0, "the config frame is not handled at all");
	assert.ok(windowRead > 0);
	assert.ok(
		configRefresh < windowRead,
		"the locale refresh must run before the window-null early return (dock-only works)",
	);
	assert.match(feed, /void mainLocale\.refresh\(\)/);
	assert.match(
		source.slice(
			source.indexOf("backendService.onBackendReady("),
			source.indexOf("backendService.observeStream("),
		),
		/void mainLocale\.refresh\(\)/,
	);
});
