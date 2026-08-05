// Juego de plataformas básico que usa el Puppet articulado como personaje jugable
// y el escenario (tilemaps) del proyecto Dump-Land-Game.

window.PixelPersonGame = (() => {
  let game = null;
  let sceneRef = null;
  let pendingRig = null;
  let activeControlMode = "keyboard";

  let mpPose = null;
  let mpLoop = false;
  let mpState = {
    wantsJump: false,
    moving: false,
    facing: 1,
    hipBaseY: 0,
    wristPrevY: [0, 0],
    wristPrevVisible: [false, false],
    moveEnergy: 0, // Inercia para no parar de correr de golpe
    shoulderZDiff: 0 // Suavizado de la diferencia de profundidad de hombros
  };

  function initMediaPipe() {
    if (mpPose) return;
    
    // Usar directamente el video que capturo webcam al principio (garantizado de tener el stream funcionando)
    const mainVideo = document.getElementById('webcam');
    
    document.getElementById('mp-camera-wrap').hidden = false;
    
    // Mostramos la miniatura del video
    const videoElement = document.getElementById('mp-webcam');
    videoElement.srcObject = mainVideo.srcObject;
    videoElement.play().catch(e => console.warn(e));

    // Canvas oculto (no se agrega al DOM) solo para rotar 90° el frame antes
    // de pasárselo a MediaPipe: la cámara entrega video horizontal, pero se
    // usa en vertical (igual que la foto de captura). Si a MediaPipe se le
    // manda el frame sin rotar, ve a la persona acostada de lado y el
    // salto/dirección se calculan mal.
    const rotatedCanvas = document.createElement('canvas');
    const rotatedCtx = rotatedCanvas.getContext('2d');

    mpPose = new Pose({locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
    }});
    
    mpPose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    mpPose.onResults((results) => {
      if (!results.poseLandmarks) {
        mpState.moving = false;
        return;
      }
      
      const lm = results.poseLandmarks;
      
      // 1. Detección de Salto (Hombros en vez de caderas, para que funcione de cerca)
      const shoulderY = (lm[11].y + lm[12].y) / 2;
      if (mpState.hipBaseY === 0) {
        mpState.hipBaseY = shoulderY; // inicializar
      } else {
        // Seguimos adaptando la base siempre, solo que mucho más lento
        // mientras "está saltando". Si se congelara del todo (como antes),
        // un falso positivo inicial la deja pegada a un valor malo para
        // siempre y el salto queda repitiéndose sin que la persona se mueva.
        const adaptRate = mpState.wantsJump ? 0.002 : 0.02;
        mpState.hipBaseY = mpState.hipBaseY * (1 - adaptRate) + shoulderY * adaptRate;
      }

      // Umbral para activar/soltar, con margen de histéresis entre ambos
      // para que no titubee. 0.13 pedía un salto exagerado; se bajó a 0.08.
      if (shoulderY < mpState.hipBaseY - 0.08) {
        mpState.wantsJump = true;
      } else if (shoulderY > mpState.hipBaseY - 0.04) {
        mpState.wantsJump = false; // Histéresis: bajar lo suficiente para terminar salto
      }

      // 2. Detección de Movimiento (Carrera con brazos)
      // Usamos la MUÑECA (no el codo): al bombear los brazos se mueve mucho
      // más que el codo, y así se distingue mejor de un simple giro de
      // torso. Solo sumamos energía si la muñeca fue visible en este frame
      // Y en el anterior -si no, un salto de "no visible" a "visible" (que
      // pasa justo al girarte) se leería como un movimiento brusco falso.
      const leftWrist = lm[15];
      const rightWrist = lm[16];
      const leftWristVisible = leftWrist.visibility > 0.5;
      const rightWristVisible = rightWrist.visibility > 0.5;

      const leftDeltaY = (leftWristVisible && mpState.wristPrevVisible[0]) ? (leftWrist.y - mpState.wristPrevY[0]) : 0;
      const rightDeltaY = (rightWristVisible && mpState.wristPrevVisible[1]) ? (rightWrist.y - mpState.wristPrevY[1]) : 0;

      // El braceo de correr es alterno (un brazo sube mientras el otro
      // baja). Si ambos se mueven JUNTOS en la misma dirección -como al
      // levantar los brazos para saltar- no cuenta como "correr", para no
      // mezclar el salto con un empujón lateral no deseado.
      let currentEnergy = 0;
      if (leftDeltaY * rightDeltaY < 0) {
        currentEnergy = Math.abs(leftDeltaY) + Math.abs(rightDeltaY);
      }
      mpState.wristPrevY = [leftWrist.y, rightWrist.y];
      mpState.wristPrevVisible = [leftWristVisible, rightWristVisible];

      // Sumar energía de movimiento y aplicar fricción (inercia)
      mpState.moveEnergy = (mpState.moveEnergy * 0.85) + currentEnergy;

      // Histéresis: exige más energía para empezar a correr que para parar,
      // así no titubea alrededor del umbral.
      if (mpState.moveEnergy > 0.12) {
        mpState.moving = true;
      } else if (mpState.moveEnergy < 0.05) {
        mpState.moving = false;
      }

      // 3. Dirección (Perfil de los hombros), suavizada para que un giro
      // leve/momentáneo no cambie la dirección de inmediato.
      // Hay tres estados: -1/1 (girado a un lado) y 0 (de frente a la
      // cámara). Sin el 0, un salto de frente heredaba la última dirección
      // lateral detectada y el salto se iba hacia un lado en vez de subir
      // recto. Entre las zonas de "girado" y "de frente" queda un margen de
      // histéresis donde se conserva el último valor, para no titubear.
      const shoulderZDiff = lm[11].z - lm[12].z;
      mpState.shoulderZDiff = mpState.shoulderZDiff * 0.8 + shoulderZDiff * 0.2;

      if (mpState.shoulderZDiff > 0.09) {
        // Hombro derecho más cerca = el usuario giró hacia su izquierda
        mpState.facing = -1;
      } else if (mpState.shoulderZDiff < -0.09) {
        // Hombro izquierdo más cerca = el usuario giró hacia su derecha
        mpState.facing = 1;
      } else if (Math.abs(mpState.shoulderZDiff) < 0.035) {
        // Hombros a la misma profundidad = de frente a la cámara
        mpState.facing = 0;
      }

      // -- DIBUJO DE DEBUG --
      const canvasElement = document.getElementById('mp-canvas');
      const canvasCtx = canvasElement.getContext('2d');
      // El canvas de debug debe tener las mismas dimensiones que el frame
      // ROTADO que se le mandó a MediaPipe (no las del video crudo), para
      // que el esqueleto calce con la vista previa vertical.
      if (canvasElement.width !== rotatedCanvas.width || canvasElement.height !== rotatedCanvas.height) {
        canvasElement.width = rotatedCanvas.width;
        canvasElement.height = rotatedCanvas.height;
      }

      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      if (window.drawConnectors && window.drawLandmarks) {
        window.drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 3});
        window.drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
      }

      const debugDiv = document.getElementById('mp-debug');
      const jumpDiff = (mpState.hipBaseY - shoulderY).toFixed(3);
      const energyStr = mpState.moveEnergy.toFixed(3);
      const shoulderDiff = mpState.shoulderZDiff.toFixed(3);

      debugDiv.innerHTML = `
        CORRER: ${mpState.moving ? '✅' : '❌'} (E:${energyStr})<br>
        SALTO: ${mpState.wantsJump ? '✅' : '❌'} (Dif:${jumpDiff})<br>
        DIR: ${mpState.facing === 1 ? '➡' : '⬅'} (DifZ:${shoulderDiff})
      `;
    });

    mpLoop = true;
    let isProcessing = false;
    // La variable videoElement ya fue declarada arriba en initMediaPipe
    
    async function processVideo() {
      if (!mpLoop) return;

      if (videoElement.readyState >= 2 && videoElement.videoWidth > 0 && !isProcessing) {
        isProcessing = true;

        const vw = videoElement.videoWidth;
        const vh = videoElement.videoHeight;

        // Rota el frame 90° (ancho/alto intercambiados) antes de mandarlo a
        // MediaPipe, mismo sentido que capture.js, style.css (#webcam) e
        // index.html (#mp-webcam).
        if (rotatedCanvas.width !== vh || rotatedCanvas.height !== vw) {
          rotatedCanvas.width = vh;
          rotatedCanvas.height = vw;
        }
        rotatedCtx.save();
        rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
        rotatedCtx.rotate(-Math.PI / 2);
        rotatedCtx.drawImage(videoElement, -vw / 2, -vh / 2, vw, vh);
        rotatedCtx.restore();

        try {
          await mpPose.send({image: rotatedCanvas});
        } catch (e) {
          console.warn("Pose Error:", e);
        }
        isProcessing = false;
      }
      requestAnimationFrame(processVideo);
    }
    
    mpPose.initialize().then(() => {
      processVideo();
    });
  }

  function stopMediaPipe() {
    mpLoop = false;
    document.getElementById('mp-camera-wrap').hidden = true;
    
    const videoElement = document.getElementById('mp-webcam');
    if (videoElement) {
      videoElement.srcObject = null;
    }
    
    if (mpPose) {
      mpPose.close();
      mpPose = null;
    }
  }

  class PlatformerScene extends Phaser.Scene {
    constructor() {
      super("platformer");
    }

    preload() {
      this.load.tilemapTiledJSON('map1', 'assets/maps/map1.json');
      this.load.image('Terrain (16x16)', 'assets/maps/Terrain16x16.png');
      this.load.image('Collision', 'assets/maps/collisionTileSets.png');
      this.load.image('Blue', 'assets/maps/bg-blue.png');
    }

    create() {
      sceneRef = this;
      this.instanceId = 0;
      this.puppet = null;

      const map = this.make.tilemap({ key: 'map1' });
      // El mapa (map1.json) mide solo 512x256px nativos. Con escala 2 el
      // mundo (1024x512) apenas supera el viewport (800x480): quedan ~224px
      // para moverse antes de chocar con el borde, lo que se siente como
      // "el escenario es diminuto" y "no avanza al moverme". Con escala 3 el
      // mundo (1536x768) da margen real de scroll en ambos ejes.
      const tileScale = 3;

      // Background
      this.background = this.add.tileSprite(0, 0, map.widthInPixels * tileScale, map.heightInPixels * tileScale, 'Blue');
      this.background.setOrigin(0, 0);
      this.background.setScrollFactor(0);

      const tileset1 = map.addTilesetImage('Terrain (16x16)', 'Terrain (16x16)');
      const tileset2 = map.addTilesetImage('Collision', 'Collision');

      this.collisionLayer = null;

      map.layers.forEach(layer => {
        let tilesets = [];
        if (layer.properties) {
          const layerTileSetProps = layer.properties.find(prop => prop.name === 'tilesets');
          if (layerTileSetProps) {
            const names = layerTileSetProps.value.split(',');
            names.forEach(name => {
              const cleanName = name.replaceAll('"', '').trim();
              if (cleanName === 'Terrain (16x16)') tilesets.push(tileset1);
              if (cleanName === 'Collision') tilesets.push(tileset2);
            });
          }
        } else {
          tilesets = [tileset1, tileset2];
        }

        const l = map.createLayer(layer.name, tilesets, 0, 0).setScale(tileScale);
        
        if (layer.name === 'Collision') {
          l.setCollisionByProperty({ collide: true });
          l.forEachTile(tile => {
            if (tile.properties && tile.properties.canJump) {
              tile.collideDown = false;
              tile.collideLeft = false;
              tile.collideRight = false;
            }
          });
          l.setAlpha(0); // ocultar capa de colisiones
          this.collisionLayer = l;
        }
      });

      this.cursors = this.input.keyboard.createCursorKeys();
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

      this.playerBody = this.add.rectangle(80, 200, 32, 64, 0x000000, 0);
      this.physics.add.existing(this.playerBody);
      this.playerBody.body.setCollideWorldBounds(true);
      
      this.physics.world.setBounds(0, 0, map.widthInPixels * tileScale, map.heightInPixels * tileScale);
      this.cameras.main.setBounds(0, 0, map.widthInPixels * tileScale, map.heightInPixels * tileScale);
      this.cameras.main.startFollow(this.playerBody);

      // Crear un piso estático invisible a lo largo de todo el límite inferior del mapa
      const floorHeight = 40;
      const mapBottomY = map.heightInPixels * tileScale;
      const mapWidth = map.widthInPixels * tileScale;
      
      const bottomFloor = this.add.rectangle(mapWidth / 2, mapBottomY - (floorHeight / 2), mapWidth, floorHeight, 0x000000, 0);
      this.physics.add.existing(bottomFloor, true);
      this.physics.add.collider(this.playerBody, bottomFloor);

      if (this.collisionLayer) {
        this.physics.add.collider(this.playerBody, this.collisionLayer);
      }

      this.player = { facing: 1 };

      if (pendingRig) {
        this.loadCharacter(pendingRig);
        pendingRig = null;
      }
    }

    async loadCharacter(rig) {
      if (this.puppet) this.puppet.destroy();
      this.instanceId += 1;
      
      const spawnX = 80;
      const spawnY = 200;
      this.playerBody.setPosition(spawnX, spawnY);
      this.playerBody.body.setVelocity(0, 0);
      
      this.puppet = await Puppet.create(this, rig, spawnX, spawnY, this.instanceId);

      this.puppet.setPosition(this.playerBody.x, this.playerBody.y - this.puppet.footOffsetY + 32);
    }

    update(time, delta) {
      // scroll background
      if (this.background) {
        this.background.tilePositionY += 0.5;
      }

      if (!this.puppet) return;

      const speed = 220;
      const jumpVel = -640;

      let moving = false;
      let wantsJump = false;
      let facing = this.player.facing;
      const onGround = this.playerBody.body.blocked.down || this.playerBody.body.touching.down;

      if (activeControlMode === "mediapipe") {
        moving = mpState.moving;
        wantsJump = mpState.wantsJump;
        // La dirección se actualiza siempre según hacia dónde mira el
        // usuario, no solo mientras corre -así el salto puede empujar hacia
        // ese lado aunque no esté moviendo los brazos.
        facing = mpState.facing;
        this.player.facing = facing;

        if (moving || !onGround) {
          // Corriendo, o en el aire mirando hacia un lado: empuja en esa
          // dirección (salto direccional tipo salto largo).
          this.playerBody.body.setVelocityX(speed * facing);
        } else {
          this.playerBody.body.setVelocityX(0);
        }
      } else {
        if (this.cursors.left.isDown) {
          this.playerBody.body.setVelocityX(-speed);
          this.player.facing = -1;
          moving = true;
        } else if (this.cursors.right.isDown) {
          this.playerBody.body.setVelocityX(speed);
          this.player.facing = 1;
          moving = true;
        } else {
          this.playerBody.body.setVelocityX(0);
        }
        wantsJump = this.cursors.up.isDown || this.spaceKey.isDown;
      }

      if (wantsJump && onGround) {
        this.playerBody.body.setVelocityY(jumpVel);
      }

      // Solo reiniciar si el personaje se cae mucho más allá del fondo del mundo
      if (this.playerBody.y > this.physics.world.bounds.height + 200) {
        this.playerBody.setPosition(80, 200);
        this.playerBody.body.setVelocity(0, 0);
      }

      if (!onGround) {
        this.puppet.setState("jump");
      } else if (moving) {
        this.puppet.setState("walk");
      } else {
        this.puppet.setState("idle");
      }

      this.puppet.setFacing(this.player.facing);
      this.puppet.update(delta);
      
      // Update puppet position based on physics body
      this.puppet.setPosition(this.playerBody.x, this.playerBody.y - this.puppet.footOffsetY + 32);
    }
  }

  function ensureGame() {
    if (game) return;
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "gameContainer",
      backgroundColor: "#2b2b45",
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.ENVELOP,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 800,
        height: 480,
      },
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { y: 1500 },
          debug: false
        }
      },
      scene: [PlatformerScene],
    });
  }

  function start(rig, scale = 1.0, controlMode = "keyboard") {
    activeControlMode = controlMode;
    if (activeControlMode === "mediapipe") {
      initMediaPipe();
    } else {
      stopMediaPipe();
    }
    
    ensureGame();
    if (sceneRef && sceneRef.scene.isActive()) {
      sceneRef.loadCharacter(rig);
    } else {
      pendingRig = rig;
    }
  }

  return { start, stopMediaPipe };
})();
