import { createRequiredContext } from "@enymo/react-better-context";
import useSocket, { useSocketClient } from "@enymo/react-socket-hook";
import { isNotNull, requireNotNull } from "@enymo/ts-nullsafe";
import { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import pluralize from "pluralize";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { filter, identity, objectNeedsFormDataConversion, objectToFormData, pruneUnchanged } from "./util";

type UpdateMethod = "on-success" | "immediate" | "local-only";

export interface Resource {
    id: string | number
}

type Param = string | number | boolean | undefined;
export type Params = {[param: string]: Param | Param[] | Params}
export type RouteFunction = (route: string, params?: Params) => string

const [ResourceProvider, useResourceConfig] = createRequiredContext<{
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
}>("ResourceProvider must be present in the component tree");
export { ResourceProvider };

type OnCreatedListener<T extends Resource> = (item: T) => void;
type OnUpdatedListener<T extends Resource> = (item: DeepPartial<T>) => void;
type OnDestroyedListener<T extends Resource> = (item: T["id"]) => void

export type Segmented<T, V = {}> = Promise<{
    saved: Promise<T>
} & V>

interface OptionsCommon<T extends Resource, U> {
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

interface OptionsList<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * Called every time a new item is created for the current resource (either using the 'store' method or by receiving the respective socket event)
     * @param item The item that has been created (already transformed)
     */
    onCreated?: OnCreatedListener<T>,
    sorter?(a: T, b: T): 1 | 0 | -1
}

interface OptionsSingle<T extends Resource, U> extends OptionsCommon<T, U> {
    /**
     * The id of the resource to be requested or 'single' if it is a [singleton resource]{@link https://www.google.de}
     */
    id: T["id"] | "single" | null,
}

interface OptionsImplementation<T extends Resource, U> extends OptionsCommon<T, U> {
    id?: T["id"] | "single" | null,
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
    store: (item?: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Segmented<T | null>,
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
    update: (id: T["id"], update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Segmented<void>,
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
    destroy: (id: T["id"], updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Segmented<void>,
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
    update: (update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Segmented<void>,
    /**
     * Destroys the current item
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Segmented<void>
}

export default function createResource<T extends Resource, U extends object = T, V = null>(resource: string, {
    paramName: paramNameOverride,
    socketEvent: eventOverrideConfig,
    defaultUpdateMethod = "on-success",
    useFormData = false,
    withExtra = false,
    pruneUnchanged: pruneUnchangedOverride = false,
    transformer = identity,
    inverseTransformer = identity
}: {
    paramName?: string,
    socketEvent?: string,
    defaultUpdateMethod?: UpdateMethod,
    useFormData?: boolean,
    pruneUnchanged?: boolean,
    withExtra?: boolean,
    transformer?(item: any): DeepPartial<T> | Promise<DeepPartial<T>>,
    inverseTransformer?(item: DeepPartial<U>): any | Promise<any>
} = {}) {
    const ResourceContext = createContext<{
        state: T[],
        actions: ReturnList<T, U, V>,
        addCreatedListener(listener: OnCreatedListener<T>): void,
        removeCreatedListener(listener: OnCreatedListener<T>): void,
        addUpdatedListener(listener: OnUpdatedListener<T>): void,
        removeUpdatedListener(listener: OnUpdatedListener<T>): void,
        addDestroyedListener(listener: OnDestroyedListener<T>): void,
        removeDestroyedListener(listener: OnDestroyedListener<T>): void
    } | null>(null);

    const useResource = (({
        id,
        params,
        sorter,
        onCreated,
        onUpdated,
        onDestroyed,
        autoRefresh = true,
        ignoreContext = false
    }: OptionsImplementation<T, U> = {}) => {
        const isArray = useCallback((input: T | T[] | null): input is T[] => {
            return id === undefined;
        }, [id]);
    
        const resourceContext = useContext(ResourceContext);
        const {axios, routeFunction, reactNative = false} = useResourceConfig();
        const [localState, setState] = useState<T[] | T | null>(id === undefined ? [] : null);
        const state = useMemo(() => {
            if (!ignoreContext && isNotNull(resourceContext)) {
                if (id === undefined) {
                    return resourceContext.state;
                }
                else {
                    return resourceContext.state.find(value => value.id === id) ?? null
                }
            }
            else {
                return localState;
            }
        }, [ignoreContext, resourceContext, localState]);
        const sortedState = useMemo(() => (!isArray(state) || !sorter) ? state : [...state].sort(sorter), [state, sorter, isArray]);
        const [extra, setExtra] = useState<V | null>(null);
        const [error, setError] = useState<AxiosError | null>(null);
        const [loading, setLoading] = useState(autoRefresh);
        const [eventOverride, setEventOverride] = useState<string | null>(null);
        
        const socketClient = useSocketClient();
        const event = useMemo(() => socketClient && (eventOverrideConfig ?? eventOverride ?? resource?.split(".").map(part => {
            const singular = pluralize.singular(part);
            return (params && singular in params) ? `${part}.${params[singular]}` : part;
        }).join(".") ?? null), [
            params,
            socketClient,
            eventOverrideConfig,
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
                    setState(prev => (prev as T[]).filter(s => s.id !== delId));
                }
            }
            
        }, [onDestroyed, setState, id]);
    
        useSocket<Resource>(((ignoreContext || !isNotNull(resourceContext)) && id === undefined && event) ? `${event}.created` : null, async item => !loading && handleCreated(filter(await transformer(item) as T)), [loading, handleCreated]);
        useSocket<Resource>((ignoreContext || !isNotNull(resourceContext)) && event ? `${event}.updated` : null, async item => (!loading && (id === undefined || item.id === (state as T).id)) && handleUpdated(filter(await transformer(item))), [id, state, loading, handleUpdated]);
        useSocket<number|string>((ignoreContext || !isNotNull(resourceContext)) && event ? `${event}.destroyed` : null, delId => !loading && (id === undefined || delId === (state as T).id) && handleDestroyed(delId), [id, state, loading, handleDestroyed]);
    
        const store = useCallback(async (item: DeepPartial<U> = {} as DeepPartial<U>, updateMethodOverride?: UpdateMethod,  config?: AxiosRequestConfig) => {
            if (!ignoreContext && isNotNull(resourceContext)) {
                return resourceContext.actions.store(item, updateMethodOverride, config);
            }

            const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
            const body = await inverseTransformer(item);
            const promise = updateMethod !== "local-only" ? axios.post(routeFunction(`${resource}.store`, params), (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? objectToFormData(body, reactNative) : body, useFormData ? {
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
                return {
                    saved: Promise.resolve(result)
                };
            }
            else {
                handleCreated(item as T);
                if (updateMethod !== "local-only") {
                    return {
                        saved: (async () => {
                            const result = await transformer((await promise!).data) as T;
                            setState(prev => (prev as T[]).map(i => i === item ? result : i));
                            return result;
                        })()
                    }
                }
                return {
                    saved: Promise.resolve(null)
                };
            }
        }, [axios, params, routeFunction]);
    
        const updateList = useCallback(async (id: T["id"] | "single", update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
            if (!ignoreContext && isNotNull(resourceContext)) {
                return resourceContext.actions.update(id, update, updateMethodOverride, config);
            }

            const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
            const body = filter(await inverseTransformer(pruneUnchangedOverride ? pruneUnchanged(update, requireNotNull(isArray(state) ? state.find(item => item.id == id) : state, "update called before state ready"), reactNative) : update));
            const promise = updateMethod !== "local-only" ? (() => {
                const route = routeFunction(`${resource}.update`, id === "single" ? params : {
                    [paramName!]: id,
                    ...params
                });
                return (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? axios.post<U>(route, objectToFormData({
                    ...body,
                    _method: "put"
                }, reactNative), {
                    ...config,
                    headers: {
                        ...config?.headers,
                        "content-type": "multipart/form-data"
                    }
                }) : axios.put<U>(route, body, config)
            })() : null;
            if (updateMethod === "on-success") {
                handleUpdated(filter(await transformer((await promise!).data)));
                return {
                    saved: Promise.resolve()
                }
            }
            else {
                handleUpdated(update as DeepPartial<T>);
                return {
                    saved: promise ? (async () => {
                        handleUpdated(filter(await transformer((await promise!).data)));
                    })() : Promise.resolve()
                }
            }
        }, [state, axios, params, routeFunction]);
    
        const updateSingle = useCallback((update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
            return updateList(requireNotNull(id), update, updateMethodOverride, config);
        }, [id, updateList]);
    
        const destroyList = useCallback(async (id: T["id"] | "single", updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
            if (!ignoreContext && isNotNull(resourceContext)) {
                return resourceContext.actions.destroy(id, updateMethodOverride, config);
            }

            const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
            const promise = updateMethod !== "local-only" && axios.delete(routeFunction(`${resource}.destroy`, id === "single" ? params : {
                [paramName!]: id,
                ...params
            }), config);
            if (updateMethod !== "immediate") {
                await promise;
                handleDestroyed(id);
                return {
                    saved: Promise.resolve()
                }
            }
            else {
                handleDestroyed(id);
                return {
                    saved: promise || Promise.resolve()
                }
            }
        }, [axios, params, routeFunction]);
    
        const destroySingle = useCallback((updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => destroyList(requireNotNull(id), updateMethodOverride, config), [destroyList, id]);
    
        const refresh = useCallback(async (config?: AxiosRequestConfig) => {
            if (ignoreContext || !isNotNull(resourceContext)) {
                try {
                    setError(null);
                    if (id !== null) {
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
            }
        }, [axios, routeFunction, setState, id, setEventOverride, setLoading, params, setError, ignoreContext, resourceContext]);
    
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

        useEffect(() => {
            if (isNotNull(onCreated) && !ignoreContext && isNotNull(resourceContext)) {
                resourceContext.addCreatedListener(onCreated);
                return () => resourceContext.removeCreatedListener(onCreated);
            }
        }, [onCreated, ignoreContext, resourceContext]);

        useEffect(() => {
            if (isNotNull(onUpdated) && !ignoreContext && isNotNull(resourceContext)) {
                resourceContext.addUpdatedListener(onUpdated);
                return () => resourceContext.removeUpdatedListener(onUpdated);
            }
        }, [onUpdated, ignoreContext, resourceContext]);

        useEffect(() => {
            if (isNotNull(onDestroyed) && !ignoreContext && isNotNull(resourceContext)) {
                resourceContext.addDestroyedListener(onDestroyed);
                return () => resourceContext.removeDestroyedListener(onDestroyed);
            }
        }, [onDestroyed, ignoreContext, resourceContext]);
    
        return [sortedState, id ? {loading, store, refresh, update: updateSingle, destroy: destroySingle, error} : {loading, store, update: updateList, destroy: destroyList, refresh, extra, error}]
    }) as {
        (options?: OptionsList<T, U>): [T[], ReturnList<T, U, V>],
        (options: OptionsSingle<T, U>): [T | null, ReturnSingle<T, U>]
    }

    const ResourceProvider = ({params, children}: {
        params?: Params,
        children: React.ReactNode
    }) => {
        const createdListeners = useRef(new Set<OnCreatedListener<T>>());
        const updatedListeners = useRef(new Set<OnUpdatedListener<T>>());
        const destroyedListeners = useRef(new Set<OnDestroyedListener<T>>());

        const handleCreated = useCallback<OnCreatedListener<T>>(item => {
            for (const listener of createdListeners.current) {
                listener(item);
            }
        }, [createdListeners]);

        const handleUpdated = useCallback<OnUpdatedListener<T>>(item => {
            for (const listener of updatedListeners.current) {
                listener(item);
            }
        }, [updatedListeners]);

        const handleDestroyed = useCallback<OnDestroyedListener<T>>(id => {
            for (const listener of destroyedListeners.current) {
                listener(id);
            }
        }, [destroyedListeners]);

        const [state, actions] = useResource({
            params,
            onCreated: handleCreated,
            onUpdated: handleUpdated,
            onDestroyed: handleDestroyed
        });

        return (
            <ResourceContext.Provider value={{
                state,
                actions,
                addCreatedListener: useCallback(listener => createdListeners.current.add(listener), [createdListeners]),
                removeCreatedListener: useCallback(listener => createdListeners.current.delete(listener), [createdListeners]),
                addUpdatedListener: useCallback(listener => updatedListeners.current.add(listener), [updatedListeners]),
                removeUpdatedListener: useCallback(listener => updatedListeners.current.delete(listener), [updatedListeners]),
                addDestroyedListener: useCallback(listener => destroyedListeners.current.add(listener), [destroyedListeners]),
                removeDestroyedListener: useCallback(listener => destroyedListeners.current.delete(listener), [destroyedListeners])
            }}>
                {children}
            </ResourceContext.Provider>
        )
    }

    return [useResource, ResourceProvider] as const;
}