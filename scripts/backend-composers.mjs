/*
 * The backend copy COMPOSERS, loaded into a node harness from their TypeScript sources.
 *
 * WHY THIS IS A MODULE AND NOT FOUR INLINE BUNDLE ENTRIES. Three harnesses need the
 * shipped sentences: the copy test compares the story fixtures against them, and two
 * fixture files render or classify states whose text a person reads on the page. Two of
 * those hand-copied the sentence instead, so when the composer changed - design round 3
 * removed the markdown delimiters from the act clause, because `AlertDescription` renders
 * these as plain text - the fixtures kept the old text, the new "no shipped sentence
 * carries a backtick" assertion never reached them, and a test that should have failed
 * could not (agent round 4, R4-2; the drift class design round 1's D2 found one surface
 * over). One loader and one fixture factory, so a fixture cannot describe a state the
 * product no longer produces.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

const HOME = mkdtempSync(join(tmpdir(), "backend-composers-"));

/*
 * The main-process fixtures these composers' imports need: `electron`, `./logger` and
 * `./config`. The composers are pure, so none of these is ever reached - they exist so
 * that stays true if a future edit makes one reach for `app` or the logger, and so no
 * harness can touch the operator's own config, log or daemon on any path.
 */
const mainProcessFixtures = {
	name: "main-process-fixtures",
	setup(builder) {
		builder.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		for (const filter of [/^\.\/logger$/, /^\.\/config$/]) {
			builder.onResolve({ filter }, (args) =>
				args.importer.endsWith("main/backend/backend-service.ts")
					? { path: args.path, namespace: "fixture" }
					: undefined,
			);
		}
		builder.onLoad(
			{ filter: /^(electron|\.\/logger|\.\/config)$/, namespace: "fixture" },
			(args) => ({
				contents:
					args.path === "electron"
						? `export const app = { getPath: () => ${JSON.stringify(HOME)}, whenReady: async () => {}, on: () => {}, quit: () => {}, isPackaged: false }; export const dialog = { showErrorBox: () => {} }; export default { app, dialog };`
						: args.path === "./logger"
							? 'export const LogFileType = { INSTALLER: "installer", BACKEND: "backend" }; const emit = () => () => {}; export const logger = { info: emit(), warn: emit(), error: emit(), debug: emit(), verbose: emit() };'
							: 'export const backendConfig = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1111", VITE_DISABLE_BACKEND_MANAGER: "false" };',
				loader: "js",
			}),
		);
	},
};

/** The shipped composers, bundled from source and imported as one ES module. */
export async function loadBackendComposers() {
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
		plugins: [mainProcessFixtures],
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
