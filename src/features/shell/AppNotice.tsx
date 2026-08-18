import { useState } from "react";
import { useAppSettings } from "../../lib/supabase/appSettings";

/**
 * The announcement banner, driven by the app_settings row (0043).
 *
 * Mounted once above the router, so it reaches every screen including the
 * signed-out ones. Three rules keep it from becoming the thing people hate:
 *
 *  - it is dismissible, and staying dismissed is per message, not forever —
 *    a new announcement reappears
 *  - it never covers anything: it pushes content down rather than floating
 *  - an empty or expired message renders nothing at all, so the default
 *    state of this component is invisible
 */
export default function AppNotice() {
  const { bannerMessage, bannerTone, maintenanceMessage } = useAppSettings();
  const message = maintenanceMessage ?? bannerMessage;
  const tone = maintenanceMessage ? "warn" : bannerTone;
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!message || dismissed === message) return null;

  return (
    <div
      role="status"
      className={`w-full px-4 py-2.5 text-center ${
        tone === "warn" ? "bg-gold-soft text-gold-ink" : "bg-surface-2 text-ink-2"
      }`}
    >
      <span className="text-[12.5px] font-semibold">{message}</span>
      <button
        onClick={() => setDismissed(message)}
        aria-label="Dismiss"
        className="ml-2.5 text-[12.5px] font-semibold opacity-60 active:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
