# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-03-21

### Added

#### New `infos` Output on Main Node
- The **CWK Model Preset Manager** node now has an 11th output pin: **infos** (`STRING`)
- Outputs a JSON string containing all resolved preset values: `model_name`, `vae_name`, `clip_name`, `clip_type`, `sampler_name`, `scheduler`, `cfg`, `steps`, `clip_skip`, `rng`, `model_sampling`, `width`, `height`, `resolution`, `batch_size`
- Allows downstream nodes to consume the full preset context as structured data

#### New Companion Node: CWK Infos Extractor
- New node **CWK Infos Extractor** (`CWK_InfosExtractor`) — takes the `infos` JSON string and fans it out to **15 individual STRING outputs**, one per field
- Outputs: `model_name`, `vae_name`, `clip_name`, `clip_type`, `sampler_name`, `scheduler`, `cfg`, `steps`, `clip_skip`, `rng`, `model_sampling`, `width`, `height`, `resolution`, `batch_size`
- Model, VAE, and CLIP names are **automatically cleaned**: subfolder prefixes (e.g. `Pony\`, `Flux\`) and file extensions (`.safetensors`, `.ckpt`) are stripped — e.g. `Pony\autismmixSDXL_autismmixPony.safetensors` → `autismmixSDXL_autismmixPony`
- Pure Python node in `nodes.py` — no frontend/JS required

#### Installed Version Detection in Version Checker
- **Check for Updates** and the **Version Checker** modal now detect versions that are already installed under **different filenames**
- `handle_list_versions()` builds a set of all locally installed `version_id`s for the same `model_id` — a version is marked as `is_installed` even if it was downloaded with a different filename
- New `is_current` field distinguishes the currently selected file from other installed versions of the same model
- `handle_check_updates()` pre-builds an `installed_by_model_id` map so the "latest" version is not flagged as an update if it's already installed under any filename
- Version checker UI shows "✓ installed (current)" vs "✓ installed" badges and displays a 🗑 Delete button instead of ⬇ Download for installed versions

### Changed

- `N_OUTPUTS` in frontend bumped from 10 to **11** to account for the new `infos` output slot
- `RETURN_TYPES` and `RETURN_NAMES` on `CWK_ModelPresetManager` updated to include `STRING` / `infos`
- `NODE_CLASS_MAPPINGS` and `NODE_DISPLAY_NAME_MAPPINGS` now include `CWK_InfosExtractor`

### Fixed

- Fixed version checker showing "⬇ Download" for model versions that were already installed under a different filename — now correctly shows "🗑 Delete" instead
- Fixed "Check Updates" reporting false updates when the latest CivitAI version was already installed as a different local file

---

## [1.9.0] — 2026-03-17

### Added

#### Model Sampling Type Selector
- New **Model Sampling** dropdown on the node and in the Model Browser sidebar — allows switching between **eps**, **v_prediction**, **lcm**, **x0**, and **img_to_img** prediction types
- `model_sampling` is saved as part of the per-model preset and restored on load
- Uses ComfyUI's built-in `comfy.model_sampling` classes to patch the model at execution time:
  - **eps** — default epsilon prediction (no patch applied)
  - **v_prediction** — patches model with `V_PREDICTION` sampling for v-pred trained models
  - **lcm** — uses `ModelSamplingDiscreteDistilled` for Latent Consistency Models
  - **x0** — patches model with `X0` direct prediction
  - **img_to_img** — eps-based tag for downstream img2img workflows
- New `override_model_sampling` input in `INPUT_TYPES` with `(preset)` default
- New `_apply_model_sampling()` helper in `nodes.py`
- `MODEL_SAMPLING_TYPES` constant exported for use by the frontend
- `default_preset()` now includes `model_sampling: "eps"` field

### Changed

#### Reordered Node Parameters with Visual Group Separators
- **Node parameter order changed** to match a logical grouping layout:
  - **Group 1:** RNG, Model Sampling
  - **Group 2:** CLIP, Clip Type, VAE
  - **Group 3:** Sampler, Scheduler, CFG, Steps, Clip skip
  - **Group 4:** Res Preset, Width, Height, Batch
- **Visual divider lines** drawn between each group on the node canvas for clearer visual separation
- `GROUP_SEPARATORS` set in `cwk_preset_manager.js` defines which row indices get a separator line above them
- `getRowY()` and `calcNodeHeight()` updated to account for the extra spacing from group dividers
- `INPUT_TYPES` optional inputs reordered to match the new `INFO_ROWS` order
- All widget mapping locations (`_loadModelIntoNode`, reset handler, update handler, `onNodeCreated`) updated for the new parameter order and new `model_sampling` field

#### Model Browser Sidebar
- New **Model Sampling** dropdown added to the sidebar preset editor (alongside RNG in a two-column row)
- `_getSidebarPreset()`, `_setEditMode()`, and sidebar display updated to include `model_sampling`
- `_populateDropdowns()` now also loads model sampling options from `/object_info`

---

## [1.8.0] — 2026-03-16

### Added

#### GGUF Model Support
- The node now **discovers and loads `.gguf` model files** from `checkpoints/`, `diffusion_models/`, and city96's `unet_gguf/` folders
- `.gguf` is registered as a supported extension at startup via `folder_paths.folder_names_and_paths`, so GGUF files appear in the model list automatically
- **Dynamic loader discovery**: finds city96's `UnetLoaderGGUF` at runtime by scanning `sys.modules` — works regardless of how [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) was installed or what the folder is named
- If ComfyUI-GGUF is not installed, raises a clear error message with install instructions instead of crashing with a cryptic PyTorch error
- GGUF models are tagged as `type: "gguf"` in the model list API (`GET /cwk/models`) for frontend identification
- Like diffusion models, GGUF models have no embedded CLIP or VAE — set external CLIP/VAE in the preset
- Deduplication: if a `.gguf` file appears in multiple folder types, it is listed only once
- All existing features work with GGUF models: presets, thumbnails, CivitAI metadata, favorites, updates, etc.

#### GGUF CLIP Support
- External CLIP `.gguf` files are loaded via city96's `CLIPLoaderGGUF` with the same dynamic module discovery approach
- CLIP files are resolved from both the `clip` and `clip_gguf` folder types
- `get_clip_list()` now includes files from the `clip_gguf` folder type so GGUF text encoders appear in the CLIP dropdown

#### CLIP Type Selector
- New **Clip Type** dropdown on the node and in presets — selects the CLIP architecture type when loading external CLIP models (e.g. `stable_diffusion`, `flux`, `sd3`, `wan`, etc.)
- CLIP type list is dynamically built from `comfy.sd.CLIPType` enum values, with a hardcoded fallback list if the enum is unavailable
- CLIP type is saved as part of the per-model preset (`clip_type` field) and passed to both standard `CLIPLoader` and city96's `CLIPLoaderGGUF`
- New `override_clip_type` input in `INPUT_TYPES` with `(preset)` default — follows the same override pattern as all other preset fields

#### VAE Loader Fallback
- `_load_external_vae()` now tries ComfyUI's built-in `VAELoader` first, then falls back to manual loading with safetensors detection for `.safetensors` files and `torch.load(..., weights_only=False)` for legacy `.pt`/`.ckpt` files — fixes PyTorch 2.6 `weights_only=True` errors

### Changed

- **Model list** (`_all_models()` in `server.py`) now also scans city96's `unet_gguf` folder type for GGUF models
- **`_full_path()`** in `server.py` checks `unet_gguf` folder type in addition to `checkpoints` and `diffusion_models`
- **`_bust_folder_cache()`** in `server.py` now also clears the `unet_gguf` cache entry
- **`_get_gguf_models()`** helper added to `nodes.py` — collects GGUF model names from `unet_gguf`, `checkpoints`, and `diffusion_models` folder types
- **`_resolve_gguf_path()`** helper added to `nodes.py` — finds absolute path for a GGUF model across all folder types
- **`INPUT_TYPES`** model list now includes GGUF models from `_get_gguf_models()` merged with checkpoints and diffusion models
- `default_preset()` now includes `clip_type: "stable_diffusion"` field
- `cwk_preset_manager.js` `INFO_ROWS` updated with new `clip_type` row (index 11) between CLIP and VAE
- All widget mapping locations (`_loadModelIntoNode`, reset handler, update handler) now include `resolution_preset`, `batch_size`, and `override_clip_type` to prevent ComfyUI validation errors
- Widget defaults are explicitly initialized in `onNodeCreated` to ensure all combo widgets have valid values before execution
- Removed duplicate `_loadSamplerOptions()` function definition in `cwk_preset_manager.js`

### Fixed

- Fixed GGUF models not appearing in the Model Browser even after a full rebuild cache — `server.py` now scans `unet_gguf` folder type
- Fixed `RuntimeError: Tried to instantiate class 'UnetLoaderGGUF.load_unet'` caused by `sys.modules` iteration hitting PyTorch internal proxy objects — now filters out `torch.*` modules and non-module objects, and verifies found attributes are actual classes with `isinstance(cls, type)`
- Fixed PyTorch 2.6 `weights_only=True` crash when falling back to `comfy.sd.load_diffusion_model()` for GGUF files — removed the impossible fallback path entirely
- Fixed `resolution_preset: '1024' not in list` validation error caused by missing widget initialization — all combo/list widgets are now explicitly set to valid defaults
- Fixed node rendering as raw ComfyUI widgets (broken custom canvas) caused by a stray `};` in `_loadModelIntoNode` that broke the `if (preset)` block scope

---

## [1.7.0] — 2026-03-16

### Added

#### Editable Model Metadata in Model Info Panel
- The **Model Info** overlay now allows **manual editing** of three metadata fields: **Version**, **Display Name** (civitai_name), and **Base Model**
- Each editable cell has a **✏️ edit button** in its label — clicking it replaces the value with an inline input field
- **Version** and **Display Name** use a text input for free-form editing
- **Base Model** uses a `<select>` dropdown pre-populated with all known architectures: SDXL 1.0, SDXL Turbo, SDXL Lightning, SD 1.5, SD 1.5 LCM, SD 1.5 Hyper, Illustrious, NoobAI, Pony, Flux.1 D, Flux.1 S, Chroma, Wan Video, Qwen, ZImageBase, ZImageTurbo, Other — if the model already has a custom value not in the list, it is added at the top
- A **💾 Save Changes** bar appears below the info grid when any field has been edited — clicking it persists the changes to the server
- Clicking **↩** on an edited cell cancels the edit and restores the original value
- After saving, the in-memory `model.civitai` object is updated so the **Model Browser grid** and **card footer** immediately reflect the new display name, version, and base model — no need to close and reopen the panel
- The header title in the Model Info overlay is also updated live when the display name is changed

#### Manual Metadata Override Persistence
- New REST endpoint: `POST /cwk/civitai/meta/edit` — accepts `{model, edits: {civitai_name, version_name, base_model}}` and writes the values to the per-model metadata JSON
- Manually edited fields are tracked in a `_manual_overrides` array inside the metadata file
- `_keep_manual_overrides()` in `server.py` updated to **preserve manually-edited fields** when CivitAI data is refreshed — manual edits survive **Fetch Thumbnails**, **Rebuild Cache**, and **Refresh CivitAI data** operations

#### New Base Model Filters
- Added **SD15** filter in the Model Browser base model filter dropdown — matches models with `sd 1` in their base model string (covers SD 1.4, SD 1.5, and variants)
- Added **ZImage** filter in the Model Browser base model filter dropdown — matches models with `z image` in their base model string (covers ZImageBase, ZImageTurbo, and future variants)

### Changed

- **"File Name" cell renamed to "Display Name"** in the Model Info overlay — now shows `civitai_name` (the CivitAI display name) instead of the raw filename, making it consistent with what appears on the card grid and editable
- `.cwk-info-label` CSS updated to `display:flex; align-items:center; gap:6px;` to accommodate the inline edit buttons
- New CSS classes added to `_injectInfoStyles()`: `.cwk-info-edit-btn`, `.cwk-info-edit-input`, `.cwk-info-edit-select`, `.cwk-info-save-bar`, `.cwk-info-save-btn`, `.cwk-info-save-status`

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