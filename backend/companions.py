import hashlib
import re
from collections import defaultdict
from pathlib import PurePosixPath
from xml.etree.ElementTree import ParseError

from defusedxml.ElementTree import fromstring
from defusedxml.common import DefusedXmlException

from catalog import PHOTOS
from media import VIDEOS, capture_time, fingerprint, regular_file

XMP = ".xmp"
CAMERA_AUX = {".thm", ".lrv"}
COMPANION_EXTENSIONS = CAMERA_AUX | {XMP}
MAX_XMP_BYTES = 1024 * 1024
NAMESPACES = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "exif": "http://ns.adobe.com/exif/1.0/",
    "photoshop": "http://ns.adobe.com/photoshop/1.0/",
    "iptc": "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
}
_FIELDS = {
    "title": ("dc", "title"), "description": ("dc", "description"),
    "keywords": ("dc", "subject"), "city": ("photoshop", "City"),
    "region": ("photoshop", "State"), "country": ("photoshop", "Country"),
    "location": ("iptc", "Location"), "latitude": ("exif", "GPSLatitude"),
    "longitude": ("exif", "GPSLongitude"),
}


def field_values(root, namespace, name):
    tag = f"{{{NAMESPACES[namespace]}}}{name}"
    values = []
    for node in root.iter():
        if node.get(tag):
            values.append(node.get(tag).strip())
        if node.tag == tag:
            values.extend(text.strip() for text in node.itertext() if text.strip())
    return list(dict.fromkeys(value for value in values if value))[:100]


def parse_xmp(contents):
    try:
        root = fromstring(contents)
    except (ParseError, DefusedXmlException, ValueError):
        return {"error": "XMP 메타데이터를 읽을 수 없습니다."}
    details = {}
    for label, (namespace, field) in _FIELDS.items():
        values = field_values(root, namespace, field)
        if values:
            details[label] = values if label == "keywords" else values[0]
    for namespace, field in (("photoshop", "DateCreated"), ("exif", "DateTimeOriginal")):
        values = field_values(root, namespace, field)
        if not values or len(values[0]) <= 10:
            continue
        stamp, verified = capture_time(values[0])
        if stamp:
            details["date"] = {
                "raw": values[0], "time": stamp, "verified": verified,
                "field": f"{namespace}:{field}",
            }
            break
    return details


def read_xmp(root, path, snapshot):
    with regular_file(root, path, expected=snapshot) as (stream, info):
        contents = stream.read(MAX_XMP_BYTES + 1)
        if len(contents) > MAX_XMP_BYTES:
            details = {"error": "XMP가 분석 크기 제한을 초과했습니다."}
            stream.seek(0)
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        else:
            details = parse_xmp(contents)
            digest = hashlib.sha256(contents).hexdigest()
    return {"path": path, "fingerprint": fingerprint(info), "sha": digest,
            "size": info.st_size, "metadata": details}


def source_key(path, *, include_folder=True):
    path = PurePosixPath(path)
    return (str(path.parent) if include_folder else "", path.stem.casefold())


def source_index(paths, *, include_folder=True):
    index = defaultdict(list)
    for path in paths:
        index[source_key(path, include_folder=include_folder)].append(path)
    return index


def source_candidates(sidecar, index, *, include_folder=True):
    path = PurePosixPath(sidecar)
    suffix = path.suffix.lower()
    folder, stem = source_key(sidecar, include_folder=include_folder)
    embedded = PurePosixPath(stem)
    if suffix == XMP and embedded.suffix.lower() in PHOTOS | VIDEOS:
        return [item for item in index[(folder, embedded.stem)] if PurePosixPath(item).name.casefold() == stem]
    found = index.get((folder, stem), [])
    if suffix in CAMERA_AUX and not found:
        # GoPro proxies use GL + the chapter and recording number of a GH/GX original.
        proxy = re.fullmatch(r"gl([a-z0-9]{2}[0-9]{4})", stem)
        if proxy:
            found = [
                item for prefix in ("gh", "gx")
                for item in index.get((folder, prefix + proxy[1]), [])
                if PurePosixPath(item).suffix.lower() == ".mp4"
            ]
    if suffix == ".lrv":
        return [item for item in found if PurePosixPath(item).suffix.lower() in VIDEOS]
    return found


def xmp_owner(candidates):
    stills = [path for path in candidates if PurePosixPath(path).suffix.lower() in PHOTOS]
    if len(stills) == 1:
        return stills[0]
    return candidates[0] if len(candidates) == 1 else None
