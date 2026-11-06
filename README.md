```text
██╗   ██╗██╗██╗   ██╗██╗██████╗  ██████╗ ██████╗ ██████╗ ███████╗
██║   ██║██║██║   ██║██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║   ██║██║██║   ██║██║██║  ██║██║     ██║   ██║██║  ██║█████╗
╚██╗ ██╔╝██║╚██╗ ██╔╝██║██║  ██║██║     ██║   ██║██║  ██║██╔══╝
 ╚████╔╝ ██║ ╚████╔╝ ██║██████╔╝╚██████╗╚██████╔╝██████╔╝███████╗
  ╚═══╝  ╚═╝  ╚═══╝  ╚═╝╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
```

**A futuristic neon vibe-coding CLI built specifically for [9Router](https://9router.com) models.**

VividCode auto-links your 9Router gateway, imports the free/coding models you care about, gives you a neon model selector, and drops you into a repo-aware coding agent — all from one `.bat` file.

[![Node](https://img.shields.io/badge/node-%3E%3D18-00F0FF?style=flat-square)](https://nodejs.org)
[![9Router](https://img.shields.io/badge/9router-native-FF2BD6?style=flat-square)](https://9router.com)
[![License](https://img.shields.io/badge/license-MIT-8B5CFF?style=flat-square)](LICENSE)
[![Zero deps](https://img.shields.io/badge/dependencies-0-7CFF6B?style=flat-square)](#)

---

## ⚡ What it does

- **Automatic 9Router setup** — finds (or launches) the local 9Router engine and reuses/creates an API key.
- **Model import** — resolves and pins three requests out of the box:
  - **Beam 1.0 Free** from **Kilo** → `kc/reflection/beam-free`
  - **DeepSeek V4.1 Flash** from **OpenCode Free** → `oc/deepseek-v4.1-flash-free`
  - **Beam 1.0** from **Cline** → `vividcline/reflection/beam-1.0-501b-a23b`
- **Cline auto-import** — reads your local Cline session, creates a `vividcline` provider node in 9Router (a unique prefix so it never collides with 9Router's built-in `cline` alias), and validates the connection. If the session is stale it tells you exactly how to refresh it.
- **Neon model selector** — arrow-key navigation, fuzzy search, FREE/TOOLS badges, context sizes.
- **Repo-aware agent** — reads, searches, writes files, and runs commands with confirmation.
- **Streaming UI** — truecolor neon banners, gradients, spinners, tool cards.
- **Zero npm dependencies** — pure Node.js. The `.bat` just works.

---

## 🚀 Quick start (Windows)

1. Install **Node.js 18+**.
2. Install 9Router if you have not already:

   ```powershell
   npm install -g 9router
   ```

3. Double-click **`VividCode.bat`** (or run it from a terminal).

That is it. VividCode starts 9Router if needed, imports the models, and opens the selector.

```bat
VividCode.bat
VividCode.bat --setup
VividCode.bat "build me a neon landing page"
```

### Any platform

```bash
git clone https://github.com/ahpah-dev/vividcode.git
cd vividcode
node bin/vividcode.js
```

Or, once installed globally:

```bash
npm install -g .
vividcode
```

---

## 🖥️ The selector

```text
  ◈ SELECT YOUR MODEL  ·  9router model gateway

  ⌕ type to filter  ·  ↑↓ move  ·  enter select  ·  esc cancel

  IMPORTED FROM YOUR TOOLCHAIN
  ▸ kc/reflection/beam-free          Kilo · Beam 1.0 Free      200K  FREE TOOLS
    oc/deepseek-v4.1-flash-free      OpenCode Free · DeepSeek   200K  FREE TOOLS
  ALL 9ROUTER MODELS  ·  61
    kgw/kilo-auto/free               kgw                        FREE
    nvidia/deepseek-ai/deepseek-v4-pro                          TOOLS THINK
    …
```

Type to filter, arrow keys to move, `enter` to select. VividCode remembers your choice in `%APPDATA%\VividCode\config.json`.

---

## 🧠 Vibe coding agent

VividCode streams responses and can use native OpenAI tool calls:

| Tool | What it does | Confirmation |
| --- | --- | --- |
| `list_files` | Explore the workspace | automatic |
| `read_file` | Read a text file | automatic |
| `search_files` | Regex search across files | automatic |
| `write_file` | Create or replace a file | **yes** (unless `--yolo`) |
| `run_command` | Run a shell command | **yes** (unless `--yolo`) |

If a model rejects native tools, VividCode falls back to a fenced `vividcode-tool` JSON protocol automatically.

Mention files inline to load them into context:

```text
  ◈ vivid [beam-free] ▸ refactor @src/main.js and @src/ui.js into modules
```

---

## 🕹️ Commands

| Command | Action |
| --- | --- |
| `/model` | Open the neon model selector |
| `/models [query]` | List models from the gateway |
| `/setup` | Re-run 9Router auto-setup |
| `/import` | Re-import Cline + models |
| `/status` | Show endpoint, key, model, mode |
| `/files [path]` | List workspace files |
| `/add <path>` | Add a file to session context |
| `/apply <path>` | Write the last code block to a file |
| `/run <cmd>` | Run a shell command (confirmed) |
| `/new` | Start a fresh conversation |
| `/clear` | Clear the screen |
| `/tools` | Toggle native tool calling |
| `/think` | Toggle reasoning stream |
| `/yolo` | Toggle auto-approve |
| `/exit` | Leave the vibe |

---

## ⚙️ CLI flags

```text
vividcode [prompt] [options]

--setup             run 9Router auto-setup and exit
--doctor            print a diagnostic report
--models            list 9Router models
--model <id>        start with a specific model
--cwd <path>        workspace directory for the agent
--url <base>        override the 9Router base URL
--key <key>         override the 9Router API key
--no-start          do not auto-start 9Router
--no-cline          skip automatic Cline import
--tools             force native tool calling on
--no-tools          disable native tool calling
--yolo              auto-approve writes and commands
--think             stream reasoning when available
--fast              disable launch animations
--version           print version
--help              show help
```

Examples:

```bash
vividcode
vividcode "build me a neon portfolio"
vividcode --cwd C:\dev\my-project
vividcode --model oc/deepseek-v4.1-flash-free "explain this repo"
vividcode --setup
vividcode --doctor
vividcode --models
```

---

## 🔌 How the auto-setup works

1. **Health check** — probes `http://localhost:20128/v1`.
2. **Auto-start** — if local and offline, spawns `9router --no-browser` and waits for the handshake.
3. **API key** — reuses `NINE_ROUTER_API_KEY`, an existing 9Router key, or creates a `VividCode` key through the 9Router CLI bridge.
4. **Model resolution** — pulls the live `/v1/models` catalog and matches:
   - Kilo Beam 1.0 Free
   - OpenCode Free DeepSeek V4.1 Flash
   - Cline Beam 1.0
5. **Cline import** (if needed) —
   - reads `~/.cline/data/secrets.json`
   - refreshes an expired session when possible
   - verifies the session with a tiny chat probe
   - registers `https://api.cline.bot/api/v1` as a custom `vividcline` provider node in 9Router
   - keeps the connection active only while it actually works
6. **Persist** — writes `%APPDATA%\VividCode\config.json` (`~/.config/vividcode/config.json` on Linux/macOS).

### Cline session expired?

That is the one thing VividCode cannot do silently: Cline rotates its own auth. If you see:

```text
▲ Cline session expired — run `cline auth cline`, then /import.
```

Run:

```bash
cline auth cline
```

Then re-launch VividCode (or run `/import`). The Cline provider is added automatically once the session is valid.

---

## 🎛️ Configuration

Config lives at:

- **Windows:** `%APPDATA%\VividCode\config.json`
- **macOS/Linux:** `~/.config/vividcode/config.json`

Environment variables:

| Variable | Meaning |
| --- | --- |
| `NINE_ROUTER_BASE_URL` | 9Router endpoint (default `http://localhost:20128/v1`) |
| `NINE_ROUTER_API_KEY` | API key override |
| `VIVIDCODE_HOME` | Config directory override |
| `VIVIDCODE_FAST` | `1` disables animations |
| `VIVIDCODE_DEBUG` | `1` shows stack traces |

The API key is stored in the config file with best-effort `0600` permissions. Never commit it.

---

## 🛡️ Safety

- File writes and shell commands are **blocked until you confirm**.
- `--yolo` / `/yolo` auto-approves both. Only use it in a workspace you trust.
- The agent is sandboxed to the current working directory; paths outside it are rejected.
- `node_modules`, `.git`, build output, and virtualenvs are hidden from `list_files`/`search_files`.
- The Cline session token is handed to your local 9Router instance and stored in 9Router's own connection database, not in VividCode's config. VividCode deactivates the connection automatically if the token stops working.
- VividCode never logs API keys or tokens. `--doctor` prints masked values only.

---

## 🧪 Doctor

```bash
vividcode --doctor
```

Prints Node version, platform, config path, 9Router binary, data dir, endpoint, key (masked), live model count, selected model, Cline credential state, local catalog hints, and target resolution — no secrets.

---

## 🧱 Project layout

```text
VividCode/
├─ VividCode.bat        # one-click Windows launcher
├─ bin/vividcode.js     # entry point
├─ src/
│  ├─ main.js           # flags, setup report, startup
│  ├─ repl.js           # interactive REPL + slash commands
│  ├─ chat.js           # streaming + agent loop
│  ├─ agent.js          # file/shell tools + system prompt
│  ├─ router.js         # 9Router client, keys, server, models
│  ├─ importer.js       # model resolution + Cline import
│  ├─ selector.js       # neon model selector
│  ├─ config.js         # config load/save
│  └─ ui.js             # truecolor neon UI kit
├─ package.json
└─ README.md
```

---

## 🗺️ Roadmap

- [ ] Inline diff preview before writes
- [ ] Image/vision input
- [ ] Session persistence and `--resume`
- [ ] 9Router combo/fusion model support
- [ ] `/compact` context summarizer
- [ ] Themes (Vaporwave, Matrix, Cyberpunk)

---

## 📜 License

CC0 © 2026 [ahpah-dev](https://github.com/ahpah-dev)

Built for the neon nights and the 9Router gateway.
