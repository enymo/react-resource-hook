import useSocket, { useSocketClient } from "@enymo/react-socket-hook";
import { AxiosInstance, AxiosRequestConfig } from "axios";
import pluralize from "pluralize";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { filter, identity, isNotNull, objectToFormData, pruneUnchanged, randomString, requireNotNull } from "./util";

type Handler<T, U> = (item: T, prev: U | null) => U;
type UpdateMethod = "on-success" | "immediate" | "local-only";
type Param = string|number|boolean;
export type Params = {[param: string]: Param|Param[]|Params}

export interface StatefulObject {
    _state?: string
}

export interface Resource extends StatefulObject {
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
     */
    inverseTransformer?(item: DeepPartial<U>): any | Promise<any>
}

type OnDestroyedList<T extends Resource> = (id: T["id"], prev: T[]) => T[]

interface OptionsList<T extends Resource, U> extends OptionsCommon<T, U> {
    withExtra?: boolean,
    onCreated?: Handler<T, T[]>,
    onUpdated?: Handler<DeepPartial<T>, T[]>,
    onDestroyed?: OnDestroyedList<T>
}

type OnDestroyedSingle<T extends Resource> = (item: T["id"]) => void;

interface OptionsSingle<T extends Resource, U> extends OptionsCommon<T, U> {
    id: T["id"] | "single",
    onUpdated?: Handler<DeepPartial<T>, T>,
    onDestroyed?: OnDestroyedSingle<T>
}

interface OptionsImplementation<T extends Resource, U> extends OptionsCommon<T, U> {
    id?: T["id"] | "single",
    withExtra?: boolean,
    onCreated?: Handler<T, T | T[]>,
    onUpdated?: Handler<DeepPartial<T>, T | T[]>,
    onDestroyed?: OnDestroyedSingle<T> | OnDestroyedList<T>
}

interface ReturnCommon<T extends Resource, U> {
    loading: boolean,
    store: (item?: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<T>,
    refresh: (config?: AxiosRequestConfig) => Promise<void>
}

export interface ReturnList<T extends Resource, U, V> extends ReturnCommon<T, U> {
    update: (id: T["id"], update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    destroy: (id: T["id"], updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    extra: V | null
}

export interface ReturnSingle<T extends Resource, U = T> extends ReturnCommon<T, U> {
    update: (update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    destroy: (updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>
}

export type RouteFunction = (route: string, params?: Params) => string

const Context = createContext<{
    axios: AxiosInstance,
    routeFunction: RouteFunction,
    reactNative?: boolean
} | null>(null);

export const ResourceProvider = Context.Provider;

/**
 * 
 * @param resource 
 * @param options 
 */
export default function useResource<T extends Resource, U extends StatefulObject = T, V = null>(resource: string | null, options?: OptionsList<T, U>): [T[] | null, ReturnList<T, U, V>];
export default function useResource<T extends Resource, U extends StatefulObject = T>(resource: string | null, options: OptionsSingle<T, U>): [T | null, ReturnSingle<T, U>];
export default function useResource<T extends Resource, U extends StatefulObject = T, V = null>(resource: string | null, {
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
    onDestroyed
}: OptionsImplementation<T, U> = {}): [T[] | T | null, ReturnList<T, U, V> | ReturnSingle<T, U>] {
    const {axios, routeFunction, reactNative = false} = requireNotNull(useContext(Context));
    const [state, setState] = useState<T[] | T | null>(id === undefined ? [] : null);
    const [extra, setExtra] = useState<V | null>(null);
    const [loading, setLoading] = useState(autoRefresh);
    const [eventOverride, setEventOverride] = useState<string | null>(null);
    
    const socketClient = useSocketClient();
    const event = useMemo(() => socketClient && (eventOverrideProp ?? eventOverride ?? resource?.split(".").map(part => {
        const singular = pluralize.singular(part);
        return (params && singular in params) ? `${part}.${params[singular]}` : part;
    }).join(".") ?? null), [
        socketClient,
        eventOverrideProp,
        eventOverride,
        resource
    ]);
    const paramName = useMemo(() => paramNameOverride ?? (resource && pluralize.singular(requireNotNull(resource.split(".").pop())).replace(/-/g, "_")), [paramNameOverride, resource]);

    const isArray = useCallback((input: T | T[] | null): input is T[] => {
        return id === undefined;
    }, [id]);

    const handle = useCallback(<U = T>(handler: Handler<U, T | T[]> | undefined, defaultHandler: Handler<U, T | T[]>) => (item: U) => {
        setState(prev => handler?.(item, prev) ?? defaultHandler(item, prev));
    }, [transformer, setState]);

    const handleCreated = useMemo(() => handle(onCreated, (item, prev) => (isNotNull(prev) && (prev as T[]).find(s => s.id == item.id || s._state === item._state)) ? prev : [...prev as T[], item]), [handle, onCreated]);
    const handleUpdated = useMemo(() => handle<DeepPartial<T>>(onUpdated, (item, prev) => isArray(prev) ? (prev.map(s => s.id == item.id ? Object.assign(s, item) : s)) : {...prev, ...item} as T), [handle, onUpdated]);
    const handleDestroyed = useCallback((delId: T["id"]) => {
        if (id !== undefined) {
            (onDestroyed as OnDestroyedSingle<T>)?.(delId);
            setState(null);
        }
        else {
            setState(prev => (onDestroyed?.(delId, prev as T[]) ?? ((id, prev) => (prev as T[]).filter(s => s.id !== id))(delId, prev)) as T[]);
        }
    }, [onDestroyed, setState, id]);

    useSocket<Resource>((id === undefined && event) ? `${event}.created` : null, async item => !loading && handleCreated(filter(await transformer(item) as T)), [loading, handleCreated]);
    useSocket<Resource>(event && `${event}.updated`, async item => (!loading && (id === undefined || item.id === id)) && handleUpdated(filter(await transformer(item))), [id, loading, handleUpdated]);
    useSocket<number|string>(event && `${event}.destroyed`, id => !loading && handleDestroyed(id), [loading, handleDestroyed]);

    const store = useCallback(async (item: DeepPartial<U> = {} as DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        if (updateMethod !== "on-success") {
            item._state = randomString(12);
        }
        const body = await inverseTransformer(item);
        const promise = updateMethod !== "local-only" ? axios.post(routeFunction(`${resource}.store`, params), useFormData ? objectToFormData(body, reactNative) : body, useFormData ? {
            ...config,
            headers: {
                ...config?.headers,
                "content-type": "multipart/form-data"
            },
        } : config) : null;
        if (updateMethod === "on-success") {
            const response = await promise!;
            const result = await transformer(response.data) as T;
            handleCreated(result);
            return result;
        }
        else {
            const result = {...item, id: null} as T;
            handleCreated(result);
            return result;
        }
    }, [axios, event, resource, params, routeFunction, transformer, inverseTransformer]);

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
            handleUpdated({...update, id} as DeepPartial<T>);
        }
    }, [state, axios, paramName, event, resource, params, routeFunction, inverseTransformer, transformer, defaultUpdateMethod]);

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
        if (!event || updateMethod !== "on-success") {
            handleDestroyed(id);
        }
    }, [axios, event, resource, params, routeFunction]);

    const destroySingle = useCallback((updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => destroyList(requireNotNull(id), updateMethodOverride, config), [destroyList, id]);

    const refresh = useCallback(async (config?: AxiosRequestConfig) => {
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
            setState(null);
        }
        setLoading(false);
    }, [axios, routeFunction, setState, resource, id, setEventOverride, setLoading, transformer, params]);

    useEffect(() => {
        if (autoRefresh) {
            refresh();
        }
    }, [refresh, autoRefresh]);

    return [state, id ? {loading, store, refresh, update: updateSingle, destroy: destroySingle} : {loading, store, update: updateList, destroy: destroyList, refresh, extra}]
}