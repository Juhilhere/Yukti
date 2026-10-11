#!/usr/bin/env bash
# Build the macOS app (Apple silicon): Yukti.app with the complete Yukti Server inside, packed as Yukti-<ver>-arm64.dmg.
#   Yukti.app/Contents/Resources/server/   yukti-server (frozen) + llama.cpp Metal + UI + Laya + public data + examples
# The AI model is not inside: on the first start the app downloads it from the signed release manifest (or uses a model
# that is already on the Mac, e.g. LM Studio's). The photo and voice add-ons download only their model files the same
# way (whisper.cpp for voice ships inside the app).
# Requirements on the BUILD Mac only: uv, Node 22, curl, cmake, Xcode command line tools (clang, codesign, hdiutil).
#   ops/build-mac.sh [--production] [--out DIR]     (demo build by default: sample accounts on the login page)
set -euo pipefail

VERSION="0.5.1"
LLAMA_TAG="b11429"                       # llama.cpp release (Metal build for macOS arm64)
WHISPER_TAG="b5130"                      # whisper.cpp release (same as the Windows build); compiled here with Metal
OUT="${HOME}/yukti-build-mac"
DEMO=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --demo) DEMO=1 ;;
    --production) DEMO=0 ;;
    --out) OUT="$2"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
[[ "$(uname -m)" == "arm64" ]] || { echo "Build on an Apple silicon Mac."; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$OUT/server"
export UV_PYTHON_PREFERENCE=only-managed   # never freeze against a Homebrew/system Python
mkdir -p "$OUT"

echo "1/6 Web UI"
(cd "$ROOT/web" && npm ci && npm run build)

echo "2/6 Freeze server"
cd "$ROOT/backend"
uv sync
uv run pyinstaller --noconfirm --clean --name yukti-server --distpath "$OUT/pyi-dist" --workpath "$OUT/pyi-work" --specpath "$OUT" \
  --paths . --console \
  --collect-all rapidocr_onnxruntime --collect-all onnxruntime --collect-all pypdfium2 --collect-all pypdfium2_raw --collect-all docx \
  --collect-all reportlab --collect-all highspy --collect-all skl2onnx --collect-submodules sklearn --collect-data sklearn \
  --collect-all segno --collect-all argon2 --collect-all pptx --collect-all xlsxwriter --collect-submodules uvicorn --collect-submodules app \
  --hidden-import simpleeval --hidden-import pynvml --hidden-import multipart --hidden-import python_multipart --hidden-import openpyxl --hidden-import pyotp \
  server_main.py
# pre-train Laya once (in a scratch data folder) so the app needs no training at first start
rm -rf "$OUT/laya-store"
YUKTI_STORE="$OUT/laya-store" uv run python -c "from app import db; db.init_db(); from app import laya; laya.get()"
cd "$ROOT"

echo "3/6 llama.cpp $LLAMA_TAG (Metal)"
LLAMA_TGZ="$OUT/llama-$LLAMA_TAG-bin-macos-arm64.tar.gz"
[[ -f "$LLAMA_TGZ" ]] || curl -fL -o "$LLAMA_TGZ" "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/llama-$LLAMA_TAG-bin-macos-arm64.tar.gz"
rm -rf "$OUT/llama-x" && mkdir -p "$OUT/llama-x" && tar -xzf "$LLAMA_TGZ" -C "$OUT/llama-x"
LLAMA_BIN="$(dirname "$(find "$OUT/llama-x" -name llama-server -type f | head -1)")"

echo "3b/6 whisper.cpp $WHISPER_TAG (Metal, voice add-on)"
WSRC="$OUT/whisper-$WHISPER_TAG"
if [[ ! -x "$WSRC/build/bin/whisper-server" ]]; then
  rm -rf "$WSRC" && mkdir -p "$WSRC"
  curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/$WHISPER_TAG.tar.gz" | tar -xz --strip-components=1 -C "$WSRC"
  # one self-contained program: Metal shaders embedded, only macOS's own frameworks needed
  cmake -S "$WSRC" -B "$WSRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
  cmake --build "$WSRC/build" --target whisper-server -j 8
fi

echo "4/6 Assemble server"
rm -rf "$PKG"
mkdir -p "$PKG/backend/policies" "$PKG/web" "$PKG/data/corpus" "$PKG/data/store" "$PKG/llama/metal" "$PKG/speech/metal" "$PKG/models"
cp -R "$OUT/pyi-dist/yukti-server/." "$PKG/"
cp "$ROOT/backend/policies/core.yaml" "$PKG/backend/policies/"
cp -R "$ROOT/web/dist" "$PKG/web/dist"
cp -R "$ROOT/data/structured" "$ROOT/data/mrpl" "$PKG/data/"
cp "$ROOT/data/corpus/manifest.json" "$PKG/data/corpus/"
python3 - "$ROOT" "$PKG" <<'PY'
import re, shutil, sys
root, pkg = sys.argv[1], sys.argv[2]
s = open(f"{root}/backend/app/seed.py", encoding="utf8").read()
i = s.index("EXAMPLE_FILES")
for f in re.findall(r'"([^"]+\.(?:pdf|docx|png|txt|xlsx))"', s[i:s.index("]", i)]):
    shutil.copy(f"{root}/data/corpus/{f}", f"{pkg}/data/corpus/")
PY
cp -R "$OUT/laya-store/laya" "$PKG/data/store/laya"
# llama-server and the libraries it loads (dylibs with @rpath next to it)
cp "$LLAMA_BIN/llama-server" "$PKG/llama/metal/"
find "$LLAMA_BIN" -maxdepth 1 \( -name "*.dylib" -o -name "*.metal" -o -name "*.metallib" \) -exec cp {} "$PKG/llama/metal/" \;
cp "$WSRC/build/bin/whisper-server" "$PKG/speech/metal/"
cp "$ROOT/ops/package/MODELS.txt" "$PKG/models/"
cp "$ROOT/LICENSE" "$ROOT/NOTICE" "$ROOT/docs/THIRD_PARTY_NOTICES.md" "$PKG/"
[[ $DEMO == 1 ]] && echo "Demonstration build: delete this file before the first start for production use." > "$PKG/DEMO_MODE"

echo "5/6 Desktop app"
cd "$ROOT/desktop"
npm ci
npm run pack:mac
APP="$(find "$ROOT/desktop/dist" -maxdepth 2 -name Yukti.app -type d | head -1)"
rm -rf "$APP/Contents/Resources/server"
cp -R "$PKG" "$APP/Contents/Resources/server"
# not notarized: sign ad hoc, inside out (Apple silicon runs only signed code)
find "$APP/Contents/Resources/server" -type f \( -perm -u+x -o -name "*.dylib" -o -name "*.so" \) -print0 |
  xargs -0 -n 50 codesign --force --sign - --timestamp=none 2>/dev/null || true
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"

echo "6/6 Disk image"
DMG="$ROOT/desktop/dist/Yukti-$VERSION-arm64.dmg"
STAGE="$OUT/dmg"
rm -rf "$STAGE" "$DMG" && mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Yukti $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG"
rm -rf "$STAGE"
shasum -a 256 "$DMG"
echo "Done: $DMG"
