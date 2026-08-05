// Juego de plataformas básico que usa el Puppet articulado como personaje jugable
// y el escenario (tilemaps) del proyecto Dump-Land-Game.

window.PixelPersonGame = (() => {
  let game = null;
  let sceneRef = null;
  let pendingRig = null;

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
      const tileScale = 2;

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

      const wantsJump = this.cursors.up.isDown || this.spaceKey.isDown;
      const onGround = this.playerBody.body.blocked.down || this.playerBody.body.touching.down;
      
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
