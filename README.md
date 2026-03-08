# CWK Checkpoints Preset Manager

A [ComfyUI](https://github.com/comfyanonymous/ComfyUI) custom node that lets you save and load generation presets (sampler, scheduler, CFG, steps, clip skip, resolution, RNG) **per checkpoint model** — so every model always loads with its ideal settings automatically.

---

## Features

- 📂 **Model Browser Panel** — visual grid browser with thumbnails, favorites, NSFW blur, and CivitAI metadata
- 💾 **Per-model presets** — save sampler, scheduler, CFG, steps, clip skip, resolution and RNG per checkpoint
- 🎨 **Custom canvas node** — fully drawn node UI with inline editable preset fields, no standard widgets
- 🔄 **CivitAI integration** — fetch thumbnails, model info, base model tags, and check for updates
- 🖥️ **RNG control** — CPU/GPU noise generation applied directly to the model (compatible with [smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) if installed)
- ✂️ **Clip skip** — applied automatically to the CLIP model at load time, no extra node needed
- 📐 **Persistent panel** — browser panel remembers its size and position across sessions

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
- A [CivitAI API key](https://civitai.com/user/account) (required for fetching thumbnails and model info)
- [smZNodes](https://github.com/shiimizu/ComfyUI_smZNodes) *(optional — enables proper CPU/GPU RNG switching)*

---

## Usage

### 1. Add the node
Right-click the canvas → **Add Node** → **CWK / CWK Model Preset Manager**

### 2. Load a model
Click **📂 Load Model** to open the Model Browser. Select a model and click **Load Model**.

### 3. Edit a preset
In the node, click the **◀ ▶** arrows to step values, or click the center value to type a number directly. Dropdown rows (Sampler, Scheduler, RNG) open a native selector.

### 4. Save a preset
Click **💾 Update Preset** to save the current values as the preset for the loaded model.

### 5. Reset to preset
Click **↩ Reset** to restore all values to the saved preset for the current model.

---

## Outputs

| Output | Type | Description |
|---|---|---|
| MODEL | MODEL | Loaded model with RNG setting applied |
| CLIP | CLIP | CLIP model with clip_skip applied |
| VAE | VAE | VAE from checkpoint |
| sampler_name | SAMPLER | Preset or override sampler |
| scheduler | SCHEDULER | Preset or override scheduler |
| cfg | FLOAT | Preset or override CFG scale |
| steps | INT | Preset or override step count |
| width | INT | Preset or override width |
| height | INT | Preset or override height |

> `clip_skip` and `rng` are applied internally and do not appear as output pins.

---

## Model Browser

- **Fetch Thumbnails/Infos** — fetches metadata and thumbnails from CivitAI for all models
- **↺ Rebuild Cache** — re-fetches all metadata, ignoring the local cache
- **🔍 Check Updates** — checks CivitAI for newer versions of your models
- **Right-click a card** — access model info, pick/set thumbnail, refresh CivitAI data, or delete the model
- **⭐ Favorites** — star models and filter to favorites only
- **Base Model filter** — filter grid by architecture (SDXL, Flux, Pony, etc.)

---

## File Structure

```
CWK_Checkpoints_Preset_Manager/
├── __init__.py
├── nodes.py                  # ComfyUI node definition
├── server.py                 # Aiohttp routes for API endpoints
├── checkpoint_presets.json   # Per-model presets (auto-generated, not tracked)
├── web/
│   ├── cwk_preset_manager.js # Main node canvas extension
│   ├── cwk_panel.js          # Model browser panel
│   ├── cwk_styles.js         # CSS injection
│   ├── cwk_context_menu.js   # Right-click context menu
│   └── cwk_model_info.js     # Model info overlay
└── README.md
```

---

## License

MIT — see [LICENSE](LICENSE)