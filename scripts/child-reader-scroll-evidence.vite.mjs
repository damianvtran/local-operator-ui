import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the child reader's scroll harness.
 *
 * Separate from `electron.vite.config.js` for the same reason
 * `diff-body-evidence.vite.mjs` is: that config's renderer stage declares the
 * app's own html entries and the desktop HTTP proxy, and this harness is ONE
 * page that mounts the shipped `RunChildReader` over a SCRIPTED child.
 *
 * THE SCRIPTED CHILD IS THE ONE FAKE, and it sits where the backend sits rather
 * than where the transport sits. `desktopProxyPlugin` exposes the same typed
 * vocabulary at the same-origin `POST /__desktop` during Vite development
 * (`docs/desktop-controls.md`, "Browser development"); this plugin answers that
 * route for ONE op, `subagents.transcript`, from an in-process list of rows that
 * the driver grows a batch at a time. So the renderer side of the transport is
 * the shipped one — `desktopRequest`'s real `/__desktop` branch, the real op
 * vocabulary, the real envelope — and what is missing is the parent's own
 * backend: the roster, the job, the wire and the child process that writes the
 * file. `docs/evidence/child-reader-tail-follow/README.md` states that split,
 * and `docs/evidence/chat-run-panel-live/` is the committed set that covers the
 * other half against a real backend.
 *
 * The row CONTENT is the story fixtures' own shape (`run-details.fixtures.ts`'s
 * `entry()`), which is the frontend's reading of a durable row. Scroll
 * behaviour does not depend on which text a row holds, and the frames say which
 * rows they show.
 *
 * Aliases are copied from the renderer stage so the shipped modules resolve
 * exactly as they do in the app; the `@source` in the harness page's own CSS
 * is what makes the role utilities compile outside `src/renderer/src`.
 */
const root = resolve(import.meta.dirname, "..");

/**
 * The instant this run's scripted child started, in the wire's epoch SECONDS.
 *
 * Taken from the run rather than pinned to a literal so the rows' own timestamps
 * and the reader's elapsed label describe the same moment: a fixed epoch in the
 * past renders "May 28, 4:28 PM" under a header reading "9m33s", and a frame
 * whose two clocks disagree is a frame a reviewer has to stop and interpret.
 */
const RUN_STARTED_S = Math.round(Date.now() / 1000) - 600;

/** Roughly one tool batch of a child's conversation, in the wire's own shape. */
const PARAGRAPHS = [
	"I read the ledger export and grouped the unpaid rows by customer rather than by invoice date, because the two orderings disagree about four of the balances and the customer view is the one that decides what to do next.",
	"Two of those four carry reminder emails and two do not, and the two without are the oldest pair, which is the pattern I would expect if a reminder is what moves a customer to pay at all.",
	"The totals reconcile against the payment run once credits are applied to the invoice they name; without that rule the same two rows read as outstanding every month and the work repeats.",
];

/**
 * The scripted child.
 *
 * Deliberately the SAME shape a real child's file produces at a batch boundary:
 * a durable tool result, then the assistant text that follows it. A tail read
 * gets the newest `limit` rows of whatever is here, exactly as
 * `child_transcript` in the backend returns them (`[json.loads(row.to_json())]`
 * over `read_transcript_page`), so the reader's merge sees appends at the tail
 * and nothing else.
 */
/**
 * The counter the settled-child claim is read from: a read that does not happen
 * cannot be observed from the page (`useChildTranscript`'s poll leaves no
 * trace), so the route that answers counts its own calls.
 */
class ScriptedChild {
	rows = [];
	next = 0;
	reads = 0;
	constructor() {
		this.rows.push({
			id: "entry-launch",
			ts: RUN_STARTED_S,
			type: "message",
			payload: {
				kind: "message",
				role: "user",
				id: "entry-launch",
				content: [
					{
						type: "text",
						text: "Reconcile the March invoices against the ledger and tell me which ones are actually outstanding.",
					},
				],
				tool_calls: [],
			},
		});
	}

	/** Back to the launch turn alone: every theme starts from the same state. */
	reset() {
		this.rows.length = 1;
		this.next = 0;
		this.reads = 0;
	}

	/** One batch: a bash call and its result, then the assistant's prose. */
	batch() {
		const n = this.next++;
		const callId = `call-${String(n).padStart(3, "0")}`;
		const ts = RUN_STARTED_S + n * 4;
		this.rows.push({
			id: `entry-assistant-${n}`,
			ts,
			type: "message",
			payload: {
				kind: "message",
				role: "assistant",
				id: `entry-assistant-${n}`,
				content: [{ type: "text", text: PARAGRAPHS[n % PARAGRAPHS.length] }],
				tool_calls: [
					{
						id: callId,
						name: "bash",
						arguments: {
							i: `Read the ledger export, pass ${n + 1}`,
							command: `python3 -c "import csv;print(len(list(csv.DictReader(open('ledger/march.csv')))))"`,
						},
					},
				],
				stop_reason: "toolUse",
			},
		});
		this.rows.push({
			id: `entry-tool-${n}`,
			ts: ts + 1,
			type: "message",
			payload: {
				kind: "message",
				role: "tool",
				id: `entry-tool-${n}`,
				content: [
					{
						type: "text",
						text: `412 rows read, ${(n % 4) + 2} unpaid, 0 parse errors`,
					},
				],
				tool_calls: [],
				tool_call_id: callId,
				tool_name: "bash",
				provider_payload: { duration_s: 0.4 + n / 10 },
			},
		});
		this.rows.push({
			id: `entry-assistant-${n}-reply`,
			ts: ts + 2,
			type: "message",
			payload: {
				kind: "message",
				role: "assistant",
				id: `entry-assistant-${n}-reply`,
				content: [
					{
						type: "text",
						text: `Pass ${n + 1} is reconciled against the ledger. ${PARAGRAPHS[(n + 1) % PARAGRAPHS.length]}`,
					},
				],
				tool_calls: [],
				stop_reason: "endTurn",
			},
		});
	}

	/** The tail page, in the parent route's envelope (`§ 10.1`). */
	page(limit) {
		return {
			entries: this.rows.slice(Math.max(0, this.rows.length - limit)),
			has_more: this.rows.length > limit,
			cursor_missing: false,
			state: "ready",
		};
	}
}

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
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "child-reader-scripted-child",
			configureServer(server) {
				const child = new ScriptedChild();
				const readBody = (req) =>
					new Promise((done) => {
						let body = "";
						req.on("data", (chunk) => {
							body += chunk;
						});
						req.on("end", () => done(body));
					});
				server.middlewares.use("/__desktop", (req, res) => {
					void (async () => {
						res.setHeader("content-type", "application/json");
						let request = {};
						try {
							request = JSON.parse((await readBody(req)) || "{}");
						} catch {
							res.statusCode = 400;
							res.end(JSON.stringify({ status: 400, body: null }));
							return;
						}
						if (request.op === "subagents.transcript") {
							child.reads += 1;
							res.statusCode = 200;
							res.end(
								JSON.stringify({
									status: 200,
									body: { result: child.page(request.limit ?? 100) },
								}),
							);
							return;
						}
						/*
						 * Anything else is a refusal rather than a stub: an op this
						 * harness does not serve must look EXACTLY like a backend that
						 * does not have it, so a surface reaching for one is visible in
						 * the run's own log instead of appearing to work.
						 */
						console.log(`[scripted child] refused op ${request.op}`);
						res.statusCode = 404;
						res.end(
							JSON.stringify({
								status: 404,
								body: {
									detail: {
										code: "unknown_op",
										message: `the scripted child serves no ${request.op}`,
									},
								},
							}),
						);
					})();
				});
				/*
				 * The driver's own control surface, and the only way anything grows:
				 * `POST /__child/batch` appends one batch, so an arrival is a real
				 * change in what the route answers rather than a stubbed push into
				 * the renderer.
				 */
				server.middlewares.use("/__child", (req, res) => {
					void (async () => {
						res.setHeader("content-type", "application/json");
						if (req.url?.startsWith("/batch")) {
							child.batch();
							res.statusCode = 200;
							res.end(
								JSON.stringify({ rows: child.rows.length, reads: child.reads }),
							);
							return;
						}
						if (req.url?.startsWith("/reset")) {
							child.reset();
							res.statusCode = 200;
							res.end(JSON.stringify({ rows: child.rows.length }));
							return;
						}
						res.statusCode = 200;
						res.end(
							JSON.stringify({ rows: child.rows.length, reads: child.reads }),
						);
					})();
				});
			},
		},
	],
	server: {
		port: Number(process.env.CHILD_READER_SCROLL_PORT ?? 5197),
		strictPort: true,
	},
});
