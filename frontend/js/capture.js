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

  let stream = null;
  let capturedBlob = null;

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1080 }, height: { ideal: 1440 }, facingMode: "user" },
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
    btnRetry.hidden = true;
    btnProcess.hidden = true;
    statusMsg.textContent = "";
  }

  function showPreview() {
    video.hidden = true;
    canvas.hidden = true;
    previewImg.hidden = false;
    btnCapture.hidden = true;
    btnRetry.hidden = false;
    btnProcess.hidden = false;
  }

  btnCapture.addEventListener("click", () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        capturedBlob = blob;
        previewImg.src = URL.createObjectURL(blob);
        showPreview();
      },
      "image/jpeg",
      0.92
    );
  });

  fileUpload.addEventListener("change", () => {
    const file = fileUpload.files[0];
    if (!file) return;
    capturedBlob = file;
    previewImg.src = URL.createObjectURL(file);
    showPreview();
  });

  btnRetry.addEventListener("click", () => {
    capturedBlob = null;
    fileUpload.value = "";
    showLiveView();
  });

  btnProcess.addEventListener("click", async () => {
    if (!capturedBlob) return;
    loadingOverlay.hidden = false;
    statusMsg.textContent = "";

    const formData = new FormData();
    formData.append("file", capturedBlob, capturedBlob.name || "photo.jpg");

    try {
      const res = await fetch("/api/process", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Error al procesar la imagen.");
      }
      captureScreen.hidden = true;
      gameScreen.hidden = false;
      window.PixelPersonGame.start(data);
    } catch (err) {
      statusMsg.textContent = err.message;
    } finally {
      loadingOverlay.hidden = true;
    }
  });

  document.getElementById("btnBackToCapture").addEventListener("click", () => {
    gameScreen.hidden = true;
    captureScreen.hidden = false;
    showLiveView();
  });

  startCamera();
})();
