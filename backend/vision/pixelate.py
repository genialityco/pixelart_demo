"""Convierte un recorte RGBA en un sprite estilo pixel art."""
from PIL import Image


class PixelTransform:
    """Mapea coordenadas de la imagen original al espacio del sprite pixel art."""

    def __init__(self, crop_left: float, crop_top: float, scale: float):
        self.crop_left = crop_left
        self.crop_top = crop_top
        self.scale = scale

    def apply(self, point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return ((x - self.crop_left) * self.scale, (y - self.crop_top) * self.scale)


def pixelate(
    cutout: Image.Image,
    bbox: tuple[int, int, int, int],
    small_height: int = 110,
    display_height: int = 480,
    colors: int = 24,
    alpha_cutoff: int = 60,
    alpha_floor: int = 12,
    already_pixel_art: bool = False,
) -> tuple[Image.Image, PixelTransform]:
    """Reduce resolución + cuantiza paleta + reescala con vecino más cercano.

    Devuelve el sprite pixel art (RGBA) y el transform para remapear landmarks.
    """
    crop = cutout.crop(bbox)

    scale_total = display_height / crop.height
    display_w = max(1, round(crop.width * scale_total))
    transform = PixelTransform(crop_left=bbox[0], crop_top=bbox[1], scale=scale_total)

    if already_pixel_art:
        # La imagen ya es pixel art: no la volvemos a reducir/cuantizar (eso
        # le bajaría la calidad y podría correr colores que ya están bien).
        # Solo la reescalamos (NEAREST, sin difuminar los bordes) y limpiamos
        # el alpha casi-transparente.
        resized = crop.resize((display_w, display_height), Image.NEAREST)
        r, g, b, a = resized.split()
        alpha_final = a.point(lambda v: 0 if v < alpha_floor else v)
        pixel_art = Image.merge("RGBA", (r, g, b, alpha_final))
        return pixel_art, transform

    scale_small = small_height / crop.height
    small_w = max(1, round(crop.width * scale_small))
    # BOX es un promedio de área real. LANCZOS (usado antes) tiene "ringing":
    # al reducir una franja fina y opaca (p. ej. una pierna vista de perfil)
    # puede dejar su alpha en casi 0 aunque tenga cobertura real, borrándola
    # del sprite -aunque el recorte sin fondo, a resolución completa, se vea
    # bien-.
    small = crop.resize((small_w, small_height), Image.BOX)

    r, g, b, a = small.split()
    rgb = Image.merge("RGB", (r, g, b))

    # Umbral duro SOLO para excluir el fondo al construir la paleta de
    # colores (si no, la contamina). El color final de cada píxel es su
    # color real mapeado a esa paleta -no el relleno-, así que no quedan
    # franjas moradas en bordes o partes finas con alpha bajo.
    alpha_hard = a.point(lambda v: 255 if v > alpha_cutoff else 0)
    filler = Image.new("RGB", rgb.size, (255, 0, 255))
    composed = Image.composite(rgb, filler, alpha_hard)
    palette_source = composed.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    quantized = rgb.quantize(palette=palette_source, dither=Image.Dither.NONE).convert("RGB")

    # El alpha final conserva la cobertura real (solo se limpia el ruido
    # casi-transparente) para no perder partes finas que con el umbral duro
    # desaparecerían.
    alpha_final = a.point(lambda v: 0 if v < alpha_floor else v)
    small_rgba = Image.merge("RGBA", (*quantized.split(), alpha_final))

    pixel_art = small_rgba.resize((display_w, display_height), Image.NEAREST)
    return pixel_art, transform
