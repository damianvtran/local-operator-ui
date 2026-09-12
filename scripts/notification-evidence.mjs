/**
 * Render real macOS/Windows/Linux notification banners from the SHIPPED
 * notifier, so a reviewer sees the actual OS surface rather than a mock.
 *
 * Usage (Electron will not take a bare script as an entry point, so the script
 * stages itself into a throwaway app directory and re-execs into it):
 *
 *     node scripts/notification-evidence.mjs [outdir]      # default /tmp/notification-evidence
 *
 * It always runs against an ISOLATED `--user-data-dir`. Sharing the default
 * profile with a Local Operator instance the operator already has open makes
 * `app.whenReady()` block indefinitely behind the running app's singleton lock,
 * and would put this run's state into their real profile.
 *
 * Why this exists. `scripts/desktop-notifier.test.mjs` proves the right STRINGS
 * reach the `Notification` boundary, with a fake constructor. It cannot prove
 * how the OS lays them out, and the one genuinely undecided rendering question
 * in this change — whether the state category reads well leading the body, or
 * belongs in the macOS-only `subtitle` — is answerable only by looking at a
 * rendered frame (docs/design/descriptive-notifications.md 8.3, 11.2).
 *
 * So this boots a REAL Electron main process, constructs the real
 * `DesktopNotifier` from the built bundle, feeds it the exact `notification`
 * frames the backend composes, and lets the real `new Notification()` reach
 * the OS. A tiny loopback server stands in for the backend's
 * `POST /notified`, answering `{claimed: true}`, because the notifier fails
 * closed and would otherwise show nothing at all — which is itself the point:
 * a banner appearing here is proof the claim path ran.
 *
 * It opens NO window on purpose. A visible focused window is exactly the state
 * the `when_unfocused` gate suppresses, so a headless main process is not a
 * shortcut here, it is the condition under test.
 *
 * Capturing the banner is the operator's job (`screencapture -x out.png` while
 * it is on screen, or a Notification Center shot) because macOS exposes no API
 * to screenshot its own banner. This script paces the toasts and prints what it
 * sent, so the capture can be matched to the payload with no guesswork.
 *
 * It also records each notification's `show` and `failed` events. That is the
 * OS ACCEPTING the notification, one layer below the pixels: if the banner does
 * not appear despite a `show`, the cause is a delivery policy (an undecided
 * permission prompt, Do Not Disturb, an unsigned bundle macOS declines to
 * register) rather than anything in this change. Recording it keeps the
 * distinction visible instead of leaving a blank screenshot to interpret.
 *
 * NOTE on bundles: run this from a PACKAGED app. macOS refuses to register
 * notifications for a bare `electron` dev binary, so `new Notification()`
 * succeeds and nothing is ever displayed. `pnpm exec electron-builder --dir`
 * then point the app's `Resources/app` at this file.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const OUT = process.argv[2] || "/tmp/notification-evidence";

/**
 * Under plain node, stage an Electron app directory around this file and
 * re-exec into it. Electron treats a bare script path as an app to LOAD, which
 * silently boots the whole product instead of this harness; only a directory
 * with a `package.json` naming `main` runs the file we mean.
 */
if (!process.versions.electron) {
	const stage = join(OUT, "app");
	mkdirSync(stage, { recursive: true });
	writeFileSync(
		join(stage, "package.json"),
		`${JSON.stringify({ name: "notification-evidence", version: "0.0.0", main: "main.mjs", type: "module" }, null, 2)}\n`,
	);
	// Re-export rather than copy: one source of truth for the payloads, and the
	// staged directory stays a two-line shim a reviewer can read at a glance.
	writeFileSync(
		join(stage, "main.mjs"),
		`import ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};\n`,
	);
	const electron = join(
		REPO,
		"node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
	);
	const result = spawnSync(
		electron,
		[stage, `--user-data-dir=${join(OUT, "userdata")}`],
		{ stdio: "inherit", env: { ...process.env, NOTIFY_EVIDENCE_OUT: OUT } },
	);
	process.exit(result.status ?? 1);
}

const { app, Notification } = await import("electron");
const OUTDIR = process.env.NOTIFY_EVIDENCE_OUT || OUT;

/** Seconds a banner stays legible before the next one replaces it. */
const SPACING_MS = 9000;

/**
 * The frames under test, one per kind the user can actually receive.
 *
 * Strings are written the way the BACKEND composer renders them (session name
 * as title, CONTEXTS value as status, last assistant line as body for
 * `complete` only) so the captured banner is representative of production and
 * not of prose invented here.
 *
 * THE HOUSE BODIES ARE COPIED FROM THE BACKEND, VERBATIM. They are
 * `local_operator/tui/notify.py`'s `BODY_*` constants — `BODY_COMPLETE`
 * ("Task complete"), `BODY_ERROR` ("Stopped with an error"),
 * `BODY_INTERRUPTED` ("Stopped before finishing") — reached through `BODIES`
 * in `local_operator/notifications/compose.py`. This file is what a reviewer,
 * a QA round and the next designer judge the shipped copy from, so prose
 * invented here produces a review of copy that does not exist: an earlier
 * revision rendered "Task complete." and "The turn ended with an error.",
 * neither of which any user can receive. If these strings ever drift from the
 * constants above, the banner is lying about production.
 */
const FRAMES = [
	{
		label: "complete-with-snippet",
		payload: {
			contract: 1,
			kind: "complete",
			title: "Quarterly revenue model",
			status: "Complete",
			body: "Rebuilt the forecast with the Q3 actuals and reconciled the 4.2% variance against the ledger.",
			body_is_snippet: true,
			title_is_session_name: true,
			dedupe_key: "complete:123456abcdef:11111111-1111-4111-8111-111111111111",
			completion_token: "11111111-1111-4111-8111-111111111111",
			session_name: "Quarterly revenue model",
			focus_policy: "when_unfocused",
		},
	},
	{
		label: "complete-privacy-flag-off",
		payload: {
			contract: 1,
			kind: "complete",
			// The privacy flag off means no session name AND no snippet: one flag
			// gates both, so a banner can never leak conversation content under a
			// generic title.
			title: "Local Operator",
			status: "Complete",
			// notify.py BODY_COMPLETE. No trailing period: the constant has none.
			body: "Task complete",
			body_is_snippet: false,
			title_is_session_name: false,
			dedupe_key: "complete:123456abcdef:22222222-2222-4222-8222-222222222222",
			completion_token: "22222222-2222-4222-8222-222222222222",
			session_name: null,
			focus_policy: "when_unfocused",
		},
	},
	{
		label: "error",
		payload: {
			contract: 1,
			kind: "error",
			title: "Nightly ETL backfill",
			status: "Needs attention",
			// No snippet on an error: the last assistant line predates the failure
			// and would assert success under a "Needs attention" status.
			// notify.py BODY_ERROR, verbatim.
			body: "Stopped with an error",
			body_is_snippet: false,
			title_is_session_name: true,
			dedupe_key: "complete:123456abcdef:33333333-3333-4333-8333-333333333333",
			completion_token: "33333333-3333-4333-8333-333333333333",
			session_name: "Nightly ETL backfill",
			focus_policy: "when_unfocused",
		},
	},
];

/**
 * The gate banners, which travel as `pending_gate`, not as a frame.
 *
 * `session_name` is ADDITIVE and OPTIONAL on this payload: absent on a backend
 * older than the notification contract, and empty when the backend's
 * `session_names_in_notifications()` privacy flag is off. Both nameless cases
 * are rendered here beside the named one, because a gate is the banner a user
 * is BLOCKED on and all three shapes ship.
 */
const GATES = [
	{
		label: "gate-ask-untitled",
		// The fixed bug: an untitled question used to announce "Approval needed".
		// Nameless, so the shape is unchanged from before this PR.
		gate: {
			request_id: "gate-ask-1",
			kind: "ask",
			title: "",
			detail: "Which environment should this deploy to?",
			options: [],
			secret: false,
			question_index: 0,
			question_total: 1,
		},
	},
	{
		label: "gate-approval",
		gate: {
			request_id: "gate-approval-1",
			kind: "approval",
			title: "Run database migration",
			detail: "This applies 00061_add_watchlist_release to the prod-2 cluster.",
			options: [],
			secret: false,
			question_index: 0,
			question_total: 1,
		},
	},
	{
		label: "gate-approval-named",
		// With the name present the gate takes the completion banner's shape, so
		// the banner holding a run hostage can be triaged without clicking it.
		gate: {
			request_id: "gate-approval-2",
			kind: "approval",
			title: "Run database migration",
			detail: "This applies 00061_add_watchlist_release to the prod-2 cluster.",
			options: [],
			secret: false,
			question_index: 0,
			question_total: 1,
			session_name: "Nightly ETL backfill",
		},
	},
	{
		label: "gate-ask-named",
		gate: {
			request_id: "gate-ask-2",
			kind: "ask",
			title: "",
			detail: "Which environment should this deploy to?",
			options: [],
			secret: false,
			question_index: 0,
			question_total: 1,
			session_name: "Quarterly revenue model",
		},
	},
	{
		label: "gate-ask-empty-detail",
		// `PendingGateState.detail` defaults to "" and is untrimmed on the wire,
		// which used to render a banner with a title and no body at all.
		gate: {
			request_id: "gate-ask-3",
			kind: "ask",
			title: "",
			detail: "",
			options: [],
			secret: false,
			question_index: 0,
			question_total: 1,
		},
	},
];

async function main() {
	mkdirSync(OUTDIR, { recursive: true });
	if (!Notification.isSupported()) {
		console.error(
			"This platform reports no notification support; nothing to capture.",
		);
		app.exit(1);
		return;
	}

	// Stand in for the backend's claim route. Recording every request is what
	// makes the run auditable: the log below is proof the claim ran BEFORE each
	// banner, in the order the design pins.
	const claims = [];
	const server = createServer((req, res) => {
		claims.push({ at: Date.now(), path: req.url, method: req.method });
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ result: { claimed: true } }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

	// Bundle the SHIPPED source and hand it the REAL `Notification` class off a
	// global. Not a mock: this is Electron's own constructor, reaching the real
	// OS notification centre. The indirection exists only because the bundle is
	// imported from a `data:` URL, which cannot resolve the bare `electron`
	// specifier; the fake-constructor version of this proof already lives in
	// scripts/desktop-notifier.test.mjs and is a different claim entirely.
	/**
	 * OS-level acceptance per toast. `show` means the notification centre took
	 * it; `failed` means the platform refused it and names why.
	 */
	const osEvents = [];
	// Wrap the real class so every instance reports what the OS did with it,
	// without the notifier under test knowing it is being observed. Installed
	// BEFORE the bundle is imported: the bundle binds `Notification` at module
	// evaluation, so a later reassignment would never be seen.
	/**
	 * Every set of constructor arguments that actually reached the OS.
	 *
	 * The log below is printed FROM THIS, never from the payload. An earlier
	 * revision re-derived the expected title and body in the print loop, which
	 * made the artifact incapable of showing a rendering change: it reported
	 * `status — body` for every banner while the notifier had already stopped
	 * joining them. An evidence script that composes its own copy is the D1
	 * defect in a second place, so the only strings this file prints are the
	 * ones the notifier passed to `new Notification()`.
	 */
	const constructed = [];
	globalThis.__realElectron = {
		Notification: new Proxy(Notification, {
			construct(target, args) {
				const instance = new target(...args);
				const title = args[0]?.title;
				constructed.push({ title, body: args[0]?.body });
				instance.on("show", () =>
					osEvents.push({ title, event: "show", at: Date.now() }),
				);
				instance.on("failed", (_event, error) =>
					osEvents.push({ title, event: "failed", error: String(error) }),
				);
				return instance;
			},
		}),
	};
	const { build } = await import("esbuild");
	const bundle = await build({
		stdin: {
			contents: 'export * from "./src/main/desktop-notifier";',
			resolveDir: REPO,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		plugins: [
			{
				name: "real-electron",
				setup(builder) {
					builder.onResolve({ filter: /^electron$/ }, () => ({
						path: "electron",
						namespace: "real",
					}));
					builder.onLoad({ filter: /.*/, namespace: "real" }, () => ({
						contents:
							"export const Notification = globalThis.__realElectron.Notification;",
						loader: "js",
					}));
				},
			},
		],
	});
	const { DesktopNotifier } = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

	const sent = [];
	const notifier = new DesktopNotifier(
		() => null,
		async (input) => {
			const response = await fetch(
				`http://127.0.0.1:${server.address().port}/v1/desktop/sessions/${input.sessionId}/notified`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ completion_token: input.completionToken }),
				},
			);
			return { status: response.status, body: await response.json() };
		},
	);

	/**
	 * Report what the notifier really constructed for the frame just fed to it.
	 *
	 * Reads the tail of `constructed` rather than re-deriving the strings, so a
	 * suppressed banner prints as `(no notification raised)` instead of copy
	 * that was never sent.
	 */
	const report = (label) => {
		const toast = constructed.at(-1);
		console.log(`\n[${label}]`);
		if (!toast || sent.some((s) => s.toast === toast)) {
			console.log("  (no notification raised)");
			sent.push({ label, raised: false });
			return;
		}
		console.log(`  title : ${toast.title}`);
		console.log(`  body  : ${toast.body}`);
		sent.push({ label, raised: true, ...toast, toast });
	};

	for (const { label, payload } of FRAMES) {
		notifier.observe("123456abcdef", {
			session_id: "123456abcdef",
			epoch: "abc123",
			seq: 1,
			type: "notification",
			payload,
		});
		// The composed path claims delivery over HTTP before it shows anything,
		// so the toast does not exist yet on the turn of this loop.
		await new Promise((resolve) => setTimeout(resolve, 250));
		report(label);
		await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
	}

	for (const { label, gate } of GATES) {
		notifier.observe("123456abcdef", {
			session_id: "123456abcdef",
			epoch: "abc123",
			seq: 2,
			type: "frontend.update",
			payload: {
				epoch: "abc123",
				sequence: 2,
				changes: { pending_gate: gate },
			},
		});
		report(label);
		await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
	}

	writeFileSync(
		join(OUTDIR, "payloads.json"),
		`${JSON.stringify({ sent: sent.map(({ toast: _t, ...rest }) => rest), claims, osEvents }, null, 2)}\n`,
	);
	console.log(`\nclaims posted: ${claims.length} (one per completion frame)`);
	console.log(
		`OS accepted : ${osEvents.filter((e) => e.event === "show").length} shown, ${osEvents.filter((e) => e.event === "failed").length} failed`,
	);
	console.log(`payload log: ${join(OUTDIR, "payloads.json")}`);
	server.close();
	app.exit(0);
}

app.whenReady().then(main);
