# -*- coding: utf-8 -*-
"""Lossless optimization of local images and video for the web."""

from io import BytesIO
from pathlib import Path
from shutil import which
from struct import error as StructError, unpack_from
from subprocess import DEVNULL, SubprocessError, run
from tempfile import TemporaryDirectory
from typing import Optional, Set
from zlib import crc32


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_SUPPORTED_CHUNKS = {
    b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS",
    b"iCCP", b"sRGB", b"gAMA", b"cHRM", b"pHYs", b"tEXt", b"bKGD",
}
_MIN_SAVINGS_BYTES = 4 * 1024
# Экспорт Figma: gAMA 45455 + cHRM с первичными цветами sRGB (точка белого D65) описывают
# тот же sRGB, что и WebP без профиля; браузеры эти чанки не применяют.
_SRGB_GAMA = bytes.fromhex("0000b18f")
_SRGB_CHRM = bytes.fromhex("00007a26000080840000fa00000080e8000075300000ea6000003a9800001770")
_WEBP_MAX_DIMENSION = 16383


def _supported_chunks(raw: bytes) -> Optional[Set[bytes]]:
    """Check chunks directly, including metadata Pillow may ignore."""
    if not raw.startswith(_PNG_SIGNATURE + b"\x00\x00\x00\x0dIHDR"):
        return None
    if len(raw) < 33 or raw[24] > 8:
        # Pillow can silently reduce 16-bit PNG channels to 8 bits.
        return None

    view = memoryview(raw)
    chunks = set()
    offset = len(_PNG_SIGNATURE)
    while offset + 12 <= len(raw):
        length, kind = unpack_from(">I4s", raw, offset)
        start = offset + 8
        end = start + length
        if end + 4 > len(raw) or kind not in _SUPPORTED_CHUNKS:
            return None
        if crc32(view[offset + 4:end]) != unpack_from(">I", raw, end)[0]:
            return None
        if kind == b"pHYs":
            if length != 9 or raw[start:start + 4] != raw[start + 4:start + 8]:
                return None
        if kind == b"gAMA" and raw[start:end] != _SRGB_GAMA:
            return None
        if kind == b"cHRM" and raw[start:end] != _SRGB_CHRM:
            return None
        if kind == b"tEXt" and not raw.startswith(b"Software\x00", start, end):
            return None
        chunks.add(kind)
        offset = end + 4
        if kind == b"IEND":
            return chunks if length == 0 and offset == len(raw) else None
    return None


def optimize_png(raw: bytes) -> Optional[bytes]:
    """Return WebP if it saves at least 2% and 4 KiB, or keep PNG via None.

    Require identical decoded RGBA (including RGB at zero alpha) and ICC.
    Square-pixel DPI and the Software tag may be dropped for web use.
    Keep PNG for APNG, EXIF/XMP, unsupported chunks, and gamma/chromaticity
    that differ from sRGB (bKGD is a viewer hint and is dropped). Output is repeatable with the same codec.
    """
    if len(raw) <= _MIN_SAVINGS_BYTES:
        return None
    chunks = _supported_chunks(raw)
    if chunks is None:
        return None
    if b"iCCP" in chunks and chunks & {b"gAMA", b"cHRM"}:
        return None

    try:
        from PIL import Image, ImageFile, features
    except ImportError:
        return None
    if ImageFile.LOAD_TRUNCATED_IMAGES or not features.check("webp"):
        return None

    width, height = unpack_from(">II", raw, 16)
    if max(width, height) > _WEBP_MAX_DIMENSION:
        return None
    if Image.MAX_IMAGE_PIXELS is not None and width * height > Image.MAX_IMAGE_PIXELS:
        return None

    try:
        with Image.open(BytesIO(raw), formats=["PNG"]) as source:
            if source.n_frames != 1:
                return None
            icc = source.info.get("icc_profile")
            if b"iCCP" in chunks and (not icc or source.mode not in {"RGB", "RGBA", "P"}):
                return None
            with source.convert("RGBA") as rgba, BytesIO() as output:
                rgba.save(
                    output, format="WEBP", lossless=True, exact=True,
                    quality=100, method=6, icc_profile=icc,
                )
                savings = len(raw) - output.tell()
                if savings < _MIN_SAVINGS_BYTES or savings * 50 < len(raw):
                    return None

                output.seek(0)
                with Image.open(output, formats=["WEBP"]) as encoded:
                    if encoded.n_frames != 1 or encoded.size != rgba.size:
                        return None
                    if encoded.info.get("icc_profile") != icc:
                        return None
                    with encoded.convert("RGBA") as decoded:
                        if decoded.tobytes() != rgba.tobytes():
                            return None
                return output.getvalue()
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError, IndexError, StructError):
        return None


def _mp4_boxes(raw):
    boxes = {}
    offset = 0
    while offset + 8 <= len(raw):
        size, kind = unpack_from(">I4s", raw, offset)
        if size < 8 or offset + size > len(raw) or kind in boxes:
            return {}
        boxes[kind] = (offset, offset + size)
        offset += size
    return boxes if offset == len(raw) else {}


def faststart_mp4(raw: bytes) -> Optional[bytes]:
    """Move metadata before media without changing the encoded stream."""
    boxes = _mp4_boxes(raw)
    if not {b"ftyp", b"moov", b"mdat"} <= boxes.keys() or b"moof" in boxes:
        return None
    start, end = boxes[b"mdat"]
    if boxes[b"moov"][0] < start:
        return None
    ffmpeg = which("ffmpeg")
    if ffmpeg is None:
        return None
    try:
        with TemporaryDirectory(prefix="sya-video-") as folder:
            source = Path(folder) / "source.mp4"
            target = Path(folder) / "faststart.mp4"
            source.write_bytes(raw)
            run([ffmpeg, "-nostdin", "-v", "error", "-i", str(source), "-map", "0",
                 "-c", "copy", "-movflags", "+faststart", str(target)],
                check=True, timeout=15, stdout=DEVNULL, stderr=DEVNULL)
            remuxed = target.read_bytes()
    except (OSError, SubprocessError):
        return None
    updated = _mp4_boxes(remuxed)
    if not {b"moov", b"mdat"} <= updated.keys():
        return None
    new_start, new_end = updated[b"mdat"]
    if updated[b"moov"][0] < new_start and raw[start + 8:end] == remuxed[new_start + 8:new_end]:
        return remuxed
    return None


def video_poster(source: Path) -> Optional[bytes]:
    ffmpeg = which("ffmpeg")
    if ffmpeg is None:
        return None
    try:
        frame = run(
            [ffmpeg, "-nostdin", "-v", "error", "-i", str(source), "-frames:v", "1",
             "-vf", "scale=min(960\\,iw):-2", "-c:v", "mjpeg", "-q:v", "3", "-f", "image2pipe", "pipe:1"],
            check=True, timeout=15, capture_output=True,
        ).stdout
    except (OSError, SubprocessError):
        return None
    return frame if frame.startswith(b"\xff\xd8") else None
