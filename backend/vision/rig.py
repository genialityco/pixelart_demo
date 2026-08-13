"""Corta el sprite pixel art en piezas (torso, brazos, piernas, cabeza) usando
los landmarks de MediaPipe y arma un esqueleto jerárquico para animar la
figura como un muñeco de recortes (cutout / paper-doll animation).
"""
import base64
import math
from io import BytesIO
from typing import Optional

from PIL import Image, ImageChops, ImageDraw

Point = tuple[float, float]

# child_name -> (nombre del landmark que sirve de pivote, parte padre)
_JOINTS: dict[str, tuple[str, str]] = {
    "head": ("neck", "torso"),
    "left_upper_arm": ("left_shoulder", "torso"),
    "right_upper_arm": ("right_shoulder", "torso"),
    "left_lower_arm": ("left_elbow", "left_upper_arm"),
    "right_lower_arm": ("right_elbow", "right_upper_arm"),
    "left_upper_leg": ("left_hip", "torso"),
    "right_upper_leg": ("right_hip", "torso"),
    "left_lower_leg": ("left_knee", "left_upper_leg"),
    "right_lower_leg": ("right_knee", "right_upper_leg"),
}


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _mid(a: Point, b: Point) -> Point:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _expand_quad(points: list[Point], out_scale: float) -> list[Point]:
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    return [(cx + (p[0] - cx) * out_scale, cy + (p[1] - cy) * out_scale) for p in points]


def _capsule_polygon(a: Point, b: Point, half_width: float, extend_start: float = 0.0, extend_end: float = 0.0) -> list[Point]:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1e-6
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    a2 = (a[0] - ux * extend_start, a[1] - uy * extend_start)
    b2 = (b[0] + ux * extend_end, b[1] + uy * extend_end)
    return [
        (a2[0] + px * half_width, a2[1] + py * half_width),
        (b2[0] + px * half_width, b2[1] + py * half_width),
        (b2[0] - px * half_width, b2[1] - py * half_width),
        (a2[0] - px * half_width, a2[1] - py * half_width),
    ]


def _cut_part(pixel_art: Image.Image, shapes: list[list[Point]], padding: int = 2):
    """`shapes` es una lista de polígonos: se unen (OR) en una sola máscara,
    para poder cubrir formas que un solo polígono convexo no puede (p. ej.
    pantorrilla + pie, que no son colineales)."""
    mask = Image.new("L", pixel_art.size, 0)
    draw = ImageDraw.Draw(mask)
    for shape in shapes:
        draw.polygon(shape, fill=255)
    alpha = pixel_art.split()[-1]
    combined = ImageChops.multiply(mask, alpha)
    bbox = combined.getbbox()
    if bbox is None:
        return None
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(pixel_art.width, bbox[2] + padding)
    bottom = min(pixel_art.height, bbox[3] + padding)
    bbox = (left, top, right, bottom)

    r, g, b, _ = pixel_art.split()
    part_rgba = Image.merge("RGBA", (r, g, b, combined))
    cropped = part_rgba.crop(bbox)
    return cropped, bbox


def _to_data_url(img: Image.Image) -> str:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_rig(pixel_art: Image.Image, lm: dict[str, Point]) -> Optional[dict]:
    """Devuelve {"root": "torso", "parts": [...], "meta": {...}} o None si no
    hay suficientes landmarks para armar un esqueleto razonable."""

    required = [
        "left_shoulder", "right_shoulder", "left_hip", "right_hip",
        "left_elbow", "right_elbow", "left_wrist", "right_wrist",
        "left_knee", "right_knee", "left_ankle", "right_ankle",
    ]
    if any(k not in lm for k in required):
        return None

    neck = _mid(lm["left_shoulder"], lm["right_shoulder"])
    pelvis = _mid(lm["left_hip"], lm["right_hip"])
    shoulder_w = _dist(lm["left_shoulder"], lm["right_shoulder"])
    hip_w = _dist(lm["left_hip"], lm["right_hip"])

    arm_hw = max(4.0, shoulder_w * 0.16)
    leg_hw = max(6.0, hip_w * 0.34)
    head_hw = max(6.0, shoulder_w * 0.7)

    landmarks = dict(lm)
    landmarks["neck"] = neck
    landmarks["pelvis"] = pelvis

    specs: list[tuple[str, Optional[str], list[list[Point]]]] = []

    specs.append((
        "torso", None,
        [_expand_quad(
            [lm["left_shoulder"], lm["right_shoulder"], lm["right_hip"], lm["left_hip"]],
            out_scale=1.22,
        )],
    ))

    specs.append((
        "head", "torso",
        [[
            (neck[0] - head_hw, 0),
            (neck[0] + head_hw, 0),
            (neck[0] + head_hw, neck[1] + shoulder_w * 0.12),
            (neck[0] - head_hw, neck[1] + shoulder_w * 0.12),
        ]],
    ))

    feet_ys = []
    for side in ("left", "right"):
        sh, el, wr = lm[f"{side}_shoulder"], lm[f"{side}_elbow"], lm[f"{side}_wrist"]
        specs.append((f"{side}_upper_arm", "torso",
                       [_capsule_polygon(sh, el, arm_hw, extend_start=arm_hw * 0.6, extend_end=arm_hw * 0.3)]))
        specs.append((f"{side}_lower_arm", f"{side}_upper_arm",
                       [_capsule_polygon(el, wr, arm_hw * 0.85, extend_start=arm_hw * 0.3, extend_end=arm_hw * 1.3)]))

        hip, knee, ankle = lm[f"{side}_hip"], lm[f"{side}_knee"], lm[f"{side}_ankle"]
        toe = lm.get(f"{side}_foot_index", ankle)
        heel = lm.get(f"{side}_heel", ankle)
        specs.append((f"{side}_upper_leg", "torso",
                       [_capsule_polygon(hip, knee, leg_hw, extend_start=leg_hw * 0.6, extend_end=leg_hw * 0.3)]))
        # La pantorrilla (rodilla->tobillo) y el pie (talón->punta) casi
        # nunca están alineados: una sola cápsula recta rodilla->punta deja
        # el talón (que sobresale hacia atrás, no hacia la punta) fuera del
        # polígono y se recorta. Se usan dos formas separadas y se unen.
        calf = _capsule_polygon(knee, ankle, leg_hw, extend_start=leg_hw * 0.3, extend_end=leg_hw * 0.3)
        foot = _capsule_polygon(heel, toe, leg_hw * 1.2, extend_start=leg_hw * 0.7, extend_end=leg_hw * 0.7)
        specs.append((f"{side}_lower_leg", f"{side}_upper_leg", [calf, foot]))
        feet_ys.extend([ankle[1], heel[1], toe[1]])

    bboxes: dict[str, tuple[int, int, int, int]] = {}
    parts: dict[str, dict] = {}

    for name, parent, poly in specs:
        cut = _cut_part(pixel_art, poly)
        if cut is None:
            continue
        cropped, bbox = cut
        bboxes[name] = bbox
        pivot = None
        if name in _JOINTS:
            joint_name, _parent = _JOINTS[name]
            world = landmarks[joint_name]
            pivot = (world[0] - bbox[0], world[1] - bbox[1])
        parts[name] = {
            "name": name,
            "parent": parent,
            "image": _to_data_url(cropped),
            "w": cropped.width,
            "h": cropped.height,
            "pivot": pivot,
            "attach": {},
        }

    if "torso" not in parts:
        return None

    for child_name, (joint_name, parent_name) in _JOINTS.items():
        if child_name not in parts or parent_name not in parts:
            continue
        world = landmarks[joint_name]
        pbbox = bboxes[parent_name]
        parts[parent_name]["attach"][child_name] = (world[0] - pbbox[0], world[1] - pbbox[1])

    torso_bbox = bboxes["torso"]
    parts["torso"]["rootOrigin"] = (pelvis[0] - torso_bbox[0], pelvis[1] - torso_bbox[1])

    foot_offset_y = max(feet_ys) - pelvis[1] if feet_ys else 0.0

    return {
        "root": "torso",
        "parts": list(parts.values()),
        "meta": {
            "footOffsetY": foot_offset_y,
            "spriteWidth": pixel_art.width,
            "spriteHeight": pixel_art.height,
        },
    }
