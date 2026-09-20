/**
 * A stand-in for `@xterm/addon-unicode11`, for the desktop suite's bundles.
 *
 * The mirror installs this addon for one documented reason (design §14's torture
 * stream contains an emoji): xterm's built-in tables are Unicode 6, under which an
 * emoji is one cell wide where a modern terminal says two. The addon has no API the
 * pane reads beyond `activate`, so modelling that is the whole of it — the width
 * behaviour itself is xterm's, and is looked at in the rendered frames rather than
 * asserted here.
 */
export class Unicode11Addon {
	activate(): void {}
	dispose(): void {}
}
