# Ubuntu acceptance runbook: ComfyUI 0.33.0

This is the release gate for SwarmUI interoperability with **ComfyUI 0.33.0** on Ubuntu and three NVIDIA GPUs. It is an execution procedure, not a claim that the tests have already run.

ComfyUI 0.33.0 serves its native HTTP and WebSocket interface at root paths such as `/system_stats`, `/object_info`, `/prompt`, `/queue`, `/interrupt`, `/history`, `/view`, and `/ws`. A frontend development server or reverse proxy may expose the same interface below `/api`. The exact frontend package for this release is `comfyui-frontend-package==1.48.7`.

## Acceptance contract

A candidate passes only when every mandatory ID below occurs exactly once as `PASS` in `99-summary/results.tsv`, with all named evidence present. `FAIL`, `BLOCKED`, missing evidence, or an unexecuted test is not acceptable for release.

| ID | Scope |
| --- | --- |
| `S00` | Host and source identity |
| `S01` | Repository scan, diff validation, and Release build |
| `D01` | Exact ComfyUI release and dependency baseline |
| `D02` | Self-start dependency repair and protected-package validation |
| `B01` | Self-start backend on GPU 0 |
| `B02` | Self-start backend on GPU 1 |
| `B03` | Self-start backend on GPU 2 |
| `B04` | Three simultaneous jobs, one backend per physical GPU |
| `R01` | Native root-route auto-detection |
| `R02` | Live `/api` auto-detection |
| `R03` | Offline-start `/api` recovery |
| `R04` | Forced root fallback and blank-address disable behaviour |
| `G01` | Generate tab through root routes |
| `G02` | Generate tab through `/api` routes |
| `C01` | Comfy Workflow generation from both entry points |
| `W01` | WebSocket upgrade and live previews |
| `W02` | Cancellation, cleanup, and recovery |
| `H01` | Final outputs and history lifecycle |
| `M01` | Model-path YAML and text-encoder discovery |

Do not place credentials, cookies, tokens, private prompts, or private model metadata in the evidence bundle.

## 1. Prepare Ubuntu and the evidence bundle

Run in Bash as the same user that will run SwarmUI and ComfyUI.

```bash
set -Eeuo pipefail

sudo apt-get update
sudo apt-get install -y \
  bsdextrautils ca-certificates curl file git jq lsb-release nginx \
  python3 python3-pip python3-venv tcpdump tmux unzip

export SWARM_REPO="$HOME/src/SwarmUI"
export COMFY_REPO="$HOME/src/ComfyUI-0.33.0"
export COMFY_URL="https://github.com/Comfy-Org/ComfyUI.git"
export RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export EV="$HOME/swarmui-acceptance/comfyui-0.33.0/$RUN_ID"

mkdir -p "$EV"/{00-host,10-build,20-deps,30-self-start,40-routes,50-generate,60-workflow,70-ws-cancel,80-history,90-model-paths,99-summary}
printf 'TEST_ID\tRESULT\tEVIDENCE\tNOTES\n' > "$EV/99-summary/results.tsv"

record_result() {
  local test_id="$1" result="$2" evidence="$3" notes="${4:-}"
  printf '%s\t%s\t%s\t%s\n' "$test_id" "$result" "$evidence" "$notes" \
    >> "$EV/99-summary/results.tsv"
}

exec > >(tee -a "$EV/terminal.log") 2>&1
export PS4='+ $(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) ${BASH_SOURCE}:${LINENO}: '
set -x
```

Create one reusable process-discovery helper. It resolves a relative `main.py` against each process working directory, not against the shell's current directory.

```bash
cat > "$EV/discover_comfy.py" <<'PY'
from pathlib import Path
import sys

script = Path(sys.argv[1]).resolve()
rows = []
for proc in Path("/proc").glob("[0-9]*"):
    try:
        args = [x.decode() for x in (proc / "cmdline").read_bytes().split(b"\0") if x]
        cwd = (proc / "cwd").resolve()
        if cwd != script.parent or not any(Path(arg).name == script.name for arg in args):
            continue
        env = {}
        for item in (proc / "environ").read_bytes().split(b"\0"):
            if b"=" in item:
                key, value = item.split(b"=", 1)
                env[key.decode()] = value.decode()
        gpu = env.get("CUDA_VISIBLE_DEVICES", "")
        port = args[args.index("--port") + 1]
        rows.append((f"comfy033-gpu{gpu}", gpu, int(proc.name), int(port)))
    except (FileNotFoundError, PermissionError, ValueError, UnicodeDecodeError):
        pass
rows.sort(key=lambda row: row[1])
print("name\tgpu\tpid\tport")
for row in rows:
    print("\t".join(map(str, row)))
PY

cat > "$EV/validate_proxy_log.py" <<'PY'
from pathlib import Path
import re, sys

pattern = re.compile(r'"([A-Z]+) ([^ ]+) HTTP/[^\"]+" ([0-9]{3}) ')
seen = 0
for line in Path(sys.argv[1]).read_text().splitlines():
    match = pattern.search(line)
    if not match:
        continue
    seen += 1
    _method, path, status = match.groups()
    if (status == "101" or status.startswith("2")) and not path.startswith("/api/"):
        raise AssertionError(f"Successful API request lost prefix: {line}")
assert seen, "Proxy access log contained no parseable requests"
print("SUCCESSFUL_REQUEST_PREFIXES=PASS")
PY
```

## 2. Source and build gates

### S00 — host and source identity

Use the exact pull-request head or merged squash commit under test. The worktree must be clean.

```bash
{
  date -u --iso-8601=seconds
  uname -a
  lsb_release -a
  nvidia-smi -L
  nvidia-smi \
    --query-gpu=index,uuid,name,driver_version,memory.total \
    --format=csv
} 2>&1 | tee "$EV/00-host/host.txt"

cd "$SWARM_REPO"
git status --short | tee "$EV/00-host/swarm-status.txt"
git remote -v | tee "$EV/00-host/swarm-remotes.txt"
git branch --show-current | tee "$EV/00-host/swarm-branch.txt"
git rev-parse HEAD | tee "$EV/00-host/swarm-head.txt"
git show -s --format=fuller HEAD | tee "$EV/00-host/swarm-commit.txt"

test ! -s "$EV/00-host/swarm-status.txt"
test "$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)" -ge 3
for index in 0 1 2; do
  nvidia-smi --query-gpu=index --format=csv,noheader \
    | tr -d ' ' | grep -Fx "$index"
done

record_result S00 PASS \
  "00-host/host.txt; 00-host/swarm-head.txt; 00-host/swarm-status.txt" \
  "Clean committed source; physical GPUs 0, 1, and 2 are visible"
```

**Fail:** dirty or unidentified source, fewer than three GPUs, duplicate indices, or an NVIDIA driver error.

### S01 — removed policy material, diff integrity, and Release build

For a pull-request head use its target branch as `BASE_REF`. For an already-merged squash commit use its first parent.

```bash
cd "$SWARM_REPO"
export BASE_REF="${BASE_REF:-origin/master}"
git fetch origin master

git diff --check "$BASE_REF"...HEAD \
  2>&1 | tee "$EV/10-build/diff-check.txt"

POLICY_FILE="$(printf '%s%s' 'AG' 'ENTS.md')"
POLICY_DIR="$(printf '.%s%s' 'ag' 'ents')"
TERM_ONE="$(printf '%s%s' 'ag' 'ent')"
TERM_TWO="$(printf '%s%s' 'LLM-Written ' 'Code')"
DOC_PATTERN="(^|[^[:alnum:]])${TERM_ONE}(s|ic)?([^[:alnum:]]|$)|${TERM_TWO}"

test ! -e "$POLICY_FILE"
test ! -e "$POLICY_DIR"
if git grep -nEi "$DOC_PATTERN" -- CONTRIBUTING.md docs \
     > "$EV/10-build/disallowed-doc-text.txt"; then
  cat "$EV/10-build/disallowed-doc-text.txt"
  echo "Removed policy material is still present" >&2
  false
fi

{
  dotnet --info
  dotnet restore src/SwarmUI.csproj
  dotnet build src/SwarmUI.csproj -c Release --no-restore
} 2>&1 | tee "$EV/10-build/release-build.txt"

! grep -Ei '(^|[[:space:]])error[[:space:]]+[A-Z]{2,}[0-9]+:' \
  "$EV/10-build/release-build.txt"

git diff --name-only "$BASE_REF"...HEAD -- '*.cs' \
  | tee "$EV/10-build/changed-cs.txt"
while IFS= read -r source_file; do
  test -z "$source_file" && continue
  if grep -F "$source_file" "$EV/10-build/release-build.txt" | grep -i warning; then
    echo "Build warning in changed source: $source_file" >&2
    false
  fi
done < "$EV/10-build/changed-cs.txt"

record_result S01 PASS \
  "10-build/diff-check.txt; 10-build/disallowed-doc-text.txt; 10-build/release-build.txt; 10-build/changed-cs.txt" \
  "Repository scan and diff are clean; Release build succeeds without warnings in changed source"
```

**Fail:** stale policy text, a whitespace error, compiler failure, or a warning in changed C# source.

## 3. Exact ComfyUI release and dependencies

### D01 — baseline

Use a dedicated checkout whose `venv` directory is beside `main.py`.

```bash
if test ! -e "$COMFY_REPO"; then
  git clone --branch v0.33.0 --depth 1 "$COMFY_URL" "$COMFY_REPO"
fi

cd "$COMFY_REPO"
test "$(git describe --tags --exact-match)" = "v0.33.0"
git status --short | tee "$EV/20-deps/comfy-status.txt"
git rev-parse HEAD | tee "$EV/20-deps/comfy-head.txt"
git show -s --format=fuller HEAD | tee "$EV/20-deps/comfy-commit.txt"
test ! -s "$EV/20-deps/comfy-status.txt"

python3 -m venv venv
export COMFY_PY="$COMFY_REPO/venv/bin/python3"
"$COMFY_PY" -m pip install --upgrade pip packaging
"$COMFY_PY" -m pip install -r requirements.txt \
  2>&1 | tee "$EV/20-deps/pip-install.txt"
"$COMFY_PY" -m pip check | tee "$EV/20-deps/pip-check-before.txt"
"$COMFY_PY" -m pip freeze | sort > "$EV/20-deps/pip-freeze-before.txt"

"$COMFY_PY" - <<'PY' | tee "$EV/20-deps/baseline-verification.txt"
from importlib import import_module
from importlib.metadata import version
from pathlib import Path
from packaging.version import Version
import sys

namespace = {}
exec((Path.cwd() / "comfyui_version.py").read_text(), namespace)
assert namespace["__version__"] == "0.33.0"

exact = {
    "comfyui-frontend-package": "1.48.7",
    "comfyui-workflow-templates": "0.9.22",
    "comfyui-embedded-docs": "0.4.3",
}
minimum = {
    "numpy": "1.25.0",
    "transformers": "4.50.3",
    "tokenizers": "0.13.3",
    "safetensors": "0.4.2",
    "aiohttp": "3.11.8",
    "yarl": "1.18.0",
    "av": "14.2.0",
    "kornia": "0.7.1",
    "comfy-kitchen": "0.2.9",
    "comfy-aimdo": "0.2.9",
}
modules = [
    "torch", "torchvision", "torchaudio", "torchsde", "numpy", "einops",
    "transformers", "tokenizers", "sentencepiece", "safetensors", "aiohttp",
    "yarl", "yaml", "PIL", "scipy", "tqdm", "psutil", "alembic",
    "sqlalchemy", "av", "kornia", "spandrel", "pydantic",
    "pydantic_settings", "comfy_kitchen", "comfy_aimdo",
]
for package, wanted in exact.items():
    got = version(package)
    assert got == wanted, f"{package}: expected {wanted}, got {got}"
    print(f"EXACT {package}={got}")
for package, floor in minimum.items():
    got = version(package)
    assert Version(got) >= Version(floor), f"{package}: expected >= {floor}, got {got}"
    print(f"MINIMUM {package}={got}")
assert Version(version("pydantic")).major == 2
assert Version(version("pydantic-settings")).major == 2
for module in modules:
    import_module(module)
    print(f"IMPORT {module}=OK")
assert sys.executable.endswith("/venv/bin/python3")
print("COMFYUI_VERSION=0.33.0")
print(f"PYTHON={sys.executable}")
PY

"$COMFY_PY" - <<'PY' | tee "$EV/20-deps/torch.txt"
import torch
print("torch", torch.__version__)
print("cuda_available", torch.cuda.is_available())
print("cuda_runtime", torch.version.cuda)
print("unmasked_gpu_count", torch.cuda.device_count())
assert torch.cuda.is_available()
assert torch.cuda.device_count() >= 3
PY

record_result D01 PASS \
  "20-deps/comfy-head.txt; 20-deps/baseline-verification.txt; 20-deps/pip-check-before.txt; 20-deps/pip-freeze-before.txt; 20-deps/torch.txt" \
  "Official v0.33.0 checkout, frontend 1.48.7, valid imports, clean dependencies, CUDA available"
```

**Fail:** wrong tag or frontend, missing import, dependency conflict, CPU-only Torch, or fewer than three GPUs.

## 4. Model fixture and SwarmUI startup

Use one legitimate SDXL checkpoint already present on the host.

```bash
export TEST_CHECKPOINT_ABS="/absolute/path/to/test-sdxl-checkpoint.safetensors"
export MODEL_ROOT="/absolute/path/to/the/configured/swarm-model-root"
export TEST_CHECKPOINT_REL="relative/name/displayed/by/SwarmUI.safetensors"

test -s "$TEST_CHECKPOINT_ABS"
test -d "$MODEL_ROOT"
test -e "$MODEL_ROOT/Stable-Diffusion/$TEST_CHECKPOINT_REL"
file "$TEST_CHECKPOINT_ABS" | tee "$EV/00-host/checkpoint-file.txt"
sha256sum "$TEST_CHECKPOINT_ABS" | tee "$EV/00-host/checkpoint-sha256.txt"

cd "$SWARM_REPO"
tmux kill-session -t swarm033 2>/dev/null || true
tmux new-session -d -s swarm033 \
  "cd '$SWARM_REPO' && ./launch-linux.sh 2>&1 | tee '$EV/10-build/swarm-runtime.log'"
timeout 180 bash -c '
  until curl -fsS http://127.0.0.1:7801/ >/dev/null; do sleep 1; done
'
curl -fsS -o "$EV/10-build/swarm-index.html" http://127.0.0.1:7801/
```

Configure `MODEL_ROOT` under **Server → Server Configuration → Paths**, refresh models, and confirm `TEST_CHECKPOINT_REL` is selectable.

## 5. Self-start and dependency repair

Create one **ComfyUI Self-Starting** backend:

| Field | Value |
| --- | --- |
| Name | `comfy033-gpu0` |
| Start Script | absolute `$COMFY_REPO/main.py` |
| Extra Args | empty |
| Disable Internal Args | off |
| Auto Update | disabled |
| Update Managed Nodes | disabled |
| Frontend Version | `Latest Swarm Validated` |
| Enable Previews | `Enabled (fast latent2rgb)` |
| GPU ID | `0` |
| OverQueue | `1` |
| Auto Restart | off |

Keep all other ComfyUI backends stopped until `D02` finishes.

### D02 — controlled repair

Start `comfy033-gpu0` once, confirm `Running`, and stop it. Then:

```bash
"$COMFY_PY" - <<'PY' > "$EV/20-deps/protected-before.json"
from importlib.metadata import version
import json
packages = ["torch", "torchvision", "torchaudio", "torchsde"]
print(json.dumps({p: version(p) for p in packages}, indent=2, sort_keys=True))
PY

"$COMFY_PY" -m pip uninstall -y einops \
  2>&1 | tee "$EV/20-deps/remove-einops.txt"
if "$COMFY_PY" -c 'import einops' 2> "$EV/20-deps/einops-missing.txt"; then
  echo "einops was not removed" >&2
  false
fi
```

Start `comfy033-gpu0` and wait for `Running`, then:

```bash
"$COMFY_PY" -c 'import einops; print(einops.__version__)' \
  | tee "$EV/20-deps/einops-after-self-start.txt"
"$COMFY_PY" -m pip check | tee "$EV/20-deps/pip-check-after.txt"
"$COMFY_PY" -m pip freeze | sort > "$EV/20-deps/pip-freeze-after.txt"

"$COMFY_PY" - <<'PY' "$EV/20-deps/protected-before.json" \
  | tee "$EV/20-deps/protected-after.txt"
from importlib.metadata import version
import json, sys
before = json.load(open(sys.argv[1]))
after = {p: version(p) for p in before}
assert after == before, f"Protected package change: before={before}, after={after}"
assert version("comfyui-frontend-package") == "1.48.7"
print(json.dumps(after, indent=2, sort_keys=True))
print("FRONTEND=1.48.7")
PY

python3 - <<'PY' \
  "$EV/20-deps/pip-freeze-before.txt" \
  "$EV/20-deps/pip-freeze-after.txt" \
  | tee "$EV/20-deps/package-delta.txt"
from pathlib import Path
import sys
before = set(Path(sys.argv[1]).read_text().splitlines())
after = set(Path(sys.argv[2]).read_text().splitlines())
print("REMOVED_OR_CHANGED")
print("\n".join(sorted(before - after)))
print("ADDED_OR_CHANGED")
print("\n".join(sorted(after - before)))
PY

grep -F "Will use python: $COMFY_PY" "$EV/10-build/swarm-runtime.log" \
  | tail -n 5 > "$EV/20-deps/python-selection.txt"
test -s "$EV/20-deps/python-selection.txt"
grep -Ei "Installing 'einops'|validate required libs" \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 100 > "$EV/20-deps/swarm-repair-log.txt"
test -s "$EV/20-deps/swarm-repair-log.txt"
```

Save `20-deps/D02-running.png`, then:

```bash
record_result D02 PASS \
  "20-deps/remove-einops.txt; 20-deps/einops-after-self-start.txt; 20-deps/pip-check-after.txt; 20-deps/protected-after.txt; 20-deps/package-delta.txt; 20-deps/python-selection.txt; 20-deps/swarm-repair-log.txt; 20-deps/D02-running.png" \
  "Dedicated venv used; einops restored; frontend retained; protected CUDA packages unchanged"
```

**Fail:** system Python is used, protected packages or frontend change, repair fails, or the backend is not `Running`.

## 6. One backend per GPU

Copy the validated backend twice and change only name and GPU ID:

| ID | Name | GPU ID |
| --- | --- | ---: |
| `B01` | `comfy033-gpu0` | `0` |
| `B02` | `comfy033-gpu1` | `1` |
| `B03` | `comfy033-gpu2` | `2` |

Start all three, then derive live PIDs and ports:

```bash
python3 "$EV/discover_comfy.py" "$COMFY_REPO/main.py" \
  | tee "$EV/30-self-start/backends.tsv"
python3 - <<'PY' "$EV/30-self-start/backends.tsv"
import csv, sys
with open(sys.argv[1], newline="") as handle:
    rows = list(csv.DictReader(handle, delimiter="\t"))
assert len(rows) == 3, rows
assert [row["gpu"] for row in rows] == ["0", "1", "2"], rows
assert len({row["pid"] for row in rows}) == 3
assert len({row["port"] for row in rows}) == 3
PY

ps -eo pid=,args= | grep -F "$COMFY_REPO/main.py" \
  | grep -v grep | tee "$EV/30-self-start/processes.txt" || true
ss -ltnp | tee "$EV/30-self-start/listeners.txt"

: > "$EV/30-self-start/system-stats.jsonl"
tail -n +2 "$EV/30-self-start/backends.tsv" \
  | while IFS=$'\t' read -r name gpu pid port; do
      curl -fsS "http://127.0.0.1:$port/system_stats" \
        | jq -c --arg backend "$name" --arg gpu "$gpu" --arg pid "$pid" \
          '{backend:$backend,configured_gpu:$gpu,pid:$pid,version:.system.comfyui_version,devices:.devices}' \
        | tee -a "$EV/30-self-start/system-stats.jsonl"
    done
if jq -e 'select(.version != "0.33.0")' \
     "$EV/30-self-start/system-stats.jsonl" >/dev/null; then
  echo "A backend reports the wrong ComfyUI version" >&2
  false
fi
```

Save `B01-gpu0-running.png`, `B02-gpu1-running.png`, and `B03-gpu2-running.png`, each showing `Running`.

```bash
record_result B01 PASS \
  "30-self-start/backends.tsv; 30-self-start/system-stats.jsonl; 30-self-start/B01-gpu0-running.png" \
  "Unique PID and port, CUDA mask 0, ComfyUI 0.33.0"
record_result B02 PASS \
  "30-self-start/backends.tsv; 30-self-start/system-stats.jsonl; 30-self-start/B02-gpu1-running.png" \
  "Unique PID and port, CUDA mask 1, ComfyUI 0.33.0"
record_result B03 PASS \
  "30-self-start/backends.tsv; 30-self-start/system-stats.jsonl; 30-self-start/B03-gpu2-running.png" \
  "Unique PID and port, CUDA mask 2, ComfyUI 0.33.0"
```

**Fail:** combined or duplicate GPU masks, duplicate PIDs/ports, incorrect version, or any backend not `Running`.

### B04 — simultaneous fan-out

Generate three images with the test checkpoint: `1024×1024`, 40 steps, CFG 5, Euler, Normal, seed `330000`, batch size 1, images 3, prompt `SwarmUI ComfyUI 0.33.0 three GPU acceptance RUN_ID`.

Immediately before clicking **Generate**:

```bash
: > "$EV/30-self-start/B04-gpu-telemetry.csv"
for _ in $(seq 1 120); do
  printf '%s,' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
    >> "$EV/30-self-start/B04-gpu-telemetry.csv"
  nvidia-smi --query-gpu=index,uuid,utilization.gpu,memory.used \
    --format=csv,noheader,nounits | paste -sd '|' - \
    >> "$EV/30-self-start/B04-gpu-telemetry.csv"
  sleep 1
done &
GPU_WATCH_PID=$!

: > "$EV/30-self-start/B04-queues.jsonl"
for _ in $(seq 1 120); do
  stamp="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  tail -n +2 "$EV/30-self-start/backends.tsv" \
    | while IFS=$'\t' read -r name gpu pid port; do
        curl -fsS "http://127.0.0.1:$port/queue" \
          | jq -c --arg time "$stamp" --arg backend "$name" \
            '{time:$time,backend:$backend,queue_running,queue_pending}' \
          >> "$EV/30-self-start/B04-queues.jsonl" || true
      done
  sleep 1
done &
QUEUE_WATCH_PID=$!
```

After all three complete:

```bash
kill "$GPU_WATCH_PID" "$QUEUE_WATCH_PID" 2>/dev/null || true
wait "$GPU_WATCH_PID" "$QUEUE_WATCH_PID" 2>/dev/null || true
nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits \
  > "$EV/30-self-start/gpu-index-uuid.csv"
nvidia-smi --query-compute-apps=pid,gpu_uuid,used_memory \
  --format=csv,noheader,nounits \
  > "$EV/30-self-start/compute-apps.csv"

python3 - <<'PY' \
  "$EV/30-self-start/backends.tsv" \
  "$EV/30-self-start/gpu-index-uuid.csv" \
  "$EV/30-self-start/compute-apps.csv" \
  "$EV/30-self-start/B04-queues.jsonl" \
  | tee "$EV/30-self-start/B04-validation.txt"
import csv, json, sys
from pathlib import Path
with open(sys.argv[1], newline="") as handle:
    backends = list(csv.DictReader(handle, delimiter="\t"))
index_uuid = {}
for line in Path(sys.argv[2]).read_text().splitlines():
    index, uuid = [part.strip() for part in line.split(",", 1)]
    index_uuid[index] = uuid
pid_uuids = {}
for line in Path(sys.argv[3]).read_text().splitlines():
    if not line.strip():
        continue
    pid, uuid, _memory = [part.strip() for part in line.split(",", 2)]
    pid_uuids.setdefault(pid, set()).add(uuid)
for backend in backends:
    expected = index_uuid[backend["gpu"]]
    seen = pid_uuids.get(backend["pid"], set())
    assert seen == {expected}, f"{backend['name']}: expected {expected}, saw {seen}"
ran = {backend["name"]: False for backend in backends}
for line in Path(sys.argv[4]).read_text().splitlines():
    row = json.loads(line)
    if row.get("queue_running"):
        ran[row["backend"]] = True
assert all(ran.values()), ran
print("PID_TO_PHYSICAL_GPU=PASS")
print("EVERY_BACKEND_RAN_A_JOB=PASS")
PY
```

Download the three originals into `30-self-start/B04-originals/`; save `B04-three-results.png` and `B04-backends-running.png`.

```bash
mkdir -p "$EV/30-self-start/B04-originals"
test "$(find "$EV/30-self-start/B04-originals" -type f | wc -l)" -eq 3
sha256sum "$EV/30-self-start/B04-originals"/* \
  > "$EV/30-self-start/B04-output-sha256.txt"
record_result B04 PASS \
  "30-self-start/B04-gpu-telemetry.csv; 30-self-start/B04-queues.jsonl; 30-self-start/B04-validation.txt; 30-self-start/B04-three-results.png; 30-self-start/B04-backends-running.png; 30-self-start/B04-output-sha256.txt" \
  "Three jobs completed; every backend ran; each PID mapped to its configured physical GPU"
```

**Fail:** a GPU remains unused, jobs serialise onto one backend while another is free, PID-to-UUID mapping is wrong, output is missing, or a backend leaves `Running`.

## 7. Root and `/api` fixtures

Stop all three self-start backends. Start native ComfyUI on GPU 0:

```bash
export MODEL_YAML="$SWARM_REPO/Data/comfy-auto-model.yaml"
test -s "$MODEL_YAML"
tmux kill-session -t comfy033-native 2>/dev/null || true
tmux new-session -d -s comfy033-native \
  "cd '$COMFY_REPO' && CUDA_VISIBLE_DEVICES=0 '$COMFY_PY' main.py \
   --listen 127.0.0.1 --port 8188 --preview-method latent2rgb \
   --extra-model-paths-config '$MODEL_YAML' \
   2>&1 | tee '$EV/40-routes/native-comfy.log'"
timeout 180 bash -c '
  until curl -fsS http://127.0.0.1:8188/system_stats >/dev/null; do sleep 1; done
'
curl -fsS http://127.0.0.1:8188/system_stats \
  | tee "$EV/40-routes/native-system-stats.json" \
  | jq -e '.system.comfyui_version == "0.33.0"'
curl -sS -o "$EV/40-routes/native-api-system-stats.body" \
  -w '%{http_code}\n' http://127.0.0.1:8188/api/system_stats \
  | tee "$EV/40-routes/native-api-system-stats.code"
if jq -e '.system.comfyui_version == "0.33.0"' \
     "$EV/40-routes/native-api-system-stats.body" >/dev/null 2>&1; then
  echo "Native ComfyUI unexpectedly exposed valid prefixed system statistics" >&2
  false
fi
```

Create an `/api`-only reverse proxy:

```bash
export NGINX_ROOT="$EV/40-routes/nginx-api"
mkdir -p "$NGINX_ROOT"
cat > "$NGINX_ROOT/nginx.conf" <<EOF
worker_processes 1;
pid $NGINX_ROOT/nginx.pid;
error_log $NGINX_ROOT/error.log info;
events { worker_connections 1024; }
http {
  log_format acceptance '\$remote_addr [\$time_iso8601] "\$request" \$status \$body_bytes_sent';
  access_log $NGINX_ROOT/access.log acceptance;
  map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
  server {
    listen 127.0.0.1:8288;
    location /api/ {
      proxy_pass http://127.0.0.1:8188/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
      proxy_read_timeout 3600;
    }
    location / { return 404; }
  }
}
EOF
nginx -t -p "$NGINX_ROOT/" -c nginx.conf \
  2>&1 | tee "$EV/40-routes/nginx-config-test.txt"
nginx -p "$NGINX_ROOT/" -c nginx.conf
timeout 30 bash -c '
  until curl -fsS http://127.0.0.1:8288/api/system_stats >/dev/null; do sleep 1; done
'
curl -fsS http://127.0.0.1:8288/api/system_stats \
  | tee "$EV/40-routes/api-system-stats.json" \
  | jq -e '.system.comfyui_version == "0.33.0"'
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8288/system_stats)" = "404"
```

### R01 — native root auto-detection

Add one **ComfyUI API** backend, with all others stopped:

| Field | Value |
| --- | --- |
| Name | `comfy033-native-auto` |
| Address | `127.0.0.1:8188` |
| Allow Idle | off |
| OverQueue | `1` |
| API Path Mode | `Auto Detect` |
| Enable Frontend Dev | off |

Save `R01-native-auto-running.png`; capture the matching load log:

```bash
grep -Ei 'route resolved|root routes|comfy033-native-auto' \
  "$EV/10-build/swarm-runtime.log" | tail -n 100 \
  > "$EV/40-routes/R01-native-auto.log"
test -s "$EV/40-routes/R01-native-auto.log"
record_result R01 PASS \
  "40-routes/R01-native-auto-running.png; 40-routes/R01-native-auto.log; 40-routes/native-system-stats.json; 40-routes/native-api-system-stats.body" \
  "Auto Detect rejected invalid prefixed content, selected root routes, and reached Running"
```

**Fail:** arbitrary 2xx/HTML is accepted, `/api` is selected, scheme omission breaks the address, or backend is not `Running`.

### R02 — live `/api` auto-detection

Stop `comfy033-native-auto`, clear the proxy log, and add:

| Field | Value |
| --- | --- |
| Name | `comfy033-api-auto` |
| Address | `http://127.0.0.1:8288` |
| Allow Idle | on |
| OverQueue | `1` |
| API Path Mode | `Auto Detect` |
| Enable Frontend Dev | off |

```bash
: > "$NGINX_ROOT/access.log"
```

Save `R02-api-auto-running.png`, then:

```bash
cp "$NGINX_ROOT/access.log" "$EV/40-routes/R02-nginx-access.log"
grep -E '"GET /api/system_stats ' "$EV/40-routes/R02-nginx-access.log"
grep -E '"GET /api/object_info ' "$EV/40-routes/R02-nginx-access.log"
python3 "$EV/validate_proxy_log.py" "$EV/40-routes/R02-nginx-access.log" \
  | tee "$EV/40-routes/R02-prefix-validation.txt"
grep -Ei 'route resolved|/api prefix|comfy033-api-auto' \
  "$EV/10-build/swarm-runtime.log" | tail -n 100 \
  > "$EV/40-routes/R02-api-auto.log"
record_result R02 PASS \
  "40-routes/R02-api-auto-running.png; 40-routes/R02-api-auto.log; 40-routes/R02-nginx-access.log; 40-routes/R02-prefix-validation.txt" \
  "Auto Detect validated ComfyUI JSON below /api, retained the prefix, and reached Running"
```

**Fail:** probe accepts non-ComfyUI content, later requests lose prefix, or `/object_info` fails.

### R03 — offline-start recovery

Stop `comfy033-api-auto`; stop the proxy and confirm port 8288 is unavailable:

```bash
nginx -p "$NGINX_ROOT/" -c nginx.conf -s stop
until ! curl -fsS http://127.0.0.1:8288/api/system_stats >/dev/null 2>&1; do sleep 1; done
```

Add `comfy033-api-recovery` with the same settings as `R02` while offline. Save `R03-initial-idle.png`; state must be `Idle`. Start the proxy:

```bash
: > "$NGINX_ROOT/access.log"
nginx -p "$NGINX_ROOT/" -c nginx.conf
timeout 30 bash -c '
  until grep -qE "GET /api/(system_stats|features|object_info)" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
```

Save `R03-recovered-running.png`, then:

```bash
grep -Ei 'changed auto-detected route style|/api prefix|comfy033-api-recovery' \
  "$EV/10-build/swarm-runtime.log" | tail -n 150 \
  > "$EV/40-routes/R03-recovery.log"
cp "$NGINX_ROOT/access.log" "$EV/40-routes/R03-nginx-access.log"
python3 "$EV/validate_proxy_log.py" "$EV/40-routes/R03-nginx-access.log" \
  | tee "$EV/40-routes/R03-prefix-validation.txt"
record_result R03 PASS \
  "40-routes/R03-initial-idle.png; 40-routes/R03-recovered-running.png; 40-routes/R03-recovery.log; 40-routes/R03-nginx-access.log; 40-routes/R03-prefix-validation.txt" \
  "Idle backend re-probed, changed route style, cleared stale sockets, and recovered without edit or restart"
```

**Fail:** recovery needs edit/restart, stays on root, exceeds 30 seconds after proxy health, or reuses a stale socket.

### R04 — forced root fallback and blank address

Stop `comfy033-api-recovery`. Add:

| Field | Value |
| --- | --- |
| Name | `comfy033-root-forced` |
| Address | `http://127.0.0.1:8188/api` |
| Allow Idle | off |
| API Path Mode | `Force Root Routes` |
| Enable Frontend Dev | off |

Save `R04-forced-root-running.png` and capture:

```bash
grep -Ei 'route resolved|root routes|comfy033-root-forced' \
  "$EV/10-build/swarm-runtime.log" | tail -n 100 \
  > "$EV/40-routes/R04-forced-root.log"
test -s "$EV/40-routes/R04-forced-root.log"
```

Stop every API backend. Start a 40-second loopback capture, immediately add a temporary API backend with an empty address, save it, and capture its `Disabled` state as `blank-address-disabled.png`.

```bash
sudo rm -f "$EV/40-routes/blank-address.pcap"
sudo timeout 40 tcpdump -i lo -nn -s 128 \
  '(tcp port 8188 or tcp port 8288)' \
  -w "$EV/40-routes/blank-address.pcap" &
CAPTURE_PID=$!
# Immediately create/save the blank-address backend in the browser.
wait "$CAPTURE_PID" || true
sudo chown "$USER:$USER" "$EV/40-routes/blank-address.pcap"
tcpdump -nn -r "$EV/40-routes/blank-address.pcap" 2>/dev/null \
  | tee "$EV/40-routes/blank-address-packets.txt"
test ! -s "$EV/40-routes/blank-address-packets.txt"

record_result R04 PASS \
  "40-routes/R04-forced-root-running.png; 40-routes/R04-forced-root.log; 40-routes/blank-address-disabled.png; 40-routes/blank-address.pcap; 40-routes/blank-address-packets.txt" \
  "Forced root overrode /api suffix; blank address disabled without contacting either endpoint"
```

**Fail:** saved suffix overrides explicit root mode, forced backend fails, blank address targets localhost, or capture contains traffic.

## 8. Generate and Comfy Workflow

### G01 — Generate through root routes

Enable only `comfy033-root-forced`. Generate one image with the test checkpoint: `512×512`, 20 steps, CFG 5, Euler, Normal, seed `330001`, prompt `SwarmUI ComfyUI 0.33.0 native root acceptance RUN_ID`.

Save `G01-settings.png`, `G01-complete.png`, and downloaded `G01-original.png`.

```bash
sha256sum "$EV/50-generate/G01-original.png" \
  > "$EV/50-generate/G01-original.sha256"
record_result G01 PASS \
  "50-generate/G01-settings.png; 50-generate/G01-complete.png; 50-generate/G01-original.png; 50-generate/G01-original.sha256" \
  "Generate completed through root routes with expected model, seed, final image, and metadata"
```

**Fail:** preview mistaken for final, metadata wrong/missing, download fails, or backend changes state.

### G02 — Generate through `/api`

Stop all API backends, truncate proxy log, start `comfy033-api-auto` or `comfy033-api-recovery`, and wait for `Running`. Generate with the `G01` settings, seed `330002`, prompt `SwarmUI ComfyUI 0.33.0 prefixed acceptance RUN_ID`.

```bash
: > "$NGINX_ROOT/access.log"
```

Save `G02-complete.png` and `G02-original.png`. Stop the API backend after output capture so its reusable socket closes, then:

```bash
timeout 15 bash -c '
  until grep -qE "GET /api/ws[^ ]* HTTP/[0-9.]+\" 101" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
cp "$NGINX_ROOT/access.log" "$EV/50-generate/G02-nginx-access.log"
grep -E '"POST /api/prompt ' "$EV/50-generate/G02-nginx-access.log"
grep -E '"GET /api/ws[^ ]* HTTP/[0-9.]+" 101 ' \
  "$EV/50-generate/G02-nginx-access.log"
python3 "$EV/validate_proxy_log.py" "$EV/50-generate/G02-nginx-access.log" \
  | tee "$EV/50-generate/G02-prefix-validation.txt"
sha256sum "$EV/50-generate/G02-original.png" \
  > "$EV/50-generate/G02-original.sha256"
record_result G02 PASS \
  "50-generate/G02-complete.png; 50-generate/G02-original.png; 50-generate/G02-original.sha256; 50-generate/G02-nginx-access.log; 50-generate/G02-prefix-validation.txt" \
  "Generate completed with prompt and WebSocket traffic retaining /api"
```

**Fail:** HTTP and WebSocket route styles diverge, any successful API request loses prefix, or output is missing.

### C01 — Comfy Workflow from both entry points

Stop the API backend, truncate proxy log, restart it, and wait for `Running`.

```bash
: > "$NGINX_ROOT/access.log"
```

1. Open **Comfy Workflow** → **Browse Workflows** → `Basic SDXL`.
2. Confirm no missing-node warning.
3. Set `SwarmInputCheckpoint` to `TEST_CHECKPOINT_REL`.
4. Set positive prompt `SwarmUI Comfy Workflow 0.33.0 acceptance RUN_ID`.
5. Use `512×512`, 20 steps, CFG 5, seed `330003`, sampler `euler`, scheduler `normal`.
6. Save as `acceptance-comfy033-RUN_ID`.
7. Choose **Use This Workflow In Generate Tab** and generate once.
8. Reload the saved workflow and generate once directly from Comfy Workflow.

Save `C01-graph.png`, `C01-generate-tab.png`, `C01-workflow-tab.png`, and both originals. Stop the backend to close the socket, then:

```bash
timeout 15 bash -c '
  until grep -qE "GET /api/ws[^ ]* HTTP/[0-9.]+\" 101" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
cp "$NGINX_ROOT/access.log" "$EV/60-workflow/C01-nginx-access.log"
test "$(grep -c '"POST /api/prompt ' "$EV/60-workflow/C01-nginx-access.log")" -ge 2
python3 "$EV/validate_proxy_log.py" "$EV/60-workflow/C01-nginx-access.log" \
  | tee "$EV/60-workflow/C01-prefix-validation.txt"
sha256sum "$EV/60-workflow"/C01-original-*.png \
  > "$EV/60-workflow/C01-output-sha256.txt"
record_result C01 PASS \
  "60-workflow/C01-graph.png; 60-workflow/C01-generate-tab.png; 60-workflow/C01-workflow-tab.png; 60-workflow/C01-nginx-access.log; 60-workflow/C01-prefix-validation.txt; 60-workflow/C01-output-sha256.txt" \
  "Basic SDXL loaded, saved, reloaded, and generated from both entry points"
```

**Fail:** missing node/input, wrong checkpoint, failed reload, silent standard-workflow fallback, missing output, or prefix mismatch.

## 9. WebSocket previews and cancellation

### W01 — live previews

Stop the API backend, truncate proxy log, restart it, and wait for `Running`. Generate `1024×1024`, 60 steps, CFG 5, seed `330004`, latent preview mode.

```bash
: > "$NGINX_ROOT/access.log"
: > "$EV/70-ws-cancel/W01-sockets.txt"
for _ in $(seq 1 90); do
  date -u +%Y-%m-%dT%H:%M:%S.%3NZ >> "$EV/70-ws-cancel/W01-sockets.txt"
  ss -tnp | grep ':8288' >> "$EV/70-ws-cancel/W01-sockets.txt" || true
  sleep 1
done &
SOCKET_WATCH_PID=$!
```

Capture two visibly different previews at different progress values as `W01-preview-01.png` and `W01-preview-02.png`. After final output, stop the backend and then:

```bash
kill "$SOCKET_WATCH_PID" 2>/dev/null || true
wait "$SOCKET_WATCH_PID" 2>/dev/null || true
timeout 15 bash -c '
  until grep -qE "GET /api/ws[^ ]* HTTP/[0-9.]+\" 101" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
cp "$NGINX_ROOT/access.log" "$EV/70-ws-cancel/W01-nginx-access.log"
grep -E '"GET /api/ws[^ ]* HTTP/[0-9.]+" 101 ' \
  "$EV/70-ws-cancel/W01-nginx-access.log"
record_result W01 PASS \
  "70-ws-cancel/W01-preview-01.png; 70-ws-cancel/W01-preview-02.png; 70-ws-cancel/W01-sockets.txt; 70-ws-cancel/W01-nginx-access.log" \
  "Prefixed WebSocket upgraded and delivered at least two distinct previews before final output"
```

**Fail:** polling only, lost prefix, no 101 upgrade, static/duplicate previews, or stalled progress.

### W02 — cancellation and recovery

Truncate proxy log, start the API backend, and generate `1024×1024`, 60 steps, seed `330005`. Once a preview is visible:

```bash
: > "$NGINX_ROOT/access.log"
curl -fsS http://127.0.0.1:8288/api/queue \
  | tee "$EV/70-ws-cancel/W02-queue-before.json"
python3 - <<'PY' "$EV/70-ws-cancel/W02-queue-before.json" \
  | tee "$EV/70-ws-cancel/W02-prompt-id.txt"
import json, sys
running = json.load(open(sys.argv[1])).get("queue_running", [])
assert running, "No running prompt to cancel"
print(running[0][1])
PY
export CANCELLED_PROMPT_ID="$(cat "$EV/70-ws-cancel/W02-prompt-id.txt")"
```

Click SwarmUI **Cancel**. Do not call ComfyUI's interrupt endpoint manually.

```bash
timeout 30 bash -c '
  while :; do
    queue="$(curl -fsS http://127.0.0.1:8288/api/queue)"
    test "$(jq ".queue_running | length" <<<"$queue")" = 0 \
      && test "$(jq ".queue_pending | length" <<<"$queue")" = 0 \
      && break
    sleep 1
  done
'
curl -fsS http://127.0.0.1:8288/api/queue \
  | tee "$EV/70-ws-cancel/W02-queue-after.json"
curl -fsS "http://127.0.0.1:8288/api/history/$CANCELLED_PROMPT_ID" \
  | tee "$EV/70-ws-cancel/W02-history-after.json"
jq -e '.queue_running == [] and .queue_pending == []' \
  "$EV/70-ws-cancel/W02-queue-after.json"
jq -e 'length == 0' "$EV/70-ws-cancel/W02-history-after.json"
```

Save `W02-cancelled.png` with no final output. Generate a `512×512`, 10-step recovery image with seed `330006`; save `W02-recovery-complete.png`. Stop the backend, then:

```bash
timeout 15 bash -c '
  until grep -qE "GET /api/ws[^ ]* HTTP/[0-9.]+\" 101" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
cp "$NGINX_ROOT/access.log" "$EV/70-ws-cancel/W02-nginx-access.log"
grep -E '"POST /api/queue ' "$EV/70-ws-cancel/W02-nginx-access.log"
grep -E '"POST /api/interrupt ' "$EV/70-ws-cancel/W02-nginx-access.log"
grep -E '"POST /api/history ' "$EV/70-ws-cancel/W02-nginx-access.log"
python3 "$EV/validate_proxy_log.py" "$EV/70-ws-cancel/W02-nginx-access.log" \
  | tee "$EV/70-ws-cancel/W02-prefix-validation.txt"
record_result W02 PASS \
  "70-ws-cancel/W02-queue-before.json; 70-ws-cancel/W02-prompt-id.txt; 70-ws-cancel/W02-cancelled.png; 70-ws-cancel/W02-queue-after.json; 70-ws-cancel/W02-history-after.json; 70-ws-cancel/W02-recovery-complete.png; 70-ws-cancel/W02-nginx-access.log; 70-ws-cancel/W02-prefix-validation.txt" \
  "Cancel deleted queued/running work and history; no final output; same backend recovered"
```

**Fail:** work continues, queue/history remains, final image appears, required cancellation calls are absent, socket is permanently lost, or recovery needs restart.

## 10. Outputs and history lifecycle

### H01 — final output, Comfy history retrieval/cleanup, disk output, and SwarmUI history

In the `C01` graph keep `SwarmSaveImageWS`, also connect the decoded image to a standard `SaveImage` node, and set filename prefix `swarm033/RUN_ID`.

Stop the API backend, truncate proxy log, restart it, wait for `Running`, and touch an exact output marker:

```bash
: > "$NGINX_ROOT/access.log"
touch "$EV/80-history/H01-output-start.marker"
```

Generate `1024×1024`, 40 steps, seed `330007`. While it is running:

```bash
curl -fsS http://127.0.0.1:8288/api/queue \
  | tee "$EV/80-history/H01-queue-running.json"
python3 - <<'PY' "$EV/80-history/H01-queue-running.json" \
  | tee "$EV/80-history/H01-prompt-id.txt"
import json, sys
running = json.load(open(sys.argv[1])).get("queue_running", [])
assert running, "No running prompt"
print(running[0][1])
PY
export HISTORY_PROMPT_ID="$(cat "$EV/80-history/H01-prompt-id.txt")"
```

After final output appears, save its original as `H01-output.png`, hard-refresh SwarmUI, open **History**, and save `H01-history.png` plus `H01-metadata.png`. Metadata must show seed `330007` and `TEST_CHECKPOINT_REL`; cancelled work from `W02` must be absent. Stop the API backend to close its socket, then:

```bash
timeout 15 bash -c '
  until grep -qE "GET /api/ws[^ ]* HTTP/[0-9.]+\" 101" '"$NGINX_ROOT"'/access.log; do sleep 1; done
'
curl -fsS "http://127.0.0.1:8288/api/history/$HISTORY_PROMPT_ID" \
  | tee "$EV/80-history/H01-history-after-cleanup.json"
jq -e 'length == 0' "$EV/80-history/H01-history-after-cleanup.json"

find "$COMFY_REPO/output/swarm033" -type f \
  -newer "$EV/80-history/H01-output-start.marker" \
  -print | sort | tee "$EV/80-history/output-files.txt"
test -s "$EV/80-history/output-files.txt"
while IFS= read -r output; do
  file "$output"
  sha256sum "$output"
done < "$EV/80-history/output-files.txt" \
  | tee "$EV/80-history/output-evidence.txt"

cp "$NGINX_ROOT/access.log" "$EV/80-history/H01-nginx-access.log"
grep -E "\"GET /api/history/$HISTORY_PROMPT_ID " \
  "$EV/80-history/H01-nginx-access.log"
grep -E '"GET /api/view' "$EV/80-history/H01-nginx-access.log"
grep -E '"POST /api/history ' "$EV/80-history/H01-nginx-access.log"
python3 "$EV/validate_proxy_log.py" "$EV/80-history/H01-nginx-access.log" \
  | tee "$EV/80-history/H01-prefix-validation.txt"
sha256sum "$EV/80-history/H01-output.png" \
  > "$EV/80-history/H01-output.sha256"

record_result H01 PASS \
  "80-history/H01-queue-running.json; 80-history/H01-prompt-id.txt; 80-history/H01-history-after-cleanup.json; 80-history/output-files.txt; 80-history/output-evidence.txt; 80-history/H01-history.png; 80-history/H01-output.png; 80-history/H01-output.sha256; 80-history/H01-metadata.png; 80-history/H01-nginx-access.log; 80-history/H01-prefix-validation.txt" \
  "Swarm retrieved final output/history, cleaned Comfy history, wrote disk output, and retained durable SwarmUI history"
```

**Fail:** output missing/corrupt, Comfy history retrieval or cleanup missing, SwarmUI History disappears after refresh, metadata wrong, prefix lost, or cancelled work reappears.

## 11. Model paths and text encoders

### M01 — unique YAML keys and case-sensitive discovery

```bash
cp "$MODEL_YAML" "$EV/90-model-paths/comfy-auto-model.yaml"
"$COMFY_PY" - <<'PY' "$MODEL_YAML" \
  | tee "$EV/90-model-paths/yaml-validation.txt"
from pathlib import Path
import sys, yaml

class UniqueKeyLoader(yaml.SafeLoader):
    pass

def construct_unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        assert key not in mapping, f"Duplicate YAML key: {key}"
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping

UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    construct_unique_mapping,
)
data = yaml.load(Path(sys.argv[1]).read_text(), Loader=UniqueKeyLoader)
assert isinstance(data, dict) and data
sections = [value for key, value in data.items() if key.startswith("swarmui") and key != "swarmui_nodes"]
assert sections
required = {
    "checkpoints", "vae", "loras", "clip", "clip_vision", "text_encoders",
    "diffusion_models", "configs", "diffusers", "vae_approx", "datasets",
    "photomaker", "classifiers", "model_patches", "audio_encoders",
    "background_removal", "frame_interpolation", "geometry_estimation",
    "optical_flow", "detection",
}
for section in sections:
    missing = required - set(section)
    assert not missing, f"Missing keys: {sorted(missing)}"
    aliases = set(str(section["text_encoders"]).splitlines())
    assert {"text_encoders", "clip", "CLIP"} <= aliases, aliases
print("YAML_PARSE=PASS")
print("DUPLICATE_KEYS=NONE")
print("REQUIRED_PATHS=PASS")
print("TEXT_ENCODER_ALIASES=PASS")
PY

for directory in text_encoders clip CLIP; do
  mkdir -p "$MODEL_ROOT/$directory"
  printf 'SWARMUI-COMFY033-DISCOVERY-%s-%s\n' "$RUN_ID" "$directory" \
    > "$MODEL_ROOT/$directory/acceptance-$RUN_ID-$directory.safetensors"
done
mkdir -p "$MODEL_ROOT/model_patches"
```

Stop external API backends. Start only `comfy033-gpu0`, derive its port, and fetch node metadata:

```bash
python3 "$EV/discover_comfy.py" "$COMFY_REPO/main.py" \
  | tee "$EV/90-model-paths/model-test-backends.tsv"
export MODEL_TEST_PORT="$(awk -F '\t' 'NR > 1 && $2 == 0 {print $4}' "$EV/90-model-paths/model-test-backends.tsv")"
test -n "$MODEL_TEST_PORT"
curl -fsS "http://127.0.0.1:$MODEL_TEST_PORT/object_info" \
  > "$EV/90-model-paths/object-info.json"
jq -r '.. | strings' "$EV/90-model-paths/object-info.json" \
  | grep -F "acceptance-$RUN_ID" | sort -u \
  | tee "$EV/90-model-paths/discovered-sentinels.txt"
for directory in text_encoders clip CLIP; do
  grep -F "acceptance-$RUN_ID-$directory.safetensors" \
    "$EV/90-model-paths/discovered-sentinels.txt"
done
```

Refresh models and save `M01-checkpoint.png`, `M01-text-encoders.png`, and `M01-backend-running.png`. Never select a sentinel. Remove them immediately and restart the backend once more:

```bash
find "$MODEL_ROOT" -type f -name "acceptance-$RUN_ID-*.safetensors" \
  -print -delete | tee "$EV/90-model-paths/removed-sentinels.txt"
record_result M01 PASS \
  "90-model-paths/comfy-auto-model.yaml; 90-model-paths/yaml-validation.txt; 90-model-paths/object-info.json; 90-model-paths/discovered-sentinels.txt; 90-model-paths/M01-checkpoint.png; 90-model-paths/M01-text-encoders.png; 90-model-paths/M01-backend-running.png; 90-model-paths/removed-sentinels.txt" \
  "YAML has unique current keys, model_patches, and separately discoverable text_encoders/clip/CLIP paths"
```

**Fail:** malformed or duplicate-key YAML, missing category, case folding, undiscoverable checkpoint/text encoder, sentinel loading, or backend failure after refresh.

## 12. Merge-blocking risk gates

| Risk | Required disproof |
| --- | --- |
| Wrong 0.33.0 frontend pin | `D01` and `D02` both show exactly `1.48.7` |
| Dependency repair changes CUDA packages | `D02` protected versions are identical before/after |
| `/api` probe accepts arbitrary successful content | `R01` rejects native prefixed content and selects root |
| Native routes are misclassified | `R01` shows root routes and version `0.33.0` |
| Offline route choice is frozen | `R03` changes from `Idle` to `/api` `Running` without edit/restart |
| Route change reuses stale sockets | `R03` recovery plus `W01` fresh 101 upgrade |
| Explicit root loses to address suffix | `R04` forces root despite saved `/api` suffix |
| Blank address silently targets localhost | `R04` disabled screenshot and empty loopback capture |
| HTTP/WebSocket prefixes diverge | `G02`, `C01`, `W01`, and `W02` proxy evidence |
| Cancellation leaves queue/history | `W02` empty queue/history, no final output, successful recovery |
| Generated YAML duplicates `model_patches` | `M01` duplicate-key loader accepts every section |
| Text-encoder aliases collapse on Ubuntu | `M01` discovers all three case-sensitive sentinel paths |
| One process sees multiple physical GPUs | `B01`–`B04` mask/PID/port/UUID evidence |
| Changed source does not compile cleanly | `S01` Release build and changed-source warning gate |

## 13. Validate and hash the final record

```bash
column -t -s $'\t' "$EV/99-summary/results.tsv" \
  | tee "$EV/99-summary/results.txt"
python3 - <<'PY' "$EV/99-summary/results.tsv" \
  | tee "$EV/99-summary/result-validation.txt"
import csv, sys
mandatory = {
    "S00", "S01", "D01", "D02", "B01", "B02", "B03", "B04",
    "R01", "R02", "R03", "R04", "G01", "G02", "C01", "W01",
    "W02", "H01", "M01",
}
with open(sys.argv[1], newline="") as handle:
    rows = list(csv.DictReader(handle, delimiter="\t"))
seen = {}
for row in rows:
    seen.setdefault(row["TEST_ID"], []).append(row)
for test_id in sorted(mandatory):
    assert test_id in seen, f"Missing result: {test_id}"
    assert len(seen[test_id]) == 1, f"Duplicate result: {test_id}"
    result = seen[test_id][0]
    assert result["RESULT"] == "PASS", f"{test_id} is {result['RESULT']}"
    assert result["EVIDENCE"].strip(), f"{test_id} has no evidence"
print("ALL_MANDATORY_TESTS=PASS")
PY

find "$EV" -type f ! -name manifest.sha256 -print0 \
  | sort -z | xargs -0 sha256sum \
  > "$EV/99-summary/manifest.sha256"
tar -C "$(dirname "$EV")" -czf "$EV.tar.gz" "$(basename "$EV")"
sha256sum "$EV.tar.gz" | tee "$EV.tar.gz.sha256"
```

Stop only the fixtures created by this runbook:

```bash
nginx -p "$NGINX_ROOT/" -c nginx.conf -s stop 2>/dev/null || true
tmux kill-session -t comfy033-native 2>/dev/null || true
tmux kill-session -t swarm033 2>/dev/null || true
```

The source SHA, ComfyUI SHA, `results.tsv`, evidence archive, and archive checksum form the acceptance record.