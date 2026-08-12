"""Elimina el fondo de una foto y devuelve un recorte RGBA de la persona."""
from io import BytesIO

import numpy as np
from PIL import Image
from rembg import remove, new_session

_sessions: dict[str, object] = {}

# Fracción mínima de píxeles opacos que debe tener el recorte para
# considerar que el modelo realmente encontró algo (no ruido disperso).
_MIN_COVERAGE = 0.02


def _get_session(model_name: str):
    # Carga perezosa: la primera llamada descarga el modelo (~176 MB para
    # u2net_human_seg, ~176 MB para u2net) desde GitHub si no está en caché
    # local (~/.u2net). Si esto falla no debe tumbar el servidor entero al
    # importar el módulo, solo esta función.
    if model_name not in _sessions:
        _sessions[model_name] = new_session(model_name)
    return _sessions[model_name]


def _coverage(rgba: Image.Image) -> float:
    alpha = np.array(rgba.split()[-1])
    return float((alpha > 10).mean())


def remove_background(image_bytes: bytes) -> Image.Image:
    """Devuelve una imagen PIL en modo RGBA con el fondo transparente."""
    source = Image.open(BytesIO(image_bytes)).convert("RGB")

    # u2net_human_seg está afinado para fotos reales de personas, da bordes
    # más limpios que el u2net genérico para ese caso. Pero está entrenado
    # solo con fotos: en imágenes ya estilizadas (arte pixel, ilustraciones
    # generadas por IA, etc.) puede no reconocer nada y devolver un recorte
    # casi vacío. Si pasa eso, reintentamos con u2net (genérico), que
    # generaliza mejor a estilos no fotográficos.
    cutout: Image.Image = remove(source, session=_get_session("u2net_human_seg")).convert("RGBA")
    if _coverage(cutout) < _MIN_COVERAGE:
        cutout = remove(source, session=_get_session("u2net")).convert("RGBA")

    return cutout


def bounding_box(rgba: Image.Image, alpha_threshold: int = 10) -> tuple[int, int, int, int]:
    """Caja delimitadora del contenido no transparente (left, top, right, bottom)."""
    alpha = rgba.split()[-1]
    mask = alpha.point(lambda a: 255 if a > alpha_threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return (0, 0, rgba.width, rgba.height)
    return bbox
