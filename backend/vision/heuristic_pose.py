"""Estimación aproximada de landmarks a partir de la silueta del recorte.

MediaPipe Pose está entrenado con fotos reales de personas: en imágenes ya
estilizadas (arte pixel, ilustraciones/avatares generados por IA, etc.) no
detecta nada. Como respaldo, este módulo estima puntos de articulación
razonables a partir de la SILUETA (el canal alfa del recorte sin fondo),
asumiendo una figura de pie, de frente, con los brazos hacia abajo -el caso
típico de un retrato/avatar de cuerpo entero. No reemplaza a MediaPipe: es
una aproximación bastante más burda, solo para poder animar este tipo de
imágenes en vez de rechazarlas.
"""
import numpy as np
from PIL import Image

Point = tuple[float, float]


def _row_extents(mask: np.ndarray) -> list[tuple[int, int] | None]:
    """Por fila, (col izquierda, col derecha) del contenido no transparente."""
    extents: list[tuple[int, int] | None] = []
    for row in mask:
        cols = np.nonzero(row)[0]
        extents.append((int(cols[0]), int(cols[-1])) if len(cols) else None)
    return extents


def estimate_landmarks(cutout: Image.Image, alpha_threshold: int = 10) -> dict[str, Point] | None:
    """Devuelve landmarks aproximados {nombre: (x, y)} en píxeles de `cutout`,
    o None si la silueta es demasiado chica/rara para estimar algo razonable.
    """
    alpha = np.array(cutout.split()[-1])
    mask = alpha > alpha_threshold

    rows_with_content = np.nonzero(mask.any(axis=1))[0]
    if len(rows_with_content) < 20:
        return None
    top, bottom = int(rows_with_content[0]), int(rows_with_content[-1])
    height = bottom - top
    if height < 40:
        return None

    extents = _row_extents(mask)

    def extent_at(y: int) -> tuple[int, int]:
        y = max(top, min(bottom, y))
        for dy in range(0, 8):
            for cand in (y + dy, y - dy):
                if top <= cand <= bottom and extents[cand] is not None:
                    return extents[cand]
        return (0, 0)

    # Busca la "línea de hombros": la primera fila -bajando desde arriba-
    # donde el ancho supera claramente el de la cabeza (angosta y estable).
    head_max_w = 0
    shoulder_y = None
    for y in range(top, bottom + 1):
        ext = extents[y]
        if ext is None:
            continue
        w = ext[1] - ext[0]
        if y - top < height * 0.25:
            head_max_w = max(head_max_w, w)
            continue
        if head_max_w > 0 and w > head_max_w * 1.35:
            shoulder_y = y
            break
    if shoulder_y is None:
        shoulder_y = top + int(height * 0.18)  # respaldo proporcional

    remaining = max(bottom - shoulder_y, 1)
    hip_y = shoulder_y + int(remaining * 0.40)
    elbow_y = shoulder_y + int(remaining * 0.28)
    wrist_y = shoulder_y + int(remaining * 0.50)
    knee_y = shoulder_y + int(remaining * 0.72)
    ankle_y = bottom - max(int(height * 0.03), 1)

    sh_l, sh_r = extent_at(shoulder_y)
    hip_l, hip_r = extent_at(hip_y)

    shoulder_w = max(sh_r - sh_l, 4)
    hip_cx = (hip_l + hip_r) / 2
    hip_w = max(hip_r - hip_l, 4)

    # Convención de MediaPipe: "left_*" es la izquierda ANATÓMICA de la
    # persona, que al estar de frente a la cámara queda del lado derecho de
    # la imagen (y viceversa).
    return {
        "left_shoulder": (sh_r - shoulder_w * 0.12, shoulder_y),
        "right_shoulder": (sh_l + shoulder_w * 0.12, shoulder_y),
        "left_elbow": (sh_r, elbow_y),
        "right_elbow": (sh_l, elbow_y),
        "left_wrist": (sh_r - shoulder_w * 0.05, wrist_y),
        "right_wrist": (sh_l + shoulder_w * 0.05, wrist_y),
        "left_hip": (hip_cx + hip_w * 0.22, hip_y),
        "right_hip": (hip_cx - hip_w * 0.22, hip_y),
        "left_knee": (hip_cx + hip_w * 0.22, knee_y),
        "right_knee": (hip_cx - hip_w * 0.22, knee_y),
        "left_ankle": (hip_cx + hip_w * 0.20, ankle_y),
        "right_ankle": (hip_cx - hip_w * 0.20, ankle_y),
    }
