// Juego de plataformas básico (movimiento y colisiones caseras, sin plugin
// de físicas) que usa el Puppet articulado como personaje jugable.

window.PixelPersonGame = (() => {
  let game = null;
  let sceneRef = null;
  let pendingRig = null;

  class PlatformerScene extends Phaser.Scene {
    constructor() {
      super("platformer");
    }

    create() {
      sceneRef = this;
      this.instanceId = 0;
      this.puppet = null;

      this.add.rectangle(400, 300, 800, 600, 0x2b2b45);
      this.platforms = [];
      this.addPlatform(0, 560, 800, 40);
      this.addPlatform(110, 430, 170, 20);
      this.addPlatform(340, 330, 170, 20);
      this.addPlatform(570, 430, 170, 20);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

      this.player = { x: 80, y: 520, groundY: 520, vx: 0, vy: 0, onGround: true, facing: 1 };

      if (pendingRig) {
        this.loadCharacter(pendingRig);
        pendingRig = null;
      }
    }

    addPlatform(x, y, w, h) {
      this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x4a4a6a).setStrokeStyle(2, 0x6c5ce7);
      this.platforms.push({ x, y, w, h });
    }

    async loadCharacter(rig) {
      if (this.puppet) this.puppet.destroy();
      this.instanceId += 1;
      this.puppet = await Puppet.create(this, rig, 80, 520, this.instanceId);

      this.player.x = 80;
      this.player.y = this.player.groundY;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.onGround = true;

      this.puppet.setPosition(this.player.x, this.player.y - this.puppet.footOffsetY);
    }

    update(time, delta) {
      if (!this.puppet) return;

      const speed = 220;
      const gravity = 1500;
      const jumpVel = -640;
      const dt = delta / 1000;

      let moving = false;
      if (this.cursors.left.isDown) {
        this.player.vx = -speed;
        this.player.facing = -1;
        moving = true;
      } else if (this.cursors.right.isDown) {
        this.player.vx = speed;
        this.player.facing = 1;
        moving = true;
      } else {
        this.player.vx = 0;
      }

      const wantsJump = this.cursors.up.isDown || this.spaceKey.isDown;
      if (wantsJump && this.player.onGround) {
        this.player.vy = jumpVel;
        this.player.onGround = false;
      }

      this.player.vy += gravity * dt;
      this.player.x += this.player.vx * dt;
      this.player.y += this.player.vy * dt;

      this.player.onGround = false;
      for (const p of this.platforms) {
        const withinX = this.player.x > p.x + 12 && this.player.x < p.x + p.w - 12;
        const fallingOntoTop = this.player.vy >= 0 && this.player.y >= p.y - 4 && this.player.y <= p.y + 26;
        if (withinX && fallingOntoTop) {
          this.player.y = p.y;
          this.player.vy = 0;
          this.player.onGround = true;
        }
      }

      this.player.x = Phaser.Math.Clamp(this.player.x, 30, 770);
      if (this.player.y > 700) {
        this.player.x = 80;
        this.player.y = this.player.groundY;
        this.player.vy = 0;
      }

      if (!this.player.onGround) {
        this.puppet.setState("jump");
      } else if (moving) {
        this.puppet.setState("walk");
      } else {
        this.puppet.setState("idle");
      }

      this.puppet.setFacing(this.player.facing);
      this.puppet.update(delta);
      this.puppet.setPosition(this.player.x, this.player.y - this.puppet.footOffsetY);
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
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 800,
        height: 600,
      },
      scene: [PlatformerScene],
    });
  }

  function start(rig) {
    ensureGame();
    if (sceneRef && sceneRef.scene.isActive()) {
      sceneRef.loadCharacter(rig);
    } else {
      pendingRig = rig;
    }
  }

  return { start };
})();
