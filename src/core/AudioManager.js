import * as THREE from 'three';

export class AudioManager {
    constructor(camera) {
        this.enabled = false;
        
        // Wait for user interaction to start audio (Browser policy)
        window.addEventListener('keydown', () => this.init(), { once: true });
        window.addEventListener('click', () => this.init(), { once: true });
    }

    init() {
        if (this.enabled) return;
        
        this.listener = new THREE.AudioListener();
        // We assume camera is passed later or attached to listener manually if needed
        // For simple synth, we use global AudioContext
        this.context = this.listener.context;
        
        // --- ENGINE SOUND (Oscillators) ---
        this.engineOsc = this.context.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 100;

        // Gain (Volume)
        this.engineGain = this.context.createGain();
        this.engineGain.gain.value = 0.1;

        // Filter (Muffles the harsh saw wave)
        this.engineFilter = this.context.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 400;

        // Connect graph: Osc -> Filter -> Gain -> Out
        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.context.destination);
        
        this.engineOsc.start();
        
        // --- DRIFT NOISE (Pink Noise) ---
        // Simplified: We'll use a high pitch sine wave for screech for now
        this.driftOsc = this.context.createOscillator();
        this.driftOsc.type = 'square';
        this.driftOsc.frequency.value = 800;
        
        this.driftGain = this.context.createGain();
        this.driftGain.gain.value = 0; // Silent by default
        
        this.driftOsc.connect(this.driftGain);
        this.driftGain.connect(this.context.destination);
        this.driftOsc.start();

        this.enabled = true;
        console.log("Audio Initialized");
    }

    update(speed, isDrifting, isNitro) {
        if (!this.enabled) return;

        // 1. Engine Pitch (RPM)
        // Base idle is 80Hz, adds 600Hz based on speed
        const targetFreq = 80 + (Math.abs(speed) * 800);
        
        // Smooth transition
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.context.currentTime, 0.1);
        
        // Filter opens up as you go faster (sound gets brighter)
        this.engineFilter.frequency.setTargetAtTime(200 + (Math.abs(speed) * 1000), this.context.currentTime, 0.1);

        // 2. Drift Screech
        if (isDrifting && Math.abs(speed) > 0.3) {
            this.driftGain.gain.setTargetAtTime(0.1, this.context.currentTime, 0.1);
        } else {
            this.driftGain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
        }

        // 3. Nitro Whistle (High pitch sine)
        // (Optional: can add later)
    }
}