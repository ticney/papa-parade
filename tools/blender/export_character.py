"""Exports a character from Blender to a .glb: its mesh, its skeleton and one clip per action.

Run headless:   blender -b assets-src/blender/characters/papa.blend -P tools/blender/export_character.py -- --out public/assets/characters/papa.glb

Not `export_level.py`: that one refuses a scene with no NAV_floor and pins skins and animations off
(story 7.2, T2). Each action is one clip under its own name; `ACTIONS` reads every action of the
file whose slot fits the armature, so an action needs a slot and a fake user, not to be assigned.
`export_optimize_animation_keep_anim_armature=False` drops a bone's constant track, so a bone the
code drives (`eyelids`) has none as long as no action keys it. Python 3 of Blender, no third-party module.
"""

import os
import sys

import bpy


def parse_args(argv):
    """Arguments after `--` (Blender keeps its own before it). Only `--out <path>`."""
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    if len(rest) != 2 or rest[0] != "--out":
        raise ValueError("usage: -- --out <file.glb>")
    return rest[1]


def export(path):
    if not any(obj.type == "ARMATURE" for obj in bpy.context.scene.objects):
        raise RuntimeError("no armature in the scene: this is not a character")
    if not bpy.data.actions:
        raise RuntimeError("no action in the file: the character would have no clip")
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        use_selection=False,
        use_visible=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_extras=False,
        export_vertex_color="NONE",
        export_morph=False,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
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
        sys.stderr.write("export_character.py: %s\n" % error)
        sys.exit(1)
    print("export_character.py: wrote %s (%d bytes)" % (path, size))


main()
