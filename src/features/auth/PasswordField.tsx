import { forwardRef, useState } from "react";

interface PasswordFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
  id?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  describedBy?: string;
}

/**
 * Password input with a show/hide toggle. The eye sits inside the field so it
 * never competes with the submit button, and it's a real <button> so it can be
 * reached by keyboard — but it's kept out of the tab order (tabIndex -1) so
 * tabbing still runs email → password → submit the way people expect.
 *
 * Forwards a ref to the input so the email-first flow can move focus straight
 * into the password the moment the screen morphs — without that, the person has
 * to tap the field they were just sent to.
 */
const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField({
  value,
  onChange,
  placeholder = "Password",
  autoComplete = "current-password",
  minLength,
  required,
  id,
  onFocus,
  onBlur,
  describedBy,
}, ref) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        id={id}
        className="w-full rounded-2xl border border-line bg-surface pl-3.5 pr-12 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
        placeholder={placeholder}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-describedby={describedBy}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-warm-gray active:bg-surface-2 transition-colors"
      >
        {shown ? (
          // eye-off
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.9 5.1A9.8 9.8 0 0 1 12 4.9c6.5 0 10 7.1 10 7.1a17 17 0 0 1-3.2 4.3M6.2 6.3A17 17 0 0 0 2 12s3.5 7.1 10 7.1a9.7 9.7 0 0 0 4.2-.9" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="m3 3 18 18" />
          </svg>
        ) : (
          // eye
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.5-7.1 10-7.1S22 12 22 12s-3.5 7.1-10 7.1S2 12 2 12z" />
            <circle cx="12" cy="12" r="2.8" />
          </svg>
        )}
      </button>
    </div>
  );
});

export default PasswordField;
