# Wally APK readiness — 10 October 2026

Verified against the local working tree; this is not a build or store approval.

## Debug demo / development APK

- Exists: Expo 57.0.25, React Native 0.86.3, Expo Router; generated Android Gradle project; wrapper 9.3.1; ARM64 native configuration, minimum API 31; EAS preview and phone-development APK profiles.
- Local Node is v24.12.0. Android SDK platform android-36 exists. Java was not found in PATH and the SDK root had no build-tools directory. Configure compatible JDK, build-tools and native dependencies before compiling. Do not regenerate native files by hand; use the existing app config/plugins and prebuild flow.
- No APK was found under android/app/build/outputs. JavaScript export is not an APK. Debug builds generally require Metro; a bundled preview APK is a separate gate.
- Decide lightweight computer-connected preview versus WALLY_NATIVE_QVAC=1 phone-local inference. These have different native requirements. Expo Go does not prove the QVAC native build works.
- Current native target is ARM64, Android 12+. The recorded Android 10 phone is unsupported. Verify a supported physical phone; emulator computer inference does not establish phone-local performance.
- Verify cold launch, fonts/icons, offline/provider failures, model setup/download cancellation, memory/background lifecycle, keyboard, mobile/tablet/desktop layouts, notification repeated taps and back navigation. Browser/native visual QA was unavailable in this executor.

## Standalone working wallet

- Exists: public market service, local WDK testnet wallet client/server, native ETH on Arbitrum Sepolia and Ethereum Sepolia, reviewed quotes and explicit confirmation, durable uncertain-broadcast journal and actual RPC receipt handling.
- The client restricts API endpoints to loopback HTTP. The server holds wallet keys on the computer and uses a local session cookie. A standalone phone cannot depend on USB port forwarding or a computer seed file.
- Complete the planned phone-local signing and protected key storage, wallet creation/recovery/backup UI, app lock and authentication decisions. Do not silently turn this single-user development service into a production hosted wallet.
- Define supported networks/assets. USDt ERC-20 transfers, Bitcoin, Solana, swaps, bridging and gasless relays are not implemented. Market quotes do not value testnet ETH.
- Retain exact transaction review, amount/address/chain/fee validation, expiry and single-use approval, uncertain submission recovery and no automatic resend.
- Address explorer rate limits/incomplete history and production provider strategy. A funded public testnet send remains unverified; it needs funds and separate explicit authorization. Use inert mocks for routine QA.
- Reconcile stale docs: QVAC-PHONE-TESTING.md says WDK is not integrated; LIVE-API-INTEGRATION.md and current code document the newer computer-hosted testnet connection.

## Signed release APK / store

- Current app ID is com.wally.frontendpreview; name is Wally Preview. Decide final package identity, branding/versioning and distribution owner.
- android/app/build.gradle uses the debug signing certificate for release. This is not store-ready. Choose signing ownership and credential custody before configuring release signing; no credentials were created.
- EAS has APK preview profiles but no production/AAB profile. Configure the approved release path and immutable version codes. Play distribution needs an appropriately signed app bundle and Play App Signing setup.
- Review manifest permissions: INTERNET, VIBRATE, SYSTEM_ALERT_WINDOW and legacy external storage up to API 32; allowBackup is true. Validate which belong in production and ensure wallet/model data backup behavior matches the design.
- Verify release native libraries, ABI support, optimized build behavior, device compatibility, crash recovery, privacy policy/data safety, third-party asset/model licenses, and applicable financial-app declarations and Play policies before submission.
- Check current target API/store requirements at submission time; installed SDK platform is not proof that a compiled artifact satisfies them.

## Validation in this change

Typecheck and lint passed. 41 mobile tests (including seven notification/component-handler cases) and 4 mocked wallet integration tests passed. Notification cases use mocked hooks/routing and verify the 767/768px boundary, repeated taps, shared Back/fallback and independent wallet expansion; they do not establish native router integration. No live asset transfer, signing-credential generation, APK compilation, upload, deployment or publishing performed. These tests are not a visual pass.

Sources:
- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/build-reference/apk/
- https://docs.expo.dev/router/basics/navigation/
- https://developer.android.com/studio/publish/app-signing
- https://developer.android.com/google/play/requirements/target-sdk

Evidence: mobile/package.json, app.config.cjs, app.json, eas.json, android/gradle.properties, android/app/build.gradle, android/app/src/main/AndroidManifest.xml, scripts/phone-tools.mjs, src/services/wallet-api.ts, docs/LIVE-API-INTEGRATION.md, docs/QVAC-PHONE-TESTING.md.
