/**
 * CWK Preset Manager — Context menu, image picker, version checker.
 *
 * Exports
 * ───────
 *   isVideoUrl(url)
 *   fmtSize(kb)
 *   closeContextMenu()
 *   showContextMenu(x, y, items)
 *   showImagePicker(modelName, images, onPick)
 *   showVersionChecker(modelName, apiKey, onDownloadDone)
 */

// ─── Utilities ────────────────────────────────────────────────────────────────

export function isVideoUrl(url) {
  if (!url) return false;
  try {
    const p = new URL(url).pathname.toLowerCase();
    return p.endsWith(".mp4") || p.endsWith(".webm");
  } catch {
    const l = url.toLowerCase();
    return l.includes(".mp4") || l.includes(".webm");
  }
}

export function fmtSize(kb) {
  if (!kb) return "";
  if (kb > 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb > 1024)        return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _overlay() {
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.75);
    z-index:99998; display:flex; align-items:center; justify-content:center;
  `;
  return el;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

let _activeMenu = null;

export function closeContextMenu() {
  if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
}

/**
 * Show a floating context menu.
 * items: Array of { icon?, label, action, danger?, disabled? } | "---"
 */
export function showContextMenu(x, y, items) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.style.cssText = `
    position:fixed; left:${x}px; top:${y}px; z-index:99999;
    background:#1a2035; border:1px solid #313552; border-radius:8px;
    padding:4px 0; min-width:224px;
    box-shadow:0 8px 32px rgba(0,0,0,.65);
    font-family:Inter,system-ui,sans-serif; font-size:13px; color:#cdd6f4;
  `;

  for (const item of items) {
    if (item === "---") {
      const sep = document.createElement("div");
      sep.style.cssText = "height:1px;background:#2a2f45;margin:4px 0;";
      menu.appendChild(sep);
      continue;
    }

    const el = document.createElement("div");
    el.style.cssText = `
      padding:8px 14px; cursor:pointer;
      display:flex; align-items:center; gap:8px;
      transition:background .1s;
      ${item.danger   ? "color:#f38ba8;"                   : ""}
      ${item.disabled ? "opacity:.4;pointer-events:none;"  : ""}
    `;
    el.innerHTML =
      `<span style="font-size:15px;width:18px;text-align:center">${item.icon ?? ""}</span>` +
      _esc(item.label);

    el.addEventListener("mouseenter", () => { el.style.background = "#2a2f45"; });
    el.addEventListener("mouseleave", () => { el.style.background = ""; });
    el.addEventListener("click",      () => { closeContextMenu(); item.action?.(); });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  _activeMenu = menu;

  // Clamp to viewport after first paint
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + "px";
    if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + "px";
  });

  // Close on next outside click
  setTimeout(() =>
    document.addEventListener("click", closeContextMenu, { once: true }), 0);
}

// ─── Image picker modal ───────────────────────────────────────────────────────

/**
 * Show a grid of CivitAI images so the user can pick one as the card thumbnail.
 * images  : array of { url, nsfwLevel? } objects, or plain URL strings
 * onPick  : (url: string) => void
 */
export function showImagePicker(modelName, images, onPick) {
  const overlay = _overlay();
  const box     = document.createElement("div");

  box.style.cssText = `
    background:#141824; border:1px solid #2a2f45; border-radius:10px;
    padding:18px; max-width:820px; width:90vw; max-height:72vh;
    display:flex; flex-direction:column; gap:12px;
    font-family:Inter,sans-serif; color:#cdd6f4;
  `;
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-weight:700;color:#89b4fa;font-size:14px">
        Pick Thumbnail — ${_esc(modelName)}
        (${images.length} image${images.length !== 1 ? "s" : ""})
      </span>
      <button id="cwk-pk-close"
        style="background:none;border:none;color:#6c7086;font-size:20px;cursor:pointer">✕</button>
    </div>
    <div id="cwk-pk-grid" style="
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(130px,1fr));
      gap:8px; overflow-y:auto; flex:1; padding:4px;
    "></div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#cwk-pk-close").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const grid = box.querySelector("#cwk-pk-grid");

  for (const img of images) {
    const url  = typeof img === "string" ? img : img.url;
    if (!url) continue;
    const nsfw = (img?.nsfwLevel ?? 0) > 1;
    const blur = nsfw ? "filter:blur(12px);" : "";

    const card = document.createElement("div");
    card.style.cssText = `
      position:relative; border-radius:6px; overflow:hidden; cursor:pointer;
      border:2px solid transparent; aspect-ratio:2/3; background:#1e2335;
      transition:border-color .15s;
    `;
    card.innerHTML = isVideoUrl(url)
      ? `<video src="${_esc(url)}" muted autoplay loop playsinline
           style="width:100%;height:100%;object-fit:cover;${blur}"></video>`
      : `<img src="${_esc(url)}" loading="lazy"
           style="width:100%;height:100%;object-fit:cover;${blur}"/>`;

    card.addEventListener("mouseenter", () => { card.style.borderColor = "#89b4fa"; });
    card.addEventListener("mouseleave", () => { card.style.borderColor = "transparent"; });
    card.addEventListener("click",      () => { onPick(url); overlay.remove(); });
    grid.appendChild(card);
  }
}

// ─── Version checker modal ────────────────────────────────────────────────────

/**
 * Fetch and display all CivitAI versions for a model.
 * Shows newest-first; each row has a Download button that streams progress.
 *
 * modelName      : string
 * apiKey         : string
 * onDownloadDone : () => void   — called after a successful download
 */
export function showVersionChecker(modelName, apiKey, onDownloadDone) {
  const overlay = _overlay();
  const box     = document.createElement("div");

  box.style.cssText = `
    background:#141824; border:1px solid #2a2f45; border-radius:10px;
    padding:18px; max-width:700px; width:90vw; max-height:75vh;
    display:flex; flex-direction:column; gap:12px;
    font-family:Inter,sans-serif; color:#cdd6f4;
  `;
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-weight:700;color:#89b4fa;font-size:14px">
        Model Versions — ${_esc(modelName)}
      </span>
      <button id="cwk-ver-close"
        style="background:none;border:none;color:#6c7086;font-size:20px;cursor:pointer">✕</button>
    </div>
    <div id="cwk-ver-list"
      style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px;">
      <div style="color:#6c7086;font-size:13px;padding:8px 0">Loading versions…</div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#cwk-ver-close").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const list = box.querySelector("#cwk-ver-list");

  // ── Fetch version list ─────────────────────────────────────────────────────
  fetch(
    `/cwk/civitai/versions` +
    `?model=${encodeURIComponent(modelName)}` +
    `&api_key=${encodeURIComponent(apiKey)}`
  )
    .then(r => r.json())
    .then(({ versions, error }) => {
      if (error) {
        list.innerHTML =
          `<div style="color:#f38ba8;font-size:13px;padding:8px 0">${_esc(error)}</div>`;
        return;
      }
      if (!versions?.length) {
        list.innerHTML =
          `<div style="color:#6c7086;font-size:13px;padding:8px 0">No versions found.</div>`;
        return;
      }

      list.innerHTML = "";

      for (const v of versions) {
        const row   = document.createElement("div");
        const thumb = v.images?.[0]?.url ?? "";
        const size  = fmtSize(v.size_kb);
        const date  = v.created_at?.slice(0, 10) ?? "";

        row.style.cssText = `
          background:#1e2335; border:1px solid #313552; border-radius:8px;
          padding:12px; display:flex; align-items:center; gap:12px;
        `;
        row.innerHTML = `
          ${thumb
            ? `<img src="${_esc(thumb)}"
                 style="width:48px;height:64px;object-fit:cover;
                        border-radius:4px;flex-shrink:0"
                 loading="lazy"/>`
            : `<div style="width:48px;height:64px;background:#181d2e;border-radius:4px;
                           display:flex;align-items:center;justify-content:center;
                           font-size:20px;flex-shrink:0">🖼</div>`}
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;
                        ${v.is_installed ? "color:#a6e3a1" : ""}">
              ${_esc(v.name)}${v.is_installed ? " <span style='font-size:11px'>✓ installed</span>" : ""}
            </div>
            <div style="font-size:11px;color:#6c7086;margin-top:3px">
              ${[v.base_model, size, date].filter(Boolean).map(_esc).join(" · ")}
            </div>
            ${v.filename
              ? `<div style="font-size:10px;color:#45475a;margin-top:2px;
                             white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                   ${_esc(v.filename)}
                 </div>`
              : ""}
          </div>
          <div style="flex-shrink:0">
            ${!v.is_installed && v.download_url
              ? `<button class="cwk-ver-dl"
                   data-url="${_esc(v.download_url)}"
                   data-fn="${_esc(v.filename)}"
                   style="padding:6px 12px;border-radius:6px;border:none;
                          background:#89b4fa;color:#1e1e2e;
                          font-size:12px;font-weight:700;cursor:pointer;
                          min-width:90px;text-align:center">
                   ⬇ Download
                 </button>`
              : ""}
          </div>
        `;
        list.appendChild(row);
      }

      // ── Wire up download buttons ─────────────────────────────────────────
      list.querySelectorAll(".cwk-ver-dl").forEach(btn => {
        btn.addEventListener("click", async () => {
          const dlUrl = btn.dataset.url;
          const fn    = btn.dataset.fn;
          btn.disabled    = true;
          btn.textContent = "0%";

          try {
            const response = await fetch("/cwk/civitai/download", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                model:        modelName,
                download_url: dlUrl,
                filename:     fn,
                api_key:      apiKey,
              }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body.getReader();
            const dec    = new TextDecoder();
            let   buf    = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const parts = buf.split("\n\n");
              buf = parts.pop();

              for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith("data:")) continue;
                let p;
                try { p = JSON.parse(line.slice(5)); } catch { continue; }

                if (p.progress !== undefined) {
                  btn.textContent = `${p.progress}%`;
                }
                if (p.done && !p.error) {
                  btn.textContent      = "✓ Done";
                  btn.style.background = "#a6e3a1";
                  btn.style.color      = "#1e1e2e";
                  onDownloadDone?.();
                }
                if (p.error) {
                  btn.textContent      = "✗ Error";
                  btn.style.background = "#f38ba8";
                  btn.style.color      = "#1e1e2e";
                  btn.title            = p.error;
                  btn.disabled         = false;
                }
              }
            }
          } catch (e) {
            btn.textContent      = "✗ Failed";
            btn.style.background = "#f38ba8";
            btn.style.color      = "#1e1e2e";
            btn.title            = e.message;
            btn.disabled         = false;
          }
        });
      });
    })
    .catch(e => {
      list.innerHTML =
        `<div style="color:#f38ba8;font-size:13px;padding:8px 0">
           Failed to load versions: ${_esc(e.message)}
         </div>`;
    });
}