# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.6.0] — 2026-03-15

### Added

#### Last-Used Model Persistence
- The node now **remembers the last loaded model** across page refreshes and ComfyUI restarts
- On every execution and model load, the model name is saved to `last_used_model.json`
- When a fresh node is created, it automatically restores the last-used model (with its preset, thumbnail, and metadata) after a short delay
- New helper functions in `nodes.py`: `get_last_used_model()`, `save_last_used_model()`
- New REST endpoints: `GET /cwk/last_model` (returns last model + preset + meta), `POST /cwk/last_model` (persists model name)

#### Image Metadata Drag-and-Drop
- **Drag an image with metadata onto the node** to automatically load the model that generated it
- Supports **ComfyUI workflow metadata** embedded in PNG tEXt chunks — extracts the checkpoint name from `ckpt_name` or `model_name` fields in the prompt JSON
- Supports **A1111-style metadata** — parses `Model: <name>` from EXIF/parameters text and fuzzy-matches it against installed checkpoints
- Uses the new `handleFile` hook on the node to intercept dropped image files

#### Resolution Preset Dropdown
- New **Res Preset** dropdown row on the canvas node with all common resolutions for major model architectures:
  - **SDXL / SD3 / Pony** — 1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9, 9:21, 21:9 (1024px base)
  - **SD 1.5** — 1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9 (512px base)
  - **Flux / Large models** — 1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9 (1024px base)
- Selecting a preset **automatically populates the Width and Height** inline widgets on the node
- Select `(preset)` to use the width/height from the model's saved preset instead
- Resolution presets defined in `nodes.py` as `RESOLUTION_PRESETS` dict and served via `GET /cwk/resolution_presets`
- Frontend fetches the preset list from the server at startup via `_loadResolutionPresets()`

#### Batch Size & LATENT Output
- New **Batch** inline widget on the canvas node (1–64, default 1) — controls the batch size for the empty latent output
- New **LATENT** output pin — the node now generates an empty latent tensor (`torch.zeros([batch, 4, h//8, w//8])`) sized to the current width, height, and batch size
- Node output count increased from 9 to **10** (`MODEL`, `CLIP`, `VAE`, `LATENT`, `steps`, `cfg`, `sampler_name`, `scheduler`, `width`, `height`)
- `batch_size` is an optional input with `(preset)` passthrough — not saved as part of the per-model preset by default

### Changed

- `N_OUTPUTS` constant in frontend updated from 9 to 10 to account for the new LATENT output slot
- `INFO_ROWS` array expanded with three new rows: `res_preset` (index 5), `batch_size` (index 8), and adjusted indices for existing rows
- `_loadModelIntoNode()` helper function extracted to consolidate model loading logic (used by Load Model button, last-model restore, and image drag-and-drop)
- Node `execute()` now calls `save_last_used_model()` on every run

---

## [1.5.0] — 2026-03-14

### Added

#### Sampler / Scheduler Fallback System
- **Alias table** — comprehensive mapping of A1111 and CivitAI display names to ComfyUI internal sampler/scheduler names (e.g. `Euler a` → `euler_ancestral`, `DPM++ 2M Karras` → `dpmpp_2m` + scheduler `karras`, `euler_ancestral_cfg++` → `euler_ancestral_cfg_pp`)
- **Pattern normalisation** — automatic `++` → `_pp` substitution, spaces → underscores, and case folding to catch common mismatches
- **Embedded scheduler extraction** — when a sampler name contains an appended scheduler (A1111 style, e.g. "DPM++ 3M SDE Exponential"), the scheduler is split out and both are resolved independently
- **Fuzzy matching** — `difflib.SequenceMatcher` with substring containment bonus (threshold 0.6) finds the closest installed sampler/scheduler when alias and normalisation fail
- **Safe fallback** — if no match is found at all, falls back to `euler` / `simple` with a console warning
- All resolution steps are logged to the console: alias hits, normalisation fixes, fuzzy matches, and fallback warnings
- New public functions in `nodes.py`: `resolve_sampler()`, `resolve_scheduler()`, `resolve_sampler_scheduler()`
- Fallback is applied both at **execution time** (in the node's `execute()`) and at **preset auto-population time** (in `server.py` when writing presets from CivitAI image metadata)

---

## [1.4.0] — 2026-03-14

### Added

#### Image Metadata Viewer
- **📋 Metadata button** on example images in the Model Info overlay — click to open a detailed popup showing the generation parameters used for that image
- Displays **Positive Prompt** and **Negative Prompt** with a **📋 Copy** button next to each for one-click clipboard copy
- Shows generation parameters in a compact grid: **Sampler**, **Scheduler**, **CFG Scale**, **Steps**, **Clip Skip**, **Seed**, **Size** — fields without data are automatically hidden
- Full styled popup with dark theme matching the rest of the UI

#### Preset Auto-Population from CivitAI Example Images
- When **adding a new model/version** to the manager, the node now fetches generation metadata from CivitAI example images and automatically populates the model's preset with the best available values (sampler, scheduler, CFG, steps, clip skip, resolution)
- The image with the most metadata fields available is chosen automatically
- Preset is auto-saved after population — no manual save step needed
- **Fetch Thumbnails/Infos** button in the Model Browser now also auto-populates presets for all models that have CivitAI example image metadata
- Status bar shows the count of presets auto-populated alongside thumbnail count during fetch

#### Auto-Reload Model List After Fetch
- After SSE fetch completes (both full fetch and new-model-only fetch), the model list is automatically reloaded from the server
- The sidebar preset editor refreshes immediately to show newly populated preset values
- New `_reloadModels()` method on `ModelBrowserPanel` handles the refresh while preserving in-memory civitai data and current selection

### Changed

#### Inline Number Editing (replaces modal popup)
- **Removed** the modal dialog popup for editing numeric values (CFG, Steps, Clip Skip, Width, Height)
- **New inline editor** — clicking the center value of a numeric row now opens a text input positioned exactly over the value cell on the canvas
- Uses a full-screen transparent backdrop to catch outside clicks and commit the value
- Deferred focus (`requestAnimationFrame` + `setTimeout`) to work around LiteGraph's pointer capture stealing focus
- Enter to commit, Escape to cancel, click outside to commit — no OK/Cancel buttons needed
- Shared `_blockCanvasEvents()` helper blocks all pointer/mouse/touch events from propagating to LiteGraph

#### Compact Dropdown Menus
- Dropdown menus for list fields (Sampler, Scheduler, RNG, CLIP, VAE) now render as a **compact listbox** (`<select size=N>`) instead of the browser's native dropdown popup
- Maximum **6 visible items** with scroll — keeps the dropdown short and manageable
- **Smart positioning** — opens below the value cell by default; only flips upward when there isn't enough space below the cell
- Uses `pointerdown` (instead of `mousedown`) for outside-click detection, improving compatibility with LiteGraph's event system
- Click on an option immediately commits the selection (no need for a separate "change" event)

### Fixed

- Fixed dropdown menus requiring a double-click to open due to LiteGraph consuming the first pointer event — now all pointer/mouse/touch/key events are blocked from propagating using a comprehensive `_blockCanvasEvents()` helper
- Fixed inline number input never receiving focus because LiteGraph's pointer capture stole it immediately — resolved by deferring focus with `requestAnimationFrame` + `setTimeout` and using a backdrop element instead of relying on `blur`

---

## [1.3.0] — 2026-03-11

### Changed

#### Fix error when trying to load Diffusion models (Flux/Qwen/Chroma/Z-image...)
- The node now check for model type first then uses either CheckpointLoaderSimple.load_checkpoint() for checkpoints models or comfy.sd.load_diffusion_model() for diffusion models

---

## [1.2.0] — 2026-03-10

### Changed

#### Self-contained RNG subsystem
- **RNG no longer depends on smZNodes** — the node now ships its own self-contained RNG implementation, adapted from [ComfyUI_smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) by shiimizu
- Added three new internal modules:
  - `cwk_rng_shared.py` — self-contained `Options` class using the `smZ_opts` protocol, with all fields smZNodes expects (ensures seamless coexistence if smZNodes is also installed)
  - `cwk_rng_philox.py` — vendored Philox 4×32 NVidia-compatible CPU RNG generator (from smZNodes' `rng_philox.py`)
  - `cwk_rng.py` — full `prepare_noise()` replacement with stack introspection, `TorchHijack`, and k-diffusion `default_noise_sampler` hijacking (adapted from smZNodes' `rng.py`)
- `_apply_rng()` in `nodes.py` simplified: removed the two-strategy approach (try smZNodes → fallback patch); now always uses the self-contained subsystem
- The RNG integration uses the same `smZ_opts` model_options key, so if smZNodes is installed alongside, the two coexist transparently with no conflicts

#### New RNG mode
- Added **nv** (NVidia Philox) as a third RNG option alongside `cpu` and `gpu` — produces identical noise to `torch.randn(..., device='cuda')` but runs on CPU, enabling cross-GPU reproducibility
- `override_rng` input now accepts `cpu`, `gpu`, or `nv`
- Frontend updated: RNG dropdowns on the canvas node and in the Model Browser sidebar now include the `nv` option

---

## [1.1.0] — 2026-03-09

### Added

#### External CLIP & VAE Support
- New **CLIP** and **VAE** dropdown rows on the canvas node — select `embedded` (default) or any external CLIP/VAE model from ComfyUI's `clip`/`vae` folders
- New **CLIP** and **VAE** dropdown selectors in the Model Browser sidebar preset editor
- `clip_name` and `vae_name` saved as part of per-model presets — each model remembers its preferred CLIP and VAE
- CLIP and VAE lists populated dynamically from ComfyUI's folder paths, with `embedded` always first
- Falls back gracefully to the checkpoint's embedded CLIP/VAE if an external file fails to load

#### Node (nodes.py)
- `get_clip_list()` and `get_vae_list()` helper functions for listing available models
- `_load_external_clip()` and `_load_external_vae()` loaders for external model files
- New optional inputs: `override_clip_name` and `override_vae_name` (with `(preset)` sentinel)
- `default_preset()` now includes `clip_name: "embedded"` and `vae_name: "embedded"`

#### Backend (server.py)
- `GET /cwk/clips` — list all available CLIP models (with `embedded` first)
- `GET /cwk/vaes` — list all available VAE models (with `embedded` first)

#### Frontend
- Two new `INFO_ROWS` entries in the canvas node for CLIP and VAE selection
- `_loadClipVaeOptions()` fetches CLIP/VAE lists from `/cwk/clips` and `/cwk/vaes` at startup
- Panel sidebar: new `sb-clip-name` and `sb-vae-name` `<select>` elements with divider
- All preset workflows (Load, Reset, Update, Edit, Save) now include `clip_name` and `vae_name`

---

## [1.0.0] — 2026-03-08

### Initial Release

#### Node
- Custom canvas node (`CWK_ModelPresetManager`) fully drawn with LiteGraph `onDrawForeground`
- Outputs: `MODEL`, `CLIP`, `VAE`, `sampler_name`, `scheduler`, `cfg`, `steps`, `width`, `height`
- Inline editable preset rows: Sampler, Scheduler, CFG, Steps, Clip skip, Width, Height, RNG
- Arrow buttons (`◀ ▶`) for stepping numeric values
- Click-to-type modal dialog for direct numeric input
- Native `<select>` dropdown for list fields (Sampler, Scheduler, RNG)
- Sampler and scheduler lists loaded dynamically from ComfyUI `/object_info` — automatically reflects any installed sampler extensions
- Three action buttons: **📂 Load Model**, **↩ Reset**, **💾 Update Preset**
- Model thumbnail display with cover-fit crop and rounded corners
- Node size auto-calculated; minimum width enforced

#### Preset system
- Presets stored per model in `checkpoint_presets.json`
- Merges stored preset with per-execution widget overrides at runtime
- `clip_skip` applied directly to the CLIP model via `clip.clip_layer()` — no extra node needed
- `rng` (CPU/GPU) applied to the model at load time:
  - Via [smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) `smZ_opts` if installed
  - Falls back to patching `comfy.sample.prepare_noise` directly

#### Model Browser Panel
- Visual card grid with lazy-loaded thumbnails
- Drag to reposition, resize handle for panel size — both persisted in `localStorage`
- Search by model name
- Filter by base model type (SDXL, Illustrious, Pony, NoobAI, Flux, Chroma, Wan, etc.)
- Favorites system with ⭐ toggle and favorites-only filter
- NSFW detection via CivitAI `nsfw_level` with blur + reveal toggle per card
- Video thumbnail support (`.mp4`, `.webm`)
- Right-click context menu per card:
  - Model Info overlay
  - Pick thumbnail from CivitAI image gallery
  - Set local thumbnail from file
  - Check for newer version on CivitAI
  - Refresh CivitAI metadata
  - Delete model and all cached data
- **Fetch Thumbnails/Infos** — SSE streaming fetch from CivitAI with live progress bar
- **↺ Rebuild Cache** — force re-fetch all metadata ignoring local cache
- **🔍 Check Updates** — batch check CivitAI for newer model versions, marks cards with ⬇
- CivitAI API key management with validation button
- Sidebar preset editor with Edit / Save Preset workflow

#### Backend (server.py)
- `GET /cwk/models` — list all checkpoint and diffusion models
- `GET /cwk/preset` — fetch preset for a model
- `POST /cwk/preset` — save preset for a model
- `GET /cwk/civitai/meta` — get cached CivitAI metadata for a model
- `POST /cwk/civitai/fetch/stream` — SSE stream for bulk CivitAI fetch
- `POST /cwk/civitai/refresh` — refresh single model CivitAI data
- `GET /cwk/civitai/validate` — validate CivitAI API key
- `DELETE /cwk/civitai/cache` — clear all cached metadata
- `POST /cwk/civitai/thumbnail/set` — set thumbnail URL for a model
- `POST /cwk/civitai/thumbnail/local` — upload local image as thumbnail
- `GET /cwk/civitai/images` — fetch image list for a model from CivitAI
- `POST /cwk/civitai/check-updates` — batch update check
- `POST /cwk/model/favorite` — toggle favorite flag
- `DELETE /cwk/model` — delete model file and cached data