import { deriveMcpServers } from "@features/chat/components/run-details/run-detail-model";
import type { deriveRunDetails } from "@features/chat/components/run-details/run-detail-model";
import { PanelRail } from "@shared/components/navigation/panel-rail";
import { InPanelRailHost } from "@shared/components/navigation/panel-rail-host";
import type { FC } from "react";

/**
 * The panel rail (#872) as the shell stories mount it: through the shell's own host,
 * exactly as `chat-content` portals it, so every `ChatDock*` arm photographs the rail
 * where the app draws it - a 44px column at the window's edge beside the measured
 * column.
 *
 * WHY THIS IS ITS OWN MODULE. The stories in `shell.stories.tsx` are also the scene
 * for the BEFORE half of this change's evidence (`docs/evidence/shell-app-shell/
 * panel-rail-before/`), which renders them under `origin/main`'s header, layout,
 * store and chat-content. The rail, the host context and the drawn-pane selector do
 * not exist on that tree, so the one thing the scene must not import directly is the
 * rail: it comes through this file, which the before recipe overwrites with a
 * component that renders nothing. One import edge to cut is what keeps the recipe a
 * file swap and not an edit to the story.
 *
 * The inputs are the conversation stand-in's: a draft has no run details and no
 * session, so the rail shows Browser and Canvas there, as the app does. The asks
 * item (#896) is OPT-IN through `railProps` - whether a host offers a door is the
 * app's fact (`published`/`answered`) and a stand-in must not invent one; a story
 * that means to photograph the fifth item sets `askOffered`.
 */
export const ShellStoryRail: FC<{
	details: ReturnType<typeof deriveRunDetails> | null;
	railProps: {
		browserAttentionCount?: number;
		consoleUnseenCount?: number;
		fileCount?: number;
		/** Offer the asks item (#896), as a host that publishes a queue does. */
		askOffered?: boolean;
		/** The outstanding asks the badge counts; the name keeps the exact number. */
		askCount?: number;
	};
}> = ({ details, railProps }) => (
	<InPanelRailHost>
		<PanelRail
			sessionId={details ? "a1b2c3d4e5f6" : null}
			runDetails={details}
			mcpServers={deriveMcpServers([], {}, [])}
			listOnScreen={false}
			readerChildId={null}
			browserAttentionCount={railProps.browserAttentionCount ?? 0}
			askOffered={railProps.askOffered ?? false}
			askCount={railProps.askCount ?? 0}
			/* The scope rides the route, as `chat-content`'s does: a conversation's own
			   queue in a conversation, the fleet's on a draft. */
			askScope={details ? "session" : "fleet"}
			consoleUnseenCount={railProps.consoleUnseenCount ?? 0}
			consoleUnseenPulsing={false}
			fileCount={railProps.fileCount ?? 0}
			codeOffered={false}
			codeOpened={0}
			codeMentioned={0}
			codeAttention={null}
		/>
	</InPanelRailHost>
);
