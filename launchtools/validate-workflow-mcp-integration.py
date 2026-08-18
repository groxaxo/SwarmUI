#!/usr/bin/env python3
"""Offline validation for the SwarmUI workflow MCP server and client configs."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
MCP_ROOT = ROOT / "integrations" / "workflow-mcp"
SERVER = MCP_ROOT / "src" / "index.js"

REQUIRED_FILES = [
    MCP_ROOT / "package.json",
    MCP_ROOT / "src" / "paths.js",
    MCP_ROOT / "src" / "catalog.js",
    MCP_ROOT / "src" / "customize.js",
    MCP_ROOT / "src" / "comfy-client.js",
    SERVER,
    MCP_ROOT / "test" / "catalog.test.js",
    MCP_ROOT / "test" / "customize.test.js",
    MCP_ROOT / "test" / "comfy-client.test.js",
    ROOT / ".mcp.json",
    ROOT / "opencode.json",
    ROOT / ".codex" / "config.toml",
    ROOT / ".omp" / "mcp.json",
    ROOT / ".agents" / "skills" / "swarmui-video-workflows" / "SKILL.md",
    ROOT / ".claude" / "skills" / "swarmui-video-workflows" / "SKILL.md",
    ROOT / "docs" / "Features" / "Workflow-MCP.md",
]

EXPECTED_TOOLS = {
    "list_workflows",
    "inspect_workflow",
    "get_workflow",
    "materialize_workflow",
    "validate_workflow",
    "get_backend_status",
    "get_queue",
    "get_history",
    "queue_workflow",
    "cancel_workflow",
    "server_capabilities",
}

LEGACY_RUNTIME_MARKERS = {
    "ltx-av-step-",
    "gemma-3-12b",
    "feature/av_inference",
}


def fail(message: str) -> None:
    raise RuntimeError(message)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"{path.relative_to(ROOT)}: invalid JSON: {error}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)}: expected a JSON object")
    return value


def require_path(path: Path) -> None:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")


def server_entry_from_json(config: dict, key: str) -> dict:
    entry = config
    for segment in key.split("."):
        entry = entry.get(segment)
        if not isinstance(entry, dict):
            fail(f"missing config object: {key}")
    return entry


def require_read_only_env(entry: dict, env_key: str) -> None:
    env = entry.get(env_key, {})
    if not isinstance(env, dict):
        fail(f"{env_key} must be an object")
    if env.get("SWARMUI_MCP_ALLOW_WRITES") != "false":
        fail("committed MCP config must set SWARMUI_MCP_ALLOW_WRITES=false")


def run_checked(command: list[str], cwd: Path) -> None:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    print(f"$ {' '.join(command)}")
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0:
        fail(f"command failed with exit code {result.returncode}: {' '.join(command)}")


def validate_package() -> None:
    package = load_json(MCP_ROOT / "package.json")
    if package.get("type") != "module":
        fail("workflow MCP package must use ESM")
    if package.get("engines", {}).get("node") != ">=20":
        fail("workflow MCP package must require Node.js >=20")
    dependencies = package.get("dependencies", {})
    expected = {
        "@modelcontextprotocol/server": "2.0.0",
        "zod": "4.4.3",
    }
    if dependencies != expected:
        fail(f"unexpected workflow MCP dependencies: {dependencies!r}")
    scripts = package.get("scripts", {})
    for name in ("start", "test", "check"):
        if name not in scripts:
            fail(f"package.json is missing script: {name}")


def validate_skills() -> None:
    canonical = ROOT / ".agents" / "skills" / "swarmui-video-workflows" / "SKILL.md"
    claude = ROOT / ".claude" / "skills" / "swarmui-video-workflows" / "SKILL.md"
    canonical_text = canonical.read_text(encoding="utf-8")
    claude_text = claude.read_text(encoding="utf-8")
    if canonical_text != claude_text:
        fail("Claude Code skill copy differs from canonical .agents skill")
    if not canonical_text.startswith("---\n"):
        fail("skill is missing YAML frontmatter")
    for required in (
        "name: swarmui-video-workflows",
        "LTX 2.5 only",
        "MiniMax H3",
        "queue_workflow",
        "cancel_workflow",
        "SWARMUI_MCP_ALLOW_WRITES=true",
    ):
        if required not in canonical_text:
            fail(f"skill is missing required instruction: {required}")


def validate_client_configs() -> None:
    claude = server_entry_from_json(load_json(ROOT / ".mcp.json"), "mcpServers.swarmui-workflows")
    if claude.get("command") != "bash":
        fail("Claude Code config must use the guarded Bash launcher")
    claude_args = claude.get("args")
    if not isinstance(claude_args, list) or "git rev-parse --show-toplevel" not in " ".join(claude_args):
        fail("Claude Code config must resolve the Git worktree root")
    if "SWARMUI_MCP_ALLOW_WRITES=false" not in " ".join(claude_args):
        fail("Claude Code launcher must default writes to false")

    opencode = server_entry_from_json(load_json(ROOT / "opencode.json"), "mcp.swarmui-workflows")
    if opencode.get("type") != "local":
        fail("OpenCode server must use local transport")
    command = opencode.get("command")
    if not isinstance(command, list) or "integrations/workflow-mcp/src/index.js" not in command:
        fail("OpenCode config does not launch the workflow MCP server")
    require_read_only_env(opencode, "environment")

    omp = server_entry_from_json(load_json(ROOT / ".omp" / "mcp.json"), "mcpServers.swarmui-workflows")
    if omp.get("type") != "stdio" or omp.get("command") != "node":
        fail("OMP server must use Node over stdio")
    if "integrations/workflow-mcp/src/index.js" not in omp.get("args", []):
        fail("OMP config does not launch the workflow MCP server")
    require_read_only_env(omp, "env")

    codex_path = ROOT / ".codex" / "config.toml"
    try:
        codex = tomllib.loads(codex_path.read_text(encoding="utf-8"))
    except Exception as error:
        fail(f"{codex_path.relative_to(ROOT)}: invalid TOML: {error}")
    codex_entry = codex.get("mcp_servers", {}).get("swarmui-workflows")
    if not isinstance(codex_entry, dict):
        fail("Codex config is missing mcp_servers.swarmui-workflows")
    if codex_entry.get("command") != "node":
        fail("Codex workflow MCP command must be node")
    if "integrations/workflow-mcp/src/index.js" not in codex_entry.get("args", []):
        fail("Codex config does not launch the workflow MCP server")
    require_read_only_env(codex_entry, "env")
    if codex_entry.get("default_tools_approval_mode") != "writes":
        fail("Codex config must prompt for write-like MCP tools")
    tools = codex_entry.get("tools", {})
    for tool in ("queue_workflow", "cancel_workflow"):
        if tools.get(tool, {}).get("approval_mode") != "prompt":
            fail(f"Codex config must require prompt approval for {tool}")


def validate_server_surface() -> None:
    text = SERVER.read_text(encoding="utf-8")
    for tool in EXPECTED_TOOLS:
        if f"'{tool}'" not in text:
            fail(f"server does not register expected tool: {tool}")
    for required in (
        "new StdioServerTransport()",
        "ResourceTemplate",
        "prepare-video-workflow",
        "requireWriteConfirmation(confirm)",
        "remoteMissingModels",
        "loadApiJson",
    ):
        if required == "loadApiJson":
            continue
        if required not in text:
            fail(f"server is missing required implementation marker: {required}")
    combined = "\n".join(
        path.read_text(encoding="utf-8").lower()
        for path in (MCP_ROOT / "src").glob("*.js")
    )
    for marker in LEGACY_RUNTIME_MARKERS:
        if marker in combined:
            fail(f"workflow MCP source contains legacy LTX runtime marker: {marker}")
    if "swarmui_mcp_allow_writes" not in combined:
        fail("server source is missing the environment write gate")
    if "confirm=true" not in combined:
        fail("server source is missing explicit confirmation enforcement")


def validate_runtime_sources() -> None:
    node = shutil.which("node")
    if node is None:
        print("SKIP: Node.js is unavailable; JSON/TOML/skill/static validation still passed.")
        return
    for source in sorted((MCP_ROOT / "src").glob("*.js")):
        run_checked([node, "--check", str(source)], ROOT)
    tests = sorted(str(path) for path in (MCP_ROOT / "test").glob("*.test.js"))
    run_checked([node, "--test", *tests], ROOT)


def main() -> int:
    for path in REQUIRED_FILES:
        require_path(path)
    validate_package()
    validate_skills()
    validate_client_configs()
    validate_server_surface()
    validate_runtime_sources()
    print("PASS: workflow MCP server, LTX 2.5/H3 skill, client configs, syntax, and unit tests validated.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
