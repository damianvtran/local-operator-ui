import "../../src/renderer/src/styles/index.css";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatSessionStatus } from "@features/chat/components/chat-session-status";
import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} from "@features/chat/canonical/transcript-reducer";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ScrollToBottomButton } from "@features/chat/components/scroll-to-bottom-button";

// Component/dev proof only: real transcript, receipt hook, status glyph and
// hidden floating control, using the supported authenticated development proxy.
// No /seen call exists in this fixture. Visibility/hasFocus/hit tests remain real.
function Fixture() {
	const [state, setState] = useState<any>(null);
	const [mode, setMode] = useState("covered");
	const [theme, setTheme] = useState("localOperatorLight");
	const [geometry, setGeometry] = useState({});
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	useEffect(() => {
		const update = () =>
			fetch("/fixture/state")
				.then((r) => r.json())
				.then(setState);
		void update();
		const timer = setInterval(update, 250);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (state)
			useCanonicalSessionsStore.setState({ activeSessionId: state.session_id });
	}, [state?.session_id]);
	useEffect(() => {
		const timer = setInterval(() => {
			const e = root.current?.querySelector<HTMLElement>(
				"[data-completion-anchor]",
			);
			const r = e?.getBoundingClientRect();
			setGeometry({
				documentVisible: document.visibilityState,
				focused: document.hasFocus(),
				anchor: e?.dataset.completionAnchor,
				rect: r?.toJSON(),
				samples:
					r &&
					[0.25, 0.5, 0.75].map((f) => {
						const hit = document.elementFromPoint(
							r.left + r.width * f,
							r.bottom - 2,
						);
						return { tag: hit?.tagName, inside: !!hit && !!e?.contains(hit) };
					}),
				viewport: [innerWidth, innerHeight],
				scroll: root.current && [
					root.current.clientHeight,
					root.current.scrollHeight,
				],
			});
		}, 300);
		return () => clearInterval(timer);
	}, []);
	if (!state) return <p>Loading fixture</p>;
	const attention = state.attention;
	const row = {
		session_id: state.session_id,
		status: {
			code: "complete",
			label: attention.unseen ? "Unseen completion" : "Complete",
		},
		attention,
	};
	const transcript = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries:
			mode === "empty"
				? []
				: [
						{
							id: attention.anchor_id,
							ts: 1789300800000,
							type: "message",
							payload: {
								kind: "message",
								role: "assistant",
								content: [
									{
										text: "The completed result is ready to read.\n\nThis is the production transcript and completion anchor, connected to an isolated durable attention store.",
									},
								],
								stop_reason: "stop",
							},
						},
					],
		has_more: false,
		cursor: null,
	});
	return (
		<main className="bg-canvas text-ink min-h-screen p-6">
			<h1 className="text-heading">
				Completion receipt — browser component fixture
			</h1>
			<p>
				Not native Electron foreground proof. Synthetic session; private backend
				and database.
			</p>
			<div className="flex gap-4 py-4">
				<span>Theme {["localOperatorLight", "localOperatorDark", "dracula"].map(t => <button className="border border-control px-2" key={t} onClick={() => setTheme(t)}>{t}</button>)}</span>
				<span>
					Visibility{" "}
					{["covered", "visible", "offscreen", "loading", "empty", "error"].map(
						(t) => (
							<button
								key={t}
								className="border border-control px-2"
								onClick={() => setMode(t)}
							>
								{t}
							</button>
						),
					)}
				</span>
				<button
					onClick={() => {
						setMode("covered");
						void fetch("/fixture/publish", { method: "POST" });
					}}
				>
					Publish new completion
				</button>
			</div>
			<div className="flex gap-6">
				<aside className="w-64 shrink-0 border border-control p-4">
					<div data-fixture-row className="flex gap-2 items-center">
						<ChatSessionStatus row={row as any} />
						<span
							className={attention.unseen ? "font-semibold" : "font-normal"}
						>
							Completed task
						</span>
					</div>
					<p>{row.status.label}</p>
					<h2 className="mt-6">Neighbour status states</h2>
					{[
						"complete",
						"error",
						"busy",
						"answer",
						"approval",
						"interrupted",
						"idle",
						"dormant",
						"unknown",
					].map((code) => (
						<div className="flex gap-2 py-1" key={code}>
							<ChatSessionStatus
								row={
									{
										...row,
										attention: { ...attention, unseen: false },
										status: { code, label: code },
									} as any
								}
							/>
							{code}
						</div>
					))}
				</aside>
				<div
					style={{ position: "relative", flex: 1, minWidth: 0, height: 360 }}
				>
					<div
						ref={root}
						className="border border-control p-4"
						style={{
							height: "100%",
							overflow: "auto",
							paddingTop: mode === "offscreen" ? "110vh" : undefined,
						}}
					>
						<CanonicalTranscript
							frontend={{ ...state, streaming: false } as any}
							transcript={transcript}
							gate={null}
							waiting={false}
							loadingOlder={false}
							onLoadOlder={async () => false}
							containerRef={root}
							isSmallView={false}
							status={
								mode === "loading"
									? "connecting"
									: mode === "error"
										? "error"
										: "live"
							}
							failure={
								mode === "error"
									? ({
											message: "Fixture connection unavailable",
											kind: "unreachable",
										} as any)
									: null
							}
							hydrated={mode !== "loading"}
							onReconnect={() => setMode("visible")}
						/>
					</div>
					<ScrollToBottomButton visible={false} onClick={() => {}} />
					{mode === "covered" && (
						<div
							data-fixture-scrim
							className="bg-surface border border-control p-6"
							style={{ position: "absolute", inset: 0, zIndex: 50 }}
						>
							Result covered — no receipt may be written
						</div>
					)}
				</div>
			</div>
			<h2 className="mt-4">Measured state (real DOM and durable store)</h2>
			<pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
				{JSON.stringify(
					{ session: state.session_id, attention, geometry },
					null,
					2,
				)}
			</pre>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<MemoryRouter>
		<QueryClientProvider client={new QueryClient()}>
			<Fixture />
		</QueryClientProvider>
	</MemoryRouter>,
);
