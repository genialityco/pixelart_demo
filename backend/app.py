"""API para Pixel Person: foto -> recorte sin fondo -> pixel art -> rig articulado."""
import base64
import os
import pathlib
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from vision.background import bounding_box, remove_background
from vision.pixelate import pixelate
from vision.pose import detect_landmarks
from vision.rig import build_rig

load_dotenv()

# Controla si el frontend muestra una vista previa del recorte sin fondo
# junto a la foto capturada. Desactivable vía .env (SHOW_BG_PREVIEW=false).
SHOW_BG_PREVIEW = os.environ.get("SHOW_BG_PREVIEW", "true").strip().lower() not in ("0", "false", "no")
CHARACTER_SCALE = float(os.environ.get("CHARACTER_SCALE", "1.0"))

app = FastAPI(title="Pixel Person API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/config")
async def get_config():
    return {
        "showBgPreview": SHOW_BG_PREVIEW,
        "characterScale": CHARACTER_SCALE
    }


@app.post("/api/preview")
async def preview_background_removal(file: UploadFile = File(...)):
    if not SHOW_BG_PREVIEW:
        raise HTTPException(status_code=404, detail="Vista previa deshabilitada.")

    raw = await file.read()
    try:
        cutout = remove_background(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "No se pudo quitar el fondo (el modelo de rembg no se pudo cargar o "
                f"descargar). Revisa la conexión a internet. Detalle: {exc}"
            ),
        )

    buf = BytesIO()
    cutout.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"image": f"data:image/png;base64,{encoded}"}


@app.post("/api/process")
async def process_photo(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        source = Image.open(BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Imagen inválida.")

    # La detección de pose funciona mejor con el fondo original todavía presente.
    landmarks = detect_landmarks(source)
    if landmarks is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "No se detectó una persona de cuerpo completo y de frente. "
                "Aléjate de la cámara para que se vea de pies a cabeza e inténtalo de nuevo."
            ),
        )

    try:
        cutout = remove_background(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "No se pudo quitar el fondo (el modelo de rembg no se pudo cargar o "
                f"descargar). Revisa la conexión a internet. Detalle: {exc}"
            ),
        )
    bbox = bounding_box(cutout)
    
    # Aplicar la escala configurada en .env al tamaño final del personaje (por defecto 480px de alto)
    target_height = int(480 * CHARACTER_SCALE)
    pixel_art, transform = pixelate(cutout, bbox, display_height=target_height)
    
    transformed_landmarks = {name: transform.apply(pt) for name, pt in landmarks.items()}

    rig = build_rig(pixel_art, transformed_landmarks)
    if rig is None:
        raise HTTPException(status_code=422, detail="No se pudo construir el esqueleto del personaje.")

    return rig


# Sirve el frontend estático desde el mismo servidor para evitar problemas de CORS/puertos.
_FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
