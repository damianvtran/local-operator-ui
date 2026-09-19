import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The chat plane has no socket, and this is what keeps it that way.
 *
 * WHY THIS EXISTS. The renderer carried two chat transports for a year: the
 * desktop-plane SSE the app actually streams a turn on, and a legacy socket
 * client (`shared/api/local-operator/websocket-api.ts`) with an
 * SSE-to-socket fallback router (`streaming-transport.ts`) in front of it. The
 * canonical transcript cutover orphaned the second one, and locating that took
 * a read-only audit that had to walk five hops by hand
 * (`StreamingClient` -> `useWebSocketMessage` -> `useStreamingMessage` ->
 * `StreamingMessage` -> `MessagesView`, the last rendered only by a branch
 * `ChatContent` could not reach). Nothing in the toolchain could answer "is
 * this still reachable": `tsc`, `biome` and every unit test are happy with
 * statically-imported dead code, and the `pnpm lint` path list does not even
 * name `scripts/`. So the plane sat there looking live.
 *
 * WHAT IT ASSERTS, and why each half is here rather than only one of them:
 *
 *  - The SOURCE scan is the cheap, precise half: a socket construction is a
 *    thing you write, not a thing you inherit, so `new WebSocket(` in
 *    `src/**` is a deliberate act and the failure lands on the line that did
 *    it. Its limit is the same as its precision: it sees the tree, not what
 *    the bundler makes of it — a dependency could open a socket and this would
 *    not know.
 *  - The BUNDLE walk is the half that covers that gap. It bundles the real
 *    renderer entry with the same alias map the vite renderer config declares
 *    and reads esbuild's own `metafile`, so it answers about the module graph
 *    the app ships rather than about the files someone happened to look at.
 *    This is the repo's existing esbuild idiom
 *    (`scripts/completion-view-ack.test.mjs`, `scripts/canonical-chat.test.mjs`)
 *    applied to a graph question instead of a behaviour one.
 *  - The CSP check is the only place the ws scheme has a legitimate spelling:
 *    the policy is what would silently permit a socket, and a re-added entry is
 *    how a re-added client would be made to work by whoever hit the refusal.
 *
 * WHAT IT DOES NOT ASSERT: that the desktop pane's own SSE/EventSource path
 * (`desktop-api.ts`, the `/__desktop/stream` proxy fallback) is gone. That path
 * is the shipped one and is deliberately left alone — this guard is about the
 * socket, and widening it to "no EventSource" would fail on the live transport.
 */

/** The modules the socket plane was made of, as specifiers would spell them. */
const REMOVED_MODULES = [
	"shared/api/local-operator/websocket-api",
	"shared/api/local-operator/streaming-transport",
	"shared/api/local-operator/sse-api",
	"shared/hooks/use-websocket-message",
	"shared/hooks/use-streaming-message",
	"shared/store/streaming-messages-store",
	"features/chat/components/messages-view",
	"features/chat/components/loading-indicator",
	"features/chat/components/message-item/streaming-message",
];

const tracked = (pattern) =>
	execFileSync("git", ["ls-files", "-z", "--", pattern], { encoding: "utf8" })
		.split("\0")
		.filter(Boolean);

test("no tracked source file constructs a WebSocket", () => {
	const files = tracked("src").filter((file) => /\.(ts|tsx)$/.test(file));
	const offenders = [];
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (/new WebSocket\s*\(/.test(lines[i])) {
				offenders.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 80)}`);
			}
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`the chat plane streams over the desktop SSE relay; a WebSocket in the renderer is a second transport nothing asked for:\n${offenders.join("\n")}`,
	);
});

test("the renderer CSP advertises no ws/wss origin", () => {
	const html = readFileSync("src/renderer/index.html", "utf8");
	const meta = html.match(
		/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/,
	)?.[0];
	assert.ok(
		meta,
		"src/renderer/index.html declares no Content-Security-Policy",
	);
	// `connect-src` is the directive that would have to name the origin a socket
	// dials; a `ws://` anywhere else in the policy (or in the prose above it) is
	// not a grant, so the assertion reads the directive rather than the file.
	const connectSrc = meta.match(/connect-src([^;]*);/)?.[1];
	assert.ok(connectSrc, "the policy declares no connect-src");
	assert.ok(
		!/\bwss?:\/\//.test(connectSrc),
		`connect-src still advertises a socket origin:${connectSrc}`,
	);
});

test("the removed socket modules are gone and nothing imports them", () => {
	for (const module of REMOVED_MODULES) {
		const candidates = [
			`src/renderer/src/${module}.ts`,
			`src/renderer/src/${module}.tsx`,
		];
		const present = candidates.filter((path) => existsSync(path));
		assert.deepEqual(
			present,
			[],
			`${module} was deleted with the socket plane, and its return needs a reason rather than a file: it had no reachable consumer`,
		);
	}
	// Specifier-shaped rather than substring-shaped, so `use-streaming-message`
	// and `streaming-messages-store` cannot be confused for each other.
	const specifier = new RegExp(
		`["'][^"']*(?:${REMOVED_MODULES.join("|")})["']`,
	);
	const offenders = [];
	for (const file of tracked("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
		const text = readFileSync(file, "utf8");
		if (specifier.test(text)) offenders.push(file);
	}
	assert.deepEqual(
		offenders,
		[],
		`a module that no longer exists is still imported here:\n${offenders.join("\n")}`,
	);
});

test("the shipped renderer bundle contains no socket transport", async () => {
	const result = await build({
		entryPoints: ["src/renderer/src/main.tsx"],
		bundle: true,
		format: "esm",
		platform: "browser",
		write: false,
		metafile: true,
		tsconfig: "./tsconfig.app.json",
		// The alias map `electron.vite.config.js` declares for the renderer.
		// esbuild does not read that config, and `tsconfig.app.json` only names
		// three of these paths, so a missing entry shows up as an unresolved
		// import rather than as a quiet pass.
		alias: {
			"@renderer": resolve("src/renderer/src"),
			"@components": resolve("src/renderer/src/components"),
			"@features": resolve("src/renderer/src/features"),
			"@shared": resolve("src/renderer/src/shared"),
			"@assets": resolve("src/renderer/src/assets"),
			"@hooks": resolve("src/renderer/src/hooks"),
			"@api": resolve("src/renderer/src/api"),
			"@store": resolve("src/renderer/src/store"),
		},
		// Loaders are the test's own noise control, not a claim about the app:
		// the question is which MODULES reach the graph, and stylesheets and
		// binary assets cannot answer it. `empty` discards a stylesheet without
		// needing an output path (`write: false`), and the plugin below keeps
		// every other non-code specifier out of the bundle the same way — so a
		// new asset type in a story does not fail this test for a reason that has
		// nothing to do with sockets.
		loader: { ".css": "empty" },
		plugins: [
			{
				name: "assets-are-not-the-subject",
				setup(builder) {
					builder.onResolve(
						{
							filter:
								/\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|wav|webm|pdf)$/i,
						},
						(args) => ({ path: args.path, external: true }),
					);
				},
			},
		],
		logLevel: "silent",
	});

	const inputs = Object.keys(result.metafile.inputs);
	for (const module of REMOVED_MODULES) {
		const hit = inputs.filter((path) => path.includes(`/${module}.`));
		assert.deepEqual(
			hit,
			[],
			`${module} still reaches the renderer's module graph - see the reachability notes on this test before deleting it again`,
		);
	}

	// Every output, not only the ones a `.js` suffix would name: a single entry
	// with `write: false` reports one output whose `path` is `<stdout>`, so a
	// filter on the extension silently checks nothing.
	const emitted = result.outputFiles.map((file) => file.text).join("\n");
	const socket = emitted.match(/new WebSocket\s*\(/);
	assert.equal(
		socket,
		null,
		"the renderer bundle constructs a WebSocket; the shipped chat plane is the desktop SSE relay",
	);
});
