import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Code, MessageCircleMore } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the ChatTabs component
 */
type ChatTabsProps = {
	activeTab: "chat" | "raw";
	onChange: (newTab: "chat" | "raw") => void;
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
 */
export const ChatTabs: FC<ChatTabsProps> = ({ activeTab, onChange }) => {
	return (
		<Tabs
			value={activeTab}
			onValueChange={(value) => onChange(value as "chat" | "raw")}
			className={cn("px-4 py-2")}
		>
			<TabsList>
				<TabsTrigger value="chat">
					<MessageCircleMore aria-hidden={true} />
					Chat
				</TabsTrigger>
				<TabsTrigger value="raw">
					<Code aria-hidden={true} />
					Raw
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
};
