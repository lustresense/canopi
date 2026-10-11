# canoPi Desktop
## Product Requirements Document dan Rencana Eksekusi Terjadwal

**Versi dokumen:** 1.0  
**Tanggal:** 11 Oktober 2026  
**Waktu mulai eksekusi yang diminta:** 02.30 WIB (Asia/Jakarta)  
**Status:** Disetujui untuk *attempted implementation*. Keberhasilan build Windows belum diverifikasi.  
**Target OS tahap pertama:** Windows 10/11 x64  
**Input UI yang wajib dipakai:** `canopi-workspace.jsx` (lampiran pengguna, 147 KB, React JSX)  
**Upstream engine:** `https://github.com/can1357/oh-my-pi`  
**Model distribusi:** Satu produk canoPi, satu installer Windows. OMP menjadi engine internal, bukan aplikasi yang harus diinstal terpisah.

---

## 1. Produk dan keputusan yang terkunci

canoPi adalah GUI desktop ringan untuk workflow coding agent OMP. Pengguna memasang dan membuka **canoPi**, memilih folder proyek, lalu menjalankan sesi, mengirim prompt, mengawasi worker/subagent, melihat aktivitas tools, memakai terminal, serta membaca TODO sebagai Kanban. Pengguna tidak perlu membuka antarmuka CLI OMP secara manual.

1. **Tampilan JSX yang diserahkan adalah sumber utama UI**, bukan sekadar referensi gambar. Pertahankan komposisi, proporsi, pola interaksi, hierarki, logo payung, dan identitas visualnya. Jangan menggantinya dengan UI generik, template dashboard, atau desain ulang.
2. UI sudah merupakan **React JSX**. Implementasi berarti memindahkan dan memodularisasi source tersebut menjadi React application yang dapat dibuild di Tauri, kemudian mengganti data simulasi dengan state runtime. Tidak perlu menulis ulang layout dari HTML.
3. Tema default **dark Midnight Sky**, aksen cyan/mist, glassmorphism terkontrol. Light mode dipertahankan. Heading dan pesan pengguna memakai Crimson Text, UI dan jawaban agent memakai Plus Jakarta Sans; terminal memakai IBM Plex Mono. Penggunaan font offline harus dilakukan dengan dependensi/font berlisensi sah saat build.
4. **Satu installer Windows** membawa canoPi serta seluruh komponen engine yang diperlukan. Proses background dan sidecar diperbolehkan, tetapi pengguna tidak memasang OMP sebagai produk terpisah.
5. **Tauri v2, Rust, React/TypeScript, OMP engine**. Tidak memakai Electron, tidak membundel Chrome/Chromium eksternal.
6. Tauri Windows memakai **WebView2 yang berbasis Chromium**. Larangan berlaku untuk executable browser Chromium/Chrome terpisah, bukan engine WebView2 milik OS. Klaim 'tanpa Chromium sama sekali' tidak sesuai dengan arsitektur Windows ini.
7. **TODO OMP menjadi Kanban**. Tidak ada GitHub Projects, issue sync, task database tandingan, atau status sintetis yang mengklaim sebagai runtime.
8. **Setiap agent punya browser surface sendiri**, dengan identitas, profil penyimpanan, dan lifecycle terpisah. Surface milik agent lain tidak bisa diakses lewat ID sembarang.
9. **Satu main agent per session** dengan worker/subagent; UI mempertahankan hubungan parent/child dan kontrol chat/steering per worker. Jangan mengklaim depth restriction sebagai fakta OMP jika runtime bisa membuat hierarchy lain; UI harus menampilkan asal sebenarnya dan hanya mencegah spawn yang ditawarkan dari UI bila kebijakan produk mensyaratkannya.
10. **Tidak ada fitur `/share`** dalam GUI. Fitur OMP lainnya diintegrasikan berdasarkan dukungan nyata, diuji satu per satu. Unsupported features harus ditandai, bukan disimulasikan sebagai produksi.
11. Instalasi OMP Windows yang mungkin sudah dimiliki pengguna **tidak ditimpa, tidak di-uninstall, dan tidak dijadikan prasyarat**.

### Bukan bagian dari slice pertama

Sync cloud, akun canoPi, billing, kolaborasi, GitHub Projects, marketplace, browser Chrome eksternal, remote desktop control, serta publikasi ke app store. Tidak perlu integrasi remote sebelum local single-user benar-benar berfungsi.

---

## 2. Verifikasi input JSX dan aturan migrasi

Lampiran `canopi-workspace.jsx` yang diperiksa berisi:

- React component default `CanoPi`, context React, hook state dan callback, serta component seperti `Topbar`, `Rail`, `ProjectNode`, `SessionNode`, `AgentRow`, `Home`, `Conversation`, `Transcript`, `Composer`, `Inspector`, `InspChat`, `BrowserPanel`, `Board`, `Dock`, `DockPane`, `DrawerLayer`, `PaletteLayer`, `PreviewLayer`.
- CSS besar berada di constant `CSS`. Komponen React menampilkan UI lengkap yang disetujui. Logo payung sudah tertanam sebagai SVG React pada `Logo`.
- `seed()`, `mainReply()`, `shellExec()`, `pageFor()`, `surfaceNav()` serta *preview controls* mensimulasikan agent, shell, TODO, dan browser. **Mereka harus dicopot dari jalur aplikasi produksi**.
- `openFolder()` memakai `<input webkitdirectory>` dan pada desktop harus diganti dialog folder Tauri dengan akses path native.
- `useGsap()` memuat JS dari CDN. Untuk app produksi harus memakai dependensi lokal `gsap`.
- CSS `@import` fonts online tidak menjamin mode offline; bundling harus diperiksa dan lisensi file font dipertahankan.

**Aturan preservation:** Jangan menghapus, menata ulang, atau mengganti posisi komponen utama hanya karena memecah file. Perubahan tampilan yang dibenarkan dalam implementasi runtime hanya status nyata, disabled state, loading state, error state, izin folder, dan dialog yang diperlukan untuk kerja aplikasi.

**Strategi port:** pada commit pertama, pindahkan JSX secara utuh ke `src/app/CanoPi.tsx` (jika migrasi JS ke TS belum lolos, gunakan `.jsx` sementara); buat app mount dan CSS eksternal. Jalankan tes visual pembanding sebelum merombak atau menghilangkan mock. Tahap berikutnya adapter runtime masuk satu per satu. Proses penggantian simulasi harus menjaga API komponen yang ada agar tidak memicu layout regressions.

---

## 3. User journeys dan pengalaman aplikasi

### 3.1 Launch pertama

1. Pengguna membuka canoPi dari shortcut desktop.
2. Tauri menginisialisasi Rust supervisor dan memeriksa bahwa engine internal sudah tersedia serta cocok dengan manifest aplikasi.
3. UI membuka **Home** dengan greeting dinamis dan composer React yang sama seperti JSX.
4. Klik **Open project** membuka native folder picker. User mengizinkan satu folder kerja. UI tidak membaca seluruh disk atau menganggap browser file-picker memberikan filesystem path penuh.
5. User memilih model/provider dari konfigurasi engine yang benar-benar ditemukan. Bila 9Router belum ada dalam profil canoPi, tampilkan setup atau **import dengan persetujuan pengguna**. Tidak ada asumsi key tersedia.
6. User mengirim prompt. canoPi membuat/membuka session RPC dan menampilkan streaming dan tool timeline secara langsung.

### 3.2 Perjalanan session

- Rail kiri menampilkan project, session, main agent, dan worker dengan garis hubungan sebagaimana JSX.
- Chat utama hanya untuk main agent. Inspector membuka chat worker atau browser milik worker yang dipilih.
- Task strip muncul tepat di atas composer; tombol Tasks pada topbar membuka Kanban OMP TODO untuk session yang sama.
- Terminal dock tetap pada posisi dan pola collapse/expand milik JSX, tetapi shell benar-benar dijalankan melalui proses terminal terkelola di Windows bila fitur sudah terintegrasi.
- Session disimpan dan dapat dibuka ulang. UI tidak menampilkan snapshot lama dengan label `live`.

### 3.3 Failure journey

- Engine mati: UI menampilkan disconnected, event streaming dihentikan, draft dan history tidak dibuang; restart engine lalu rehydrate state.
- Credential/model tidak tersedia: tampilkan pesan diagnostik yang actionable tanpa memunculkan secret.
- Browser suatu worker crash: worker lain dan main session tidak otomatis mati.
- TODO update tidak terbaca: board menampilkan last synced time, stale indicator, dan retry. Jangan memasukkan sample tasks diam-diam.

---

## 4. Tech stack

| Lapisan | Teknologi | Fungsi |
|---|---|---|
| Desktop shell | Tauri v2 | Window utama, asset, plugin native, packaging |
| Native core | Rust stable + Tokio + Serde | Child process, async I/O, JSONL RPC, process supervision, policy keamanan |
| UI | React 18+ dan TypeScript, Vite | Migrasi langsung dari JSX existing, SPA full GUI |
| Styling | CSS JSX asli diekstrak menjadi stylesheet + CSS variables | Mengunci visual dan layout canoPi |
| Icons/animation | `lucide-react`, `gsap` lokal | Mempertahankan icon dan motion |
| IPC | Tauri commands/events yang eksplisit dan typed | Bridge state/event Rust ke React |
| OMP runtime | Fork pinned `can1357/oh-my-pi` | Engine agent, provider, tools, extensions, TODO, RPC UI |
| Runtime host | Executable/resource OMP yang dibundel, ditentukan lewat audit build | Tidak perlu instal OMP global. Bun compiled binary hanya dipakai jika terbukti kompatibel |
| Wire protocol | RPC custom JSONL (bukan JSON-RPC 2.0) | Request, response, events, dialogs |
| Native browser | WebView2 Windows per agent | Browser surface, isolated user-data profile per owner |
| Terminal | Windows ConPTY melalui library/native host yang teruji | Real interactive shell, beda dengan OMP tool trace |
| Persistensi | File/session native OMP dan metadata UI lokal | Tidak menduplikasi database TODO |
| Packaging | NSIS Windows setup.exe, source ZIP, opsional portable ZIP | Distribusi single-product |
| QA | Unit test Rust/TS, Vitest, React Testing Library, Playwright/tauri-driver bila tersedia | Protokol, session, UI, interaksi Windows |
| Build Windows | Windows x64 local atau GitHub Actions `windows-2022`/`windows-latest` | Kompilasi dan pengujian EXE nyata |

**Version policy:** Pin commit SHA OMP, package lock, Rust toolchain, dan Tauri major. Jangan mengikuti `main` secara diam-diam. Upstream updates masuk setelah tes kompatibilitas RPC dan regresi UI.

---

## 5. Arsitektur dan ownership

```text
canoPi Windows setup.exe
└── canoPi installation
    ├── canopi.exe                    [Tauri + Rust native core]
    ├── web frontend built assets    [React JSX port]
    ├── OMP engine runtime sidecar    [pinned version]
    ├── application resources
    └── bundled third-party notices

canoPi Main Window (WebView2)
      │ typed allowlisted invoke/listen
      ▼
Rust AppState / RuntimeSupervisor
      ├── SessionRegistry [project id + session id + generation]
      ├── OmpProcess [one owned RPC engine per active session as needed]
      │      stdin  => JSONL commands
      │      stdout <= ready/response/events/ui requests
      │      stderr => redacted diagnostics
      ├── EventRouter [session id, worker id, generation]
      ├── ExtensionUiRouter [request id -> React dialog -> response]
      ├── TodoProjection [same-session state, revision, stale flag]
      ├── BrowserSurfaceManager [session/agent-scoped WebView2]
      └── ConPtyManager [optional shell, separate from tool trace]
```

**Runtime ownership rule:** canoPi hanya menampilkan runtime process yang **dia sendiri** spawn dan kelola. Proses OMP CLI lain di terminal Windows tidak otomatis tergabung. Satu `session_id` tidak boleh dikelola dua owner concurrent tanpa locking.

**Per-process design:** jangan otomatis spawn proses OMP untuk setiap child jika OMP sudah punya subagent lifecycle di dalam process utama. Gunakan event subagent API dan ownership runtime sebenarnya. Pisahkan proses hanya bila arsitektur OMP benar-benar membutuhkan atau ada keuntungan isolasi terukur.

---

## 6. RPC UI contract dan event integrity

Dokumentasi upstream mendefinisikan RPC lewat stdin/stdout JSONL, diawali ready handshake. V1 dibatasi frame 1 MiB; V2 menawarkan chunking. Implementasi Rust harus mencoba `negotiate_protocol` versi 2 jika diiklankan, dan memvalidasi urutan `rpc_chunk`, checksum/length yang disediakan, reassembly maximum, serta full UTF-8 JSON parsing. Jangan menganggap setiap baris stdout adalah pesan chat.

### Wajib untuk vertical slice

| Domain | API/event utama | Output React |
|---|---|---|
| Handshake | `ready`, `negotiate_protocol` | Status engine |
| Session | `new_session`, `open_session`, `get_state`, `get_entries` | Home/session rail, history |
| Chat | `prompt`, `steer`, `follow_up`, `abort`, `prompt_result` | Composer dan streaming |
| Streaming | `agent_start`, `message_update`, `message_end`, `agent_end`, `session_settled` | Transcript + active/settled indicator |
| Model | `get_available_models`, `set_model`, `set_thinking_level` | Picker nyata |
| TODO | `get_state.todoPhases`, runtime TODO events, `set_todos` hanya jika aman | Kanban read-only default |
| Workers | `set_subagent_subscription`, `get_subagents`, `get_subagent_messages`, `steer_subagent`, `cancel_subagent` | Sidebar + inspector + actions |
| Extension UI | `extension_ui_request` dan `extension_ui_response` | Native-feeling dialogs React |
| Commands | `get_available_commands`, `available_commands_update` | Slash command catalog yang dinamis |

`rpc-ui` **bukan aplikasi desktop**. Ini mode komunikasi untuk host GUI. Jalankan plain `--mode rpc-ui` pada runtime internal untuk mendapatkan dialog dan presentation frames yang didukung. Jangan memakai `--no-ui` kalau extension UI dibutuhkan. UI renderer harus mendukung `select`, `confirm`, `input`, `editor`, `ask` (jika tersedia), `cancel`, `notify`, `setStatus`, `setWidget`, `set_editor_text`, `open_url`. `setTitle` dapat memerlukan opt-in; jangan mengasumsikan semua TUI extension UI tersedia lewat RPC.

**Penting:** RPC mematikan beberapa TUI-only features seperti custom component factories, raw terminal input, header/footer/editor kustom, dan TUI autocomplete extension. Untuk canoPi v1, tampilkan fallback atau status unsupported. Jangan diam-diam mengklaim full OMP feature parity sampai adapter lolos audit.

**Output protocol:** Jangan menganggap `agent_end` artinya seluruh async work sudah tuntas. Baca `prompt_result`, `session_settled`, `isSettled`, `hasPendingAsyncWork` sesuai semantik runtime.

**Reliability:** requestId global monoton, pending map, timeout per call, per-session generation ID untuk abaikan late events, bounded event queue, stderr never merged into JSON stdout, cancellation on shutdown, no zombie processes. Reconnect wajib memanggil `get_state` dan refresh snapshot.

---

## 7. TODO OMP menjadi Kanban, tanpa sistem kedua

Status disalin 1:1 dari OMP: `pending`, `in_progress`, `blocked`, `completed`, `abandoned`. Fase dan progres dipertahankan. UI memakai teks **To do, In progress, Blocked, Done, Cancelled** seperti JSX.

- Source of truth: `todoPhases` dari engine session yang sedang dibuka.
- Setelah handshake/switch/restart: panggil `get_state` dan rehydrate.
- Ketika runtime mengubah TODO: invalidate/refetch snapshot jika stream tidak menyediakan snapshot lengkap yang dijamin; terapkan hanya untuk session yang cocok dan revision/generation terbaru.
- Jangan mengambil TODO dari folder kerja secara acak, cache lama, server localhost lain, atau session TUI terpisah.
- `set_todos` mengganti **seluruh list** dan task tidak punya ID permanen. Karena itu default Kanban **read-only**; perubahan dilakukan via main agent. Drag-and-drop status tidak diaktifkan sebelum reconciliation/edit safety selesai.
- Label stale jelas bila proses offline; `live` hanya bila komunikasi healthy dan state sinkron.
- Worker finished **tidak otomatis** berarti task Done. Cancel worker juga **tidak otomatis** berarti task Cancelled.
- Mapping card ke worker adalah metadata UI opsional yang hanya dipakai bila ada evidence runtime atau user binding; jangan diklaim sebagai properti TODO upstream.

**Tes kritis:** request prompt agar OMP menulis TODO, lihat Kanban berubah pada session sama; buka session lain (board berbeda); tutup/restart canoPi dan lanjutkan session; pastikan tidak menampilkan task project sebelumnya. Kasus mismatch screenshot lama harus memiliki tes regresi tersendiri.

---

## 8. Subagent, transcript, dan tools

- Sidebar kiri mempertahankan garis tree project → session → main/child agents dari JSX.
- Worker inspector punya Chat/Browser dan target steering benar; composer utama tidak boleh mengirim ke worker tanpa perubahan target yang eksplisit.
- Subscribe worker progress/events sesuai kemampuan runtime; jangan polling agresif jika event tersedia.
- Tool trace menampilkan jenis aksi, file/argument yang aman, state, outcome. Sensitive stderr, credential, cookies, tokens, OAuth URLs perlu redaction.
- Approval destructive commands harus fail-closed dan membutuhkan UI konfirmasi saat OMP memintanya. Button harus membalas UI request yang tepat, tidak sekadar mengubah kartu React.
- Settings untuk model, role, MCP, skills, memory dipetakan berdasarkan API yang benar-benar tersedia. Jika command belum diekspos RPC, tampilkan `Unavailable in this build` dan tulis adapter issue, bukan toggle palsu.

---

## 9. Browser milik masing-masing agent

Browser pada JSX masih preview React yang merender login/dashboard fiktif. Implementasi desktop harus menggantinya dengan `WebView2` asli yang dibuat melalui Tauri/Rust, bukan `iframe` lintas origin dan bukan CDP ke Chrome eksternal.

**Ownership model:**

`BrowserOwner = { project_id, session_id, agent_id, surface_id, generation }`

- Setiap agent punya user-data-folder unik untuk cookies/storage jika API WebView2 host memungkinkan. Dua window yang memakai profil sama bukan isolasi.
- Browser dibuat **lazy** ketika agent memerlukan browsing atau user membuka inspector, lalu bisa di-suspend/destroy untuk hemat RAM.
- Hanya command browser khusus `open/navigate/click/type/scroll/screenshot/back/forward/close` yang di-allowlist. Validasi owner pada setiap invoke.
- Surface boleh dipindahkan ke window native tersendiri kalau embedded child WebView Tauri tidak mendukung posisi/ukuran yang dibutuhkan. Layout inspector React tetap posisi aslinya; window sebagai fallback yang jujur.
- Tidak boleh memberi halaman pihak ketiga akses Tauri IPC generic. Isolasi origin, permission policy, allowlist navigation, dan lifetime cleanup wajib.
- Browser tool OMP upstream mungkin memakai Chrome/CDP. **Native adapter harus diaudit dan diimplementasikan**, bukan sekadar menampilkan WebView2 yang agent tidak bisa kontrol.
- Smoke tests: dua agent buka origin sama dengan login masing-masing; cookie berbeda; cross-owner action denied; screenshot dari surface yang benar; crash salah satu tidak mematikan lainnya.

**Delivery gate:** bila adapter browser belum siap, tandai `Native browser automation pending` di release notes dan jangan memalsukan real browsing.

---

## 10. Windows shell dan process safety

Terminal dock adalah shell interaktif ConPTY, **bukan** `bash` tool output OMP. Proses shell berada di project working directory yang user pilih. Spawn lewat Rust allowlist dan lifecycle yang terukur. Jangan membuka port localhost atau web-server untuk menjembatani shell kecuali dibutuhkan dan dilindungi.

- Beberapa terminal tabs independen; close tab memunculkan konfirmasi jika shell memiliki foreground process.
- Ctrl+C dan resize terminal harus mencapai ConPTY, bukan hanya menulis teks di React.
- Stream stdout/stderr dengan encoding yang aman dan backpressure; batas buffer dan truncation visible.
- Shell dan agent tools bisa berjalan paralel tetapi kepemilikannya tetap dibedakan.

---

## 11. Security, konfigurasi, dan distribusi

- **Fork/distribusi legal:** OMP berlisensi MIT; pertahankan LICENSE, attribution, dan notices dependencies pihak ketiga. Jangan menganggap semua vendored components otomatis MIT.
- **Tidak membaca secret ke frontend:** konfigurasi 9Router, OAuth, model keys tetap engine/user-scoped. UI hanya menerima redacted status. Pengujian pakai dummy keys.
- **Profile default:** direktori user canoPi terpisah, bukan menimpa profil OMP global. Buat import profile yang reversible dan mencadangkan file konfigurasi dulu jika perlu. Config 9Router yang aktif pada OMP Windows harus tetap utuh.
- **Single product:** UI, shortcut, installer, settings, uninstaller semuanya bertuliskan canoPi. Engine OMP diakui dalam lisensi/about, tidak dipresentasikan sebagai app kedua yang harus di-install.
- **Single installer ≠ single process:** sidecar/extracted resources aman asal semuanya dibawa oleh instalasi. Installer `canoPi-setup.exe` lebih realistis daripada memaksa semua native engines berada di satu binary portable.
- **Update:** untuk prototipe pribadi, manual update dengan manifest pinned. Auto updater/signing baru setelah release pipeline aman. Unsigned EXE dapat menimbulkan peringatan SmartScreen; jangan mengklaim sudah signed.
- **No Chrome external:** build artifact diperiksa agar tidak menyertakan `chrome.exe`, `chromium.exe`, Puppeteer downloaded browser. WebView2 OS dependency tetap berlaku.

---

## 12. Struktur repository target

```text
canopi-desktop/
├── README.md
├── LICENSES/
├── THIRD_PARTY_NOTICES.md
├── package.json
├── bun.lock / package-lock.json (pilih sesuai audit)
├── src/
│   ├── app/CanoPi.tsx                  # source JSX user, dimigrasikan bertahap
│   ├── app/AppProviders.tsx
│   ├── styles/canopi.css               # extracted from const CSS, same visual
│   ├── components/                     # Topbar, Rail, Home, Conversation,
│   │                                   # Composer, Inspector, Board, Dock, modals
│   ├── domain/                         # typed Project/Session/Agent/Todo models
│   ├── runtime/                        # canopiApi and event adapters
│   ├── state/                          # normalized runtime projections
│   └── test/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/                    # explicit allowlisted permissions
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── supervisor.rs
│   │   ├── rpc/{framing,client,events,ui}.rs
│   │   ├── sessions.rs
│   │   ├── todo.rs
│   │   ├── browser.rs
│   │   └── terminal.rs
│   └── binaries/                        # platform sidecar, when built
├── upstream/
│   ├── oh-my-pi/                       # pinned upstream checkout/submodule
│   └── PINNED_COMMIT.txt
├── .github/workflows/build-windows.yml
├── scripts/
│   ├── build-engine-windows.ps1
│   ├── build-canopi-windows.ps1
│   └── smoke-test-windows.ps1
├── docs/
│   ├── RPC_COMPATIBILITY.md
│   ├── JSX_COMPONENT_MAP.md
│   ├── BROWSER_NATIVE_ADAPTER.md
│   └── BUILD_REPORT.md
└── dist/
    ├── canopi-source.zip
    ├── canopi-portable.zip             # only if validated
    └── canopi-setup.exe               # only if real Windows build succeeds
```

Source JSX pengguna harus tetap tersedia di commit awal (mis. `docs/reference/canopi-workspace.original.jsx`) untuk visual diff. Jangan diam-diam mengganti dengan versi HTML asisten sebelumnya.

---

## 13. Urutan eksekusi 02.30 WIB, timeboxed dengan gerbang kelayakan

### Step 0. Environment dan sumber (sebelum menulis fitur)

1. Baca lampiran JSX utuh, catat hash dan komponen yang digunakan.
2. Clone upstream OMP dengan `git clone https://github.com/can1357/oh-my-pi.git` **jika jaringan tersedia**, catat SHA. Bila gagal, cek apakah ada archive/repo checkout terpercaya yang sudah tersedia. Jangan mengarang bahwa cloning berhasil.
3. Periksa versi `node`, `bun`, `rustc`, `cargo`, Windows runner, dan akses network. Log blocker dengan pesan error yang tepat.
4. Periksa dokumentasi RPC / exact package build scripts pinned commit.

### Step 1. Port React source tanpa layout regression

1. Siapkan Vite/React/Tauri scaffold.
2. Salin JSX source sebagai komponen utama; pisahkan CSS tanpa mengubah aturan ukuran/spacing.
3. Replace `loadGsap` CDN with installed `gsap` module, `webkitdirectory` dengan dialog native untuk build Tauri.
4. Pertahankan logo SVG, dark default, home easter eggs, sidebar relationships, Kanban, worker inspector, terminal dock.
5. Frontend build harus lulus. Buat screenshot home/session/board untuk visual diff jika browser tersedia.

### Step 2. Rust <-> OMP RPC first real slice

1. Buat `RuntimeSupervisor` dan spawn bundled/sandbox OMP `--mode rpc-ui`; jangan menggunakan instalasi OMP global tanpa izin.
2. Tunggu `ready`, negosiasikan v2, mulai reader stdout dan stderr secara terpisah.
3. `get_state`, `get_available_models`, `get_available_commands` sukses dan datanya muncul di UI.
4. `new_session`/`open_session`, kirim satu `prompt` nyata dengan provider yang memang tersedia, render response streaming dan `prompt_result`.
5. `extension_ui_request` confirm/select/editor dapat dijawab melalui modal React; pengujian tidak boleh memerlukan API key pribadi pengguna.
6. TODO dari `get_state.todoPhases` ditampilkan read-only pada Board untuk session sama, tanpa seed demo.

### Step 3. Workers, activity dan persistence

1. Subscribe progress/events worker; petakan ke tree sidebar dan inspector.
2. Steering/cancel worker harus memanggil RPC sungguhan, bukan mengubah state lokal.
3. Penyimpanan session memakai OMP; switching, reopen, crash recovery, TODO resync diuji.
4. Activity tools tidak disamakan dengan ConPTY shell.

### Step 4. Native browser dan ConPTY

1. Audit OMP browser implementation dan WebView2 host capabilities.
2. Implement native per-agent surface dan owner checks, dengan fallback window.
3. Bridge agent browser tool action ke native surface jika benar-benar layak.
4. Implement ConPTY shell lifecycle setelah RPC/GUI stabil.

### Step 5. Build Windows dan artifacts

1. Instal dependensi build **di runner Windows terisolasi** (bukan memodifikasi mesin pengguna).
2. Build runtime OMP pinned version, bundle sebagai resources/sidecar.
3. `npm run build`/`bun run build`; `cargo test`; `tauri build` target NSIS Windows x64.
4. Jalankan smoke test terhadap output benar-benar berformat PE executable dan installer berisi engine resources.
5. Buat `canopi-source.zip` dari source, `canopi-setup.exe` yang valid, `build-report.md` berisi commit, versi tool, perintah, hasil. Portable ZIP hanya kalau hasil run terbukti.
6. Jika Windows runner tidak tersedia: **jangan buat EXE palsu atau mengklaim berhasil**. Serahkan ZIP source, workflow build Windows, laporan tepat apa yang memblokir, dan artefak tes yang valid.

### Prioritas jika waktu eksekusi terbatas

P0: source React asli berjalan di Tauri, RPC handshake, satu session, prompt streaming, real TODO board, model picker, ZIP.  
P1: dialogs RPC UI, live worker inspector, persistence, installer EXE via Windows runner.  
P2: native browser per agent dengan automation, ConPTY, full extension parity.  

**Aturan:** Jangan mengorbankan hasil P0 untuk screenshot fiktif atau demo animasi. Keberhasilan P1/P2 tidak boleh dilaporkan sebelum tes nyata.

---

## 14. Acceptance criteria dan minimum test matrix

| ID | Tes | Lulus jika |
|---|---|---|
| A01 | Source fidelity | Component tree sesuai `canopi-workspace.jsx`, logo dan posisi layout tidak berubah |
| A02 | Frontend | Vite build lulus tanpa mock startup crashing |
| A03 | Tauri shell | Window desktop membuka Home native, dark theme default |
| A04 | Engine packaging | Installer membawa OMP runtime; tanpa instal OMP global |
| A05 | RPC | `ready`, negotiate v2, `get_state` response benar |
| A06 | Real prompt | Prompt tampil user -> streaming OMP -> result, bukan fake text |
| A07 | TODO sync | Kanban mengikuti TODO session yang sama, termasuk blocked |
| A08 | Session isolation | Task/project dari session A tidak bocor ke B |
| A09 | Worker routing | Steering child A tidak masuk main/child B |
| A10 | UI extension | Confirm/select dikirim kembali dengan request ID yang sama |
| A11 | Abort/failure | Abort/restart tidak membuang transcript atau membingungkan settled status |
| A12 | Browser isolation | Dua surface profil berbeda, agent owner check, screenshot real |
| A13 | Terminal | Shell ConPTY benar, bukan trace tool atau mock PowerShell |
| A14 | EXE validation | File PE Windows x64, Tauri NSIS build sukses, dapat dibuka di Windows target |
| A15 | Source ZIP | Contains buildable project, reference JSX, PRD, license/notices, README |
| A16 | No fake parity | Setiap fitur unsupported diberi status nyata; tidak ada browser/mock yang dilabeli live |
| A17 | No forbidden integrations | No GitHub Projects, no `/share`, no Electron, no bundled Chrome executable |
| A18 | Profile safe | Existing OMP/9Router config tidak ditimpa; tidak ada secret di frontend logs |

**Blocker taxonomy:** `network`, `toolchain`, `omp_build`, `rpc_compatibility`, `windows_runner`, `browser_adapter`, `tests`, `other`. Setiap blocker menyebut command dan error nyata, bukan perkiraan.

---

## 15. Deliverables dan status kejujuran

Target output pada scheduled run:

- `canopi-source.zip` dengan source React/Tauri/Rust dan referensi JSX asli.
- `canopi-setup.exe` hasil kompilasi native Windows **hanya jika berhasil dibuat dan diverifikasi**.
- `CANOPI_BUILD_REPORT.md` dengan daftar fitur `implemented/tested/blocked`, SHA upstream, toolchain, test matrix, output log penting.
- `CANOPI_IMPLEMENTATION_DELTA.md` yang menjelaskan perubahan source terhadap JSX pengguna.
- Screenshots atau capture setelah menjalankan UI sesungguhnya jika tooling mendukung.

**Jangan mengatakan “selesai”, “native”, “full parity”, atau “EXE bisa dipakai” apabila build/tes Windows nyata belum lolos.** Bila hasilnya baru scaffolding, tulis status scaffolding. Bila baru source ZIP, jelaskan secara eksplisit.

**Risk assessment:** kompleksitas terbesar ada pada packaging OMP native deps, kompatibilitas RPC UI extension, native browser tool bridging, dan Windows CI. Satu iterasi terjadwal mungkin hanya menyelesaikan vertical slice, bukan semua fitur dan installer siap rilis. Desain fitur dan deliverable tetap menjadi target, tetapi status keberhasilan ditentukan oleh tes, bukan waktu.

---

## 16. Fakta terverifikasi dan rujukan

- OMP upstream: <https://github.com/can1357/oh-my-pi>
- RPC official reference: <https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md>
- Tauri Windows installer: <https://v2.tauri.app/distribute/windows-installer/>
- Tauri Windows prerequisites dan WebView2: <https://v2.tauri.app/start/prerequisites/>
- OMP license dan third party notices: <https://github.com/can1357/oh-my-pi/blob/main/README.md>

Semua URL di atas menjadi rujukan audit source dan build, bukan klaim bahwa semua fitur canoPi sudah diimplementasikan.
