#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.cache/src/ffmpeg-8.0"
# Invoked from a Visual Studio x64 Developer environment. Use its linker, not
# the POSIX `link` utility provided by Git Bash.
export PATH="$(cygpath -u "$VCToolsInstallDir")bin/Hostx64/x64:$(pwd)/../../usr/bin:$PATH"
# Do not embed a developer's home directory in __FILE__ / assertion strings.
export CL="-experimental:deterministic -pathmap:\"$(cygpath -w "$PWD")=ffmpeg-8.0\" ${CL:-}"
# Microsoft distributes localized compiler banners. The upstream leading anchor
# misses Chinese installations even with VSLANG=1033. Match the vendor anywhere.
sed -i 's/grep -q \^Microsoft/grep -q Microsoft/g; s/grep \^Microsoft/grep Microsoft/g' configure
./configure --toolchain=msvc --arch=x86_64 --target-os=win64 \
  --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-x86asm --disable-gpl --disable-nonfree --disable-version3 \
  --disable-everything --enable-ffmpeg --enable-ffprobe \
  --enable-protocol=file,pipe --enable-demuxer=wav,ogg,mp3,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le --enable-indev=lavfi \
  --enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,vorbis,mp3 \
  --enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
  --enable-muxer=wav,null,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le --enable-parser=vorbis,mpegaudio \
  --enable-filter=abuffer,abuffersink,aresample,asetrate,aformat,anull,atrim,asetpts,afade,apad,adelay,amix,concat,volume,loudnorm,silencedetect,silenceremove,astats,sine,anullsrc
# Reconfigure must invalidate every object on localized MSVC: upstream's
# dependency scanner recognizes English /showIncludes output only.
make clean
make -j12 ffmpeg.exe ffprobe.exe
