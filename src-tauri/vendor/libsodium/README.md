# libsodium for Windows x64

`x64/libsodium.lib` is the static library from the official libsodium 1.0.22-stable MSVC package, extracted from `libsodium/x64/Release/v143/static/libsodium.lib`. The upstream Minisign signature was verified before extraction.

SHA-256 `e3e8a3bad71af1184cb4442313f9dbfeff2043ca86f84509c314fbde5c066d18`

The project uses this library for Stronghold on the `x86_64-pc-windows-msvc` target. The Cargo configuration points to the included library so builds work in project paths containing spaces.

[Upstream MSVC package](https://download.libsodium.org/libsodium/releases/libsodium-1.0.22-stable-msvc.zip)
