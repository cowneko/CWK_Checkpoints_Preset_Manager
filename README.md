# CWK Checkpoints Preset Manager

A [ComfyUI](https://github.com/comfyanonymous/ComfyUI) custom node that combines a **per-model preset system** with a full-featured **model manager** — letting you browse, organize, update, download, and delete checkpoint models directly from ComfyUI, while ensuring every model always loads with its ideal generation settings.

---

## Features

### 🎨 Custom Canvas Node
- Fully custom-drawn node UI using LiteGraph `onDrawForeground` — no standard ComfyUI widgets
- Model thumbnail displayed directly on the node with cover-fit crop and rounded corners
- Inline editable preset rows with **◀ ▶** arrow buttons for stepping numeric values
- Click the center value to open a modal dialog for direct numeric input
- Native `<select>` dropdowns for list fields (Sampler, Scheduler, RNG, CLIP, VAE)
- Three action buttons: **📂 Load Model**, **↩ Reset**, **💾 Update Preset**
- Node size auto-calculated based on content; minimum width enforced

### 💾 Per-Model Preset System
- Save and load generation presets **per checkpoint model** — each model remembers its own settings
- Preset fields: **Sampler**, **Scheduler**, **CFG**, **Steps**, **Clip Skip**, **Width**, **Height**, **RNG**, **CLIP**, **VAE**
- Presets stored in `checkpoint_presets.json` and merged with per-execution widget overrides at runtime
- **Clip skip** applied directly to the CLIP model via `clip.clip_layer()` — no extra node needed
- **RNG control** — choose between **CPU**, **GPU**, or **NV** (NVidia Philox) noise generation per model:
  - Self-contained RNG implementation adapted from [ComfyUI_smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) by shiimizu — **no external dependency required**
  - Uses the `smZ_opts` model_options protocol for full compatibility — if smZNodes is also installed, the two coexist transparently
  - Includes vendored Philox 4×32 RNG for NVidia-compatible cross-GPU reproducibility
  - Patches `comfy.sample.prepare_noise` and hijacks k-diffusion's `default_noise_sampler` for consistent noise in all samplers
- **External CLIP & VAE** — select `embedded` (uses the checkpoint's built-in CLIP/VAE) or pick any external CLIP or VAE model file from ComfyUI's `clip`/`vae` folders; the selection is saved as part of the preset so each model can have its own preferred CLIP and VAE

### 📂 Model Browser & Manager
The Model Browser is a full visual panel that opens from the node's **📂 Load Model** button. It serves as both a model selector and a complete model manager:

- **Visual card grid** with lazy-loaded thumbnails fetched from CivitAI
- **Search** by model name with real-time filtering
- **Base model filter** — filter the grid by architecture: SDXL, Illustrious, Pony, NoobAI, Qwen, Flux, Chroma, Wan, and others
- **⭐ Favorites** — mark preferred models with a star toggle and filter to show favorites only
- **NSFW detection** — models flagged by CivitAI's `nsfw_level` are automatically blurred; click the 👁 eye button to reveal individual cards
- **Video thumbnail support** — `.mp4` and `.webm` thumbnails play inline on cards
- **Drag to reposition** and **resize handle** — panel size and position persist across sessions via `localStorage`

#### CivitAI Integration
- **Fetch Thumbnails/Infos** — streams metadata from the CivitAI API for all models with a live progress bar (SSE-based, concurrent requests)
- **↺ Rebuild Cache** — force re-fetches all metadata from CivitAI, ignoring the local cache (favorites and manual overrides are preserved)
- **Model Info overlay** — right-click any card → **Model Info** to view a detailed overlay with model name, version, base model, file size, file path, tags, example images gallery (with lightbox), and the full CivitAI model description (HTML rendered)
- **CivitAI API key management** — set your API key directly in the panel with a validation button to confirm it works

#### Model Updates & Downloads
- **🔍 Check Updates** — batch-checks CivitAI for newer versions of all your installed models; cards with available updates are marked with a ⬇ badge
- **Version checker** — right-click a card → **Check for updates** to view all available versions of a model, including version name, base model, file size, release date, and early access status
- **Download any version** — download any version directly from CivitAI with a real-time progress bar per version row; the download is streamed with chunked writes and clean error handling (including early access detection)
- **Auto refresh after download** — after a download completes, the model list is automatically reloaded and CivitAI metadata is fetched for the new file so it appears with its thumbnail immediately
- **Auto refresh after delete** — deleting a model (right-click → **Delete model**) removes the file, clears all cached metadata and presets, and refreshes the model list automatically
- **🔄 Reload Models** — manually reload the model list from disk without fetching CivitAI data; also auto-fetches thumbnails for any newly discovered models that don't have them yet

#### Thumbnails
- Thumbnails are fetched automatically from CivitAI based on the SHA-256 hash of the model file (hashes are cached for performance)
- **Pick thumbnail from CivitAI** — right-click a card to browse and select from all images in the model's CivitAI gallery
- **Set local thumbnail** — upload a custom image or video from your filesystem as the thumbnail for any model
- Local thumbnails are served from the `local_thumbnails/` directory and persist across sessions

#### Sidebar Preset Editor
- The right sidebar displays and edits the preset for the selected model
- All preset fields are shown: Sampler, Scheduler, CFG, Steps, Clip Skip, RNG, Width, Height, CLIP, VAE
- Click **Edit Preset** to unlock the fields, modify values, then click **Save Preset** to persist
- Sampler and scheduler lists are loaded dynamically from ComfyUI's `/object_info` endpoint, so they automatically reflect any installed sampler extensions

---

## Installation

### Via ComfyUI Manager (recommended)
Search for **CWK Checkpoints Preset Manager** in the ComfyUI Manager node list.

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/cowneko/CWK_Checkpoints_Preset_Manager.git
```
Then restart ComfyUI.

---

## Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- A [CivitAI API key](https://civitai.com/user/account) (required for fetching thumbnails, model info, and downloading)

> **Note:** [smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) is **no longer required**. As of v1.2.0, the RNG subsystem is fully self-contained using code adapted from smZNodes. If smZNodes is installed alongside, the two coexist transparently with no conflicts.

---

## Usage

### 1. Add the node
Right-click the canvas → **Add Node** → **CWK / CWK Model Preset Manager**

### 2. Load a model
Click **📂 Load Model** to open the Model Browser. Select a model card and click **Load Model**. The node will load the checkpoint and apply its saved preset (or defaults if no preset exists yet).

### 3. Edit a preset
On the node, click the **◀ ▶** arrows to step numeric values, or click the center value to type a number directly. Dropdown rows (Sampler, Scheduler, RNG, CLIP, VAE) open a native selector. You can also edit presets from the sidebar in the Model Browser panel.

### 4. Save a preset
Click **💾 Update Preset** to save the current values as the preset for the loaded model. Next time you load this model, these settings will be restored automatically.

### 5. Reset to preset
Click **↩ Reset** to restore all values to the saved preset for the current model, discarding any unsaved changes.

### 6. RNG modes
Use the **RNG** dropdown to select the noise generation source:
- **cpu** — generate noise on CPU (default, deterministic across all GPUs)
- **gpu** — generate noise on the active GPU (faster, but results may vary across different GPU models)
- **nv** — NVidia Philox RNG (produces identical noise to `torch.randn(..., device='cuda')` but runs on CPU — enables cross-GPU reproducibility matching NVidia's CUDA RNG)

### 7. External CLIP / VAE
Use the **CLIP** and **VAE** dropdowns on the node or in the Model Browser sidebar to select an external model file, or leave as `embedded` to use the checkpoint's built-in CLIP/VAE. If an external file fails to load, the node falls back to the embedded version with a console warning.

### 8. Manage your models
Use the Model Browser to organize your collection:
- **⭐ Star** your favorite models and toggle the favorites filter
- **Right-click** any card for options: view model info, pick or set thumbnails, check for updates, refresh CivitAI data, or delete the model
- **Check Updates** to see which models have newer versions on CivitAI, then download any version directly from the version checker

---

## Outputs

| Output | Type | Description |
|---|---|---|
| MODEL | MODEL | Loaded model with RNG setting applied |
| CLIP | CLIP | Embedded or external CLIP model with clip_skip applied |
| VAE | VAE | Embedded or external VAE |
| sampler_name | SAMPLER | Preset or override sampler |
| scheduler | SCHEDULER | Preset or override scheduler |
| cfg | FLOAT | Preset or override CFG scale |
| steps | INT | Preset or override step count |
| width | INT | Preset or override width |
| height | INT | Preset or override height |

> `clip_skip`, `rng`, `clip_name`, and `vae_name` are applied internally and do not appear as output pins.

---

## API Endpoints

The node registers the following REST routes on the ComfyUI server:

| Method | Path | Description |
|---|---|---|
| GET | `/cwk/models` | List all checkpoint and diffusion models with presets and metadata |
| GET | `/cwk/preset` | Fetch preset for a model |
| POST | `/cwk/preset` | Save preset for a model |
| GET | `/cwk/clips` | List available CLIP models (`embedded` + all files) |
| GET | `/cwk/vaes` | List available VAE models (`embedded` + all files) |
| GET | `/cwk/civitai/meta` | Get cached CivitAI metadata for a model |
| POST | `/cwk/civitai/fetch/stream` | SSE stream for bulk CivitAI metadata fetch |
| POST | `/cwk/civitai/refresh` | Refresh CivitAI data for a single model |
| POST | `/cwk/civitai/refresh/all` | Force refresh all models (SSE stream) |
| GET | `/cwk/civitai/validate` | Validate a CivitAI API key |
| GET | `/cwk/civitai/cache` | Get all cached metadata |
| DELETE | `/cwk/civitai/cache` | Clear all cached metadata |
| POST | `/cwk/civitai/thumbnail/set` | Set thumbnail URL for a model |
| POST | `/cwk/civitai/thumbnail/local` | Upload a local image as thumbnail |
| GET | `/cwk/civitai/images` | Fetch image list for a model from CivitAI |
| GET | `/cwk/civitai/versions` | List all versions of a model from CivitAI |
| GET | `/cwk/civitai/model-description` | Fetch full model description and tags |
| POST | `/cwk/civitai/check-updates` | Batch check for newer model versions |
| POST | `/cwk/civitai/download` | Download a model version (SSE progress stream) |
| POST | `/cwk/model/favorite` | Toggle favorite flag for a model |
| DELETE | `/cwk/model` | Delete a model file and all cached data |

---

## RNG Implementation

The RNG subsystem is self-contained and adapted from [ComfyUI_smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) by [shiimizu](https://github.com/shiimizu). It provides accurate CPU, GPU, and NVidia Philox noise generation without requiring smZNodes to be installed.

The implementation consists of three internal modules:
- **`cwk_rng_shared.py`** — `Options` class using the `smZ_opts` protocol key, with all fields smZNodes expects for full interoperability
- **`cwk_rng_philox.py`** — Philox 4×32 random number generator that reproduces NVidia CUDA `torch.randn` output on CPU
- **`cwk_rng.py`** — `prepare_noise()` function that replaces `comfy.sample.prepare_noise`, with stack introspection to read per-model RNG settings, `TorchHijack` for batch-consistent noise, and k-diffusion `default_noise_sampler` hijacking

If smZNodes is also installed, the two systems coexist transparently — CWK stores its options under the same `smZ_opts` key with all expected fields populated, so smZNodes can read them without errors.

---

## File Structure

```
CWK_Checkpoints_Preset_Manager/
├── __init__.py                 # ComfyUI entry point — registers nodes and routes
├── nodes.py                    # Node definition, preset helpers, CLIP/VAE/RNG loaders
├── cwk_rng_shared.py           # Self-contained RNG options (smZ_opts protocol)
├── cwk_rng_philox.py           # Vendored Philox 4×32 NVidia-compatible RNG
├── cwk_rng.py                  # prepare_noise, TorchHijack, k-diffusion hijacking
├── server.py                   # Aiohttp REST/SSE routes and CivitAI integration
├── checkpoint_presets.json     # Per-model presets (auto-generated, not tracked)
├── hash_cache.json             # SHA-256 hash cache for model files (auto-generated)
├── model_metadata/             # Per-model CivitAI metadata cache (auto-generated)
├── local_thumbnails/           # User-uploaded local thumbnail files
├── web/
│   ├── cwk_preset_manager.js   # Main node canvas extension and LiteGraph drawing
│   ├── cwk_panel.js            # Model Browser panel with grid, sidebar, and management
│   ├── cwk_styles.js           # CSS injection for panel and components
│   ├── cwk_context_menu.js     # Right-click context menu, image picker, version checker
│   └── cwk_model_info.js       # Model Info overlay modal
├── CHANGELOG.md
├── LICENSE.txt
└── README.md
```

---

## Credits

The RNG subsystem (`cwk_rng.py`, `cwk_rng_philox.py`, `cwk_rng_shared.py`) is adapted from [ComfyUI_smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) by [shiimizu](https://github.com/shiimizu), licensed under AGPL-3.0. These modules have been vendored and adapted to work as a self-contained integration within this node.

---

## License

MIT — see [LICENSE](LICENSE.txt)