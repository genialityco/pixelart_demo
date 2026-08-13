// Muñeco articulado (cutout / paper-doll) construido a partir del rig que
// devuelve el backend: cada parte es un Phaser.Image dentro de un
// Phaser.Container posicionado en el punto de articulación (pivot), anidado
// según la jerarquía padre-hijo. Rotar un contenedor rota todo lo que cuelga
// de él, igual que una marioneta de recortes.

// Secuencias de animación para las habilidades (Q/W/E o gestos con
// MediaPipe): una lista de frames con ángulos de brazo, reproducida en
// orden a un fps fijo -en vez de una sola pose fija sostenida un ratito.
// Adaptado de la lógica de otro proyecto (mismo concepto, traducido a nuestro
// rig y convención de signos: ángulo negativo en upperArm = brazo levantado):
//  - Corazón: el HOMBRO hace la mayor parte del recorrido hacia arriba con
//    el codo casi recto, así la mano sube junto a la cara -si el codo se
//    dobla mucho en cambio, se lee como un abrazo.
//  - Flor: las manos se juntan al pecho (codo muy doblado, como sacando
//    algo de adentro) y se abren hacia afuera y abajo -la flor "nace" en
//    ese momento de apertura.
const ACTION_SEQUENCES = {
  hadouken: {
    fps: 10,
    frames: [
      { upperArm: -30, lowerArm: -10, head: -2 },
      { upperArm: -55, lowerArm: -18, head: -6 },
      { upperArm: -65, lowerArm: -20, head: -6 },
      { upperArm: -40, lowerArm: -12, head: -3 },
      { upperArm: -15, lowerArm: -5, head: 0 },
      { upperArm: 0, lowerArm: 0, head: 0 },
    ],
  },
  heart: {
    fps: 9,
    frames: [
      { upperArm: -75, lowerArm: -15, head: -2 },
      { upperArm: -112, lowerArm: -30, head: -4 },
      { upperArm: -100, lowerArm: -25, head: -3 },
      { upperArm: -60, lowerArm: -12, head: 0 },
      { upperArm: -25, lowerArm: -6, head: 0 },
      { upperArm: 0, lowerArm: 0, head: 0 },
    ],
  },
  flower: {
    fps: 8,
    frames: [
      { upperArm: -15, lowerArm: 70, head: 0 },
      { upperArm: -25, lowerArm: 95, head: 0 },
      { upperArm: -45, lowerArm: 40, head: -2 },
      { upperArm: -55, lowerArm: 15, head: -3 },
      { upperArm: -20, lowerArm: 8, head: -1 },
      { upperArm: 0, lowerArm: 0, head: 0 },
    ],
  },
};

function loadTexture(scene, key, dataUrl) {
  return new Promise((resolve) => {
    if (scene.textures.exists(key)) {
      resolve();
      return;
    }
    scene.textures.once(Phaser.Textures.Events.ADD_KEY + key, () => resolve());
    scene.textures.addBase64(key, dataUrl);
  });
}

class Puppet {
  static async create(scene, rig, x, y, instanceId) {
    const partsByName = {};
    rig.parts.forEach((p) => (partsByName[p.name] = p));
    const keyOf = (name) => `puppet_${instanceId}_${name}`;

    await Promise.all(rig.parts.map((p) => loadTexture(scene, keyOf(p.name), p.image)));

    const puppet = new Puppet(scene, rig, partsByName, keyOf);
    puppet.build(x, y);
    return puppet;
  }

  constructor(scene, rig, partsByName, keyOf) {
    this.scene = scene;
    this.rig = rig;
    this.partsByName = partsByName;
    this.keyOf = keyOf;
    this.containers = {};
    this.walkTime = 0;
    this.state = "idle";
    this.bobOffset = 0;
    this.footOffsetY = rig.meta ? rig.meta.footOffsetY : 0;
    this.actionState = null;
    this.actionElapsed = 0;
    this.actionDuration = 0;
    this.invertFacing = false;
  }

  build(x, y) {
    this.rootContainer = this._buildRecursive(this.rig.root);
    this.rootContainer.setPosition(x, y);
  }

  _buildRecursive(name) {
    const spec = this.partsByName[name];
    const container = this.scene.add.container(0, 0);
    const img = this.scene.add.image(0, 0, this.keyOf(name));

    const originPx = spec.pivot || spec.rootOrigin || [spec.w / 2, spec.h / 2];
    img.setOrigin(originPx[0] / spec.w, originPx[1] / spec.h);
    container.add(img);
    this.containers[name] = container;

    const attach = spec.attach || {};
    for (const childName of Object.keys(attach)) {
      if (!this.partsByName[childName]) continue;
      const childContainer = this._buildRecursive(childName);
      const [ax, ay] = attach[childName];
      childContainer.setPosition(ax - originPx[0], ay - originPx[1]);
      container.add(childContainer);
    }
    return container;
  }

  setPosition(x, y) {
    this.rootContainer.setPosition(x, y + this.bobOffset);
  }

  setFacing(dir) {
    if (dir === 0) return; // de frente: conserva el volteo visual actual
    this.rootContainer.scaleX = dir > 0 ? -1 : 1;
  }

  setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.walkTime = 0;
    }
  }

  // Animación de brazos/manos para una habilidad (hadouken/heart/flower):
  // reproduce la secuencia de frames de ACTION_SEQUENCES por encima de lo
  // que esté haciendo el cuerpo (caminar/saltar/reposo) y después vuelve
  // sola a lo normal.
  playAction(name) {
    const seq = ACTION_SEQUENCES[name];
    if (!seq) return;
    this.actionState = name;
    this.actionElapsed = 0;
    this.actionDuration = (seq.frames.length / seq.fps) * 1000;
  }

  _setAngle(name, deg) {
    const c = this.containers[name];
    if (c) c.angle = deg;
  }

  _applyAction(name, elapsedMs) {
    const seq = ACTION_SEQUENCES[name];
    if (!seq) return;
    const idx = Math.min(seq.frames.length - 1, Math.floor((elapsedMs / 1000) * seq.fps));
    const frame = seq.frames[idx];

    this._setAngle("left_upper_arm", frame.upperArm);
    this._setAngle("right_upper_arm", frame.upperArm);
    this._setAngle("left_lower_arm", frame.lowerArm);
    this._setAngle("right_lower_arm", frame.lowerArm);
    this._setAngle("head", frame.head);
    this._setAngle("left_upper_leg", 0);
    this._setAngle("right_upper_leg", 0);
    this._setAngle("left_lower_leg", 0);
    this._setAngle("right_lower_leg", 0);
    this.bobOffset = 0;
  }

  update(delta) {
    const dt = delta / 1000;

    if (this.actionState) {
      this.actionElapsed += delta;
      if (this.actionElapsed >= this.actionDuration) {
        this.actionState = null;
      } else {
        this._applyAction(this.actionState, this.actionElapsed);
        return;
      }
    }

    if (this.state === "walk") {
      this.walkTime += dt * 14; // Velocidad de carrera
      const t = this.walkTime;

      // Piernas: ciclo de carrera realista
      // El muslo va de adelante hacia atrás con sin(t)
      this._setAngle("left_upper_leg", Math.sin(t) * 50);
      this._setAngle("right_upper_leg", Math.sin(t + Math.PI) * 50);

      // La pantorrilla se dobla al máximo cuando la pierna vuelve hacia adelante (cos(t)).
      // Signo positivo: la rodilla flexiona hacia atrás (como una rodilla real),
      // no hacia adelante.
      this._setAngle("left_lower_leg", Math.max(0, Math.cos(t)) * 45);
      this._setAngle("right_lower_leg", Math.max(0, Math.cos(t + Math.PI)) * 45);

      // Brazos: opuestos a las piernas. Con invertFacing activo, el espejo
      // del torso invierte también el sentido en que se leen estas
      // rotaciones, así que se compensa con el mismo signo.
      const armSign = this.invertFacing ? -1 : 1;
      this._setAngle("left_upper_arm", Math.sin(t + Math.PI) * 45 * armSign);
      this._setAngle("right_upper_arm", Math.sin(t) * 45 * armSign);

      // Codos doblados en postura de corredor (más doblados cuando van adelante).
      // El brazo que queda atrás (fase <= 0) invierte el sentido del codo.
      const leftArmPhase = Math.sin(t + Math.PI);
      const leftElbow = leftArmPhase > 40 ? -40 + leftArmPhase * -40 : 40;
      this._setAngle("left_lower_arm", leftElbow * armSign);

      const rightArmPhase = Math.sin(t);
      const rightElbow = rightArmPhase > 40 ? -40 + rightArmPhase * -40 : 40;
      this._setAngle("right_lower_arm", rightElbow * armSign);

      // Cabeza y cuerpo (bobbing pronunciado)
      this._setAngle("head", Math.sin(t * 2) * 4 + 8); // Inclinado hacia adelante
      this.bobOffset = -Math.abs(Math.sin(t)) * 8; // Brinco
    } else if (this.state === "jump") {
      // Salto dinámico: pose de acción
      // Pierna frontal levantada y doblada
      this._setAngle("left_upper_leg", -60);
      this._setAngle("left_lower_leg", 20);
      // Pierna trasera estirada hacia atrás
      this._setAngle("right_upper_leg", 30);
      this._setAngle("right_lower_leg", 70);

      // Brazo frontal buscando altura
      this._setAngle("left_upper_arm", -100);
      this._setAngle("left_lower_arm", -10);
      // Brazo trasero dando impulso hacia atrás
      this._setAngle("right_upper_arm", 50);
      this._setAngle("right_lower_arm", -40);

      this._setAngle("head", -15); // Mirando un poco hacia arriba
      this.bobOffset = 0;
    } else {
      this.walkTime += dt * 2;
      const breathe = Math.sin(this.walkTime) * 2;
      this._setAngle("left_upper_leg", 0);
      this._setAngle("right_upper_leg", 0);
      this._setAngle("left_lower_leg", 0);
      this._setAngle("right_lower_leg", 0);
      this._setAngle("left_upper_arm", breathe * 0.6);
      this._setAngle("right_upper_arm", -breathe * 0.6);
      this._setAngle("left_lower_arm", 6);
      this._setAngle("right_lower_arm", 6);
      this._setAngle("head", breathe * 0.5);
      this.bobOffset = breathe * 0.6;
    }
  }

  destroy() {
    this.rootContainer.destroy();
    Object.keys(this.partsByName).forEach((name) => {
      const key = this.keyOf(name);
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    });
  }
}

window.Puppet = Puppet;
