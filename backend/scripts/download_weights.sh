#!/bin/sh
# Download PawPrint's AI vision weights DIRECTLY from their canonical sources.
# No Hugging Face account and no HF token are used or required:
#   - YOLO-World checkpoint  -> GitHub release asset (ultralytics/assets)
#   - CLIP ViT-B/32 weights  -> OpenAI's public Azure blob (the URL path IS the sha256)
# Both files are verified against pinned sha256 checksums after download.
#
# Usage:  sh backend/scripts/download_weights.sh
# (also runs inside the backend Docker image at build time)
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

YOLO_URL="https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s-worldv2.pt"
YOLO_SHA256="9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792"
YOLO_DEST="$ROOT/backend/yolov8s-worldv2.pt"

CLIP_URL="https://openaipublic.blob.core.windows.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt"
CLIP_SHA256="40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af"
CLIP_DEST="$ROOT/weights/clip/ViT-B-32.pt"

verify() {
    # verify <sha256> <file>
    echo "$1  $2" | sha256sum -c --quiet
}

download() {
    # download <url> <dest> <sha256>
    url="$1"; dest="$2"; sha="$3"
    if [ -f "$dest" ] && verify "$sha" "$dest" 2>/dev/null; then
        echo "OK (cached, checksum matches): $dest"
        return 0
    fi
    mkdir -p "$(dirname -- "$dest")"
    echo "Downloading $url"
    echo "         -> $dest"
    curl -fL --retry 3 --connect-timeout 30 -o "$dest.part" "$url"
    verify "$sha" "$dest.part"
    mv -f "$dest.part" "$dest"
    echo "OK (checksum verified): $dest"
}

download "$YOLO_URL" "$YOLO_DEST" "$YOLO_SHA256"
download "$CLIP_URL" "$CLIP_DEST" "$CLIP_SHA256"
echo "All vision weights present and verified. No Hugging Face token was used."
