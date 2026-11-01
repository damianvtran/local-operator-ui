import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { POC1_CELLS } from "./poc1-transport-fixtures.mjs";

/** Source-rig processing/commit observations, NOT paint or sendability latency.
 * One bundle in the existing load-sequence rig; no production instrumentation.
 * Process CPU includes React/jsdom/GC and cannot attribute buildRows or flush CPU.
 */
export function registerPOC1(rig) {
	const {
		test,
		after,
		act,
		mountArm,
		answerNetwork,
		entry,
		frame,
		frontendState,
		openFrame,
		SESSION,
		S,
		readView,
		markCount,
		flushFrames,
		pendingTimers,
		rafQueue,
		__resetPaintCache,
		__resetCheckpointManifestCache,
		openFrameFacts,
		transcriptPaneHoldsPlaceholder,
		transcriptPaneCollapses,
	} = rig;
	const receipt = {
		model: "coder / openai/gpt-6.1-sol (no fallback)",
		kind: "synthetic source-rig; not native, layout, paint, sendability or user-visible latency",
		provenance:
			"QA active-cohort.md 2026-11-01: shape motivation only; no journal read",
		source: {},
		samples: [],
		controls: {},
		unobserved: [
			"applyHistoryPage/flush CPU",
			"buildRows CPU",
			"actual processed-row count",
			"native sidebar click start",
			"paint",
			"sendability",
			"real backend response caps",
		],
	};
	const git = (...args) =>
		execFileSync("git", args, { encoding: "utf8" }).trim();
	const pageFor = (entries, hasMore = false) => ({
		entries,
		has_more: hasMore,
		cursor_missing: false,
		runs_state: "ready",
		runs: entries
			.filter((e) => e.payload.role === "user")
			.map((e) => {
				const i = entries.indexOf(e);
				const end = entries[i + 1];
				return {
					run_key: end?.id ?? e.id,
					opening_user_id: e.id,
					closing_answer_id: end?.payload.role === "assistant" ? end.id : null,
					settled: true,
					action_count: end?.payload.role === "tool" ? 1 : 0,
					failed_count: 0,
					worked_seconds: 0,
					complete: true,
					cross_session_action_count: 0,
					cross_session_worked_seconds: 0,
				};
			}),
		head_cut: false,
		journal_generation: "synthetic-generation-1",
		journal_order_state: "ready",
		journal_ordinals: Object.fromEntries(
			entries.map((e) => [e.id, e.journal_seq]),
		),
		journal_missing_ids: [],
	});
	const rowsFor = (count, start = 20001) =>
		Array.from({ length: count }, (_, i) => ({
			...entry(`poc-${start + i}`, S + start + i, {
				kind: "message",
				role: i % 2 === 0 ? "user" : "assistant",
				content: [{ type: "text", text: "Synthetic short message." }],
				...(i % 2 ? { stop_reason: "stop" } : {}),
			}),
			journal_seq: start + i,
			ts_source: "entry",
		}));
	const snapshot = (page, session = SESSION) => ({
		...frame(2, "snapshot", {
			frontend: {
				...frontendState({
					session_id: session,
					epoch: `epoch-${session}`,
					streaming: false,
					live_events: [],
					history_cursor: page.entries.at(-1)?.id ?? null,
				}),
				epoch: `epoch-${session}`,
			},
			history: page,
			cold: false,
			cold_reason: null,
		}),
		session_id: session,
		epoch: `epoch-${session}`,
	});
	const view = (arm) => ({
		...readView(arm.container),
		domNodes: arm.container.querySelectorAll("*").length,
		checkpointDOMCount: arm.container.querySelectorAll("[data-checkpoint-id]")
			.length,
		checkpointManifestDOMCount:
			arm.container
				.querySelector("[data-checkpoint-count]")
				?.getAttribute("data-checkpoint-count") ?? null,
		diag: { ...globalThis.__loadDiag },
		commit: markCount(),
	});
	const reset = () => {
		__resetPaintCache();
		__resetCheckpointManifestCache();
		const commits = [];
		globalThis.__poc1 = {
			commits,
			observeCommit: (container) => {
				commits.push({
					...readView(container),
					diag: { ...globalThis.__loadDiag },
					commit: markCount(),
				});
			},
		};
	};
	let stopped = false;
	let networkLeaks = 0;
	const originalFetch = globalThis.fetch;
	after(() => {
		globalThis.fetch = originalFetch;
		globalThis.__poc1 = undefined;
	});
	test("POC1 preflight", { timeout: 60000 }, async () => {
		// Fail closed on source mismatch before mounting: a shared checkout's dirt
		// must never be silently presented as the source identified by this receipt.
		assert.equal(git("diff", "HEAD", "--", "src"), "");
		receipt.source = {
			head: git("rev-parse", "HEAD"),
			srcTree: git("rev-parse", "HEAD:src"),
			core: "not loaded; synthetic transport only",
		};
		assert.ok(
			process.cwd().includes(".worktrees/"),
			"owned source rig required",
		);

		globalThis.fetch = () => {
			networkLeaks += 1;
			throw new Error("POC1 network leak");
		};

		assert.ok(globalThis.document, "jsdom setup must survive registration");
		assert.ok(process.env.LOP_POC1_OUTPUT, "explicit receipt path required");
		await mkdir(process.env.LOP_POC1_OUTPUT, { recursive: true });
	});
	for (const cell of POC1_CELLS.filter(
		(c) => !process.env.LOP_POC1_CELL || c.name === process.env.LOP_POC1_CELL,
	)) {
		for (const phase of [
			"cold",
			"warmup",
			"measured-1",
			"measured-2",
			"measured-3",
			"measured-4",
			"measured-5",
		]) {
			test(`POC1 ${cell.name}/${phase}`, { timeout: 60000 }, async (st) => {
				assert.equal(
					stopped,
					false,
					"previous sample failed; dispatch stopped",
				);
				let completed = false;
				st.after(() => {
					if (!completed) stopped = true;
				});
				reset();
				const entries = rowsFor(100);
				// Keep the short tool row in EVERY cell, so giant-user/tool differ
				// only in which same-length content receives the 512 KiB body.
				Object.assign(entries[97].payload, {
					role: "tool",
					tool_call_id: "poc-tool",
					tool_name: "synthetic",
				});
				if (cell.giant) {
					const target = cell.giant === "user" ? 98 : 97;
					entries[target].payload.content[0].text = "x".repeat(512 * 1024);
					if (cell.giant === "tool")
						Object.assign(entries[target].payload, {
							tool_call_id: "poc-tool",
							tool_name: "synthetic",
						});
				}
				const page = pageFor(entries, true);
				const next = snapshot(page);
				const manifest = {
					session_id: SESSION,
					index: { state: "ready" },
					checkpoints: Array.from(
						{ length: cell.checkpoints ?? 0 },
						(_, i) => ({
							id: `poc-${i + 1}`,
							kind: "user",
							turn: i + 1,
							ts: S + i,
							seq: i + 1,
							text: "Synthetic checkpoint",
							outcome: "complete",
						}),
					),
				};
				const older = rowsFor(cell.resident ?? 0, 18001);
				let pageIndex = 0;
				let appliedInputEntries = 100;
				const pendingHistory = [];
				const settleHistory = async () => {
					await act(async () => {
						for (const { request, resolve } of pendingHistory.splice(0)) {
							const start = Number(request.beforeId.slice(4)) - 100;
							resolve(pageFor(rowsFor(100, start), start > 1));
						}
					});
				};
				const network = async (request) => {
					if (request.op === "sessions.checkpoints") return manifest;
					if (request.op === "sessions.history") {
						if (older.length && pageIndex < 20) {
							assert.equal(request.beforeId, `poc-${20001 - pageIndex * 100}`);
							const end = older.length - pageIndex * 100;
							pageIndex += 1;
							appliedInputEntries += 100;
							return pageFor(older.slice(end - 100, end), true);
						}
						// Legal earlier rows exist. Hold their scheduled responses until
						// after unmount so an eager pager cannot change the chosen axis.
						return new Promise((resolve) =>
							pendingHistory.push({ request, resolve }),
						);
					}
					return answerNetwork(request);
				};
				// Populate only through shipped stream/pager transitions, then revisit.
				// A direct applyHistoryPage seed would miss the actual cache handoff.
				let residentArm;
				let paired100;
				if (older.length) {
					const pendingPages = [];
					const paired = await mountArm(st, "paired-100", (request) => {
						if (request.op !== "sessions.history")
							return answerNetwork(request);
						// A scheduled follow-up page may remain in flight while the
						// tail is re-applied. Preserve has_more/cursor/order witnesses,
						// rather than invent a no-history 100-record counterfactual.
						return new Promise((resolve) =>
							pendingPages.push({ request, resolve }),
						);
					});
					await paired.send(openFrame);
					await paired.send(next);
					await flushFrames();
					const pc = process.cpuUsage();
					const pw = performance.now();
					await paired.send({ ...next, seq: 3 });
					await flushFrames();
					paired100 = {
						cpu: process.cpuUsage(pc),
						wallMs: performance.now() - pw,
						view: view(paired),
						limitation:
							"same frame, has_more=true; follow-up history pages held in flight until unmount",
					};
					assert.equal(globalThis.__loadDiag.records, 100);
					await paired.dispose();
					await act(async () => {
						for (const pending of pendingPages) {
							const start = Number(pending.request.beforeId.slice(4)) - 100;
							pending.resolve(pageFor(rowsFor(100, start), start > 1));
						}
					});
					await flushFrames();
					reset();
				}
				if (cell.cache === "warm" || older.length) {
					const prime = await mountArm(st, "poc-prime", network);
					await prime.send(openFrame);
					await prime.send(next);
					await flushFrames();

					while (older.length && pageIndex < 20) {
						await act(async () => {
							const outcome =
								await globalThis.__poc1.handle.loadOlderDetailed();
							assert.equal(outcome.kind, "applied");
						});
						await flushFrames();
					}
					assert.equal(
						globalThis.__loadDiag.records,
						older.length ? 2100 : 100,
					);
					if (older.length) residentArm = prime;
					else {
						await prime.dispose();
						await settleHistory();
						await flushFrames();
					}
				}
				const mountStartCPU = process.cpuUsage();
				const mountStartWall = performance.now();
				const arm = residentArm ?? (await mountArm(st, "poc-mount", network));
				if (!residentArm) await arm.send(openFrame);
				await flushFrames();
				const mountWallMs = performance.now() - mountStartWall;
				const mountCPU = process.cpuUsage(mountStartCPU);
				const wire = JSON.stringify({ ...next, seq: residentArm ? 3 : 2 });
				const parseStart = process.cpuUsage();
				const parsed = JSON.parse(wire);
				const parseCPU = process.cpuUsage(parseStart);
				const sequence = [view(arm)];
				const commitStart = globalThis.__poc1.commits.length;
				const startCPU = process.cpuUsage();
				const startWall = performance.now();
				await arm.send(parsed);
				await flushFrames();
				const wallMs = performance.now() - startWall;
				const cpu = process.cpuUsage(startCPU);
				sequence.push(view(arm));
				assert.equal(globalThis.__loadDiag.hydrated, true);
				assert.equal(globalThis.__loadDiag.records, cell.resident ? 2100 : 100);
				assert.equal(networkLeaks, 0);
				const subscription = globalThis.__loadNet.subscriptions.at(-1);
				assert.equal(subscription.args.openFrame, true);
				assert.equal(subscription.args.journalOrder, true);
				await arm.dispose();
				await settleHistory();
				await flushFrames();
				assert.ok(globalThis.__loadNet.subscriptions.every((s) => s.disposed));
				receipt.samples.push({
					cell: cell.name,
					phase,
					wallMs,
					cpu,
					mountWallMs,
					mountCPU,
					paired100,
					parseCPU,
					frameBytes: Buffer.byteLength(wire),
					maxRecordBytes: Math.max(
						...entries.map((e) => Buffer.byteLength(JSON.stringify(e))),
					),
					manifestBytes: Buffer.byteLength(JSON.stringify(manifest)),
					checkpointInputCount: manifest.checkpoints.length,
					inputEntries: appliedInputEntries,
					measuredFrameInputEntries: entries.length,
					historyPages: pageIndex,
					residentRecords: sequence.at(-1).diag.records,
					sequence,
					commitSequence: globalThis.__poc1.commits.slice(commitStart),
					outstandingWindowTimers: pendingTimers.length,
					pendingWindowTimers: pendingTimers.map(
						({ delay, origin, callback }) => ({
							delay,
							origin,
							callback: String(callback).slice(0, 300),
						}),
					),
					queuedRAFs: rafQueue.length,
					activeSubscriptions: globalThis.__loadNet.subscriptions.filter(
						(s) => !s.disposed,
					).length,
					limits: cell.giant
						? "Oversize single-record exception; backend byte cap not exercised"
						: cell.resident
							? "Resident re-snapshot only; reopen with 2k BLOCKED by 200-row paint-cache cap"
							: null,
				});
				console.log(
					"POC1 work",
					cell.name,
					phase,
					JSON.stringify({
						resident: sequence.at(-1).diag.records,
						nodes: sequence.at(-1).domNodes,
						timers: pendingTimers.length,
						raf: rafQueue.length,
						wallMs,
					}),
				);
				await writeFile(
					`${process.env.LOP_POC1_OUTPUT}/poc1.partial.json`,
					`${JSON.stringify({ ...receipt, complete: false }, null, 2)}\n`,
				);
				assert.equal(
					pendingTimers.length,
					0,
					"window timer leak; stop dispatch",
				);
				completed = true;
			});
		}
	}
	test("POC1 negative controls and receipt", { timeout: 60000 }, async (t) => {
		assert.equal(stopped, false, "prior cell failed; no complete receipt");
		// Negative controls operate on the same compiled bundle, not a re-spelled reducer.
		const controlSamples = [];
		for (const delay of [0, 200]) {
			await t.test(`delay-${delay}`, async (st) => {
				reset();
				const arm = await mountArm(st);
				await arm.send(openFrame);
				const cpuStart = process.cpuUsage();
				const wallStart = performance.now();
				const idleStart = process.cpuUsage();
				const idleWallStart = performance.now();
				if (delay)
					await act(async () => {
						await new Promise((resolve) => setTimeout(resolve, delay));
					});
				const idleCPU = process.cpuUsage(idleStart);
				const idleWallMs = performance.now() - idleWallStart;
				await arm.send(snapshot(pageFor(rowsFor(100))));
				await flushFrames();
				controlSamples.push({
					delay,
					wallMs: performance.now() - wallStart,
					cpu: process.cpuUsage(cpuStart),
					idleCPU,
					idleWallMs,
				});
				assert.equal(globalThis.__loadDiag.records, 100);
				await arm.dispose();
			});
		}
		assert.ok(
			controlSamples[1].idleWallMs - controlSamples[0].idleWallMs >= 190,
		);
		assert.ok(
			controlSamples[1].idleCPU.user + controlSamples[1].idleCPU.system < 50000,
			"200ms idle must not become 200ms CPU; 50ms tolerance, not substage attribution",
		);
		receipt.controls.delayedSnapshot = controlSamples;
		await t.test("late A cannot replace B", async (st) => {
			reset();
			const arm = await mountArm(st);
			await arm.send(openFrame);
			const old = globalThis.__loadNet.subscriptions.at(-1);
			await arm.switchTo("b1b2c3d4e5f6");
			await arm.send({
				...openFrame,
				session_id: "b1b2c3d4e5f6",
				epoch: "epoch-b1b2c3d4e5f6",
			});
			const b = rowsFor(100, 40001);
			await arm.send(snapshot(pageFor(b), "b1b2c3d4e5f6"));
			await flushFrames();
			const before = view(arm);
			assert.ok(arm.container.querySelector('[data-record-id="poc-40001"]'));
			await act(async () =>
				old.onEvent({
					kind: "data",
					data: JSON.stringify(snapshot(pageFor(rowsFor(100)))),
				}),
			);
			await flushFrames();
			assert.deepEqual(view(arm), before);
			assert.equal(old.disposed, true);
			receipt.controls.lateA = { pass: true, before, after: view(arm) };
			await arm.dispose();
		});
		const matrix = [];
		for (const status of ["connecting", "live", "reconnecting", "unavailable"])
			for (const owed of [true, false])
				for (const admitted of [false, true]) {
					const input = {
						status,
						failure: null,
						awaitingHydration: owed,
						recordCount: 2,
						admittedSend: admitted,
						stale: true,
					};
					const expected = owed && !admitted && status !== "reconnecting";
					assert.equal(transcriptPaneHoldsPlaceholder(input), expected);
					assert.equal(transcriptPaneCollapses(input), false);
					matrix.push({ status, owed, admitted, hold: expected });
				}
		receipt.controls.cachedHold16 = matrix;
		const basePage = pageFor(rowsFor(100));
		assert.ok(openFrameFacts(basePage));
		assert.equal(openFrameFacts({ ...basePage, runs: undefined }), null);
		assert.equal(openFrameFacts({ ...basePage, runs_state: "building" }), null);
		receipt.controls.readiness = {
			ready: "facts",
			missingRuns: "no facts (not blocked hydration)",
			building: "no facts (not blocked hydration)",
		};
		// The protocol has no unrelated journal-metadata-count field. Metadata is
		// kept OUTSIDE the frame, as in the actual boundary: it cannot add work
		// downstream. This is a structural proxy, not a backend ingestion benchmark.
		const metadata = [1000, 10000].map((count) => ({
			count,
			frame: JSON.stringify(snapshot(basePage)),
			inputRecords: basePage.entries.length,
			journalOrdinals: Object.keys(basePage.journal_ordinals).length,
		}));
		assert.equal(metadata[0].frame, metadata[1].frame);
		assert.equal(metadata[0].inputRecords, metadata[1].inputRecords);
		receipt.controls.unrelatedMetadata = metadata.map(
			({ frame: wire, ...rest }) => ({
				...rest,
				frameBytes: Buffer.byteLength(wire),
				classification:
					"structural boundary only; no upstream metadata ingestion modeled",
			}),
		);
		receipt.controls.networkLeaks = networkLeaks;
		const output = process.env.LOP_POC1_OUTPUT;
		assert.ok(output, "explicit durable receipt path required");
		await mkdir(output, { recursive: true });
		await writeFile(
			`${output}/poc1.json`,
			`${JSON.stringify(receipt, null, 2)}\n`,
		);
	});
}
