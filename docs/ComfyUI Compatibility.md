# Ubuntu acceptance runbook: ComfyUI 0.33.0

This is the executable acceptance procedure for SwarmUI against **ComfyUI 0.33.0** on Ubuntu with three NVIDIA GPUs. It replaces the former unexecuted checklist. It does not assert that a test passed unless the required evidence files exist.

ComfyUI 0.33.0 serves its native HTTP and WebSocket API at root paths such as `/system_stats`, `/object_info`, `/prompt`, `/queue`, `/interrupt`, `/history`, `/view`, and `/ws`. The `/api` prefix is a compatibility shape used by a frontend development server or reverse proxy. The exact frontend package required by the 0.33.0 release is `comfyui-frontend-package==1.48.7`.

## Acceptance rule

The build is accepted only when every mandatory test ID is recorded as `PASS` in `99-summary/results.tsv` and each result names the evidence that proves it. A missing file, an unexplained warning, an unclassified route, or an unexecuted test is not a pass.

Use these result values only:

- `PASS`: the stated pass conditions were observed and the evidence was saved.
- `FAIL`: at least one fail condition was observed.
- `BLOCKED`: an external prerequisite such as a checkpoint, driver, or unavailable port prevented execution. `BLOCKED` does not qualify the build for release.

Do not put credentials, cookies, access tokens, private prompts, or private model metadata in the evidence bundle.

## Test IDs

| ID | Mandatory | Scope |
| --- | --- | --- |
| `S00` | Yes | Host, source revisions, and clean-worktree identity |
| `S01` | Yes | Static diff, documentation removal, and Release build |
| `D01` | Yes | Exact ComfyUI tag and dependency baseline |
| `D02` | Yes | Self-start dependency repair in the selected Python environment |
| `B01` | Yes | Self-start on GPU 0 |
| `B02` | Yes | Self-start on GPU 1 |
| `B03` | Yes | Self-start on GPU 2 |
| `B04` | Yes | Three concurrent jobs, one backend per GPU |
| `R01` | Yes | Native root-route auto-detection |
| `R02` | Yes | Live `/api` auto-detection through a reverse proxy |
| `R03` | Yes | Offline-start `/api` recovery while `Allow Idle` is enabled |
| `R04` | Yes | Forced root-route compatibility fallback |
| `G01` | Yes | Generate-tab generation through native root routes |
| `G02` | Yes | Generate-tab generation through `/api` routes |
| `C01` | Yes | Comfy Workflow generation |
| `W01` | Yes | WebSocket connection and multiple live previews |
| `W02` | Yes | Cancellation, queue cleanup, history cleanup, and recovery |
| `H01` | Yes | Final outputs, files, metadata, and history |
| `M01` | Yes | Generated model paths, text-encoder aliases, and discovery |

## 1. Prepare the host and evidence bundle

Run from an interactive Bash shell on the Ubuntu test host.

```bash
set -Eeuo pipefail

sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl git jq lsb-release nginx python3 python3-pip \
  python3-venv tmux unzip

export SWARM_REPO="$HOME/src/SwarmUI"
export COMFY_REPO="$HOME/src/ComfyUI-0.33.0"
export SWARM_URL="https://github.com/mcmonkeyprojects/SwarmUI.git"
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

script -q -f "$EV/terminal.typescript"
```

The last command starts a recorded subshell. Run the remaining commands inside it. Exit that subshell only after the tests are complete.

### S00 — host and source identity

Use the pull-request head or the exact merged commit under test. Do not test an uncommitted working tree.

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

GPU_COUNT="$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)"
test "$GPU_COUNT" -ge 3

test ! -s "$EV/00-host/swarm-status.txt"
record_result S00 PASS "00-host/host.txt; 00-host/swarm-head.txt; 00-host/swarm-status.txt" \
  "Clean committed source; at least GPUs 0, 1, and 2 are visible"
```

**Pass:** the worktree is clean, the exact commit is recorded, and `nvidia-smi` exposes indices `0`, `1`, and `2` with stable UUIDs.

**Fail:** any uncommitted source, fewer than three GPUs, a driver error, duplicate GPU indices, or an unidentified commit.

## 2. Static and build gates

### S01 — diff, removed policy files, and Release build

Set the comparison base to the target branch used for the change.

```bash
cd "$SWARM_REPO"
export BASE_REF="origin/master"
git fetch origin master

git diff --check "$BASE_REF"...HEAD \
  2>&1 | tee "$EV/10-build/diff-check.txt"

test ! -e AGENTS.md
test ! -e .agents

# These locations must contain no instruction or contribution text about coding agents.
if git grep -nEi '(^|[^[:alnum:]])agent(s|ic)?([^[:alnum:]]|$)|LLM-Written Code' \
     -- CONTRIBUTING.md docs '*.md' > "$EV/10-build/disallowed-doc-text.txt"; then
  cat "$EV/10-build/disallowed-doc-text.txt"
  echo "Disallowed documentation text remains" >&2
  false
fi

{
  dotnet --info
  dotnet restore src/SwarmUI.csproj
  dotnet build src/SwarmUI.csproj -c Release --no-restore
} 2>&1 | tee "$EV/10-build/release-build.txt"

! grep -Ei '(^|[[:space:]])error[[:space:]]+[A-Z]{2,}[0-9]+:' \
  "$EV/10-build/release-build.txt"

# Any warning emitted from a changed C# file must be investigated and recorded as FAIL.
CHANGED_CS="$EV/10-build/changed-cs.txt"
git diff --name-only "$BASE_REF"...HEAD -- '*.cs' | tee "$CHANGED_CS"
while IFS= read -r file; do
  test -z "$file" && continue
  if grep -F "$file" "$EV/10-build/release-build.txt" | grep -i warning; then
    echo "Build warning in changed file: $file" >&2
    false
  fi
done < "$CHANGED_CS"

record_result S01 PASS \
  "10-build/diff-check.txt; 10-build/disallowed-doc-text.txt; 10-build/release-build.txt" \
  "No whitespace errors, removed policy files are absent, and Release build has no changed-file warning"
```

**Pass:** `git diff --check` is empty, the removed files do not exist, the documentation scan is empty, and the Release build exits zero without an error or warning attributed to a changed C# file.

**Fail:** a compiler error, a warning in changed code, stale policy documentation, or a dirty/generated source change.

## 3. Install the exact ComfyUI release

### D01 — exact tag and baseline dependencies

Use a dedicated checkout whose `venv` directory is directly beside `main.py`; SwarmUI detects and uses that interpreter on Ubuntu.

```bash
if test -e "$COMFY_REPO"; then
  echo "$COMFY_REPO already exists; verify it rather than overwriting it"
else
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
"$COMFY_PY" -m pip install --upgrade pip
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

root = Path.cwd()
namespace = {}
exec((root / "comfyui_version.py").read_text(), namespace)
assert namespace["__version__"] == "0.33.0", namespace["__version__"]

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
imports = [
    "torch", "torchvision", "torchaudio", "torch_sde", "numpy", "einops",
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
    print(f"MINIMUM {package}={got} >= {floor}")

assert Version(version("pydantic")).major == 2, version("pydantic")
assert Version(version("pydantic-settings")).major == 2, version("pydantic-settings")

for module in imports:
    import_module(module)
    print(f"IMPORT {module}=OK")

assert sys.executable.endswith("/venv/bin/python3"), sys.executable
print("COMFYUI_VERSION=0.33.0")
print(f"PYTHON={sys.executable}")
PY

record_result D01 PASS \
  "20-deps/comfy-head.txt; 20-deps/baseline-verification.txt; 20-deps/pip-check-before.txt; 20-deps/pip-freeze-before.txt" \
  "Official v0.33.0 checkout, frontend 1.48.7, imports valid, and pip check clean"
```

**Pass:** the exact Git tag is `v0.33.0`, the frontend is exactly `1.48.7`, all imports work, the release floors are satisfied, and `pip check` reports no broken requirements.

**Fail:** a moving branch, a different frontend, CPU-only Torch on this NVIDIA test, a missing import, or any dependency conflict.

Record the accelerator build separately:

```bash
"$COMFY_PY" - <<'PY' | tee "$EV/20-deps/torch.txt"
import torch
print("torch", torch.__version__)
print("cuda_available", torch.cuda.is_available())
print("cuda_runtime", torch.version.cuda)
print("gpu_count_visible_without_mask", torch.cuda.device_count())
assert torch.cuda.is_available()
PY
```

Do not let dependency repair replace `torch`, `torchvision`, `torchaudio`, or `torchsde`. A change to those packages is a fail unless the test operator deliberately installed a known-good CUDA build before starting the run.

## 4. Configure the model fixture

Use one legitimate SDXL checkpoint already available to the tester. Do not download a model silently as part of acceptance.

```bash
export TEST_CHECKPOINT_ABS="/absolute/path/to/test-sdxl-checkpoint.safetensors"
test -s "$TEST_CHECKPOINT_ABS"
file "$TEST_CHECKPOINT_ABS" | tee "$EV/00-host/checkpoint-file.txt"
sha256sum "$TEST_CHECKPOINT_ABS" | tee "$EV/00-host/checkpoint-sha256.txt"
```

In SwarmUI, configure the model root under **Server → Server Configuration → Paths**. Copy or symlink the checkpoint into that root's `Stable-Diffusion` directory, refresh models, and record its exact SwarmUI-relative name:

```bash
export MODEL_ROOT="/absolute/path/to/the/configured/swarm-model-root"
export TEST_CHECKPOINT_REL="relative/name/displayed/by/SwarmUI.safetensors"
test -d "$MODEL_ROOT"
test -e "$MODEL_ROOT/Stable-Diffusion/$TEST_CHECKPOINT_REL"
```

## 5. Start SwarmUI and capture its logs

```bash
cd "$SWARM_REPO"
tmux kill-session -t swarm033 2>/dev/null || true
tmux new-session -d -s swarm033 \
  "cd '$SWARM_REPO' && ./launch-linux.sh 2>&1 | tee '$EV/10-build/swarm-runtime.log'"

timeout 180 bash -c '
  until curl -fsS http://127.0.0.1:7801/ >/dev/null; do sleep 1; done
'
curl -fsS -o "$EV/10-build/swarm-index.html" http://127.0.0.1:7801/
```

Keep `$EV/10-build/swarm-runtime.log` running for the whole procedure. Take browser screenshots at native resolution; do not crop away backend status, request ID, progress, or output metadata.

## 6. Self-start and dependency repair

### Configure the first backend

In **Server → Backends**, add one **ComfyUI Self-Starting** backend with these exact values:

| Field | Value |
| --- | --- |
| Name | `comfy033-gpu0` |
| Start Script | absolute path to `$COMFY_REPO/main.py` |
| Extra Args | empty |
| Disable Internal Args | off |
| Auto Update | `Don't Update` |
| Update Managed Nodes | `Don't Update` |
| Frontend Version | `Latest Swarm Validated` |
| Enable Previews | `Enabled (fast latent2rgb)` |
| GPU ID | `0` |
| OverQueue | `1` |
| Auto Restart | off |

Do not configure GPUs 1 and 2 until `D02` is complete. This prevents simultaneous `pip` mutation of the shared `venv`.

### D02 — controlled dependency-repair test

Stop the GPU 0 backend after its first clean start. Remove only `einops`, prove the import is absent, then start the backend again through SwarmUI.

```bash
"$COMFY_PY" -m pip uninstall -y einops \
  2>&1 | tee "$EV/20-deps/remove-einops.txt"
if "$COMFY_PY" -c 'import einops' 2> "$EV/20-deps/einops-missing.txt"; then
  echo "einops was not removed" >&2
  false
fi
```

Start `comfy033-gpu0` in the UI and wait for `Running`. Then run:

```bash
"$COMFY_PY" -c 'import einops; print(einops.__version__)' \
  | tee "$EV/20-deps/einops-after-self-start.txt"
"$COMFY_PY" -m pip check | tee "$EV/20-deps/pip-check-after.txt"
"$COMFY_PY" -m pip freeze | sort > "$EV/20-deps/pip-freeze-after.txt"

python3 - <<'PY' \
  "$EV/20-deps/pip-freeze-before.txt" \
  "$EV/20-deps/pip-freeze-after.txt" \
  | tee "$EV/20-deps/package-delta.txt"
from pathlib import Path
import sys
before = set(Path(sys.argv[1]).read_text().splitlines())
after = set(Path(sys.argv[2]).read_text().splitlines())
print("REMOVED")
print("\n".join(sorted(before - after)))
print("ADDED_OR_CHANGED")
print("\n".join(sorted(after - before)))
PY

grep -Ei "Installing 'einops'|Done Installing 'einops'|validate required libs" \
  "$EV/10-build/swarm-runtime.log" \
  | tee "$EV/20-deps/swarm-repair-log.txt"

"$COMFY_PY" - <<'PY' | tee "$EV/20-deps/frontend-after-repair.txt"
from importlib.metadata import version
assert version("comfyui-frontend-package") == "1.48.7"
print(version("comfyui-frontend-package"))
PY

record_result D02 PASS \
  "20-deps/remove-einops.txt; 20-deps/swarm-repair-log.txt; 20-deps/einops-after-self-start.txt; 20-deps/pip-check-after.txt; 20-deps/package-delta.txt; 20-deps/frontend-after-repair.txt" \
  "Self-start repaired the missing non-Torch package without changing the CUDA stack or frontend pin"
```

**Pass:** SwarmUI uses `$COMFY_REPO/venv/bin/python3`, installs the missing package, retains frontend `1.48.7`, leaves the CUDA Torch stack unchanged, reaches `Running`, and leaves `pip check` clean.

**Fail:** SwarmUI uses system Python, alters the Torch stack, installs frontend `1.49.6` or an unpinned latest frontend, creates a dependency conflict, or remains `Loading`/`Errored`.

## 7. One self-start backend per GPU

Add two more **ComfyUI Self-Starting** backends by copying the GPU 0 settings and changing only these values:

| Test | Name | GPU ID |
| --- | --- | --- |
| `B01` | `comfy033-gpu0` | `0` |
| `B02` | `comfy033-gpu1` | `1` |
| `B03` | `comfy033-gpu2` | `2` |

Start all three. SwarmUI normally assigns ports beginning at `7821`, but another local process may move them. Derive the ports from the process arguments and logs; do not assume them.

```bash
pgrep -af "$COMFY_REPO/main.py" \
  | tee "$EV/30-self-start/processes.txt"
ss -ltnp \
  | tee "$EV/30-self-start/listeners.txt"

: > "$EV/30-self-start/process-environments.txt"
while read -r pid; do
  {
    echo "===== PID $pid ====="
    tr '\0' '\n' < "/proc/$pid/environ" \
      | grep -E '^(CUDA_VISIBLE_DEVICES|ROCR_VISIBLE_DEVICES|PATH)='
    tr '\0' ' ' < "/proc/$pid/cmdline"
    echo
    readlink -f "/proc/$pid/exe"
  } >> "$EV/30-self-start/process-environments.txt"
done < <(pgrep -f "$COMFY_REPO/main.py")

nvidia-smi \
  --query-gpu=index,uuid,name,memory.used,utilization.gpu \
  --format=csv \
  | tee "$EV/30-self-start/gpus-after-start.txt"
nvidia-smi \
  --query-compute-apps=pid,gpu_uuid,used_memory \
  --format=csv \
  | tee "$EV/30-self-start/compute-processes.txt"
```

Create `ports.txt` from the three `--port` arguments, one line per backend, in this form:

```text
comfy033-gpu0 7821
comfy033-gpu1 7822
comfy033-gpu2 7823
```

Validate every discovered port:

```bash
: > "$EV/30-self-start/system-stats.jsonl"
while read -r name port; do
  curl -fsS "http://127.0.0.1:$port/system_stats" \
    | jq -c --arg backend "$name" \
      '{backend:$backend,version:.system.comfyui_version,devices:.devices}' \
    | tee -a "$EV/30-self-start/system-stats.jsonl"
done < "$EV/30-self-start/ports.txt"

jq -e 'select(.version != "0.33.0")' "$EV/30-self-start/system-stats.jsonl" \
  >/dev/null && { echo "Wrong ComfyUI version" >&2; false; } || true
```

For each backend, save a screenshot showing its `Running` state as:

```text
30-self-start/B01-gpu0-running.png
30-self-start/B02-gpu1-running.png
30-self-start/B03-gpu2-running.png
```

Record the results only after matching each process ID to one GPU UUID:

```bash
record_result B01 PASS \
  "30-self-start/B01-gpu0-running.png; 30-self-start/process-environments.txt; 30-self-start/compute-processes.txt; 30-self-start/system-stats.jsonl" \
  "GPU 0 backend has a unique PID and port and reports ComfyUI 0.33.0"
record_result B02 PASS \
  "30-self-start/B02-gpu1-running.png; 30-self-start/process-environments.txt; 30-self-start/compute-processes.txt; 30-self-start/system-stats.jsonl" \
  "GPU 1 backend has a unique PID and port and reports ComfyUI 0.33.0"
record_result B03 PASS \
  "30-self-start/B03-gpu2-running.png; 30-self-start/process-environments.txt; 30-self-start/compute-processes.txt; 30-self-start/system-stats.jsonl" \
  "GPU 2 backend has a unique PID and port and reports ComfyUI 0.33.0"
```

**Pass:** exactly three ComfyUI processes use unique ports; their masks are exactly `0`, `1`, and `2`; each compute PID maps to the corresponding physical GPU UUID; each backend is `Running`; each `/system_stats` reports `0.33.0`.

**Fail:** a mask such as `0,1,2`, two backends on one physical GPU, one process attached to multiple GPUs, duplicate ports, wrong ComfyUI version, or a backend that is not `Running`.

### B04 — concurrent fan-out

On the **Generate** tab select the test checkpoint and use:

| Setting | Value |
| --- | --- |
| Prompt | `SwarmUI ComfyUI 0.33.0 three GPU acceptance RUN_ID` |
| Width × height | `512 × 512` |
| Steps | `20` |
| CFG scale | `5` |
| Sampler | `Euler` |
| Scheduler | `Normal` |
| Seed | `330000` |
| Batch size | `1` |
| Images | `3` |

Start GPU telemetry immediately before clicking **Generate**:

```bash
timeout 90 nvidia-smi dmon -s pucvmet -d 1 \
  > "$EV/30-self-start/B04-nvidia-dmon.txt" &
DMON_PID=$!

: > "$EV/30-self-start/B04-queues.jsonl"
for _ in $(seq 1 90); do
  stamp="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  while read -r name port; do
    curl -fsS "http://127.0.0.1:$port/queue" \
      | jq -c --arg time "$stamp" --arg backend "$name" \
        '{time:$time,backend:$backend,queue_running,queue_pending}' \
      >> "$EV/30-self-start/B04-queues.jsonl" || true
  done < "$EV/30-self-start/ports.txt"
  sleep 1
done &
QUEUE_PID=$!
```

After all three images complete:

```bash
wait "$DMON_PID" || true
wait "$QUEUE_PID" || true

grep -Ei 'comfy033-gpu[012]|ComfyUI-[0-9]+|backend-[0-9]+' \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 500 > "$EV/30-self-start/B04-backend-log.txt"
```

Save:

- `30-self-start/B04-three-results.png`: all three completed output cards.
- `30-self-start/B04-backends.png`: all three backend cards still `Running`.
- `30-self-start/B04-output-sha256.txt`: hashes of the three downloaded originals.

```bash
sha256sum /path/to/the/three/downloaded/originals/* \
  > "$EV/30-self-start/B04-output-sha256.txt"
record_result B04 PASS \
  "30-self-start/B04-three-results.png; 30-self-start/B04-nvidia-dmon.txt; 30-self-start/B04-queues.jsonl; 30-self-start/B04-backend-log.txt; 30-self-start/B04-output-sha256.txt" \
  "Three completed jobs were distributed one per GPU without backend failure"
```

**Pass:** three outputs finish, every GPU has non-zero compute utilisation during the run, each backend receives work, and all three remain `Running`.

**Fail:** all jobs serialize on one GPU, any GPU remains unused, one backend receives multiple concurrent jobs while another is free, an out-of-memory error occurs, or an output is missing.

## 8. Route fixtures

Stop the three self-start backends before route tests. Keep their configuration; only their processes must be stopped.

Set the generated model-path file after the self-start test:

```bash
export MODEL_YAML="$SWARM_REPO/Data/comfy-auto-model.yaml"
test -s "$MODEL_YAML"
```

Start a manually managed native ComfyUI 0.33.0 process on GPU 0:

```bash
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
```

The root request must return valid JSON and version `0.33.0`. The `/api/system_stats` response must not be accepted as ComfyUI system-stat JSON.

### Create an `/api`-only reverse proxy

```bash
export NGINX_ROOT="$EV/40-routes/nginx-api"
mkdir -p "$NGINX_ROOT"
cat > "$NGINX_ROOT/nginx.conf" <<EOF
worker_processes 1;
pid $NGINX_ROOT/nginx.pid;
error_log $NGINX_ROOT/error.log info;
events { worker_connections 1024; }
http {
  access_log $NGINX_ROOT/access.log;
  map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
  }
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
  2>&1 | tee "$EV/40-routes/nginx-api-config-test.txt"
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

Add one **ComfyUI API** backend with:

| Field | Value |
| --- | --- |
| Name | `comfy033-native-auto` |
| Address | `127.0.0.1:8188` |
| Allow Idle | off |
| OverQueue | `1` |
| API Path Mode | `Auto Detect` |
| Enable Frontend Dev | off |

Save `40-routes/R01-native-auto-running.png` with the backend `Running` and save the matching load-log excerpt:

```bash
grep -Ei 'route resolved|root routes|comfy033-native-auto' \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 100 > "$EV/40-routes/R01-native-auto.log"
record_result R01 PASS \
  "40-routes/R01-native-auto-running.png; 40-routes/R01-native-auto.log; 40-routes/native-system-stats.json" \
  "Auto Detect selected native root routes and the backend reached Running"
```

**Pass:** the address is normalised to HTTP, SwarmUI reports root routes, `/object_info` loads, and the backend is `Running`.

**Fail:** SwarmUI commits to `/api`, accepts HTML as probe success, remains idle, or requires the scheme to be typed manually.

### R02 — live `/api` auto-detection

Stop or disable `comfy033-native-auto`. Add:

| Field | Value |
| --- | --- |
| Name | `comfy033-api-auto` |
| Address | `http://127.0.0.1:8288` |
| Allow Idle | on |
| OverQueue | `1` |
| API Path Mode | `Auto Detect` |
| Enable Frontend Dev | off |

Save `40-routes/R02-api-auto-running.png`, then capture:

```bash
grep -Ei 'route resolved|/api prefix|comfy033-api-auto' \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 100 > "$EV/40-routes/R02-api-auto.log"
cp "$NGINX_ROOT/access.log" "$EV/40-routes/R02-nginx-access.log"

grep -E 'GET /api/(system_stats|object_info|features)' \
  "$EV/40-routes/R02-nginx-access.log"
record_result R02 PASS \
  "40-routes/R02-api-auto-running.png; 40-routes/R02-api-auto.log; 40-routes/R02-nginx-access.log" \
  "Auto Detect validated ComfyUI JSON under /api and the backend reached Running"
```

**Pass:** the probe and subsequent requests use `/api`, the root-only proxy location remains 404, and the backend is `Running`.

**Fail:** a 2xx HTML page is accepted, requests lose the prefix after startup, or `/object_info` cannot load.

### R03 — offline-start `/api` recovery

This test proves route choice is not frozen when the proxy is unavailable during backend initialisation.

1. Stop or delete `comfy033-api-auto`.
2. Stop the proxy, but leave native ComfyUI running:

```bash
nginx -p "$NGINX_ROOT/" -c nginx.conf -s stop
until ! curl -fsS http://127.0.0.1:8288/api/system_stats >/dev/null 2>&1; do sleep 1; done
```

3. Add `comfy033-api-recovery` with the same settings as `R02` while port `8288` is offline.
4. Save `40-routes/R03-initial-idle.png`; the backend must be `Idle`, not `Running` or permanently `Errored`.
5. Start the proxy and wait up to 30 seconds:

```bash
: > "$NGINX_ROOT/access.log"
nginx -p "$NGINX_ROOT/" -c nginx.conf

timeout 30 bash -c '
  until grep -qE "GET /api/(system_stats|features|object_info)" '"$NGINX_ROOT"'/access.log; do
    sleep 1
  done
'
```

Save `40-routes/R03-recovered-running.png`, then capture:

```bash
grep -Ei 'changed auto-detected route style|/api prefix|comfy033-api-recovery' \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 150 > "$EV/40-routes/R03-recovery.log"
cp "$NGINX_ROOT/access.log" "$EV/40-routes/R03-nginx-access.log"

record_result R03 PASS \
  "40-routes/R03-initial-idle.png; 40-routes/R03-recovered-running.png; 40-routes/R03-recovery.log; 40-routes/R03-nginx-access.log" \
  "An idle backend re-probed, selected /api, and recovered without edit or restart"
```

**Pass:** the initial state is `Idle`; within two idle-monitor intervals after the proxy returns, the backend selects `/api`, becomes `Running`, and makes prefixed API requests.

**Fail:** it stays on root routes, needs a settings edit/restart, becomes permanently `Errored`, or takes more than 30 seconds after the proxy is healthy.

### R04 — forced root-route compatibility fallback

Stop `comfy033-api-recovery`. Add:

| Field | Value |
| --- | --- |
| Name | `comfy033-root-forced` |
| Address | `http://127.0.0.1:8188/api` |
| Allow Idle | off |
| OverQueue | `1` |
| API Path Mode | `Force Root Routes` |
| Enable Frontend Dev | off |

The explicit mode must win over the trailing `/api` in the supplied address. Save `40-routes/R04-forced-root-running.png` and capture:

```bash
grep -Ei 'route resolved|root routes|comfy033-root-forced' \
  "$EV/10-build/swarm-runtime.log" \
  | tail -n 100 > "$EV/40-routes/R04-forced-root.log"
record_result R04 PASS \
  "40-routes/R04-forced-root-running.png; 40-routes/R04-forced-root.log; 40-routes/native-system-stats.json" \
  "Forced root mode overrode the address suffix and loaded native 0.33.0 routes"
```

**Pass:** the `/api` suffix is removed during normalisation, forced root mode is honoured, and the backend is `Running`.

**Fail:** the suffix overrides the explicit mode, requests go to `/api/object_info`, or the backend fails to initialise.

Also add a temporary API backend with an empty address. It must save as `Disabled` and must make no request to ports `8188` or `8288`. Save `40-routes/blank-address-disabled.png`. A blank address that silently becomes localhost is a merge-blocking regression.

## 9. Generate and Comfy Workflow

Run `G01` with `comfy033-root-forced` as the only enabled generation backend. Run `G02`, `C01`, `W01`, `W02`, and `H01` with an enabled `/api` backend from `R02` or `R03` so HTTP, WebSocket, cancellation, output, and history paths all prove prefix consistency.

### G01 — Generate through native root routes

Use the same deterministic settings as `B04`, but generate one image with seed `330001` and prompt:

```text
SwarmUI ComfyUI 0.33.0 native root acceptance RUN_ID
```

Save:

- `50-generate/G01-before.png`: selected backend and generation settings.
- `50-generate/G01-complete.png`: completed output and visible metadata.
- `50-generate/G01-original.png`: downloaded original.
- `50-generate/G01-original.sha256`: checksum.
- `50-generate/G01-log.txt`: matching SwarmUI and ComfyUI log excerpt.

```bash
sha256sum "$EV/50-generate/G01-original.png" \
  > "$EV/50-generate/G01-original.sha256"
record_result G01 PASS \
  "50-generate/G01-before.png; 50-generate/G01-complete.png; 50-generate/G01-original.png; 50-generate/G01-original.sha256; 50-generate/G01-log.txt" \
  "Generate completed through native root HTTP and WebSocket routes"
```

**Pass:** one final image appears, its metadata names the expected checkpoint/seed/settings, and no request uses `/api`.

**Fail:** a preview is mistaken for the final, metadata is missing, the result cannot be downloaded, or the backend changes state.

### G02 — Generate through `/api`

Enable only the `/api` backend. Clear the proxy access log and generate one image with seed `330002` and prompt:

```text
SwarmUI ComfyUI 0.33.0 prefixed API acceptance RUN_ID
```

```bash
: > "$NGINX_ROOT/access.log"
```

After completion:

```bash
cp "$NGINX_ROOT/access.log" "$EV/50-generate/G02-nginx-access.log"
grep -E '(/api/ws|/api/prompt|/api/history|/api/view)' \
  "$EV/50-generate/G02-nginx-access.log"
sha256sum "$EV/50-generate/G02-original.png" \
  > "$EV/50-generate/G02-original.sha256"
record_result G02 PASS \
  "50-generate/G02-complete.png; 50-generate/G02-original.png; 50-generate/G02-original.sha256; 50-generate/G02-nginx-access.log" \
  "Generate completed with every relevant request retaining /api"
```

**Pass:** `/api/prompt`, `/api/ws`, history/output requests, and the final result all succeed; no root API request returns success from the proxy.

**Fail:** HTTP is prefixed but WebSocket is not, final-image retrieval loses the prefix, or the proxy logs a root-path API request.

### C01 — Comfy Workflow generation

1. Open **Comfy Workflow**.
2. Open **Browse Workflows** and load `Basic SDXL`.
3. Confirm the graph loads without a missing-node warning.
4. Set `SwarmInputCheckpoint` to `$TEST_CHECKPOINT_REL`.
5. Set the positive prompt to `SwarmUI Comfy Workflow 0.33.0 acceptance RUN_ID`.
6. Set width and height to `512`, steps to `20`, CFG to `5`, seed to `330003`, sampler to `euler`, and scheduler to `normal`.
7. Save the workflow as `acceptance-comfy033-RUN_ID`.
8. Use **Use This Workflow In Generate Tab**, then generate one image.
9. Reload the saved workflow and generate a second image directly from the Comfy Workflow tab.

Save:

- `60-workflow/C01-graph.png`: full graph with no missing nodes.
- `60-workflow/C01-generate-tab.png`: completed Generate-tab result.
- `60-workflow/C01-workflow-tab.png`: completed direct workflow result.
- `60-workflow/C01-nginx-access.log`: `/api/ws`, `/api/prompt`, history, and output requests.
- `60-workflow/C01-output-sha256.txt`: both original-image hashes.

```bash
cp "$NGINX_ROOT/access.log" "$EV/60-workflow/C01-nginx-access.log"
sha256sum "$EV/60-workflow"/C01-original-*.png \
  > "$EV/60-workflow/C01-output-sha256.txt"
record_result C01 PASS \
  "60-workflow/C01-graph.png; 60-workflow/C01-generate-tab.png; 60-workflow/C01-workflow-tab.png; 60-workflow/C01-nginx-access.log; 60-workflow/C01-output-sha256.txt" \
  "Basic SDXL loaded, saved, reloaded, and generated from both entry points"
```

**Pass:** the built-in workflow loads, checkpoint/text inputs bind, both entry points generate, `SwarmSaveImageWS` returns final images, and the saved workflow survives reload.

**Fail:** missing nodes, unresolved inputs, silent fallback to the standard workflow, no final image, or a route-prefix mismatch.

## 10. WebSocket previews and cancellation

### W01 — WebSocket and multiple previews

Use the `/api` backend and a generation long enough to observe previews:

| Setting | Value |
| --- | --- |
| Width × height | `1024 × 1024` |
| Steps | `60` |
| CFG scale | `5` |
| Seed | `330004` |
| Preview mode | `latent2rgb` |

Before clicking **Generate**:

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

Capture at least two screenshots at different progress values before completion:

```text
70-ws-cancel/W01-preview-01.png
70-ws-cancel/W01-preview-02.png
```

After the request completes:

```bash
wait "$SOCKET_WATCH_PID" || true
cp "$NGINX_ROOT/access.log" "$EV/70-ws-cancel/W01-nginx-access.log"
grep -E 'GET /api/ws' "$EV/70-ws-cancel/W01-nginx-access.log"
record_result W01 PASS \
  "70-ws-cancel/W01-preview-01.png; 70-ws-cancel/W01-preview-02.png; 70-ws-cancel/W01-sockets.txt; 70-ws-cancel/W01-nginx-access.log" \
  "A prefixed WebSocket upgraded and delivered at least two distinct live previews"
```

**Pass:** the proxy records a successful WebSocket upgrade on `/api/ws`, two visibly different previews arrive before the final image, and progress advances.

**Fail:** only polling occurs, `/ws` loses the prefix, the proxy returns 404/400/502, previews are identical final-image repeats, or the backend goes idle.

### W02 — cancellation and recovery

Start another `1024 × 1024`, 60-step request with seed `330005`. Once it is running and at least one preview is visible:

```bash
curl -fsS http://127.0.0.1:8288/api/queue \
  | tee "$EV/70-ws-cancel/W02-queue-before.json"

python3 - <<'PY' "$EV/70-ws-cancel/W02-queue-before.json" \
  | tee "$EV/70-ws-cancel/W02-prompt-id.txt"
import json, sys
obj = json.load(open(sys.argv[1]))
running = obj.get("queue_running", [])
assert running, "No running prompt to cancel"
print(running[0][1])
PY
export CANCELLED_PROMPT_ID="$(cat "$EV/70-ws-cancel/W02-prompt-id.txt")"
```

Click SwarmUI's **Cancel** control. Do not call ComfyUI's interrupt endpoint manually; the purpose is to verify SwarmUI's cancellation path.

```bash
timeout 30 bash -c '
  while :; do
    q="$(curl -fsS http://127.0.0.1:8288/api/queue)"
    test "$(jq ".queue_running | length" <<<"$q")" = 0 \
      && test "$(jq ".queue_pending | length" <<<"$q")" = 0 \
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

Save `70-ws-cancel/W02-cancelled.png` showing the UI returned to idle with no final output for the cancelled request. Then generate a `512 × 512`, 10-step image with seed `330006` and save `70-ws-cancel/W02-recovery-complete.png`.

```bash
cp "$NGINX_ROOT/access.log" "$EV/70-ws-cancel/W02-nginx-access.log"
grep -E '/api/(queue|interrupt|history)' \
  "$EV/70-ws-cancel/W02-nginx-access.log"
record_result W02 PASS \
  "70-ws-cancel/W02-queue-before.json; 70-ws-cancel/W02-prompt-id.txt; 70-ws-cancel/W02-cancelled.png; 70-ws-cancel/W02-queue-after.json; 70-ws-cancel/W02-history-after.json; 70-ws-cancel/W02-recovery-complete.png; 70-ws-cancel/W02-nginx-access.log" \
  "Cancel interrupted the active prompt, cleared queue/history, emitted no final output, and the backend generated again"
```

**Pass:** SwarmUI removes a pending item or interrupts the active prompt, the queue becomes empty, the cancelled prompt history is deleted, no final output is shown or saved for that request, the backend stays `Running`, and a subsequent generation succeeds.

**Fail:** the request continues, a queue item remains, cancelled history remains, a final image appears, the WebSocket is permanently lost, or the backend must be restarted.

## 11. Outputs and history

### H01 — API history, disk output, and SwarmUI history

Capture baseline API history:

```bash
curl -fsS http://127.0.0.1:8288/api/history \
  | tee "$EV/80-history/history-before.json"
```

In the Comfy Workflow graph used for `C01`, keep `SwarmSaveImageWS` and also connect the decoded image to a standard `SaveImage` node. Set its filename prefix to:

```text
swarm033/RUN_ID
```

Generate one image with seed `330007`. Then:

```bash
curl -fsS http://127.0.0.1:8288/api/history \
  | tee "$EV/80-history/history-after.json"

python3 - <<'PY' \
  "$EV/80-history/history-before.json" \
  "$EV/80-history/history-after.json" \
  | tee "$EV/80-history/new-prompt-id.txt"
import json, sys
before = set(json.load(open(sys.argv[1])))
after = set(json.load(open(sys.argv[2])))
new = sorted(after - before)
assert len(new) == 1, f"Expected one new prompt, got {new}"
print(new[0])
PY
export HISTORY_PROMPT_ID="$(cat "$EV/80-history/new-prompt-id.txt")"

curl -fsS "http://127.0.0.1:8288/api/history/$HISTORY_PROMPT_ID" \
  | tee "$EV/80-history/new-prompt-history.json"
jq -e --arg id "$HISTORY_PROMPT_ID" 'has($id)' \
  "$EV/80-history/new-prompt-history.json"

find "$COMFY_REPO/output/swarm033" -type f -newermt "${RUN_ID:0:8}" \
  -print | sort | tee "$EV/80-history/output-files.txt"
test -s "$EV/80-history/output-files.txt"
while IFS= read -r output; do
  file "$output"
  sha256sum "$output"
done < "$EV/80-history/output-files.txt" \
  | tee "$EV/80-history/output-evidence.txt"
```

Hard-refresh SwarmUI and open **History**. Save:

- `80-history/H01-history.png`: the completed request and image in SwarmUI History.
- `80-history/H01-output.png`: the original image fetched from the history entry.
- `80-history/H01-metadata.png`: generation metadata showing seed `330007` and the expected checkpoint.

```bash
record_result H01 PASS \
  "80-history/history-before.json; 80-history/history-after.json; 80-history/new-prompt-id.txt; 80-history/new-prompt-history.json; 80-history/output-files.txt; 80-history/output-evidence.txt; 80-history/H01-history.png; 80-history/H01-output.png; 80-history/H01-metadata.png" \
  "One completed prompt produced WebSocket output, a valid disk file, API history, and a SwarmUI history entry"
```

**Pass:** exactly one new completed prompt is identifiable; its API history contains output metadata; the standard `SaveImage` file exists and has a stable hash; SwarmUI History survives a hard refresh; the original and metadata can be reopened; the cancelled prompt from `W02` is absent.

**Fail:** history is ambiguous, the disk file is missing/corrupt, SwarmUI History loses the result, output retrieval loses `/api`, or cancelled work reappears.

## 12. Model paths and text encoders

### M01 — YAML and discovery

Capture and validate the self-start-generated file:

```bash
cp "$MODEL_YAML" "$EV/90-model-paths/comfy-auto-model.yaml"
"$COMFY_PY" - <<'PY' "$MODEL_YAML" \
  | tee "$EV/90-model-paths/yaml-validation.txt"
from pathlib import Path
import sys, yaml
path = Path(sys.argv[1])
data = yaml.safe_load(path.read_text())
assert isinstance(data, dict) and data, "YAML is empty"
text = path.read_text()
required = [
    "checkpoints", "vae", "loras", "text_encoders", "diffusion_models",
    "configs", "diffusers", "vae_approx", "datasets", "photomaker",
    "classifiers", "model_patches", "audio_encoders", "background_removal",
    "frame_interpolation", "geometry_estimation", "optical_flow", "detection",
]
for key in required:
    assert key in text, f"Missing path category: {key}"
for alias in ("text_encoders", "clip", "CLIP"):
    assert alias in text, f"Missing text-encoder alias: {alias}"
print("YAML_PARSE=OK")
print("REQUIRED_KEYS=OK")
print("TEXT_ENCODER_ALIASES=OK")
PY
```

Create harmless discovery sentinels. They are intentionally invalid model contents and must never be loaded; they only prove that ComfyUI's file enumeration sees each case-sensitive Ubuntu path.

```bash
for dir in text_encoders clip CLIP model_patches; do
  mkdir -p "$MODEL_ROOT/$dir"
  printf 'SWARMUI-COMFY033-DISCOVERY-%s-%s\n' "$RUN_ID" "$dir" \
    > "$MODEL_ROOT/$dir/acceptance-$RUN_ID-$dir.safetensors"
done
```

Restart only `comfy033-gpu0`, record its discovered port as `MODEL_TEST_PORT`, and fetch node definitions:

```bash
export MODEL_TEST_PORT="<discovered-port>"
curl -fsS "http://127.0.0.1:$MODEL_TEST_PORT/object_info" \
  | tee "$EV/90-model-paths/object-info.json" >/dev/null

jq -r '.. | strings' "$EV/90-model-paths/object-info.json" \
  | grep -F "acceptance-$RUN_ID" \
  | sort -u | tee "$EV/90-model-paths/discovered-sentinels.txt"

grep -F "acceptance-$RUN_ID-text_encoders.safetensors" \
  "$EV/90-model-paths/discovered-sentinels.txt"
grep -F "acceptance-$RUN_ID-clip.safetensors" \
  "$EV/90-model-paths/discovered-sentinels.txt"
grep -F "acceptance-$RUN_ID-CLIP.safetensors" \
  "$EV/90-model-paths/discovered-sentinels.txt"
```

Refresh SwarmUI models and save:

- `90-model-paths/M01-checkpoint.png`: the real SDXL checkpoint visible and selected.
- `90-model-paths/M01-text-encoders.png`: the relevant text-encoder loader dropdown containing the sentinel names when that node exposes them.
- `90-model-paths/M01-backend-running.png`: restarted GPU 0 backend `Running`.

Remove the sentinels immediately after capture and restart the backend once more:

```bash
find "$MODEL_ROOT" -type f -name "acceptance-$RUN_ID-*.safetensors" \
  -print -delete | tee "$EV/90-model-paths/removed-sentinels.txt"
record_result M01 PASS \
  "90-model-paths/comfy-auto-model.yaml; 90-model-paths/yaml-validation.txt; 90-model-paths/object-info.json; 90-model-paths/discovered-sentinels.txt; 90-model-paths/M01-checkpoint.png; 90-model-paths/M01-text-encoders.png; 90-model-paths/M01-backend-running.png; 90-model-paths/removed-sentinels.txt" \
  "Generated YAML is valid, includes model_patches and all text-encoder aliases, and ComfyUI enumerates them on case-sensitive Ubuntu paths"
```

**Pass:** YAML parses, required categories occur once in the generated mapping, `text_encoders`, `clip`, and `CLIP` remain distinct and discoverable on Ubuntu, `model_patches` is forwarded, the real checkpoint appears, and the restarted backend generates successfully.

**Fail:** malformed YAML, a missing category, duplicate conflicting keys, case folding, an undiscoverable checkpoint/text encoder, a sentinel accidentally loaded, or a backend failure after path refresh.

## 13. Merge-blocking risk gates

The following defects are merge blockers. The named evidence must disprove each one:

| Risk | Required disproof |
| --- | --- |
| Wrong 0.33.0 frontend pin | `D01` and `D02` show exactly `1.48.7` before and after self-start repair |
| Dependency repair mutates the CUDA stack | `D02` package delta and Torch evidence show no unintended Torch-family change |
| `/api` detection accepts arbitrary 2xx/HTML | `R01` rejects the native server's non-ComfyUI `/api/system_stats` response and still selects root |
| Native 0.33.0 routes are mislabeled as `/api` | `R01` and native access evidence show root routes |
| Auto-detected route is frozen while offline | `R03` moves from `Idle` to `Running` on `/api` without editing or restarting the backend |
| Explicit root mode loses to an address suffix | `R04` forces root even when the saved address ends in `/api` |
| Blank API address silently targets localhost | blank-address evidence shows `Disabled` and no network request |
| HTTP and WebSocket route styles diverge | `G02`, `C01`, and `W01` show `/api/prompt`, `/api/ws`, history, and output retrieval under the same prefix |
| Cancellation leaves work or history behind | `W02` proves queue empty, cancelled history empty, no final output, and subsequent recovery |
| Generated model YAML omits current categories | `M01` proves parseable YAML, `model_patches`, and all text-encoder aliases |
| Multi-GPU setup exposes all GPUs to one process | `B01`–`B04` prove one process, one mask, one port, and one physical GPU per backend |
| Source does not compile cleanly | `S01` Release build and changed-file warning gate pass |

Do not mark a risk resolved from source inspection alone when this runbook requires runtime evidence.

## 14. Finalise the evidence bundle

Verify that every mandatory ID appears exactly once and is `PASS`:

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
    row = seen[test_id][0]
    assert row["RESULT"] == "PASS", f"{test_id} is {row['RESULT']}"
    assert row["EVIDENCE"].strip(), f"{test_id} has no evidence"
print("ALL_MANDATORY_TESTS=PASS")
PY

find "$EV" -type f ! -name manifest.sha256 -print0 \
  | sort -z \
  | xargs -0 sha256sum \
  > "$EV/99-summary/manifest.sha256"

tar -C "$(dirname "$EV")" -czf "$EV.tar.gz" "$(basename "$EV")"
sha256sum "$EV.tar.gz" | tee "$EV.tar.gz.sha256"
```

Stop only the test fixtures created by this procedure:

```bash
nginx -p "$NGINX_ROOT/" -c nginx.conf -s stop 2>/dev/null || true
tmux kill-session -t comfy033-native 2>/dev/null || true
tmux kill-session -t swarm033 2>/dev/null || true
```

The evidence archive, its checksum, the source commit SHA, the ComfyUI commit SHA, and `99-summary/results.tsv` form the acceptance record.