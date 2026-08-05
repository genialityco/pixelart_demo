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
) -> tuple[Image.Image, PixelTransform]:
    """Reduce resolución + cuantiza paleta + reescala con vecino más cercano.

    Devuelve el sprite pixel art (RGBA) y el transform para remapear landmarks.
    """
    crop = cutout.crop(bbox)

    scale_small = small_height / crop.height
    small_w = max(1, round(crop.width * scale_small))
    small = crop.resize((small_w, small_height), Image.LANCZOS)

    r, g, b, a = small.split()
    alpha_hard = a.point(lambda v: 255 if v > alpha_cutoff else 0)

    # Rellenamos el área transparente con un color descartable para que no
    # contamine la paleta de cuantización con el color de fondo.
    rgb = Image.merge("RGB", (r, g, b))
    filler = Image.new("RGB", rgb.size, (255, 0, 255))
    composed = Image.composite(rgb, filler, alpha_hard)
    quantized = composed.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")

    small_rgba = Image.merge("RGBA", (*quantized.split(), alpha_hard))

    scale_total = display_height / crop.height
    display_w = max(1, round(crop.width * scale_total))
    pixel_art = small_rgba.resize((display_w, display_height), Image.NEAREST)

    transform = PixelTransform(crop_left=bbox[0], crop_top=bbox[1], scale=scale_total)
    return pixel_art, transform
