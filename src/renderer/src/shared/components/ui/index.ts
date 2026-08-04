/**
 * The primitive layer.
 *
 * Every colour in this directory is a role utility (`bg-surface`,
 * `text-ink-muted`, `border-control`); there are no hex values, no `--lo-*`
 * reads and no MUI imports, which is what makes a theme swap a variable swap.
 * Focus comes from `styles/index.css` and is not re-declared per component.
 *
 * Re-exported by name rather than with `export *`: a star re-export defeats
 * tree-shaking (Biome's `noReExportAll`), and in a 335-file app importing from
 * one barrel that is the difference between pulling in a button and pulling in
 * every Radix package at once.
 */

export { Alert, AlertDescription, AlertTitle, alertVariants } from "./alert";
export type { AlertProps } from "./alert";
export { Avatar, AvatarFallback, AvatarImage } from "./avatar";
export { Badge, badgeVariants } from "./badge";
export type { BadgeProps } from "./badge";
export { Button, buttonVariants } from "./button";
export type { ButtonProps } from "./button";
export {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	cardVariants,
} from "./card";
export type { CardProps } from "./card";
export { Checkbox } from "./checkbox";
export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
} from "./dialog";
export type { DialogContentProps } from "./dialog";
export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./dropdown-menu";
export { Input, inputVariants } from "./input";
export type { InputProps } from "./input";
export { Label } from "./label";
export {
	Popover,
	PopoverAnchor,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from "./popover";
export { Progress } from "./progress";
export type { ProgressProps } from "./progress";
export { ScrollArea, ScrollBar } from "./scroll-area";
export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "./select";
export { Separator } from "./separator";
export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetOverlay,
	SheetPortal,
	SheetTitle,
	SheetTrigger,
	sheetVariants,
} from "./sheet";
export type { SheetContentProps } from "./sheet";
export { Skeleton } from "./skeleton";
export { Switch } from "./switch";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
export { Textarea } from "./textarea";
export type { TextareaProps } from "./textarea";
export {
	Tooltip,
	TooltipContent,
	TooltipPortal,
	TooltipProvider,
	TooltipRoot,
	TooltipTrigger,
} from "./tooltip";
export type {
	TooltipContentProps,
	TooltipProps,
	TooltipProviderProps,
} from "./tooltip";
