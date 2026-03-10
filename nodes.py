"""
CWK Checkpoints Preset Manager — ComfyUI node definitions.

Single node: CWK_ModelPresetManager
  - Loads a checkpoint or diffusion model
  - Merges stored preset with optional per-execution overrides
  - Outputs: MODEL, CLIP, VAE, steps, cfg, sampler_name, scheduler, width, height
  - Applies clip_skip and rng internally
  - Supports external CLIP and VAE override (or embedded from checkpoint)
"""

import json
import os
from typing import Any, Dict, Tuple

import folder_paths
import comfy.samplers
import comfy.sd

# ─── Preset file path ─────────────────────────────────────────────────────────

_NODE_DIR     = os.path.dirname(__file__)
_PRESETS_FILE = os.path.join(_NODE_DIR, "checkpoint_presets.json")


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


# ─── RNG application ──────────────────────────────────────────────────────────

def _apply_rng(model, rng: str):
    """
    Apply cpu/gpu/nv RNG selection to the model.

    Uses the self-contained CWK RNG subsystem (cwk_rng_shared / cwk_rng_philox
    / cwk_rng) which is compatible with smZNodes' smZ_opts protocol.
    If smZNodes is also installed, it will see the same key and work
    transparently.

    This patches comfy.sample.prepare_noise with our own implementation that:
      - Supports cpu / gpu / nv (NVidia Philox) noise sources
      - Hijacks k-diffusion's default_noise_sampler for consistent batch noise
      - Reads options from model_options['smZ_opts'] via stack introspection
    """
    from . import cwk_rng_shared, cwk_rng

    model = model.clone()
    model.model_options = dict(model.model_options)

    # Store RNG options in model_options using the smZ_opts protocol
    opts = cwk_rng_shared.opts_default.clone()
    opts.randn_source = rng
    model.model_options[cwk_rng_shared.Options.KEY] = opts

    # Patch comfy.sample.prepare_noise with our self-contained implementation
    import comfy.sample
    if not hasattr(comfy.sample, '_cwk_original_prepare_noise'):
        comfy.sample._cwk_original_prepare_noise = comfy.sample.prepare_noise
    comfy.sample.prepare_noise = cwk_rng.prepare_noise

    print(f"[CWK] RNG set: randn_source={rng}")
    return model


# ─── External CLIP / VAE loaders ──────────────────────────────────────────────

def _load_external_clip(clip_name: str):
    """Load an external CLIP model by filename."""
    clip_path = folder_paths.get_full_path("clip", clip_name)
    if not clip_path:
        raise FileNotFoundError(f"[CWK] CLIP file not found: {clip_name}")
    clip = comfy.sd.load_clip(ckpt_paths=[clip_path], embedding_directory=folder_paths.get_folder_paths("embeddings"))
    return clip


def _load_external_vae(vae_name: str):
    """Load an external VAE model by filename."""
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
                "override_sampler":   (samplers,),
                "override_scheduler": (schedulers,),
                "override_cfg":       ("FLOAT", {"default": 0.0, "min": 0.0,  "max": 30.0, "step": 0.1}),
                "override_steps":     ("INT",   {"default": 0,   "min": 0,    "max": 200,  "step": 1}),
                "override_clip_skip": ("INT",   {"default": 0,   "min": -24,  "max": 0,    "step": 1}),
                "override_width":     ("INT",   {"default": 0,   "min": 0,    "max": 8192, "step": 8}),
                "override_height":    ("INT",   {"default": 0,   "min": 0,    "max": 8192, "step": 8}),
                "override_rng":       (["(preset)", "cpu", "gpu", "nv"],),
                "override_vae_name":  (["(preset)"] + vae_list,),
                "override_clip_name": (["(preset)"] + clip_list,),
            },
        }

    RETURN_TYPES = (
        "MODEL", "CLIP", "VAE",
        "INT", "FLOAT",
        comfy.samplers.KSampler.SAMPLERS,
        comfy.samplers.KSampler.SCHEDULERS,
        "INT", "INT",
    )
    RETURN_NAMES = (
        "MODEL", "CLIP", "VAE",
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
    ) -> Tuple:
        # ── Load the checkpoint / diffusion model ─────────────────────────────
        from nodes import CheckpointLoaderSimple
        ckpt_path = (
            folder_paths.get_full_path("checkpoints",      model_name) or
            folder_paths.get_full_path("diffusion_models", model_name)
        )
        if not ckpt_path:
            raise FileNotFoundError(f"[CWK] Model file not found: {model_name}")

        loader           = CheckpointLoaderSimple()
        model, clip, vae = loader.load_checkpoint(model_name)

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

        # ── Load external CLIP if not embedded ────────────────────────────────
        if clip_name and clip_name != "embedded":
            try:
                clip = _load_external_clip(clip_name)
                print(f"[CWK] External CLIP loaded: {clip_name}")
            except Exception as e:
                print(f"[CWK] Warning: could not load external CLIP '{clip_name}': {e}")
                print(f"[CWK] Falling back to embedded CLIP")

        # ── Load external VAE if not embedded ─────────────────────────────────
        if vae_name and vae_name != "embedded":
            try:
                vae = _load_external_vae(vae_name)
                print(f"[CWK] External VAE loaded: {vae_name}")
            except Exception as e:
                print(f"[CWK] Warning: could not load external VAE '{vae_name}': {e}")
                print(f"[CWK] Falling back to embedded VAE")

        # ── Apply clip_skip directly to the CLIP model ────────────────────────
        try:
            clip = clip.clone()
            clip.clip_layer(clip_skip)
        except Exception as e:
            print(f"[CWK] Warning: could not apply clip_skip={clip_skip}: {e}")

        # ── Apply RNG ─────────────────────────────────────────────────────────
        model = _apply_rng(model, rng)

        print(
            f"[CWK] Loaded: {model_name} | "
            f"sampler={sampler_name} sched={scheduler} cfg={cfg} "
            f"steps={steps} clip_skip={clip_skip} "
            f"res={width}x{height} rng={rng} "
            f"clip={clip_name} vae={vae_name}"
        )

        return (model, clip, vae, steps, cfg, sampler_name, scheduler, width, height)


# ─── Node mappings ────────────────────────────────────────────────────────────

NODE_CLASS_MAPPINGS = {
    "CWK_ModelPresetManager": CWK_ModelPresetManager,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CWK_ModelPresetManager": "CWK Model Preset Manager",
}