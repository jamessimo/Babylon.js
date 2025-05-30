import type { Nullable } from "../types";
import { Logger } from "../Misc/logger";
import type { Camera } from "../Cameras/camera";
import type { Effect } from "../Materials/effect";
import type { PostProcessOptions } from "./postProcess";
import { PostProcess } from "./postProcess";
import { Constants } from "../Engines/constants";
import { GeometryBufferRenderer } from "../Rendering/geometryBufferRenderer";
import type { AbstractMesh } from "../Meshes/abstractMesh";
import { MotionBlurConfiguration } from "../Rendering/motionBlurConfiguration";
import type { PrePassRenderer } from "../Rendering/prePassRenderer";

import "../Animations/animatable";
import "../Rendering/geometryBufferRendererSceneComponent";
import { serialize } from "../Misc/decorators";
import { SerializationHelper } from "../Misc/decorators.serialization";
import { RegisterClass } from "../Misc/typeStore";

import type { AbstractEngine } from "../Engines/abstractEngine";
import type { Scene } from "../scene";
import { ThinMotionBlurPostProcess } from "./thinMotionBlurPostProcess";

/**
 * The Motion Blur Post Process which blurs an image based on the objects velocity in scene.
 * Velocity can be affected by each object's rotation, position and scale depending on the transformation speed.
 * As an example, all you have to do is to create the post-process:
 *  var mb = new BABYLON.MotionBlurPostProcess(
 *      'mb', // The name of the effect.
 *      scene, // The scene containing the objects to blur according to their velocity.
 *      1.0, // The required width/height ratio to downsize to before computing the render pass.
 *      camera // The camera to apply the render pass to.
 * );
 * Then, all objects moving, rotating and/or scaling will be blurred depending on the transformation speed.
 */
export class MotionBlurPostProcess extends PostProcess {
    /**
     * Defines how much the image is blurred by the movement. Default value is equal to 1
     */
    @serialize()
    public get motionStrength() {
        return this._effectWrapper.motionStrength;
    }

    public set motionStrength(value: number) {
        this._effectWrapper.motionStrength = value;
    }

    /**
     * Gets the number of iterations are used for motion blur quality. Default value is equal to 32
     */
    @serialize()
    public get motionBlurSamples(): number {
        return this._effectWrapper.motionBlurSamples;
    }

    /**
     * Sets the number of iterations to be used for motion blur quality
     */
    public set motionBlurSamples(samples: number) {
        this._effectWrapper.motionBlurSamples = samples;
    }

    /**
     * Gets whether or not the motion blur post-process is in object based mode.
     */
    @serialize()
    public get isObjectBased(): boolean {
        return this._effectWrapper.isObjectBased;
    }

    /**
     * Sets whether or not the motion blur post-process is in object based mode.
     */
    public set isObjectBased(value: boolean) {
        if (this.isObjectBased === value) {
            return;
        }

        this._effectWrapper.isObjectBased = value;
        this._applyMode();
    }

    private _forceGeometryBuffer: boolean = false;
    private get _geometryBufferRenderer(): Nullable<GeometryBufferRenderer> {
        if (!this._forceGeometryBuffer) {
            return null;
        }

        return this._scene.geometryBufferRenderer;
    }

    private get _prePassRenderer(): Nullable<PrePassRenderer> {
        if (this._forceGeometryBuffer) {
            return null;
        }

        return this._scene.prePassRenderer;
    }

    /**
     * Gets a string identifying the name of the class
     * @returns "MotionBlurPostProcess" string
     */
    public override getClassName(): string {
        return "MotionBlurPostProcess";
    }

    protected override _effectWrapper: ThinMotionBlurPostProcess;

    /**
     * Creates a new instance MotionBlurPostProcess
     * @param name The name of the effect.
     * @param scene The scene containing the objects to blur according to their velocity.
     * @param options The required width/height ratio to downsize to before computing the render pass.
     * @param camera The camera to apply the render pass to.
     * @param samplingMode The sampling mode to be used when computing the pass. (default: 0)
     * @param engine The engine which the post process will be applied. (default: current engine)
     * @param reusable If the post process can be reused on the same frame. (default: false)
     * @param textureType Type of textures used when performing the post process. (default: 0)
     * @param blockCompilation If compilation of the shader should not be done in the constructor. The updateEffect method can be used to compile the shader at a later time. (default: true)
     * @param forceGeometryBuffer If this post process should use geometry buffer instead of prepass (default: false)
     */
    constructor(
        name: string,
        scene: Scene,
        options: number | PostProcessOptions,
        camera: Nullable<Camera>,
        samplingMode?: number,
        engine?: AbstractEngine,
        reusable?: boolean,
        textureType: number = Constants.TEXTURETYPE_UNSIGNED_BYTE,
        blockCompilation = false,
        forceGeometryBuffer = false
    ) {
        const localOptions = {
            uniforms: ThinMotionBlurPostProcess.Uniforms,
            samplers: ThinMotionBlurPostProcess.Samplers,
            defines: ThinMotionBlurPostProcess.Defines,
            size: typeof options === "number" ? options : undefined,
            camera,
            samplingMode,
            engine,
            reusable,
            textureType,
            blockCompilation,
            ...(options as PostProcessOptions),
        };

        super(name, ThinMotionBlurPostProcess.FragmentUrl, {
            effectWrapper: typeof options === "number" || !options.effectWrapper ? new ThinMotionBlurPostProcess(name, scene, localOptions) : undefined,
            ...localOptions,
        });

        this._forceGeometryBuffer = forceGeometryBuffer;

        // Set up assets
        if (this._forceGeometryBuffer) {
            scene.enableGeometryBufferRenderer();

            if (this._geometryBufferRenderer) {
                this._geometryBufferRenderer.enableVelocity = this.isObjectBased;
            }
        } else {
            scene.enablePrePassRenderer();

            if (this._prePassRenderer) {
                this._prePassRenderer.markAsDirty();
                this._prePassEffectConfiguration = new MotionBlurConfiguration();
            }
        }

        this._applyMode();
    }

    /**
     * Excludes the given skinned mesh from computing bones velocities.
     * Computing bones velocities can have a cost and that cost. The cost can be saved by calling this function and by passing the skinned mesh reference to ignore.
     * @param skinnedMesh The mesh containing the skeleton to ignore when computing the velocity map.
     */
    public excludeSkinnedMesh(skinnedMesh: AbstractMesh): void {
        if (skinnedMesh.skeleton) {
            let list;
            if (this._geometryBufferRenderer) {
                list = this._geometryBufferRenderer.excludedSkinnedMeshesFromVelocity;
            } else if (this._prePassRenderer) {
                list = this._prePassRenderer.excludedSkinnedMesh;
            } else {
                return;
            }
            list.push(skinnedMesh);
        }
    }

    /**
     * Removes the given skinned mesh from the excluded meshes to integrate bones velocities while rendering the velocity map.
     * @param skinnedMesh The mesh containing the skeleton that has been ignored previously.
     * @see excludeSkinnedMesh to exclude a skinned mesh from bones velocity computation.
     */
    public removeExcludedSkinnedMesh(skinnedMesh: AbstractMesh): void {
        if (skinnedMesh.skeleton) {
            let list;
            if (this._geometryBufferRenderer) {
                list = this._geometryBufferRenderer.excludedSkinnedMeshesFromVelocity;
            } else if (this._prePassRenderer) {
                list = this._prePassRenderer.excludedSkinnedMesh;
            } else {
                return;
            }

            const index = list.indexOf(skinnedMesh);
            if (index !== -1) {
                list.splice(index, 1);
            }
        }
    }

    /**
     * Disposes the post process.
     * @param camera The camera to dispose the post process on.
     */
    public override dispose(camera?: Camera): void {
        if (this._geometryBufferRenderer) {
            // Clear previous transformation matrices dictionary used to compute objects velocities
            this._geometryBufferRenderer._previousTransformationMatrices = {};
            this._geometryBufferRenderer._previousBonesTransformationMatrices = {};
            this._geometryBufferRenderer.excludedSkinnedMeshesFromVelocity = [];
        }

        super.dispose(camera);
    }

    /**
     * Called on the mode changed (object based or screen based).
     */
    private _applyMode() {
        if (!this._geometryBufferRenderer && !this._prePassRenderer) {
            // We can't get a velocity or depth texture. So, work as a passthrough.
            Logger.Warn("Multiple Render Target support needed to compute object based motion blur");
            return;
        }

        if (this._geometryBufferRenderer) {
            this._geometryBufferRenderer.enableVelocity = this.isObjectBased;
        }

        if (this.isObjectBased) {
            if (this._prePassRenderer && this._prePassEffectConfiguration) {
                this._prePassEffectConfiguration.texturesRequired[0] = Constants.PREPASS_VELOCITY_TEXTURE_TYPE;
            }

            this.onApply = (effect: Effect) => this._onApplyObjectBased(effect);
        } else {
            if (this._prePassRenderer && this._prePassEffectConfiguration) {
                this._prePassEffectConfiguration.texturesRequired[0] = Constants.PREPASS_DEPTH_TEXTURE_TYPE;
            }

            this.onApply = (effect: Effect) => this._onApplyScreenBased(effect);
        }
    }

    /**
     * Called on the effect is applied when the motion blur post-process is in object based mode.
     * @param effect
     */
    private _onApplyObjectBased(effect: Effect): void {
        this._effectWrapper.textureWidth = this.width;
        this._effectWrapper.textureHeight = this.height;
        if (this._geometryBufferRenderer) {
            const velocityIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.VELOCITY_TEXTURE_TYPE);
            effect.setTexture("velocitySampler", this._geometryBufferRenderer.getGBuffer().textures[velocityIndex]);
        } else if (this._prePassRenderer) {
            const velocityIndex = this._prePassRenderer.getIndex(Constants.PREPASS_VELOCITY_TEXTURE_TYPE);
            effect.setTexture("velocitySampler", this._prePassRenderer.getRenderTarget().textures[velocityIndex]);
        }
    }

    /**
     * Called on the effect is applied when the motion blur post-process is in screen based mode.
     * @param effect
     */
    private _onApplyScreenBased(effect: Effect): void {
        this._effectWrapper.textureWidth = this.width;
        this._effectWrapper.textureHeight = this.height;
        if (this._geometryBufferRenderer) {
            const depthIndex = this._geometryBufferRenderer.getTextureIndex(GeometryBufferRenderer.DEPTH_TEXTURE_TYPE);
            effect.setTexture("depthSampler", this._geometryBufferRenderer.getGBuffer().textures[depthIndex]);
        } else if (this._prePassRenderer) {
            const depthIndex = this._prePassRenderer.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
            effect.setTexture("depthSampler", this._prePassRenderer.getRenderTarget().textures[depthIndex]);
        }
    }

    /**
     * @internal
     */
    public static override _Parse(parsedPostProcess: any, targetCamera: Camera, scene: Scene, rootUrl: string): Nullable<MotionBlurPostProcess> {
        return SerializationHelper.Parse(
            () => {
                return new MotionBlurPostProcess(
                    parsedPostProcess.name,
                    scene,
                    parsedPostProcess.options,
                    targetCamera,
                    parsedPostProcess.renderTargetSamplingMode,
                    scene.getEngine(),
                    parsedPostProcess.reusable,
                    parsedPostProcess.textureType,
                    false
                );
            },
            parsedPostProcess,
            scene,
            rootUrl
        );
    }
}

RegisterClass("BABYLON.MotionBlurPostProcess", MotionBlurPostProcess);
