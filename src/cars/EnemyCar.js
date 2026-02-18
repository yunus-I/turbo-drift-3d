import * as THREE from 'three';

// Enhanced EnemyCar AI class
// - Path following with configurable behavior
// - Nitro and rubber-banding
// - Collision hooks + event emitter
// - Debug visual helpers and serialization
// - Defensive guards and reduced allocations

export class EnemyCar {
    constructor(scene, trackCurve, color = 0xff0000, laneOffset = 0) {
        this.scene = scene;
        this.trackCurve = trackCurve;
        this.color = color;

        // Config
        this.config = {
            baseSpeed: 0.18 + Math.random() * 0.06,
            nitroMultiplier: 1.6,
            nitroDuration: 1.5 + Math.random() * 1.5,
            nitroCooldownMin: 4,
            nitroCooldownMax: 12,
            laneSwitchInterval: { min: 2.5, max: 6 },
            laneWidth: 4.5,
            collisionRadius: 2.0
        };

        // State
        this.progress = Math.random();
        this.speed = this.config.baseSpeed;
        this.laneOffset = laneOffset;
        this.targetLaneOffset = laneOffset;

        this.isNitroActive = false;
        this.nitroTimer = 0;
        this.nitroCooldown = (this.config.nitroCooldownMin + Math.random() * (this.config.nitroCooldownMax - this.config.nitroCooldownMin));

        this._tLane = Math.random() * (this.config.laneSwitchInterval.max - this.config.laneSwitchInterval.min) + this.config.laneSwitchInterval.min;

        // Visuals
        this.group = null;
        this.mesh = null;
        this.wheels = [];
        this.underglow = null;
        this.exhaust = null;
        this.nitroFlare = null;

        // Events
        this._events = {};

        // Debug
        this.showDebug = false;
        this._debugObjects = [];

        // Build
        this._v1 = new THREE.Vector3();
        this._v2 = new THREE.Vector3();

        this.createMesh();
    }

    // Event emitter
    on(name, cb) {
        (this._events[name] = this._events[name] || []).push(cb);
    }
    emit(name, ...args) {
        const list = this._events[name];
        if (!list) return;
        for (let i = 0; i < list.length; i++) list[i](...args);
    }

    createMesh() {
        this.group = new THREE.Group();

        // Chassis
        const bodyGeo = new THREE.BoxGeometry(2.0, 0.6, 3.6);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.9, roughness: 0.1 });
        this.mesh = new THREE.Mesh(bodyGeo, bodyMat);
        this.mesh.castShadow = true;
        this.group.add(this.mesh);

        // Trim
        const trim = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.12, 3.7), new THREE.MeshBasicMaterial({ color: this.color }));
        trim.position.y = -0.18;
        this.group.add(trim);

        // Cockpit
        const cock = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 1.6), new THREE.MeshStandardMaterial({ color: 0x000000 }));
        cock.position.set(0, 0.45, 0.4);
        this.group.add(cock);

        // Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.36, 12);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const wheelPositions = [
            { x: 0.95, y: -0.1, z: 1.2 }, { x: -0.95, y: -0.1, z: 1.2 },
            { x: 0.95, y: -0.1, z: -1.2 }, { x: -0.95, y: -0.1, z: -1.2 }
        ];
        wheelPositions.forEach(p => {
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            w.rotation.z = Math.PI / 2;
            w.position.set(p.x, p.y, p.z);
            w.castShadow = true;
            this.group.add(w);
            this.wheels.push(w);
        });

        // Underglow
        this.underglow = new THREE.PointLight(this.color, 6, 10);
        this.underglow.position.set(0, -0.6, 0);
        this.group.add(this.underglow);

        // Exhaust
        this.exhaust = new THREE.PointLight(this.color, 4, 5);
        this.exhaust.position.set(0, 0, -1.9);
        this.group.add(this.exhaust);

        // Nitro flare
        const flareGeo = new THREE.CylinderGeometry(0.08, 0.42, 1.6, 8);
        const flareMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
        this.nitroFlare = new THREE.Mesh(flareGeo, flareMat);
        this.nitroFlare.rotation.x = Math.PI / 2;
        this.nitroFlare.position.set(0, 0, -2.4);
        this.nitroFlare.visible = false;
        this.group.add(this.nitroFlare);

        this.scene.add(this.group);
    }

    enableDebug(enable = true) {
        this.showDebug = enable;
        if (enable) this._createDebug();
        else this._disposeDebug();
    }

    _createDebug() {
        if (this._debugObjects.length) return;
        const s = new THREE.Mesh(new THREE.SphereGeometry(this.config.collisionRadius || 1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true }));
        s.position.copy(this.group.position);
        this.scene.add(s);
        this._debugObjects.push(s);
    }
    _disposeDebug() {
        for (let o of this._debugObjects) this.scene.remove(o);
        this._debugObjects.length = 0;
    }

    // Simple utility: request nitro
    requestNitro() {
        if (this.isNitroActive || this.nitroCooldown > 0) return false;
        this.isNitroActive = true;
        this.nitroTimer = this.config.nitroDuration;
        this.emit('nitroStart');
        return true;
    }

    // Called by main loop each frame
    update(dt, options = {}) {
        if (!dt || dt <= 0) return;

        // Nitro cooldown
        this.nitroCooldown = Math.max(0, this.nitroCooldown - dt);

        // AI nitro activation heuristics
        if (!this.isNitroActive && this.nitroCooldown <= 0) {
            // If trailing behind (options.playerProgress provided) or random chance
            const should = (options.playerProgress != null && this.progress + 0.05 < options.playerProgress) || Math.random() < 0.002;
            if (should) this.requestNitro();
        }

        if (this.isNitroActive) {
            this.nitroTimer -= dt;
            const target = this.config.baseSpeed * this.config.nitroMultiplier;
            this.speed = THREE.MathUtils.lerp(this.speed, target, Math.min(1, dt * 6));
            this.nitroFlare.visible = true;
            this.exhaust.intensity = 12;
            this.underglow.intensity = 12;
            if (this.nitroTimer <= 0) {
                this.isNitroActive = false;
                this.nitroCooldown = this.config.nitroCooldownMin + Math.random() * (this.config.nitroCooldownMax - this.config.nitroCooldownMin);
                this.nitroFlare.visible = false;
                this.emit('nitroEnd');
            }
        } else {
            // Gradually lerp back to base speed (rubber banding subtlety)
            this.speed = THREE.MathUtils.lerp(this.speed, this.config.baseSpeed, dt * 0.5);
            this.exhaust.intensity = 4;
            this.underglow.intensity = 6;
        }

        // Progress update
        this.progress += this.speed * dt;
        this.progress %= 1;

        // Lane switching
        this._tLane -= dt;
        if (this._tLane <= 0) {
            const rng = Math.random();
            this.targetLaneOffset = (rng - 0.5) * this.config.laneWidth * 2; // spread across lane width
            this._tLane = this.config.laneSwitchInterval.min + Math.random() * (this.config.laneSwitchInterval.max - this.config.laneSwitchInterval.min);
        }
        const laneLerp = Math.min(1, dt * (this.isNitroActive ? 2.8 : 1.6));
        this.laneOffset = THREE.MathUtils.lerp(this.laneOffset, this.targetLaneOffset, laneLerp);

        // Fetch track point & tangent
        const pos = this.trackCurve.getPointAt(this.progress);
        const tangent = this.trackCurve.getTangentAt(this.progress);
        const up = this._v1.set(0, 1, 0);
        const side = this._v2.crossVectors(up, tangent).normalize();

        // Apply lateral offset
        const worldPos = pos.clone().addScaledVector(side, this.laneOffset);
        this.group.position.copy(worldPos);

        // Look ahead for orientation
        const lookAt = this.trackCurve.getPointAt((this.progress + 0.01) % 1).clone().addScaledVector(side, this.laneOffset);
        this.group.lookAt(lookAt);

        // Visual tweaks
        this.mesh.rotation.z = (this.targetLaneOffset - this.laneOffset) * 0.02; // banking
        this.wheels.forEach(w => w.rotation.x += this.speed * 70 * dt);

        // Update debug object
        if (this.showDebug && this._debugObjects.length) this._debugObjects[0].position.copy(this.group.position);
    }

    // Collision helpers
    handleCollisionSimple(obj) {
        // push away from obj center and reduce speed
        const dir = this._v1.subVectors(this.group.position, obj.position).normalize();
        this.group.position.addScaledVector(dir, 0.8);
        this.speed *= -0.5;
        this.emit('collision', obj);
    }

    // Serialization helpers
    toJSON() {
        return {
            progress: this.progress,
            laneOffset: this.laneOffset,
            speed: this.speed,
            isNitroActive: this.isNitroActive
        };
    }
    fromJSON(data = {}) {
        if (data.progress != null) this.progress = data.progress;
        if (data.laneOffset != null) this.laneOffset = data.laneOffset;
        if (data.speed != null) this.speed = data.speed;
        if (data.isNitroActive != null) this.isNitroActive = data.isNitroActive;
    }
}
