// Captura de cámara web y envío de la foto al backend para generar el rig.
(() => {
  const video = document.getElementById("webcam");
  const canvas = document.getElementById("captureCanvas");
  const previewImg = document.getElementById("previewImg");

  const btnCapture = document.getElementById("btnCapture");
  const fileUpload = document.getElementById("fileUpload");
  const btnRetry = document.getElementById("btnRetry");
  const btnProcess = document.getElementById("btnProcess");
  const statusMsg = document.getElementById("statusMsg");
  const loadingOverlay = document.getElementById("loadingOverlay");

  const captureScreen = document.getElementById("capture-screen");
  const gameScreen = document.getElementById("game-screen");

  const noBgWrap = document.getElementById("noBgWrap");
  const noBgStatus = document.getElementById("noBgStatus");
  const noBgPreviewImg = document.getElementById("noBgPreviewImg");

  const isPixelArtCheckbox = document.getElementById("isPixelArt");
  const invertFacingCheckbox = document.getElementById("invertFacing");

  const countdownEl = document.getElementById("captureCountdown");

  let stream = null;
  let capturedBlob = null;
  let showBgPreview = false;
  let characterScale = 1.0;
  let controlMode = "keyboard";
  let cameraOrientation = "vertical";

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      showBgPreview = !!data.showBgPreview;
      if (data.characterScale) characterScale = data.characterScale;
      if (data.controlMode) controlMode = data.controlMode;
      if (data.cameraOrientation) cameraOrientation = data.cameraOrientation;
    } catch (err) {
      showBgPreview = false;
    }
  }

  function applyCameraOrientation() {
    document.body.classList.toggle("camera-horizontal", cameraOrientation === "horizontal");
  }

  function hideNoBgPreview() {
    noBgWrap.hidden = true;
    noBgPreviewImg.hidden = true;
    noBgPreviewImg.src = "";
    noBgStatus.textContent = "";
  }

  async function updateNoBgPreview(blob) {
    if (!showBgPreview) return;
    noBgWrap.hidden = false;
    noBgPreviewImg.hidden = true;
    noBgStatus.textContent = "Quitando fondo…";

    const formData = new FormData();
    formData.append("file", blob, blob.name || "photo.jpg");

    try {
      const res = await fetch("/api/preview", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "No se pudo generar la vista previa.");
      noBgPreviewImg.src = data.image;
      noBgPreviewImg.hidden = false;
      noBgStatus.textContent = "";
    } catch (err) {
      noBgStatus.textContent = err.message;
    }
  }

  async function startCamera() {
    try {
      // La cámara se trata como horizontal (se rota 90° por software al
      // capturar/mostrar), así que "1080p" es 1920x1080. `ideal` le pide al
      // navegador acercarse lo más posible a esa resolución si la cámara no
      // la tiene nativa, sin hacer fallar el acceso si no la soporta.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
    } catch (err) {
      statusMsg.textContent = "No se pudo acceder a la cámara: " + err.message;
    }
  }

  function showLiveView() {
    video.hidden = false;
    canvas.hidden = true;
    previewImg.hidden = true;
    btnCapture.hidden = false;
    btnCapture.disabled = false;
    btnRetry.hidden = true;
    btnProcess.hidden = true;
    statusMsg.textContent = "";
  }

  // Cuenta regresiva sobre la vista de la cámara antes de capturar, para
  // dar tiempo a acomodarse en cuadro.
  function runCountdown(seconds) {
    return new Promise((resolve) => {
      let remaining = seconds;
      countdownEl.hidden = false;

      function tick() {
        if (remaining <= 0) {
          countdownEl.hidden = true;
          resolve();
          return;
        }
        countdownEl.textContent = String(remaining);
        // Reinicia la animación de "pulso" en cada número.
        countdownEl.style.animation = "none";
        void countdownEl.offsetWidth;
        countdownEl.style.animation = "";
        remaining -= 1;
        setTimeout(tick, 1000);
      }
      tick();
    });
  }

  function showPreview() {
    video.hidden = true;
    canvas.hidden = true;
    previewImg.hidden = false;
    btnCapture.hidden = true;
    btnRetry.hidden = false;
    btnProcess.hidden = false;
  }

  function capturePhoto() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (cameraOrientation === "horizontal") {
      // La cámara se usa tal cual la entrega el hardware, sin rotar.
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      // La cámara entrega el video en horizontal; la giramos 90° (igual que
      // la vista previa en CSS, #mp-webcam y el canvas para MediaPipe en
      // game.js) para que la foto capturada salga vertical.
      canvas.width = h;
      canvas.height = w;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(video, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    canvas.toBlob(
      (blob) => {
        capturedBlob = blob;
        previewImg.src = URL.createObjectURL(blob);
        showPreview();
        updateNoBgPreview(blob);
      },
      "image/jpeg",
      0.92
    );
  }

  btnCapture.addEventListener("click", async () => {
    btnCapture.disabled = true;
    await runCountdown(3);
    capturePhoto();
  });

  fileUpload.addEventListener("change", () => {
    const file = fileUpload.files[0];
    if (!file) return;
    capturedBlob = file;
    previewImg.src = URL.createObjectURL(file);
    showPreview();
    updateNoBgPreview(file);
  });

  btnRetry.addEventListener("click", () => {
    capturedBlob = null;
    fileUpload.value = "";
    hideNoBgPreview();
    showLiveView();
  });

  btnProcess.addEventListener("click", async () => {
    if (!capturedBlob) return;
    loadingOverlay.hidden = false;
    statusMsg.textContent = "";

    const formData = new FormData();
    formData.append("file", capturedBlob, capturedBlob.name || "photo.jpg");
    formData.append("is_pixel_art", isPixelArtCheckbox.checked ? "true" : "false");

    try {
      const res = await fetch("/api/process", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Error al procesar la imagen.");
      }
      captureScreen.hidden = true;
      gameScreen.hidden = false;
      
      // Request fullscreen for the game
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn("Fullscreen API is not supported or permission denied", err);
        });
      }

      window.PixelPersonGame.start(data, characterScale, controlMode, cameraOrientation, invertFacingCheckbox.checked);
    } catch (err) {
      statusMsg.textContent = err.message;
    } finally {
      loadingOverlay.hidden = true;
    }
  });

  document.getElementById("btnBackToCapture").addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => console.warn(err));
    }
    if (window.PixelPersonGame.stopMediaPipe) {
      window.PixelPersonGame.stopMediaPipe();
    }
    gameScreen.hidden = true;
    captureScreen.hidden = false;
    capturedBlob = null;
    fileUpload.value = "";
    hideNoBgPreview();
    showLiveView();
  });

  loadConfig().then(() => {
    applyCameraOrientation();
    startCamera();
  });
})();
