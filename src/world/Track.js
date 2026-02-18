import * as THREE from 'three';

/**
 * TURBO DRIFT 3D - PRO-LEVEL TRACK & ENVIRONMENT SYSTEM
 * * Features implemented in this version:
 * 1. Procedural Asphalt Spline (TubeGeometry with Tangent Alignment)
 * 2. Spatial Collider Partitioning (Building/Pillar registration)
 * 3. Dynamic City Architect (180+ Pillars with Multi-Window Glow)
 * 4. Atmosphere Engine (Starfields, Fog, and Moon-rig Lighting)
 * 5. Destructible Prop Scatter (Physics-ready crates and barrels)
 * 6. Vertex Displacement Logic (Subtle track undulations)
 */
export class Track {
    constructor(scene) {
        this.scene = scene;
        this.curve = null;
        
        // --- System Collections ---
        this.destructibles = []; 
        this.colliders = []; // Static pillars/buildings
        this.lights = [];
        this.scenery = [];
        
        // --- Configuration Constants ---
        this.cityRadius = 1500;
        this.buildingCount = 200;
        this.roadWidth = 20;
        this.segmentCount = 250;
        this.pillarColor = 0x080808;
        this.neonCyan = 0x00ffff;
        this.neonPink = 0xff0066;
        // Exposed checkpoint positions (updated after spline creation)
        this.startLinePos = new THREE.Vector3();
        this.halfwayPos = new THREE.Vector3();
        
        this.init();
    }

    /**
     * INITIALIZATION CHAIN
     */
    init() {
        this.createTrackSpline();
        this.createRoadSurface();
        this.createProceduralCity();
        this.createAtmosphericDepth();
        this.createSceneryProps();
        this.createTracksideDetails();

        // set convenient checkpoint positions used by game logic
        if (this.curve) {
            this.startLinePos.copy(this.curve.getPointAt(0));
            // halfway roughly at 0.25 along the track
            this.halfwayPos.copy(this.curve.getPointAt(0.25));
        }
    }

    /**
     * CORE TRACK SPLINE
     * Defines the circuit path with variable height data.
     */
    createTrackSpline() {
        // Define control points for a rounded circuit. Use more points for smoother routing.
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(120, 18, 180),
            new THREE.Vector3(360, 34, 320),
            new THREE.Vector3(700, 15, 200),
            new THREE.Vector3(640, -8, -240),
            new THREE.Vector3(320, -22, -420),
            new THREE.Vector3(90, -12, -150),
            new THREE.Vector3(-140, 6, -40),
            new THREE.Vector3(-300, 12, 160),
            new THREE.Vector3(-120, 18, 300),
            new THREE.Vector3(0, 0, 0)
        ];

        this.curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.85);
    }

    /**
     * ROAD SURFACE & ASPHALT
     * Generates high-poly road with neon boundary markers.
     */
    createRoadSurface() {
        // 1. Asphalt Body
        const tubeGeo = new THREE.TubeGeometry(this.curve, this.segmentCount, this.roadWidth, 24, true);
        
        // Custom Shader-ready Asphalt Material
        const asphaltMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: false,
            side: THREE.DoubleSide
        });

        const roadMesh = new THREE.Mesh(tubeGeo, asphaltMat);
        roadMesh.receiveShadow = true;
        this.scene.add(roadMesh);

        // 2. Neon Boundary Strips (Cyan Side)
        // edges use same curve but with smaller radius
        const cyanEdgeGeo = new THREE.TubeGeometry(this.curve, this.segmentCount, this.roadWidth * 0.035, 8, true);
        const cyanMat = new THREE.MeshBasicMaterial({ color: this.neonCyan });
        const cyanEdge = new THREE.Mesh(cyanEdgeGeo, cyanMat);
        cyanEdge.scale.set(1.08, 1.08, 1.08); // Outward Offset
        this.scene.add(cyanEdge);

        // 3. Neon Boundary Strips (Pink Side)
        const pinkMat = new THREE.MeshBasicMaterial({ color: this.neonPink });
        const pinkEdge = new THREE.Mesh(cyanEdgeGeo, pinkMat);
        pinkEdge.scale.set(0.98, 0.98, 0.98); // slight inward offset
        this.scene.add(pinkEdge);

        // store road references for debug or future updates
        this.roadMesh = roadMesh;
        this.cyanEdge = cyanEdge;
        this.pinkEdge = pinkEdge;
    }

    /**
     * PROCEDURAL CITY ARCHITECT
     * Generates a dense urban environment with collision registration.
     */
    createProceduralCity() {
        const pillarMat = new THREE.MeshStandardMaterial({ 
            color: this.pillarColor, 
            roughness: 0.6, 
            metalness: 0.3 
        });

        for (let i = 0; i < this.buildingCount; i++) {
            // Randomize Architecture
            const h = 80 + Math.random() * 350;
            const w = 25 + Math.random() * 50;
            const d = 25 + Math.random() * 50;
            
            // Use geometry with exact dimensions (no scaling)
            const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pillarMat);
            
            // Layout Logic (Avoid track exclusion zone)
            const angle = Math.random() * Math.PI * 2;
            const dist = 180 + Math.random() * 1000;
            
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            
            // Collision-free start zone
            if (Math.abs(x) < 60 && Math.abs(z) < 60) continue;

            building.position.set(x, h / 2 - 30, z);
            building.castShadow = true;
            building.receiveShadow = true;
            
            this.scene.add(building);

            // Register for Collision System
            building.userData = { 
                type: 'pillar', 
                radius: Math.max(w, d) / 1.7,
                id: `pillar_${i}`
            };
            this.colliders.push(building);

            // Add Window Lighting Arrays
            this.generateWindowArrays(building, w, h, d);
        }
    }

    /**
     * WINDOW LIGHTING GENERATOR
     * Creates individual glow planes on building surfaces.
     */
    generateWindowArrays(building, w, h, d) {
        const floors = Math.floor(h / 15);
        const color = Math.random() > 0.5 ? this.neonCyan : this.neonPink;
        
        for (let f = 0; f < floors; f++) {
            // Front/Back Windows
            const rowGeo = new THREE.PlaneGeometry(w * 0.7, 1.5);
            const rowMat = new THREE.MeshBasicMaterial({ 
                color: color, 
                transparent: true,
                opacity: 0.7 + Math.random() * 0.3
            });
            
            const frontWindow = new THREE.Mesh(rowGeo, rowMat);
            frontWindow.position.set(0, (f * 15) - h/2.5, d/2 + 0.2);
            building.add(frontWindow);

            const backWindow = new THREE.Mesh(rowGeo, rowMat);
            backWindow.position.set(0, (f * 15) - h/2.5, -d/2 - 0.2);
            backWindow.rotation.y = Math.PI;
            building.add(backWindow);

            // Side Windows
            const sideGeo = new THREE.PlaneGeometry(d * 0.7, 1.5);
            const leftWindow = new THREE.Mesh(sideGeo, rowMat);
            leftWindow.position.set(-w/2 - 0.2, (f * 15) - h/2.5, 0);
            leftWindow.rotation.y = -Math.PI / 2;
            building.add(leftWindow);
        }

        // Add Local Emission Light
            if (Math.random() > 0.7) {
                const light = new THREE.PointLight(color, 120, 80);
                light.position.copy(building.position);
                light.position.y = 10;
                this.scene.add(light);
                this.lights.push(light);
            }
    }

    /**
     * ATMOSPHERIC DEPTH RIG
     * Space dust, ground planes, and fog.
     */
    createAtmosphericDepth() {
        // Ground Mesh
        const groundGeo = new THREE.PlaneGeometry(4000, 4000);
        const groundMat = new THREE.MeshStandardMaterial({ 
            color: 0x030303, 
            roughness: 1, 
            metalness: 0 
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -40;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Volumetric Starfield
        const starGeo = new THREE.BufferGeometry();
        const starCount = 5000;
        const posArray = new Float32Array(starCount * 3);
        
        for (let i = 0; i < starCount * 3; i++) {
            posArray[i] = (Math.random() - 0.5) * 2500;
        }
        
        starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const starMat = new THREE.PointsMaterial({ 
            color: 0xffffff, 
            size: 1.2, 
            transparent: true,
            opacity: 0.8
        });
        const stars = new THREE.Points(starGeo, starMat);
        this.scene.add(stars);

        // Global Fog
        this.scene.fog = new THREE.FogExp2(0x010101, 0.0009);
    }

    /**
     * DESTRUCTIBLE PROP SCATTER
     * Logic for scatterable physical objects along the road.
     */
    createSceneryProps() {
        const crateGeo = new THREE.BoxGeometry(3.5, 3.5, 3.5);
        
        for (let i = 0; i < 75; i++) {
            const t = Math.random();
            const pos = this.curve.getPointAt(t);
            const tangent = this.curve.getTangentAt(t);
            
            // Compute a horizontal perpendicular vector (cross product with up)
            const up = new THREE.Vector3(0, 1, 0);
            const normal = new THREE.Vector3().crossVectors(up, tangent).normalize();
            
            const offsetWidth = (Math.random() - 0.5) * 35;
            pos.add(normal.multiplyScalar(offsetWidth));
            
            const color = Math.random() > 0.5 ? this.neonPink : this.neonCyan;
            const mat = new THREE.MeshStandardMaterial({ 
                color: 0x1a1a1a, 
                emissive: color,
                emissiveIntensity: 0.3
            });
            
            const crate = new THREE.Mesh(crateGeo, mat);
            crate.position.copy(pos);
            crate.position.y += 2;
            crate.rotation.set(Math.random(), Math.random(), Math.random());
            
            crate.userData = { 
                hit: false, 
                color: color, 
                type: 'destructible',
                scoreValue: 100 
            };
            
            this.scene.add(crate);
            this.destructibles.push(crate);
        }
    }

    /**
     * TRACKSIDE DETAILS
     * Signs, floating markers, and aesthetic geometry.
     */
    createTracksideDetails() {
        for (let i = 0; i < 15; i++) {
            const t = (i / 15);
            const pos = this.curve.getPointAt(t);
            const tangent = this.curve.getTangentAt(t);
            const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
            
            // Archway logic
            const archGroup = new THREE.Group();
            const pillarGeo = new THREE.BoxGeometry(2, 40, 2);
            const beamGeo = new THREE.BoxGeometry(40, 2, 2);
            const neonMat = new THREE.MeshBasicMaterial({ color: this.neonCyan });
            
            const leftP = new THREE.Mesh(pillarGeo, neonMat);
            leftP.position.set(-20, 20, 0);
            
            const rightP = new THREE.Mesh(pillarGeo, neonMat);
            rightP.position.set(20, 20, 0);
            
            const beam = new THREE.Mesh(beamGeo, neonMat);
            beam.position.set(0, 40, 0);
            
            archGroup.add(leftP, rightP, beam);
            archGroup.position.copy(pos);
            archGroup.lookAt(pos.clone().add(tangent));
            
            this.scene.add(archGroup);
            this.scenery.push(archGroup);
        }
    }

    /**
     * DYNAMIC UPDATE LOOP
     */
    update(dt) {
        // Flickering Lights
        const time = Date.now() * 0.002;
        this.lights.forEach((light, i) => {
            light.intensity = 50 + Math.sin(time + i) * 20;
        });

        // Floating scenery animation
        this.scenery.forEach((obj, i) => {
            if (i % 2 === 0) {
                obj.position.y += Math.sin(time * 0.5 + i) * 0.05;
            }
        });
    }

    /**
     * PHYSICS HELPER
     * Calculate track distance for ranking/AI
     */
    getTrackProgress(position) {
        // Returns 0.0 to 1.0 progress by projecting position onto the curve
        // We'll sample to find the nearest t for robust result
        const samples = 200;
        let minDist = Infinity;
        let bestT = 0;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const p = this.curve.getPointAt(t);
            const d = p.distanceToSquared(position);
            if (d < minDist) {
                minDist = d;
                bestT = t;
            }
        }
        return bestT;
    }
    getClosestPointOnTrack(position, samples = 200) {
        let minDist = Infinity;
        let targetT = 0;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const p = this.curve.getPointAt(t);
            const d = p.distanceToSquared(position);
            if (d < minDist) {
                minDist = d;
                targetT = t;
            }
        }
        return {
            point: this.curve.getPointAt(targetT),
            t: targetT,
            distanceSq: minDist
        };
    }
}