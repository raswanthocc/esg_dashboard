#!/usr/bin/env bash
# Render build script: install backend deps, build the React bundle, copy
# the build into where Django can collect it, run migrations, collectstatic.
# Idempotent — re-runs cleanly on every deploy.

set -o errexit

echo "==> Installing Python dependencies"
pip install -r backend/requirements.txt

echo "==> Building React bundle"
cd frontend
npm ci
npm run build
cd ..

echo "==> Staging frontend build for Whitenoise"
rm -rf backend/frontend_build
mkdir -p backend/frontend_build
cp -R frontend/dist/* backend/frontend_build/
# index.html lives in the Django template path, not in static, so the
# template loader can find it.
mkdir -p backend/templates
cp frontend/dist/index.html backend/templates/index.html

echo "==> Running migrations"
cd backend
python manage.py migrate --noinput
python manage.py collectstatic --noinput
cd ..

echo "==> Build complete"
