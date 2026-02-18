import * as THREE from 'three';

// Robust Car class with extra systems:
// - health & damage
// - nitro with cooldown and capacity
// - event emitter hooks (collision, drift, nitro)
// - wheel suspension visuals and smoothing
// - bounding-sphere helper + debug draw
// - serialization methods
// - defensive guards and vector reuse for fewer allocations

export class Car {
    constructor(scene, opts = {}) {
        this.scene = scene;

        // --- Tunables / config (exposed for easy balancing) ---
        this.config = Object.assign({
            maxSpeed: 1.4,
            acceleration: 0.85,
            friction: 0.97,
            steeringPower: 2.2,
            wheelRadius: 0.35,
            mass: 1.0,
            nitroCapacity: 100,
            nitroPower: 1.6, // multiplier
            nitroDrainRate: 30, // units per second
            nitroRegenRate: 5, // units per second
            nitroCooldownSec: 0.75, // after depleting
            collisionRadius: 2.0
        }, opts);

        // --- Physical State ---
        this.speed = 0;
        this.maxSpeed = this.config.maxSpeed;
        this.acceleration = this.config.acceleration;
        this.friction = this.config.friction;
        this.rotation = 0; // yaw
        this.steeringPower = this.config.steeringPower;
        this.driftFactor = 0;

        // Health / Damage
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.invulnerable = false; // temporary invul after respawn

        // Nitro
        this.nitroAmount = this.config.nitroCapacity;
        this.nitroCooldown = 0; // remaining cooldown seconds

        // Progress tracking (external systems can set this)
        this.progress = 0;

        // For performance: reuse vectors
        this._v1 = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._v3 = new THREE.Vector3();

        // Event callbacks
        this._events = {};

        // Meshes
        this.mesh = new THREE.Group();
        this.wheels = [];
        this._wheelState = []; // per-wheel spin/steer states

        // debug helpers
        this._debugObjects = [];
        this.showDebugBounds = false;

        this.boundingRadius = this.config.collisionRadius;

        // Build visuals
        this.createCar();
        this.scene.add(this.mesh);

        // Safety defaults
        if (!this.mesh.position) this.mesh.position = new THREE.Vector3();

        // For wheel smoothing
        this._wheelSpinVel = 0;

        // Last collision time (debounce)
        this._lastCollisionTime = 0;
    }

    // -----------------------------
    // Event emitter
    // -----------------------------
    on(name, cb) {
        if (!this._events[name]) this._events[name] = [];
        this._events[name].push(cb);
    }
    emit(name, ...args) {
        const list = this._events[name];
        if (!list) return;
        for (let i = 0; i < list.length; i++) list[i](...args);
    }

    // -----------------------------
    // Build/visual helpers
    // -----------------------------
    createCar() {
        // --- CHASSIS ---
        this.paintMat = new THREE.MeshStandardMaterial({ color: 0xff0066, roughness: 0.1, metalness: 0.8 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2.6), this.paintMat);
        body.position.y = 0.6;
        body.castShadow = true;
        this.mesh.add(body);

        // --- CABIN / COCKPIT ---
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0, transparent: true, opacity: 0.9 });
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 1.3), glassMat);
        cabin.position.set(0, 0.9, -0.1);
        this.mesh.add(cabin);

        // --- WHEELS with suspension groups ---
        const wheelGeo = new THREE.CylinderGeometry(this.config.wheelRadius, this.config.wheelRadius, 0.3, 16);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        const rimMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

        const wheelPositions = [
            { x: 0.7, y: 0.35, z: 0.8 },  // Front Left
            { x: -0.7, y: 0.35, z: 0.8 }, // Front Right
            { x: 0.7, y: 0.35, z: -0.8 }, // Back Left
            { x: -0.7, y: 0.35, z: -0.8 } // Back Right
        ];

        wheelPositions.forEach((pos, i) => {
            const axle = new THREE.Group();
            const wheel = new THREE.Mesh(wheelGeo, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.castShadow = true;

            const rim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.35), rimMat);
            rim.rotation.x = 0.2;
            wheel.add(rim);

            axle.add(wheel);
            axle.position.set(pos.x, pos.y, pos.z);
            this.mesh.add(axle);
            this.wheels.push(axle);
            this._wheelState.push({ spin: 0, steer: 0 });
        });

        // --- NEON UNDERGLOW ---
        this.underglow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.15 }));
        this.underglow.rotation.x = -Math.PI / 2;
        this.underglow.position.y = 0.1;
        this.mesh.add(this.underglow);

        // --- LIGHTS ---
        const headLightGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
        const headLightL = new THREE.Mesh(headLightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        headLightL.position.set(0.35, 0.6, 1.3);
        this.mesh.add(headLightL);

        const headLightR = headLightL.clone();
        headLightR.position.x = -0.35;
        this.mesh.add(headLightR);

        this.brakeLights = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x550000 }));
        this.brakeLights.position.set(0, 0.6, -1.3);
        this.mesh.add(this.brakeLights);

        // spoiler
        const spoilerSupport = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), this.paintMat);
        spoilerSupport.position.set(0.4, 0.85, -1.1);
        this.mesh.add(spoilerSupport);
        const spoilerSupportR = spoilerSupport.clone();
        spoilerSupportR.position.x = -0.4;
        this.mesh.add(spoilerSupportR);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), this.paintMat);
        wing.position.set(0, 1.0, -1.1);
        this.mesh.add(wing);
    }

    // -----------------------------
    // Public API - setters/getters
    // -----------------------------
    setColor(hex) {
        if (this.paintMat) this.paintMat.color.setHex(hex);
    }

    setPosition(x, y, z) {
        this.mesh.position.set(x, y, z);
    }

    setRotation(yaw) {
        this.rotation = yaw;
        this.mesh.rotation.y = yaw;
    }

    getBoundingSphere() {
        const center = this.mesh.position;
        return { center, radius: this.boundingRadius };
    }

    enableDebugBounds(enable = true) {
        this.showDebugBounds = enable;
        if (enable) this._createDebugBounds();
        else this._disposeDebugBounds();
    }

    _createDebugBounds() {
        if (this._debugObjects.length) return;
        const geo = new THREE.SphereGeometry(this.boundingRadius, 12, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
        const s = new THREE.Mesh(geo, mat);
        s.position.copy(this.mesh.position);
        this.scene.add(s);
        this._debugObjects.push(s);
    }

    _disposeDebugBounds() {
        for (let o of this._debugObjects) this.scene.remove(o);
        this._debugObjects.length = 0;
    }

    // -----------------------------
    // Damage / Health
    // -----------------------------
    applyDamage(amount, options = {}) {
        if (this.invulnerable) return;
        this.health -= amount;
        this.emit('damage', amount, options);
        if (this.health <= 0) this._onDestroyed();
    }

    repair(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    _onDestroyed() {
        this.health = 0;
        this.speed = 0;
        this.emit('destroyed');
        // simple visual: dim paint + spawn smoke
        if (this.paintMat) {
            this.paintMat.color.setHex(0x333333);
            this.underglow.material.opacity = 0.03;
        }
    }

    // -----------------------------
    // Collision helper utilities
    // -----------------------------
    handleCollisionWithObject(obj, normal, severity = 1) {
        // obj: collision entity (can carry info)
        // normal: collision normal (THREE.Vector3)
        // severity: multiplier
        const now = performance.now();
        if (now - this._lastCollisionTime < 100) return; // debounce
        this._lastCollisionTime = now;

        const impulse = Math.abs(this.speed) * severity;
        this.applyDamage(impulse * 10, { source: obj });

        // bounce back along normal
        const push = this._v1.copy(normal).multiplyScalar(0.8 * severity);
        this.mesh.position.add(push);
        this.speed *= -0.5;
        this.cameraShake = 0.8;

        this.emit('collision', obj, impulse);
    }

    // Convenience when main loop detects overlap but doesn't compute normal
    handleCollisionSimple(obj) {
        // push away from obj center
        const dir = this._v1.subVectors(this.mesh.position, obj.position).normalize();
        this.handleCollisionWithObject(obj, dir, 1);
    }

    // -----------------------------
    // Nitro system
    // -----------------------------
    _useNitro(dt) {
        if (this.nitroCooldown > 0) return false;
        if (this.nitroAmount <= 0) {
            this.nitroCooldown = this.config.nitroCooldownSec;
            this.emit('nitroEmpty');
            return false;
        }
        const drain = this.config.nitroDrainRate * dt;
        this.nitroAmount = Math.max(0, this.nitroAmount - drain);
        if (this.nitroAmount === 0) this.nitroCooldown = this.config.nitroCooldownSec;
        this.emit('nitro', this.nitroAmount);
        return true;
    }

    _regenNitro(dt) {
        if (this.nitroCooldown > 0) {
            this.nitroCooldown = Math.max(0, this.nitroCooldown - dt);
            return;
        }
        this.nitroAmount = Math.min(this.config.nitroCapacity, this.nitroAmount + this.config.nitroRegenRate * dt);
    }

    // -----------------------------
    // Main update - preserves existing signature update(input, dt)
    // -----------------------------
    update(input, dt) {
        // Defensive guards
        if (!dt || dt <= 0) return;
        if (!input || !input.keys) input = { keys: {} };

        // 1. Acceleration & Braking
        const accInput = input.keys.w ? 1 : 0;
        const brakeInput = input.keys.s ? 1 : 0;

        // Smoothing acceleration and braking (simple lerp)
        this._accSmoothed = (this._accSmoothed || 0);
        this._accSmoothed = THREE.MathUtils.lerp(this._accSmoothed, accInput - brakeInput, Math.min(1, dt * 8));

        // Apply forces
        if (this._accSmoothed > 0.01) {
            this.speed += this.acceleration * this._accSmoothed * dt;
            this.brakeLights.material.color.setHex(0x550000);
        } else if (this._accSmoothed < -0.01) {
            this.speed += this.acceleration * this._accSmoothed * dt * 1.5; // stronger braking
            this.brakeLights.material.color.setHex(0xff0000);
        } else {
            this.brakeLights.material.color.setHex(0x550000);
        }

        // 2. Nitro
        const nitroKey = input.keys.shift;
        const isUsingNitro = nitroKey && this.nitroAmount > 0 && this.nitroCooldown <= 0;
        if (isUsingNitro) {
            const used = this._useNitro(dt);
            if (used) this.speed = Math.min(this.maxSpeed * this.config.nitroPower, this.speed + this.acceleration * dt * 1.2);
        } else {
            this._regenNitro(dt);
        }

        // 3. Speed limiter
        const currentMax = this.maxSpeed;
        if (this.speed > currentMax) this.speed = currentMax;
        if (this.speed < -currentMax / 2) this.speed = -currentMax / 2;

        // 4. Friction & damping
        this.speed *= Math.pow(this.friction, dt * 60 * 0.016); // scale friction to dt

        // 5. Steering & drift
        if (Math.abs(this.speed) > 0.03) {
            const steerSign = this.speed > 0 ? 1 : -1;
            const steerScale = (Math.abs(this.speed) / this.maxSpeed);
            let steerAmount = this.steeringPower * dt * steerSign * steerScale;

            if (input.keys.a) {
                this.rotation += steerAmount;
                this.driftFactor = THREE.MathUtils.lerp(this.driftFactor, 0.25 * steerScale, Math.min(1, dt * 6));
            } else if (input.keys.d) {
                this.rotation -= steerAmount;
                this.driftFactor = THREE.MathUtils.lerp(this.driftFactor, -0.25 * steerScale, Math.min(1, dt * 6));
            } else {
                this.driftFactor = THREE.MathUtils.lerp(this.driftFactor, 0, Math.min(1, dt * 6));
            }
        } else {
            this.driftFactor = THREE.MathUtils.lerp(this.driftFactor, 0, Math.min(1, dt * 8));
        }

        // 6. Visual updates: rotation and tilt
        this.mesh.rotation.y = this.rotation;
        this.mesh.rotation.z = this.driftFactor * (this.speed / Math.max(0.001, this.maxSpeed));

        // 7. Wheel animation & suspension
        const wheelSpinTarget = this.speed * 4;
        this._wheelSpinVel = THREE.MathUtils.lerp(this._wheelSpinVel || 0, wheelSpinTarget, Math.min(1, dt * 8));
        this.wheels.forEach((axle, i) => {
            const wheel = axle.children[0];
            // spin
            wheel.rotation.x += this._wheelSpinVel * dt * 60;
            // steer front wheels smoothly
            if (i < 2) {
                const desired = input.keys.a ? 0.4 : (input.keys.d ? -0.4 : 0);
                this._wheelState[i].steer = THREE.MathUtils.lerp(this._wheelState[i].steer, desired, Math.min(1, dt * 8));
                axle.rotation.y = this._wheelState[i].steer * (this.speed >= 0 ? 1 : -1);
            }
            // small suspension bob while moving
            const bob = Math.sin((performance.now() / 1000) * 10 + i) * 0.01 * Math.abs(this.speed);
            axle.position.y = 0.35 + bob;
        });

        // 8. Movement in world
        this._v2.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
        this.mesh.position.addScaledVector(this._v2, this.speed);

        // 9. Emit drift event when threshold crossed
        if (Math.abs(this.driftFactor) > 0.15) this.emit('drift', this.driftFactor);

        // 10. Update progress placeholder (external systems should set proper progress)
        this.progress = this.progress || 0;

        // 11. Debug bounds follow car
        if (this.showDebugBounds && this._debugObjects.length) {
            this._debugObjects[0].position.copy(this.mesh.position);
        }
    }

    // -----------------------------
    // Utilities
    // -----------------------------
    reset(x = 0, y = 5, z = 0) {
        this.mesh.position.set(x, y, z);
        this.speed = 0;
        this.rotation = 0;
        this.health = this.maxHealth;
        this.nitroAmount = this.config.nitroCapacity;
        this.nitroCooldown = 0;
        this.invulnerable = true;
        setTimeout(() => (this.invulnerable = false), 1000);
    }

    toJSON() {
        return {
            position: this.mesh.position.toArray(),
            rotation: this.rotation,
            speed: this.speed,
            health: this.health,
            nitro: this.nitroAmount,
            progress: this.progress
        };
    }

    fromJSON(data = {}) {
        if (data.position) this.mesh.position.fromArray(data.position);
        if (typeof data.rotation === 'number') this.rotation = data.rotation;
        if (typeof data.speed === 'number') this.speed = data.speed;
        if (typeof data.health === 'number') this.health = data.health;
        if (typeof data.nitro === 'number') this.nitroAmount = data.nitro;
        if (typeof data.progress === 'number') this.progress = data.progress;
    }
}
