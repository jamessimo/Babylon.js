import type { WebXRAbstractMotionController, IMotionControllerProfile } from "./webXRAbstractMotionController";
import { WebXRGenericTriggerMotionController } from "./webXRGenericMotionController";
import type { Scene } from "../../scene";
import { Tools } from "../../Misc/tools";
import { WebXRProfiledMotionController } from "./webXRProfiledMotionController";
import type { Nullable } from "../../types";
import type { AbstractMesh } from "../../Meshes/abstractMesh";

/**
 * A construction function type to create a new controller based on an xrInput object
 */
export type MotionControllerConstructor = (xrInput: XRInputSource, scene: Scene) => WebXRAbstractMotionController;

/**
 * The MotionController Manager manages all registered motion controllers and loads the right one when needed.
 *
 * When this repository is complete: https://github.com/immersive-web/webxr-input-profiles/tree/master/packages/assets
 * it should be replaced with auto-loaded controllers.
 *
 * When using a model try to stay as generic as possible. Eventually there will be no need in any of the controller classes
 */

const ControllerCache: Array<{
    filename: string;
    path: string;
    meshes: AbstractMesh[];
}> = [];

/**
 * Motion controller manager is managing the different webxr profiles and makes sure the right
 * controller is being loaded.
 */
export class WebXRMotionControllerManager {
    private static _AvailableControllers: { [type: string]: MotionControllerConstructor } = {};
    private static _Fallbacks: { [profileId: string]: string[] } = {};
    // cache for loading
    private static _ProfileLoadingPromises: { [profileName: string]: Promise<IMotionControllerProfile> } = {};
    private static _ProfilesList: Nullable<Promise<{ [profile: string]: string }>>;

    /**
     * The base URL of the online controller repository. Can be changed at any time.
     */
    public static BaseRepositoryUrl = "https://immersive-web.github.io/webxr-input-profiles/packages/viewer/dist";
    /**
     * Which repository gets priority - local or online
     */
    public static PrioritizeOnlineRepository: boolean = true;
    /**
     * Use the online repository, or use only locally-defined controllers
     */
    public static UseOnlineRepository: boolean = true;

    /**
     * Disable the controller cache and load the models each time a new WebXRProfileMotionController is loaded.
     * Defaults to true.
     */
    public static DisableControllerCache: boolean = true;

    /**
     * Clear the cache used for profile loading and reload when requested again
     */
    public static ClearProfilesCache() {
        this._ProfilesList = null;
        this._ProfileLoadingPromises = {};
    }

    /**
     * Register the default fallbacks.
     * This function is called automatically when this file is imported.
     */
    public static DefaultFallbacks() {
        this.RegisterFallbacksForProfileId("google-daydream", ["generic-touchpad"]);
        this.RegisterFallbacksForProfileId("htc-vive-focus", ["generic-trigger-touchpad"]);
        this.RegisterFallbacksForProfileId("htc-vive", ["generic-trigger-squeeze-touchpad"]);
        this.RegisterFallbacksForProfileId("magicleap-one", ["generic-trigger-squeeze-touchpad"]);
        this.RegisterFallbacksForProfileId("windows-mixed-reality", ["generic-trigger-squeeze-touchpad-thumbstick"]);
        this.RegisterFallbacksForProfileId("microsoft-mixed-reality", ["windows-mixed-reality", "generic-trigger-squeeze-touchpad-thumbstick"]);
        this.RegisterFallbacksForProfileId("oculus-go", ["generic-trigger-touchpad"]);
        this.RegisterFallbacksForProfileId("oculus-touch-v2", ["oculus-touch", "generic-trigger-squeeze-thumbstick"]);
        this.RegisterFallbacksForProfileId("oculus-touch", ["generic-trigger-squeeze-thumbstick"]);
        this.RegisterFallbacksForProfileId("samsung-gearvr", ["windows-mixed-reality", "generic-trigger-squeeze-touchpad-thumbstick"]);
        this.RegisterFallbacksForProfileId("samsung-odyssey", ["generic-touchpad"]);
        this.RegisterFallbacksForProfileId("valve-index", ["generic-trigger-squeeze-touchpad-thumbstick"]);
        this.RegisterFallbacksForProfileId("generic-hand-select", ["generic-trigger"]);
    }

    /**
     * Find a fallback profile if the profile was not found. There are a few predefined generic profiles.
     * @param profileId the profile to which a fallback needs to be found
     * @returns an array with corresponding fallback profiles
     */
    public static FindFallbackWithProfileId(profileId: string): string[] {
        const returnArray = this._Fallbacks[profileId] || [];

        returnArray.unshift(profileId);
        return returnArray;
    }

    /**
     * When acquiring a new xrInput object (usually by the WebXRInput class), match it with the correct profile.
     * The order of search:
     *
     * 1) Iterate the profiles array of the xr input and try finding a corresponding motion controller
     * 2) (If not found) search in the gamepad id and try using it (legacy versions only)
     * 3) search for registered fallbacks (should be redundant, nonetheless it makes sense to check)
     * 4) return the generic trigger controller if none were found
     *
     * @param xrInput the xrInput to which a new controller is initialized
     * @param scene the scene to which the model will be added
     * @param forceProfile force a certain profile for this controller
     * @returns A promise that fulfils with the motion controller class for this profile id or the generic standard class if none was found
     */
    public static async GetMotionControllerWithXRInput(xrInput: XRInputSource, scene: Scene, forceProfile?: string): Promise<WebXRAbstractMotionController> {
        const profileArray: string[] = [];
        if (forceProfile) {
            profileArray.push(forceProfile);
        }
        profileArray.push(...(xrInput.profiles || []));

        // emulator support
        if (profileArray.length && !profileArray[0]) {
            // remove the first "undefined" that the emulator is adding
            profileArray.pop();
        }

        // legacy support - try using the gamepad id
        if (xrInput.gamepad && xrInput.gamepad.id) {
            switch (xrInput.gamepad.id) {
                case xrInput.gamepad.id.match(/oculus touch/gi) ? xrInput.gamepad.id : undefined:
                    // oculus in gamepad id
                    profileArray.push("oculus-touch-v2");
                    break;
            }
        }

        // make sure microsoft/windows mixed reality works correctly
        const windowsMRIdx = profileArray.indexOf("windows-mixed-reality");
        if (windowsMRIdx !== -1) {
            profileArray.splice(windowsMRIdx, 0, "microsoft-mixed-reality");
        }

        if (!profileArray.length) {
            profileArray.push("generic-trigger");
        }

        if (this.UseOnlineRepository) {
            const firstFunction = this.PrioritizeOnlineRepository ? this._LoadProfileFromRepositoryAsync : this._LoadProfilesFromAvailableControllersAsync;
            const secondFunction = this.PrioritizeOnlineRepository ? this._LoadProfilesFromAvailableControllersAsync : this._LoadProfileFromRepositoryAsync;

            // eslint-disable-next-line github/no-then
            return firstFunction.call(this, profileArray, xrInput, scene).catch(() => {
                return secondFunction.call(this, profileArray, xrInput, scene);
            });
        } else {
            // use only available functions
            return await this._LoadProfilesFromAvailableControllersAsync(profileArray, xrInput, scene);
        }
    }

    /**
     * Register a new controller based on its profile. This function will be called by the controller classes themselves.
     *
     * If you are missing a profile, make sure it is imported in your source, otherwise it will not register.
     *
     * @param type the profile type to register
     * @param constructFunction the function to be called when loading this profile
     */
    public static RegisterController(type: string, constructFunction: MotionControllerConstructor) {
        this._AvailableControllers[type] = constructFunction;
    }

    /**
     * Register a fallback to a specific profile.
     * @param profileId the profileId that will receive the fallbacks
     * @param fallbacks A list of fallback profiles
     */
    public static RegisterFallbacksForProfileId(profileId: string, fallbacks: string[]): void {
        if (this._Fallbacks[profileId]) {
            this._Fallbacks[profileId].push(...fallbacks);
        } else {
            this._Fallbacks[profileId] = fallbacks;
        }
    }

    /**
     * Will update the list of profiles available in the repository
     * @returns a promise that resolves to a map of profiles available online
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public static async UpdateProfilesList(): Promise<{
        [profile: string]: string;
    }> {
        const data = await Tools.LoadFileAsync(this.BaseRepositoryUrl + "/profiles/profilesList.json", false);
        this._ProfilesList = JSON.parse(data);
        return await this._ProfilesList!;
    }

    /**
     * Clear the controller's cache (usually happens at the end of a session)
     */
    public static ClearControllerCache() {
        for (const cacheItem of ControllerCache) {
            for (const mesh of cacheItem.meshes) {
                mesh.dispose(false, true);
            }
        }
        ControllerCache.length = 0;
    }

    private static async _LoadProfileFromRepositoryAsync(profileArray: string[], xrInput: XRInputSource, scene: Scene): Promise<WebXRAbstractMotionController> {
        return await Promise.resolve()
            // eslint-disable-next-line github/no-then
            .then(async () => {
                if (!this._ProfilesList) {
                    return await this.UpdateProfilesList();
                } else {
                    return await this._ProfilesList;
                }
            })
            // eslint-disable-next-line github/no-then
            .then((profilesList: { [profile: string]: string }) => {
                // load the right profile
                for (let i = 0; i < profileArray.length; ++i) {
                    // defensive
                    if (!profileArray[i]) {
                        continue;
                    }
                    if (profilesList[profileArray[i]]) {
                        return profileArray[i];
                    }
                }

                throw new Error(`neither controller ${profileArray[0]} nor all fallbacks were found in the repository,`);
            })
            // eslint-disable-next-line github/no-then
            .then(async (profileToLoad: string) => {
                // load the profile
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                if (!this._ProfileLoadingPromises[profileToLoad]) {
                    // eslint-disable-next-line github/no-then
                    this._ProfileLoadingPromises[profileToLoad] = Tools.LoadFileAsync(`${this.BaseRepositoryUrl}/profiles/${profileToLoad}/profile.json`, false).then(
                        (data) => <IMotionControllerProfile>JSON.parse(data)
                    );
                }
                return await this._ProfileLoadingPromises[profileToLoad];
            })
            // eslint-disable-next-line github/no-then
            .then((profile: IMotionControllerProfile) => {
                return new WebXRProfiledMotionController(scene, xrInput, profile, this.BaseRepositoryUrl, this.DisableControllerCache ? undefined : ControllerCache);
            });
    }

    private static async _LoadProfilesFromAvailableControllersAsync(profileArray: string[], xrInput: XRInputSource, scene: Scene) {
        // check fallbacks
        for (let i = 0; i < profileArray.length; ++i) {
            // defensive
            if (!profileArray[i]) {
                continue;
            }
            const fallbacks = this.FindFallbackWithProfileId(profileArray[i]);
            for (let j = 0; j < fallbacks.length; ++j) {
                const constructionFunction = this._AvailableControllers[fallbacks[j]];
                if (constructionFunction) {
                    return constructionFunction(xrInput, scene);
                }
            }
        }

        throw new Error(`no controller requested was found in the available controllers list`);
    }
}

// register the generic profile(s) here so we will at least have them
WebXRMotionControllerManager.RegisterController(WebXRGenericTriggerMotionController.ProfileId, (xrInput: XRInputSource, scene: Scene) => {
    return new WebXRGenericTriggerMotionController(scene, <any>xrInput.gamepad, xrInput.handedness);
});

// register fallbacks
WebXRMotionControllerManager.DefaultFallbacks();
