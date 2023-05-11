import useSocket, { useSocketClient } from "@enymo/react-socket-hook";
import { AxiosInstance, AxiosRequestConfig } from "axios";
import pluralize from "pluralize";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { filter, identity, objectToFormData } from "./util";

type Handler<T, U> = (item: T, prev: U) => U;
type UpdateMethod = "on-success" | "immediate" | "local-only";
export type Params = {[param: string]: string|number|boolean|(string|number|boolean)[]|Params}

interface Resource {
    id: string|number
}

export type RecusivePartial<T> = {
    [P in keyof T]?:
        T[P] extends (infer U)[] ? RecusivePartial<U>[] :
        T[P] extends object ? RecusivePartial<T[P]> :
        T[P];
};

interface OptionsCommon<T, U> {
    paramName?: string,
    params?: Params,
    socketEvent?: string,
    defaultUpdateMethod?: UpdateMethod,
    useFormData?: boolean,
    autoRefresh?: boolean,
    reactNative?: boolean,
    transformer?(item: any): RecusivePartial<T> | Promise<RecusivePartial<T>>,
    inverseTransformer?(item: RecusivePartial<U>): any | Promise<any>
}

interface OptionsList<T, U> extends OptionsCommon<T, U> {
    withExtra?: boolean,
    onCreated?: Handler<T, T[]>,
    onUpdated?: Handler<RecusivePartial<T>, T[]>,
    onDestroyed?: (id: number|string, prev: T[]) => T[]
}

interface OptionsSingle<T, U> extends OptionsCommon<T, U> {
    id: string|number,
    onUpdated?: Handler<RecusivePartial<T>, T>,
    onDestroyed?: (item: number|string) => void
}

interface OptionsImplementation<T, U> extends OptionsCommon<T, U> {
    id?: string|number,
    withExtra?: boolean,
    onCreated?: Handler<T, T | T[]>,
    onUpdated?: Handler<RecusivePartial<T>, T | T[]>,
    onDestroyed?: (id: number|string, prev?: T[]) => void | T[]
}

interface ReturnCommon<T extends Resource, U> {
    loading: boolean,
    store: (item?: RecusivePartial<U>, config?: AxiosRequestConfig) => Promise<T["id"]>,
    refresh: (config?: AxiosRequestConfig) => Promise<void>
}

export interface ReturnList<T extends Resource, U, V> extends ReturnCommon<T, U> {
    update: (id: string | number, update: RecusivePartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    destroy: (id: string | number, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    extra: V
}

export interface ReturnSingle<T extends Resource, U = T> extends ReturnCommon<T, U> {
    update: (update: RecusivePartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    destroy: (updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>
}

export type RouteFunction = (route: string, params?: Params) => string

const Context = createContext<{
    axios: AxiosInstance,
    routeFunction: RouteFunction
}>(null);

export const ResourceProvider = Context.Provider;

export default function useResource<T extends Resource, U = T, V = null>(resource: string, options?: OptionsList<T, U>): [T[], ReturnList<T, U, V>];
export default function useResource<T extends Resource, U = T>(resource: string, options: OptionsSingle<T, U>): [T, ReturnSingle<T, U>];
export default function useResource<T extends Resource, U = T, V = null>(resource: string, {
    id,
    paramName: paramNameOverride,
    params,
    socketEvent: eventOverrideProp,
    defaultUpdateMethod = "on-success",
    useFormData = false,
    reactNative = false,
    autoRefresh = true,
    withExtra = false,
    transformer = identity,
    inverseTransformer = identity,
    onCreated,
    onUpdated,
    onDestroyed
}: OptionsImplementation<T, U> = {}): [T[] | T, ReturnList<T, U, V> | ReturnSingle<T, U>] {
    const {axios, routeFunction} = useContext(Context);
    const [state, setState] = useState<T[] | T>(id === undefined ? [] : null);
    const [extra, setExtra] = useState<V>(null);
    const [loading, setLoading] = useState(autoRefresh);
    const [eventOverride, setEventOverride] = useState(null);
    
    const event = useSocketClient() && (eventOverrideProp ?? eventOverride ?? resource);
    const paramName = useMemo(() => paramNameOverride ?? (resource && pluralize.singular(resource.split(".").pop()).replace(/-/g, "_")), [paramNameOverride, resource]);

    const isArray = useCallback((input: T | T[]): input is T[] => {
        return id === undefined;
    }, [id]);

    const handle = useCallback(<U = T>(handler: Handler<U, T | T[]>, defaultHandler: Handler<U, T | T[]>) => (item: U) => {
        setState(prev => handler?.(item, prev) ?? defaultHandler(item, prev));
    }, [transformer, setState]);

    const handleCreated = useMemo(() => handle(onCreated, (item, prev) => (prev as T[]).find(s => s.id === item.id) ? prev : [...prev as T[], item]), [handle, onCreated]);
    const handleUpdated = useMemo(() => handle<RecusivePartial<T>>(onUpdated, (item, prev) => isArray(prev) ? (prev.map(s => s.id === item.id ? Object.assign(s, item) : s)) : {...prev, ...item}), [handle, onUpdated]);
    const handleDestroyed = useCallback((delId: number|string) => {
        if (id !== undefined) {
            onDestroyed?.(delId);
            setState(null);
        }
        else {
            setState(prev => (onDestroyed?.(delId, prev as T[]) ?? ((id, prev) => (prev as T[]).filter(s => s.id !== id))(delId, prev)) as T[]);
        }
    }, [onDestroyed, setState, id]);

    useSocket<Resource>(id === undefined && event && `${event}.created`, async item => !loading && handleCreated(filter(await transformer(item) as T)), [loading, handleCreated]);
    useSocket<Resource>(event && `${event}.updated`, async item => (!loading && (id === undefined || item.id === id)) && handleUpdated(filter(await transformer(item))), [id, loading, handleUpdated]);
    useSocket<number|string>(event && `${event}.destroyed`, id => !loading && handleDestroyed(id), [loading, handleDestroyed]);

    const store = useCallback(async (item: RecusivePartial<U> = {}, config?: AxiosRequestConfig) => {
        const body = await inverseTransformer(item);
        let response = await axios.post(routeFunction(`${resource}.store`, params), useFormData ? objectToFormData(body, reactNative) : body, useFormData ? {
            ...config,
            headers: {
                ...config?.headers,
                "content-type": "multipart/form-data"
            },
        } : config);
        if (id === undefined && !event) {
            handleCreated(await transformer(response.data) as T);
        }
        return response.data.id;
    }, [axios, event, resource, params, routeFunction, transformer, inverseTransformer]);

    const updateList = useCallback(async (id: string|number, update: RecusivePartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const route = routeFunction(`${resource}.update`, {
            [paramName]: id,
            ...params
        });
        const body = filter(await inverseTransformer(update));
        const promise = updateMethod !== "local-only" && (useFormData ? axios.post<U>(route, objectToFormData({
            ...body,
            _method: "put"
        }, reactNative), {
            ...config,
            headers: {
                ...config?.headers,
                "content-type": "multipart/form-data"
            }
        }) : axios.put<U>(route, body, config));
        if (updateMethod === "on-success") {
            const transformed = filter(await transformer((await promise).data));
            if (!event) {
                handleUpdated(transformed);
            }
        }
        else {
            handleUpdated({
                ...(isArray(state) ? state.find(item => item.id === id) : state),
                ...update as unknown as RecusivePartial<T>
            });
        }
    }, [state, axios, paramName, event, resource, params, routeFunction, inverseTransformer, transformer, defaultUpdateMethod]);

    const updateSingle = useCallback((update: RecusivePartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        return updateList(id, update, updateMethodOverride, config);
    }, [id, updateList]);

    const destroyList = useCallback(async (id: string|number, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const promise = updateMethod !== "local-only" && axios.delete(routeFunction(`${resource}.destroy`, {
            [paramName]: id,
            ...params
        }), config);
        if (updateMethod !== "immediate") {
            await promise;
        }
        if (!event || updateMethod !== "on-success") {
            handleDestroyed(id);
        }
    }, [axios, event, resource, params, routeFunction]);

    const destroySingle = useCallback((updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => destroyList(id, updateMethodOverride, config), [destroyList, id]);

    const refresh = useCallback(async (config?: AxiosRequestConfig) => {
        if (resource && id !== null) {
            setLoading(true);
            const response = await axios.get(id ? routeFunction(`${resource}.show`, {
                [paramName]: id,
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