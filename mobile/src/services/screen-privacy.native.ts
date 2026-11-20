import { useCallback, useState } from 'react';
import { usePreventScreenCapture, useScreenshotListener } from 'expo-screen-capture';

/**
 * Keep a screen out of screenshots, recordings and the app switcher, and notice when that
 * fails.
 *
 * A recovery phrase in the camera roll is in a cloud backup minutes later, which quietly
 * undoes the point of keys living on the phone.
 *
 * Verified against expo-screen-capture's own documentation rather than assumed: it prevents
 * screen recordings on iOS 11+ and screenshots on iOS 13+, and sets FLAG_SECURE on Android.
 * On an older iOS it does nothing at all — silently — which is why the listener is wired up
 * too. If capture cannot be prevented, the user should at least be told it happened, because
 * then deleting the photo is a thing they can still do.
 */
export const screenPrivacyAvailable = true;

export function useScreenPrivacy(key: string): { screenshotted: boolean } {
  usePreventScreenCapture(key);
  const [screenshotted, setScreenshotted] = useState(false);
  useScreenshotListener(useCallback(() => setScreenshotted(true), []));
  return { screenshotted };
}
