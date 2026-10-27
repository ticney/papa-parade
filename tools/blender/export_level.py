"""Exports a level from Blender to a .glb, after checking the naming conventions.

Run headless:   blender -b assets-src/blender/salon_crawler.blend -P tools/blender/export_level.py -- --out public/assets/levels/salon_crawler.glb
Run via MCP:    exec(open("tools/blender/export_level.py").read())   (the blend is already open)

The rules below are written a second time in TypeScript (src/content/levelNodeNames.ts), which the
extractor uses. tests/architecture/blenderConventions.test.ts reads this file as text and fails when
the two differ: change both. Python 3 of Blender, no third-party module.
"""

import os
import re
import sys

import bpy

PREFIX_COL = "COL_"
PREFIX_NAV_FLOOR = "NAV_floor"
PREFIX_NAV_BLOCK = "NAV_block_"
PREFIX_ANCHOR = "ANCHOR_"
PREFIX_ZONE = "ZONE_"
PREFIX_PROP = "PROP_"
ZONE_KINDS = ("hidden", "safe", "creak")
REQUIRED_ANCHOR_IDS = (
    "papa_spawn",
    "baby_spawn",
    "outlet_01",
    "stairs_top",
    "coffee_table",
    "phone",
    "coffee_machine",
    "door",
)
REQUIRED_ZONE_IDS = ("behind_sofa",)

SNAKE_ID = re.compile(r"^[a-z][a-z0-9_]*$")
PROP_SHAPE = re.compile(r"^PROP_([a-z][a-z0-9_]*)_(\d{2})$")
# A name that looks like a gameplay node must be one: "col_sofa" or "ANCHORS_x" is a mistake.
RESERVED_LOOKING = re.compile(r"^(?:col|nav|anchors?|props?|zones?)(?![a-z0-9])", re.IGNORECASE)

DEFAULT_OUT = "public/assets/levels/salon_crawler.glb"


def classify(name):
    """Returns (kind, id, error). `error` is None when the name is fine."""
    if name == PREFIX_NAV_FLOOR:
        return "navFloor", "floor", None

    def prefixed(prefix, kind):
        rest = name[len(prefix):]
        if not SNAKE_ID.match(rest):
            return None, None, '"%s": after "%s" the name must be lower_snake_case' % (name, prefix)
        return kind, rest, None

    if name.startswith(PREFIX_COL):
        return prefixed(PREFIX_COL, "col")
    if name.startswith(PREFIX_NAV_BLOCK):
        return prefixed(PREFIX_NAV_BLOCK, "navBlock")
    if name.startswith(PREFIX_ANCHOR):
        return prefixed(PREFIX_ANCHOR, "anchor")
    if name.startswith(PREFIX_ZONE):
        match = re.match(r"^ZONE_([a-z]+)_(.+)$", name)
        if not match or match.group(1) not in ZONE_KINDS:
            return None, None, '"%s": a zone is ZONE_<%s>_<name>' % (name, "|".join(ZONE_KINDS))
        if not SNAKE_ID.match(match.group(2)):
            return None, None, '"%s": the zone name must be lower_snake_case' % name
        return "zone", match.group(2), None
    if name.startswith(PREFIX_PROP):
        match = PROP_SHAPE.match(name)
        if not match:
            return None, None, '"%s": a prop is PROP_<kind>_<nn> (two-digit index)' % name
        return "prop", match.group(1) + "_" + match.group(2), None
    if name == "NAV" or name.startswith("NAV_"):
        return None, None, '"%s": a navigation node is NAV_floor or NAV_block_<name>' % name
    if RESERVED_LOOKING.match(name):
        return None, None, (
            '"%s": looks like a gameplay node but breaks the shape '
            "(COL_, NAV_floor, NAV_block_, ANCHOR_, ZONE_, PROP_ in capitals)" % name
        )
    if not SNAKE_ID.match(name):
        return None, None, '"%s": a visual node is lower_snake_case (no capitals, spaces or ".001")' % name
    return "visual", name, None


def check_scene(objects):
    """Every problem found in the names of `objects`, one string each (empty list: all good)."""
    problems = []
    seen = {}
    floors = 0
    for obj in objects:
        kind, ident, error = classify(obj.name)
        if error:
            problems.append(error)
            continue
        if kind == "navFloor":
            floors += 1
        elif kind != "visual":
            key = (kind, ident)
            if key in seen:
                problems.append('"%s": duplicate id "%s" (already used by "%s")' % (obj.name, ident, seen[key]))
            seen[key] = obj.name
        if kind in ("col", "navFloor", "navBlock", "zone", "prop") and obj.type != "MESH":
            problems.append('"%s": a %s node must be a mesh (a box)' % (obj.name, kind))
        if kind == "anchor" and obj.type != "EMPTY":
            problems.append('"%s": an anchor must be an empty' % obj.name)
    if floors != 1:
        problems.append("expected exactly one NAV_floor, found %d" % floors)
    anchors = set(i for (k, i) in seen if k == "anchor")
    for required in REQUIRED_ANCHOR_IDS:
        if required not in anchors:
            problems.append('missing the required anchor "%s%s"' % (PREFIX_ANCHOR, required))
    zones = set(i for (k, i) in seen if k == "zone")
    for required in REQUIRED_ZONE_IDS:
        if required not in zones:
            problems.append('missing the required zone "ZONE_<kind>_%s"' % required)
    return problems


def parse_args(argv):
    """Arguments after `--` (Blender keeps its own before it). Only `--out <path>`."""
    out = None
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    i = 0
    while i < len(rest):
        if rest[i] == "--out" and i + 1 < len(rest):
            out = rest[i + 1]
            i += 2
        else:
            raise ValueError("unknown argument %r (usage: -- --out <file.glb>)" % rest[i])
    return out


def repo_root():
    blend = bpy.data.filepath
    if blend:
        return os.path.abspath(os.path.join(os.path.dirname(blend), "..", ".."))
    return os.getcwd()


def export(out):
    problems = check_scene(list(bpy.context.scene.objects))
    if problems:
        raise RuntimeError("level export refused:\n  - " + "\n  - ".join(problems))
    path = out if out else os.path.join(repo_root(), DEFAULT_OUT)
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=False,
        use_visible=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )
    # The operator reports a failure by returning CANCELLED, not always by raising; a stale .glb
    # left on disk would then pass for a fresh one.
    if result != {"FINISHED"}:
        raise RuntimeError("the glTF exporter did not finish (it returned %s)" % sorted(result))
    if not os.path.isfile(path):
        raise RuntimeError("the glTF exporter wrote nothing at %s" % path)
    return path


def main():
    try:
        path = export(parse_args(sys.argv))
        size = os.path.getsize(path)
    except Exception as error:  # noqa: BLE001 - the message is the product
        if bpy.app.background:
            sys.stderr.write("export_level.py: %s\n" % error)
            sys.exit(1)
        raise
    print("export_level.py: wrote %s (%d bytes)" % (path, size))


main()
