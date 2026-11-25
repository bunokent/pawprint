import {
  cloneElement,
  isValidElement,
  type InputHTMLAttributes,
  type ReactNode,
  type RefAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  /** Field furniture that belongs below the error message (map, suggestions, …). */
  after?: ReactNode;
}

/** Wire the control to its error message without repeating this in every form. */
function withErrorState(child: ReactNode, errorId?: string): ReactNode {
  if (!errorId || !isValidElement<Record<string, unknown>>(child)) return child;
  const describedBy = [child.props["aria-describedby"], errorId].filter(Boolean).join(" ");
  return cloneElement(child, {
    "aria-invalid": true,
    "aria-describedby": describedBy,
  });
}

export function FieldShell({ label, error, hint, after, children, htmlFor }: FieldProps & { children: ReactNode; htmlFor?: string }) {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <label htmlFor={htmlFor}>{label}</label>
      {withErrorState(children, errorId)}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
      {after}
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
