import type { InputHTMLAttributes, ReactNode, RefAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
}

export function FieldShell({ label, error, hint, children, htmlFor }: FieldProps & { children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="t-small" style={{ color: "var(--color-muted)" }}>{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

/** Ref-as-prop (React 19): pass `ref` straight through to the underlying input. */
export function Input({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & RefAttributes<HTMLInputElement>) {
  return <input ref={ref} className={cn("input")} {...props} />;
}

interface IconInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon, e.g. Mail/Lock — decorative, hidden from assistive tech. */
  icon?: ReactNode;
  /** Trailing adornment, e.g. the password visibility toggle button. */
  trailing?: ReactNode;
}

/** Input with an optional leading icon and trailing adornment (eye toggle). */
export function IconInput({ icon, trailing, className, ...props }: IconInputProps) {
  if (!icon && !trailing) {
    return <input className={cn("input", className)} {...props} />;
  }
  return (
    <div className="input-wrap">
      {icon && (
        <span className="input-icon input-icon--start" aria-hidden="true">
          {icon}
        </span>
      )}
      <input
        className={cn("input", icon && "input--has-start", trailing && "input--has-end", className)}
        {...props}
      />
      {trailing && <span className="input-icon input-icon--end">{trailing}</span>}
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea")} {...props} />;
}
