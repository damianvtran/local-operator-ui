import type { TranscriptStep } from "./session-switch-bridge";

/** Fixed tiny synthetic PNG; inline data takes the shipped image branch without
 * attachment-byte RPCs, local files, external origins or a replacement card. */
export const TINY_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAE0lEQVR4nGOYUHDgPz7MMDIUAABxrq/BhdNzKQAAAABJRU5ErkJggg==";

export function nestedUserFixture(
	step: Extract<TranscriptStep, { kind: "user" }>,
	example: string | null,
): Extract<TranscriptStep, { kind: "user" }> {
	if (example === "image")
		return {
			...step,
			documents: [],
			images: [{ type: "image", data: TINY_PNG, mime_type: "image/png" }],
		};
	if (example === "quote")
		return {
			...step,
			text: `<reply-to>Synthetic quoted brief.\n\nSecond quoted paragraph.</reply-to>\n${step.text}`,
		};
	if (example === "seal")
		return {
			...step,
			text: [
				"The user invoked the `capture-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.",
				'<skill name="capture-demo" invocation="$capture-demo inspect the synthetic brief">',
				"---\nname: capture-demo\ndescription: Synthetic preview instructions\n---\n\n# Capture demo\n\nRead the synthetic brief and preserve its full text.\n</skill>",
				step.text,
			].join("\n"),
		};
	return step;
}
