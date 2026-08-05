"""API para Pixel Person: foto -> recorte sin fondo -> pixel art -> rig articulado."""
import pathlib
from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from vision.background import bounding_box, remove_background
from vision.pixelate import pixelate
from vision.pose import detect_landmarks
from vision.rig import build_rig

app = FastAPI(title="Pixel Person API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    pixel_art, transform = pixelate(cutout, bbox)
    transformed_landmarks = {name: transform.apply(pt) for name, pt in landmarks.items()}

    rig = build_rig(pixel_art, transformed_landmarks)
    if rig is None:
        raise HTTPException(status_code=422, detail="No se pudo construir el esqueleto del personaje.")

    return rig


# Sirve el frontend estático desde el mismo servidor para evitar problemas de CORS/puertos.
_FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
