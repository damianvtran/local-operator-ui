/**
 * The addresses the app may spawn its managed daemon on must stay inside the
 * renderer's `connect-src`.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The renderer talks to the backend
 * DIRECTLY - the API clients under `src/renderer/src/shared/api/local-operator/`
 * fetch, stream and read against a mutable base URL, and main only moves that
 * URL - so an address outside the page's own content-security policy is a backend
 * the app cannot use: every request from the renderer is refused by the browser
 * before it leaves, and the only symptom is a pane that never fills. The spawn
 * fallback (`FALLBACK_SPAWN_URL`) exists precisely so the app keeps a backend it
 * can REACH when its configured address is held by a daemon it does not own, so
 * the two have to agree.
 *
 * The constant is read from the SHIPPED module rather than from the file's text:
 * this suite bundles the real TypeScript in memory, the same way the daemon
 * suites next to it do, so what is asserted is the value the app ships rather than
 * a regex's opinion about where it is written. `electron`, `./logger` and
 * `./config` are stubbed because `backend-service.ts` imports the app's own
 * modules at load time and none of them is the subject here.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const stubs = {
	name: "spawn-address-stubs",
	setup(b) {
		b.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		b.onResolve({ filter: /^\.\/(logger|config)$/ }, (a) =>
			a.importer.endsWith("backend-service.ts")
				? { path: a.path, namespace: "fixture" }
				: undefined,
		);
		b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
			loader: "js",
			contents:
				a.path === "electron"
					? "export const app={getPath:()=>'/nonexistent'}; export const dialog={showErrorBox(){}};"
					: a.path === "./logger"
						? 'export const logger={info(){},warn(){},error(){}}; export const LogFileType={BACKEND:"backend"};'
						: 'export const backendConfig={VITE_DISABLE_BACKEND_MANAGER:"false",VITE_LOCAL_OPERATOR_API_URL:"http://127.0.0.1:1111"};',
		}));
	},
};

const built = await build({
	stdin: {
		contents:
			'export { FALLBACK_SPAWN_URL } from "./src/main/backend/backend-service";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	plugins: [stubs],
});
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const { FALLBACK_SPAWN_URL } = module.exports;

/** The renderer's `connect-src`, as the browser reads it. */
const connectSrc = () => {
	const html = readFileSync("src/renderer/index.html", "utf8");
	const meta = html.match(
		/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/,
	)?.[0];
	assert.ok(
		meta,
		"src/renderer/index.html declares no Content-Security-Policy",
	);
	const directive = meta.match(/connect-src([^;]*);/)?.[1];
	assert.ok(directive, "the policy declares no connect-src");
	return directive.split(/\s+/).filter(Boolean);
};

test("the fallback spawn address is one the renderer's policy allows", () => {
	const allowed = connectSrc();
	assert.ok(
		allowed.includes(FALLBACK_SPAWN_URL),
		`${FALLBACK_SPAWN_URL} is not in connect-src (${allowed.join(" ")}); a daemon started there is one the renderer cannot dial, so the fallback would trade a dead app for an unreachable one`,
	);
});
