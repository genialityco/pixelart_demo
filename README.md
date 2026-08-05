# Pixel Person

Toma una foto de cuerpo completo por webcam, quita el fondo, la convierte en
un sprite pixel art, la recorta en piezas articuladas (torso, cabeza, brazos,
piernas) usando MediaPipe Pose, y te deja jugar con ese personaje en un
plataformas básico.

## Cómo funciona (resumen técnico)

1. **Frontend (JS)** captura una foto con `getUserMedia` y la envía al backend.
2. **Backend (Python/FastAPI)**:
   - Quita el fondo con `rembg` (modelo `u2net_human_seg`).
   - Detecta 33 puntos del cuerpo con `mediapipe.solutions.pose`.
   - Reduce resolución + cuantiza colores para lograr el look pixel art.
   - Corta el sprite en 9 piezas (torso, cabeza, brazo/antebrazo x2,
     pierna/pantorrilla x2) usando los landmarks como guía, y arma un
     esqueleto jerárquico (rig) con los puntos de articulación de cada pieza.
3. **Frontend** reconstruye el rig como una marioneta de recortes (`Puppet`
   en `js/puppet.js`) usando `Phaser.Container` anidados: rotar un contenedor
   rota todo lo que cuelga de él (brazo -> antebrazo, etc). Las animaciones de
   caminar/saltar/reposo son curvas de rotación predefinidas, no requieren IA.
4. `js/game.js` implementa un plataformas simple (gravedad, salto, 4
   plataformas) con física casera y usa el `Puppet` como personaje.

## Requisitos

- Python 3.10 u 11 (MediaPipe todavía no publica ruedas para 3.13 en Windows).
- Navegador con acceso a cámara (Chrome/Edge recomendado, requiere `localhost`
  o HTTPS para `getUserMedia`).

## Puesta en marcha

```bash
cd backend
python -m venv venv
./venv/Scripts/activate        # Windows
pip install -r requirements.txt
uvicorn app:app --reload --port 8001
```

Abre `http://127.0.0.1:8001/` en el navegador (el backend sirve también el
frontend, así no hay problemas de CORS ni de puertos distintos).

> Se usa el puerto 8001 porque el 8000 puede estar ocupado por otro proceso
> en tu máquina. Si ves un listado de archivos en vez de la app al abrir la
> URL, es que ese puerto lo está sirviendo otra cosa — revisa qué proceso lo
> tiene tomado (`Get-NetTCPConnection -LocalPort 8000` en PowerShell) o usa
> otro puerto libre con `--port`.

## Consejos para una buena foto

- De pie, de frente, cuerpo completo visible (cabeza a pies).
- Fondo lo más simple posible y buena luz, para que `rembg` recorte bien.
- Un poco de distancia a la cámara para que MediaPipe detecte los 33 puntos
  con confianza suficiente.

## Limitaciones conocidas (por diseño, para llegar rápido a un MVP)

- La animación es "cutout" (rotación de piezas recortadas de la foto), no
  dibujo cuadro a cuadro — es la técnica más rápida de implementar que se ve
  razonablemente bien.
- El volteo izquierda/derecha del personaje es un espejo simple del sprite
  frontal (no hay sprite de perfil).
- La colisión del juego es una implementación simple (rectángulos, aterrizaje
  solo por arriba), suficiente para una demo jugable.
