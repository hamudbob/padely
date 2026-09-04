import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { startPushListeners } from "./push";

/**
 * Mounted once, from App, inside the Router — the same shape as useDeepLinks
 * and for the same reason: a tapped notification has to be able to navigate.
 *
 * It attaches listeners only. It does NOT ask for notification permission.
 * That distinction is the whole design: iOS allows one permission prompt per
 * install, and spending it on someone who has had the app open for ninety
 * seconds is how an app ends up permanently unable to reach most of its
 * users. `ensurePushRegistered` is called from the moments where the trade is
 * obvious — an RSVP, joining a club — and never from here.
 *
 * Attaching early still matters, though. A notification tapped from a cold
 * start is delivered as soon as the app finishes launching; if nothing is
 * listening yet, the tap is simply lost and the person lands on whatever
 * screen they last had open, wondering what the notification was about.
 */
export function usePushNotifications(): void {
  const navigate = useNavigate();

  useEffect(() => startPushListeners((path) => navigate(path)), [navigate]);
}
