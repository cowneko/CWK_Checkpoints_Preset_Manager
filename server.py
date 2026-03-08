"""
CWK Checkpoints Preset Manager — REST / SSE API routes.
"""

import asyncio
import json
import os
import hashlib
import re
from typing import Optional

import aiohttp
from aiohttp import web

import folder_paths
from .nodes import load_presets, save_presets, default_preset

# ─── Constants ────────────────────────────────────────────────────────────────

CIVITAI_API_BASE  = "https://civitai.com/api/v1"
NODE_DIR          = os.path.dirname(__file__)
# Legacy single-file cache (read-only for migration)
THUMBNAILS_CACHE  = os.path.join(NODE_DIR, "thumbnails_cache.json")
HASH_CACHE_FILE   = os.path.join(NODE_DIR, "hash_cache.json")
LOCAL_THUMBS_DIR  = os.path.join(NODE_DIR, "local_thumbnails")
# New per-model metadata folder
MODEL_META_DIR    = os.path.join(NODE_DIR, "model_metadata")

_CONCURRENCY = 5
_USER_AGENT  = "CWK-PresetManager/2.0 (ComfyUI custom node)"
_REQ_TIMEOUT = aiohttp.ClientTimeout(total=20)
_DL_TIMEOUT  = aiohttp.ClientTimeout(total=3600)


# ─── NSFW normalisation ───────────────────────────────────────────────────────

def _normalize_nsfw_level(raw) -> int:
    if isinstance(raw, str):
        mapping = {"none": 0, "soft": 1, "mature": 2, "x": 3, "explicit": 3, "xxx": 4}
        return mapping.get(raw.lower().strip(), 0)
    if isinstance(raw, int):
        if raw <= 1:  return 0
        if raw <= 2:  return 1
        if raw <= 4:  return 2
        if raw <= 8:  return 3
        return 4
    return 0


# ─── JSON helpers ─────────────────────────────────────────────────────────────

def _load_json(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_json(path: str, data: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[CWK] save_json error ({os.path.basename(path)}): {e}")


# ─── Per-model metadata ───────────────────────────────────────────────────────

def _safe_filename(model_name: str) -> str:
    """Convert a model name (may contain path separators) to a safe filename."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', model_name)
    return safe + ".json"


def _meta_path(model_name: str) -> str:
    return os.path.join(MODEL_META_DIR, _safe_filename(model_name))


def _load_meta(model_name: str) -> dict:
    """Load per-model metadata, falling back to legacy cache then empty dict."""
    path = _meta_path(model_name)
    if os.path.exists(path):
        return _load_json(path)
    # Migration: check legacy thumbnails_cache.json
    legacy = _load_json(THUMBNAILS_CACHE)
    if model_name in legacy:
        data = legacy[model_name]
        _save_meta(model_name, data)   # migrate on first access
        return data
    return {}


def _save_meta(model_name: str, data: dict) -> None:
    os.makedirs(MODEL_META_DIR, exist_ok=True)
    _save_json(_meta_path(model_name), data)


def _delete_meta(model_name: str) -> None:
    path = _meta_path(model_name)
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


# ─── Hash cache ───────────────────────────────────────────────────────────────

def _hash_cache_get(path: str) -> Optional[str]:
    entry = _load_json(HASH_CACHE_FILE).get(path)
    if not entry:
        return None
    try:
        st = os.stat(path)
        if st.st_mtime == entry["mtime"] and st.st_size == entry["size"]:
            return entry["sha256"]
    except OSError:
        pass
    return None


def _hash_cache_set(path: str, sha256: str) -> None:
    cache = _load_json(HASH_CACHE_FILE)
    try:
        st = os.stat(path)
        cache[path] = {"mtime": st.st_mtime, "size": st.st_size, "sha256": sha256}
    except OSError:
        cache[path] = {"mtime": 0, "size": 0, "sha256": sha256}
    _save_json(HASH_CACHE_FILE, cache)


# ─── Model file helpers ───────────────────────────────────────────────────────

def _all_models() -> list:
    models = []
    for name in folder_paths.get_filename_list("checkpoints"):
        models.append({"name": name, "type": "checkpoint"})
    try:
        for name in folder_paths.get_filename_list("diffusion_models"):
            models.append({"name": name, "type": "diffusion_model"})
    except Exception:
        pass
    return models


def _clean_name(filename: str) -> str:
    return os.path.splitext(os.path.basename(filename))[0]


def _full_path(model_name: str) -> Optional[str]:
    return (
        folder_paths.get_full_path("checkpoints",      model_name) or
        folder_paths.get_full_path("diffusion_models", model_name)
    )


def _model_save_dir(model_name: str) -> str:
    p = _full_path(model_name)
    if p:
        return os.path.dirname(p)
    dirs = folder_paths.get_folder_paths("checkpoints")
    return dirs[0] if dirs else os.getcwd()


# ─── Hash computation ─────────────────────────────────────────────────────────

def _sha256_sync(path: str) -> Optional[str]:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(1024 * 1024):
                h.update(chunk)
        result = h.hexdigest().upper()
        _hash_cache_set(path, result)
        return result
    except Exception as e:
        print(f"[CWK] SHA256 error {path}: {e}")
        return None


async def _get_hash(model_name: str, loop) -> Optional[str]:
    path = _full_path(model_name)
    if not path or not os.path.exists(path):
        return None
    cached = _hash_cache_get(path)
    if cached:
        return cached
    print(f"[CWK] Hashing (first time): {model_name}")
    return await loop.run_in_executor(None, _sha256_sync, path)


# ─── CivitAI HTTP helpers ─────────────────────────────────────────────────────

class CivitAIAuthError(Exception):
    pass


def _headers(api_key: str) -> dict:
    h = {"User-Agent": _USER_AGENT}
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    return h


async def _cget(session: aiohttp.ClientSession, url: str) -> dict:
    async with session.get(url, timeout=_REQ_TIMEOUT) as r:
        if r.status == 403:
            raise CivitAIAuthError("CivitAI returned 403 — API key required or invalid.")
        if r.status == 404:
            return {}
        if r.status == 429:
            raise aiohttp.ClientResponseError(
                r.request_info, r.history, status=429, message="Rate limited by CivitAI"
            )
        r.raise_for_status()
        return await r.json(content_type=None)


def _parse_version(data: dict, filename: str) -> dict:
    if not data:
        return {
            "thumbnail":    None,
            "civitai_name": _clean_name(filename),
            "nsfw_level":   0,
            "tags":         [],
        }

    images    = data.get("images", [])
    model_blk = data.get("model", {})

    norm_images = []
    for img in images:
        lvl = _normalize_nsfw_level(img.get("nsfwLevel", 0))
        norm_images.append({**img, "nsfwLevel": lvl})

    non_video  = [img for img in norm_images
                  if not img.get("url", "").lower().endswith(".mp4")]
    candidates = non_video if non_video else norm_images
    thumb_img  = min(candidates, key=lambda i: i["nsfwLevel"]) if candidates else None
    nsfw_level = thumb_img["nsfwLevel"] if thumb_img else 0

    # Tags are inside model{} on the by-hash endpoint
    raw_tags = model_blk.get("tags", [])
    tags = [t for t in raw_tags if isinstance(t, str)] if isinstance(raw_tags, list) else []

    return {
        "thumbnail":    thumb_img["url"] if thumb_img else None,
        "nsfw_level":   nsfw_level,
        "civitai_name": model_blk.get("name") or data.get("name") or _clean_name(filename),
        "base_model":   data.get("baseModel", ""),
        "description":  (model_blk.get("description") or "")[:300],
        "tags":         tags,
        "images":       norm_images,
        "model_id":     data.get("modelId"),
        "version_id":   data.get("id"),
        "version_name": data.get("name", ""),
    }


async def _lookup(model_name: str, session, loop) -> dict:
    file_hash = await _get_hash(model_name, loop)
    if not file_hash:
        return {"thumbnail": None, "civitai_name": _clean_name(model_name), "nsfw_level": 0, "tags": []}
    data = await _cget(session, f"{CIVITAI_API_BASE}/model-versions/by-hash/{file_hash}")
    return _parse_version(data, model_name)


def _keep_manual_overrides(new_info: dict, existing: dict) -> dict:
    """Preserve user overrides (local thumbnail, nsfw_manual, favorite) across refreshes."""
    if existing.get("thumbnail", "").startswith("/cwk/local_thumbnails/"):
        new_info["thumbnail"] = existing["thumbnail"]
    if existing.get("nsfw_manual") is not None:
        new_info["nsfw_manual"] = existing["nsfw_manual"]
    # Always preserve favorite status across refreshes
    if existing.get("favorite"):
        new_info["favorite"] = True
    # Preserve non-empty tags
    existing_tags = existing.get("tags")
    if isinstance(existing_tags, list) and existing_tags and not new_info.get("tags"):
        new_info["tags"] = existing_tags
    # Preserve update_available flag
    if existing.get("update_available"):
        new_info["update_available"] = existing["update_available"]
        new_info["latest_version_id"] = existing.get("latest_version_id")
    return new_info


# ─── SSE helper ───────────────────────────────────────────────────────────────

async def _sse(resp: web.StreamResponse, payload: dict) -> None:
    try:
        await resp.write(f"data: {json.dumps(payload)}\n\n".encode())
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# Route handlers
# ═══════════════════════════════════════════════════════════════════════════════

async def handle_list_models(req: web.Request) -> web.Response:
    models  = _all_models()
    presets = load_presets()
    result  = []
    for m in models:
        full_path = _full_path(m["name"])
        try:
            file_size = os.path.getsize(full_path) if full_path else 0
        except OSError:
            file_size = 0
        meta = _load_meta(m["name"])
        result.append({
            "name":      m["name"],
            "type":      m["type"],
            "preset":    presets.get(m["name"], default_preset()),
            "civitai":   meta if meta else None,
            "file_path": full_path or "",
            "file_size": file_size,
        })
    return web.json_response(result)


async def handle_get_preset(req: web.Request) -> web.Response:
    name = req.rel_url.query.get("model", "")
    if not name:
        return web.json_response({"error": "model parameter required"}, status=400)
    presets = load_presets()
    return web.json_response({"model": name, "preset": presets.get(name, default_preset())})


async def handle_save_preset(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    name = body.get("model", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    presets       = load_presets()
    existing      = presets.get(name, default_preset())
    existing.update(body.get("preset", {}))
    presets[name] = existing
    save_presets(presets)
    return web.json_response({"ok": True, "model": name, "preset": existing})


async def handle_validate_key(req: web.Request) -> web.Response:
    key = req.rel_url.query.get("key", "")
    if not key:
        return web.json_response({"ok": False, "error": "No key provided."})
    try:
        async with aiohttp.ClientSession(headers=_headers(key)) as s:
            await _cget(s, f"{CIVITAI_API_BASE}/models?limit=1")
        return web.json_response({"ok": True})
    except CivitAIAuthError as e:
        return web.json_response({"ok": False, "error": str(e)})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)})


# ── Favourite ──────────────────────────────────────────────────────────────────

async def handle_set_favorite(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    name     = body.get("model", "")
    favorite = bool(body.get("favorite", False))
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    meta = _load_meta(name)
    if favorite:
        meta["favorite"] = True
    else:
        meta.pop("favorite", None)
    _save_meta(name, meta)
    return web.json_response({"ok": True, "favorite": favorite})


# ── Bulk SSE fetch ─────────────────────────────────────────────────────────────

async def _run_sse_fetch(req, names, api_key, force, rebuild=False):
    resp = web.StreamResponse(headers={
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache",
        "X-Accel-Buffering": "no",
    })
    await resp.prepare(req)

    if not api_key:
        await _sse(resp, {
            "error":   "api_key_required",
            "message": "A CivitAI API key is required. Click 🔑 in the browser panel.",
            "done":    True,
        })
        return resp

    total       = len(names)
    loop        = asyncio.get_event_loop()
    sem         = asyncio.Semaphore(_CONCURRENCY)
    completed   = [0]
    auth_failed = [False]

    async with aiohttp.ClientSession(headers=_headers(api_key)) as session:

        async def _bounded(name: str):
            if auth_failed[0]:
                return

            existing = _load_meta(name)

            # Skip if cached and not forcing/rebuilding
            if not force and not rebuild and existing.get("thumbnail"):
                completed[0] += 1
                await _sse(resp, {
                    "model": name, "info": existing,
                    "index": completed[0], "total": total,
                    "done":  completed[0] == total,
                })
                return

            async with sem:
                if auth_failed[0]:
                    return
                try:
                    info = await _lookup(name, session, loop)
                except CivitAIAuthError as e:
                    auth_failed[0] = True
                    await _sse(resp, {"error": "api_key_invalid", "message": str(e), "done": True})
                    return
                except Exception as e:
                    print(f"[CWK] Lookup error for {name}: {e}")
                    info = existing or {
                        "thumbnail": None,
                        "civitai_name": _clean_name(name),
                        "nsfw_level": 0,
                        "tags": [],
                    }

            info = _keep_manual_overrides(info, existing)
            _save_meta(name, info)
            completed[0] += 1
            await _sse(resp, {
                "model": name, "info": info,
                "index": completed[0], "total": total,
                "done":  completed[0] == total and not auth_failed[0],
            })

        await asyncio.gather(*[_bounded(n) for n in names])

    if not auth_failed[0]:
        await _sse(resp, {"done": True, "total": total})
    return resp


async def handle_fetch_stream(req: web.Request) -> web.StreamResponse:
    try:
        body = await req.json()
    except Exception:
        return web.Response(status=400, text="invalid JSON")
    names   = body.get("models") or [m["name"] for m in _all_models()]
    api_key = body.get("api_key", "")
    force   = bool(body.get("force", False))
    rebuild = bool(body.get("rebuild", False))
    return await _run_sse_fetch(req, names, api_key, force=force, rebuild=rebuild)


async def handle_refresh_all_stream(req: web.Request) -> web.StreamResponse:
    try:
        body = await req.json()
    except Exception:
        return web.Response(status=400, text="invalid JSON")
    names   = [m["name"] for m in _all_models()]
    api_key = body.get("api_key", "")
    return await _run_sse_fetch(req, names, api_key, force=True, rebuild=False)


async def handle_get_cache(req: web.Request) -> web.Response:
    """Return all per-model metadata as a single dict (for compatibility)."""
    result = {}
    for m in _all_models():
        meta = _load_meta(m["name"])
        if meta:
            result[m["name"]] = meta
    return web.json_response(result)


async def handle_clear_cache(req: web.Request) -> web.Response:
    """Delete all per-model metadata files."""
    deleted = 0
    if os.path.isdir(MODEL_META_DIR):
        for fname in os.listdir(MODEL_META_DIR):
            if fname.endswith(".json"):
                try:
                    os.remove(os.path.join(MODEL_META_DIR, fname))
                    deleted += 1
                except OSError:
                    pass
    return web.json_response({"ok": True, "deleted": deleted})


async def handle_list_images(req: web.Request) -> web.Response:
    name  = req.rel_url.query.get("model", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    entry = _load_meta(name)
    return web.json_response({"model": name, "images": entry.get("images", [])})


async def handle_set_thumbnail(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    name = body.get("model", "")
    url  = body.get("url",   "")
    if not name or not url:
        return web.json_response({"error": "model and url required"}, status=400)
    meta = _load_meta(name)
    meta["thumbnail"] = url
    _save_meta(name, meta)
    return web.json_response({"ok": True, "thumbnail": url})


async def handle_set_local_thumbnail(req: web.Request) -> web.Response:
    try:
        os.makedirs(LOCAL_THUMBS_DIR, exist_ok=True)
        reader     = await req.multipart()
        model_name = None
        saved_url  = None
        async for part in reader:
            if part.name == "model":
                model_name = (await part.read()).decode("utf-8").strip()
            elif part.name == "file":
                filename  = part.filename or "thumb.jpg"
                safe_stem = (model_name or "unknown").replace("/", "_").replace("\\", "_")
                ext       = os.path.splitext(filename)[1] or ".jpg"
                dest      = os.path.join(LOCAL_THUMBS_DIR, f"{safe_stem}{ext}")
                with open(dest, "wb") as f:
                    while True:
                        chunk = await part.read_chunk(65536)
                        if not chunk:
                            break
                        f.write(chunk)
                saved_url = f"/cwk/local_thumbnails/{safe_stem}{ext}"
        if not model_name or not saved_url:
            return web.json_response({"error": "model and file required"}, status=400)
        meta = _load_meta(model_name)
        meta["thumbnail"] = saved_url
        _save_meta(model_name, meta)
        return web.json_response({"ok": True, "thumbnail": saved_url})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_list_versions(req: web.Request) -> web.Response:
    name    = req.rel_url.query.get("model",   "")
    api_key = req.rel_url.query.get("api_key", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    entry    = _load_meta(name)
    model_id = entry.get("model_id")
    if not model_id:
        return web.json_response(
            {"error": "No model_id cached — run Fetch Thumbnails first."}, status=404
        )
    try:
        async with aiohttp.ClientSession(headers=_headers(api_key)) as s:
            data = await _cget(s, f"{CIVITAI_API_BASE}/models/{model_id}")
        if not data:
            return web.json_response({"error": "Model not found on CivitAI."}, status=404)
        versions    = sorted(data.get("modelVersions", []),
                             key=lambda v: v.get("createdAt", ""), reverse=True)
        current_vid = entry.get("version_id")
        result = []
        for v in versions:
            files = v.get("files", [])
            mfile = next(
                (f for f in files if f.get("type") == "Model" and f.get("primary")),
                files[0] if files else {},
            )
            result.append({
                "id":           v.get("id"),
                "name":         v.get("name", ""),
                "created_at":   v.get("createdAt", ""),
                "base_model":   v.get("baseModel", ""),
                "download_url": mfile.get("downloadUrl", ""),
                "filename":     mfile.get("name", ""),
                "size_kb":      mfile.get("sizeKB", 0),
                "is_installed": v.get("id") == current_vid,
                "images":       v.get("images", [])[:1],
            })
        return web.json_response({"model_name": name, "versions": result})
    except CivitAIAuthError as e:
        return web.json_response({"error": str(e)}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_model_description(req: web.Request) -> web.Response:
    name    = req.rel_url.query.get("model",   "")
    api_key = req.rel_url.query.get("api_key", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    entry    = _load_meta(name)
    model_id = entry.get("model_id")
    if not model_id:
        return web.json_response(
            {"error": "No model_id cached — run Fetch Thumbnails first."}, status=404
        )
    try:
        async with aiohttp.ClientSession(headers=_headers(api_key)) as s:
            data = await _cget(s, f"{CIVITAI_API_BASE}/models/{model_id}")
        if not data:
            return web.json_response({"error": "Model not found on CivitAI."}, status=404)
        description = data.get("description") or ""
        # On /models/{id}, tags are at the top level
        raw_tags = data.get("tags", [])
        tags = [t for t in raw_tags if isinstance(t, str)] if isinstance(raw_tags, list) else []
        if tags:
            entry["tags"] = tags
            _save_meta(name, entry)
        return web.json_response({"description": description, "tags": tags})
    except CivitAIAuthError as e:
        return web.json_response({"error": str(e)}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_check_updates(req: web.Request) -> web.Response:
    """
    POST /cwk/civitai/check-updates
    Body: { "api_key": "..." }

    For every model that has a cached version_id and model_id, check whether
    a newer version exists on CivitAI. Updates per-model metadata with
    update_available and latest_version_id fields.
    Returns a summary list.
    """
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    api_key = body.get("api_key", "")
    if not api_key:
        return web.json_response({"error": "api_key required"}, status=400)

    models   = _all_models()
    results  = []
    sem      = asyncio.Semaphore(_CONCURRENCY)
    loop     = asyncio.get_event_loop()

    async def _check_one(m):
        meta       = _load_meta(m["name"])
        model_id   = meta.get("model_id")
        current_id = meta.get("version_id")
        if not model_id or not current_id:
            return

        async with sem:
            try:
                async with aiohttp.ClientSession(headers=_headers(api_key)) as s:
                    data = await _cget(s, f"{CIVITAI_API_BASE}/models/{model_id}")
                if not data:
                    return
                versions = sorted(data.get("modelVersions", []),
                                   key=lambda v: v.get("createdAt", ""), reverse=True)
                if not versions:
                    return
                latest_id = versions[0].get("id")
                has_update = (latest_id != current_id)
                meta["update_available"]  = has_update
                meta["latest_version_id"] = latest_id if has_update else None
                _save_meta(m["name"], meta)
                if has_update:
                    results.append({
                        "name":              m["name"],
                        "current_version":   meta.get("version_name", ""),
                        "latest_version":    versions[0].get("name", ""),
                        "latest_version_id": latest_id,
                    })
            except Exception as e:
                print(f"[CWK] Update check error for {m['name']}: {e}")

    await asyncio.gather(*[_check_one(m) for m in models])
    return web.json_response({"ok": True, "updates": results, "count": len(results)})


async def handle_delete_model(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    name = body.get("model", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    errors = []
    full   = _full_path(name)
    if full and os.path.exists(full):
        try:
            os.remove(full)
        except OSError as e:
            errors.append(str(e))
    _delete_meta(name)
    presets = load_presets()
    if name in presets:
        del presets[name]
        save_presets(presets)
    return web.json_response({"ok": not errors, "errors": errors})


async def handle_refresh_civitai(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    name    = body.get("model",   "")
    api_key = body.get("api_key", "")
    if not name:
        return web.json_response({"error": "model required"}, status=400)
    loop = asyncio.get_event_loop()
    try:
        async with aiohttp.ClientSession(headers=_headers(api_key)) as session:
            info = await _lookup(name, session, loop)
        existing = _load_meta(name)
        info     = _keep_manual_overrides(info, existing)
        _save_meta(name, info)
        return web.json_response({"ok": True, "info": info})
    except CivitAIAuthError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=403)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
        
async def handle_get_meta(req: web.Request) -> web.Response:
    name = req.rel_url.query.get("model", "")
    if not name:
        return web.json_response({}, status=400)
    return web.json_response(_load_meta(name))


# ─── Route registration ───────────────────────────────────────────────────────

def register_routes(app: web.Application) -> None:
    os.makedirs(LOCAL_THUMBS_DIR, exist_ok=True)
    os.makedirs(MODEL_META_DIR,   exist_ok=True)
    r = app.router
    r.add_get   ("/cwk/models",                       handle_list_models)
    r.add_get   ("/cwk/preset",                       handle_get_preset)
    r.add_post  ("/cwk/preset",                       handle_save_preset)
    r.add_post  ("/cwk/civitai/fetch/stream",         handle_fetch_stream)
    r.add_post  ("/cwk/civitai/refresh/all",          handle_refresh_all_stream)
    r.add_get   ("/cwk/civitai/cache",                handle_get_cache)
    r.add_delete("/cwk/civitai/cache",                handle_clear_cache)
    r.add_get   ("/cwk/civitai/validate",             handle_validate_key)
    r.add_get   ("/cwk/civitai/images",               handle_list_images)
    r.add_post  ("/cwk/civitai/thumbnail/set",        handle_set_thumbnail)
    r.add_post  ("/cwk/civitai/thumbnail/local",      handle_set_local_thumbnail)
    r.add_get   ("/cwk/civitai/versions",             handle_list_versions)
    r.add_get   ("/cwk/civitai/model-description",    handle_model_description)
    r.add_post  ("/cwk/civitai/check-updates",        handle_check_updates)
    r.add_post  ("/cwk/model/favorite",               handle_set_favorite)
    r.add_delete("/cwk/model",                        handle_delete_model)
    r.add_post  ("/cwk/civitai/refresh",              handle_refresh_civitai)
    r.add_static("/cwk/local_thumbnails",             LOCAL_THUMBS_DIR, show_index=False)
    r.add_get   ("/cwk/civitai/meta",                 handle_get_meta)
    print("[CWK_PresetManager] Routes registered.")