import type { DeepPartial } from "ts-essentials";

export interface Resource {
    id?: string | number
}

export interface ReturnCommon<RequestConfig, Error, T extends Resource, U> {
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
    store: (item?: DeepPartial<U>, updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<T>,
    /**
     * Fully refreshed the resource by sending the initial get request again.
     * @param config An axios request config to be used to the request
     * @returns A void promise that resolves when the refresh is complete.
     */
    refresh: (config?: RequestConfig) => Promise<void>,
    /**
     * Error that occured during last auto-refresh. null if no error occured or refresh is still in progress
     */
    error: Error | null
}

export interface ReturnList<RequestConfig, Error, T extends Resource, U, V> extends ReturnCommon<RequestConfig, Error, T, U> {
    /**
     * Updates an existing item for the current resource
     * @param id The id of the item to update
     * @param update Partial item. Omitted fields are considered unchanged.
     * @param updateMethod The update method to be used
     *  'on-success' will only update the resource in the frontend once the backend returns a successful response.
     *      The frontend will be updated using the data from the backends response (which might be different from the data sent in the request)
     *  'immediate' will update the resource in the frontend immediately while also sending the request to the backend. The frontend will be updated using
     *      only the data provided in the request, but a subsequent 'updated' event (socket only) may update the item again once the requests succeeeds
     *  'local-only' will only update the frontend with the values provided, without sending any request to the backend
     * @param config A RequestConfig may be passed to be used for the request (structure is determined by adapter)
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (id: T["id"], update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<void>,
    batchUpdate: (update: (DeepPartial<U> & {id: T["id"]})[], updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<void>,
    /**
     * Destroys an item for the current resource
     * @param id The id of the item to destroy
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config A RequestConfig may be passed to be used for the request (structure is determined by adapter)
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (id: T["id"], updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<void>,
    /**
     * Extra data returned from the initial get request. Requires 'withExtra' option to be set to 'true'. See documentation
     * for this option for the expected response format
     */
    extra: V | null
}

export interface ReturnSingle<RequestConfig, Error, T extends Resource, U = T> extends ReturnCommon<RequestConfig, Error, T, U> {
    /**
     * Updates the current item
     * @param update Partial item. Omitted fields will be considered unchanged.
     * @param updateMethod The update method to be used
     *  'on-success' will only update the resource in the frontend once the backend returns a successful response.
     *      The frontend will be updated using the data from the backends response (which might be different from the data sent in the request)
     *  'immediate' will update the resource in the frontend immediately while also sending the request to the backend. The frontend will be updated using
     *      only the data provided in the request, but a subsequent 'updated' event (socket only) may update the item again once the requests succeeeds
     *  'local-only' will only update the frontend with the values provided, without sending any request to the backend
     * @param config A RequestConfig may be passed to be used for the request (structure is determined by adapter)
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<void>,
    /**
     * Destroys the current item
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config A RequestConfig may be passed to be used for the request (structure is determined by adapter)
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (updateMethod?: UpdateMethod, config?: RequestConfig) => Promise<void>
}

export type Params = {[param: string]: Param | Param[] | Params}
export type RouteFunction = (route: string, params?: Params) => string

export type UpdateMethod = "on-success" | "immediate" | "local-only";



export type Param = string | number | boolean | undefined;

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

export type MaybePromise<T> = Promise<T> | T

type ResourceResponse<T extends Resource, U = null> = {
    data: T[],
    extra: U
}

export interface CreateBackendOptions<ResourceConfig extends {}, UseConfig extends {}, RequestConfig, Error> {
    adapter: (resource: string, config: Partial<ResourceConfig>) => {
        actionHook: <T extends Resource>(config: Partial<UseConfig>, params?: Params) => ({
            store: (resource: any, config: RequestConfig | undefined) => MaybePromise<T>,
            batchStore: (resources: any[], config: RequestConfig | undefined) => MaybePromise<T[]>,
            update: (id: Resource["id"], resource: any, config: RequestConfig | undefined) => MaybePromise<DeepPartial<T>>,
            batchUpdate: (resources: any[], config: RequestConfig | undefined) => MaybePromise<DeepPartial<T>[]>,
            destroy: (id: Resource["id"], config: RequestConfig | undefined) => MaybePromise<void>,
            batchDestroy: (ids: Resource["id"][], config: RequestConfig | undefined) => MaybePromise<void>,
            refresh: <U = null>(config: RequestConfig | undefined) => MaybePromise<ResourceResponse<T, U>>,
            query: (data: any, config: RequestConfig | undefined) => MaybePromise<T | T[] | null>
        }),
        eventHook: <T extends Resource | Resource["id"]>(params: Params | undefined, event: "created" | "updated" | "destroyed", handler?: (payload: T) => void, dependencies?: React.DependencyList) => void
    }
}