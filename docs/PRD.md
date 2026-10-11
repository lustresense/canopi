# canoPi Desktop
## Product Requirements Document v3.0, Fork, Native Runtime, Installer, Lifecycle, dan Delivery

**Tanggal acuan:** 11 Oktober 2026  
**Status:** Spesifikasi untuk eksekusi berikutnya. **Belum merupakan klaim bahwa implementasi v3 atau installer telah selesai.**  
**Identitas produk resmi:** `canoPi` (kapital P; satu huruf n)  
**Nama executable desktop Windows:** `canoPi.exe`  
**Nama CLI opsional:** `cnp` (`cnp.exe` pada Windows)  
**Nama engine internal:** `cnp-engine` / `cnp-engine.exe`  
**Desktop stack:** Tauri v2, Rust, React + TypeScript, Vite, native OS WebView, native PTY  
**Basis kode yang harus dilanjutkan:** `canoPi-desktop-source-v0.1.zip`  
**UI visual yang dikunci:** `canopi-workspace.jsx` karya yang diunggah pengguna  
**Upstream dasar:** `https://github.com/can1357/oh-my-pi`, commit awal `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` (v18.6.1)  
**Prioritas awal:** Windows 10/11 x64, satu pengguna lokal. macOS dan Linux melalui rilis native terpisah setelah Windows memenuhi acceptance gate.

> **Kontrak eksekusi:** Jangan membuat template GUI baru, jangan mengganti layout yang telah disetujui, jangan menganggap static tests sebagai end-to-end, jangan mendistribusikan binary upstream yang hanya diganti nama dan mengklaim sebagai fork hasil build. Selesaikan aplikasi yang bisa dipasang, dipakai, ditutup, dibuka kembali, dan di-uninstall dengan aman. Setiap fitur yang belum bekerja harus dinyatakan belum bekerja, bukan disimulasikan di jalur produksi.

---

# 1. Keputusan produk yang sudah dikunci

## 1.1 Nama dan positioning

**Keputusan:** `canoPi`, bukan `cannopi`. Penamaan mengikuti logo Pi Canopy/payung yang disetujui; identitas runtime publik menggunakan nama `cnp`. Kata OMP boleh muncul pada kredit open-source dan dokumentasi kompatibilitas, bukan sebagai instalasi kedua di pengalaman pengguna.

- Windows display name, nama Start Menu, daftar Installed Apps, installer, uninstaller, window title, shortcuts, app icon dan executable aplikasi: **canoPi**.
- Nama runtime internal: **cnp-engine**; CLI terminal opsional: **cnp**.
- Nama upstream OMP tetap dipertahankan di `LICENSE`, `NOTICE`, attribution, SBOM, histori Git, dan informasi About berdasarkan kewajiban lisensi.
- Paket installer tidak meminta pengguna menginstal OMP, Bun, Rust, Node.js, atau Git secara terpisah hanya untuk **menjalankan** aplikasi.
- `cnp` tidak otomatis ditambahkan ke PATH agar tidak membuat perubahan global yang tidak dibutuhkan. Aktivasi CLI merupakan pengaturan eksplisit lanjutan.

## 1.2 Urutan rilis

| Tahap | Hasil yang diwajibkan | Batasan |
|---|---|---|
| v0.2, rescue/foundation | Proyek v0.1 dibuild secara nyata, bug path dan state diperbaiki, RPC handshake dengan engine asli berhasil | Belum boleh disebut rilis siap pakai |
| v0.3, working vertical slice | React asli berjalan di Tauri, native folder picker, session nyata, streaming, model/provider, TODO→Kanban, reopen session | Browser dan shell yang belum nyata harus diberi status eksplisit |
| v0.4, native workflow | Subagent chat/steering, per-agent browser yang benar-benar dikendalikan agent, terminal PTY, extensions/approval, persistence, recovery | Tidak boleh mengganti native dengan simulasi |
| v1.0, Windows usable release | Fork engine `cnp` dibuild dari source; satu installer NSIS, deteksi Windows, uninstall dengan pilihan simpan/hapus data, verifikasi fitur inti dan regresi UI | Rilis hanya setelah semua acceptance P0 lolos |
| v1.1, refinement | Stabilitas, bugfix, telemetry lokal opt-in bila dibutuhkan, aksesibilitas, peningkatan performa, panduan migrasi manual | Tidak menambah sistem task kedua |
| v2, migration + multiplatform completeness | Import OMP berbasis preview/diff/backup/rollback, dan penyelesaian lifecycle installer macOS/Linux secara platform-native | Jangan menahan v1 Windows karena fitur migrasi |

**Penting:** macOS/Linux dapat mulai dibuild dan diuji paralel sejak awal, tetapi rilisnya harus memiliki status tersendiri. Tidak ada satu file `.exe` yang native di semua OS. Windows membutuhkan `.exe`; macOS `.app` di dalam `.dmg` atau paket lain; Linux umumnya `.deb`, `.rpm`, dan/atau `AppImage`. Ketersediaan satu platform tidak membuktikan platform lain bekerja.

## 1.3 Migrasi pengguna OMP

**Keputusan:** migrasi penuh *opt-in* dan berbasis backup direncanakan untuk v2, bukan onboarding wajib v1. Upaya mengimpor API key, session, extension, atau settings yang belum diaudit berisiko merusak workflow OMP yang telah digunakan pengguna, termasuk 9Router.

- v1 harus **tidak mengubah atau menghapus** profil OMP global, command `omp`, session OMP, konfigurasi 9Router existing, cache, atau file project pengguna.
- v1 menyediakan setup provider/model canoPi sendiri dan pesan bantuan ringkas bila pengguna datang dari OMP. Tidak membuat klaim otomatis mengimpor provider.
- Struktur data dan adapter dirancang supaya v2 bisa melakukan import selektif tanpa harus mendesain ulang aplikasi.
- v2 boleh mendeteksi instalasi/profil OMP hanya secara read-only. Jangan tampilkan prompt migrasi otomatis setiap startup. Tawarkan satu kali pada onboarding atau lewat Settings > Import from OMP.
- Tidak boleh memindahkan/menghapus data asal tanpa persetujuan. Default *copy*, bukan *move* atau *symlink*.

---

# 2. Source of truth dan kontrak perubahan

Urutan prioritas implementasi:

1. Keputusan eksplisit pengguna pada percakapan ini.
2. **`canopi-workspace.jsx` yang diunggah**, terutama struktur layout, visual, logo, komponen, spacing dan microinteraction. File ini sudah JSX React, **tidak** boleh diubah menjadi template baru.
3. `canoPi-desktop-source-v0.1.zip` sebagai baseline source teknis yang harus diperbaiki, bukan discarded rewrite.
4. `CANOPI_TAURI_OMP_PRD_2026-10-11.md` dan `CANOPI_DESKTOP_PRD_V2.md` sebagai historical constraints yang tidak bertentangan dengan keputusan lebih baru.
5. API dan perilaku aktual OMP pada **commit yang dipin**. Untuk fakta runtime, source upstream mengalahkan asumsi prototype.

**Checksum referensi input pada sesi audit ini:**

| Source | SHA-256 |
|---|---|
| `canopi-workspace.jsx` (source visual asli) | `6464d6c3a626dc669672b644a2fa3e03f64a1dd795dd40d2a894bc1cc1b30113` |
| `canoPi-desktop-source-v0.1.zip` | `a63ea6234ccdd047ea8e0f708542d2a8ffc5094ab322d9488a0e2bb5ab280b74` |
| `CANOPI_TAURI_OMP_PRD_2026-10-11.md` | `cf2c78d9788fc315ffc5962f8eb9f18fb87be40c6fae971234da685c24029a97` |

Dua ZIP `canoPi-desktop-source-v0.1.zip` dan `canoPi-desktop-source-v0.1(1).zip` berisi bytes identik dalam audit ini. Sumber JSX asli disertakan di ZIP sebagai `docs/ORIGINAL_CANOPI_WORKSPACE.jsx` dengan hash yang cocok.

**Aturan visual yang tidak boleh berubah diam-diam:**

- Logo payung Pi Canopy **dipertahankan**, bukan dihasilkan ulang.
- Home kosong sebelum session aktif. Headline Crimson Text dengan greetings/easter egg rotasi; composer sebagai titik fokus.
- Sidebar kiri memiliki New session, Open project, hierarki project > session > main agent > subagent, serta garis yang menunjukkan parent-child.
- Topbar mempertahankan breadcrumb/project selector dan kontrol Tasks, Browser, Settings, Search, theme.
- Conversation tetap pusat workspace. Pesan pengguna memakai **Crimson Text**, jawaban agent memakai **Plus Jakarta Sans**, terminal memakai **IBM Plex Mono**.
- Contextual TODO strip tetap **persis di atas composer**, bukan di kepala timeline.
- Kanban adalah view TODO OMP, bukan GitHub Projects atau duplikasi database task; tidak menambah tab Conversation/Tasks kedua.
- Worker inspector tetap di area kanan, dibuka sesuai konteks; CLI/terminal dock tetap di bawah, dapat collapse/resize/split.
- Dark default dari JSX memakai nuansa cyan/teal dengan panel glass dan background mesh. Light theme tetap ada. Blur/transparency tidak boleh mengorbankan kontras dan keterbacaan.
- Jangan menambah dashboard generik, menu baru yang mengulang fungsi, atau panel teknis yang membuat UI kembali penuh.
- Perubahan layout hanya dibenarkan untuk memperbaiki bug responsif, aksesibilitas, atau overflow dan **harus disertai screenshot before/after serta alasan spesifik**.

**Strategi port:** pertahankan copy asli immutable, lalu pelihara `src/app/CanoPi.tsx` dan komponen yang dipisah secara bertahap. Extract CSS menjadi tokens/styles bila diffs visual aman. Gunakan React asli, bukan render HTML lama dalam `iframe`. Saat menghapus simulasi, pertahankan component API semaksimal mungkin. Tes screenshot desktop 1440×900, 1024×768, mobile 390×844, dark dan light.

---

# 3. Audit konkret baseline v0.1

## 3.1 Apa yang memang ada di dalam ZIP

| File/area | Kondisi aktual dari inspeksi lokal | Implikasi |
|---|---|---|
| `src/app/CanoPi.jsx` | Turunan JSX asli, komponen dan styles masih ada; sebagian jalur runtime sudah mengganti simulasi | Dipertahankan, bukan ditulis ulang |
| `src/runtime/omp.js` | `invoke` Tauri, `listen` event, native dialog picker | Adapter dasar bisa dikembangkan |
| `src/runtime/projection.mjs` | Normalisasi TODO, worker, text | Berguna, tetapi perlu tes payload nyata dan stable identity |
| `src-tauri/src/main.rs` | Rust supervisor spawn proses, JSONL, pending response, allowlist, event emit | Ada kode nyata, belum ada bukti berhasil berkomunikasi dengan engine aktual |
| `src-tauri/tauri.conf.json` | Target NSIS Windows saja; productName canoPi; resource executable upstream | Belum cross-platform dan belum ada uninstall-data UX |
| `.github/workflows/windows-build.yml` | Clone upstream pinned, download binary release, build NSIS dan cek file PE | Workflow tidak membuild **fork canoPi** dari source OMP; hasilnya belum dibuktikan |
| `docs/ORIGINAL_CANOPI_WORKSPACE.jsx` | Source asli disalin byte-for-byte | Dapat menjadi regression reference |
| `tests/*.test.mjs`, `src/runtime/omp.test.mjs` | 10 static/pure tests, berhasil dijalankan lagi pada audit ini | Bukan tes install/run/session/IPC |
| `src-tauri/resources` | Tidak berisi engine executable nyata | ZIP belum standalone runnable |

**Fakta audit:** `node --test src/runtime/omp.test.mjs tests/*.test.mjs` lulus 10/10 di lingkungan audit. Tidak ada cargo compile, OMP spawn test, Windows setup run, uninstall integration test, atau 9Router real-model test dalam bukti tersebut.

## 3.2 Defect dan gap yang menjadi issue wajib

| ID | Severity | Bukti dan masalah | Perbaikan terukur |
|---|---|---|---|
| D-01 | Blocker | `tauri.conf.json` memakai resource array `resources/omp-win32-x64.exe`, tetapi `engine_path()` mencari langsung `$RESOURCE/omp-win32-x64.exe`; struktur direktori resource Tauri umumnya dipertahankan | Pakai map resource eksplisit atau path Rust yang identik; tes **installer terpasang**, bukan hanya folder repo |
| D-02 | Blocker | ZIP tidak menyertakan engine; workflow mengunduh executable upstream, bukan mem-build fork | Checkout pinned upstream sebagai **source**, apply patch `cnp`, build per OS dari fork, hasilkan build fingerprint |
| D-03 | Blocker | `PI_CONFIG_DIR` bernilai `.canopi-omp` relatif, sementara `PI_CODING_AGENT_DIR` juga diset. Semantik env/config dan precedence upstream dapat membuat profil tidak terisolasi seperti yang dibayangkan | Audit source config resolution; tetapkan satu root absolut canoPi; tes pengaruh env/project `.env`, file dan secret lookup |
| D-04 | High | `rpc_start` memulai session dengan `open_session` tanpa validasi handshake `ready` dan version negotiation; parent menerima response/event tanpa kontrak readiness yang memadai | Implement ready->version negotiate->open session/new session->get_state, timeout spesifik dan error deterministik |
| D-05 | High | JSONL v1 tidak menangani `rpc_chunk` v2; payload besar dapat truncate/error | Decoder v2 lengkap dengan batas 64 MiB, frame cap, chunk ordering, checksum/length validation sesuai protokol aktual |
| D-06 | High | Proses stderr diarahkan ke `Stdio::null()`, sehingga diagnosis engine exit sulit | Tangkap stderr ke bounded rotating redacted logs, tanpa membocorkan credentials/prompt sensitif |
| D-07 | High | State `conn` dan runtime supervisor belum per-session konsisten; `runtime_exit` untuk satu session dapat menandai keseluruhan UI offline | Status runtime, generation ID, cleanup dan stale-event gating **per session** |
| D-08 | High | Adapter React merespons `message_update` berdasarkan field payload asumtif; belum diuji dengan event nyata | Contract fixture dari actual pinned RPC, replay, duplicate delta avoidance, reconnect/hydration tidak menggandakan message |
| D-09 | High | Timer polling state 3,5 detik tanpa eksplisit debounce/race, sementara event tools juga memicu refresh | Event-driven invalidation + coalesced refetch + revision/generation guard; polling fallback adaptif |
| D-10 | High | Workspace metadata memakai localStorage, tapi sesi OMP dan profile disimpan melalui beberapa mekanisme tanpa manifest pemilik | Buat metadata manifest dan storage map typed dengan migrations, backup, ownership for uninstall |
| D-11 | High | `.exe` dan installer belum dibuild; workflow hanya verifikasi `MZ` dan SHA, bukan install-run/uninstall | Build native CI, runtime smoke test, install/uninstall test di Windows runner/VM, artifact signing status |
| D-12 | High | Tidak ada WebView2 per-agent browser control adapter, tidak ada ConPTY; beberapa UI control memberi pesan unsupported | Implement adapter native, pass lifecycle/isolation tests, atau jangan rilis v1 penuh |
| D-13 | High | Tidak ada onboarding provider/9Router aktif dalam canoPi profile | Model/provider discovery, safe key config, auth, verified model turn dan restart persistence |
| D-14 | High | Tidak ada custom Windows uninstall prompt; belum ada macOS/Linux packaging | Implement OS lifecycle matrix, data retention policy dan platform-gated release |
| D-15 | Medium | CLI namespace, process title, app identifiers, session path masih OMP-specific | Namespace `cnp` melalui patch upstream minimal dan tracked, bukan search/replace massal |
| D-16 | Medium | UX extension UI parsial; `setWidget` dan approval/tool dialogs tidak semuanya diproyeksikan secara benar | Pemetaan request/reply method lengkap, tests untuk cancel/race dan approval safety |
| D-17 | Medium | `src-tauri` memakai identifier `dev.canopi.desktop` sebagai placeholder | Putuskan identifier **stabil sebelum distribusi**, jangan ubah setelah release yang menyimpan data |
| D-18 | Medium | Tidak ada lockfile JavaScript pada ZIP v0.1 dan versi dependency memakai range `^` | Commit lockfile, pin toolchains, reproducible build, SBOM dan attestasi upstream commit |

**Catatan tingkat kepastian:** D-01 berdasarkan dokumentasi resmi Tauri tentang preservation lokasi resource dan struktur kode ZIP. D-03 sampai D-10 adalah masalah/risiko implementasi yang dibaca dari source, bukan bukti error runtime karena aplikasi belum dijalankan terhadap binary pinned pada audit ini. Perilaku definitif harus dipastikan melalui integration tests.

## 3.3 Stop-the-line condition

Jangan melanjutkan rebrand kosmetik atau menambahkan fitur baru ketika salah satu kondisi berikut belum lolos:

1. Binary internal berhasil ditentukan dan dijalankan dari lokasi **install**, tanpa instalasi global `omp`.
2. `ready` RPC keluar, handshake/protokol dinegosiasikan, `get_state` sukses pada session baru dan session reopen.
3. Satu prompt mencapai provider/model terkonfigurasi dan jawaban di-render streaming tanpa mock.
4. Kanban menampilkan TODO terbaru dari **session yang sama** dan tidak mencampur session berbeda.
5. CI build Windows + native smoke test lulus.

---

# 4. Arsitektur target dan pembatasan fork

```text
canoPi Desktop (satu aplikasi terinstall)
  ├── React + TypeScript / approved canopi-workspace.jsx
  │     ├── Home, Project, Session Tree, Conversation
  │     ├── Worker Inspector, TODO Kanban, Browser Surface
  │     ├── Model/Provider, Extension Dialogs, Terminal Dock
  │     └── App Settings, Data Management, About
  ├── Tauri v2 / Rust host
  │     ├── AppLifecycle + AppPaths + NativeDialogs
  │     ├── EngineSupervisor + RPCv2 framed transport
  │     ├── SessionRegistry + FrameRouter + Event Rehydration
  │     ├── ProfileManager + Credentials/Provider Boundary
  │     ├── AgentBrowserManager (OS WebView adapter)
  │     ├── TerminalManager (PTY adapter)
  │     ├── Structured Logs + Recovery + Cleanup Manifest
  │     └── Native platform integration / updates / release metadata
  └── Bundled cnp-engine (binary fork OMP; executable internal)
        ├── Agent/core session runtime, provider + 9Router model routing
        ├── Tools, extensions, commands, TODO, agent/subagent runtime
        └── rpc-ui stdin/stdout, retained protocol compatibility
```

**Aturan:** satu installer dapat membawa lebih dari satu file executable dan menjalankan banyak proses. Itu **tetap satu produk**. Jangan memaksa single physical PE/.app file bila sidecar lebih aman dan maintainable. Jangan mencoba memasukkan OMP ke satu Rust binary tanpa bukti bahwa reimplementation/in-process embedding memberi manfaat nyata.

## 4.1 Fork strategy yang harus dieksekusi

1. Checkout `can1357/oh-my-pi` pada commit pinned ke `upstream/oh-my-pi` atau submodule/mirror yang dapat diupdate. Simpan URL, commit, tag, tag verification dan dirty patch status.
2. Buat patch series kecil dan terpisah di `patches/omp/`, misalnya `0001-cli-alias-cnp`, `0002-brand-defaults`, `0003-config-root`, `0004-build-artifacts`, `0005-desktop-host-compat` (nama final mengikuti audit source).
3. Build hasil fork sebagai `cnp-engine[.exe]` untuk tiap target melalui upstream build system yang benar-benar berjalan (Bun/Rust native addons bila diperlukan). **Jangan hanya mengganti nama file prebuilt `omp-*.exe` lalu menyatakan source-forked.**
4. Pertahankan RPC command `prompt`, `get_state`, `set_model`, `get_subagents`, dan semua method protokol upstream, agar React/Rust tidak perlu menyimpan dua bahasa protocol.
5. CLI optional `cnp`: wrapper/entrypoint resmi yang meneruskan flags ke engine dan menampilkan help/--version branded, diuji. `cnp --mode rpc-ui` harus berfungsi, tetapi executable global opsional.
6. Jangan ubah nama paket upstream `@oh-my-pi/*` atau internal API yang dipakai ekstensi tanpa bukti bahwa rename perlu. Tracking origin dan copyright harus ada.
7. Batas modifikasi patch sesempit mungkin. Setiap upstream update = rebase patch series + compile/test + report kompatibilitas, bukan auto-pull versi OMP global.

## 4.2 Namespace baru dan kompatibilitas

| Lapisan | Target yang terlihat | Aturan |
|---|---|---|
| App GUI | `canoPi` | Nama dan ikon final di semua platform |
| Internal process | `cnp-engine` | Runtime fork; tidak muncul sebagai aplikasi terpisah di Installed Apps |
| Advanced CLI | `cnp` | Tidak mengubah command `omp` global yang telah dipasang |
| Runtime config profile | `canoPi` dedicated root | Tidak memakai default `~/.omp` untuk writes |
| RPC wire fields | Tetap nama upstream | Renaming RPC dilarang kecuali adapter kompatibilitas diperlukan |
| User-visible settings | `Models`, `Connections`, `Agents`, dsb. | Sederhana, tidak mengekspos env var sebagai UI utama |
| Environment compatibility | `PI_*` jika upstream masih memerlukannya | Boleh ada **internal**, redacted, tidak dianggap identitas aplikasi |
| Tauri bundle ID | ID valid stabil, misalnya `app.canopi.desktop` setelah disetujui/diputuskan sebelum rilis | Tetap sama antar-update untuk install/upgrade/data path |
| App data directory | OS-specific `canoPi` location | Manifest pemilik file untuk cleanup aman |

**Pembedaan penting:** rebrand publik bukan alasan mematahkan format session, tools, model, extension, atau protokol RPC. File config resmi runtime bisa mempertahankan kompatibilitas schema sementara lokasi penyimpanannya berada dalam namespace canoPi.

## 4.3 Batas keamanan proses

- Rust saja yang berhak memilih engine binary dari manifest, canonical path, dan signature/hash. React tidak dapat mengirim `executablePath` arbitrer.
- React hanya boleh meminta RPC command allowlist yang divalidasi schema (bukan cuma `type`); `projectPath`, `sessionPath`, subagent ID, file operation scope juga divalidasi.
- Untrusted tool output, extension messages, dan external web content tidak boleh diinterpretasikan sebagai instructions host.
- Jangan mewariskan environment secrets yang tak perlu ke child process. Tetapkan allowlist variable dan ingat OMP punya `.env` lookup precedence.
- Jangan mendaftarkan URL protocol handler, global CLI, file association, atau auto-start tanpa use case dan persetujuan.
- Secret tidak ditulis ke frontend store, log, crash report atau build artifact. OS secure store/keychain bisa dipakai jika sesuai kebutuhan, tetapi tidak diasumsikan kompatibel dengan format OMP tanpa tes.
- Proses `cnp-engine` harus bisa dihentikan dan ditutup dengan benar pada app quit/uninstall; tidak meninggalkan background worker orphan.

---

# 5. Engine transport, session state, dan sinkronisasi

## 5.1 RPC transport wajib

Source RPC pinned: `https://raw.githubusercontent.com/can1357/oh-my-pi/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/rpc.md`. Protokol adalah JSONL stdio, bukan REST dan bukan JSON-RPC 2.0. `ready` awal mengiklankan protocol v1 dan v2. `negotiate_protocol` ke v2 perlu dikirim jika didukung. Chunk v2 `rpc_chunk` perlu direkonstruksi dengan validasi urutan/length dan cap logis; jangan silently concatenate tanpa verifikasi.

Required state machine:

```text
NotStarted
  -> ResolvingBundledEngine
  -> SpawningEngine
  -> AwaitingReady
  -> NegotiatingProtocol
  -> OpeningOrCreatingSession
  -> HydratingStateAndHistory
  -> Ready
  -> PromptQueued -> Streaming -> Settling -> Ready
  -> (Suspended / Recovering / Failed / Stopped)
```

- `ready` ada sebelum commands; jangan asumsikan proses siap karena `spawn()` sukses.
- Request ID unik per process generation, response dikorelasikan by `id`. Out-of-order responses diterima.
- `prompt` acknowledgement berarti admitted/queued, **bukan** selesai; tunggu `prompt_result` dan settled state. Jangan mematikan animasi ketika baru menerima response awal.
- `agent_end` tidak selalu sama dengan semua subagent/background jobs selesai. Perhatikan `session_settled`, `prompt_result` dan state.
- UI event `extension_ui_request` harus direspons dengan `extension_ui_response`, termasuk cancel/race handling dan bounded queue.
- stdout satu jalur JSONL; stderr hanya bounded, redacted diagnostic. Monitor process termination dan exit code.
- Payload limits dari `ready` dihormati; inbound limits, frame parser, Unicode validation, backpressure dan denial-of-service testing.
- Request timeout disesuaikan dengan command. `get_state` bisa singkat, tetapi `get_available_models`/auth discovery/prompt acknowledgement dapat lebih lama. Timeout tidak otomatis berarti provider gagal.
- Stop memakai graceful shutdown (tutup stdin, drain output), kemudian bounded wait dan force kill hanya jika perlu. Lakukan cleanup handle/registry.

## 5.2 Session ownership dan project root

- Project dipilih melalui native folder picker Tauri. Simpan path nyata hanya di Rust-owned storage, tampilkan nama/path seperlunya.
- Tiap session memiliki canonical `session_key`, `project_id`, path project, engine process generation, runtime session identity/path, TODO revision marker dan metadata UI.
- App menjalankan proses sendiri dan mengelola session miliknya. Tidak berpura-pura attach live ke terminal OMP yang kebetulan berjalan di luar canoPi.
- Tidak ada dua engine menulis session file yang sama serentak. Gunakan lock/advisory ownership dan fallback read-only bila ditemukan konflik.
- Tulis transcript dan session memakai OMP native persistence; local canoPi menyimpan **UI metadata** seperti recent project, layout state, last selected agent, alias; bukan task DB kedua.
- `new_session`, `open_session` (param `sessionDir`) dan `switch_session` memiliki semantik berbeda. Pastikan pemilihan via test, bukan menganggap direktori kosong adalah session yang lengkap.
- Reopen setelah crash harus membaca ulang state engine dan history. Tidak boleh hanya mengandalkan localStorage.
- Session rename, branch, fork, search dan per-session model state dijalankan sesuai RPC support, tidak diiklankan bila belum didukung.

## 5.3 TODO Kanban sebagai projection satu arah default

- Source of truth **`get_state.todoPhases`** pada session OMP yang sama dengan conversation dan workers.
- Mapping status canonical adalah `pending`, `in_progress`, `blocked`, `completed`, `abandoned`. Render sesuai kolom JSX asli. Tidak membuat status sintetis.
- Card key dari `(session, phase index, task index, content hash)` hanya UI hint, bukan stable OMP task ID. Bila reorder/rename, rekonsiliasi selection dan tampilkan kehilangan identity tanpa silently mengubah task.
- TODO berubah melalui RPC event atau tool events -> invalidate state -> coalesced `get_state` -> atomic replace projection. Catat session_key dan generation sebelum menerapkan snapshot; abaikan stale replies.
- Saat berpindah session, board lain harus berbeda. Jika disconnected, tampilkan snapshot timestamp + stale label, tidak mengklaim `live`.
- Board read-only by default. `set_todos` mengganti seluruh state; jangan menambahkan drag-and-drop dua arah sebelum conflict control terbukti.
- Task -> Worker relation hanya jika runtime memberi evidence atau user membuat local binding; jangan menulis binding sebagai field TODO asli.
- Regression test khusus untuk bug sebelumnya: terminal menunjukkan Verify tetapi Kanban tetap menampilkan tiga task selesai dari session lama. Dengan canoPi board harus mengikuti state session yang benar atau jelas offline/stale.

## 5.4 Worker/subagent integration

- Derive worker list dan parent dari `get_subagents`/subagent events; jangan spawn proses CLI lain untuk tiap worker tanpa alasan.
- Worker inspector menampilkan transcript aktual (`get_subagent_messages`), streaming messages, progress, tool trace, state dan failed/stop reason.
- Steering lewat `steer_subagent`; cancel via `cancel_subagent`. Restart hanya jika API benar-benar mendukung lifecycle yang aman; bila tidak, tampilkan status unavailable.
- Nested workers yang muncul secara aktual harus digambar sesuai parent-nya, meskipun UI utama hanya menawarkan main-agent delegation.
- Worker browser, trace dan cancellation tidak boleh diarahkan ke agent lain. Semua native requests membawa session+agent owner token.

## 5.5 Extension UI / approvals

- Tangani dengan benar event `notify`, `select`, `confirm`, `input`, `editor`, `ask`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`, `open_url`, dan `cancel` sesuai dukungan snapshot upstream.
- Meminta konfirmasi operasi berisiko dengan detail tool/action nyata, bukan text generik yang menyembunyikan command.
- Jangan auto-approve destructive operations. Reject unknown request method with documented response atau feature-unavailable, tidak silent hang.
- Credential prompts yang tidak didukung RPC untuk secret input harus dibuka melalui flow onboarding/auth yang aman atau pesan `cannot complete this flow`, jangan mencoba password di generic editor.
- Runtime extension UI widget (misalnya OMP autoresearch) harus masuk area inspector/widget context yang relevan tanpa menciptakan panel permanen baru yang meramaikan layout.

---
# 6. Provider, 9Router, profiles, dan data ownership

## 6.1 Profil canoPi yang terpisah dari OMP

Definisikan **AppPaths** melalui API standard platform Tauri, bukan string absolut hardcoded. Nama direktori pada tabel adalah target desain dan harus cocok dengan package identifier final. Tentukan sekali ketika v1 dirilis agar update tidak membuat dua lokasi data.

| Jenis | Windows, instalasi per-user | macOS, target konseptual | Linux, target konseptual | Termasuk opsi delete? |
|---|---|---|---|---|
| App executable + engine | Folder instalasi per-user, misalnya `%LOCALAPPDATA%\Programs\canoPi\` | `/Applications/canoPi.app` atau `~/Applications/canoPi.app` | Dikelola paket `.deb`/`.rpm`, atau lokasi pilihan pengguna untuk AppImage | Ya, bersama uninstaller/package manager |
| App config/UI preferences | `%APPDATA%\canoPi\` | `~/Library/Application Support/canoPi/` | `${XDG_CONFIG_HOME:-~/.config}/canoPi/` | Pilihan keep/delete |
| OMP-compatible engine profile milik canoPi | Subfolder profiled di lokasi config/data canoPi | Subfolder di app support canoPi | Subfolder XDG config/data canoPi | Pilihan keep/delete |
| Session storage | `%LOCALAPPDATA%\canoPi\sessions\` | Di app support canoPi | `${XDG_DATA_HOME:-~/.local/share}/canoPi/sessions/` | Pilihan keep/delete |
| Logs dan cache | `%LOCALAPPDATA%\canoPi\logs`, `cache` | `~/Library/Logs/canoPi`, `~/Library/Caches/canoPi` | `${XDG_STATE_HOME:-~/.local/state}/canoPi`, `${XDG_CACHE_HOME:-~/.cache}/canoPi` | Cache/logs dapat dihapus; user-facing retention disesuaikan |
| OS credentials | Credential Manager/Keychain/Secret Service jika dipakai | Keychain | libsecret atau encrypted local store jika tersedia | Hanya item **yang dibuat canoPi**, dengan scope jelas |
| Project source dan git repo | Folder yang dibuka user di disk mana saja | Sama | Sama | **Tidak pernah** dihapus oleh uninstall |
| OMP lama/global | `omp` PATH, `%USERPROFILE%\.omp`, lokasi provider existing | `~/.omp` | `~/.omp` | **Tidak pernah disentuh otomatis** |

**Koreksi penting:** `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `--profile`, project `.omp`, dan `.env` punya aturan resolution serta precedence sendiri di upstream. Jangan menganggap cukup mengganti `PI_CONFIG_DIR=.canopi-omp` akan mengisolasi semua data/secret. Buat compatibility test dengan source fork pinned sebelum final menentukan env/CLI launch args, dan buktikan tidak ada writes ke profil OMP global.

## 6.2 Data manifest dan mekanisme cleanup

Pada app startup/upgrade, `ProfileManager` mengelola manifest berisi:

```json
{
  "schemaVersion": 1,
  "appId": "CANOPI_BUNDLE_ID_FINAL",
  "owner": "current-os-user",
  "installId": "generated-random-install-id",
  "engineBuild": "upstream-sha+canopi-patch-hash",
  "createdRoots": ["app-config", "app-data", "cache", "logs"],
  "sessionsRoot": "resolved-by-host",
  "externalProjects": ["display-only, never delete"],
  "migrationReceipts": [],
  "createdCredentialHandles": []
}
```

Manifest ini bukan permission untuk menghapus *semua path yang tertera*. Cleanup harus melakukan validasi canonical path dan registry of known app-owned roots. Jangan mengikuti symlink, junction, mount point, hardlink escape, atau path traversal. Jangan menghapus folder di luar canoPi root meskipun extension/tool menyimpan path di metadata. Jika lokasi ambiguity, tampilkan error dan biarkan data aman.

Pisahkan tiga tipe data:

1. **Aplikasi/komponen terpasang**: GUI executable, `cnp-engine`, helper, ikon/shortcuts/associations yang benar-benar dibuat installer. Ini selalu dihapus pada uninstall.
2. **Data milik canoPi**: setting, sessions, model/provider credentials yang dibuat aplikasi, log dan cache, metadata UI. Default **dipertahankan** kecuali pengguna memilih delete data.
3. **Data pengguna di luar canoPi**: folder project, source code yang agent ubah, Git repo, artifact kerja, OMP global, konfigurasi tools lain. Ini **tidak boleh dihapus** oleh uninstall, bahkan saat opsi "Delete my canoPi data" dipilih. Pengguna dapat mengelolanya manual.

Data removal tanpa secure erase guarantee. SSD wear levelling, snapshots, backup sistem dan cloud sync membuat *cryptographic secure deletion* tidak dapat dijanjikan hanya karena file dihapus. Jelaskan ini dengan jujur di dokumentasi.

## 6.3 Onboarding 9Router dan provider, v1

- Jika engine tidak punya model/provider yang dapat dipakai, Home menampilkan satu kebutuhan setup yang ringkas sebelum mengirim prompt. Tidak menampilkan model palsu `9Router route A` sebagai model aktif.
- Opsi koneksi provider harus mengikuti dukungan OMP aktual dan 9Router yang telah dibuktikan, termasuk base URL/proxy API apabila applicable.
- Form provider harus membatasi input, menyensor secret, dan tidak log credential atau response authorization.
- Profil canoPi menyimpan konfigurasi sendiri. OMP global milik pengguna tetap utuh.
- UI hanya menampilkan provider connected/unavailable setelah tes ringan yang benar-benar berhasil. *Provider configured* tidak boleh otomatis dianggap *provider working*.
- Recovery saat invalid key, expired auth, rate limit, network outage, model removed, dan misconfigured 9Router harus jelas dan non-destructive.
- Untuk OAuth flow yang memerlukan eksternal browser atau input rahasia, gunakan supported secure provider flow; jangan memalsukan dukungan RPC.

---

# 7. Packaging: satu produk, installer native per OS

## 7.1 Makna "terdeteksi OS"

Aplikasi dinyatakan terintegrasi dengan OS hanya jika syarat platformnya lolos:

- Nama **canoPi** dan ikon final muncul di tempat standar OS (Start Menu/Search/Installed Apps pada Windows, Launchpad/Finder/Applications pada macOS jika terpasang ke Applications, launcher/desktop entry dan package manager pada Linux sesuai format distribusi).
- File executable asli runnable, signed jika distribusi sudah memakai signing. Installer dan updater tidak menyamar sebagai OMP.
- Runtime internal dapat ditemukan **relatif terhadap app bundle/install directory** tanpa PATH `omp`.
- Uninstaller atau package removal dapat menjalankan lifecycle cleanup yang aman sesuai OS. OS-specific semantics dijelaskan di bawah.
- App launch tidak memerlukan Bun/Node/Rust/OMP global, kecuali komponen OS yang sah seperti WebView2 yang diurus installer.
- Identitas paket, desktop entry, app icon dan uninstall registry/paket menggunakan satu app identity yang konsisten antar-upgrade.

**Catatan distribusi:** file `.exe` hanya binary Windows. macOS dan Linux memerlukan target executable dan packaging lain. Multi-platform support berarti *sekumpulan artifact build native*, bukan satu executable universal.

## 7.2 Windows v1 release, prioritas P0

**Format utama:** NSIS setup EXE dari Tauri v2. Ini mendukung per-user install tanpa admin secara default serta dapat dikustomisasi menggunakan installer hooks. Jika ada kebutuhan per-machine nanti, itu varian terpisah yang diuji, bukan mengganti default secara diam-diam.

**Bundle wajib:**

- `canoPi.exe` Rust/Tauri GUI
- `cnp-engine.exe` dari **fork source** dengan native dependency yang benar-benar diperlukan (tidak membutuhkan OMP global)
- Original source/copyright license notices, SBOM atau dependency license inventory
- Asset logo/icon dark/light, font lokal Crimson Text, Plus Jakarta Sans, IBM Plex Mono, UI assets
- NSIS installer/uninstaller and shortcuts
- WebView2 detection/installation support sesuai standar Tauri
- Build manifest berisi product version, commit fork OMP, patch series hash, asset hash, SDK/toolchain versions, Tauri version, build time UTC dan tests result

**Default:** NSIS `perUser`. Target path di AppData lokasi instalasi aplikasi, bukan hardcode `Program Files`. Installer harus menyediakan opsi/behavior existing install upgrade tanpa menghapus session. Shortcut `canoPi` di Start Menu dibuat oleh installer dan dihapus saat uninstall. Desktop shortcut hanya jika dipilih; jangan menambah startup entry otomatis.

**Windows OS integration acceptance:**

1. Double click installer di clean Windows VM yang **tidak** mempunyai OMP global, berhasil selesai.
2. Installed Apps menampilkan `canoPi`, versi, publisher yang benar/realistis, opsi Uninstall. Pencarian Start Menu `canoPi` memunculkan ikon dan membuka aplikasi.
3. `Task Manager` boleh menunjukkan `canoPi.exe`, `cnp-engine.exe`, dan `msedgewebview2.exe` karena engine render OS. Jangan mengklaim satu proses.
4. `canoPi.exe` membuka home, proyek, model, session; engine sehat walau tidak ada `omp` di PATH.
5. Upgrade installer versi selanjutnya mempertahankan data, memperbarui app dan engine secara atomik, dan tidak menciptakan duplikat Installed Apps.
6. Jika WebView2 belum tersedia, installer memeriksa dan menangani sesuai configured install mode atau gagal dengan instruksi jelas. Jangan mematikan pemeriksaan hanya agar setup lebih kecil.
7. Uninstall menghapus app binaries, shortcuts, registry install metadata dan file package yang dimiliki installer; data user sesuai pilihan retention.

**Signing:** unsigned installer mungkin menunjukkan SmartScreen warning. Jangan menjamin bebas warning tanpa code signing certificate/reputation. PE `MZ` signature/size check hanyalah pemeriksaan minimum, bukan bukti application quality, signing, atau keamanan.

## 7.3 Windows uninstall wizard dan cleanup contract

**Titik integrasi:** `src-tauri/windows/hooks.nsh` melalui `tauri.bundle.windows.nsis.installerHooks`, khususnya `NSIS_HOOK_PREUNINSTALL` dan `NSIS_HOOK_POSTUNINSTALL`. Tauri mendokumentasikan hook tersebut. Kebutuhan dialog UI kompleks mungkin membutuhkan custom NSIS pages/logic atau helper CLI, diuji di VM. Jangan mengasumsikan template default sudah menyediakan prompt penghapusan data.

**Flow interaktif yang dikunci:**

```text
Windows Settings > Installed Apps > canoPi > Uninstall
  -> standard Windows/NSIS consent
  -> [canoPi Uninstall]
       "Remove canoPi from this device?"
       [x] Keep my projects and canoPi data (recommended, default)
       [ ] Delete canoPi app data, saved sessions, settings and cache
       Note: Project folders and existing OMP installation will never be deleted.
       [Cancel] [Uninstall]
  -> stop canoPi GUI + cnp-engine gracefully
  -> remove installed app and created shortcuts/registry entries
  -> if and only if delete option chosen:
       validate current OS user + owned roots + no shared data + no junction escape
       purge canoPi-owned data/credential entries and report failures
  -> completion summary
       installed binaries removed
       data kept / data deleted / partial deletion report
```

**Destructive selection:** gunakan radio buttons atau checkbox yang konsekuensinya eksplisit, bukan menipu via preselected delete. Default **Keep**. Jika pengguna memilih Delete, tampilkan ringkasan kategori data dan konfirmasi tambahan bila terdapat provider credentials/sessions yang belum diexport. Jangan meminta pengguna mengetik password tanpa alasan.

**Silent/unattended uninstall:** tanpa dialog, default **Keep data**. Mode delete hanya dengan flag admin/enterprise yang spesifik dan terdokumentasi, bukan flag generik. Jangan hapus data semua account pada per-machine installation, hanya account milik user yang terverifikasi dan memilih delete.

**Process safety:**

- Frontend harus menyimpan draft atau meminta konfirmasi bila kerja masih berjalan sebelum user memulai uninstall dari dalam app.
- Uninstaller dari Windows Settings harus bisa meminta aplikasi berhenti, menunggu bounded timeout, baru menampilkan pesan jika proses gagal ditutup. Jangan otomatis kill engine sebelum session flush kecuali timeout aman telah lewat.
- Restore/rollback bila uninstall dibatalkan atau gagal di tengah; data jangan dihapus sebelum keputusan final dan urutan operasi aman.
- File lock/permission denied ditulis ke receipt lokal yang dapat diekspor; jangan mengklaim clean jika gagal.
- Windows uninstall tidak boleh menghapus `omp.exe`, `~\.omp`, global 9Router settings, PATH yang dibuat pihak lain, atau project dirs yang dioperasikan agent.

**Verification matrix Windows:**

| Case | Pilihan | Expected result |
|---|---|---|
| WU01 Fresh uninstall | Keep | App hilang dari Installed Apps/Start Menu, binary hilang, session/settings masih ada |
| WU02 Fresh uninstall | Delete | App + **hanya** canoPi-owned data/credentials hilang, proyek dan OMP lama utuh |
| WU03 Cancel | Cancel | App dan semua data tetap utuh |
| WU04 Existing OMP | Delete | OMP global/9Router asli 100% tidak berubah dibanding baseline hash/manifest |
| WU05 CLI enabled | Keep/Delete | Hanya PATH/shim `cnp` milik installer yang dibersihkan, `omp` tetap |
| WU06 Active engine | Keep/Delete | Engine berhenti, tidak orphan, pending session state jelas, ada timeout/report |
| WU07 Installed update | Upgrade | Tidak menjalankan destructive delete, data & model configuration dipertahankan |
| WU08 Silent uninstall | Unattended | Default keep; tanpa prompt tersembunyi, tidak wipe data |
| WU09 Non-standard data directory | Delete | Tidak mengikuti symlink/junction/reparse-point ke project/OMP/global path |
| WU10 Install after keep | Reinstall | App menemukan data canoPi lama yang kompatibel dan menawarkan resume tanpa migrasi destruktif |
| WU11 Partial cleanup failure | Delete | Failure dilaporkan dengan kategori/path yang aman, tidak diklaim sukses total |
| WU12 Different Windows account | Per-user uninstall | Tidak menyentuh data akun lain |

## 7.4 macOS native release, P1 sebelum klaim cross-platform

**Artifact:** `canoPi.app` dan `.dmg` (universal binary jika dependency engine mendukung dan telah diuji; jika tidak, dua architecture-specific builds). App terdeteksi melalui bundle metadata, icon, CFBundleIdentifier, Applications/Finder dan Spotlight/Launchpad sesuai instalasi pengguna. Signing/notarization dibutuhkan untuk pengalaman distribusi publik tanpa warning yang menyesatkan.

**Uninstall macOS tidak sama dengan NSIS.** macOS biasanya menghapus aplikasi dengan memindahkan `.app` ke Trash; tindakan itu tidak memberikan kesempatan standar bagi app untuk selalu memunculkan dialog uninstall. Karenanya **jangan menjanjikan otomatis ada prompt Keep/Delete saat user membuang `.app` dari Finder**.

Implementasi yang realistis:

1. Settings > Data & Privacy > **Prepare to Uninstall** menampilkan Keep/Delete dengan pilihan default Keep.
2. Jika Delete dipilih, aplikasi yang masih berjalan menghentikan engine, membuat summary, dan menghapus hanya root canoPi yang dimiliki user, setelah konfirmasi. Opsi export session/config tersedia sebelum deletion.
3. Instruksi ringkas untuk membuang `canoPi.app` ke Trash dari Applications ditampilkan setelah cleanup.
4. Bila pengguna langsung membuang `.app`, hanya app bundle hilang dan data tetap aman. Dokumentasi menyediakan helper signed/verifiable untuk later cleanup jika diperlukan.
5. Jangan memasang background launch agent/privileged helper hanya untuk mensimulasikan uninstall dialog.

**Acceptance:** fresh install, launch, reopen, macOS Gatekeeper assessment sesuai signing status, app bundle deletion, prepare-uninstall Keep/Delete, paths/credential clean, OMP lama dan project unchanged; test di macOS Intel dan Apple Silicon apabila keduanya diklaim didukung.

## 7.5 Linux native release, P1 sebelum klaim cross-platform

**Artifact:** pilih `.deb` Ubuntu/Debian-family dan `.rpm` Fedora/RHEL-family sebagai native installed packages, `AppImage` sebagai opsi portable setelah diuji. Linux desktop registration bergantung package format dan environment; `AppImage` yang diunduh tidak otomatis menjadi package yang muncul di package manager/Apps pada semua distro.

**Data retention pada Linux:**

- `apt remove`, `dnf remove`, atau distro package manager menghapus binary dan desktop entry milik paket. **Jangan hapus `/home/*` dari postrm script**, jangan memunculkan prompt interaktif yang bisa mengunci automated package manager.
- Per-user data di XDG directories dipertahankan default. Pilihan Delete tersedia melalui Settings > Data & Privacy > Prepare to Uninstall, atau `cnp data cleanup --interactive` jika advanced CLI terpasang.
- CLI cleanup noninteractive hanya boleh delete jika flag eksplisit yang benar-benar diotorisasi; first run harus memvalidasi user/path dan manifest.
- AppImage adalah file portable. Pengguna bisa menghapus file tersebut dan data tetap tersimpan; tawarkan clean-up in-app bila tersedia.
- Unix integration `XDG desktop entry`, ikon, MIME/URL association hanya jika diperlukan, menu shortcut yang terdaftar oleh package dihapus otomatis saat remove.

**Acceptance:** pada distro matrix yang dinyatakan didukung, paket berhasil diinstall/launch/upgrade/remove, dependency WebKitGTK/OS packages diperiksa secara eksplisit, desktop entry muncul, engine per-arch berjalan, cleanup tidak mengubah OMP global/proyek.

## 7.6 Build matrix dan release gates per OS

| OS/arch | Distribusi target | Mode rilis | Prioritas | Persyaratan khusus |
|---|---|---|---|---|
| Windows 10/11 x64 | NSIS setup `.exe` | Installer v1.0 | **P0** | Per-user install, WebView2, unregister uninstall, PE & functionality |
| Windows ARM64 | NSIS setup target ARM64 | Opsional setelah x64 | P2 | Native ARM64 engine dan toolchain, jangan hanya installer yang emulated |
| macOS arm64 | `.app` + `.dmg` | v2 atau earlier beta tested | P1 | Apple Silicon native engine, signing/notarization expectations |
| macOS x64 | `.app` + `.dmg` | v2 atau earlier beta tested | P1 | Intel native engine/support matrix |
| Ubuntu/Debian x64 | `.deb` | v2/beta setelah tested | P1 | WebKitGTK system deps, desktop integration |
| Fedora x64 | `.rpm` | v2/beta setelah tested | P1 | Distro package deps, package manager removal |
| Linux x64 | `AppImage` | Optional portable | P2 | Tidak dijanjikan sebagai registered native package |
| Linux arm64 / lainnya | Tergantung support engine | Belum committed | P2 | Toolchain + native deps test; tidak boleh cross-label supported |

**Gate per platform bersifat independen:** jika Windows PASS tetapi Linux BLOCKED, release notes menyebut **Windows available, Linux pending**, bukan "cross-platform ready".

---

# 8. Browser, terminal, dan native UI capabilities

## 8.1 Browser per agent

Tujuan locked UX: setiap main/worker agent yang membutuhkan browsing mendapatkan surface browser sendiri di inspector; penyimpanan cookie/cache/profil terisolasi per session+agent. Tidak boleh ada penggunaan Chrome/Chromium executable eksternal yang tiba-tiba diluncurkan oleh canoPi. Pada Windows, **WebView2 memang berbasis Chromium renderer OS** dan diperbolehkan. macOS memakai WKWebView/WebKit dan Linux memakai native WebKitGTK sesuai dukungan Tauri.

**Adapter requirement:**

- `createBrowser(session, agent) -> surfaceHandle`, `navigate`, `observe`, `click`, `type`, `scroll`, `screenshot`, `close`, `suspend`, `resume`, `setPermissions`, `clearOwnedData`.
- Browser harus bisa **dikendalikan tool agent**, tidak cukup user dapat mengetik URL dalam WebView; observability/accessibility snapshot dan aksi input perlu bridge yang benar-benar dapat diakses OMP tool layer.
- Audit cara OMP browser/`tab.run` bekerja. Jika API tool mensyaratkan external CDP/Chrome, putuskan native interception/plugin bridge yang kompeten. **Jangan klaim parity kalau adapter belum sanggup.**
- Session agent `a1` dan `a2` memakai isolated profile storage dan stable identity. Cookie/set session di `a1` tidak muncul di `a2`.
- Browser render di area inspector JSX yang ada atau window native scoped bila embedded child WebView tidak mampu dengan tepat. Tidak boleh menata ulang workspace tanpa alasan teknis yang diuji.
- Cross-agent handle access selalu DENIED; backend enforce ownership, bukan hanya tombol UI disabled.
- Permission prompts untuk downloads/uploads, clipboard, camera/mic/location memakai default deny/ask dan audit trail. Tidak memberi JS eval arbitrary kepada extension tanpa policy.
- Lakukan screenshot dari native surface sebenarnya; jangan substitusi hasil `fetch`/HTML string/dummy preview.
- Jika agent browser crash, hanya surface itu yang direstart; proses agent lain dan TODO tetap utuh.

**Minimum acceptance:** navigasi website lokal fixture, actual rendering, click/type/scroll/screenshot, cookie isolation A/B, worker ownership check, crash recovery, browser teardown on uninstall, no `chrome.exe`/Puppeteer browser install.

## 8.2 Terminal dock

- Main dock tetap di bawah, collapse/expand/resize/split sesuai JSX, mendukung log agent dan shell user **sebagai dua objek berbeda**.
- Windows memakai ConPTY melalui Rust PTY library/native binding yang kompatibel; macOS/Linux memakai platform PTY (`openpty`/equivalent). Harus diuji di OS target.
- Terminal emulator frontend butuh input/output, ANSI rendering, resize, scrollback bounded, process exit codes, keyboard shortcuts, Ctrl+C/interrupt, working directory.
- Sesi terminal user berbeda dengan `bash` tool execution dari OMP; trace tool tetap dapat dibaca tanpa mengaku sebagai PTY.
- PTY shell mempunyai owner aplikasi/session dan harus ditutup dengan signal graceful lalu fallback kill sesuai OS.
- Shell default mengikuti pilihan pengguna/OS; jangan memaksa PowerShell di Linux/macOS. Jangan memberi arbitrary shell execution ke frontend tanpa konfirmasi/scoping bila runtime security membutuhkan.
- Tidak menampilkan mock `npm run dev`, `git status`, atau test output palsu pada production.

## 8.3 Model, commands, feature exposure

- Daftar model/roles/effort berasal dari OMP runtime. Bila API thinking levels mendukung `inherit/off/minimal/low/medium/high/xhigh/max`, UI menampilkan subset valid yang benar-benar tersedia, bukan fixed `Auto/Low/Medium/High` semata.
- Slash command catalog berasal dari OMP runtime dan menghapus `/share` sesuai keputusan produk; jangan memfilter command user dengan substring sembarang.
- Fitur yang runtime dukung tetapi belum punya UI harus punya adapter/command route atau disabled + alasan, dengan daftar parity yang diaudit.
- Model picker settings tidak boleh menulis ulang OAuth/API credential via localStorage.
- UI tidak melakukan "model call" mock untuk keadaan offline dan tidak menyebut `Connected` jika hanya binary file ditemukan.

---
# 9. Upgrade, recovery, security, dan performance

## 9.1 Upgrade contract

- Aplikasi `canoPi` dan `cnp-engine` memakai **compatibility manifest** berisi `appVersion`, `engineForkCommit`, `upstreamCommit`, `protocolMin`, `protocolMax`, `profileSchema`, `sessionSchema` dan hash actual bundled files.
- Installer upgrade tidak menghapus data dan tidak membuat profil baru bila schema masih kompatibel. Migrasi schema harus deterministic, backward compatible sejauh memungkinkan, dan punya backup/rollback.
- Jangan update engine secara independen dari GUI di background. Versi fork dipin agar perubahan protokol tidak merusak UI atau TODO.
- Rilis v1 boleh menggunakan update manual installer. Auto-update resmi baru setelah signing, channel releases dan rollback test siap.
- Jangan menerima update OMP global sebagai engine canoPi. Provenance harus bisa dilacak sampai commit fork.
- Jika engine tidak kompatibel setelah upgrade, app berhenti dengan error jelas, mencoba restore backup konfigurasi/sessions, tanpa menimpa data lama.
- Artifact updater/installer harus diberi checksum; signing dan attestation sesuai platform sebelum rilis publik.

## 9.2 Recovery contract

- Power loss/force-quit tidak boleh menyebabkan semua session metadata hilang. Lakukan atomic writes, fsync sesuai kepentingan, dan backup critical metadata saat migrasi schema.
- Saat Rust supervisor mati: UI memisahkan `runtime_lost` dari `provider_network_error`, menandai session impacted, mempertahankan transcript yang telah diterima, serta menawarkan Reconnect.
- Saat engine mati tiba-tiba: retain last-known state sebagai stale, restart session secara terkendali, rehydrate `get_state` dan `get_messages_page` dari durable history, dedup dengan identity nyata.
- Jangan memproses late frames dari generasi process lama, terutama tool completion, auth dialog, TODO update dan subagent progress.
- Gunakan memory bounds untuk stdout buffer, queue, history pagination, log, screenshot dan PTY scrollback. Hindari unbounded React state cloning setiap `message_update` bila berpengaruh ke performa.
- Separate shutdown app-level vs stop turn vs stop subagent vs close browser vs close shell. Tombol `Stop` harus punya target yang konsisten.

## 9.3 Threat model ringkas

| Ancaman | Kontrol wajib |
|---|---|
| Extension meminta eksekusi host arbitrer | RPC allowlist + semantic argument validation + capability isolation |
| File path keluar project/scope saat open/export | Canonical path, trusted OS picker, user approval dan filesystem restrictions |
| Uninstall `delete data` salah menghapus project/OMP | App-owned manifest, canonical root verification, symlink/junction refusal, dry-run dan VM tests |
| API key/9Router masuk log | Redaction central, sensitive event filtering, no plain frontend localStorage secrets |
| Browser satu worker melihat cookie worker lain | OS-specific independent profiles, backend ownership tokens, test A/B |
| Session TODO tertimpa snapshot lama | Generation/revision guard, refetch serialized, explicit stale state |
| Malicious update/release asset | Pinned commit, checksum/signature, binary provenance, reproducible build manifest |
| Process file lock/orphan pas uninstall | Graceful close, bounded wait, process ownership, cleanup report |
| Secrets terbaca via env inheritance | Child env allowlist dan audit OMP `.env` path lookups |

## 9.4 Performance targets (engineering budget, bukan fakta terukur)

- Home dan core workspace terbuka tanpa menunggu provider login/network; engine readiness async dengan visible state.
- Streaming chat tetap responsif saat 2 worker mengirim event dan Kanban refetch berlangsung. UI interactions tidak boleh memblokir Rust message drain.
- Hindari polling global 3,5 detik bila event invalidation cukup; gunakan fallback bounded ketika event tidak dapat diandalkan.
- Browser surfaces dibuat lazily dan dihentikan/suspended ketika tidak dipakai, dengan kebijakan yang tidak kehilangan session/cookie secara tak terduga.
- Dock scrollback dan log dibatasi. Background process count dijelaskan, jangan menargetkan minimal RAM dengan menghilangkan kemampuan native yang diminta.
- Ukur cold start, RAM idle/dua worker, streaming lag, snapshot sync latency, CPU idle, binary/installer size di perangkat Windows nyata sebelum release. Nilai threshold final ditetapkan dari baseline **hasil ukur**, bukan angka yang diarang dalam PRD.

---

# 10. Implementasi migrasi OMP, **v2 only**

Migrasi layak dibuat untuk pengguna OMP yang sudah punya banyak sesi dan konfigurasi. Tetapi implementasi awal yang asal copy folder dapat memindahkan secret yang tidak dimengerti, mematahkan extension path atau menimbulkan shared-state corruption. Oleh sebab itu **v1 fokus pada runtime canoPi yang siap dipakai sendiri**.

## 10.1 Desain UX v2

Lokasi: Settings > Data & Privacy > Import from OMP. Jika OMP terdeteksi, UI boleh menawarkan tombol `Review import` sekali pada onboarding, tidak auto-import. Copy contoh:

> Existing Oh My Pi setup found. You can review and copy selected sessions and settings into canoPi. Your OMP installation and original files will not be changed.

Wizard:

1. **Discover** read-only: deteksi path config OMP, versi/profile aktif, session count, model/provider definitions, extensions/MCP, ukuran perkiraan; tidak membuka isi credential ke renderer UI.
2. **Compatibility report:** tandai item importable / requires intervention / unsupported, termasuk 9Router, custom extension, absolute file refs, provider oauth.
3. **Select:** sessions, provider config nonsecret, model preferences, rules/skills, MCP/extensions dipilih secara granular; secrets memiliki workflow khusus.
4. **Preview diff:** daftar file yang akan dibuat, target path, estimated size, conflicts dan tindakan. Default `Skip conflicts`, tanpa overwrite.
5. **Backup:** simpan snapshot destination canoPi + manifest receipt. Jangan backup rahasia ke directory yang bisa dibaca umum.
6. **Copy transactional:** filesystem staged destination, validasi, atomic commit. Tidak pernah move/symlink data OMP langsung.
7. **Verify:** session reopen, model/provider health dan extension startup tests, counters dengan hasil sukses/gagal.
8. **Rollback:** untuk partial import, rollback hanya item destination yang dibuat transaction ini, data OMP asal tetap tidak berubah.

## 10.2 Item-specific migration rules

| Kategori | Policy |
|---|---|
| Session/transcript | Copy file terkait lengkap dengan artifact references; test open/recovery dan branch path |
| Model preferences | Map model/provider ID sesuai catalog versi fork; unavailable model ditandai dan tidak diklaim tersambung |
| 9Router | Config adaptasi schema; token/secret melalui secure credential flow, jangan menampilkan credential plaintext |
| OAuth | Re-auth jika token storage tidak portable atau tidak ada API aman; jangan copy opaque token lalu klaim sukses |
| Extensions/MCP | Audit dependency and executable paths; default disabled hingga compatibility test pass |
| Rules/skills/prompts | Copy selected, preserve precedence dan source annotations; jangan overwrite project-specific rules |
| Global OMP CLI | Tidak diinstall/dihapus/diubah oleh migrasi |
| Project repos | Tidak dicopy atau dihapus kecuali user memilih project root yang nyata; simpan link path lokal sebagai metadata |

## 10.3 Uninstall setelah migrasi

- Data yang **disalin ke canoPi** menjadi milik canoPi dan boleh dihapus saat user memilih Delete canoPi data.
- Profil OMP asal, session OMP asal, dan repo/project pengguna tidak boleh ikut terhapus.
- `migrationReceipt` mencatat source read-only dan destination owned. Ownership bukan hak untuk menghapus source.
- Testing harus mencakup semua kombinasi import, revert dan uninstall dengan pilihan Keep/Delete.

---

# 11. Repo structure hasil akhir yang disarankan

Struktur bersifat target teknis, bukan izin untuk merekonstruksi UI. `src/app/CanoPi.jsx` v0.1 harus tetap dapat ditelusuri ke input, meski akhirnya dipisah menjadi modul TSX.

```text
canopi/
├── README.md
├── CHANGELOG.md
├── LICENSE
├── NOTICE-THIRD-PARTY.md
├── package.json
├── bun.lockb / bun.lock (sesuai toolchain yang dipilih; lockfile wajib)
├── Cargo.lock
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── CanoPi.tsx                     # approved component layout stays source-of-truth
│   │   ├── styles/tokens.css
│   │   ├── styles/workspace.css
│   │   ├── components/
│   │   │   ├── Topbar.tsx
│   │   │   ├── Rail.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── Conversation.tsx
│   │   │   ├── WorkerInspector.tsx
│   │   │   ├── TaskBoard.tsx
│   │   │   ├── TerminalDock.tsx
│   │   │   └── ExtensionDialogs.tsx
│   │   └── assets/                         # original logo, bundled fonts
│   ├── runtime/
│   │   ├── client.ts                      # typed Tauri IPC bridge
│   │   ├── rpc-types.ts                   # pinned protocol contract
│   │   ├── state-projection.ts
│   │   ├── event-reducer.ts
│   │   └── session-registry.ts
│   └── tests/
│       ├── protocol-fixtures/
│       ├── state-projection.test.ts
│       ├── event-replay.test.ts
│       └── jsx-preservation.test.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── tauri.windows.conf.json
│   ├── tauri.macos.conf.json
│   ├── tauri.linux.conf.json
│   ├── capabilities/default.json
│   ├── icons/                              # canoPi icon set
│   ├── resources/engine/<triple>/cnp-engine[.exe]
│   ├── resources/licenses/
│   ├── windows/
│   │   ├── hooks.nsh                     # NSIS uninstall Keep/Delete UX
│   │   └── uninstall-data-helper/        # if needed; signed/packaged
│   └── src/
│       ├── main.rs
│       ├── app_paths.rs
│       ├── supervisor.rs
│       ├── rpc/{mod.rs,framing.rs,client.rs,events.rs,ui.rs}
│       ├── sessions/{mod.rs,registry.rs,persistence.rs}
│       ├── profile/{mod.rs,storage.rs,credentials.rs}
│       ├── platform/{windows.rs,macos.rs,linux.rs}
│       ├── browser/{mod.rs,owner.rs,surface.rs}
│       ├── terminal/{mod.rs,pty.rs}
│       └── lifecycle/{mod.rs,cleanup.rs,manifest.rs}
├── upstream/
│   ├── oh-my-pi/                         # pinned Git source checkout/submodule
│   └── patches/                          # tracked minimal fork patch series
├── scripts/
│   ├── build-engine.ps1
│   ├── build-engine.sh
│   ├── verify-engine-provenance.py
│   ├── verify-installed-runtime.ps1
│   └── test-uninstall-windows.ps1
├── .github/workflows/
│   ├── ci-static-and-unit.yml
│   ├── windows-build-and-install-test.yml
│   ├── macos-build-and-smoke.yml
│   └── linux-build-and-smoke.yml
├── tests/
│   ├── integration/                      # real OMP rpc-ui transcripts and round trips
│   ├── e2e/windows/                      # install/start/kill/resume/uninstall VM tests
│   ├── e2e/macos/
│   ├── e2e/linux/
│   └── visual/                            # approved JSX screenshot baselines
├── docs/
│   ├── ORIGINAL_CANOPI_WORKSPACE.jsx
│   ├── PRD_V3.md
│   ├── AUDIT_V0_1.md
│   ├── RPC_CONTRACT.md
│   ├── MIGRATION_V2.md
│   ├── DATA_OWNERSHIP.md
│   └── RELEASE_TEST_REPORT.md
└── dist-artifacts/
    ├── canopi-source-<version>.zip
    ├── canopi-windows-x64-setup-<version>.exe
    ├── canopi-macos-<arch>-<version>.dmg (later)
    ├── canopi-linux-<version>.deb/.rpm (later)
    ├── SHA256SUMS.txt
    └── BUILD-MANIFEST.json
```

**Repo delivery invariant:** Source ZIP harus memasukkan patch series dan langkah checkout pinned upstream yang reproducible. Jika belum ada upstream source bytes di ZIP, tulis eksplisit bahwa itu bukan monorepo fork lengkap. Release build engine harus berasal dari fork and patch set pada artifact manifest. Jangan menyertakan binaries hasil download upstream dan menyebutnya sebagai `cnp-engine forked build` tanpa provenance.

---

# 12. Rencana eksekusi berurutan dengan gate dan bukti

Tugas ini bukan permintaan pembuatan PRD ulang pada eksekusi selanjutnya. Urutan di bawah menjadi instruksi implementasi teknis; apabila ada blocker, dokumentasikan bukti dan lanjutkan pekerjaan lain yang independen, bukan mengganti hasil dengan fake UI.

## Milestone M0. Reproduce baseline dan sumber

**Tujuan:** membuktikan source baseline memang dapat dibangun dan proyek siap dikembangkan.

1. Extract ZIP v0.1, simpan intact `docs/ORIGINAL_CANOPI_WORKSPACE.jsx`, cek SHA.
2. Pin frontend Rust/Tauri/Bun/Node toolchain yang kompatibel; buat lockfile dan test baseline.
3. Clone upstream OMP pinned SHA (fail loudly jika tidak dapat), audit release build recipe termasuk packages/natives.
4. Jalankan build frontend dan `cargo check`/`cargo test` di Windows runner. Tulis source errors dan perbaiki minimal.
5. Render UI dari **source JSX** lalu screenshot golden baselines. Tidak ada layout redesign.
6. Buat `AUDIT_V0_1.md` yang menghubungkan D-01..D-18 dengan file dan changed lines.

**Exit:** React build lulus, Rust compile lulus, upstream pinned tersedia, golden screenshot tersimpan. Jika belum, status `M0 BLOCKED`, bukan lanjut mengklaim functioning runtime.

## Milestone M1. Fix process + real RPC

1. Ubah bundling resource path agar cocok dengan engine resolved installed path; tulis automated test yang menjalankan `runtime_info` **di installed build**.
2. Implement `ready` handshake + v2 protocol negotiation, chunk decode, request correlation, bounded stderr logs, gracefully closing session.
3. Pisahkan per-session runtime status dan generation. Implement session ownership/lock.
4. Patch `open_session`/`new_session` launch flow berdasarkan actual RPC semantics pinned, termasuk sessionDir yang valid, resume dan get_state.
5. Capture sanitized recorded RPC fixture dari engine nyata. Tes unit parser dan replay events berdasarkan fixture.
6. Run one real prompt to test provider path, record elapsed/status. Tidak perlu mempublikasikan API key dalam artifacts.

**Exit:** `runtime_info`, `rpc_start`, `get_state`, prompt admission, streamed result, `prompt_result`, `session_settled`, close/reconnect lulus dengan engine pinned.

## Milestone M2. UI React parity dan state fidelity

1. Pertahankan CSS dan struktur JSX. Pisah React components **hanya** setelah screenshot diff aman.
2. Sambungkan native Open Project, session creation, reopen, per-project tree, model/effort select, command list.
3. Live stream tool/message events; handle duplicated/reordered frames dan history paging.
4. Kanban dari OMP TODO, coalesced invalidate/refetch, stale/offline state dan blocked reason.
5. Worker inspector actual roster, parent tree lines, transcripts, steering/cancel.
6. Extension UI approvals/notify/dialogs, no silent bypass.
7. Test focus, keyboard, accessibility dan responsive screenshots golden.

**Exit:** real conversation ↔ TODO ↔ workers sinkron, tanpa fake data, no visual regression yang tidak disetujui.

## Milestone M3. Native capability completion

1. Implement WebView2 native browser manager di Windows, profile per agent, ownership dan browser tool control bridge.
2. Implement terminal ConPTY native, working shell, terminal output, commands dan split/collapse/resizing.
3. Implement logs, crash recovery, per-agent browser suspend/restart, shell process lifecycle.
4. Audit OMP feature parity berdasarkan command catalog runtime, dokumentasikan unsupported dan root cause; jangan menambah UX panel baru tanpa perlu.
5. Uji extension/MCP/skills/rules provider configs sesuai runtime real behavior.

**Exit:** browser automation dan PTY keduanya berjalan nyata di Windows test harness dan dapat dipakai di area JSX yang sudah disetujui.

## Milestone M4. Fork/rebrand `cnp` (dapat berjalan paralel setelah M1 sehat)

1. Buat fork sumber OMP dari pinned SHA dengan patch series minimal dan documented reason.
2. Audit CLI entrypoint, executable name, telemetry/title, config path, env resolution, docs dan build scripts.
3. Rebrand executable internal ke `cnp-engine`; CLI alias `cnp` opsional. Jangan merusak RPC wire protocol.
4. Build fork engine untuk Windows target. Run `cnp-engine --version` dan `--mode rpc-ui` handshake.
5. Tes parity source fork vs upstream pinned untuk session, model, tools dan TODO.
6. Build manifest dengan upstream SHA + fork patch hash; license/attribution.

**Exit:** bundled engine berasal dari fork source, bukan rename prebuilt upstream binary, dan tetap lulus runtime contract.

## Milestone M5. Windows installer, uninstall dan lifecycle

1. Set final bundle identifier stabil, productName canoPi, executable Windows, icon/metadata, NSIS per-user config.
2. Embed cnp-engine fork binary, fonts/assets dan notices pada package. Verify resource resolution di installed path.
3. Implement startup engine readiness dan per-user storage manifest.
4. Implement NSIS `PREUNINSTALL`/`POSTUNINSTALL` hook dan helper jika diperlukan untuk dialog Keep/Delete; install/upgrade/rollback safety.
5. Jalankan WU01..WU12 di Windows VM, termasuk OMP global installed control group dengan 9Router original settings.
6. Build, install, launch, send actual test prompt, close, resume, uninstall; capture logs/artifact/registry snapshots.
7. Produce NSIS setup.exe, source ZIP, SHA256SUMS, build manifest, release test report.

**Exit:** real Windows setup file lolos install-run-uninstall matrix. Baru boleh menyebut `canoPi Windows v1 release candidate` jika M1-M5 P0 beres.

## Milestone M6. OS build expansion (sesudah Windows P0, dapat dikerjakan paralel)

1. Audit fork engine build targets (macOS arm64/x64, Linux x64) dan native deps.
2. Implement platform PTY and browser adapters tanpa merubah UI.
3. Generate `.app/.dmg`, `.deb/.rpm`, optional AppImage dengan identity per OS.
4. Implement Prepare to Uninstall/cleanup native OS-specific; jangan menjanjikan automatic prompt pada app deletion/package remove yang tidak mendukung itu.
5. Test native install-launch-provider-session-browser-terminal-data keep-delete-uninstall di OS VM/hardware target.
6. Tandai status tiap OS sebagai stable/beta/blocked sesuai hasil tes.

**Exit:** hanya OS yang lolos matrix ditulis `Supported`.

## Milestone M7. Migration v2

Implement wizard, compatibility scanner, import diff/backup/rollback dan migration E2E sesuai bab 10. **Tidak menghambat M5 Windows usable release.**

---

# 13. Tests dan acceptance requirements

## 13.1 Test layers yang harus berbeda secara eksplisit

| Level | Teknologi/pendekatan | Tidak boleh disalahartikan sebagai |
|---|---|---|
| Static checks | Hash original JSX, source lint, schema existence | Aplikasi berjalan |
| Unit tests | Rust parser/allowlist, reducers, manifest path guards, status mapping | Real OMP connected |
| Contract tests | Pinned RPC fixture dengan request/response/event IDs | Provider/model nyata |
| Integration tests | Spawn engine fork, actual RPC handshake dan session operations | Installer Windows siap |
| UI E2E | Playwright/WebDriver/Tauri WebDriver bila feasible, navigasi dan screenshot | Native browser agent tool parity |
| Native subsystem E2E | WebView2 real surface, ConPTY shell, process lifecycle | Semua platform berhasil |
| Install/uninstall E2E | Windows VM clean, Installed Apps, Start Menu, uninstall choices | macOS/Linux compatibility |
| Platform release tests | macOS/Linux nyata/VM target | Universal `.exe` |

## 13.2 Acceptance checklist v1 Windows

| ID | Keputusan PASS yang bisa dibuktikan | Evidence wajib |
|---|---|---|
| A-001 | JSX asli dipertahankan dalam source history dan diff visual disetujui | SHA, golden screenshots, changed lines |
| A-002 | Logo Pi Canopy benar, Crimson/Plus Jakarta/IBM Plex lokal tersedia offline | Screenshot+font load check |
| A-003 | App muncul sebagai canoPi di Installed Apps dan Start Menu | VM screenshot/registry query |
| A-004 | Fresh install tidak memerlukan `omp`, Bun, Rust, Node.js global | VM yang belum pernah install OMP |
| A-005 | `cnp-engine` berasal dari fork source pinned | Build recipe, commit, patch hash, binary manifest |
| A-006 | Installed binary engine path cocok resource map | File path check inside installed app |
| A-007 | Handshake `ready` dan negotiate v2 serta parser chunk valid | Raw sanitized RPC fixture + integration test |
| A-008 | User membuka real project folder dan memulai session pada root yang dipilih | Native dialog + cwd assertion |
| A-009 | User memilih provider/model (9Router bila dikonfigurasi) dan mendapat real model reply | Redacted provider test log |
| A-010 | Streaming transcript tidak duplicate/truncate dan final settles | Recorded message-event trace |
| A-011 | TODO berubah dalam agent dan board session sama ikut berubah | Screenshot before/after+state trace |
| A-012 | Session A/B tidak membocorkan TODO, workers atau transcript | Multi-session integration test |
| A-013 | Reopen app mengembalikan session, history, TODO dari runtime | Quit/reopen fixture |
| A-014 | Subagent muncul sesuai parent dan inspector menampilkan state/transcript real | Spawn/steer/cancel evidence |
| A-015 | Extension approval punya confirm/reject, cancel dan no silent auto-approval | Host RPC UI fixture + manual test |
| A-016 | Browser agent A berbeda cookie dari B, dan agent tool dapat click/type/screenshot nyata | Native browser E2E |
| A-017 | Terminal membuka shell OS nyata; resize/Ctrl+C/exit bekerja | ConPTY log + terminal screenshot |
| A-018 | Settings/model changes tersimpan aman, secret tidak ada di renderer logs | Audit storage+redaction test |
| A-019 | Windows setup EXE valid PE, install + runtime smoke test PASS | Windows CI artifact+VM log |
| A-020 | Windows uninstall Keep data & reinstall restores data | WU01+WU10 logs |
| A-021 | Windows uninstall Delete hanya menghapus canoPi app-owned roots | WU02+WU04+WU09+WU12 logs |
| A-022 | Tidak meninggalkan orphan process/shortcut/registry install entry setelah uninstall | Process/registry/file snapshots |
| A-023 | Installed OMP/9Router global tidak diubah dalam seluruh install/update/uninstall tests | Before/after file hashes and path checks |
| A-024 | Build metadata, license, notices, version, changelog dan source ZIP tersedia | Verified release artifacts |
| A-025 | No GitHub Projects, no `/share`, no Electron, no external Chrome | Source/bundle/process audit |
| A-026 | Dark/light desktop screenshot sesuai layout terkunci, responsive tidak overlap | Golden diff report |
| A-027 | User-facing error saat provider offline/runtime missing tidak memalsukan keberhasilan | Failure injection screenshots |
| A-028 | Auto-update tidak mengubah engine secara bebas, upgrade menjaga session | Upgrade VM scenario |

**Release blocking:** A-003 sampai A-023 serta A-025/A-026/A-027 adalah P0 untuk klaim "full Windows app". Jika browser/PTY native belum dapat diwujudkan dalam batas waktu, rilis dapat disebut *technical preview* dengan keterbatasan eksplisit, **bukan v1 full native finished**. Tidak ada bypass sepihak atas batasan tanpa persetujuan pengguna.

## 13.3 Test matrix tambahan edge cases

- No network sebelum login dan selama streaming.
- Tool result stdout mengandung Unicode, escaped newline, large data >1 MiB, multiple chunks dan corrupted chunk.
- Runtime exits while `extension_ui_request` pending; dialog harus close/reject dengan aman.
- `get_messages_page` stale cursor, busy session, partial history; jangan kehilangan atau menggandakan pesan.
- Context compaction / branch / fork saat session aktif.
- TODO empty, duplicate text, phase rename/reorder, blocked without blocker, abandoned status, worker completion not implying TODO completion.
- Simultaneous worker outputs, model change while idle/busy, abort prompt and cancellation semantics.
- Provider setup without key, invalid key, 429/rate limit, unexpected upstream command unsupported.
- Project folder deleted/moved/permission denied; UI tidak crash dan recent item bisa diperbaiki.
- Windows path spaces, non-ASCII usernames, UNC path constraints, long path behavior, readonly project, symlink/junction escapes.
- Installer upgrade over app running, uninstall while engine active, silent package removal.
- OS user account switching and per-user data ownership boundaries.
- Uninstall data Keep/Delete with OMP installed and 9Router configured; diff saved before/after.
- Linux/macOS app bundle removed outside app, then manual cleanup path correct.

## 13.4 Evidence standard

Setiap acceptance wajib dilengkapi minimal test ID, OS build number/architecture, commit SHA, command yang dijalankan, expected vs observed, PASS/FAIL/BLOCKED, path sanitized artifacts/log dan timestamp. Bila tes hanya statis, tulis *static*, jangan tulis `integration passed`. Bila `.exe` tersedia, hitung SHA256 dan periksa format file plus jalankan VM smoke test. PE header saja **tidak** membuktikan app berjalan.

---

# 14. CI/CD dan artifact delivery yang tidak boleh dilanggar

## 14.1 Workflow Windows

**Stage 1**, audit/pin upstream:

- Checkout repo canoPi dan source fork OMP pada exact pinned SHA, verify `git rev-parse HEAD`, tag correspondence jika menggunakan release tag.
- Apply tracked patch series for `cnp` fork; record patch diff hash dan LICENSE inventory.
- Install pinned Bun + Rust MSVC toolchain + required native build dependencies; build fork engine, run `--version`, `--mode rpc-ui` handshake fixture.

**Stage 2**, build desktop:

- `npm ci`/equivalent dengan lockfile, TS/typecheck/lint/tests, React build.
- `cargo test`/check, build Tauri Windows NSIS with bundled `cnp-engine` produced by Stage 1.
- Verify embedded resource path after installer extraction/install, not only source config.

**Stage 3**, Windows install-run-uninstall:

- Use Windows runner/VM with test user account and known clean data baseline.
- Execute silent or GUI setup path as appropriate, verify Installed Apps/shortcut/real launch, model RPC test with safe test credentials if available.
- Run WU01/WU02 destructive tests only against disposable profile/VM with synthetic data. Never test user real data on CI.
- Run upgrade/reinstall test, process orphan checks, verify source OMP global fixture unchanged.

**Stage 4**, publish:

- Upload `canopi-source-<version>.zip`, real `canopi-windows-x64-setup-<version>.exe`, `SHA256SUMS.txt`, `BUILD-MANIFEST.json`, `RELEASE_TEST_REPORT.md`, license/notice manifest.
- If code signing not configured, explicitly label unsigned. Do not assert SmartScreen bypass.
- If any P0 test fails, mark build as failed/not release-ready; attach failure logs and source artifact but do not silently publish RC.

## 14.2 Conditional blockers dan fallback

| Blocker | Upaya rasional | Deliverable yang boleh diklaim |
|---|---|---|
| GitHub source clone blocked | GitHub release archive, approved mirror, retry in Windows CI, checksum verification | Source scaffold dan blocker report sampai exact upstream verified |
| No Bun/Rust local | Windows GitHub Actions / disposable Windows build VM | Workflow + source; tidak ada fake `.exe` |
| Engine fork compile breaks | Fix pinned patch/toolchain against source, preserve failure log | No release-ready engine until PASS |
| RPC semantik berbeda | Compare pinned docs and actual event recordings, update adapter | No claimed live sync until roundtrip passes |
| Native WebView2 automation not feasible | Prototype isolated adapter + Windows-specific test; report technical finding before alternative | Do not silently fall back to external Chrome |
| ConPTY blocked | Test compatible PTY crates/Windows APIs, record blocker | Disabled with reason; not full v1 claim |
| Signing unavailable | Produce tested unsigned preview with warning label | No "verified publisher" claim |
| macOS/Linux runner absent | Deferred platform support; keep source build config ready | No cross-platform ready claim |
| Uninstall cleanup fails | Preserve data on failure, report exact leftover categories, fix hook/helper | No "clean uninstall" claim |

**Resourcing judgment:** prioritas tinggi adalah *working vertical slice* dibanding menyentuh banyak fitur dengan status setengah jadi. Fork engine dan installer awal harus dibuktikan sebelum kerja kosmetik lanjutan. Browser automation adalah risiko teknis besar; buat feasibility spike seawal mungkin agar tidak mengetahui blocker setelah seluruh UI selesai.

---

# 15. Deliverables dan Definition of Done

## 15.1 Output wajib untuk tiap eksekusi implementasi

1. **Source ZIP nyata**, dapat diekstrak, berisi React JSX dari source pengguna, Tauri/Rust, pinned upstream fork recipe dan patch series, lockfiles, tests, README, PRD/release report.
2. **Build evidence** dari commands yang benar-benar dijalankan, termasuk yang FAIL/BLOCKED; bukan hanya ringkasan naratif.
3. **Windows setup `.exe` asli** jika Windows CI/native build dan VM acceptance berhasil. Berikan link artifact unduh nyata, bukan path internal atau `.exe` kosong/dummy.
4. **Release test report** dengan matriks acceptance A-001..A-028, status per feature dan OS, screenshot UI dari aplikasi aktual.
5. **Uninstall report** hasil WU01..WU12 untuk Windows, terutama default Keep dan opt-in Delete yang aman.
6. **Provenance manifest** yang memuat version app, SHA upstream OMP, SHA fork/patch, SHA binary, toolchain dan license notices.
7. **Delta report** mengidentifikasi semua perubahan visual yang benar-benar diperlukan dan bukti referensi terhadap `canopi-workspace.jsx`.
8. **Per-platform package** lain hanya jika build+test native OS itu berhasil. Jangan mengubah Windows `.exe` menjadi file dengan extension `.dmg` atau `.deb` tanpa builder yang sesuai.

## 15.2 Yang tidak dihitung sebagai selesai

- Static tests 10/10 saja.
- React JSX parse PASS tanpa desktop build.
- `.exe` berheader PE tetapi gagal launch.
- ZIP berisi source tanpa engine fork binary, lalu ditulis "bundled runtime done".
- Rename binary OMP jadi `cnp-engine` tanpa source fork patch/build, lalu mengklaim internals telah berubah.
- Kanban di-render dari fake seed atau cache yang tidak terhubung ke session yang sama.
- Browser mock HTML, iframe statis, screenshot palsu, atau Chrome eksternal sebagai substitusi tanpa izin.
- Terminal dengan fake PowerShell/git output.
- UI re-design baru yang melanggar layout JSX locked.
- Uninstall default menghapus sessions/secrets tanpa izin.
- macOS/Linux disebut supported hanya karena kode dapat dikompilasi secara teoritis.

## 15.3 Definition of Done v1 Windows

Release boleh disebut **canoPi Desktop v1 untuk Windows** jika seluruh P0 di bab 13 PASS, user dapat melakukan workflow nyata dari install, memilih folder, menghubungkan provider, mengirim prompt, streaming, memantau worker dan TODO, memakai native terminal/browser, keluar, lanjut session, dan uninstall dengan pilihan Keep/Delete yang aman. Semua tanpa menginstal OMP terpisah dan tanpa mengubah profil OMP yang sudah ada.

Setelah itu, milestone v2 migrasi dan dukungan lifecycle penuh platform lain boleh dipercepat berdasarkan demand dan hasil kompatibilitas. Jangan membiarkan fitur migrasi menahan aplikasi inti berbulan-bulan.

---

# 16. Execution handoff untuk sesi implementasi berikutnya

**Instruksi utama:** Buka `CANOPI_DESKTOP_PRD_V3_IMPLEMENTATION.md`, dua ZIP v0.1 identik (pilih salah satu), dan `canopi-workspace.jsx`. Jangan membuat PRD lagi apabila user menyuruh eksekusi. Kerjakan source nyata mulai M0, lalu lanjut berurutan melewati gate. Simpan original JSX immutable dan jangan mengganti layout. Fokus satu hasil yang bisa diverifikasi daripada banyak status "implemented" tanpa run.

**Urutan tugas pertama yang tidak ambigu:**

```text
1. Verify input hashes and extract canoPi v0.1 source.
2. Checkout exact pinned OMP commit 2a2c6dc... and capture source/build manifests.
3. Reproduce npm/React build and cargo check on Windows runner.
4. Fix packaged resource path D-01, launch env/config D-03 and RPC readiness D-04.
5. Run live ready -> negotiate v2 -> new/open session -> get_state -> prompt -> streamed response.
6. Replace source/test assumptions with actual event fixtures, fix TODO sync.
7. Build fork patch series + cnp-engine and verify no global omp dependency.
8. Implement native browser and PTY slices with tests.
9. Add NSIS registered install/uninstall wizard Keep/Delete, data manifest and WU tests.
10. Produce artifacts, test report and only claim platforms/tests that actually pass.
```

**Completion report convention:** untuk setiap milestone catat `PASS`, `PARTIAL`, `BLOCKED`, atau `FAIL`, bukan hanya `DONE`. Status harus menyebut file yang berubah, test command, test output summary, artifact path yang verified dan known gaps.

**Satu hal yang tak boleh ditafsirkan ulang:** permintaan pengguna adalah membuat **canoPi** sebagai aplikasi GUI standalone yang sudah memiliki runtime fork `cnp` dan lifecycle OS normal, bukan installer GUI yang diam-diam memanggil OMP global. Tetapi format protokol dan komponen upstream yang tidak terlihat pengguna **tidak perlu** diganti jika perubahan itu justru meningkatkan risiko regresi.

---

# 17. Asumsi kritis, risiko, dan keputusan yang dapat direvisi dengan bukti

| Asumsi | Status | Mengapa penting | Cara membuktikan/mengubah keputusan |
|---|---|---|---|
| Fork OMP v18.6.1 dapat dibuild sebagai native `cnp-engine` di Windows tanpa Bun global pada end-user | Belum dibuktikan oleh ZIP v0.1 | Jika gagal, packaging one-product tidak siap | Checkout source + build engine di Windows CI + installed runtime smoke |
| RPC `rpc-ui` cukup untuk workflow utama chat/model/TODO/worker | Didukung docs, belum diuji end-to-end di canoPi | Jika salah, adapter harus berubah atau source fork menambah API | Contract test dari binary pinned, event fixtures dan real session |
| Per-agent WebView2 dapat dikontrol via native adapter tanpa external Chrome | Belum dibuktikan | Risiko terbesar untuk full browser parity | Small standalone browser automation spike sebelum implementasi besar |
| NSIS hooks cukup untuk aman implement dialog uninstall dan scoped data deletion | Hook didokumentasikan, UX/custom logic perlu test | Berhubungan langsung dengan keamanan data pengguna | Build NSIS custom hook di VM, WU01..WU12, security review |
| 9Router dapat dikonfigurasi dalam isolated canoPi profile dengan model OMP pinned | Belum diuji pada fork | Jika gagal, pengguna tidak bisa memakai model favorit tanpa OMP global | Config path audit + provider health test + real prompt |

**Risiko utama paling mungkin:** terlalu banyak fitur teknis (native agent browser, rich extension UI, cross-platform installer) dikerjakan sekaligus sebelum satu session benar-benar berjalan. **Mitigasi:** strict milestones dan release gates, source fork minimal, integration test sejak awal, serta hindari scope creep migrasi v2.

**Biaya tersembunyi:** build multi-OS dan maintenance patch fork OMP, Windows signing/SmartScreen reputation, Apple signing/notarization, code signing credentials/CI security, legal notice compliance, remote model/API usage untuk smoke, VM test environments dan maintenance engine compatibility. Tidak ada angka biaya yang ditetapkan tanpa riset harga/akses tool konkret.

**Pilihan lawan yang masuk akal:** cukup bundle binary upstream dan gunakan RPC, tanpa fork, supaya maintenance lebih ringan. Secara engineering itu valid untuk MVP, tetapi tidak memenuhi keputusan pengguna saat ini untuk memiliki namespace `cnp` dan engine source fork. Karena itu pendekatan tersebut boleh dipakai **hanya sebagai development spike**, bukan dibranding seolah release final `cnp` berbasis fork.

---

# 18. Sumber dan batas verifikasi

**Dokumen primer terverifikasi saat PRD dibuat:**

- OMP pinned version source commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, 4 Oktober 2026: https://github.com/can1357/oh-my-pi/commit/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60
- OMP RPC reference pada commit pinned, `ready`, `negotiate_protocol`, `rpc_chunk`, `open_session`, `get_state`, `get_subagents`, `get_messages_page`, prompt semantics: https://raw.githubusercontent.com/can1357/oh-my-pi/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/rpc.md
- Tauri Windows installer, NSIS per-user mode, `installerHooks` untuk install/uninstall, WebView2: https://v2.tauri.app/distribute/windows-installer/
- Tauri additional resources path preservation/mapping: https://v2.tauri.app/develop/resources/
- Tauri embedding external sidecar: https://v2.tauri.app/develop/sidecar/
- Tauri macOS application bundle: https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri Debian package: https://v2.tauri.app/distribute/debian/
- Tauri RPM package: https://v2.tauri.app/distribute/rpm/
- Tauri AppImage: https://v2.tauri.app/distribute/appimage/
- OMP environment/config source references: https://github.com/can1357/oh-my-pi/blob/main/docs/environment-variables.md ; https://github.com/can1357/oh-my-pi/blob/main/docs/lsp-config.md

**Sumber lokal diaudit:** `canoPi-desktop-source-v0.1.zip`, `canopi-workspace.jsx`, `CANOPI_TAURI_OMP_PRD_2026-10-11.md`, `CANOPI_DESKTOP_PRD_V2.md` dan `canoPi-static-test-results.txt`.

**Batas audit:** dokumen ini menganalisis ZIP source yang diunggah dan dokumentasi web, serta menjalankan 10 static unit/source tests. **Belum** ada clone/build fork, Rust compile pada OS target, canoPi-to-OMP RPC integrated roundtrip, ataupun pengujian installer/uninstall. Rencana yang sangat rinci tidak boleh dianggap bukti bahwa fitur telah selesai.
