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
const THUMB_H     = 160;
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
// Number of output slots: MODEL, CLIP, VAE, sampler_name, scheduler,
// cfg, steps, clip_skip, width, height  (rng removed — applied internally)
const N_OUTPUTS = 9;

function getSlotsBottom() {
  return TITLE_H() + N_OUTPUTS * SLOT_H() + 6;
}

// ─── Row descriptors ──────────────────────────────────────────────────────────

// Start with sensible fallbacks — overwritten async once object_info loads
let SAMPLERS   = ["euler","euler_ancestral","dpmpp_2m","dpmpp_2m_sde",
                  "dpmpp_sde","dpmpp_3m_sde","ddim","uni_pc","lcm"];
let SCHEDULERS = ["normal","karras","exponential","sgm_uniform","simple","beta"];
const RNGS     = ["cpu","gpu"];

// Fetch the real lists from ComfyUI and patch INFO_ROWS in place
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
  } catch (e) {
    console.warn("[CWK] Could not load sampler options from object_info:", e);
  }
}

const INFO_ROWS = [
  { key: "sampler_name", label: "Sampler",   widget: "override_sampler",   type: "list",  options: SAMPLERS   },
  { key: "scheduler",    label: "Scheduler", widget: "override_scheduler", type: "list",  options: SCHEDULERS },
  { key: "cfg",          label: "CFG",       widget: "override_cfg",       type: "float", min: 0,   max: 30   },
  { key: "steps",        label: "Steps",     widget: "override_steps",     type: "int",   min: 1,   max: 200  },
  { key: "clip_skip",    label: "Clip skip", widget: "override_clip_skip", type: "int",   min: -24, max: -1   },
  { key: "width",        label: "Width",     widget: "override_width",     type: "int",   min: 64,  max: 8192 },
  { key: "height",       label: "Height",    widget: "override_height",    type: "int",   min: 64,  max: 8192 },
  { key: "rng",          label: "RNG",       widget: "override_rng",       type: "list",  options: RNGS       },
];

// Kick off the fetch immediately — by the time the user clicks a dropdown
// it will have resolved. INFO_ROWS[0].options and [1].options are updated in place.
_loadSamplerOptions();

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
  return { x: PAD, y: TITLE_H() + PAD, w: THUMB_W, h: THUMB_H };
}
function getInfoAreaX()     { return PAD + THUMB_W + PAD; }
function getInfoAreaW(node) { return node.size[0] - getInfoAreaX() - PAD; }

function getRowsStartY(node) {
  const thumbBottom = TITLE_H() + PAD + THUMB_H + PAD;
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

// ─── Modal number editor ──────────────────────────────────────────────────────
// Uses a full-screen backdrop so the input is never competing with the canvas
// for focus. The backdrop intercepts all mouse events so LiteGraph never sees
// them, which means nothing steals focus away from our input.

// ─── Modal number editor ──────────────────────────────────────────────────────

function openNumberModal(row, currentValue, screenX, screenY, onCommit) {
  closeNumberModal();

  const backdrop = document.createElement("div");
  backdrop.id = "cwk-num-modal-backdrop";
  Object.assign(backdrop.style, {
    position:   "fixed",
    inset:      "0",
    zIndex:     "99998",
    background: "transparent",
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    position:     "fixed",
    zIndex:       "99999",
    background:   C.bgFull,
    border:       `1px solid ${C.arrowHov}`,
    borderRadius: "8px",
    padding:      "16px 20px",
    minWidth:     "200px",
    boxShadow:    "0 8px 32px rgba(0,0,0,0.6)",
    display:      "flex",
    flexDirection:"column",
    gap:          "10px",
    fontFamily:   "Inter, system-ui, sans-serif",
  });

  const label = document.createElement("div");
  label.textContent = row.label;
  Object.assign(label.style, {
    color:         C.textDim,
    fontSize:      "11px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  });

  const input = document.createElement("input");
  input.type      = "text";
  input.inputMode = "numeric";
  input.value     = String(currentValue ?? "");
  Object.assign(input.style, {
    background:   C.surface,
    color:        C.text,
    border:       `1px solid ${C.border}`,
    borderRadius: "4px",
    padding:      "6px 10px",
    fontSize:     "14px",
    outline:      "none",
    width:        "100%",
    boxSizing:    "border-box",
    textAlign:    "center",
  });
  input.addEventListener("focus", () => { input.style.borderColor = C.arrowHov; });
  input.addEventListener("blur",  () => { input.style.borderColor = C.border;   });

  const hint = document.createElement("div");
  hint.textContent = `Range: ${row.min ?? "—"} → ${row.max ?? "—"}`;
  Object.assign(hint.style, { color: C.textDim, fontSize: "10px", textAlign: "center" });

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, { display: "flex", gap: "8px" });

  const mkBtn = (text, primary) => {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      flex:       "1",
      padding:    "6px",
      borderRadius:"4px",
      border:     `1px solid ${primary ? C.arrowHov : C.border}`,
      background: primary ? C.hoverBg : C.surface,
      color:      primary ? C.arrowHov : C.textDim,
      cursor:     "pointer",
      fontSize:   "12px",
      fontFamily: "Inter, system-ui, sans-serif",
    });
    return b;
  };

  const okBtn     = mkBtn("✓ OK",     true);
  const cancelBtn = mkBtn("✕ Cancel", false);
  btnRow.appendChild(okBtn);
  btnRow.appendChild(cancelBtn);

  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(hint);
  dialog.appendChild(btnRow);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Position dialog near the click, then clamp so it stays on screen
  // We need to append first so we can read offsetWidth/offsetHeight
  requestAnimationFrame(() => {
    const dw = dialog.offsetWidth  || 200;
    const dh = dialog.offsetHeight || 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let x = screenX + 8;   // slight offset so cursor doesn't overlap
    let y = screenY + 8;

    // Clamp to viewport
    if (x + dw + margin > vw) x = screenX - dw - 8;
    if (y + dh + margin > vh) y = screenY - dh - 8;
    x = Math.max(margin, x);
    y = Math.max(margin, y);

    dialog.style.left = x + "px";
    dialog.style.top  = y + "px";
  });

  input.focus();
  input.select();

  dialog.addEventListener("mousedown", e => e.stopPropagation());

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const raw = input.value.trim();
    closeNumberModal();
    if (raw !== "") onCommit(clampValue(row, raw));
    app.canvas.setDirty(true, false);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    closeNumberModal();
    app.canvas.setDirty(true, false);
  };

  okBtn.addEventListener("click",      commit);
  cancelBtn.addEventListener("click",  cancel);
  backdrop.addEventListener("mousedown", cancel);

  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  { e.preventDefault(); commit(); }
    if (e.key === "Escape") { cancel(); }
  });
}

function closeNumberModal() {
  const el = document.getElementById("cwk-num-modal-backdrop");
  if (el) el.remove();
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

let _dropdownOutside = null;

function openDropdown(node, rowIdx, currentValue, onCommit) {
  closeDropdown();
  closeNumberModal();

  const row  = INFO_ROWS[rowIdx];
  const vr   = getValueRect(node, rowIdx);
  const bbox = app.canvas.canvas.getBoundingClientRect();
  const zoom = app.canvas.ds?.scale ?? 1;
  const off  = app.canvas.ds?.offset ?? [0, 0];

  const cx = (node.pos[0] + vr.x) * zoom + off[0] * zoom + bbox.left;
  const cy = (node.pos[1] + vr.y) * zoom + off[1] * zoom + bbox.top;

  const sel = document.createElement("select");
  sel.id    = "cwk-node-dropdown";
  Object.assign(sel.style, {
    position:     "fixed",
    left:         cx + "px",
    top:          cy + "px",
    width:        (vr.w * zoom) + "px",
    height:       (vr.h * zoom) + "px",
    fontSize:     Math.round(11 * zoom) + "px",
    fontFamily:   "Inter, system-ui, sans-serif",
    background:   C.bgFull,
    color:        C.text,
    border:       `1px solid ${C.arrowHov}`,
    borderRadius: "3px",
    outline:      "none",
    zIndex:       "99999",
    cursor:       "pointer",
    padding:      "0 4px",
  });

  for (const opt of row.options) {
    const o = document.createElement("option");
    o.value = opt; o.textContent = opt;
    if (String(currentValue) === opt) o.selected = true;
    sel.appendChild(o);
  }

  sel.addEventListener("mousedown", e => e.stopPropagation());
  sel.addEventListener("mouseup",   e => e.stopPropagation());
  sel.addEventListener("click",     e => e.stopPropagation());
  document.body.appendChild(sel);
  sel.focus();
  setTimeout(() => sel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), 0);

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = sel.value;
    closeDropdown();
    onCommit(val);
    app.canvas.setDirty(true, false);
  };

  sel.addEventListener("change", commit);
  sel.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter")  { e.preventDefault(); commit(); }
    if (e.key === "Escape") { committed = true; closeDropdown(); app.canvas.setDirty(true, false); }
  });

  _dropdownOutside = (e) => { if (e.target !== sel) commit(); };
  setTimeout(() => {
    document.addEventListener("mousedown", _dropdownOutside, { capture: true });
  }, 100);
}

function closeDropdown() {
  const el = document.getElementById("cwk-node-dropdown");
  if (el) el.remove();
  if (_dropdownOutside) {
    document.removeEventListener("mousedown", _dropdownOutside, { capture: true });
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

  // ── Thumbnail ─────────────────────────────────────────────────────────────
  const img = loadImage(meta.thumbnail ?? null);
  roundRect(ctx, thumbR.x, thumbR.y, thumbR.w, thumbR.h, 6);
  ctx.fillStyle = C.surface; ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();

  if (img?.complete && img.naturalWidth > 0) {
    ctx.save();
    roundRect(ctx, thumbR.x, thumbR.y, thumbR.w, thumbR.h, 6);
    ctx.clip();
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

  // ── Model info ────────────────────────────────────────────────────────────
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

  // ── Divider ───────────────────────────────────────────────────────────────
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath();
  const divY = getRowsStartY(node) - PAD/2;
  ctx.moveTo(PAD, divY); ctx.lineTo(w - PAD, divY);
  ctx.stroke();

  // ── Preset rows ───────────────────────────────────────────────────────────
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
    ctx.fillStyle   = C.surface;
    ctx.strokeStyle = isHov ? C.border : "transparent";
    ctx.lineWidth   = 1; ctx.fill(); if (isHov) ctx.stroke();

    if (row.type === "list") {
      ctx.fillStyle = isHov ? C.arrowHov : C.textDim;
      ctx.font = "9px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("▾", vr.x + vr.w - 5, ry + ROW_H/2);
      ctx.fillStyle = C.text; ctx.font = "11px Inter,system-ui,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(val), vr.x + 6, ry + ROW_H/2, vr.w - 18);
    } else {
      ctx.font = "10px sans-serif"; ctx.textBaseline = "middle";
      ctx.fillStyle = (hovPart === "left")  ? C.arrowHov : C.textDim;
      ctx.textAlign = "left";
      ctx.fillText("◀", vr.x + 4, ry + ROW_H/2);
      ctx.fillStyle = (hovPart === "right") ? C.arrowHov : C.textDim;
      ctx.textAlign = "right";
      ctx.fillText("▶", vr.x + vr.w - 4, ry + ROW_H/2);
      ctx.fillStyle = (hovPart === "center") ? C.arrowHov : C.text;
      ctx.font = "11px Inter,system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(val), vr.x + vr.w/2, ry + ROW_H/2, vr.w - ARROW_W*2 - 4);
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────
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

      setTimeout(() => {
        for (const w of node.widgets ?? []) {
          w.type = "hidden"; w.hidden = true;
          w.computeSize = () => [0, -4];
        }
        node.size[0] = Math.max(node.size[0], NODE_MIN_W);
        node.size[1] = calcNodeHeight(node);
        app.canvas.setDirty(true, true);
      }, 0);

      node.onDrawForeground = function (ctx) { drawNode(this, ctx); };

      node.onResize = function () {
        this.size[0] = Math.max(NODE_MIN_W, this.size[0]);
        this.size[1] = calcNodeHeight(this);
      };

      // ── Mouse down — everything fires here, reliably ───────────────────────
      node.onMouseDown = function (e, pos) {
        // Buttons
        const btnKey = hitTestButton(this, pos[0], pos[1]);
        if (btnKey) {
          handleButtonClick(node, btnKey);
          return true;
        }

        const hit = hitTestRow(this, pos[0], pos[1]);
        if (!hit || hit.part === null) return false;

        const { rowIdx, part } = hit;
        const row = INFO_ROWS[rowIdx];
        const cur = node._cwkPreset?.[row.key];

        // Dropdown list
        if (row.type === "list") {
          openDropdown(node, rowIdx, cur, val => applyRowValue(node, rowIdx, val));
          return true;
        }

        // Arrow steps
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

        // Center value — open modal near the click position
        if (part === "center") {
          openNumberModal(row, cur, e.clientX, e.clientY, val => applyRowValue(node, rowIdx, val));
          return true;
        }

        return false;
      };

      // ── Mouse move → hover ─────────────────────────────────────────────────
      node.onMouseMove = function (e, pos) {
        const btnKey = hitTestButton(this, pos[0], pos[1]);
        if (btnKey) {
          if (!node._cwkHover || node._cwkHover.key !== btnKey) {
            node._cwkHover = { key: btnKey };
            app.canvas.setDirty(true, false);
          }
          return;
        }
        const hit    = hitTestRow(this, pos[0], pos[1]);
        const newHov = hit ? { rowIdx: hit.rowIdx, part: hit.part } : null;
        if (JSON.stringify(node._cwkHover) !== JSON.stringify(newHov)) {
          node._cwkHover = newHov;
          app.canvas.setDirty(true, false);
        }
      };

      node.onMouseLeave = function () {
        if (node._cwkHover !== null) {
          node._cwkHover = null;
          app.canvas.setDirty(true, false);
        }
      };
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
          const map = {
            override_sampler:   preset.sampler_name,
            override_scheduler: preset.scheduler,
            override_cfg:       preset.cfg,
            override_steps:     preset.steps,
            override_clip_skip: preset.clip_skip,
            override_width:     preset.width,
            override_height:    preset.height,
            override_rng:       preset.rng,
          };
          for (const [wn, val] of Object.entries(map)) {
            const w = getW(wn);
            if (w && val !== undefined) { w.value = val; w.callback?.(val); }
          }
        }
      } catch {}
      node.setDirtyCanvas(true);
    });
    return;
  }

  if (key === "reset") {
    const modelName = node._cwkModelName ?? getW("model_name")?.value;
    if (!modelName) return;
    apiFetch(`/cwk/preset?model=${encodeURIComponent(modelName)}`)
      .then(({ preset }) => {
        if (!preset) return;
        node._cwkPreset = { ...preset };
        const map = {
          override_sampler:   preset.sampler_name ?? "(preset)",
          override_scheduler: preset.scheduler    ?? "(preset)",
          override_cfg:       preset.cfg          ?? 0,
          override_steps:     preset.steps        ?? 0,
          override_clip_skip: preset.clip_skip    ?? 0,
          override_width:     preset.width        ?? 0,
          override_height:    preset.height       ?? 0,
          override_rng:       preset.rng          ?? "(preset)",
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