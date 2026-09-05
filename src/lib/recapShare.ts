import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNative } from "./native";

/**
 * Get an image out of the app and into the person's hands.
 *
 * WHY THIS FILE EXISTS. The recap card had two buttons — "Share image" and
 * "Save to photos" — and on a phone neither worked.
 *
 *   "Save to photos" used `<a download>`. That is a browser affordance. A
 *   WKWebView has no downloads UI and no Downloads folder; the click does
 *   nothing at all, with no error. The button looked like it worked.
 *
 *   "Share image" used navigator.share with a File. Safari supports that;
 *   WKWebView's support for the *files* variant is inconsistent, so it either
 *   threw or silently fell through to the dead download path above.
 *
 * WHAT REPLACES THEM. One route, native to the platform: write the PNG to the
 * app's cache directory and hand its URI to the iOS share sheet. That sheet is
 * where an iPhone user both shares AND saves — "Save Image" sits in it next to
 * WhatsApp and Messages. Two buttons for one sheet would be a lie about there
 * being two destinations, which is why the caller now shows one.
 *
 * The web path is unchanged in spirit: real Web Share where the browser has
 * it, and a download link where it doesn't, because on a desktop a download
 * genuinely is what "save" means.
 */

/** What actually happened, so the caller can say something true afterwards. */
export type ShareOutcome = "shared" | "dismissed" | "downloaded" | "failed";

/** Blob → bare base64 (no data: prefix), which is what Filesystem.writeFile wants. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function shareOrSaveImage(
  blob: Blob,
  fileName: string,
  title: string,
): Promise<ShareOutcome> {
  if (isNative()) {
    try {
      // Cache, not Documents. This file exists to be handed to another app and
      // then forgotten; iOS is free to reclaim the cache directory whenever it
      // needs the space, which is exactly the lifetime we want. Writing it to
      // Documents would accumulate a recap per session forever, in a directory
      // the person cannot see or clear.
      const written = await Filesystem.writeFile({
        path: fileName,
        data: await toBase64(blob),
        directory: Directory.Cache,
      });

      // getUri rather than the write result's uri: the share sheet needs a
      // file:// URL, and this is the documented way to obtain one.
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

      await Share.share({ title, files: [uri || written.uri] });
      return "shared";
    } catch (err) {
      // The share sheet throws on cancel as well as on failure, and the two
      // are not distinguishable by type — only by message, which is not
      // guaranteed stable. Treating a cancel as an error would put an error
      // note on screen every time somebody changed their mind, so anything
      // that looks like a dismissal is reported as one.
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel|abort|dismiss/i.test(message)) return "dismissed";
      console.warn("Native share failed:", message);
      return "failed";
    }
  }

  // ── Web ────────────────────────────────────────────────────────────────
  const file = new File([blob], fileName, { type: blob.type || "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch {
      return "dismissed";
    }
  }

  // A real download, on a platform that has them.
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "downloaded";
  } finally {
    // Not immediately: Safari has been known to cancel a download whose object
    // URL is revoked in the same tick as the click.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
