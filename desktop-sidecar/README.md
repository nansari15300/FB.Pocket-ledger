# desktop-sidecar (Pocket Ledger, Tauri migration)

Go (stdlib only) loopback server jo `out/` (Next static export) serve karta hai.
Tauri app ise `src-tauri/binaries/pl-sidecar-x86_64-pc-windows-msvc.exe` ke roop me bundle/spawn karta hai.

Build (Windows):

```
cd desktop-sidecar
go build -trimpath -ldflags "-s -w" -o ..\src-tauri\binaries\pl-sidecar-x86_64-pc-windows-msvc.exe .
```

Manual run: `pl-sidecar.exe --root ..\out --preferred-port 3000`
Stdout pehli line: `PL_SIDECAR_READY {"port":3000,...}`.

`electron/localAppServer.js` reference ke liye untouched hai; full port P2/P3 me.
