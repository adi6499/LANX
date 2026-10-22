# LANX for Linux — build image.
#
# Ubuntu 22.04 on purpose: a program built here runs on Ubuntu 22.04 and newer,
# Debian 12 and newer, Mint 21+, and (as an AppImage) on most other distributions.
# Building on a newer Ubuntu would make a program that older PCs cannot start.
#
#   docker build -t lanx-linux-builder linux
#   node linux/build.mjs            (from the LANAPPLICATION folder)
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/usr/local/bin:/usr/bin:/bin \
    APPIMAGE_EXTRACT_AND_RUN=1 \
    NO_STRIP=true

# Tauri 2 on Linux needs WebKitGTK 4.1, GTK 3, the tray library and a few tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget file git rsync xz-utils build-essential pkg-config \
      libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
      librsvg2-dev patchelf libxdo-dev libasound2-dev desktop-file-utils \
      squashfs-tools fuse libfuse2 \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (Vite 8 needs 20.19+).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version

# Rust (stable).
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustc --version && cargo --version

WORKDIR /src
