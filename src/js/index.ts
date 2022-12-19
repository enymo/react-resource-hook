import { AxiosInstance } from "axios";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import pluralize from "pluralize";
import useSocket, { useSocketClient } from "@enymo/react-socket-hook";
import { filter, identity, objectToFormData } from "./util";

type Handler<T, U> = (item: T, prev: U) => U;
type UpdateMethod = "on-success" | "immediate" | "local-only";

interface Resource {
    id: string|number
}

interface OptionsCommon<T, U> {
    paramName?: string,
    params?: {[param: string]: string|number},
    socketEvent?: string,
    defaultUpdateMethod?: UpdateMethod,
    useFormData?: boolean,
    autoRefresh?: boolean,
    transformer?(item: U): T | Promise<T>,
    transformer?(item: Partial<U>) : Partial<T> | Promise<Partial<T>>,
    inverseTransformer?(item: T): U | Promise<U>,
    inverseTransformer?(item: Partial<T>): Partial<U> | Promise<Partial<U>>
}

interface OptionsList<T, U> extends OptionsCommon<T, U> {
    onCreated?: Handler<T, T[]>,
    onUpdated?: Handler<Partial<T>, T[]>,
    onDestroyed?: (id: number|string, prev: T[]) => T[]
}

interface OptionsSingle<T, U> extends OptionsCommon<T, U> {
    id: string|number,
    onUpdated?: Handler<Partial<T>, T>,
    onDestroyed?: (item: number|string) => void
}

interface OptionsImplementation<T, U> extends OptionsCommon<T, U> {
    id?: string|number,
    onCreated?: Handler<T, T | T[]>,
    onUpdated?: Handler<Partial<T>, T | T[]>,
    onDestroyed?: (id: number|string, prev?: T[]) => void | T[]
}

interface ReturnCommon<T extends Resource> {
    loading: boolean,
    store: (item?: Partial<T>) => Promise<T["id"]>,
    refresh: () => Promise<void>
}

interface ReturnList<T extends Resource> extends ReturnCommon<T> {
    update: (id: string | number, update: Partial<T>, updateMethod?: UpdateMethod) => Promise<void>,
    
    destroy: (id: string | number, updateMethod?: UpdateMethod) => Promise<void>
}

interface ReturnSingle<T extends Resource> extends ReturnCommon<T> {
    update: (update: Partial<T>, updateMethod?: UpdateMethod) => Promise<void>,
    destroy: (updateMethod?: UpdateMethod) => Promise<void>
}

const Context = createContext<{
    axios: AxiosInstance,
    routeFunction: (route: string, params: {[param: string]: string | number}) => string
}>(null);

export const ResourceProvider = Context.Provider;

export default function useResource<T extends Resource, U extends Resource = T>(resource: string, options?: OptionsList<T, U>): [T[], ReturnList<T>];
export default function useResource<T extends Resource, U extends Resource = T>(resource: string, options: OptionsSingle<T, U>): [T, ReturnSingle<T>];
export default function useResource<T extends Resource, U extends Resource = T>(resource: string, {
    id,
    paramName: paramNameOverride,
    params,
    socketEvent: eventOverrideProp,
    defaultUpdateMethod = "on-success",
    useFormData = false,
    autoRefresh = true,
    transformer = identity,
    inverseTransformer = identity,
    onCreated,
    onUpdated,
    onDestroyed
}: OptionsImplementation<T, U> = {}): [T[] | T, ReturnList<T> | ReturnSingle<T>] {
    const {axios, routeFunction} = useContext(Context);
    const [state, setState] = useState<T[] | T>(id === undefined ? [] : null);
    const [loading, setLoading] = useState(autoRefresh);
    const [eventOverride, setEventOverride] = useState(null);
    
    const event = useSocketClient() && (eventOverrideProp ?? eventOverride ?? resource);
    const paramName = useMemo(() => paramNameOverride ?? (resource && pluralize.singular(resource.split(".").pop()).replace(/-/g, "_")), [paramNameOverride, resource]);

    const isArray = useCallback((input: T | T[]): input is T[] => {
        return id === undefined;
    }, [id]);

    const handle = useCallback(<V = T>(handler: Handler<V, T | T[]>, defaultHandler: Handler<V, T | T[]>) => (item: V) => {
        setState(prev => handler?.(item, prev) ?? defaultHandler(item, prev));
    }, [transformer, setState]);

    const handleCreated = useMemo(() => handle(onCreated, (item, prev) => (prev as T[]).find(s => s.id === item.id) ? prev : [...prev as T[], item]), [handle, onCreated]);
    const handleUpdated = useMemo(() => handle<Partial<T>>(onUpdated, (item, prev) => isArray(prev) ? (prev.map(s => s.id === item.id ? Object.assign(s, item) : s)) : {...prev, ...item}), [handle, onUpdated]);
    const handleDestroyed = useCallback((delId: number|string) => {
        if (id) {
            onDestroyed?.(delId);
            setState(null);
        }
        else {
            setState(prev => (onDestroyed?.(delId, prev as T[]) ?? ((id, prev) => (prev as T[]).filter(s => s.id !== id))(delId, prev)) as T[]);
        }
    }, [onDestroyed, setState, id]);

    useSocket<U>(!id && event && `${event}.created`, async item => !loading && handleCreated(filter(await transformer(item))), [loading, handleCreated]);
    useSocket<Partial<U>>(event && `${event}.updated`, async item => (!loading && (id === undefined || item.id === id)) && handleUpdated(filter(await transformer(item))), [id, loading, handleUpdated]);
    useSocket<number|string>(event && `${event}.destroyed`, id => !loading && handleDestroyed(id), [loading, handleDestroyed]);

    const store = useCallback(async (item: Partial<T> = {}) => {
        const body = await inverseTransformer(item);
        let response = await axios.post<U>(routeFunction(`${resource}.store`, params), useFormData ? objectToFormData(body) : body, useFormData ? {
            headers: {
                "content-type": "multipart/form-data"
            }
        } : {});
        if (!id && !event) {
            handleCreated(await transformer(response.data));
        }
        return response.data.id;
    }, [axios, event, resource, params, routeFunction, transformer, inverseTransformer]);

    const updateList = useCallback(async (id: string|number, update: Partial<T>, updateMethodOverride?: UpdateMethod) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const route = routeFunction(`${resource}.update`, {
            [paramName]: id,
            ...params
        });
        const body = filter(await inverseTransformer(update));
        const config = useFormData ? {
            headers: {
                "content-type": "multipart/form-data"
            }
        } : {};
        if (updateMethod === "on-success") {
            let response = await axios.put<U>(route, useFormData ? objectToFormData(body) : body, config);
            const transformed = filter(await transformer(response.data));
            if (!event) {
                handleUpdated(transformed);
            }
        }
        else {
            handleUpdated({
                id,
                ...update
            });
            if (updateMethod === "immediate") {
                await axios.put(route, useFormData ? objectToFormData(body) : body, config);
            }
        }
    }, [axios, paramName, event, resource, params, routeFunction, inverseTransformer, transformer]);

    const updateSingle = useCallback((update: Partial<T>, updateMethodOverride?: UpdateMethod) => {
        return updateList(id, update, updateMethodOverride);
    }, [id, updateList]);

    const destroyList = useCallback(async (id: string|number, updateMethodOverride?: UpdateMethod) => {
        const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
        const promise = updateMethod !== "local-only" && axios.delete(routeFunction(`${resource}.destroy`, {
            [paramName]: id,
            ...params
        }));
        if (updateMethod !== "immediate") {
            await promise;
        }
        if (!event || updateMethod !== "on-success") {
            handleDestroyed(id);
        }
    }, [axios, event, resource, params, routeFunction]);

    const destroySingle = useCallback((updateMethodOverride?: UpdateMethod) => destroyList(id, updateMethodOverride), [destroyList, id]);

    const refresh = useCallback(async () => {
        if (resource && id !== null) {
            setLoading(true);
            const response = await axios.get(id ? routeFunction(`${resource}.show`, {
                [paramName]: id,
                ...params
            }) : routeFunction(`${resource}.index`, params));
            setEventOverride(response.headers["x-socket-event"] ?? null);
            setState(await (id ? transformer(response.data) : Promise.all(response.data.map(transformer))));
        }
        setLoading(false);
    }, [axios, routeFunction, setState, resource, id, setEventOverride, setLoading, transformer]);

    useEffect(() => {
        if (autoRefresh) {
            refresh();
        }
    }, [refresh, autoRefresh]);

    return [state, id ? {loading, store, refresh, update: updateSingle, destroy: destroySingle} : {loading, store, update: updateList, destroy: destroyList, refresh}]
}