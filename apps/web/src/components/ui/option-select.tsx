"use client";

import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

type Props = Omit<ComponentProps<typeof SelectTrigger>, "value" | "onChange" | "children"> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

/** Retains declarative option lists, with Radix keyboard navigation and typeahead. */
export function OptionSelect({ value, onValueChange, children, disabled, ...props }: Props) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ComponentProps<"option">>(child)) return [];
    return [
      {
        value: String(child.props.value ?? child.props.children),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
  // Encode every option, including the empty-string "All" choice. Radix reserves
  // the empty string for placeholders, not selectable items.
  const encode = (option: string) => `option:${option}`;
  return (
    <Select
      value={encode(value)}
      onValueChange={(next) => onValueChange(next.slice(7))}
      disabled={disabled}
    >
      <SelectTrigger {...props}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={encode(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
