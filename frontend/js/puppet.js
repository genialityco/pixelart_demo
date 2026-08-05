// Muñeco articulado (cutout / paper-doll) construido a partir del rig que
// devuelve el backend: cada parte es un Phaser.Image dentro de un
// Phaser.Container posicionado en el punto de articulación (pivot), anidado
// según la jerarquía padre-hijo. Rotar un contenedor rota todo lo que cuelga
// de él, igual que una marioneta de recortes.

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

  _setAngle(name, deg) {
    const c = this.containers[name];
    if (c) c.angle = deg;
  }

  update(delta) {
    const dt = delta / 1000;

    if (this.state === "walk") {
      this.walkTime += dt * 14; // Velocidad de carrera
      const t = this.walkTime;
      
      // Piernas: ciclo de carrera realista
      // El muslo va de adelante hacia atrás con sin(t)
      this._setAngle("left_upper_leg", Math.sin(t) * 50);
      this._setAngle("right_upper_leg", Math.sin(t + Math.PI) * 50);
      
      // La pantorrilla se dobla al máximo cuando la pierna vuelve hacia adelante (cos(t))
      this._setAngle("left_lower_leg", Math.max(0, Math.cos(t)) * -95);
      this._setAngle("right_lower_leg", Math.max(0, Math.cos(t + Math.PI)) * -95);
      
      // Brazos: opuestos a las piernas
      this._setAngle("left_upper_arm", Math.sin(t + Math.PI) * 45);
      this._setAngle("right_upper_arm", Math.sin(t) * 45);
      
      // Codos doblados en postura de corredor (más doblados cuando van adelante)
      this._setAngle("left_lower_arm", -40 + Math.max(0, Math.sin(t + Math.PI)) * -40);
      this._setAngle("right_lower_arm", -40 + Math.max(0, Math.sin(t)) * -40);
      
      // Cabeza y cuerpo (bobbing pronunciado)
      this._setAngle("head", Math.sin(t * 2) * 4 + 8); // Inclinado hacia adelante
      this.bobOffset = -Math.abs(Math.sin(t)) * 8; // Brinco
    } else if (this.state === "jump") {
      // Salto dinámico: pose de acción
      // Pierna frontal levantada y doblada
      this._setAngle("left_upper_leg", -60);
      this._setAngle("left_lower_leg", -20);
      // Pierna trasera estirada hacia atrás
      this._setAngle("right_upper_leg", 30);
      this._setAngle("right_lower_leg", -70);
      
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
