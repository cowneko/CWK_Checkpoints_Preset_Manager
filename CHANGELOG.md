# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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