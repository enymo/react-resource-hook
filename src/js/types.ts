import type { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import type { DeepPartial } from "ts-essentials";
import type { Params, Resource, RouteFunction } from "./publicTypes";

export type UpdateMethod = "on-success" | "immediate" | "local-only";



export type Param = string | number | boolean | undefined;


export interface ResourceContext {
    /**
     * The axios instance to be used for all requests by the resource hook. If you don't need a custom instance,
     * you can pass the global axios import instead
     */
    axios: AxiosInstance,
    /**
     * The route function to be used. The resource hook was developed to be used with laravel and ziggy-js, but any route function
     * that uses the same function signature can be used.
     * 
     * NOTE: As of 06/12/2023, ziggy-js types are incorrect, even though the implementation isn't. Therefore, ziggys 'route' has to
     * be cast to RouteFunction to be used with the resource hook
     */
    routeFunction: RouteFunction,
    /**
     * Should be set to true if the hook is used in a react native project. This slightly changes the behavior of the hooks form data
     * converter to account for react natives unique handling of file uploads.
     */
    reactNative?: boolean
}

export type OnCreatedListener<T extends Resource> = (item: T) => void;
export type OnUpdatedListener<T extends Resource> = (item: DeepPartial<T>) => void;
export type OnDestroyedListener<T extends Resource> = (item: T["id"]) => void

export interface OptionsCommon<T extends Resource, U> {
    /**
     * Additional parameters to be passed to the resource. Can be additional path parameters or query parameters
     */
    params?: Params,
    /**
     * Called every time an item is updated for the current resource (either using the 'update' method or by receiving the respective socket event)
     * @param item The (partial) item that has been updated (already transformed)
     */
    onUpdated?: OnUpdatedListener<T>,
    /**
     * Called every time an item is destroyed for the current resource (either using the 'destroy' method or by receiving the respective socket event)
     * @param id The id of the item that has been destroyed
     */
    onDestroyed?: OnDestroyedListener<T>,
    /**
     * Whether to automatically refresh the resource when the configuration of the hook changes.
     */
    autoRefresh?: boolean,
    ignoreContext?: boolean
}

export interface OptionsList<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * Called every time a new item is created for the current resource (either using the 'store' method or by receiving the respective socket event)
     * @param item The item that has been created (already transformed)
     */
    onCreated?: OnCreatedListener<T>,
    sorter?(a: T, b: T): 1 | 0 | -1
}

export interface OptionsSingle<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * The id of the resource to be requested or 'single' if it is a [singleton resource]{@link https://www.google.de}
     */
    id: T["id"] | "single" | null,
}

export interface OptionsImplementation<T extends Resource, U> extends OptionsCommon<T, U> {
    id?: T["id"] | "single" | null,
    onCreated?: OptionsList<T, U>["onCreated"],
    sorter?: OptionsList<T, U>["sorter"]
}

export interface ReturnCommon<T extends Resource, U> {
    /**
     * Whether the current resource is still being fetched after initial render or parameter change
     */
    loading: boolean,
    /**
     * Stores a new item in the current resource
     * @param item The item to be stored
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns The created resource.
     */
    store: (item?: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<T>,
    /**
     * Fully refreshed the resource by sending the initial get request again.
     * @param config An axios request config to be used to the request
     * @returns A void promise that resolves when the refresh is complete.
     */
    refresh: (config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Error that occured during last auto-refresh. null if no error occured or refresh is still in progress
     */
    error: AxiosError<any> | null
}

export interface CreateBackendOptions<T, U> {
    adapter: {
        create: (context: T, resource: Resource, config: U) => Promise<Resource> | Resource,
        update: (context: T, resource: Partial<Resource>, config: U) => Promise<Resource> | Resource,
        destroy: (context: T, id: Resource["id"], config: U) => Promise<void> | void,
        eventHook: (event: string, handler: (payload: Resource) => void, dependencies?: React.DependencyList) => void
    }
}