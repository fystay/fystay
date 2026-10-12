"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

/**
 * A password field with a show/hide button, so people can check what they
 * typed (especially on phones). Toggling only swaps the input's type, so
 * the value, autocomplete hint and password-manager fill stay as they
 * are. The button never submits the form, has a fixed label with
 * aria-pressed for its state, and is reachable by keyboard. The field goes
 * back to hidden as the form submits, so a password manager sees a
 * password field and the password isn't left on screen.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form || !visible) return;
    const hide = () => {
      // Synchronously, before the browser (or a password manager) reads it.
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    };
    form.addEventListener("submit", hide, { capture: true });
    return () => form.removeEventListener("submit", hide, { capture: true });
  }, [visible]);

  return (
    <div className="relative">
      <Input ref={setRefs} type={visible ? "text" : "password"} className={cn("pr-11", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label="Show password"
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? "Hide password" : "Show password"}
        className="focus-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-500 hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
