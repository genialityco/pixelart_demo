"""Elimina el fondo de una foto y devuelve un recorte RGBA de la persona."""
from io import BytesIO

from PIL import Image
from rembg import remove, new_session

_session = None


def _get_session():
    # Carga perezosa: la primera llamada descarga el modelo (~176 MB) desde
    # GitHub si no está en caché local (~/.u2net). Si esto falla no debe
    # tumbar el servidor entero al importar el módulo, solo esta función.
    global _session
    if _session is None:
        # u2net_human_seg está afinado para segmentar personas de cuerpo
        # completo, da bordes más limpios que el u2net genérico para esto.
        _session = new_session("u2net_human_seg")
    return _session


def remove_background(image_bytes: bytes) -> Image.Image:
    """Devuelve una imagen PIL en modo RGBA con el fondo transparente."""
    source = Image.open(BytesIO(image_bytes)).convert("RGB")
    cutout: Image.Image = remove(source, session=_get_session())
    return cutout.convert("RGBA")


def bounding_box(rgba: Image.Image, alpha_threshold: int = 10) -> tuple[int, int, int, int]:
    """Caja delimitadora del contenido no transparente (left, top, right, bottom)."""
    alpha = rgba.split()[-1]
    mask = alpha.point(lambda a: 255 if a > alpha_threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return (0, 0, rgba.width, rgba.height)
    return bbox
