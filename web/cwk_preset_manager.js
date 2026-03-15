/**
 * CWK Preset Manager — ComfyUI extension entry point.
 */

import { app }               from "../../scripts/app.js";
import { injectStyles }      from "./cwk_styles.js";
import { ModelBrowserPanel } from "./cwk_panel.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_TYPE = "CWK_ModelPresetManager";

const PAD         = 10;
const THUMB_W     = 120;
const THUMB_H     = 180;
const ROW_H       = 26;
const LABEL_W     = 90;
const BTN_H       = 26;
const BTN_GAP     = 4;
const BTN_PAD_V   = 8;
const BTNS_AREA_H = BTN_PAD_V + (BTN_H * 3) + (BTN_GAP * 2) + BTN_PAD_V;
const NODE_MIN_W  = 340;
const ARROW_W     = 20;

const TITLE_H   = () => LiteGraph.NODE_TITLE_HEIGHT ?? 30;
const SLOT_H    = () => LiteGraph.NODE_SLOT_HEIGHT  ?? 20;
// ── CHANGED: 10 outputs now (added LATENT) ──
const N_OUTPUTS = 10;

function getSlotsBottom() {
  return TITLE_H() + N_OUTPUTS * SLOT_H() + 6;
}

// ─── Row descriptors ──────────────────────────────────────────────────────────

let SAMPLERS   = ["euler","euler_ancestral","dpmpp_2m","dpmpp_2m_sde",
                  "dpmpp_sde","dpmpp_3m_sde","ddim","uni_pc","lcm"];
let SCHEDULERS = ["normal","karras","exponential","sgm_uniform","simple","beta"];
const RNGS     = ["cpu","gpu", "nv"];
let CLIPS      = ["embedded"];
let VAES       = ["embedded"];

// ── NEW: Resolution presets list (fetched from server on startup) ─────────────
let RES_PRESETS = ["(preset)"];
let RES_PRESETS_MAP = {};  // label → {width, height}

async function _loadResolutionPresets() {
  try {
    const res = await fetch("/cwk/resolution_presets");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      RES_PRESETS = data.map(d => d.label);
      RES_PRESETS_MAP = {};
      for (const d of data) {
        RES_PRESETS_MAP[d.label] = { width: d.width, height: d.height };
      }
    }
  } catch (e) {
    console.warn("[CWK] Could not load resolution presets:", e);
  }
}

async function _loadSamplerOptions() {
  try {
    const res = await fetch("/object_info/CWK_ModelPresetManager");
    if (!res.ok) return;
    const data = await res.json();
    const inputs = data?.CWK_ModelPresetManager?.input;
    const samplers   = (inputs?.optional?.override_sampler?.[0]   ?? []).filter(v => v !== "(preset)");
    const schedulers = (inputs?.optional?.override_scheduler?.[0] ?? []).filter(v => v !== "(preset)");
    if (samplers.length)   { SAMPLERS   = samplers;   INFO_ROWS[0].options = samplers;   }
    if (schedulers.length) { SCHEDULERS = schedulers; INFO_ROWS[1].options = schedulers; }

    const clips = (inputs?.optional?.override_clip_name?.[0] ?? []).filter(v => v !== "(preset)");
    const vaes  = (inputs?.optional?.override_vae_name?.[0]  ?? []).filter(v => v !== "(preset)");
    if (clips.length) { CLIPS = clips; INFO_ROWS[8].options = clips; }
    if (vaes.length)  { VAES  = vaes;  INFO_ROWS[9].options = vaes;  }
  } catch (e) {
    console.warn("[CWK] Could not load sampler options from object_info:", e);
  }
}

async function _loadClipVaeOptions() {
  try {
    const [clipRes, vaeRes] = await Promise.all([
      fetch("/cwk/clips"),
      fetch("/cwk/vaes"),
    ]);
    if (clipRes.ok) {
      const { clips } = await clipRes.json();
      if (clips?.length) { CLIPS = clips; INFO_ROWS[8].options = clips; }
    }
    if (vaeRes.ok) {
      const { vaes } = await vaeRes.json();
      if (vaes?.length) { VAES = vaes; INFO_ROWS[9].options = vaes; }
    }
  } catch (e) {
    console.warn("[CWK] Could not load CLIP/VAE lists:", e);
  }
}

const INFO_ROWS = [
  { key: "sampler_name", label: "Sampler",    widget: "override_sampler",   type: "list",  options: SAMPLERS   },
  { key: "scheduler",    label: "Scheduler",  widget: "override_scheduler", type: "list",  options: SCHEDULERS },
  { key: "cfg",          label: "CFG",        widget: "override_cfg",       type: "float", min: 0,   max: 30   },
  { key: "steps",        label: "Steps",      widget: "override_steps",     type: "int",   min: 1,   max: 200  },
  { key: "clip_skip",    label: "Clip skip",  widget: "override_clip_skip", type: "int",   min: -24, max: -1   },
  // ── NEW: Resolution preset row (index 5) ──
  { key: "res_preset",   label: "Res Preset", widget: "resolution_preset",  type: "list",  options: RES_PRESETS },
  { key: "width",        label: "Width",      widget: "override_width",     type: "int",   min: 64,  max: 8192 },
  { key: "height",       label: "Height",     widget: "override_height",    type: "int",   min: 64,  max: 8192 },
  // ── NEW: Batch size row (index 8) ──
  { key: "batch_size",   label: "Batch",      widget: "batch_size",         type: "int",   min: 1,   max: 64   },
  { key: "rng",          label: "RNG",        widget: "override_rng",       type: "list",  options: RNGS       },
  { key: "clip_name",    label: "CLIP",       widget: "override_clip_name", type: "list",  options: CLIPS      },
  { key: "vae_name",     label: "VAE",        widget: "override_vae_name",  type: "list",  options: VAES       },
];

_loadSamplerOptions();
_loadClipVaeOptions();
_loadResolutionPresets().then(() => {
  // Update the res_preset row options once fetched
  const resRow = INFO_ROWS.find(r => r.key === "res_preset");
  if (resRow) resRow.options = RES_PRESETS;
});

const BTNS = [
  { label: "📂 Load Model",    key: "load"   },
  { label: "↩ Reset",          key: "reset"  },
  { label: "💾 Update Preset", key: "update" },
];

const C = {
  bg:         "#1a1f2e",
  bgFull:     "#141824",
  surface:    "#1e2335",
  border:     "#313552",
  text:       "#cdd6f4",
  textDim:    "#6c7086",
  textBlue:   "#89b4fa",
  hoverBg:    "#2a2f45",
  arrowHov:   "#89b4fa",
  flashGreen: "#a6e3a1",
};

// ─── Node default colors ──────────────────────────────────────────────────────
const NODE_COLOR   = "#141824";
const NODE_BGCOLOR = "#1e2335";

const BTN_COLORS = {
  load:   { border: "#313552", hoverBorder: "#89b4fa", hoverText: "#89b4fa" },
  reset:  { border: "#313552", hoverBorder: "#89b4fa", hoverText: "#89b4fa" },
  update: { border: "#313552", hoverBorder: "#f38ba8", hoverText: "#f38ba8" },
};

// ─── Image cache ──────────────────────────────────────────────────────────────

const _imgCache = new Map();
function loadImage(url) {
  if (!url) return null;
  if (_imgCache.has(url)) return _imgCache.get(url);
  const img = new Image();
  img.onload = () => app.canvas.setDirty(true, false);
  img.src = url;
  _imgCache.set(url, img);
  return img;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function getThumbRect(node) {
  const regionTop    = TITLE_H();
  const regionBottom = getSlotsBottom();
  const regionH      = regionBottom - regionTop;
  if (THUMB_H <= regionH - PAD * 2) {
    const thumbY = regionTop + (regionH - THUMB_H) / 2;
    return { x: PAD, y: thumbY, w: THUMB_W, h: THUMB_H };
  }
  return { x: PAD, y: regionTop + PAD, w: THUMB_W, h: THUMB_H };
}

function getInfoAreaX()     { return PAD + THUMB_W + PAD; }
function getInfoAreaW(node) { return node.size[0] - getInfoAreaX() - PAD; }

function getRowsStartY(node) {
  const thumbRect   = getThumbRect(node);
  const thumbBottom = thumbRect.y + thumbRect.h + PAD;
  const slotsBottom = getSlotsBottom() + PAD;
  return Math.max(thumbBottom, slotsBottom);
}

function getRowY(node, i) { return getRowsStartY(node) + i * (ROW_H + 3); }

function getButtonRects(node) {
  const btnW  = node.size[0] - PAD * 2;
  const baseY = node.size[1] - BTNS_AREA_H + BTN_PAD_V;
  return BTNS.map((b, i) => ({
    x: PAD, y: baseY + i * (BTN_H + BTN_GAP),
    w: btnW, h: BTN_H, key: b.key, label: b.label,
  }));
}

function getValueRect(node, i) {
  const ry = getRowY(node, i);
  const x  = PAD + LABEL_W;
  const w  = node.size[0] - x - PAD;
  return { x, y: ry + 1, w, h: ROW_H - 2 };
}

function calcNodeHeight(node) {
  return getRowsStartY(node) + INFO_ROWS.length * (ROW_H + 3) + PAD + BTNS_AREA_H;
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

function hitTestButton(node, lx, ly) {
  for (const r of getButtonRects(node)) {
    if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return r.key;
  }
  return null;
}

function hitTestRow(node, lx, ly) {
  for (let i = 0; i < INFO_ROWS.length; i++) {
    const ry = getRowY(node, i);
    if (ly < ry || ly > ry + ROW_H) continue;
    const vr  = getValueRect(node, i);
    const row = INFO_ROWS[i];
    if (lx < PAD || lx > node.size[0] - PAD) return { rowIdx: i, part: null };
    if (row.type === "list") return { rowIdx: i, part: "center" };
    if (lx >= vr.x && lx <= vr.x + ARROW_W)               return { rowIdx: i, part: "left"   };
    if (lx >= vr.x + vr.w - ARROW_W && lx <= vr.x + vr.w) return { rowIdx: i, part: "right"  };
    if (lx >= vr.x && lx <= vr.x + vr.w)                   return { rowIdx: i, part: "center" };
    return { rowIdx: i, part: null };
  }
  return null;
}

// ─── Value helpers ────────────────────────────────────────────────────────────

function clampValue(row, val) {
  let v = row.type === "int" ? Math.round(Number(val)) : Number(val);
  if (isNaN(v)) return val;
  if (row.min !== undefined) v = Math.max(row.min, v);
  if (row.max !== undefined) v = Math.min(row.max, v);
  return row.type === "float" ? parseFloat(v.toFixed(2)) : v;
}

// ─── Screen coords helper ─────────────────────────────────────────────────────

function _canvasToScreen(node, vr) {
  const bbox = app.canvas.canvas.getBoundingClientRect();
  const zoom = app.canvas.ds?.scale ?? 1;
  const off  = app.canvas.ds?.offset ?? [0, 0];
  return {
    x: (node.pos[0] + vr.x) * zoom + off[0] * zoom + bbox.left,
    y: (node.pos[1] + vr.y) * zoom + off[1] * zoom + bbox.top,
    w: vr.w * zoom,
    h: vr.h * zoom,
  };
}

// ─── Stop all LiteGraph-interceptable events on an element ────────────────────

function _blockCanvasEvents(el) {
  for (const evt of ["mousedown", "mouseup", "click", "pointerdown", "pointerup",
                      "dblclick", "contextmenu", "wheel", "touchstart", "touchend"]) {
    el.addEventListener(evt, e => e.stopPropagation());
  }
}

// ─── Inline number editor ─────────────────────────────────────────────────────

function openInlineNumberEditor(node, rowIdx, currentValue, onCommit) {
  closeInlineEditor();
  closeDropdown();
  const row = INFO_ROWS[rowIdx];
  const vr  = getValueRect(node, rowIdx);
  const sc  = _canvasToScreen(node, vr);
  const zoom = app.canvas.ds?.scale ?? 1;
  const backdrop = document.createElement("div");
  backdrop.id = "cwk-inline-backdrop";
  Object.assign(backdrop.style, {
    position: "fixed", inset: "0", zIndex: "99998", background: "transparent",
  });
  const input = document.createElement("input");
  input.id = "cwk-inline-editor"; input.type = "text"; input.inputMode = "decimal";
  input.value = String(currentValue ?? "");
  Object.assign(input.style, {
    position: "fixed", left: sc.x+"px", top: sc.y+"px", width: sc.w+"px", height: sc.h+"px",
    fontSize: Math.max(11, Math.round(11*zoom))+"px", fontFamily: "Inter,system-ui,sans-serif",
    background: C.bgFull, color: C.text, border: `1px solid ${C.arrowHov}`,
    borderRadius: "3px", outline: "none", zIndex: "99999", padding: "0 6px",
    textAlign: "center", boxSizing: "border-box",
  });
  _blockCanvasEvents(input); _blockCanvasEvents(backdrop);
  let committed = false;
  const commit = () => {
    if (committed) return; committed = true;
    const raw = input.value.trim(); closeInlineEditor();
    if (raw !== "") onCommit(clampValue(row, raw));
    app.canvas.setDirty(true, false);
  };
  const cancel = () => { if (committed) return; committed = true; closeInlineEditor(); app.canvas.setDirty(true, false); };
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { cancel(); }
  });
  backdrop.addEventListener("mousedown", e => { e.stopPropagation(); e.preventDefault(); commit(); });
  backdrop.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); commit(); });
  backdrop.appendChild(input); document.body.appendChild(backdrop);
  requestAnimationFrame(() => { setTimeout(() => { input.focus(); input.select(); }, 0); });
}

function closeInlineEditor() {
  const el = document.getElementById("cwk-inline-backdrop"); if (el) el.remove();
  const inp = document.getElementById("cwk-inline-editor");  if (inp) inp.remove();
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

let _dropdownOutside = null;

function openDropdown(node, rowIdx, currentValue, onCommit) {
  closeDropdown(); closeInlineEditor();
  const row = INFO_ROWS[rowIdx];
  const vr  = getValueRect(node, rowIdx);
  const sc  = _canvasToScreen(node, vr);
  const zoom = app.canvas.ds?.scale ?? 1;
  const maxVisible = Math.min(row.options.length, 12);
  const optionH    = Math.max(16, Math.round(18 * zoom));
  const listH      = maxVisible * optionH + 4;
  const vh         = window.innerHeight;
  const spaceBelow = vh - sc.y - sc.h - 4;
  const spaceAbove = sc.y - 4;
  let dropTop;
  if (spaceBelow >= listH || spaceBelow >= spaceAbove) { dropTop = sc.y + sc.h + 1; }
  else { dropTop = sc.y - listH - 1; }
  const sel = document.createElement("select");
  sel.id = "cwk-node-dropdown"; sel.size = maxVisible;
  Object.assign(sel.style, {
    position: "fixed", left: sc.x+"px", top: dropTop+"px", width: sc.w+"px", height: listH+"px",
    fontSize: Math.max(11, Math.round(11*zoom))+"px", fontFamily: "Inter,system-ui,sans-serif",
    background: C.bgFull, color: C.text, border: `1px solid ${C.arrowHov}`,
    borderRadius: "4px", outline: "none", zIndex: "99999", cursor: "pointer",
    padding: "2px 0", overflow: "auto",
  });
  for (const opt of row.options) {
    const o = document.createElement("option");
    o.value = opt; o.textContent = opt;
    Object.assign(o.style, {
      padding: "2px 8px",
      background: String(currentValue) === opt ? C.hoverBg : "transparent",
      color:      String(currentValue) === opt ? C.arrowHov : C.text,
    });
    if (String(currentValue) === opt) o.selected = true;
    sel.appendChild(o);
  }
  _blockCanvasEvents(sel);
  document.body.appendChild(sel); sel.focus();
  const selectedOpt = sel.querySelector("option:checked");
  if (selectedOpt) selectedOpt.scrollIntoView({ block: "nearest" });
  let committed = false;
  const commit = (val) => {
    if (committed) return; committed = true;
    closeDropdown(); onCommit(val ?? sel.value); app.canvas.setDirty(true, false);
  };
  sel.addEventListener("click", () => { commit(sel.value); });
  sel.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(sel.value); }
    if (e.key === "Escape") { committed = true; closeDropdown(); app.canvas.setDirty(true, false); }
  });
  _dropdownOutside = (e) => {
    if (e.target !== sel && !sel.contains(e.target)) {
      if (!committed) { committed = true; closeDropdown(); app.canvas.setDirty(true, false); }
    }
  };
  setTimeout(() => { document.addEventListener("pointerdown", _dropdownOutside, { capture: true }); }, 50);
}

function closeDropdown() {
  const el = document.getElementById("cwk-node-dropdown"); if (el) el.remove();
  if (_dropdownOutside) {
    document.removeEventListener("pointerdown", _dropdownOutside, { capture: true });
    _dropdownOutside = null;
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function drawNode(node, ctx) {
  const w      = node.size[0];
  const h      = node.size[1];
  const thumbR = getThumbRect(node);
  const infoX  = getInfoAreaX();
  const infoW  = getInfoAreaW(node);
  const meta   = node._cwkMeta   ?? {};
  const preset = node._cwkPreset ?? {};
  const hover  = node._cwkHover;

  ctx.fillStyle = C.bgFull;
  ctx.fillRect(0, 0, w, h);

  const contentY = getRowsStartY(node) - PAD;
  ctx.fillStyle  = C.bg;
  ctx.fillRect(0, contentY, w, h - contentY);

  // ── Thumbnail ──
  const img = loadImage(meta.thumbnail ?? null);
  roundRect(ctx, thumbR.x, thumbR.y, thumbR.w, thumbR.h, 6);
  ctx.fillStyle = C.surface; ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();
  if (img?.complete && img.naturalWidth > 0) {
    ctx.save();
    roundRect(ctx, thumbR.x, thumbR.y, thumbR.w, thumbR.h, 6); ctx.clip();
    const ir = img.naturalWidth / img.naturalHeight;
    const tr = thumbR.w / thumbR.h;
    let sw, sh, sx, sy;
    if (ir > tr) { sh = img.naturalHeight; sw = sh * tr; sx = (img.naturalWidth - sw)/2; sy = 0; }
    else         { sw = img.naturalWidth;  sh = sw / tr; sy = (img.naturalHeight - sh)/2; sx = 0; }
    ctx.drawImage(img, sx, sy, sw, sh, thumbR.x, thumbR.y, thumbR.w, thumbR.h);
    ctx.restore();
  } else {
    ctx.fillStyle = C.textDim; ctx.font = "28px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🖼", thumbR.x + thumbR.w/2, thumbR.y + thumbR.h/2);
  }

  // ── Model info ──
  const ny = thumbR.y + 6;
  const displayName = meta.civitai_name
    ?? (node._cwkModelName
      ? node._cwkModelName.replace(/^.*[/\\]/,"").replace(/\.[^.]+$/,"")
      : "No model loaded");
  ctx.fillStyle = C.text; ctx.font = "bold 13px Inter,system-ui,sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(displayName, infoX, ny, infoW);
  if (meta.base_model) {
    ctx.fillStyle = C.textBlue; ctx.font = "11px Inter,system-ui,sans-serif";
    ctx.fillText(meta.base_model, infoX, ny + 20, infoW);
  }
  if (node._cwkModelName) {
    ctx.fillStyle = C.textDim; ctx.font = "9px Inter,system-ui,sans-serif";
    ctx.fillText(node._cwkModelName.replace(/^.*[/\\]/,""), infoX, ny + 38, infoW);
  }

  // ── Divider ──
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath();
  const divY = getRowsStartY(node) - PAD/2;
  ctx.moveTo(PAD, divY); ctx.lineTo(w - PAD, divY); ctx.stroke();

  // ── Preset rows ──
  for (let i = 0; i < INFO_ROWS.length; i++) {
    const row     = INFO_ROWS[i];
    const ry      = getRowY(node, i);
    const vr      = getValueRect(node, i);
    const val     = preset[row.key] ?? "—";
    const isHov   = hover?.rowIdx === i;
    const hovPart = isHov ? hover.part : null;
    if (isHov) {
      roundRect(ctx, PAD, ry, w - PAD*2, ROW_H, 3);
      ctx.fillStyle = C.hoverBg; ctx.fill();
    }
    ctx.fillStyle = C.textDim; ctx.font = "11px Inter,system-ui,sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(row.label, PAD + 4, ry + ROW_H/2);
    roundRect(ctx, vr.x, vr.y, vr.w, vr.h, 4);
    ctx.fillStyle = C.surface;
    ctx.strokeStyle = isHov ? C.border : "transparent";
    ctx.lineWidth = 1; ctx.fill(); if (isHov) ctx.stroke();
    if (row.type === "list") {
      ctx.fillStyle = isHov ? C.arrowHov : C.textDim;
      ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("▾", vr.x + vr.w - 5, ry + ROW_H/2);
      ctx.fillStyle = C.text; ctx.font = "11px Inter,system-ui,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(val), vr.x + 6, ry + ROW_H/2, vr.w - 18);
    } else {
      ctx.font = "10px sans-serif"; ctx.textBaseline = "middle";
      ctx.fillStyle = (hovPart === "left") ? C.arrowHov : C.textDim;
      ctx.textAlign = "left"; ctx.fillText("◀", vr.x + 4, ry + ROW_H/2);
      ctx.fillStyle = (hovPart === "right") ? C.arrowHov : C.textDim;
      ctx.textAlign = "right"; ctx.fillText("▶", vr.x + vr.w - 4, ry + ROW_H/2);
      ctx.fillStyle = (hovPart === "center") ? C.arrowHov : C.text;
      ctx.font = "11px Inter,system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText(String(val), vr.x + vr.w/2, ry + ROW_H/2, vr.w - ARROW_W*2 - 4);
    }
  }

  // ── Buttons ──
  for (const r of getButtonRects(node)) {
    const isHov   = hover?.key === r.key;
    const isFlash = node._cwkFlash === r.key;
    const label   = isFlash ? node._cwkFlashLabel : r.label;
    const bc      = BTN_COLORS[r.key];
    roundRect(ctx, r.x, r.y, r.w, r.h, 5);
    ctx.fillStyle   = isHov ? C.hoverBg : C.surface;
    ctx.strokeStyle = isHov ? bc.hoverBorder : bc.border;
    ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
    ctx.fillStyle = isFlash ? C.flashGreen : (isHov ? bc.hoverText : C.text);
    ctx.font = "bold 11px Inter,system-ui,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w/2, r.y + r.h/2, r.w - 8);
  }
}

// ─── Helper: fully load a model into the node (model name, meta, preset) ──────

async function _loadModelIntoNode(node, modelName) {
  const getW = name => node.widgets?.find(w => w.name === name);
  const mw = getW("model_name");
  if (mw) { mw.value = modelName; mw.callback?.(modelName); }
  node._cwkModelName = modelName;
  try {
    const res = await fetch(`/cwk/civitai/meta?model=${encodeURIComponent(modelName)}`);
    if (res.ok) node._cwkMeta = await res.json();
  } catch {}
  try {
    const { preset } = await apiFetch(`/cwk/preset?model=${encodeURIComponent(modelName)}`);
    if (preset) {
      node._cwkPreset = { ...preset };
      // Also set batch_size default if not in preset
      if (node._cwkPreset.batch_size == null) node._cwkPreset.batch_size = 1;
      // Also set res_preset display
      if (node._cwkPreset.res_preset == null) node._cwkPreset.res_preset = "(preset)";
      const map = {
        override_sampler:   preset.sampler_name,
        override_scheduler: preset.scheduler,
        override_cfg:       preset.cfg,
        override_steps:     preset.steps,
        override_clip_skip: preset.clip_skip,
        override_width:     preset.width,
        override_height:    preset.height,
        override_rng:       preset.rng,
        override_clip_name: preset.clip_name,
        override_vae_name:  preset.vae_name,
      };
      for (const [wn, val] of Object.entries(map)) {
        const w = getW(wn);
        if (w && val !== undefined) { w.value = val; w.callback?.(val); }
      }
    }
  } catch {}
  // Persist as last used model
  try { await apiFetch("/cwk/last_model", { method: "POST", body: JSON.stringify({ model_name: modelName }) }); } catch {}
  node.setDirtyCanvas(true);
}

// ─── Extension ────────────────────────────────────────────────────────────────

app.registerExtension({
  name: "CWK.ModelPresetManager",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE) return;

    nodeType.prototype.onNodeCreated = function () {
      injectStyles();
      const node          = this;
      node._cwkHover      = null;
      node._cwkFlash      = null;
      node._cwkFlashLabel = null;
      node._cwkMeta       = null;
      node._cwkPreset     = {};
      node._cwkModelName  = null;

      node.color   = NODE_COLOR;
      node.bgcolor = NODE_BGCOLOR;

      setTimeout(() => {
        for (const w of node.widgets ?? []) {
          w.type = "hidden"; w.hidden = true;
          w.computeSize = () => [0, -4];
        }
        node.size[0] = Math.max(node.size[0], NODE_MIN_W);
        node.size[1] = calcNodeHeight(node);
        app.canvas.setDirty(true, true);
      }, 0);

      // ── NEW: Restore last-used model on node creation ────────────────────
      setTimeout(async () => {
        // Only auto-restore if no model is already loaded (fresh node)
        if (node._cwkModelName) return;
        try {
          const res = await fetch("/cwk/last_model");
          if (!res.ok) return;
          const data = await res.json();
          if (data.model_name) {
            await _loadModelIntoNode(node, data.model_name);
          }
        } catch (e) {
          console.warn("[CWK] Could not restore last model:", e);
        }
      }, 100);

      node.onDrawForeground = function (ctx) { drawNode(this, ctx); };

      node.onResize = function () {
        this.size[0] = Math.max(NODE_MIN_W, this.size[0]);
        this.size[1] = calcNodeHeight(this);
      };

      node.onMouseDown = function (e, pos) {
        const btnKey = hitTestButton(this, pos[0], pos[1]);
        if (btnKey) { handleButtonClick(node, btnKey); return true; }
        const hit = hitTestRow(this, pos[0], pos[1]);
        if (!hit || hit.part === null) return false;
        const { rowIdx, part } = hit;
        const row = INFO_ROWS[rowIdx];
        const cur = node._cwkPreset?.[row.key];
        if (row.type === "list") {
          openDropdown(node, rowIdx, cur, val => {
            applyRowValue(node, rowIdx, val);
            // ── NEW: If resolution preset changed, update width/height ──
            if (row.key === "res_preset" && val !== "(preset)") {
              const dims = RES_PRESETS_MAP[val];
              if (dims && dims.width > 0 && dims.height > 0) {
                const widthIdx  = INFO_ROWS.findIndex(r => r.key === "width");
                const heightIdx = INFO_ROWS.findIndex(r => r.key === "height");
                if (widthIdx >= 0)  applyRowValue(node, widthIdx,  dims.width);
                if (heightIdx >= 0) applyRowValue(node, heightIdx, dims.height);
              }
            }
          });
          return true;
        }
        if (part === "left") {
          const step = row.type === "float" ? 0.1 : 1;
          applyRowValue(node, rowIdx, clampValue(row, Number(cur) - step));
          return true;
        }
        if (part === "right") {
          const step = row.type === "float" ? 0.1 : 1;
          applyRowValue(node, rowIdx, clampValue(row, Number(cur) + step));
          return true;
        }
        if (part === "center") {
          openInlineNumberEditor(node, rowIdx, cur, val => applyRowValue(node, rowIdx, val));
          return true;
        }
        return false;
      };

      node.onMouseMove = function (e, pos) {
        const btnKey = hitTestButton(this, pos[0], pos[1]);
        if (btnKey) {
          if (!node._cwkHover || node._cwkHover.key !== btnKey) {
            node._cwkHover = { key: btnKey }; app.canvas.setDirty(true, false);
          }
          return;
        }
        const hit    = hitTestRow(this, pos[0], pos[1]);
        const newHov = hit ? { rowIdx: hit.rowIdx, part: hit.part } : null;
        if (JSON.stringify(node._cwkHover) !== JSON.stringify(newHov)) {
          node._cwkHover = newHov; app.canvas.setDirty(true, false);
        }
      };

      node.onMouseLeave = function () {
        if (node._cwkHover !== null) { node._cwkHover = null; app.canvas.setDirty(true, false); }
      };
    };
  },

  // ── NEW: Handle image-with-metadata dropped onto canvas ──────────────────
  async nodeCreated(node) {
    if (node.comfyClass !== NODE_TYPE) return;

    // Hook into handleFile to intercept image drops with PNG metadata
    const origHandleFile = node.handleFile?.bind(node);
    node.handleFile = async function (file) {
      if (origHandleFile) origHandleFile(file);
      if (!file || !file.type?.startsWith("image/")) return;

      try {
        // Read PNG text chunks for ComfyUI workflow/prompt metadata
        const buffer = await file.arrayBuffer();
        const text   = new TextDecoder().decode(buffer);

        // Try to find a ComfyUI-style "prompt" JSON embedded in the image
        let promptData = null;
        // Method 1: look for the "prompt" PNG tEXt chunk pattern
        const promptMatch = text.match(/"prompt"\s*:\s*(\{[\s\S]*\})/);
        if (promptMatch) {
          try { promptData = JSON.parse(promptMatch[1]); } catch {}
        }
        // Method 2: look for A1111-style parameters in EXIF
        const a1111Match = text.match(/(?:parameters|EXIF)\s*[:\n]([\s\S]*?)(?:Negative prompt:|$)/i);

        if (promptData) {
          // ComfyUI workflow metadata — find the checkpoint loader node
          for (const [, nodeData] of Object.entries(promptData)) {
            const inputs = nodeData?.inputs;
            if (!inputs) continue;
            const ckpt = inputs.ckpt_name || inputs.model_name;
            if (ckpt) {
              await _loadModelIntoNode(node, ckpt);
              return;
            }
          }
        }

        // Try to find model name from A1111-style "Model: xxx" or "Model hash: xxx"
        const modelMatch = text.match(/Model:\s*([^\n,]+)/i);
        if (modelMatch) {
          const modelHint = modelMatch[1].trim();
          // Try to find a matching checkpoint by partial name
          try {
            const listRes = await fetch("/cwk/models");
            if (listRes.ok) {
              const models = await listRes.json();
              const match = models.find(m =>
                m.name.toLowerCase().includes(modelHint.toLowerCase()) ||
                modelHint.toLowerCase().includes(m.name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "").toLowerCase())
              );
              if (match) {
                await _loadModelIntoNode(node, match.name);
                return;
              }
            }
          } catch {}
        }
      } catch (e) {
        console.warn("[CWK] Could not parse dropped image metadata:", e);
      }
    };
  },
});

// ─── Apply value ──────────────────────────────────────────────────────────────

function applyRowValue(node, rowIdx, val) {
  const row = INFO_ROWS[rowIdx];
  if (!node._cwkPreset) node._cwkPreset = {};
  node._cwkPreset[row.key] = val;
  const w = node.widgets?.find(w => w.name === row.widget);
  if (w) { w.value = val; w.callback?.(val); }
  app.canvas.setDirty(true, false);
}

// ─── Button dispatcher ────────────────────────────────────────────────────────

function handleButtonClick(node, key) {
  const getW = name => node.widgets?.find(w => w.name === name);

  if (key === "load") {
    getPanel().open(async modelName => {
      await _loadModelIntoNode(node, modelName);
    });
    return;
  }

  if (key === "reset") {
    const modelName = node._cwkModelName ?? getW("model_name")?.value;
    if (!modelName) return;
    apiFetch(`/cwk/preset?model=${encodeURIComponent(modelName)}`)
      .then(({ preset }) => {
        if (!preset) return;
        node._cwkPreset = { ...preset, batch_size: node._cwkPreset?.batch_size ?? 1, res_preset: "(preset)" };
        const map = {
          override_sampler:   preset.sampler_name ?? "(preset)",
          override_scheduler: preset.scheduler    ?? "(preset)",
          override_cfg:       preset.cfg          ?? 0,
          override_steps:     preset.steps        ?? 0,
          override_clip_skip: preset.clip_skip    ?? 0,
          override_width:     preset.width        ?? 0,
          override_height:    preset.height       ?? 0,
          override_rng:       preset.rng          ?? "(preset)",
          override_clip_name: preset.clip_name    ?? "(preset)",
          override_vae_name:  preset.vae_name     ?? "(preset)",
        };
        for (const [wn, val] of Object.entries(map)) {
          const w = getW(wn);
          if (w) { w.value = val; w.callback?.(val); }
        }
        node.setDirtyCanvas(true);
      })
      .catch(e => console.warn("[CWK] Reset failed:", e));
    return;
  }

  if (key === "update") {
    const modelName = node._cwkModelName ?? getW("model_name")?.value;
    if (!modelName) { alert("No model loaded."); return; }
    const p      = node._cwkPreset ?? {};
    const preset = {};
    if (p.sampler_name && p.sampler_name !== "(preset)") preset.sampler_name = p.sampler_name;
    if (p.scheduler    && p.scheduler    !== "(preset)") preset.scheduler    = p.scheduler;
    if (p.cfg      != null && Number(p.cfg)       !== 0) preset.cfg          = Number(p.cfg);
    if (p.steps    != null && Number(p.steps)     !== 0) preset.steps        = Number(p.steps);
    if (p.clip_skip!= null && Number(p.clip_skip) !== 0) preset.clip_skip    = Number(p.clip_skip);
    if (p.width    != null && Number(p.width)     !== 0) preset.width        = Number(p.width);
    if (p.height   != null && Number(p.height)    !== 0) preset.height       = Number(p.height);
    if (p.rng      && p.rng !== "(preset)")               preset.rng          = p.rng;
    if (p.clip_name)                                      preset.clip_name    = p.clip_name;
    if (p.vae_name)                                       preset.vae_name     = p.vae_name;
    apiFetch("/cwk/preset", {
      method: "POST",
      body:   JSON.stringify({ model: modelName, preset }),
    })
      .then(() => {
        node._cwkFlash = "update"; node._cwkFlashLabel = "✓ Saved!";
        app.canvas.setDirty(true, false);
        setTimeout(() => {
          node._cwkFlash = null; node._cwkFlashLabel = null;
          app.canvas.setDirty(true, false);
        }, 1800);
      })
      .catch(e => alert(`Failed to save preset: ${e.message}`));
    return;
  }
}

// ─── Singleton panel + apiFetch ───────────────────────────────────────────────

let _panel = null;
function getPanel() {
  if (!_panel) _panel = new ModelBrowserPanel();
  return _panel;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" }, ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}