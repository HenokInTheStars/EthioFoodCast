#!/usr/bin/env bash
# Publish the API to a Hugging Face Docker Space.
#
#   scripts/publish_hf_space.sh <hf-username>/<space-name>
#
# The Space gets a copy of the files git tracks under backend/ and scripts/,
# with backend/Dockerfile at its root, so the image builds exactly as it does
# locally (docker build -f backend/Dockerfile .). Model files go through Git LFS,
# which Hugging Face requires for files over 10 MB.
#
# Needs: git, Git LFS (https://git-lfs.com), and a Hugging Face access token with
# write permission (git asks for it as the password on the first push).
set -euo pipefail

SPACE="${1:?usage: scripts/publish_hf_space.sh <hf-username>/<space-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git lfs version >/dev/null 2>&1 || { echo "Git LFS is required: https://git-lfs.com" >&2; exit 1; }

cd "$ROOT"
if [ -n "$(git status --porcelain -- backend scripts deploy)" ]; then
  echo "backend/, scripts/ or deploy/ has uncommitted changes; commit them first so the Space matches git." >&2
  exit 1
fi

# Tracked files only: no .venv, caches or local data.
git ls-files -z backend scripts .dockerignore | while IFS= read -r -d '' file; do
  mkdir -p "$WORK/$(dirname "$file")"
  cp "$file" "$WORK/$file"
done
cp backend/Dockerfile "$WORK/Dockerfile"
cp deploy/huggingface/README.md "$WORK/README.md"
SOURCE_COMMIT="$(git rev-parse --short HEAD)"

cd "$WORK"
git init -q -b main
git lfs install --local >/dev/null
git lfs track "*.joblib" "*.png" >/dev/null
git add -A
git commit -q -m "Deploy EthioFoodCast API from ${SOURCE_COMMIT}"
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "Dry run: $(git ls-files | wc -l) files, $(du -sh --exclude=.git . | cut -f1) in total. LFS files:"
  git lfs ls-files
  exit 0
fi
echo "Pushing to https://huggingface.co/spaces/${SPACE} ..."
git push --force "https://huggingface.co/spaces/${SPACE}" main
echo "Done. The Space rebuilds automatically; follow it at https://huggingface.co/spaces/${SPACE}"
