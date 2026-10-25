<div align="center">
<h1>MaLiu</h1>
<p><b>M</b>obile <b>A</b>gent. <b>L</b>eave <b>I</b>t to <b>U</b>s.</p>
<p align="center">
  <a href="https://developer.android.com/">
    <img src="https://img.shields.io/badge/Android-supported-3DDC84?style=for-the-badge&amp;logo=android&amp;logoColor=white" alt="Android">
  </a>
  <a href="https://github.com/maliu-sys/maliu/commits/main">
    <img src="https://img.shields.io/github/commit-activity/m/maliu-sys/maliu?label=Commits&amp;style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Commits/Mon">
  </a>
  <img src="https://img.shields.io/badge/status-WIP-orange?style=for-the-badge" alt="WIP">
</p>
</div>

## Install

Requires Node **26.10.0**, JDK **17**, and an Android SDK with a `maliu` AVD.

```shell
npx --yes pnpm@12.15.0 install --frozen-lockfile
```

Copy `.env.example` to `.env.local` and fill in your development API key.

## Run

Run from the project directory. Homebrew tools are located automatically on macOS.

```shell
# Terminal 1: start the emulator
npm run emulator

# Terminal 2: build, install, and start Metro (first run / native changes)
npm run android

# Later TS/JS development: start Metro instead; press a to open Android
npm start
```
