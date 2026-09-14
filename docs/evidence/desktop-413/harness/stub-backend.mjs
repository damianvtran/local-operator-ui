/**
 * A disposable stand-in for `local-operator serve`, used only to capture what
 * actually crosses the transport boundary.
 *
 * It exists because the fact under test is a BYTE COUNT at a specific line, and
 * the only honest way to read it is to let the real `requestDesktop` serialize
 * a real payload and weigh what arrives. It mirrors the two limits that matter
 * from `local_operator/server/routes/desktop_sessions.py`: `Prompt.nonempty`
 * refuses a body past 900,000 bytes, and that refusal maps to 409.
 */
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const LOG = process.env.DESKTOP_413_LOG ?? "/tmp/desktop-413-wire.log";
const PORT = Number(process.env.DESKTOP_413_PORT ?? 8788);

createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const body = Buffer.concat(chunks);
	const path = (req.url ?? "").split("?")[0];
	if (body.length) {
		let images = 0;
		let textChars = 0;
		try {
			const parsed = JSON.parse(body.toString("utf-8"));
			images = parsed.images?.length ?? 0;
			textChars = (parsed.text ?? parsed.args ?? "").length;
		} catch {
			// A body we cannot parse is still a byte count worth recording.
		}
		appendFileSync(
			LOG,
			`${new Date().toISOString()} ${req.method} ${path} bytes=${body.length} images=${images} text_chars=${textChars}\n`,
		);
	}
	res.setHeader("Content-Type", "application/json");
	// The backend's own frame validator. 900_000 and the 409 mapping are the
	// real numbers from desktop_sessions.py:101 and :173-181.
	if (body.length > 900_000) {
		res.writeHead(409);
		res.end(
			JSON.stringify({
				detail: "Message exceeds the canonical control-frame limit",
			}),
		);
		return;
	}
	if (path === "/v1/capabilities") {
		res.end(
			JSON.stringify({
				result: {
					desktop_available: true,
					version: 2,
					// Every negotiated feature at its version, so the canonical chat
					// surface is reachable rather than gated behind the
					// "update the backend" wall. The names are `DesktopFeature` in
					// `desktop-hooks.ts`.
					features: {
						auth: 1,
						settings: 1,
						commands: 1,
						catalogues: 1,
						profile_catalogue: 1,
						team_catalogue: 1,
						session_catalogue: 2,
						lifecycle: 1,
						mcp: 1,
						radient: 1,
					},
				},
			}),
		);
		return;
	}
	if (path.endsWith("/messages") || path.endsWith("/commands")) {
		res.end(JSON.stringify({ result: { status: "admitted", replayed: false } }));
		return;
	}
	if (path === "/v1/desktop/sessions" && req.method === "POST") {
		res.end(
			JSON.stringify({ result: { session_id: "abc123def456", binding: null } }),
		);
		return;
	}
	// The shell reads `values.hosting` on mount and throws without it, so the
	// config route answers the shape the real backend does. Everything else is
	// an empty success: the surface under test is the composer, and an empty
	// sidebar keeps unrelated state out of the captured frames.
	if (path === "/v1/config") {
		res.end(
			JSON.stringify({
				result: {
					values: {
						hosting: "openrouter",
						model_name: "anthropic/claude-sonnet-4",
						conversation_length: 100,
						detail_length: 35,
						auto_save_conversation: false,
					},
				},
			}),
		);
		return;
	}
	if (path === "/v1/desktop/sessions" || path.endsWith("/history")) {
		res.end(
			JSON.stringify({ result: { sessions: [], records: [], total: 0 } }),
		);
		return;
	}
	res.end(JSON.stringify({ result: {} }));
}).listen(PORT, "127.0.0.1", () => {
	process.stdout.write(`stub backend on http://127.0.0.1:${PORT}\n`);
});
