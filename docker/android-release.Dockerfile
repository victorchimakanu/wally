# Builds the Android release APK on Linux, where Windows' 260-character path limit does not
# apply. On a Windows checkout the native compile fails: CMake mirrors the absolute path of
# node_modules under android/app/.cxx and ninja cannot stat the ~390-character object paths.
#
# NOT YET VERIFIED END TO END (28 November 2026). The stages through `prebuilt` build; Gradle's
# configuration then failed with "Process 'command 'node'' finished with non-zero exit value 1"
# and the rerun meant to capture the cause filled the disk. See docs/RUNNING-LOCALLY.md.
#
# Build context is the repository root. The APK is the only output:
#   docker build --target apk --output type=local,dest=mobile/dist/apk-docker -f docker/android-release.Dockerfile .
#
# What is baked in: EXPO_NO_DOTENV (no .env.local), EXPO_PUBLIC_WALLY_PROXY_URL (the backend,
# reached from a phone or emulator through `adb reverse tcp:8080 tcp:8080`), no
# EXPO_PUBLIC_WALLY_API_URL (so the app is on the on-device keystore path, not the dev wallet
# server), no native QVAC (chat is scripted in this build). Signed with the debug keystore that
# prebuild generates: installable, not store-ready. arm64 only, which is every phone.
FROM node:22-bookworm AS deps
ENV DEBIAN_FRONTEND=noninteractive ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip \
 && rm -rf /var/lib/apt/lists/*

# Android command-line tools, pinned. sdkmanager installs what the build needs; the licences are
# accepted inside the image rather than on a developer's machine.
ARG CMDLINE_TOOLS=commandlinetools-linux-13114758_latest.zip
RUN mkdir -p $ANDROID_HOME/cmdline-tools && cd $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o tools.zip https://dl.google.com/android/repository/$CMDLINE_TOOLS \
 && unzip -q tools.zip && rm tools.zip && mv cmdline-tools latest
ENV PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
RUN yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.0.12077973" "cmake;3.22.1"

WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./

ENV EXPO_NO_DOTENV=1 NODE_OPTIONS=--dns-result-order=ipv4first EXPO_PUBLIC_QVAC_MODEL=wally-llm
ARG EXPO_PUBLIC_WALLY_PROXY_URL=http://127.0.0.1:8080
ENV EXPO_PUBLIC_WALLY_PROXY_URL=$EXPO_PUBLIC_WALLY_PROXY_URL

# The worklet bundle is generated, not checked in; the native project likewise.
FROM deps AS prebuilt
RUN npm run wdk:generate \
 && npx expo prebuild --platform android --clean --no-install

FROM prebuilt AS build
# Two workers and a smaller heap: Docker Desktop's VM has a few GB, and the Kotlin daemon, the
# C++ compilers and the Metro bundling step all run inside this one build.
RUN cd android \
 && sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m/' gradle.properties \
 && echo 'kotlin.daemon.jvmargs=-Xmx1024m' >> gradle.properties \
 && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2 --console=plain

FROM scratch AS apk
COPY --from=build /app/mobile/android/app/build/outputs/apk/release/app-release.apk /app-release.apk
