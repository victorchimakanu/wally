/**
 * Screen-capture protection, where there is none: the web.
 *
 * `expo-screen-capture` is native-only and does not degrade gracefully. On web
 * `preventScreenCaptureAsync` logs an error, `allowScreenCaptureAsync` throws on unmount, and
 * `useScreenshotListener` throws `addListener is not a function` during render — which
 * white-screens the page. The recovery-phrase screen did exactly that until this split
 * existed, and the browser is how layouts get checked, so it has to keep working.
 *
 * Nothing here pretends to protect anything. The browser preview runs on demo funds and shows
 * no real phrase, so there is nothing to protect.
 */

export const screenPrivacyAvailable = false;

/** A no-op with the same shape as the native hook. Never reports a screenshot. */
export function useScreenPrivacy(_key: string): { screenshotted: boolean } {
  return { screenshotted: false };
}
