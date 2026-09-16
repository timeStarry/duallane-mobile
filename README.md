# DualLane Mobile

DualLane Mobile is a Workspace-only client design and implementation home for
the DualLane mobile application. It intentionally does not implement the P2P
private lane. A cold launch has one product decision:

- no usable Workspace session: show login;
- an active Workspace session: show the conversation list.

The design is recorded in
[`docs/WORKSPACE_MOBILE_CLIENT_DESIGN.md`](docs/WORKSPACE_MOBILE_CLIENT_DESIGN.md).
The source of truth for server behavior remains the sibling
[`duallane`](../duallane) repository, especially its Workspace API, message
protocol, realtime, security, and release documents.

This directory is deliberately kept separate from the web application so the
mobile release lifecycle, secure token storage, native OAuth callback, push
notifications, and OTA bundle policy can evolve without reintroducing P2P
dependencies.
