import useSocket, { useSocketClient } from "@enymo/react-socket-hook";
import { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import pluralize from "pluralize";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { filter, identity, isNotNull, objectToFormData, pruneUnchanged, requireNotNull } from "./util";

type UpdateMethod = "on-success" | "immediate" | "local-only";
type Param = string|number|boolean;
export type Params = {[param: string]: Param|Param[]|Params}

export interface Resource {
    id: string|number
}

interface OptionsCommon<T extends Resource, U> {
    /**
     * The name of the main resource parameter.
     * If not provided, it is auto-guessed as the singular of the final part of the resource name
     */
    paramName?: string,
    /**
     * Additional parameters to be passed to the resource. Can be additional path parameters or query parameters
     */
    params?: Params,
    /**
     * The name of the event where updates for this resource will be received via websockets.
     * If not provided, it is auto-guessed as part-a.part-a-param.part-b.part-b-param etc.
     */
    socketEvent?: string,
    /**
     * The default update method to be used
     */
    defaultUpdateMethod?: UpdateMethod,
    /**
     * If true, request will be made with content type 'multipart/form-data' instead of 'application/json'. Necessary for sending files. 
     * Please note that all limitations of the FormData object apply, such as all values being cast to strings.
     * Put requests will also be sent instead as Post requests with an added '_method' field to spoof the method 
     */
    useFormData?: boolean,
    /**
     * Whether to automatically refresh the resource when the configuration of the hook changes.
     */
    autoRefresh?: boolean,
    /**
     * If set to true, will remove all unchanged values from the payload before sending
     */
    pruneUnchanged?: boolean,
    /**
     * Function to transform incoming data. Can be used to deserialize data coming from the api.
     * If an asynchronous function is passed, all items will be transformed concurrently and displayed once all promises resolve.
     * @param item A single serialized item from the api
     */
    transformer?(item: any): DeepPartial<T> | Promise<DeepPartial<T>>,
    /**
     * The inverse of the transformer, serializing data for sending to the api. See transformer for details.
     * @param item A single item to be serialized for the api
     */
    inverseTransformer?(item: DeepPartial<U>): any | Promise<any>,
    /**
     * Called every time an item is updated for the current resource (either using the 'update' method or by receiving the respective socket event)
     * @param item The (partial) item that has been updated (already transformed)
     * @returns False if the event should be ignored
     */
    onUpdated?(item: DeepPartial<T>): boolean,
    /**
     * Called every time an item is destroyed for the current resource (either using the 'destroy' method or by receiving the respective socket event)
     * @param id The id of the item that has been destroyed
     * @returns True, if the item should actually be destroyed, false if the event should be ignored
     */
    onDestroyed?(id: T["id"]): boolean
}

interface OptionsList<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * If true, the hook expects extra data to be returned from the initial get request to consist of an 'extra' field containing any extra data to be returned
     * and a 'data' field containing the actual resource data.
     */
    withExtra?: boolean,
    /**
     * Called every time a new item is created for the current resource (either using the 'store' method or by receiving the respective socket event)
     * @param item The item that has been created (already transformed)
     * @returns False if the event should be ignored
     */
    onCreated?(item: T): boolean,
    sorter?(a: T, b: T): 1 | 0 | -1
}

interface OptionsSingle<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * The id of the resource to be requested or 'single' if it is a [singleton resource]{@link https://www.google.de}
     */
    id: T["id"] | "single" | null,
}

interface OptionsImplementation<T extends Resource, U> extends OptionsCommon<T, U> {
    id?: T["id"] | "single",
    withExtra?: boolean,
    onCreated?: OptionsList<T, U>["onCreated"],
    sorter?: OptionsList<T, U>["sorter"]
}

interface ReturnCommon<T extends Resource, U> {
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
    store: (item?: DeepPartial<U>, updaetMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<T | null>,
    /**
     * Fully refreshed the resource by sending the initial get request again.
     * @param config An axios request config to be used to the request
     * @returns A void promise that resolves when the refresh is complete.
     */
    refresh: (config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Error that occured during last auto-refresh. null if no error occured or refresh is still in progress
     */
    error: AxiosError | null
}

export interface ReturnList<T extends Resource, U, V> extends ReturnCommon<T, U> {
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
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (id: T["id"], update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Destroys an item for the current resource
     * @param id The id of the item to destroy
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (id: T["id"], updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Extra data returned from the initial get request. Requires 'withExtra' option to be set to 'true'. See documentation
     * for this option for the expected response format
     */
    extra: V | null
}

export interface ReturnSingle<T extends Resource, U = T> extends ReturnCommon<T, U> {
    /**
     * Updates the current item
     * @param update Partial item. Omitted fields will be considered unchanged.
     * @param updateMethod The update method to be used
     *  'on-success' will only update the resource in the frontend once the backend returns a successful response.
     *      The frontend will be updated using the data from the backends response (which might be different from the data sent in the request)
     *  'immediate' will update the resource in the frontend immediately while also sending the request to the backend. The frontend will be updated using
     *      only the data provided in the request, but a subsequent 'updated' event (socket only) may update the item again once the requests succeeeds
     *  'local-only' will only update the frontend with the values provided, without sending any request to the backend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Destroys the current item
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>
}

export type RouteFunction = (route: string, params?: Params) => string

const Context = createContext<{
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
} | null>(null);

export const ResourceProvider = Context.Provider;

/**
 * 
 * @param resource 
 * @param options 
 */
export default function useResource<T extends Resource, U = T, V = null>(resource: string | null, options?: OptionsList<T, U>): [T[], ReturnList<T, U, V>];
export default function useResource<T extends Resource, U extends object = T>(resource: string | null, options: OptionsSingle<T, U>): [T | null, ReturnSingle<T, U>];
export default function useResource<T extends Resource, U extends object = T, V = null>(resource: string | null, {
    id,
    paramName: paramNameOverride,
    params,
    socketEvent: eventOverrideProp,
    defaultUpdateMethod = "on-success",
    useFormData = false,
    autoRefresh = true,
    withExtra = false,
    pruneUnchanged: pruneUnchangedProp = false,
    transformer = identity,
    inverseTransformer = identity,
    onCreated,
    onUpdated,
    onDestroyed,
    sorter
}: OptionsImplementation<T, U> = {}): [T[] | T | null, ReturnList<T, U, V> | ReturnSingle<T, U>] {
    const isArray = useCallback((input: T | T[] | null): input is T[] => {
        return id === undefined;
    }, [id]);

    const {axios, routeFunction, reactNative = false} = requireNotNull(useContext(Context));
    const [state, setState] = useState<T[] | T | null>(id === undefined ? [] : null);
    const sortedState = useMemo(() => (!isArray(state) || !sorter) ? state : state.toSorted(sorter), [state, sorter, isArray]);
    const [extra, setExtra] = useState<V | null>(null);
    const [error, setError] = useState<AxiosError | null>(null);
    const [loading, setLoading] = useState(autoRefresh);
    const [eventOverride, setEventOverride] = useState<string | null>(null);
    
    const socketClient = useSocketClient();
    const event = useMemo(() => socketClient && (eventOverrideProp ?? eventOverride ?? resource?.split(".").map(part => {
        const singular = pluralize.singular(part);
        return (params && singular in params) ? `${part}.${params[singular]}` : part;
    }).join(".") ?? null), [
        params,
        socketClient,
        eventOverrideProp,
        eventOverride,
        resource
    ]);
    const paramName = useMemo(() => paramNameOverride ?? (resource && pluralize.singular(requireNotNull(resource.split(".").pop())).replace(/-/g, "_")), [paramNameOverride, resource]);

    const handleCreated = useCallback((item: T) => {
        if (onCreated?.(item) ?? true) {
            setState(prev => (isNotNull(prev) && (prev as T[]).find(s => s.id == item.id)) ? prev : [...prev as T[], item]);
        }
    }, [onCreated, setState]);
    const handleUpdated = useCallback((item: DeepPartial<T>) => {
        if (onUpdated?.(item) ?? true) {
            setState(prev => isArray(prev) ? (prev.map(s => s.id == item.id ? Object.assign(s, item) : s)) : {...prev, ...item} as T)
        }
    }, [onUpdated, setState]);
    const handleDestroyed = useCallback((delId: T["id"]) => {
        if (onDestroyed?.(delId) ?? true) {
            if (id !== undefined) {
                setState(null);
            }
            else {
                setState(prev => (prev as T[]).filter(s => s.id !== id));
            }
        }
        
    }, [onDestroyed, setState, id]);

    useSocket<Resource>((id === undefined && event) ? `${event}.created` : null, async item => !loading && handleCreated(filter(await transformer(item) as T)), [loading, handleCreated]);
    useSocket<Resource>(event && `${event}.updated`, async item => (!loading && (id === undefined || item.id === (state as T).id)) && handleUpdated(filter(await transformer(item))), [id, state, loading, handleUpdated]);
    useSocket<number|string>(event && `${event}.destroyed`, delId => !loading && (id === undefined || delId === (state as T).id) && handleDestroyed(delId), [id, state, loading, handleDestroyed]);

    const store = useCallback(async (item: DeepPartial<U> = {} as DeepPartial<U>, updateMethodOverride?: UpdateMethod,  config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const body = await inverseTransformer(item);
        const promise = updateMethod !== "local-only" ? axios.post(routeFunction(`${resource}.store`, params), useFormData ? objectToFormData(body, reactNative) : body, useFormData ? {
            ...config,
            headers: {
                ...config?.headers,
                "content-type": "multipart/form-data"
            },
        } : config) : null;
        if (updateMethod === "on-success" || id !== undefined) {
            const result = await transformer((await promise!).data) as T;
            if (id === undefined) {
                handleCreated(result);
            }
            return result;
        }
        else {
            handleCreated(item as T);
            if (updateMethod !== "local-only") {
                const result = await transformer((await promise!).data) as T;
                setState(prev => (prev as T[]).map(i => i === item ? result : i));
                return result;
            }
            return null;
        }
    }, [axios, resource, params, routeFunction, transformer, inverseTransformer]);

    const updateList = useCallback(async (id: T["id"] | "single", update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const route = routeFunction(`${resource}.update`, id === "single" ? params : {
            [paramName!]: id,
            ...params
        });
        const body = filter(await inverseTransformer(pruneUnchangedProp ? pruneUnchanged(update, requireNotNull(isArray(state) ? state.find(item => item.id == id) : state, "update called before state ready"), reactNative) : update));
        const promise = updateMethod !== "local-only" ? (useFormData ? axios.post<U>(route, objectToFormData({
            ...body,
            _method: "put"
        }, reactNative), {
            ...config,
            headers: {
                ...config?.headers,
                "content-type": "multipart/form-data"
            }
        }) : axios.put<U>(route, body, config)) : null;
        if (updateMethod === "on-success") {
            handleUpdated(filter(await transformer((await promise!).data)));
        }
        else {
            handleUpdated(update as DeepPartial<T>);
        }
    }, [state, axios, paramName, resource, params, routeFunction, inverseTransformer, transformer, defaultUpdateMethod]);

    const updateSingle = useCallback((update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        return updateList(requireNotNull(id), update, updateMethodOverride, config);
    }, [id, updateList]);

    const destroyList = useCallback(async (id: T["id"] | "single", updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const promise = updateMethod !== "local-only" && axios.delete(routeFunction(`${resource}.destroy`, id === "single" ? params : {
            [paramName!]: id,
            ...params
        }), config);
        if (updateMethod !== "immediate") {
            await promise;
        }
        handleDestroyed(id);
    }, [axios, resource, params, routeFunction]);

    const destroySingle = useCallback((updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => destroyList(requireNotNull(id), updateMethodOverride, config), [destroyList, id]);

    const refresh = useCallback(async (config?: AxiosRequestConfig) => {
        try {
            setError(null);
            if (resource && id !== null) {
                setLoading(true);
                const response = await axios.get(id ? routeFunction(`${resource}.show`, id === "single" ? params : {
                    [paramName!]: id,
                    ...params
                }) : routeFunction(`${resource}.index`, params), config);
                setEventOverride(response.headers["x-socket-event"] ?? null);
                const data = (() => {
                    if (withExtra) {
                        const {data, ...extra} = response.data;
                        setExtra(extra);
                        return data;
                    }
                    else {
                        return response.data;
                    }
                })()
                setState(await (id ? transformer(data) as T : Promise.all(data.map(transformer))));
            }
            else {
                setEventOverride(null);
                setState(id === undefined ? [] : null);
            }
        }
        finally {
            setLoading(false);
        }
    }, [axios, routeFunction, setState, resource, id, setEventOverride, setLoading, transformer, params, setError]);

    useEffect(() => {
        if (autoRefresh) {
            refresh().catch(e => {
                if (e instanceof AxiosError) {
                    setError(e);
                }
                else {
                    throw e;
                }
            });    
        }
    }, [refresh, autoRefresh, setError]);

    return [sortedState, id ? {loading, store, refresh, update: updateSingle, destroy: destroySingle, error} : {loading, store, update: updateList, destroy: destroyList, refresh, extra, error}]
}