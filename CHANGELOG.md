# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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