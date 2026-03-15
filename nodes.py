"""
CWK Checkpoints Preset Manager — ComfyUI node definitions.

Single node: CWK_ModelPresetManager
  - Loads a checkpoint or diffusion model
  - Merges stored preset with optional per-execution overrides
  - Outputs: MODEL, CLIP, VAE, LATENT, steps, cfg, sampler_name, scheduler, width, height
  - Applies clip_skip and rng internally
  - Supports external CLIP and VAE override (or embedded from checkpoint)
"""

import json
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

import torch
import folder_paths
import comfy.samplers
import comfy.sd

# ─── Preset file path ─────────────────────────────────────────────────────────

_NODE_DIR          = os.path.dirname(__file__)
_PRESETS_FILE      = os.path.join(_NODE_DIR, "checkpoint_presets.json")
_LAST_MODEL_FILE   = os.path.join(_NODE_DIR, "last_used_model.json")


# ─── Last-used model persistence ───────────────────────────────────────────────

def get_last_used_model() -> Optional[str]:
    """Return the last-used model name, or None."""
    if os.path.exists(_LAST_MODEL_FILE):
        try:
            with open(_LAST_MODEL_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("model_name")
        except Exception:
            pass
    return None


def save_last_used_model(model_name: str) -> None:
    """Persist the last-used model name to disk."""
    try:
        with open(_LAST_MODEL_FILE, "w", encoding="utf-8") as f:
            json.dump({"model_name": model_name}, f)
    except Exception as e:
        print(f"[CWK_PresetManager] Error saving last model: {e}")


# ─── Resolution presets ────────────────────────────────────────────────────────

RESOLUTION_PRESETS: Dict[str, Tuple[int, int]] = {
    # ── Custom / passthrough ──
    "(preset)":               (0, 0),
    # ── SDXL / SD3 / Pony (1024px base) ──
    "SDXL 1:1  (1024×1024)":  (1024, 1024),
    "SDXL 3:4  (896×1152)":   (896,  1152),
    "SDXL 4:3  (1152×896)":   (1152, 896),
    "SDXL 2:3  (832×1216)":   (832,  1216),
    "SDXL 3:2  (1216×832)":   (1216, 832),
    "SDXL 9:16 (768×1344)":   (768,  1344),
    "SDXL 16:9 (1344×768)":   (1344, 768),
    "SDXL 9:21 (640×1536)":   (640,  1536),
    "SDXL 21:9 (1536×640)":   (1536, 640),
    # ── SD 1.5 (512px base) ──
    "SD1.5 1:1  (512×512)":   (512,  512),
    "SD1.5 3:4  (448×576)":   (448,  576),
    "SD1.5 4:3  (576×448)":   (576,  448),
    "SD1.5 2:3  (416×608)":   (416,  608),
    "SD1.5 3:2  (608×416)":   (608,  416),
    "SD1.5 9:16 (384×672)":   (384,  672),
    "SD1.5 16:9 (672×384)":   (672,  384),
    # ── Flux / Large models (1024+ base) ──
    "Flux 1:1  (1024×1024)":  (1024, 1024),
    "Flux 3:4  (896×1152)":   (896,  1152),
    "Flux 4:3  (1152×896)":   (1152, 896),
    "Flux 2:3  (832×1216)":   (832,  1216),
    "Flux 3:2  (1216×832)":   (1216, 832),
    "Flux 9:16 (768×1344)":   (768,  1344),
    "Flux 16:9 (1344×768)":   (1344, 768),
}

RESOLUTION_PRESET_NAMES = list(RESOLUTION_PRESETS.keys())


# ─── Public helpers (re-used by server.py) ────────────────────────────────────

def get_clip_list():
    """Return list of available CLIP models with 'embedded' as first entry."""
    try:
        clips = folder_paths.get_filename_list("clip")
    except Exception:
        clips = []
    return ["embedded"] + sorted(clips)


def get_vae_list():
    """Return list of available VAE models with 'embedded' as first entry."""
    try:
        vaes = folder_paths.get_filename_list("vae")
    except Exception:
        vaes = []
    return ["embedded"] + sorted(vaes)


def default_preset() -> Dict[str, Any]:
    samplers   = list(comfy.samplers.KSampler.SAMPLERS)
    schedulers = list(comfy.samplers.KSampler.SCHEDULERS)
    return {
        "sampler_name": samplers[0]   if samplers   else "euler",
        "scheduler":    schedulers[0] if schedulers else "normal",
        "cfg":          7.0,
        "steps":        20,
        "clip_skip":    -2,
        "width":        1024,
        "height":       1024,
        "rng":          "cpu",
        "clip_name":    "embedded",
        "vae_name":     "embedded",
    }


def load_presets() -> Dict[str, Any]:
    if os.path.exists(_PRESETS_FILE):
        try:
            with open(_PRESETS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[CWK_PresetManager] Error loading presets: {e}")
    return {}


def save_presets(presets: Dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(_PRESETS_FILE), exist_ok=True)
        with open(_PRESETS_FILE, "w", encoding="utf-8") as f:
            json.dump(presets, f, indent=2)
    except Exception as e:
        print(f"[CWK_PresetManager] Error saving presets: {e}")


# ─── Sampler / Scheduler fallback system ───────────────────────────────────────
#
# When CivitAI metadata or other sources provide sampler/scheduler names that
# don't match the locally installed ComfyUI samplers/schedulers, we try two
# strategies before falling back to safe defaults (euler / simple):
#
#   1. Alias table — common A1111/CivitAI naming conventions mapped to ComfyUI
#      internal names (e.g. "Euler a" → "euler_ancestral", "++" → "_pp")
#
#   2. Fuzzy match — normalise both the input and all available names, then
#      pick the best match above a similarity threshold (0.6)
#

# ── Known aliases: CivitAI / A1111 name → ComfyUI internal name ──────────────

_SAMPLER_ALIASES: Dict[str, str] = {
    # A1111 display names
    "euler a":                      "euler_ancestral",
    "euler_a":                      "euler_ancestral",
    "eulera":                       "euler_ancestral",
    "heun":                         "heun",
    "heunpp2":                      "heunpp2",
    "dpm2":                         "dpm_2",
    "dpm2 a":                       "dpm_2_ancestral",
    "dpm2_a":                       "dpm_2_ancestral",
    "dpm2 ancestral":               "dpm_2_ancestral",
    "dpm++ 2s a":                   "dpmpp_2s_ancestral",
    "dpm++ 2s ancestral":           "dpmpp_2s_ancestral",
    "dpmpp_2s_a":                   "dpmpp_2s_ancestral",
    "dpm++ 2m":                     "dpmpp_2m",
    "dpm++ sde":                    "dpmpp_sde",
    "dpm++ 2m sde":                 "dpmpp_2m_sde",
    "dpm++ 3m sde":                 "dpmpp_3m_sde",
    "dpm fast":                     "dpm_fast",
    "dpm adaptive":                 "dpm_adaptive",
    "lms":                          "lms",
    "restart":                      "restart",
    "ddim":                         "ddim",
    "plms":                         "plms",
    "uni_pc":                       "uni_pc",
    "uni_pc_bh2":                   "uni_pc_bh2",
    "unipc":                        "uni_pc",
    "lcm":                          "lcm",
    # A1111 often appends the scheduler to the sampler name
    "dpm++ 2m karras":              "dpmpp_2m",
    "dpm++ 2m sde karras":          "dpmpp_2m_sde",
    "dpm++ sde karras":             "dpmpp_sde",
    "dpm++ 3m sde karras":          "dpmpp_3m_sde",
    "dpm++ 2s a karras":            "dpmpp_2s_ancestral",
    "dpm++ 2m sde exponential":     "dpmpp_2m_sde",
    "dpm++ 3m sde exponential":     "dpmpp_3m_sde",
    # cfg++ variants — ++ becomes _pp in ComfyUI
    "euler_cfg++":                  "euler_cfg_pp",
    "euler_ancestral_cfg++":        "euler_ancestral_cfg_pp",
    "euler cfg++":                  "euler_cfg_pp",
    "euler ancestral cfg++":        "euler_ancestral_cfg_pp",
    "euler_a_cfg++":                "euler_ancestral_cfg_pp",
}

_SCHEDULER_ALIASES: Dict[str, str] = {
    "karras":       "karras",
    "exponential":  "exponential",
    "normal":       "normal",
    "simple":       "simple",
    "sgm_uniform":  "sgm_uniform",
    "sgm uniform":  "sgm_uniform",
    "ddim_uniform": "ddim_uniform",
    "beta":         "beta",
    "linear":       "normal",
    "uniform":      "normal",
}


def _normalise(name: str) -> str:
    """Lowercase, collapse whitespace, strip."""
    return re.sub(r'\s+', ' ', name.strip().lower())


def _strip_for_fuzzy(name: str) -> str:
    """Remove all non-alphanumeric chars for fuzzy comparison."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


def _fuzzy_match(name: str, candidates: List[str], threshold: float = 0.6) -> Optional[str]:
    """Find the best fuzzy match among candidates. Returns None if below threshold."""
    stripped = _strip_for_fuzzy(name)
    best_score = 0.0
    best_match = None
    for c in candidates:
        c_stripped = _strip_for_fuzzy(c)
        score = SequenceMatcher(None, stripped, c_stripped).ratio()
        if stripped in c_stripped or c_stripped in stripped:
            score = max(score, 0.8)
        if score > best_score:
            best_score = score
            best_match = c
    if best_score >= threshold:
        return best_match
    return None


def resolve_sampler(name: str, available: Optional[List[str]] = None) -> str:
    if available is None:
        available = list(comfy.samplers.KSampler.SAMPLERS)
    if not name or not available:
        fb = available[0] if available else "euler"
        return fb
    if name in available:
        return name
    normed = _normalise(name)
    alias = _SAMPLER_ALIASES.get(normed)
    if alias and alias in available:
        print(f"[CWK] Sampler alias: '{name}' → '{alias}'")
        return alias
    pp_sub = name.replace("++", "_pp").replace(" ", "_").lower()
    if pp_sub in available:
        print(f"[CWK] Sampler ++ fix: '{name}' → '{pp_sub}'")
        return pp_sub
    underscore = _normalise(name).replace(" ", "_").replace("++", "_pp")
    if underscore in available:
        print(f"[CWK] Sampler normalised: '{name}' → '{underscore}'")
        return underscore
    fuzzy = _fuzzy_match(name, available)
    if fuzzy:
        print(f"[CWK] Sampler fuzzy match: '{name}' → '{fuzzy}'")
        return fuzzy
    fallback = "euler" if "euler" in available else available[0]
    print(f"[CWK] ⚠ Sampler '{name}' not found — falling back to '{fallback}'")
    return fallback


def resolve_scheduler(name: str, available: Optional[List[str]] = None) -> str:
    if available is None:
        available = list(comfy.samplers.KSampler.SCHEDULERS)
    if not name or not available:
        fb = available[0] if available else "simple"
        return fb
    if name in available:
        return name
    normed = _normalise(name)
    alias = _SCHEDULER_ALIASES.get(normed)
    if alias and alias in available:
        print(f"[CWK] Scheduler alias: '{name}' → '{alias}'")
        return alias
    underscore = normed.replace(" ", "_")
    if underscore in available:
        print(f"[CWK] Scheduler normalised: '{name}' → '{underscore}'")
        return underscore
    fuzzy = _fuzzy_match(name, available)
    if fuzzy:
        print(f"[CWK] Scheduler fuzzy match: '{name}' → '{fuzzy}'")
        return fuzzy
    fallback = "simple" if "simple" in available else available[0]
    print(f"[CWK] ⚠ Scheduler '{name}' not found — falling back to '{fallback}'")
    return fallback


def resolve_sampler_scheduler(
    sampler_name: str,
    scheduler: str,
    available_samplers: Optional[List[str]] = None,
    available_schedulers: Optional[List[str]] = None,
) -> Tuple[str, str]:
    if available_samplers is None:
        available_samplers = list(comfy.samplers.KSampler.SAMPLERS)
    if available_schedulers is None:
        available_schedulers = list(comfy.samplers.KSampler.SCHEDULERS)
    normed_sampler = _normalise(sampler_name)
    scheduler_hint = None
    for sched_name in sorted(available_schedulers, key=len, reverse=True):
        sn_lower = sched_name.lower()
        if normed_sampler.endswith(" " + sn_lower):
            scheduler_hint = sched_name
            stripped = sampler_name[:-(len(sched_name))].strip()
            if stripped:
                test = _SAMPLER_ALIASES.get(_normalise(stripped))
                if test and test in available_samplers:
                    sampler_name = stripped
                elif _normalise(stripped).replace(" ", "_").replace("++", "_pp") in available_samplers:
                    sampler_name = stripped
            break
    resolved_sampler = resolve_sampler(sampler_name, available_samplers)
    if scheduler_hint and (not scheduler or scheduler in ("normal", "simple")):
        scheduler = scheduler_hint
    resolved_scheduler = resolve_scheduler(scheduler, available_schedulers)
    return resolved_sampler, resolved_scheduler


# ─── RNG application ──────────────────────────────────────────────────────────

def _apply_rng(model, rng: str):
    from . import cwk_rng_shared, cwk_rng
    model = model.clone()
    model.model_options = dict(model.model_options)
    opts = cwk_rng_shared.opts_default.clone()
    opts.randn_source = rng
    model.model_options[cwk_rng_shared.Options.KEY] = opts
    import comfy.sample
    if not hasattr(comfy.sample, '_cwk_original_prepare_noise'):
        comfy.sample._cwk_original_prepare_noise = comfy.sample.prepare_noise
    comfy.sample.prepare_noise = cwk_rng.prepare_noise
    print(f"[CWK] RNG set: randn_source={rng}")
    return model


# ─── External CLIP / VAE loaders ──────────────────────────────────────────────

def _load_external_clip(clip_name: str):
    clip_path = folder_paths.get_full_path("clip", clip_name)
    if not clip_path:
        raise FileNotFoundError(f"[CWK] CLIP file not found: {clip_name}")
    clip = comfy.sd.load_clip(ckpt_paths=[clip_path], embedding_directory=folder_paths.get_folder_paths("embeddings"))
    return clip


def _load_external_vae(vae_name: str):
    vae_path = folder_paths.get_full_path("vae", vae_name)
    if not vae_path:
        raise FileNotFoundError(f"[CWK] VAE file not found: {vae_name}")
    sd = comfy.utils.load_torch_file(vae_path)
    vae = comfy.sd.VAE(sd=sd)
    return vae


# ─── ComfyUI node ─────────────────────────────────────────────────────────────

class CWK_ModelPresetManager:
    """
    CWK Model Preset Manager node.

    The three canvas buttons (Load Model / Reset / Update Preset) are drawn
    and handled entirely in the JavaScript frontend (cwk_preset_manager.js).
    This Python class only defines inputs/outputs and the execute function.
    """

    @classmethod
    def INPUT_TYPES(cls):
        checkpoints = folder_paths.get_filename_list("checkpoints")
        try:
            diffusion = folder_paths.get_filename_list("diffusion_models")
        except Exception:
            diffusion = []
        all_models = checkpoints + diffusion

        samplers   = ["(preset)"] + list(comfy.samplers.KSampler.SAMPLERS)
        schedulers = ["(preset)"] + list(comfy.samplers.KSampler.SCHEDULERS)

        clip_list = get_clip_list()
        vae_list  = get_vae_list()

        return {
            "required": {
                "model_name": (all_models if all_models else [""], {}),
            },
            "optional": {
                "override_sampler":      (samplers,),
                "override_scheduler":    (schedulers,),
                "override_cfg":          ("FLOAT", {"default": 0.0, "min": 0.0,  "max": 30.0, "step": 0.1}),
                "override_steps":        ("INT",   {"default": 0,   "min": 0,    "max": 200,  "step": 1}),
                "override_clip_skip":    ("INT",   {"default": 0,   "min": -24,  "max": 0,    "step": 1}),
                "override_width":        ("INT",   {"default": 0,   "min": 0,    "max": 8192, "step": 8}),
                "override_height":       ("INT",   {"default": 0,   "min": 0,    "max": 8192, "step": 8}),
                "override_rng":          (["(preset)", "cpu", "gpu", "nv"],),
                "override_vae_name":     (["(preset)"] + vae_list,),
                "override_clip_name":    (["(preset)"] + clip_list,),
                "resolution_preset":     (RESOLUTION_PRESET_NAMES,),
                "batch_size":            ("INT",   {"default": 1, "min": 1, "max": 64, "step": 1}),
            },
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE", "LATENT",
        "INT", "FLOAT",
        comfy.samplers.KSampler.SAMPLERS,
        comfy.samplers.KSampler.SCHEDULERS,
        "INT", "INT",
    )
    RETURN_NAMES = (
        "MODEL", "CLIP", "VAE", "LATENT",
        "steps", "cfg",
        "sampler_name", "scheduler",
        "width", "height",
    )
    FUNCTION    = "execute"
    CATEGORY    = "CWK/presets"
    OUTPUT_NODE = False

    def execute(
        self,
        model_name: str,
        override_sampler:   str   = "(preset)",
        override_scheduler: str   = "(preset)",
        override_cfg:       float = 0.0,
        override_steps:     int   = 0,
        override_clip_skip: int   = 0,
        override_width:     int   = 0,
        override_height:    int   = 0,
        override_rng:       str   = "(preset)",
        override_clip_name: str   = "(preset)",
        override_vae_name:  str   = "(preset)",
        resolution_preset:  str   = "(preset)",
        batch_size:         int   = 1,
    ) -> Tuple:
        # ── Save last-used model ───────────────────────────────────────────────
        save_last_used_model(model_name)

        # ── Load the checkpoint / diffusion model ─────────────────────────────
        is_checkpoint = folder_paths.get_full_path("checkpoints", model_name) is not None
        is_diffusion  = (not is_checkpoint
                         and folder_paths.get_full_path("diffusion_models", model_name) is not None)

        if not is_checkpoint and not is_diffusion:
            raise FileNotFoundError(f"[CWK] Model file not found: {model_name}")

        if is_checkpoint:
            from nodes import CheckpointLoaderSimple
            loader           = CheckpointLoaderSimple()
            model, clip, vae = loader.load_checkpoint(model_name)
        else:
            diff_path = folder_paths.get_full_path("diffusion_models", model_name)
            model = comfy.sd.load_diffusion_model(diff_path)
            clip = None
            vae  = None

        # ── Merge preset + overrides ──────────────────────────────────────────
        presets = load_presets()
        p       = {**default_preset(), **presets.get(model_name, {})}

        sampler_name = override_sampler   if override_sampler   != "(preset)" else p["sampler_name"]
        scheduler    = override_scheduler if override_scheduler != "(preset)" else p["scheduler"]
        cfg          = float(override_cfg)     if override_cfg        != 0.0 else float(p["cfg"])
        steps        = int(override_steps)     if override_steps      != 0   else int(p["steps"])
        clip_skip    = int(override_clip_skip) if override_clip_skip  != 0   else int(p["clip_skip"])
        width        = int(override_width)     if override_width       != 0  else int(p["width"])
        height       = int(override_height)    if override_height      != 0  else int(p["height"])
        rng          = override_rng            if override_rng        != "(preset)" else p["rng"]
        clip_name    = override_clip_name      if override_clip_name  != "(preset)" else p.get("clip_name", "embedded")
        vae_name     = override_vae_name       if override_vae_name   != "(preset)" else p.get("vae_name",  "embedded")

        # ── Apply resolution preset (overrides width/height if not "(preset)") ─
        if resolution_preset and resolution_preset != "(preset)":
            res = RESOLUTION_PRESETS.get(resolution_preset)
            if res and res[0] > 0 and res[1] > 0:
                width, height = res

        # ── Resolve sampler / scheduler with fallback ─────────────────────────
        sampler_name, scheduler = resolve_sampler_scheduler(sampler_name, scheduler)

        # ── Load external CLIP if needed ──────────────────────────────────────
        if clip_name and clip_name != "embedded":
            try:
                clip = _load_external_clip(clip_name)
                print(f"[CWK] External CLIP loaded: {clip_name}")
            except Exception as e:
                print(f"[CWK] Warning: could not load external CLIP '{clip_name}': {e}")
                if clip is None:
                    print(f"[CWK] No embedded CLIP available (diffusion model)")
                else:
                    print(f"[CWK] Falling back to embedded CLIP")
        elif clip is None and is_diffusion:
            print(f"[CWK] Note: diffusion model has no embedded CLIP — set an external CLIP in the preset")

        # ── Load external VAE if needed ───────────────────────────────────────
        if vae_name and vae_name != "embedded":
            try:
                vae = _load_external_vae(vae_name)
                print(f"[CWK] External VAE loaded: {vae_name}")
            except Exception as e:
                print(f"[CWK] Warning: could not load external VAE '{vae_name}': {e}")
                if vae is None:
                    print(f"[CWK] No embedded VAE available (diffusion model)")
                else:
                    print(f"[CWK] Falling back to embedded VAE")
        elif vae is None and is_diffusion:
            print(f"[CWK] Note: diffusion model has no embedded VAE — set an external VAE in the preset")

        # ── Apply clip_skip directly to the CLIP model ────────────────────────
        if clip is not None:
            try:
                clip = clip.clone()
                clip.clip_layer(clip_skip)
            except Exception as e:
                print(f"[CWK] Warning: could not apply clip_skip={clip_skip}: {e}")

        # ── Apply RNG ─────────────────────────────────────────────────────────
        model = _apply_rng(model, rng)

        # ── Generate empty latent ─────────────────────────────────────────────
        batch = max(1, batch_size)
        latent = torch.zeros([batch, 4, height // 8, width // 8],
                             device="cpu", dtype=torch.float32)

        print(
            f"[CWK] Loaded: {model_name} | "
            f"sampler={sampler_name} sched={scheduler} cfg={cfg} "
            f"steps={steps} clip_skip={clip_skip} "
            f"res={width}x{height} rng={rng} "
            f"clip={clip_name} vae={vae_name} batch={batch}"
        )

        return (model, clip, vae, {"samples": latent},
                steps, cfg, sampler_name, scheduler, width, height)


# ─── Node mappings ────────────────────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    "CWK_ModelPresetManager": CWK_ModelPresetManager,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CWK_ModelPresetManager": "CWK Model Preset Manager",
}