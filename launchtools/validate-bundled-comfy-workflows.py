#!/usr/bin/env python3
"""Validate bundled LTX 2.5 and MiniMax H3 workflows without network access."""

from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "src" / "BuiltinExtensions" / "ComfyUIBackend" / "ExampleWorkflows"
LTX = EXAMPLES / "LTX 2.5"
H3 = EXAMPLES / "MiniMax H3"
TAB = ROOT / "src" / "BuiltinExtensions" / "ComfyUIBackend" / "Tabs" / "Text2Image" / "Comfy Workflow.html"

LEGACY_LTX_MARKERS = (
    "ltx-av-step-",
    "gemma-3-",
    "gemma_path",
    "ltxv_path",
    "feature/av_inference",
)
REQUIRED_LTX_ASSETS = (
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
    "ltx-2.5-video-vae-bf16.safetensors",
    "ltx-2.5-audio-vae-bf16.safetensors",
    "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
)
REQUIRED_H3_CLASSES = {
    "MiniMaxH3LoaderSafetensorsBlockMultiGPU",
    "CLIPLoaderDisTorch2MultiGPU",
    "VAELoaderMultiGPU",
    "CreateVideo",
    "SaveVideo",
}


def fail(message: str) -> None:
    raise RuntimeError(message)


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"{path.relative_to(ROOT)}: invalid JSON: {error}")


def validate_prompt(path: Path, prompt: object) -> dict:
    if not isinstance(prompt, dict) or not prompt:
        fail(f"{path.relative_to(ROOT)}: missing non-empty API prompt")
    for node_id, node in prompt.items():
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str):
            fail(f"{path.relative_to(ROOT)}: prompt node {node_id} has no class_type")
    for target, node in prompt.items():
        for name, value in node.get("inputs", {}).items():
            if isinstance(value, list) and len(value) == 2:
                source, slot = str(value[0]), value[1]
                if source not in prompt:
                    fail(f"{path.relative_to(ROOT)}: {target}.{name} references missing node {source}")
                if not isinstance(slot, int) or slot < 0:
                    fail(f"{path.relative_to(ROOT)}: {target}.{name} has invalid output slot")
    return prompt


def validate_wrapper(path: Path) -> dict:
    data = load(path)
    validate_prompt(path, data.get("prompt"))
    workflow = data.get("workflow")
    if workflow is not None and not isinstance(workflow, dict):
        fail(f"{path.relative_to(ROOT)}: workflow must be an object or null")
    return data


def main() -> int:
    fallback = TAB.read_text(encoding="utf-8")
    for required in ("loadApiJson", "parseStoredJson", "swarmSupportsApiPromptImport"):
        if required not in fallback:
            fail(f"{TAB.relative_to(ROOT)}: native API-import fallback is missing {required}")

    ltx_path = LTX / "LTX 2.5 Official Rolling Segment Core.json"
    ltx = validate_wrapper(ltx_path)
    ltx_text = json.dumps(ltx, sort_keys=True).lower()
    for marker in LEGACY_LTX_MARKERS:
        if marker in ltx_text:
            fail(f"{ltx_path.relative_to(ROOT)}: legacy LTX runtime marker found: {marker}")
    for asset in REQUIRED_LTX_ASSETS:
        if asset.lower() not in ltx_text:
            fail(f"{ltx_path.relative_to(ROOT)}: required LTX 2.5 asset missing: {asset}")
    ltx_classes = {node["class_type"] for node in ltx["prompt"].values()}
    required_topology = {
        "UNETLoader", "CLIPLoader", "LTXVConditioning", "LTXVPreprocess",
        "SamplerCustomAdvanced", "LTXVLatentUpsampler", "LTXVAudioVAEDecode",
        "VAEDecodeTiled", "CreateVideo", "SaveVideo",
    }
    if not required_topology <= ltx_classes:
        fail(f"{ltx_path.relative_to(ROOT)}: incomplete LTX 2.5 topology")
    if sum(node["class_type"] == "SamplerCustomAdvanced" for node in ltx["prompt"].values()) != 2:
        fail(f"{ltx_path.relative_to(ROOT)}: expected exactly two diffusion stages")

    story = LTX / "LTX 2.5 Standard 15s Three Prompt Rolling Chain.story.json.example"
    story_data = load(story)
    if len(story_data.get("segments", [])) != 3:
        fail(f"{story.relative_to(ROOT)}: expected exactly three segments")
    stale_story = LTX / "LTX 2.5 Standard 15s Three Prompt Rolling Chain.story.json"
    if stale_story.exists():
        fail(f"{stale_story.relative_to(ROOT)}: scanner-visible story wrapper still exists")

    h3_paths = sorted(path for path in H3.rglob("*.json") if path.is_file())
    if len(h3_paths) != 8:
        fail(f"{H3.relative_to(ROOT)}: expected 8 H3 workflows, found {len(h3_paths)}")
    for path in h3_paths:
        data = validate_wrapper(path)
        classes = {node["class_type"] for node in data["prompt"].values()}
        if not REQUIRED_H3_CLASSES <= classes:
            fail(f"{path.relative_to(ROOT)}: missing required MiniMax H3 classes")
        text = json.dumps(data, sort_keys=True)
        if not any(marker in text for marker in ("MiniMaxH3", "minimax_h3", "MiniMax-H3")):
            fail(f"{path.relative_to(ROOT)}: no MiniMax H3 model or node reference")
        if path.parent.name == "Story" and "PIPELINE_REPLACES_" not in text:
            fail(f"{path.relative_to(ROOT)}: story template lost replacement placeholders")

    print(
        "PASS: native API import, complete LTX 2.5 prompt, 8 MiniMax H3 prompts, "
        "and scanner-excluded three-segment descriptor validated."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
