/**
 * What this build is, in a form someone can paste into a message.
 *
 * A support conversation cannot start without it. "The app is broken" and "Wally 1.0.0 on
 * Android 14, pointed at the staging backend" are different reports, and only the second one
 * can be acted on. Until now the app never showed its own version anywhere.
 *
 * Everything is a parameter rather than an import, so the shape is testable without a device
 * and the module has no native dependency at load time.
 *
 * **Deliberately excluded: anything identifying a person.** No wallet address, no device id,
 * no install id. The device *model* is included because a rendering or performance report is
 * nearly useless without it, and it identifies a product rather than a person. Nothing here
 * is collected — it is assembled only when a user chooses to copy it.
 */

export type BuildSources = {
  /** From app.json, via expo-constants. The user-facing version: "1.0.0". */
  appVersion?: string | undefined;
  /**
   * The developer-facing build number — `android.versionCode` / `ios.buildNumber`.
   *
   * This is what tells two builds apart, and both of them say "1.0.0". A tester on the third
   * TestFlight build of 1.0.0 reporting a bug fixed in the second is a support conversation
   * that goes nowhere without it.
   *
   * **Not wired up yet, deliberately.** The documented source is `expo-application`'s
   * `Application.nativeBuildVersion` (expo-constants marks its own equivalent deprecated in
   * favour of it), and that package is not installed. Adding it is a native module, so it
   * costs a development-build rebuild for whoever is working on the app — not a decision to
   * make silently inside a Settings card. The parameter exists so wiring it is one line.
   */
  buildNumber?: string | undefined;
  /** 'ios' | 'android' | 'web', as Platform.OS reports it. */
  os: string;
  /** The OS version, where the platform exposes one. */
  osVersion?: string | undefined;
  /** e.g. "Pixel 6a". A product, not a person. */
  deviceModel?: string | undefined;
  /** True for a development build; the answer changes what support should ask next. */
  isDevelopment?: boolean | undefined;
  /** Which backend the app is pointed at, or '' for none. Already in the bundle. */
  backendOrigin?: string | undefined;
};

export type BuildInfo = {
  /** "1.0.0", or "1.0.0 (42)" once a build number is available. */
  version: string;
  platform: string;
  device: string;
  channel: 'development' | 'release';
  backend: string;
};

const clean = (value: string | undefined, fallback: string) => {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : fallback;
};

export function buildInfo(sources: BuildSources): BuildInfo {
  const osVersion = (sources.osVersion ?? '').trim();
  const version = clean(sources.appVersion, 'unknown');
  const build = (sources.buildNumber ?? '').trim();
  return {
    // The build number is shown in parentheses, the convention on both stores, and omitted
    // rather than faked when it is absent.
    version: build ? `${version} (${build})` : version,
    platform: osVersion ? `${clean(sources.os, 'unknown')} ${osVersion}` : clean(sources.os, 'unknown'),
    device: clean(sources.deviceModel, 'unknown device'),
    channel: sources.isDevelopment ? 'development' : 'release',
    // A missing backend is a fact worth reporting, not a blank.
    backend: clean(sources.backendOrigin, 'none configured'),
  };
}

/**
 * One line, for pasting into a message to support.
 *
 * Kept to a single line on purpose: anything that wraps across several gets truncated when
 * someone copies it, and a half-copied version string is worse than none.
 */
export function supportSummary(info: BuildInfo): string {
  return `Wally ${info.version} (${info.channel}) · ${info.platform} · ${info.device} · backend: ${info.backend}`;
}

/** The short form for a Settings row, where the backend and device are noise. */
export function versionLabel(info: BuildInfo): string {
  return info.channel === 'development' ? `${info.version} (development build)` : info.version;
}
