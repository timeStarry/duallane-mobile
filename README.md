# DualLane Mobile

DualLane Mobile is a Workspace-only client design and implementation home for
the DualLane mobile application. It intentionally does not implement the P2P
private lane. A cold launch has one product decision:

- no usable Workspace session: show login;
- an active Workspace session: show the conversation list.

The Android client is implemented with React Native and Expo. To validate a checkout:

```text
corepack pnpm install --frozen-lockfile
corepack pnpm check
node --test plugins/*.test.cjs
corepack pnpm export:android
```

`corepack pnpm build:android` regenerates the Android project; a JDK and Android
SDK are required for Gradle packaging. Pull requests run a separate Android
package smoke workflow with a disposable test signing key. These test artifacts
are not signed with the internal release identity. See the
[testing and release guide](docs/development/TESTING_AND_RELEASE.md).

The login screen accepts an HTTPS service origin or a complete Workspace
invitation link (`https://your-service/workspace?invite=...`). Invitation context
is passed only to that service during the explicit GitHub login flow.

The design is recorded in
[`docs/WORKSPACE_MOBILE_CLIENT_DESIGN.md`](docs/WORKSPACE_MOBILE_CLIENT_DESIGN.md).
The source of truth for server behavior remains the sibling
[`duallane`](../duallane) repository, especially its Workspace API, message
protocol, realtime, security, and release documents.

This directory is deliberately kept separate from the web application so the
mobile release lifecycle, secure token storage, native OAuth callback, local
notifications, and OTA bundle policy can evolve without reintroducing P2P
dependencies.
