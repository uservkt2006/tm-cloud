#!/bin/bash
# Bundle backend vào _backend/ cho electron-builder.
# - Copy backend/app.py + scripts/ + .env (nếu có) → _backend/
# - Exclude .venv/ (sẽ dùng python-linux-x64 từ build/)
set -e
cd "$(dirname "$0")/.."
rm -rf frontend/_backend
mkdir -p frontend/_backend/scripts
cp backend/app.py frontend/_backend/
# copy backend/scripts/ nếu có, hoặc tạo empty dir
if [ -d backend/scripts ]; then
  cp -r backend/scripts/. frontend/_backend/scripts/
fi
# copy oauth-helper.sh (script OAuth 1-click flow)
if [ -f scripts/oauth-helper.sh ]; then
  cp scripts/oauth-helper.sh frontend/_backend/scripts/
fi
# copy frontend-server.py (dùng để serve dist/ + proxy /api trong packaged app)
cp scripts/frontend-server.py frontend/_backend/scripts/
# Tạo requirements.txt cho bundled python
cp backend/requirements.txt frontend/_backend/requirements.txt
echo "Backend bundled:"
ls -la frontend/_backend/
echo ""
echo "Scripts:"
ls -la frontend/_backend/scripts/
echo ""
echo "Sizes:"
du -sh frontend/_backend/app.py frontend/_backend/scripts 2>/dev/null

# Sync dist (chỉ assets + index.html) → build/frontend-dist/
# QUAN TRỌNG: không copy nguyên dist/ vì sẽ include dist/linux-unpacked/ + dist/*.deb
# từ build trước → recursive build
echo ""
echo "Syncing dist → build/frontend-dist (chỉ assets + index.html)..."
rm -rf build/frontend-dist
mkdir -p build/frontend-dist
cp frontend/dist/index.html build/frontend-dist/
cp -r frontend/dist/assets build/frontend-dist/
echo "build/frontend-dist:"
ls -la build/frontend-dist/
du -sh build/frontend-dist/