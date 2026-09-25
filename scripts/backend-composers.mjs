/*
 * The backend copy COMPOSERS, loaded into a node harness from their TypeScript sources.
 *
 * WHY THIS IS A MODULE. Three harnesses need the shipped sentences: the copy test
 * compares the story fixtures against them, and two fixture files render or classify
 * states whose text a person reads on the page. Two of those hand-copied the sentence
 * instead, so when the composer changed - design round 3 removed the markdown delimiters
 * from the act clause, because `AlertDescription` renders these as plain text - the
 * fixtures kept the old text, the new "no shipped sentence carries a backtick" assertion
 * never reached them, and a test that should have failed could not (agent round 4, R4-2).
 * The health-state half of that pair is the one with a failing mode (agent round 1, M1:
 * the notice suite needed an assertion of its own, added beside it); this module is what
 * makes the clauses come from ONE place either way.
 *
 * PROSPECTIVE, NOT COMPLETE (agent round 1, N1): three same-shaped inline main-process
 * bundles remain - `scripts/daemon-observation.test.mjs`, `scripts/session-stream-token.test.mjs`
 * and `scripts/owned-serve-lifecycle.test.mjs`. Folding those in is a follow-up rather
 * than something this change claims to have done.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

/*
 * The main-process fixtures these composers' imports need: `electron`, `./logger` and
 * `./config`.
 *
 * UNCONDITIONALLY, rather than per importer (agent round 1, N3): the interception used to
 * be scoped to `backend-service.ts`, so any OTHER main-process module in this bundle got
 * the real thing - and the real `src/main/backend/config.ts` runs `dotenvConfig` over
 * `join(process.cwd(), ".env")` in its own body. Nothing here should be able to reach a
 * file outside its scratch home, so the specifiers are intercepted for every importer in
 * this bundle. The composers are pure, so none of these is ever reached - they exist so
 * that stays true if a future edit makes one reach for `app` or the logger.
 */
const mainProcessFixtures = (home) => ({
	name: "main-process-fixtures",
	setup(builder) {
		builder.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		for (const filter of [/^\.\/logger$/, /^\.\/config$/]) {
			builder.onResolve({ filter }, (args) => ({
				path: args.path,
				namespace: "fixture",
			}));
		}
		builder.onLoad(
			{ filter: /^(electron|\.\/logger|\.\/config)$/, namespace: "fixture" },
			(args) => ({
				contents:
					args.path === "electron"
						? `export const app = { getPath: () => ${JSON.stringify(home)}, whenReady: async () => {}, on: () => {}, quit: () => {}, isPackaged: false }; export const dialog = { showErrorBox: () => {} }; export default { app, dialog };`
						: args.path === "./logger"
							? 'export const LogFileType = { INSTALLER: "installer", BACKEND: "backend" }; const emit = () => () => {}; export const logger = { info: emit(), warn: emit(), error: emit(), debug: emit(), verbose: emit() };'
							: 'export const backendConfig = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1111", VITE_DISABLE_BACKEND_MANAGER: "false" };',
				loader: "js",
			}),
		);
	},
});

/** The shipped composers, bundled from source and imported as one ES module. */
export async function loadBackendComposers() {
	/*
	 * THE SCRATCH HOME IS MADE HERE AND REMOVED ON EXIT (agent round 1, N4): created at
	 * import time it outlived every run, and twenty-six `backend-composers-*` directories
	 * had accumulated in `$TMPDIR` from three suites before the review counted them.
	 */
	const home = mkdtempSync(join(tmpdir(), "backend-composers-"));
	process.once("exit", () => rmSync(home, { recursive: true, force: true }));
	const bundle = await build({
		stdin: {
			contents:
				'export { serverBannerCopy } from "./src/shared/backend-status.ts"; export { describeHolders, describeSpawnRefusal, reclaimClause } from "./src/main/backend/backend-service.ts";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		plugins: [mainProcessFixtures(home)],
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
}

/*
 * ONE FIXTURE FACTORY FOR THE OCCUPANCY SHAPE. `AddressOccupant`'s fields, and the values
 * the stories name: `pid 42411, uv-tool, v0.55.6` at 1111, and `pid 53501, v0.55.5` at
 * 8080 with no `install_kind` (so the install fact is the prefix's last segment).
 */
export const occupant = (over = {}) => ({
	address: "http://127.0.0.1:1111",
	pid: null,
	pidSource: null,
	version: "",
	prefix: "",
	installKind: "",
	startedAtMs: null,
	desktopReadStatus: null,
	...over,
});

/** One `OriginOccupancy` of kind `daemon`, as `configuredOriginOccupancy` builds it. */
export const daemonRecord = (over = {}) => ({
	kind: "daemon",
	occupant: occupant({
		pid: 42411,
		pidSource: "answer",
		version: "0.55.6",
		installKind: "uv-tool",
		...over,
	}),
	detail: "answered with a different instance id",
});
