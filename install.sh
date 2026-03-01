#!/bin/sh
set -e

REPO="methonetecnologia/runo"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="runo"

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *)
    echo "Error: unsupported OS: $OS"
    echo "Download manually from https://github.com/$REPO/releases"
    exit 1
    ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Error: unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET="runo-${OS}-${ARCH}"

echo "Detecting platform: ${OS}-${ARCH}"

# Get latest version
VERSION=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$VERSION" ]; then
  echo "Error: could not determine latest version"
  exit 1
fi

echo "Latest version: $VERSION"

URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"

echo "Downloading $URL..."
TMP=$(mktemp)
HTTP_CODE=$(curl -fsSL -w '%{http_code}' -o "$TMP" "$URL" 2>/dev/null || true)

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "Error: download failed (HTTP $HTTP_CODE)"
  echo "Asset '$ASSET' may not exist for this release."
  echo "Check: https://github.com/$REPO/releases/tag/$VERSION"
  exit 1
fi

chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
else
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  sudo mv "$TMP" "$INSTALL_DIR/$BINARY_NAME"
fi

echo ""
echo "Runo $VERSION installed to $INSTALL_DIR/$BINARY_NAME"
echo "Run 'runo' to start, or 'runo --help' for usage."
