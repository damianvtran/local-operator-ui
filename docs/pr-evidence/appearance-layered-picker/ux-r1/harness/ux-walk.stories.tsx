/* UX review rig only (pr1682-ux-r1) - NOT committed. Mounts the shipped
   AppearanceLayers + ThemeSelector inside the app's real ThemeProvider so a
   committed layer repaints the document exactly as main.tsx does. */
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { ThemeProvider } from "@shared/themes/theme-provider";
import type { Meta, StoryObj } from "@storybook/react";
import { Contrast } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { AppearanceLayers } from "../appearance-layers";
import { SettingsSection } from "../settings-section";
import { ThemeSelector } from "../theme-selector";

/* Long tasks (>50 ms) and a scripted pointer drag through the slider's own
   handlers: pointerdown on the input, native value set + input events per
   frame, pointerup on window - the browser tool has no drag primitive. */
if (typeof PerformanceObserver !== "undefined" && !(window as any).__uxLT) {
	(window as any).__uxLT = [];
	new PerformanceObserver((l) => {
		for (const e of l.getEntries()) {
			(window as any).__uxLT.push(Math.round(e.duration));
			console.log(`UXLT ${Math.round(e.duration)}ms at ${Math.round(e.startTime)}`);
		}
	}).observe({ type: "longtask", buffered: false });
}
const drag = async (from: number, to: number, steps: number) => {
	const el = document.querySelector<HTMLInputElement>("[data-contrast-slider]");
	if (!el) return;
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
	(window as any).__uxLT.length = 0;
	const frames: number[] = [];
	let last = performance.now();
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
	const seen: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const v = Math.round(from + ((to - from) * i) / steps);
		setter.call(el, String(v));
		el.dispatchEvent(new Event("input", { bubbles: true }));
		await new Promise((r) => requestAnimationFrame(r));
		const now = performance.now();
		frames.push(Math.round(now - last));
		last = now;
		seen.push(`${v}->${el.value}`);
	}
	const t0 = performance.now();
	window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
	await new Promise((r) => setTimeout(r, 1500));
	const out = document.getElementById("ux-out")!;
	out.textContent = `frames max=${Math.max(...frames)} p50=${frames.sort((a, b) => a - b)[frames.length >> 1]} longtasks=[${(window as any).__uxLT.join(",")}] final=${el.value} seen=${seen.filter((_, i) => i % 4 === 0).join(" ")} canvas=${getComputedStyle(document.documentElement).getPropertyValue("--color-canvas")} t=${Math.round(performance.now() - t0)}`;
};

const Walk = () => {
	useLayoutEffect(() => {
		const log = (e: KeyboardEvent) => { if (e.key === "F10") console.log(`UXKEY ${e.key} shift=${e.shiftKey} target=${(e.target as HTMLElement).getAttribute("aria-label")}`); };
		document.addEventListener("keydown", log);
		return () => document.removeEventListener("keydown", log);
	}, []);
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({
			contrast: { dark: 0, light: 0 },
			accent: { dark: { kind: "theme" }, light: { kind: "theme" } },
			customAccents: [],
			customAccentNames: {},
		});
		setReady(true);
	}, []);
	if (!ready) return null;
	return (
		<ThemeProvider>
			<div className="h-screen overflow-auto bg-canvas text-ink">
				<div className="flex gap-2 p-2 text-meta">
					<button type="button" id="ux-drag-down" onClick={() => drag(100, -100, 60)}>drag 100→-100</button>
					<button type="button" id="ux-drag-near" onClick={() => drag(30, 44, 14)}>drag 30→44</button>
					<button type="button" id="ux-drag-std" onClick={() => drag(-100, 0, 30)}>drag -100→0</button>
					<output id="ux-out" />
					<button type="button" id="ux-context" onClick={() => {
						const el = document.querySelector<HTMLElement>('[data-accent-swatch^="custom:"]');
						el?.focus();
						el?.scrollIntoView({ block: "center" });
						const r = el?.getBoundingClientRect();
						el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r!.x + 10, clientY: r!.y + 10, button: 2 }));
					}}>diagnostic context event</button>
				</div>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
					<SettingsSection title="Appearance" icon={Contrast} description="Customize the look and feel of Local Operator" dataTourTag="settings-appearance-section">
						<AppearanceLayers gallery={<ThemeSelector />} />
					</SettingsSection>
				</div>
			</div>
		</ThemeProvider>
	);
};
const meta = { title: "UX/Walk", component: Walk } satisfies Meta<typeof Walk>;
export default meta;
export const RealProvider: StoryObj<typeof meta> = {};
