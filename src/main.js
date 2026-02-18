import * as THREE from 'three';
import { Car } from './cars/Car.js';
import { EnemyCar } from './cars/EnemyCar.js';
import { Track } from './world/Track.js';
import { AudioManager } from './core/AudioManager.js';

/**
 * TURBO DRIFT 3D - GOLD MASTER ENGINE
 * Enhanced with:
 * - Proper game states (MENU, PLAYING, PAUSED, GAMEOVER)
 * - Advanced UI (speed, nitro, lap, rank, timer)
 * - Touch controls & gyroscope support
 * - AI with track following and ranking
 * - Scoring system (drift, overtakes)
 * - Debug overlay (FPS, position)
 * - Loading screen with progress
 */
class Game {
    constructor() {
        // --- CORE RENDER PROPERTIES ---
        this.canvas = document.querySelector('canvas');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
        
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            powerPreference: "high-performance",
            stencil: false,
            depth: true 
        });

        // --- SYSTEMS & MANAGERS ---
        this.clock = new THREE.Clock();
        this.input = { keys: {}, touch: { left: false, right: false, nitro: false }, gyroLane: 1 };
        this.particles = [];
        this.uiElements = {};

        // --- GAME STATE ---
        this.gameState = 'LOADING'; // LOADING, MENU, PLAYING, PAUSED, GAMEOVER
        this.nitroAmount = 100;
        this.maxNitro = 100;
        this.score = 0;
        this.lap = 1;
        this.maxLaps = 3;
        this.checkpointReached = false;
        this.lapStartTime = 0;
        this.bestLapTime = Infinity;
        this.currentLapTime = 0;
        this.lastCollisionTime = 0;
        this.frame = 0;
        this.debug = { fps: 0, lastTime: performance.now() };

        // Camera dynamics
        this.cameraShake = 0;
        this.targetFOV = 75;

        // Positions from track
        this.startLinePos = null;
        this.halfwayPos = null;

        // --- INITIALIZE ---
        this.init();
    }

    async init() {
        // Show loading screen
        this.createLoadingScreen();

        // Renderer setup
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setClearColor(0x010101);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(this.renderer.domElement);

        // World generation
        this.track = new Track(this.scene);
        this.scene.fog = new THREE.FogExp2(0x020202, 0.0012);

        // Populate checkpoint positions
        if (this.track) {
            this.startLinePos = this.track.startLinePos ? this.track.startLinePos.clone() : new THREE.Vector3(0,0,0);
            this.halfwayPos = this.track.halfwayPos ? this.track.halfwayPos.clone() : new THREE.Vector3(0,0,0);
        }

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.15);
        this.scene.add(ambient);

        const moonLight = new THREE.DirectionalLight(0x00ffff, 0.45);
        moonLight.position.set(200, 400, 100);
        moonLight.castShadow = true;
        moonLight.shadow.mapSize.width = 2048;
        moonLight.shadow.mapSize.height = 2048;
        this.scene.add(moonLight);

        // Entities
        this.player = new Car(this.scene);
        this.audioManager = new AudioManager(this.camera);

        // Rivals with distinct colors and lane offsets
        this.rivals = [
            new EnemyCar(this.scene, this.track.curve, 0x00ffcc, -4.5),
            new EnemyCar(this.scene, this.track.curve, 0xffff00, 4.5),
            new EnemyCar(this.scene, this.track.curve, 0xff00ff, 0),
            new EnemyCar(this.scene, this.track.curve, 0x0066ff, -8.0)
        ];

        // Wire events
        if (this.player && this.player.on) {
            this.player.on('collision', (obj, impulse) => {
                this.cameraShake = Math.max(this.cameraShake, 0.8);
                this.audioManager.playSound('collision', impulse);
            });
            this.player.on('drift', (factor) => {
                if (this.audioManager && this.audioManager.setDrift) this.audioManager.setDrift(Math.abs(factor));
                this.score += Math.floor(Math.abs(factor) * 10); // drift score
            });
        }

        this.rivals.forEach(r => {
            if (r && r.on) {
                r.on('collision', (obj) => {
                    this.cameraShake = Math.max(this.cameraShake, 0.6);
                });
            }
        });

        // Create UI
        this.createUI();
        this.createTouchControls();

        // Input listeners
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        window.addEventListener('resize', () => this.onResize());
        window.addEventListener('blur', () => {
            if (this.gameState === 'PLAYING') this.togglePause();
        });

        // Start loading complete, show menu
        setTimeout(() => {
            this.hideLoadingScreen();
            this.gameState = 'MENU';
            this.showMenu();
        }, 1500);

        // Start game loop
        this.animate();
    }

    // --- UI Creation ---
    createLoadingScreen() {
        const div = document.createElement('div');
        div.id = 'loading-screen';
        div.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: #000; color: #0ff; display: flex; flex-direction: column;
            justify-content: center; align-items: center; font-family: 'Courier New', monospace;
            z-index: 1000; transition: opacity 0.5s;
        `;
        div.innerHTML = `
            <h1 style="font-size: 3rem; text-shadow: 0 0 20px #0ff;">TURBO DRIFT 3D</h1>
            <div style="width: 300px; height: 10px; background: #333; margin: 20px;">
                <div id="loading-progress" style="width: 0%; height: 100%; background: #0ff;"></div>
            </div>
            <p>Loading assets...</p>
        `;
        document.body.appendChild(div);
        this.loadingProgress = document.getElementById('loading-progress');
        this.updateLoadingProgress(30);
    }

    updateLoadingProgress(percent) {
        if (this.loadingProgress) this.loadingProgress.style.width = percent + '%';
    }

    hideLoadingScreen() {
        const el = document.getElementById('loading-screen');
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 500);
        }
    }

    createUI() {
        // Main HUD container
        const hud = document.createElement('div');
        hud.id = 'hud';
        hud.style.cssText = `
            position: absolute; top: 20px; left: 20px; right: 20px; bottom: 20px;
            pointer-events: none; font-family: 'Courier New', monospace; color: #fff;
            text-shadow: 0 0 10px #0ff; z-index: 100;
        `;
        hud.innerHTML = `
            <div style="position: absolute; top: 0; left: 0;">
                <div>SPEED: <span id="speed-text">000</span> km/h</div>
                <div>LAP: <span id="lap-text">1/3</span></div>
                <div>TIME: <span id="timer-text">0:00.0</span></div>
                <div>BEST: <span id="best-lap-text">-:--.-</span></div>
                <div>SCORE: <span id="score-text">0</span></div>
                <div>RANK: <span id="rank-text">1/4</span></div>
            </div>
            <div style="position: absolute; top: 0; right: 0; text-align: right;">
                <div>NITRO</div>
                <div style="width: 200px; height: 20px; background: #222; border: 2px solid #0ff;">
                    <div id="nitro-fill" style="width: 100%; height: 100%; background: #0ff; box-shadow: 0 0 10px #0ff;"></div>
                </div>
            </div>
            <div style="position: absolute; bottom: 50px; left: 50%; transform: translateX(-50%); text-align: center;">
                <div id="message" style="font-size: 2rem; display: none;"></div>
            </div>
        `;
        document.body.appendChild(hud);

        // Cache elements
        this.uiElements = {
            speed: document.getElementById('speed-text'),
            lap: document.getElementById('lap-text'),
            timer: document.getElementById('timer-text'),
            bestLap: document.getElementById('best-lap-text'),
            score: document.getElementById('score-text'),
            rank: document.getElementById('rank-text'),
            nitroFill: document.getElementById('nitro-fill'),
            message: document.getElementById('message')
        };

        // Menu overlay
        const menu = document.createElement('div');
        menu.id = 'menu-overlay';
        menu.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); display: flex; flex-direction: column;
            justify-content: center; align-items: center; font-family: 'Courier New', monospace;
            color: #0ff; z-index: 200; backdrop-filter: blur(5px);
        `;
        menu.innerHTML = `
            <h1 style="font-size: 4rem; margin-bottom: 50px;">TURBO DRIFT 3D</h1>
            <button id="start-btn" style="font-size: 2rem; padding: 15px 30px; background: transparent; border: 2px solid #0ff; color: #0ff; cursor: pointer; margin: 10px;">START RACE</button>
            <button id="controls-btn" style="font-size: 1.5rem; padding: 10px 20px; background: transparent; border: 2px solid #fff; color: #fff; cursor: pointer;">CONTROLS</button>
        `;
        document.body.appendChild(menu);

        document.getElementById('start-btn').addEventListener('click', () => this.startRace());
        document.getElementById('controls-btn').addEventListener('click', () => this.showControls());

        // Pause overlay
        const pause = document.createElement('div');
        pause.id = 'pause-overlay';
        pause.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); display: none; flex-direction: column;
            justify-content: center; align-items: center; font-family: 'Courier New', monospace;
            color: #0ff; z-index: 300; backdrop-filter: blur(5px);
        `;
        pause.innerHTML = `
            <h1 style="font-size: 4rem;">PAUSED</h1>
            <button id="resume-btn" style="font-size: 2rem; padding: 15px 30px; background: transparent; border: 2px solid #0ff; color: #0ff; cursor: pointer; margin: 10px;">RESUME</button>
            <button id="quit-btn" style="font-size: 1.5rem; padding: 10px 20px; background: transparent; border: 2px solid #fff; color: #fff; cursor: pointer;">QUIT</button>
        `;
        document.body.appendChild(pause);

        document.getElementById('resume-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('quit-btn').addEventListener('click', () => this.quitToMenu());

        // Game over overlay
        const gameover = document.createElement('div');
        gameover.id = 'gameover-overlay';
        gameover.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); display: none; flex-direction: column;
            justify-content: center; align-items: center; font-family: 'Courier New', monospace;
            color: #f0f; z-index: 400; backdrop-filter: blur(5px);
        `;
        gameover.innerHTML = `
            <h1 style="font-size: 4rem;">RACE FINISHED</h1>
            <p style="font-size: 2rem;">RANK: <span id="final-rank">1</span></p>
            <p style="font-size: 2rem;">SCORE: <span id="final-score">0</span></p>
            <button id="restart-btn" style="font-size: 2rem; padding: 15px 30px; background: transparent; border: 2px solid #f0f; color: #f0f; cursor: pointer; margin: 10px;">RESTART</button>
            <button id="menu-btn" style="font-size: 1.5rem; padding: 10px 20px; background: transparent; border: 2px solid #fff; color: #fff; cursor: pointer;">MENU</button>
        `;
        document.body.appendChild(gameover);

        document.getElementById('restart-btn').addEventListener('click', () => this.restartRace());
        document.getElementById('menu-btn').addEventListener('click', () => this.quitToMenu());

        // Debug overlay
        const debug = document.createElement('div');
        debug.id = 'debug-overlay';
        debug.style.cssText = `
            position: absolute; bottom: 10px; left: 10px; color: #ff0; font-size: 12px;
            font-family: monospace; display: none; z-index: 500;
        `;
        debug.innerHTML = 'FPS: <span id="fps">60</span>';
        document.body.appendChild(debug);
    }

    createTouchControls() {
        const container = document.createElement('div');
        container.id = 'touch-controls';
        container.style.cssText = `
            position: absolute; bottom: 20px; left: 0; width: 100%; height: 200px;
            display: flex; justify-content: space-between; pointer-events: none; z-index: 1000;
        `;
        container.innerHTML = `
            <div id="touch-left" style="width: 40%; height: 100%; pointer-events: auto; background: rgba(0,255,255,0.1);"></div>
            <div id="touch-right" style="width: 40%; height: 100%; pointer-events: auto; background: rgba(255,0,255,0.1);"></div>
            <div id="touch-nitro" style="position: absolute; bottom: 30px; right: 30px; width: 100px; height: 100px; border-radius: 50%; background: rgba(0,255,255,0.3); border: 4px solid #0ff; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; pointer-events: auto;">N2O</div>
        `;
        document.body.appendChild(container);

        const left = document.getElementById('touch-left');
        const right = document.getElementById('touch-right');
        const nitro = document.getElementById('touch-nitro');

        left.addEventListener('touchstart', (e) => { e.preventDefault(); this.input.touch.left = true; });
        left.addEventListener('touchend', (e) => { e.preventDefault(); this.input.touch.left = false; });
        right.addEventListener('touchstart', (e) => { e.preventDefault(); this.input.touch.right = true; });
        right.addEventListener('touchend', (e) => { e.preventDefault(); this.input.touch.right = false; });
        nitro.addEventListener('touchstart', (e) => { e.preventDefault(); this.input.touch.nitro = true; });
        nitro.addEventListener('touchend', (e) => { e.preventDefault(); this.input.touch.nitro = false; });

        // Gyroscope
        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', (e) => {
                const tilt = e.gamma; // -90..90
                if (tilt !== null) {
                    // Map tilt to lane 0..2 (center = 1)
                    this.input.gyroLane = 1 + (tilt / 45);
                    this.input.gyroLane = Math.max(0, Math.min(2, this.input.gyroLane));
                }
            });
        }
    }

    // --- Game Flow ---
    showMenu() {
        document.getElementById('menu-overlay').style.display = 'flex';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('pause-overlay').style.display = 'none';
        document.getElementById('gameover-overlay').style.display = 'none';
    }

    startRace() {
        this.gameState = 'PLAYING';
        document.getElementById('menu-overlay').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        this.resetRace();
    }

    resetRace() {
        this.lap = 1;
        this.checkpointReached = false;
        this.score = 0;
        this.nitroAmount = 100;
        this.lapStartTime = performance.now();
        this.currentLapTime = 0;
        this.uiElements.lap.innerText = '1/3';
        this.uiElements.score.innerText = '0';
        this.uiElements.nitroFill.style.width = '100%';

        // Reset player position
        this.player.mesh.position.set(0, 0, 0);
        this.player.speed = 0;
        this.player.rotation = 0;

        // Reset rivals
        this.rivals.forEach((r, i) => {
            r.group.position.copy(this.track.curve.getPointAt(i * 0.2));
            r.progress = i * 0.2;
            r.speed = 0.3;
        });
    }

    togglePause() {
        if (this.gameState === 'PLAYING') {
            this.gameState = 'PAUSED';
            document.getElementById('pause-overlay').style.display = 'flex';
        } else if (this.gameState === 'PAUSED') {
            this.gameState = 'PLAYING';
            document.getElementById('pause-overlay').style.display = 'none';
        }
    }

    quitToMenu() {
        this.gameState = 'MENU';
        document.getElementById('pause-overlay').style.display = 'none';
        document.getElementById('gameover-overlay').style.display = 'none';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('menu-overlay').style.display = 'flex';
    }

    restartRace() {
        this.gameState = 'PLAYING';
        document.getElementById('gameover-overlay').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        this.resetRace();
    }

    showControls() {
        alert('Controls:\n\n- Arrow Keys / A/D: Steer\n- W/S: Accelerate/Brake\n- Shift: Nitro\n- P: Pause\n- Touch: Left/Right halves to steer, bottom right for nitro');
    }

    finishRace() {
        this.gameState = 'GAMEOVER';
        this.player.speed = 0;
        const rank = this.computeRank();
        document.getElementById('final-rank').innerText = rank;
        document.getElementById('final-score').innerText = this.score;
        document.getElementById('gameover-overlay').style.display = 'flex';
        document.getElementById('hud').style.display = 'none';
    }

    computeRank() {
        const playerProgress = this.player.progress || 0;
        let worse = 1;
        this.rivals.forEach(r => {
            if (r.progress > playerProgress) worse++;
        });
        return worse;
    }

    // --- Input Handling ---
    handleKeyDown(e) {
        const key = e.key.toLowerCase();
        this.input.keys[key] = true;
        if (key === 'p') this.togglePause();
        if (key === 'escape' && this.gameState === 'PLAYING') this.togglePause();
        e.preventDefault();
    }

    handleKeyUp(e) {
        const key = e.key.toLowerCase();
        this.input.keys[key] = false;
    }

    getSteeringInput() {
        if (this.input.gyroLane !== undefined && window.DeviceOrientationEvent) {
            // Gyro returns continuous lane value
            return this.input.gyroLane;
        }
        // Keyboard or touch
        let steer = 0;
        if (this.input.keys.arrowleft || this.input.keys.a || this.input.touch.left) steer -= 1;
        if (this.input.keys.arrowright || this.input.keys.d || this.input.touch.right) steer += 1;
        // Convert to lane 0..2 (center = 1)
        return 1 + steer;
    }

    getNitroInput() {
        return this.input.keys.shift || this.input.touch.nitro;
    }

    // --- Game Logic ---
    updateRaceLogic(dt) {
        if (this.gameState !== 'PLAYING') return;

        const pos = this.player.mesh.position;

        // Update progress
        if (this.track && typeof this.track.getTrackProgress === 'function') {
            this.player.progress = this.track.getTrackProgress(pos) || 0;
        }

        // Checkpoint
        if (!this.checkpointReached && pos.distanceTo(this.halfwayPos) < 80) {
            this.checkpointReached = true;
        }

        // Finish line
        if (this.checkpointReached && pos.distanceTo(this.startLinePos) < 80) {
            this.lap++;
            this.checkpointReached = false;
            const lapTime = (performance.now() - this.lapStartTime) / 1000;
            if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
            this.lapStartTime = performance.now();
            this.uiElements.lap.innerText = `${this.lap}/${this.maxLaps}`;
            if (this.lap > this.maxLaps) {
                this.finishRace();
            }
        }

        // Update lap timer
        if (this.gameState === 'PLAYING') {
            this.currentLapTime = (performance.now() - this.lapStartTime) / 1000;
            this.uiElements.timer.innerText = this.formatTime(this.currentLapTime);
            if (this.bestLapTime < Infinity) {
                this.uiElements.bestLap.innerText = this.formatTime(this.bestLapTime);
            }
        }

        // Update rank
        this.uiElements.rank.innerText = this.computeRank() + '/4';
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const tenths = Math.floor((seconds % 1) * 10);
        return `${mins}:${secs.toString().padStart(2,'0')}.${tenths}`;
    }

    // --- Collisions (optimized with bounding spheres) ---
    updateCollisions(dt) {
        if (this.gameState !== 'PLAYING') return;

        const playerPos = this.player.mesh.position;
        const playerRadius = this.player.boundingRadius || 2;

        // Destructibles
        for (let i = this.track.destructibles.length - 1; i >= 0; i--) {
            const obj = this.track.destructibles[i];
            if (obj.userData.hit) continue;
            const distSq = playerPos.distanceToSquared(obj.position);
            if (distSq < 200) {
                const objBox = new THREE.Box3().setFromObject(obj);
                const playerBox = new THREE.Box3().setFromObject(this.player.mesh);
                if (playerBox.intersectsBox(objBox)) {
                    this.triggerDestruction(obj);
                }
            }
        }

        // Rivals
        this.rivals.forEach(r => {
            if (!r || !r.group) return;
            const dist = playerPos.distanceTo(r.group.position);
            const rivalRadius = (r.config && r.config.collisionRadius) ? r.config.collisionRadius : 2;
            if (dist < (playerRadius + rivalRadius)) {
                if (r.handleCollisionSimple) r.handleCollisionSimple(this.player.mesh);
                if (this.player.handleCollisionSimple) this.player.handleCollisionSimple(r.group);
                this.cameraShake = 0.8;
            }
        });

        // Pillars/buildings
        if (this.track.colliders) {
            this.track.colliders.forEach(pillar => {
                const dist = playerPos.distanceTo(pillar.position);
                const pillarRadius = pillar.userData.radius || 5;
                if (dist < (pillarRadius + playerRadius)) {
                    this.player.speed *= -0.5;
                    this.cameraShake = 0.8;
                    const dir = new THREE.Vector3().subVectors(playerPos, pillar.position).normalize();
                    this.player.mesh.position.addScaledVector(dir, 1);
                }
            });
        }

        // Void
        if (playerPos.y < -40) this.respawnPlayer();
    }

    triggerDestruction(obj) {
        obj.userData.hit = true;
        obj.visible = false;
        this.createExplosion(obj.position, obj.userData.color);
        this.player.speed *= 0.85;
        this.cameraShake = 0.5;
        this.score += obj.userData.scoreValue || 100;
        this.uiElements.score.innerText = this.score;
    }

    respawnPlayer() {
        this.player.mesh.position.set(0, 5, 0);
        this.player.speed = 0;
        this.player.mesh.rotation.set(0,0,0);
        this.cameraShake = 1.0;
    }

    // --- Particle FX ---
    createExplosion(pos, color = 0xff0066) {
        const count = 20;
        for (let i = 0; i < count; i++) {
            const size = 0.2 + Math.random() * 0.4;
            const pGeo = new THREE.BoxGeometry(size, size, size);
            const pMat = new THREE.MeshBasicMaterial({ color: color, transparent: true });
            const p = new THREE.Mesh(pGeo, pMat);
            p.position.copy(pos);
            p.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 25,
                    Math.random() * 20,
                    (Math.random() - 0.5) * 25
                ),
                life: 1.0 + Math.random(),
                spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()),
                type: 'explosion'
            };
            this.scene.add(p);
            this.particles.push(p);
        }
    }

    createTrail(pos, color, size) {
        const pGeo = new THREE.BoxGeometry(size, size, size);
        const pMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6 });
        const p = new THREE.Mesh(pGeo, pMat);
        p.position.copy(pos);
        p.userData = {
            velocity: new THREE.Vector3((Math.random()-0.5)*0.2, 0.5, (Math.random()-0.5)*0.2),
            life: 0.4,
            spin: new THREE.Vector3(Math.random()*0.1, Math.random()*0.1, Math.random()*0.1),
            type: 'trail'
        };
        this.scene.add(p);
        this.particles.push(p);
    }

    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.position.addScaledVector(p.userData.velocity, dt);
            if (p.userData.type === 'explosion') {
                p.userData.velocity.y -= 30 * dt;
            }
            p.rotation.x += p.userData.spin.x * 10 * dt;
            p.userData.life -= dt;
            p.material.opacity = Math.max(0, p.userData.life);
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                this.particles.splice(i, 1);
            }
        }
    }

    // --- Camera ---
    updateCamera(dt) {
        if (!this.player) return;
        const speedRatio = Math.abs(this.player.speed) / (this.player.maxSpeed || 1);
        this.targetFOV = 75 + (speedRatio * 30);
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFOV, dt * 2);
        this.camera.updateProjectionMatrix();

        const baseOffset = new THREE.Vector3(0, 5, 11);
        baseOffset.z += speedRatio * 6;
        baseOffset.y -= speedRatio * 1;
        baseOffset.applyQuaternion(this.player.mesh.quaternion);
        const targetPos = this.player.mesh.position.clone().add(baseOffset);

        if (this.cameraShake > 0) {
            targetPos.x += (Math.random() - 0.5) * this.cameraShake;
            targetPos.y += (Math.random() - 0.5) * this.cameraShake;
            this.cameraShake = THREE.MathUtils.lerp(this.cameraShake, 0, dt * 5);
        }

        this.camera.position.lerp(targetPos, 0.1);

        const lookAhead = new THREE.Vector3(0, 0, -10).applyQuaternion(this.player.mesh.quaternion);
        const lookTarget = this.player.mesh.position.clone().add(lookAhead);
        this.camera.lookAt(lookTarget);
    }

    // --- UI Update ---
    updateUI(dt) {
        if (this.gameState !== 'PLAYING') return;

        // Speed
        const speedKmh = Math.floor(Math.abs(this.player.speed) * 220);
        this.uiElements.speed.innerText = speedKmh.toString().padStart(3, '0');

        // Nitro
        const isBoosting = this.getNitroInput() && this.nitroAmount > 0;
        if (isBoosting) {
            this.nitroAmount -= 30 * dt;
            this.uiElements.nitroFill.style.backgroundColor = '#ff0066';
            this.uiElements.nitroFill.style.boxShadow = '0 0 15px #ff0066';
        } else {
            this.nitroAmount = Math.min(this.maxNitro, this.nitroAmount + 5 * dt);
            this.uiElements.nitroFill.style.backgroundColor = '#00ffcc';
            this.uiElements.nitroFill.style.boxShadow = '0 0 10px #00ffcc';
        }
        this.uiElements.nitroFill.style.width = `${Math.max(0, this.nitroAmount)}%`;

        // Score
        this.uiElements.score.innerText = this.score;

        // Debug
        if (document.getElementById('debug-overlay').style.display !== 'none') {
            const now = performance.now();
            this.debug.fps = Math.round(1000 / (now - this.debug.lastTime));
            this.debug.lastTime = now;
            document.getElementById('fps').innerText = this.debug.fps;
        }
    }

    // --- Main Loop ---
    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.frame++;

        if (this.gameState === 'LOADING' || this.gameState === 'MENU' || this.gameState === 'PAUSED') {
            // Just render, no updates
            this.renderer.render(this.scene, this.camera);
            return;
        }

        // Update entities
        this.player.update(this.getSteeringInput(), this.getNitroInput(), dt);
        this.track.update(dt);

        // Update rivals with player progress for AI
        this.rivals.forEach(r => r.update(dt, { playerProgress: this.player.progress }));

        // Physics & logic
        this.updateCollisions(dt);
        this.updateRaceLogic(dt);
        this.updateParticles(dt);

        // Audio
        const isDrifting = Math.abs(this.player.driftFactor) > 0.15;
        this.audioManager.update(this.player.speed, isDrifting, this.getNitroInput());

        // Trail particles (throttled)
        if (Math.abs(this.player.speed) > 0.1 && this.frame % 3 === 0) {
            const pos = this.player.mesh.position.clone();
            pos.add(new THREE.Vector3(0, 0.5, 1.5).applyQuaternion(this.player.mesh.quaternion));
            const color = this.getNitroInput() ? 0x00ffff : 0xff0066;
            const size = this.getNitroInput() ? 0.4 : 0.2;
            this.createTrail(pos, color, size);
        }

        // Camera and UI
        this.updateCamera(dt);
        this.updateUI(dt);

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Entry point
window.onload = () => {
    new Game();
};