"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

/**
 * A password field with a show/hide button, so people can check what they
 * typed (especially on phones). The button never submits the form and is
 * labelled for screen readers; the field goes back to hidden on submit
 * because the parent re-renders it fresh after navigation.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={props.id}
        className="focus-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-500 hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
