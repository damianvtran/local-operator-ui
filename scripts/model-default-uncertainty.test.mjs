/**
 * The default checkbox's mutation fence, using the shipped callback bodies.
 *
 * node --test scripts/model-default-uncertainty.test.mjs
 *
 * A disabled DOM control alone cannot authorize queued/programmatic callbacks.
 * Execute the actual onPersistDefaultChange/saveModelDefault closures with
 * explicit reconciliation-state inputs, the real settings helper/desktop
 * endpoint, and a loopback HTTP receiver. This is callback + real HTTP proof,
 * not a claim of a native Electron or fully mounted React picker. The adjacent
 * Storybook cells exercise the rendered disabled control and live-read unlock.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const source = readFileSync(
	resolve(
		ROOT,
		"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
	),
	"utf8",
);
const saveStart = source.indexOf("const saveModelDefault = useCallback(");
const saveEnd = source.indexOf("\n\tconst onPick = useCallback(", saveStart);
const changeStart = source.indexOf("const onPersistDefaultChange = (checked:");
const changeEnd = source.indexOf("\n\n\t/*", changeStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
assert.ok(changeStart >= 0 && changeEnd > changeStart);
const callbacks = (
	await transform(
		`${source.slice(saveStart, saveEnd)}\n${source.slice(changeStart, changeEnd)}\nreturn { change: onPersistDefaultChange, drain: () => defaultWrites.current };`,
		{ loader: "ts", format: "cjs" },
	)
).code;
const bundle = await build({
	stdin: {
		contents: `
			export { desktopResult } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { desktopEndpoint } from "./src/shared/desktop-contract";
			export { writeModelDefaultSettings } from "./src/renderer/src/features/chat/pickers/model-default-settings";
			export { observeModelAuthority } from "./src/renderer/src/dev-driver/model-authority-observer";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	compiled,
	compiled.exports,
);
const {
	desktopResult,
	desktopEndpoint,
	writeModelDefaultSettings,
	observeModelAuthority,
} = compiled.exports;

test("unconfirmed defaults never PATCH; live resolution restores intended saving", async () => {
	const requests = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push({
			method: request.method,
			path: request.url,
			body: JSON.parse(body),
		});
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ result: {} }));
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const priorWindow = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				request: async (request) => {
					const endpoint = desktopEndpoint(request);
					const reply = await fetch(
						`http://127.0.0.1:${server.address().port}${endpoint.path}`,
						{
							method: endpoint.method,
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(endpoint.body),
						},
					);
					return { status: reply.status, body: await reply.json() };
				},
			},
		},
	};
	try {
		for (const cell of [
			{ name: "snapshot-pending", unconfirmed: true, switching: false },
			{ name: "snapshot-failed", unconfirmed: true, switching: false },
			{ name: "snapshot-cold", unconfirmed: true, switching: false },
			{
				name: "queued-stale-callback",
				unconfirmed: false,
				lock: true,
				switching: false,
			},
			{
				name: "command-in-flight-control",
				unconfirmed: false,
				switching: true,
			},
			{ name: "live-authority-resolved", unconfirmed: false, switching: false },
		]) {
			requests.length = 0;
			let saved = null;
			let checked = false;
			const intent = { current: false };
			const live = cell.name === "live-authority-resolved";
			const model = live
				? { provider: "openai", model_id: "gpt-6.1-sol" }
				: { provider: "anthropic", model_id: "claude-opus-5" };
			const context = {
				useCallback: (callback) => callback,
				defaultWrites: { current: Promise.resolve() },
				persist: { perform: async (work) => work(), setResult: () => {} },
				writeModelDefaultSettings,
				// The extracted shipped closure now references its real default-off
				// observer too: bind the module, never stub away the new call.
				observeModelAuthority,
				desktopResult,
				note: () => {},
				DEFAULT_SAVE_FAILURE: () => "",
				errorText: (error) => error.message,
				t: (key) => key,
				modelName: (value) => value,
				persistDefaultRef: intent,
				setPersistDefault: (value) => {
					checked = value;
				},
				savedModelRef: { current: null },
				setSavedModel: (value) => {
					saved = value;
				},
				switching: { current: cell.switching },
				unconfirmedModel: cell.unconfirmed,
				unconfirmedModelRef: { current: cell.lock ?? cell.unconfirmed },
				modelInForce: model,
			};
			const control = new Function(...Object.keys(context), callbacks)(
				...Object.values(context),
			);
			control.change(true);
			await control.drain();
			if (live) {
				assert.deepEqual(requests, [
					{
						method: "PATCH",
						path: "/v1/settings/hosting",
						body: { value: "openai" },
					},
					{
						method: "PATCH",
						path: "/v1/settings/model_name",
						body: { value: "gpt-6.1-sol" },
					},
				]);
				assert.equal(saved, "openai/gpt-6.1-sol");
			} else {
				assert.deepEqual(requests, []);
				assert.equal(saved, null);
			}
			// The uncertainty guard precedes state/ref updates too: a callback
			// cannot silently queue an intent for a future unrelated switch.
			const locked = cell.unconfirmed || cell.lock;
			assert.equal(checked, !locked);
			assert.equal(intent.current, !locked);
			console.log(
				JSON.stringify({
					cell: cell.name,
					settingsWrites: requests.length,
					saved,
				}),
			);
		}
	} finally {
		globalThis.window = priorWindow;
		await new Promise((done) => server.close(done));
	}
});
