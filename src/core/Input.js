export class Input {
    constructor() {
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            space: false,
            shift: false,
            // Mapping specific keys to match the Car.js logic
            w: false,
            a: false,
            s: false,
            d: false
        };

        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    onKeyDown(e) {
        switch(e.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.keys.forward = true;
                this.keys.w = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.keys.backward = true;
                this.keys.s = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.keys.left = true;
                this.keys.a = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.keys.right = true;
                this.keys.d = true;
                break;
            case 'Space':
                this.keys.space = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.shift = true;
                break;
        }
    }

    onKeyUp(e) {
        switch(e.code) {
            case 'ArrowUp':
            case 'KeyW':
                this.keys.forward = false;
                this.keys.w = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                this.keys.backward = false;
                this.keys.s = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                this.keys.left = false;
                this.keys.a = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                this.keys.right = false;
                this.keys.d = false;
                break;
            case 'Space':
                this.keys.space = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.shift = false;
                break;
        }
    }
}