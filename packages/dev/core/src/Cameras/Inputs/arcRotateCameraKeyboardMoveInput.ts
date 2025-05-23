import type { Nullable } from "../../types";
import { serialize } from "../../Misc/decorators";
import type { Observer } from "../../Misc/observable";
import type { Scene } from "../../scene";
import type { ArcRotateCamera } from "../../Cameras/arcRotateCamera";
import type { ICameraInput } from "../../Cameras/cameraInputsManager";
import { CameraInputTypes } from "../../Cameras/cameraInputsManager";
import type { KeyboardInfo } from "../../Events/keyboardEvents";
import { KeyboardEventTypes } from "../../Events/keyboardEvents";
import { Tools } from "../../Misc/tools";
import type { AbstractEngine } from "../../Engines/abstractEngine";

/**
 * Manage the keyboard inputs to control the movement of an arc rotate camera.
 * @see https://doc.babylonjs.com/features/featuresDeepDive/cameras/customizingCameraInputs
 */
export class ArcRotateCameraKeyboardMoveInput implements ICameraInput<ArcRotateCamera> {
    /**
     * Defines the camera the input is attached to.
     */
    public camera: ArcRotateCamera;

    /**
     * Defines the list of key codes associated with the up action (increase alpha)
     */
    @serialize()
    public keysUp = [38];

    /**
     * Defines the list of key codes associated with the down action (decrease alpha)
     */
    @serialize()
    public keysDown = [40];

    /**
     * Defines the list of key codes associated with the left action (increase beta)
     */
    @serialize()
    public keysLeft = [37];

    /**
     * Defines the list of key codes associated with the right action (decrease beta)
     */
    @serialize()
    public keysRight = [39];

    /**
     * Defines the list of key codes associated with the reset action.
     * Those keys reset the camera to its last stored state (with the method camera.storeState())
     */
    @serialize()
    public keysReset = [220];

    /**
     * Defines the panning sensibility of the inputs.
     * (How fast is the camera panning)
     */
    @serialize()
    public panningSensibility: number = 50.0;

    /**
     * Defines the zooming sensibility of the inputs.
     * (How fast is the camera zooming)
     */
    @serialize()
    public zoomingSensibility: number = 25.0;

    /**
     * Defines whether maintaining the alt key down switch the movement mode from
     * orientation to zoom.
     */
    @serialize()
    public useAltToZoom: boolean = true;

    /**
     * Rotation speed of the camera
     */
    @serialize()
    public angularSpeed = 0.01;

    private _keys = new Array<number>();
    private _ctrlPressed: boolean;
    private _altPressed: boolean;
    private _onCanvasBlurObserver: Nullable<Observer<AbstractEngine>>;
    private _onKeyboardObserver: Nullable<Observer<KeyboardInfo>>;
    private _engine: AbstractEngine;
    private _scene: Scene;

    /**
     * Attach the input controls to a specific dom element to get the input from.
     * @param noPreventDefault Defines whether event caught by the controls should call preventdefault() (https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
     */
    public attachControl(noPreventDefault?: boolean): void {
        // was there a second variable defined?
        noPreventDefault = Tools.BackCompatCameraNoPreventDefault(arguments);

        if (this._onCanvasBlurObserver) {
            return;
        }

        this._scene = this.camera.getScene();
        this._engine = this._scene.getEngine();

        this._onCanvasBlurObserver = this._engine.onCanvasBlurObservable.add(() => {
            this._keys.length = 0;
        });

        this._onKeyboardObserver = this._scene.onKeyboardObservable.add((info) => {
            const evt = info.event;
            if (!evt.metaKey) {
                if (info.type === KeyboardEventTypes.KEYDOWN) {
                    this._ctrlPressed = evt.ctrlKey;
                    this._altPressed = evt.altKey;

                    if (
                        this.keysUp.indexOf(evt.keyCode) !== -1 ||
                        this.keysDown.indexOf(evt.keyCode) !== -1 ||
                        this.keysLeft.indexOf(evt.keyCode) !== -1 ||
                        this.keysRight.indexOf(evt.keyCode) !== -1 ||
                        this.keysReset.indexOf(evt.keyCode) !== -1
                    ) {
                        const index = this._keys.indexOf(evt.keyCode);

                        if (index === -1) {
                            this._keys.push(evt.keyCode);
                        }

                        if (evt.preventDefault) {
                            if (!noPreventDefault) {
                                evt.preventDefault();
                            }
                        }
                    }
                } else {
                    if (
                        this.keysUp.indexOf(evt.keyCode) !== -1 ||
                        this.keysDown.indexOf(evt.keyCode) !== -1 ||
                        this.keysLeft.indexOf(evt.keyCode) !== -1 ||
                        this.keysRight.indexOf(evt.keyCode) !== -1 ||
                        this.keysReset.indexOf(evt.keyCode) !== -1
                    ) {
                        const index = this._keys.indexOf(evt.keyCode);

                        if (index >= 0) {
                            this._keys.splice(index, 1);
                        }

                        if (evt.preventDefault) {
                            if (!noPreventDefault) {
                                evt.preventDefault();
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Detach the current controls from the specified dom element.
     */
    public detachControl(): void {
        if (this._scene) {
            if (this._onKeyboardObserver) {
                this._scene.onKeyboardObservable.remove(this._onKeyboardObserver);
            }
            if (this._onCanvasBlurObserver) {
                this._engine.onCanvasBlurObservable.remove(this._onCanvasBlurObserver);
            }
            this._onKeyboardObserver = null;
            this._onCanvasBlurObserver = null;
        }

        this._keys.length = 0;
    }

    /**
     * Update the current camera state depending on the inputs that have been used this frame.
     * This is a dynamically created lambda to avoid the performance penalty of looping for inputs in the render loop.
     */
    public checkInputs(): void {
        if (this._onKeyboardObserver) {
            const camera = this.camera;

            for (let index = 0; index < this._keys.length; index++) {
                const keyCode = this._keys[index];
                if (this.keysLeft.indexOf(keyCode) !== -1) {
                    if (this._ctrlPressed && this.camera._useCtrlForPanning) {
                        camera.inertialPanningX -= 1 / this.panningSensibility;
                    } else {
                        camera.inertialAlphaOffset -= this.angularSpeed;
                    }
                } else if (this.keysUp.indexOf(keyCode) !== -1) {
                    if (this._ctrlPressed && this.camera._useCtrlForPanning) {
                        camera.inertialPanningY += 1 / this.panningSensibility;
                    } else if (this._altPressed && this.useAltToZoom) {
                        camera.inertialRadiusOffset += 1 / this.zoomingSensibility;
                    } else {
                        camera.inertialBetaOffset -= this.angularSpeed;
                    }
                } else if (this.keysRight.indexOf(keyCode) !== -1) {
                    if (this._ctrlPressed && this.camera._useCtrlForPanning) {
                        camera.inertialPanningX += 1 / this.panningSensibility;
                    } else {
                        camera.inertialAlphaOffset += this.angularSpeed;
                    }
                } else if (this.keysDown.indexOf(keyCode) !== -1) {
                    if (this._ctrlPressed && this.camera._useCtrlForPanning) {
                        camera.inertialPanningY -= 1 / this.panningSensibility;
                    } else if (this._altPressed && this.useAltToZoom) {
                        camera.inertialRadiusOffset -= 1 / this.zoomingSensibility;
                    } else {
                        camera.inertialBetaOffset += this.angularSpeed;
                    }
                } else if (this.keysReset.indexOf(keyCode) !== -1) {
                    if (camera.useInputToRestoreState) {
                        camera.restoreState();
                    }
                }
            }
        }
    }

    /**
     * Gets the class name of the current input.
     * @returns the class name
     */
    public getClassName(): string {
        return "ArcRotateCameraKeyboardMoveInput";
    }

    /**
     * Get the friendly name associated with the input class.
     * @returns the input friendly name
     */
    public getSimpleName(): string {
        return "keyboard";
    }
}

(<any>CameraInputTypes)["ArcRotateCameraKeyboardMoveInput"] = ArcRotateCameraKeyboardMoveInput;
