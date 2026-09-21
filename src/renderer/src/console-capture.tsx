/*
 * Aliased because this entry shares its name with the component it mounts: the
 * document is `console-capture.html`, the component is `ConsoleCapture`, and a
 * same-named local import is a duplicate identifier rather than a convention.
 */
import { ConsoleCapture as ConsoleCaptureView } from "@features/console/components/console-capture";
import { DEFAULT_THEME, applyThemeToDocument } from "@shared/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/fonts/fonts.css";
import "@renderer/styles/index.css";

/*
 * The capture view's own document (design 13.2/13.3).
 *
 * A THIRD ENTRY RATHER THAN A ROUTE, for the reason the installer window is one:
 * this renderer exists to be photographed, so it must mount NOTHING that reaches
 * the app's stores, streams or preference effects. A route inside the app's shell
 * would boot the session store, the feed subscription and the sidebar on every
 * capture - a second app instance in everything but name, whose own effects would
 * be the reason a capture was slow or, worse, non-deterministic.
 *
 * IT SHARES THE COMPONENT, NOT THE DOCUMENT: `ConsoleCaptureView` mounts the same
 * `ConsoleMirror` the pane does, with the same font, the same resolved theme and
 * the same pinned renderer, so the two cannot drift (§13.3). The theme is applied
 * from the feed rather than from a preference (there is no preference here), and
 * the default palette is published first so a document that paints before the feed
 * arrives still resolves its role variables rather than none.
 */
applyThemeToDocument(DEFAULT_THEME);

document.addEventListener("DOMContentLoaded", () => {
	const root = ReactDOM.createRoot(
		document.getElementById("capture") as HTMLElement,
	);
	root.render(
		<React.StrictMode>
			<ConsoleCaptureView />
		</React.StrictMode>,
	);
});
