/**
 * The masked secret field with a show/hide toggle, shared by the generic
 * API-key panel and Amazon Bedrock's AWS panel (API key, secret access key,
 * session token). One component so every secret the provider panels take is
 * masked, unautocompleted and unspellchecked the same way.
 */
import { Button, Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Eye, EyeOff } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

export const SecretInput: FC<{
	id: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
	invalid?: boolean;
	describedBy?: string;
	/** A stored key's mask: dots saying "one is saved", never the field's value. */
	placeholder?: string;
}> = ({ id, value, onChange, label, invalid, describedBy, placeholder }) => {
	useI18nLocale();
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<Input
				id={id}
				type={visible ? "text" : "password"}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				autoComplete="off"
				spellCheck={false}
				aria-label={label}
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy}
				className="pr-10 font-mono"
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1/2 right-1 -translate-y-1/2"
				onClick={() => setVisible((current) => !current)}
				aria-label={
					visible
						? t("ui.providers.provider_detail.hide_key")
						: t("ui.providers.provider_detail.show_key")
				}
			>
				{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
			</Button>
		</div>
	);
};
