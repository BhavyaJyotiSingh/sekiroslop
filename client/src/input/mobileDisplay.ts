import { isTouchDevice } from "./touchInput";

type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null };
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type OrientationWithLock = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

export function isPortraitTouchDevice(): boolean {
  return (
    isTouchDevice() &&
    typeof window !== "undefined" &&
    window.matchMedia("(orientation: portrait)").matches
  );
}

export function isMobileFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement as FullscreenElement;
  return Boolean(root.requestFullscreen ?? root.webkitRequestFullscreen);
}

export function isMobileFullscreenActive(): boolean {
  if (typeof document === "undefined") return true;
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Best-effort mobile fullscreen + horizontal landscape lock; browsers require a user gesture. */
export function requestMobileFullscreenLandscape(): void {
  if (!isTouchDevice()) return;

  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenElement & {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  };
  const lockLandscape = () => {
    const orientation = screen.orientation as OrientationWithLock | undefined;
    try {
      void orientation?.lock?.("landscape").catch(() => undefined);
    } catch {
      // Orientation lock is unavailable or disallowed in this browser.
    }
  };

  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    lockLandscape();
    return;
  }

  const requestFullscreen = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (!requestFullscreen) {
    lockLandscape();
    return;
  }

  try {
    const result =
      requestFullscreen === root.requestFullscreen
        ? requestFullscreen.call(root, { navigationUI: "hide" })
        : requestFullscreen.call(root);
    if (result && typeof result.then === "function") {
      void result.then(lockLandscape, lockLandscape);
    } else {
      lockLandscape();
    }
  } catch {
    lockLandscape();
  }
}
