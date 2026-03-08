/**
 * CWK Preset Manager — Model Info Modal
 */

function _fmtBytes(bytes) {
  if (!bytes) return "N/A";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _isVideo(url) {
  if (!url) return false;
  const l = url.toLowerCase();
  return l.includes(".mp4") || l.includes(".webm");
}

// Blur threshold for gallery images:
//   0=None, 1=Soft, 2=Mature, 3=X/Explicit, 4=XXX
// Only blur X and above (level >= 3)
const _INFO_NSFW_BLUR = 3;

function _makeOverlay() {
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.75);
    z-index:100000; display:flex; align-items:center; justify-content:center;
  `;
  return el;
}

function _injectInfoStyles() {
  if (document.getElementById("cwk-info-styles")) return;
  const st = document.createElement("style");
  st.id = "cwk-info-styles";
  st.textContent = `
    .cwk-info-box {
      background:#141824; border:1px solid #2a2f45; border-radius:12px;
      width:min(92vw,860px); max-height:88vh;
      display:flex; flex-direction:column;
      font-family:Inter,system-ui,sans-serif; color:#cdd6f4;
      box-shadow:0 24px 80px rgba(0,0,0,.75); overflow:hidden;
    }
    .cwk-info-header {
      background:#1a2035; border-bottom:1px solid #2a2f45;
      padding:16px 20px 12px; flex-shrink:0;
    }
    .cwk-info-title-row {
      display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
    }
    .cwk-info-model-name { font-size:20px; font-weight:700; color:#cdd6f4; flex:1; }
    .cwk-info-header-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
    .cwk-info-civitai-btn {
      display:inline-flex; align-items:center; gap:5px;
      padding:5px 12px; border-radius:6px;
      background:#313552; color:#89b4fa;
      font-size:12px; font-weight:600; text-decoration:none;
      border:1px solid #89b4fa; transition:background .15s;
    }
    .cwk-info-civitai-btn:hover { background:#2a2f45; }
    .cwk-info-close-btn {
      background:none; border:none; cursor:pointer;
      color:#6c7086; font-size:22px; line-height:1; padding:0 4px;
      transition:color .15s;
    }
    .cwk-info-close-btn:hover { color:#f38ba8; }

    .cwk-info-tags { display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; }
    .cwk-info-tag {
      padding:2px 9px; border-radius:4px;
      background:#1e2335; border:1px solid #313552;
      font-size:11px; color:#89b4fa;
    }
    .cwk-info-tags-loading { font-size:11px; color:#6c7086; margin-top:10px; font-style:italic; }

    .cwk-info-body {
      flex:1; overflow-y:auto; padding:16px 20px;
      display:flex; flex-direction:column; gap:12px; min-height:0;
    }
    .cwk-info-body::-webkit-scrollbar { width:6px; }
    .cwk-info-body::-webkit-scrollbar-track { background:#141824; }
    .cwk-info-body::-webkit-scrollbar-thumb { background:#313552; border-radius:3px; }

    .cwk-info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .cwk-info-cell {
      background:#1e2335; border:1px solid #313552; border-radius:8px;
      padding:10px 14px; min-width:0; overflow:hidden;
    }
    .cwk-info-cell-wide { grid-column:1/-1; }
    .cwk-info-cell-split {
      display:flex; background:#1e2335; border:1px solid #313552;
      border-radius:8px; overflow:hidden;
    }
    .cwk-info-cell-split > div { flex:1; padding:10px 14px; min-width:0; }
    .cwk-info-cell-split > div + div { border-left:1px solid #313552; }
    .cwk-info-label {
      font-size:10px; color:#6c7086; font-weight:700;
      text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px;
    }
    .cwk-info-value {
      font-size:13px; color:#cdd6f4; font-weight:500;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .cwk-info-path { font-size:11px; color:#89b4fa; word-break:break-all; white-space:normal; }

    .cwk-info-about {
      background:#1e2335; border:1px solid #313552; border-radius:8px; padding:12px 14px;
    }
    .cwk-info-about-text {
      font-size:12px; color:#a6adc8; margin-top:6px; line-height:1.6; white-space:pre-wrap;
    }

    .cwk-info-tabs { display:flex; border-bottom:2px solid #2a2f45; flex-shrink:0; }
    .cwk-info-tab {
      padding:9px 20px; background:none; border:none; border-bottom:2px solid transparent;
      margin-bottom:-2px; color:#6c7086; font-size:13px; font-weight:600;
      cursor:pointer; transition:color .15s, border-color .15s;
    }
    .cwk-info-tab:hover { color:#cdd6f4; }
    .cwk-info-tab.active { color:#89b4fa; border-bottom-color:#89b4fa; }
    .cwk-info-tab-pane { display:none; padding-top:10px; }
    .cwk-info-tab-pane.active { display:block; }

    .cwk-info-image-grid {
      display:grid; grid-template-columns:repeat(auto-fill, minmax(130px,1fr)); gap:8px;
    }
    .cwk-info-image-card {
      position:relative; border-radius:6px; overflow:hidden; background:#1e2335;
      aspect-ratio:2/3; border:2px solid transparent; cursor:pointer; transition:border-color .15s;
    }
    .cwk-info-image-card:hover { border-color:#89b4fa; }
    .cwk-info-image-card img, .cwk-info-image-card video {
      width:100%; height:100%; object-fit:cover; display:block; transition:filter .2s;
    }
    .cwk-info-image-card.blurred img,
    .cwk-info-image-card.blurred video { filter:blur(14px) brightness(.6); }

    /* Eye button — always visible on NSFW cards, top-left corner */
    .cwk-info-eye-btn {
      position:absolute; top:5px; left:5px;
      background:rgba(20,24,36,.80); border:1px solid #313552;
      border-radius:4px; padding:2px 5px; font-size:12px;
      cursor:pointer; z-index:2; color:#cdd6f4;
      transition:background .15s; line-height:1.4;
      pointer-events:all;
    }
    .cwk-info-eye-btn:hover { background:rgba(137,180,250,.3); }

    .cwk-info-desc-wrap { font-size:13px; color:#a6adc8; line-height:1.7; }
    .cwk-info-desc-wrap h1,.cwk-info-desc-wrap h2,.cwk-info-desc-wrap h3 {
      color:#cdd6f4; margin:.6em 0 .3em;
    }
    .cwk-info-desc-wrap p  { margin:.4em 0; }
    .cwk-info-desc-wrap a  { color:#89b4fa; }
    .cwk-info-desc-wrap img { max-width:100%; border-radius:4px; }
    .cwk-info-desc-wrap ul,.cwk-info-desc-wrap ol { padding-left:1.4em; }

    .cwk-info-placeholder { padding:24px; text-align:center; color:#6c7086; font-size:13px; }

    .cwk-lightbox {
      position:fixed; inset:0; background:rgba(0,0,0,.92);
      z-index:100001; display:flex; align-items:center; justify-content:center;
    }
    .cwk-lightbox img,.cwk-lightbox video {
      max-width:90vw; max-height:90vh; object-fit:contain; border-radius:6px;
    }
    .cwk-lightbox-close {
      position:absolute; top:20px; right:24px;
      background:none; border:none; color:#fff; font-size:28px; cursor:pointer;
    }
  `;
  document.head.appendChild(st);
}

// ─── Tag rendering helper ─────────────────────────────────────────────────────

function _renderTagsInto(el, tags) {
  if (!el) return;
  if (!Array.isArray(tags) || !tags.length) {
    el.innerHTML = "";
    el.className = "";
    return;
  }
  el.className = "cwk-info-tags";
  el.innerHTML = tags.map(t => `<span class="cwk-info-tag">${_esc(t)}</span>`).join("");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function showModelInfo(model, civitaiApiKey = "") {
  _injectInfoStyles();

  const overlay = _makeOverlay();
  document.body.appendChild(overlay);

  const c           = model.civitai ?? {};
  const displayName = c.civitai_name
    ?? model.name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const baseModel   = c.base_model   ?? "Unknown";
  const versionName = c.version_name ?? "N/A";
  const shortDesc   = c.description  ?? "";
  const modelId     = c.model_id;
  const images      = c.images       ?? [];
  const fileName    = model.name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const fullPath    = model.file_path || model.name;
  const sizeStr     = _fmtBytes(model.file_size ?? 0);
  const civitaiUrl  = modelId ? `https://civitai.com/models/${modelId}` : null;

  // OLD — treats [] as "confirmed no tags", never fetches:
  // const tagsState = Array.isArray(c.tags) ? "ready" : "fetch";

  // NEW — [] is treated as "unknown, fetch to confirm":
  const tagsState = (Array.isArray(c.tags) && c.tags.length > 0) ? "ready" : "fetch";
  const initialTags = tagsState === "ready" ? c.tags : [];

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const box = document.createElement("div");
  box.className = "cwk-info-box";

  box.innerHTML = `
    <div class="cwk-info-header">
      <div class="cwk-info-title-row">
        <span class="cwk-info-model-name">${_esc(displayName)}</span>
        <div class="cwk-info-header-actions">
          ${civitaiUrl
            ? `<a class="cwk-info-civitai-btn" href="${civitaiUrl}" target="_blank" rel="noopener">🌐 View on CivitAI</a>`
            : ""}
          <button class="cwk-info-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div id="cwk-tags-el" class="${initialTags.length ? "cwk-info-tags" : (tagsState === "fetch" && modelId ? "cwk-info-tags-loading" : "")}">
        ${initialTags.length
          ? initialTags.map(t => `<span class="cwk-info-tag">${_esc(t)}</span>`).join("")
          : (tagsState === "fetch" && modelId ? "Loading tags…" : "")}
      </div>
    </div>

    <div class="cwk-info-body">
      <div class="cwk-info-grid">
        <div class="cwk-info-cell">
          <div class="cwk-info-label">Version</div>
          <div class="cwk-info-value">${_esc(versionName)}</div>
        </div>
        <div class="cwk-info-cell">
          <div class="cwk-info-label">File Name</div>
          <div class="cwk-info-value">${_esc(fileName)}</div>
        </div>
        <div class="cwk-info-cell cwk-info-cell-wide">
          <div class="cwk-info-label">Location</div>
          <div class="cwk-info-value cwk-info-path">${_esc(fullPath)}</div>
        </div>
        <div class="cwk-info-cell-split">
          <div>
            <div class="cwk-info-label">Base Model</div>
            <div class="cwk-info-value">${_esc(baseModel)}</div>
          </div>
          <div>
            <div class="cwk-info-label">Size</div>
            <div class="cwk-info-value">${_esc(sizeStr)}</div>
          </div>
        </div>
      </div>

      ${shortDesc ? `
        <div class="cwk-info-about">
          <div class="cwk-info-label">About this version</div>
          <div class="cwk-info-about-text">${_esc(shortDesc)}</div>
        </div>` : ""}

      <div class="cwk-info-tabs">
        <button class="cwk-info-tab active" data-tab="examples">Examples</button>
        <button class="cwk-info-tab" data-tab="description">Model Description</button>
      </div>

      <div id="cwk-info-pane-examples" class="cwk-info-tab-pane active">
        <div class="cwk-info-image-grid" id="cwk-info-image-grid">
          <div class="cwk-info-placeholder">Loading images…</div>
        </div>
      </div>

      <div id="cwk-info-pane-description" class="cwk-info-tab-pane">
        <div class="cwk-info-desc-wrap" id="cwk-info-desc-wrap">
          <div class="cwk-info-placeholder">Click to load description…</div>
        </div>
      </div>
    </div>
  `;

  overlay.appendChild(box);

  const tagsEl  = box.querySelector("#cwk-tags-el");
  const descWrap = box.querySelector("#cwk-info-desc-wrap");

  // ── Close ──────────────────────────────────────────────────────────────────
  box.querySelector(".cwk-info-close-btn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  // ── Tags: fetch live from model-description endpoint when not in cache ──────
  // The model-description endpoint calls GET /models/{id} which has tags at
  // the top level. It also writes them back to the cache on the server side.
  if (tagsState === "fetch" && modelId) {
    const tagUrl = `/cwk/civitai/model-description?model=${encodeURIComponent(model.name)}`
      + (civitaiApiKey ? `&api_key=${encodeURIComponent(civitaiApiKey)}` : "");

    fetch(tagUrl)
      .then(r => r.json())
      .then(d => {
        console.log("[CWK] model-description response for tags:", d);
        const tags = Array.isArray(d.tags) ? d.tags : [];
        // Update in-memory model so next open is instant
        if (model.civitai) model.civitai.tags = tags;
        _renderTagsInto(tagsEl, tags);
      })
      .catch(err => {
        console.warn("[CWK] Failed to fetch tags:", err);
        if (tagsEl) tagsEl.innerHTML = "";
      });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  let descLoaded = false;

  box.querySelectorAll(".cwk-info-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      box.querySelectorAll(".cwk-info-tab").forEach(b => b.classList.remove("active"));
      box.querySelectorAll(".cwk-info-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      box.querySelector(`#cwk-info-pane-${btn.dataset.tab}`)?.classList.add("active");

      if (btn.dataset.tab === "description" && !descLoaded) {
        descLoaded = true;
        descWrap.innerHTML = `<div class="cwk-info-placeholder">Loading description…</div>`;

        if (!modelId) {
          descWrap.innerHTML = `<div class="cwk-info-placeholder">No CivitAI data — run Fetch Thumbnails first.</div>`;
          return;
        }

        const url = `/cwk/civitai/model-description?model=${encodeURIComponent(model.name)}`
          + (civitaiApiKey ? `&api_key=${encodeURIComponent(civitaiApiKey)}` : "");

        fetch(url)
          .then(r => r.json())
          .then(d => {
            if (d.error) {
              descWrap.innerHTML = `<div class="cwk-info-placeholder">⚠ ${_esc(d.error)}</div>`;
              return;
            }
            descWrap.innerHTML = d.description
              ? d.description
              : `<div class="cwk-info-placeholder">No description available on CivitAI.</div>`;
            // Opportunistically update tags if the tags fetch hadn't fired yet
            if (tagsState === "fetch" && Array.isArray(d.tags) && tagsEl) {
              if (model.civitai) model.civitai.tags = d.tags;
              _renderTagsInto(tagsEl, d.tags);
            }
          })
          .catch(e => {
            descWrap.innerHTML = `<div class="cwk-info-placeholder">Failed to load: ${_esc(e.message)}</div>`;
          });
      }
    });
  });

  // ── Image grid ──────────────────��──────────────────────────────────────────
  const gridEl = box.querySelector("#cwk-info-image-grid");

  function _renderImages(imgs) {
    if (!imgs?.length) {
      gridEl.innerHTML = `<div class="cwk-info-placeholder">No example images available.</div>`;
      return;
    }
    gridEl.innerHTML = "";

    for (const img of imgs) {
      const url    = typeof img === "string" ? img : img.url;
      // nsfwLevel already normalised 0-4 by server. Blur at >= 3 (X/XXX only)
      const lvl    = img?.nsfwLevel ?? 0;
      const isNsfw = lvl >= _INFO_NSFW_BLUR;

      const card   = document.createElement("div");
      card.className = "cwk-info-image-card" + (isNsfw ? " blurred" : "");

      const mediaSrc = _isVideo(url)
        ? `<video src="${_esc(url)}" muted autoplay loop playsinline></video>`
        : `<img src="${_esc(url)}" loading="lazy"/>`;

      card.innerHTML = mediaSrc
        + (isNsfw ? `<button class="cwk-info-eye-btn" title="Toggle blur">🙈</button>` : "");

      if (isNsfw) {
        const eye = card.querySelector(".cwk-info-eye-btn");
        eye.addEventListener("click", e => {
          e.stopPropagation();
          const blurred = card.classList.toggle("blurred");
          eye.textContent = blurred ? "🙈" : "👁";
          eye.title       = blurred ? "Reveal image" : "Blur image";
        });
      }

      // Click card → lightbox (only when not blurred)
      card.addEventListener("click", () => {
        if (card.classList.contains("blurred")) return;
        const lb = document.createElement("div");
        lb.className = "cwk-lightbox";
        lb.innerHTML = _isVideo(url)
          ? `<video src="${_esc(url)}" controls autoplay loop></video>`
          : `<img src="${_esc(url)}"/>`;
        const cls = document.createElement("button");
        cls.className = "cwk-lightbox-close"; cls.textContent = "✕";
        cls.onclick = () => lb.remove();
        lb.appendChild(cls);
        lb.addEventListener("click", e => { if (e.target === lb) lb.remove(); });
        document.body.appendChild(lb);
      });

      gridEl.appendChild(card);
    }
  }

  if (images.length > 0) {
    _renderImages(images);
  } else {
    fetch(`/cwk/civitai/images?model=${encodeURIComponent(model.name)}`)
      .then(r => r.json())
      .then(d => _renderImages(d.images ?? []))
      .catch(() => _renderImages([]));
  }
}