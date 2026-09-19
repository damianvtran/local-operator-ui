// src/renderer/src/shared/lib/utils.ts
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
var twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // The type ramp. Without this every one of these reads as a colour.
      "font-size": [
        {
          text: [
            "display",
            "title",
            "heading",
            "body",
            "body-sm",
            "meta",
            "mono",
            "mono-sm"
          ]
        }
      ],
      // `xs`/`sm`/`md`/`lg` are already t-shirt sizes tailwind-merge knows;
      // `frame` is ours.
      rounded: [{ rounded: ["frame"] }],
      duration: [{ duration: ["instant", "fast", "base", "slow"] }],
      // `pulse-visible` is ours (see `index.css`): the placeholder's pulse,
      // floored where the bar's step stays above the contract's perceptual
      // aim. Unregistered it would not conflict with `Skeleton`'s own
      // `animate-pulse`, and both would land - the survivor decided by
      // stylesheet order rather than by the caller.
      animate: [{ animate: ["pulse-visible"] }],
      ease: [{ ease: ["out-quart", "out-expo", "in-out"] }],
      shadow: [{ shadow: ["overlay"] }]
    }
  }
});
var cn = (...inputs) => twMerge(clsx(inputs));

// src/renderer/src/shared/components/ui/button.tsx
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { forwardRef } from "react";
import { jsx } from "react/jsx-runtime";
var buttonVariants = cva(
  [
    "inline-flex shrink-0 select-none items-center justify-center",
    "whitespace-nowrap font-medium",
    // Colour-only transition. Hover is a colour step: nothing lifts, scales
    // or translates.
    "transition-colors duration-fast ease-out-quart",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0"
  ],
  {
    variants: {
      size: {
        sm: "h-7 gap-1 rounded-sm px-2 text-meta [&_svg]:size-3.5 focus-visible:outline-offset-1!",
        md: "h-8 gap-1.5 rounded-sm px-3 text-body-sm [&_svg]:size-4",
        lg: "h-9 gap-2 rounded-sm px-4 text-body [&_svg]:size-4",
        icon: "size-8 rounded-sm [&_svg]:size-4",
        "icon-sm": "size-7 rounded-sm [&_svg]:size-3.5 focus-visible:outline-offset-1!",
        "icon-lg": "size-9 rounded-sm [&_svg]:size-5"
      },
      variant: {
        primary: [
          "bg-accent text-on-accent",
          "hover:bg-accent-hover active:bg-accent-active",
          "disabled:bg-sunken disabled:text-ink-disabled"
        ],
        secondary: [
          "border border-control bg-surface text-ink",
          "hover:bg-elevated active:bg-sunken",
          "disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled"
        ],
        outline: [
          "border border-control text-ink",
          "hover:bg-accent-wash",
          "active:border-accent active:bg-[color-mix(in_oklab,var(--color-accent-wash)_80%,var(--color-accent))]",
          "disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled"
        ],
        ghost: [
          "text-ink-muted",
          "hover:bg-accent-wash hover:text-ink",
          "active:bg-accent-wash active:text-accent",
          "disabled:bg-transparent disabled:text-ink-disabled"
        ],
        danger: [
          "border border-danger-border text-danger",
          "hover:bg-danger-wash",
          "active:border-danger active:text-ink active:bg-[color-mix(in_oklab,var(--color-danger-wash)_80%,var(--color-danger))]",
          "disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled"
        ],
        link: [
          "h-auto rounded-xs p-0 text-accent underline-offset-4",
          "hover:text-accent-hover hover:underline",
          "active:underline active:decoration-2",
          "disabled:text-ink-disabled disabled:no-underline"
        ]
      }
    },
    defaultVariants: { variant: "secondary", size: "md" }
  }
);
var Button = forwardRef(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    if (asChild) {
      return /* @__PURE__ */ jsx(
        Slot.Root,
        {
          ref,
          className: cn(buttonVariants({ variant, size }), className),
          ...props
        }
      );
    }
    return /* @__PURE__ */ jsx(
      "button",
      {
        ref,
        type: type ?? "button",
        className: cn(buttonVariants({ variant, size }), className),
        ...props
      }
    );
  }
);
Button.displayName = "Button";

// src/renderer/src/features/chat/components/measured-suggestion-stack.tsx
import { useLayoutEffect, useRef, useState } from "react";

// src/renderer/src/features/chat/components/suggestion-stack.ts
var suggestionStackCapFor = (chips, stackTop, allowance) => {
  if (chips.length === 0) return null;
  const rows = /* @__PURE__ */ new Map();
  for (const chip of chips) {
    const top = Math.round((chip.top - stackTop) * 10) / 10;
    const bottom = Math.round((chip.bottom - stackTop) * 10) / 10;
    rows.set(top, Math.max(bottom, rows.get(top) ?? bottom));
  }
  const bottoms = [...rows.values()].sort((a, b) => a - b);
  if (bottoms[bottoms.length - 1] <= allowance) return null;
  let cap = 0;
  for (const bottom of bottoms) {
    if (bottom <= allowance) cap = bottom;
  }
  return cap > 0 ? cap : bottoms[0];
};

// src/renderer/src/features/chat/components/measured-suggestion-stack.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
var MeasuredSuggestionStack = ({
  band,
  splash,
  suggestions,
  disabled,
  onRefusedPress,
  onSelect,
  focusComposer
}) => {
  const stackRef = useRef(null);
  const [layout, setLayout] = useState({ cap: null, hidden: [] });
  const focusComposerRef = useRef(focusComposer);
  focusComposerRef.current = focusComposer;
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!band || !splash || !stack || suggestions.length === 0) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const style = window.getComputedStyle(band);
      const room = window.innerHeight - band.getBoundingClientRect().top - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
      const fixed = splash.getBoundingClientRect().height - stack.getBoundingClientRect().height;
      const top = stack.getBoundingClientRect().top;
      const buttons = Array.from(stack.children);
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      const cap = suggestionStackCapFor(boxes, top, room - fixed);
      const hidden = boxes.map(
        (box) => cap !== null && Math.round((box.bottom - top) * 10) / 10 > cap
      );
      if (buttons.some(
        (button, index) => hidden[index] && button === document.activeElement
      )) {
        focusComposerRef.current();
      }
      setLayout(
        (previous) => previous.cap === cap && previous.hidden.length === hidden.length && previous.hidden.every((value, index) => value === hidden[index]) ? previous : { cap, hidden }
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(splash);
    void document.fonts?.ready.then(measure).catch(() => void 0);
    return () => {
      disposed = true;
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [band, splash, suggestions]);
  return /* @__PURE__ */ jsx2(
    "div",
    {
      ref: stackRef,
      "data-lo-suggestion-stack": true,
      className: cn(
        /*
         * Left-aligned on the measure, not centred. With the chips' boundaries
         * gone, a centred ragged block is the only thing left making the set look
         * deliberate, and that reads as a first-run menu rather than as a list of
         * examples. It also introduces no new axis: the group already has one left
         * edge, drawn by the composer box above it, and the tip row between them
         * takes the same one.
         */
        "flex flex-wrap justify-start gap-2",
        // No scrollbar (which re-wraps labels). The margin preserves the last
        // visible chip's outline in the gap before the first omitted row.
        layout.cap !== null && "overflow-clip [overflow-clip-margin:4px]"
      ),
      style: layout.cap === null ? void 0 : { maxHeight: layout.cap },
      children: suggestions.map((suggestion, index) => {
        const hidden = layout.hidden[index] ?? false;
        return (
          /*
           * The chip is the app's existing borderless-control pattern, not a new one:
           * `ghost` is defined as having neither fill nor edge at rest, which is the
           * same thing the attach button beside the composer already takes. The
           * `outline` variant's `border border-control` was the loudness - on an
           * empty chat it drew seven edges at the 3:1 floor that exists for the sole
           * boundary of a CONTROL, on the one screen with nothing to compete with
           * them. `hairline` is the tempting wrong answer: it is the decorative role
           * and measures 1.25:1 at its worst, which is a boundary nobody can see.
           *
           * The hover pair steps the ground to `elevated` and the ink to `ink`,
           * overriding `ghost`'s own `accent-wash` hover: the accent is spent on the
           * primary action and the focus ring, and a hovered suggestion is neither.
           * This is the pair the attach button uses, and the pair the contrast
           * contract's `ask option button (hover)` row already asserts.
           *
           * `px-2` rather than `px-3`: 12px existed to keep a label off its own
           * border, and there is no longer a border to keep it off. Separation
           * between chips is `gap-2` plus both paddings, i.e. 24px edge to edge.
           *
           * THE DISABLED STATE is the app's existing contract, not a new one: a
           * colour step to the disabled ink role (which `ghost` already carries)
           * and never opacity, with the hover ground neutralised so an inert chip
           * cannot light up under the pointer - the same pair `chat-sidebar.tsx`
           * uses on its own disabled row. The box is untouched, deliberately: the
           * caller disables these while the composer holds a draft, and the band
           * must not move while the user types (`message-input.tsx`'s
           * `suggestionsDisabled` has the why).
           */
          /* @__PURE__ */ jsx2(
            Button,
            {
              variant: "ghost",
              size: "sm",
              className: "h-auto max-w-full whitespace-normal break-words rounded-sm px-2 py-1 text-body-sm text-ink-muted hover:bg-elevated hover:text-ink disabled:text-ink-disabled disabled:hover:bg-transparent",
              style: hidden ? { visibility: "hidden" } : void 0,
              "aria-hidden": hidden || void 0,
              "aria-disabled": disabled || void 0,
              disabled: disabled || hidden,
              onPointerDown: onRefusedPress,
              onClick: () => {
                if (!hidden && !disabled) onSelect(suggestion);
              },
              children: suggestion
            },
            suggestion
          )
        );
      })
    }
  );
};
export {
  MeasuredSuggestionStack
};
