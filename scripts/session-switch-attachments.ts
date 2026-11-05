/**
 * Attachment capture arms for the existing REAL ChatPage fixture.
 *
 * Start ONE server from the PR worktree (shared dependencies, no install):
 *   node_modules/.bin/vite --config scripts/session-switch.vite.mjs --host 127.0.0.1
 * Base URL: http://127.0.0.1:5211/session-switch.html
 * Common query: ?sessions=3&steps=1&outgoingSteps=1&theme=dark
 * Add &attachment=prose for a short turn; add &userLines=24 for a long turn;
 * &attachment=only has no prose. Unknown/absent modes are the original fixture.
 *
 * &attachment=echo&userLines=24 starts empty. Stay on the boot session
 * abcdef000001, wait for __lopSwitch.ready, then use the two labelled fixture
 * buttons IN ORDER: paint the actual pending-send echo, then admit the same id
 * through the owner's history_delta. No timer skips the stage being captured.
 * Reopening the session reads that admitted row from sessions.history.
 * Expand/collapse and keyboard focus use the SHIPPED disclosure, not rig controls.
 *
 * Capture serially through the harness browser, reusing one tab and server.
 * Use an isolated HOME/config, strip CMUX_* and disable telemetry; record the
 * Vite leader pid/pgid in the capture launcher. Close the owned tab first, then
 * stop that exact process group (TERM, bounded KILL fallback), verify the group
 * is gone and port 5211 is closed. Never kill by name or adopt another server.
 * A failed startup/blank page stops the pass, not a second parallel launch.
 *
 * Minimum app viewport is 800x600 (src/main/window-mode.ts). Record actual
 * viewport, screenshot dimensions and row/bubble/disclosure geometry at each
 * step, including consecutive first-contentful/settled renderer frames. This
 * browser-only fixture cannot prove NATIVE inactive-window first paint (D1.2).
 * The synthetic PDF is metadata only: no backend, bytes, upload or file-open
 * integration is exercised. Nothing here provides pixel/native evidence.
 */
import type { FixtureDocument, TranscriptStep } from "./session-switch-bridge";

/** No local path or uploaded bytes: this exercises the shipped document card,
 * not file-open/download integration. A single synthetic card bounds the rig. */
export const CAPTURE_DOCUMENT: FixtureDocument = {
	type: "document",
	attachment: "0123456789abcdef0123456789abcdef",
	filename: "synthetic-capture-brief.pdf",
	mime_type: "application/pdf",
	bytes: 256,
	injection: "native",
};

export function attachmentMode(search: string) {
	const value = new URLSearchParams(search).get("attachment");
	return value === "prose" || value === "only" || value === "echo"
		? value
		: null;
}

export function withCaptureAttachment(
	step: Extract<TranscriptStep, { kind: "user" }>,
	mode: ReturnType<typeof attachmentMode>,
): Extract<TranscriptStep, { kind: "user" }> {
	if (mode === null) return step;
	return {
		...step,
		text: mode === "only" ? "" : step.text,
		documents: [CAPTURE_DOCUMENT],
	};
}
