#!/usr/bin/env bash
# Make the AppImage start on RHEL 9 as well, and pack it again.
#
# Measured reach of the result, built on Ubuntu 22.04: it draws its window on
# AlmaLinux 9.8 (glibc 2.34, so Rocky 9 and RHEL 9 too) and on Ubuntu 24.04. On
# Ubuntu 26.04 the web process dies in EGL — and so does the same build without
# this script, so that one is WebKit 2.50 against a very new mesa, not this
# pass.
#
# WebKitGTK 4.1 exists on Ubuntu 22.04 and nowhere in RHEL 9, so the bundle has
# to carry it. Three things stop that bundle on RHEL 9:
#
#   * linuxdeploy leaves freetype, fontconfig and harfbuzz on the host, and
#     RHEL 9's copies are older than what this WebKit needs — it asks for
#     FT_Get_Color_Glyph_Paint, which arrived in freetype 2.11. Carry them.
#   * hypot and hypotf are tagged GLIBC_2.35. RHEL 9 has both functions at an
#     older tag, so drop the tag from the symbols, then retag the requirement
#     the loader reads separately.
#   * WebKit needs GLIBCXX_3.4.30, which RHEL 9's libstdc++ does not have. This
#     one cannot simply be carried: a current distro's mesa wants a NEWER
#     libstdc++ than Ubuntu 22.04's, and forcing ours on it kills the web
#     process with EGL_BAD_PARAMETER. So it goes in `usr/optional` and a hook
#     puts it on the path only where the host's copy is too old.
set -eu

APPDIR=${1:?usage: widen.sh <AppDir> [tool cache]}
TOOLS=${2:-$HOME/.cache/tauri}
HERE=$(cd "$(dirname "$0")" && pwd)
L=/usr/lib/x86_64-linux-gnu

for f in libfreetype.so.6 libharfbuzz.so.0 libfontconfig.so.1 \
         libbrotlidec.so.1 libbrotlicommon.so.1 libpng16.so.16 \
         libgraphite2.so.3 libexpat.so.1 libuuid.so.1 libz.so.1; do
  cp -Lf "$L/$f" "$APPDIR/usr/lib/$f"
done

mkdir -p "$APPDIR/usr/optional"
for f in libstdc++.so.6 libgcc_s.so.1; do
  cp -Lf "$L/$f" "$APPDIR/usr/optional/$f"
done

cat > "$APPDIR/apprun-hooks/nodebookmd-runtime.sh" <<'HOOK'
# Use the libstdc++ in this bundle only where the host's is older than the one
# WebKit was built against. On a current distro the host's is newer, and the
# graphics drivers need that newer one.
_hmd_host=$(ldconfig -p 2>/dev/null | awk '/libstdc\+\+\.so\.6 /{print $NF; exit}')
[ -n "${_hmd_host:-}" ] || _hmd_host=/lib64/libstdc++.so.6
if ! grep -qa GLIBCXX_3.4.30 "$_hmd_host" 2>/dev/null; then
    export LD_LIBRARY_PATH="$this_dir/usr/optional${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
unset _hmd_host
HOOK

# The AppRun sources one hook per line, and linuxdeploy wrote it before this
# hook existed.
grep -q 'nodebookmd-runtime.sh' "$APPDIR/AppRun" || sed -i \
  's|^exec "$this_dir"/AppRun.wrapped|source "$this_dir"/apprun-hooks/"nodebookmd-runtime.sh"\n\nexec "$this_dir"/AppRun.wrapped|' \
  "$APPDIR/AppRun"

for f in libcairo.so.2 libwebkit2gtk-4.1.so.0 libjavascriptcoregtk-4.1.so.0; do
  patchelf --clear-symbol-version hypot --clear-symbol-version hypotf "$APPDIR/usr/lib/$f"
  python3 "$HERE/downver.py" "$APPDIR/usr/lib/$f" libm.so.6 GLIBC_2.35 GLIBC_2.2.5
done

# The build runner's own umask has shipped a tool-written file — AppRun.wrapped
# — at mode 0770: no execute for "other", so a reader's own sandbox refuses it
# ("AppRun.wrapped: Permission denied", caught by the AppImage catalog test).
# Force the bit back on every ELF and shebang file before packing, and fail
# loudly rather than ship one still missing it.
is_elf() { head -c4 "$1" 2>/dev/null | cmp -s - <(printf '\x7fELF'); }
is_shebang() { [ "$(head -c2 "$1" 2>/dev/null)" = '#!' ]; }
while IFS= read -r -d '' f; do
  if is_elf "$f" || is_shebang "$f"; then
    chmod a+rx "$f"
    [ -x "$f" ] || { echo "still not executable after chmod: $f" >&2; exit 1; }
  fi
done < <(find "$APPDIR" -type f -print0)

export APPIMAGE_EXTRACT_AND_RUN=1
export OUTPUT=${OUTPUT:-$(basename "$APPDIR" .AppDir).AppImage}
"$TOOLS/linuxdeploy-plugin-appimage.AppImage" --appdir "$APPDIR"
ls -la "$OUTPUT"
