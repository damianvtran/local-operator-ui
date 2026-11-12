import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * WHAT THE PAINT'S LIVENESS BIT READS.
 *
 * THE DEFECT (UX blocker U6 / QA Q2, #1883 round 1): the paint wrote
 * `busy: turnRunning(view)`, and that predicate is FALSE whenever a terminal
 * event has been seen - and `TERMINAL_EVENTS` includes `turn_start`,
 * `agent_start`, `provider_start` and `steering_delivered`. So every turn this
 * pane watched begin was recorded as idle: a CDP breakpoint at the write read
 * `busy:false` while the UI showed the working line, a turn started in the pane
 * then left painted no working line for the whole revalidate, and only a view
 * whose turn arrived through a SNAPSHOT (which clears `terminal`) worked.
 *
 * WHAT IS REAL: `paintTurnBusy` from the shipped hook module - the function the
 * unmount write now calls. WHAT IS STUBBED: the transport module only, because
 * the hook module imports the desktop API at module scope; nothing in these
 * cases touches the network. The shipped tests already synthesise `busy: true`
 * directly, which is why this seam had no coverage at all.
 */

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

const ROOT = resolve(import.meta.dirname, "..");
const bundle = await build({
	stdin: {
		contents:
			'export { paintTurnBusy } from "@shared/hooks/use-canonical-session";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	external: ["react", "react/jsx-runtime"],
	plugins: [
		{
			name: "paint-busy-transport-fixture",
			setup(builder) {
				// The network is never reached here; the module is imported by the
				// hook's graph, so it has to resolve to something. The error classes
				// come from the real module, as the switch suite's fixture does.
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export * from ${JSON.stringify(
						`${ROOT}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)};
export const desktopResult = async () => ({});`,
					loader: "js",
					resolveDir: ROOT,
				}));
			},
		},
	],
});
const cache = join(ROOT, "node_modules", ".cache", "paint-turn-busy");
mkdirSync(cache, { recursive: true });
const bundlePath = join(cache, `bundle-${process.pid}.mjs`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { paintTurnBusy } = await import(pathToFileURL(bundlePath).href);

/** The write's view state, plus the registry's answer for an admitted send. */
const state = (over = {}) => ({
	terminal: null,
	failure: null,
	frontend: { streaming: true },
	heldFrontend: null,
	...over,
});

test("a turn this pane watched START is still running", () => {
	// The U6 shape exactly: the pane saw `turn_start`, so `terminal` is set, and
	// the frontend reading is the one that says the turn is alive.
	assert.equal(
		paintTurnBusy(state({ terminal: "turn_start" }), false),
		true,
		"a start event is not an end, whatever the label hold's latch says",
	);
	assert.equal(
		paintTurnBusy(state({ terminal: "agent_start" }), false),
		true,
		"the other start events are the same fact",
	);
});

test("the held reading across a receipt gap is the live pane's claim", () => {
	// The pane paints the working line from `frontend ?? heldFrontend`; a switch
	// during a routine reconnect must paint what the pane was showing.
	assert.equal(
		paintTurnBusy(
			state({ frontend: null, heldFrontend: { streaming: true } }),
			false,
		),
		true,
	);
});

test("a locally-sent prompt with no owner frame yet is a running turn", () => {
	// The working line's `starting` arm: the app's own admitted send, which exists
	// before any owner frame and is what the reader sees a line for.
	assert.equal(
		paintTurnBusy(state({ frontend: null, heldFrontend: null }), true),
		true,
	);
});

test("a finished turn is settled, and a failure settles it", () => {
	assert.equal(
		paintTurnBusy(
			state({
				terminal: "turn_end",
				frontend: { streaming: false },
			}),
			false,
		),
		false,
		"the owner's own statement ends the claim",
	);
	assert.equal(
		paintTurnBusy(
			state({ frontend: { streaming: true }, failure: { statement: "gone" } }),
			false,
		),
		false,
		"a failure is not a running turn, as everywhere else in this hook",
	);
	assert.equal(
		paintTurnBusy(state({ frontend: null, heldFrontend: null }), false),
		false,
		"nothing was running and nothing is waiting",
	);
});
