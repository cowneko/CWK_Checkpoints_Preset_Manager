"""
CWK Checkpoints Preset Manager — ComfyUI entry point.
Registers nodes and REST routes with the ComfyUI server.
"""

from .nodes  import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .server import register_routes

try:
    from server import PromptServer
    register_routes(PromptServer.instance.app)
except Exception as e:
    print(f"[CWK_PresetManager] Could not register routes: {e}")

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]