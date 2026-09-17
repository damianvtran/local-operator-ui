import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the store-refusal evidence harness only.
 *
 * Separate from `electron.vite.config.js` for the same reason
 * `composer-alert-geometry.vite.mjs` is: that config declares the app's own html
 * entries and the desktop HTTP proxy, and this harness is one page whose
 * `/__desktop` is answered here on purpose. Aliases are copied from the renderer
 * stage so the shipped modules resolve exactly as they do in the app.
 *
 * Started by `scripts/store-refusal-evidence.mjs`, which picks the port.
 */
const root = resolve(import.meta.dirname, "..");

/**
 * The backend's store-failure ladder, as error bodies.
 *
 * These are the three arms the desktop routes used to collapse into one 503
 * ("Read state is busy right now. It will catch up on its own."), and the split
 * is the change under evidence: the same composer, the same box, the same
 * pipeline, and the code alone deciding whether the alert's "what to do" half is
 * the false "Send it again.".
 *
 * THESE SENTENCES ARE STAND-INS, NOT THE SIBLING PR'S COPY (agent review round 1,
 * R-2). Nothing in the shipped renderer is affected by the difference - it paints
 * `detail.message` verbatim, which is the point of the arm - but the stills are
 * presented as the copy a user reads, and today they are not.
 *
 * What the sibling branch (`~/local-operator-worktrees/store-failure-classes`,
 * `local_operator/server/utils/store_failures.py`) sends is:
 *
 *   store_out_of_space  "This computer is out of disk space, so the message could
 *                        not be written. Free some space on the volume holding
 *                        {root} and send it again."
 *   store_unavailable   "The session store could not be read or written. Retrying
 *                        will not help; check {root} and the disk it is on."
 *
 * where `{root}` is the config root the request actually used. So the two
 * differences are wording AND the named destination: that PR moved both sentences
 * from "this disk"/"its logs" to the path the process touched, which is the copy
 * half of design round 1's D1 and UX round 1's U5. Both arms are routed there, and
 * this file is deliberately not updated ahead of it: a stand-in that changes when
 * the other branch rewords its copy would have to be re-captured for every
 * revision of a string this repository does not own.
 *
 * What is asserted about the sentence here is therefore the MECHANISM, which is
 * true of any wording: the composer renders whatever the wire carried, verbatim,
 * and the code decides the hint. `scripts/canonical-chat.test.mjs` pins the same
 * split against the codes themselves.
 */
const STORE_FAILURES = {
	busy: {
		status: 503,
		code: "store_busy",
		message: "Read state is busy right now. It will catch up on its own.",
	},
	"out-of-space": {
		status: 507,
		code: "store_out_of_space",
		message:
			"There is not enough space on this disk to save your message. Free up space, then send it again.",
	},
	unavailable: {
		status: 500,
		code: "store_unavailable",
		message:
			"This chat's stored state could not be read or written. Retrying will not help; check this machine's storage and its logs.",
	},
};

/**
 * Which failure the next `/__desktop` POST answers with.
 *
 * A control endpoint rather than a query on the page URL: the renderer's own
 * transport builds `/__desktop`'s request and this middleware sees only that, so
 * the page selects the case by naming it here first (it reads its own `?case=`).
 * One variable, one harness - nothing in the app reads it.
 */
let selected = "out-of-space";

/**
 * `altered` is not a fourth arm of the backend's ladder; it is the same
 * `store_out_of_space` refusal followed by the operator's own remedy - the text
 * restored, the image dropped, Enter pressed - so its FIRST attempt is that arm
 * and its second never reaches this server at all (the unchanged-payload guard
 * refuses it in the renderer, which is exactly what that frame exists to show).
 */
const CASE_ALIASES = { altered: "out-of-space" };

const storeFailureServer = () => ({
	name: "store-refusal-desktop-stub",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");

			if (url.pathname === "/__store-refusal-case") {
				const requested = url.searchParams.get("case") ?? "";
				const arm = CASE_ALIASES[requested] ?? requested;
				if (!(arm in STORE_FAILURES)) {
					res.statusCode = 400;
					res.end(`unknown case \`${requested}\``);
					return;
				}
				selected = arm;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ selected }));
				return;
			}

			if (url.pathname !== "/__desktop") {
				next();
				return;
			}

			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				let op;
				try {
					op = JSON.parse(body)?.op;
				} catch {
					op = undefined;
				}
				res.setHeader("Content-Type", "application/json");
				/*
				 * The session a draft addressed without one is created inside the
				 * send, so this hop has to answer it - the refusal under evidence is
				 * the MESSAGE request's, and a create that failed would be a
				 * different refusal entirely.
				 */
				if (op === "sessions.create") {
					res.end(
						JSON.stringify({
							result: {
								session_id: "111111111111",
								binding: { agent: null, team: null },
							},
						}),
					);
					return;
				}
				const failure = STORE_FAILURES[selected];
				/*
				 * HTTP 200 carrying the ENVELOPE, which is this channel's contract.
				 *
				 * The app's own `desktopProxyPlugin` answers every desktop control with
				 * `res.end(JSON.stringify(await requestDesktop(...)))` - `{status, body}` -
				 * so the upstream status travels INSIDE a 200 and the renderer's
				 * `desktopResult` classifies from `response.status`. Answering with the
				 * upstream status here instead looks more honest and is not: the
				 * renderer's dev path refuses any non-2xx before reading it
				 * (`Desktop controls need a compatible backend connection.`, no code), so
				 * that shape would photograph a refusal this transport cannot produce.
				 * Measured: the first version of this harness did exactly that and every
				 * frame showed that generic sentence.
				 */
				res.end(
					JSON.stringify({
						status: failure.status,
						body: { detail: { code: failure.code, message: failure.message } },
					}),
				);
			});
		});
	},
});

export default defineConfig({
	root: resolve(root, "scripts"),
	resolve: {
		alias: {
			"@renderer": resolve(root, "src/renderer/src"),
			"@components": resolve(root, "src/renderer/src/components"),
			"@features": resolve(root, "src/renderer/src/features"),
			"@shared": resolve(root, "src/renderer/src/shared"),
			"@assets": resolve(root, "src/renderer/src/assets"),
			"@hooks": resolve(root, "src/renderer/src/hooks"),
			"@api": resolve(root, "src/renderer/src/api"),
			"@store": resolve(root, "src/renderer/src/store"),
		},
	},
	plugins: [react(), tailwindcss(), storeFailureServer()],
	server: {
		port: Number(process.env.STORE_REFUSAL_PORT ?? 5431),
		strictPort: true,
	},
});
