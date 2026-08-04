import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Code, MessageCircleMore } from "lucide-react";
import type { FC } from "react";

export type ChatTabValue = "chat" | "raw";

/**
 * Props for the ChatTabs component
 */
type ChatTabsProps = {
	activeTab: ChatTabValue;
	onChange: (newTab: ChatTabValue) => void;
};

/**
 * The two halves of each tab relationship, shared with whoever renders the
 * views.
 *
 * The strip and the views it switches between live in different components
 * (`chat-content.tsx` renders the views as siblings of this strip, and in
 * production renders the chat view with no strip at all), so the ids cannot
 * come from a `Tabs` root the way `TabsContent` would supply them. They are
 * constants instead, and `chat-content.tsx` is the only thing that may consume
 * them: a panel id that nothing renders is the exact defect this replaces.
 */
export const CHAT_TAB_IDS: Record<ChatTabValue, string> = {
	chat: "chat-view-tab",
	raw: "chat-raw-tab",
};

export const CHAT_TAB_PANEL_IDS: Record<ChatTabValue, string> = {
	chat: "chat-view-panel",
	raw: "chat-raw-panel",
};

/**
 * ChatTabs Component
 *
 * Displays tabs for switching between chat and raw views.
 *
 * This is a real tablist — two mutually exclusive views of the same
 * conversation — so it keeps the Tabs primitive rather than becoming a row of
 * buttons: `role="tab"`, `aria-selected` and arrow-key navigation come with
 * it. Selection is the segmented control's `surface` step; the full-width
 * underlined bar and its indicator are gone.
 *
 * Both halves of the ARIA relationship are supplied by hand. Radix's
 * `TabsTrigger` emits `aria-controls` pointing at the `TabsContent` it expects
 * to find in the same root, and there is none here, so left alone every tab
 * announced a region that was never in the document. The ids below are
 * overrides (Radix spreads caller props after its own), and only the selected
 * tab carries `aria-controls`, because `chat-content.tsx` mounts one view at a
 * time — a reference to the unmounted one would be the same dangling
 * relationship in a new place.
 */
export const ChatTabs: FC<ChatTabsProps> = ({ activeTab, onChange }) => {
	return (
		<Tabs
			value={activeTab}
			onValueChange={(value) => onChange(value as ChatTabValue)}
			className={cn("px-4 py-2")}
		>
			<TabsList>
				<TabsTrigger
					value="chat"
					id={CHAT_TAB_IDS.chat}
					aria-controls={
						activeTab === "chat" ? CHAT_TAB_PANEL_IDS.chat : undefined
					}
				>
					<MessageCircleMore aria-hidden={true} />
					Chat
				</TabsTrigger>
				<TabsTrigger
					value="raw"
					id={CHAT_TAB_IDS.raw}
					aria-controls={
						activeTab === "raw" ? CHAT_TAB_PANEL_IDS.raw : undefined
					}
				>
					<Code aria-hidden={true} />
					Raw
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
};
