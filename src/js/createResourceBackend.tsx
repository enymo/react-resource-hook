import { createRequiredContext } from "@enymo/react-better-context";
import { CreateBackendOptions } from "./types";
import { Resource } from "./publicTypes";
import { identity } from "./util";

export default function createResourceBackend<T extends {}, U>(config: CreateBackendOptions<T, U>) {
    const [ResourceProvider, useResourceConfig] = createRequiredContext<T>("ResourceProvider must be present in the component tree");
    export { ResourceProvider };
    
    const createResource = <T extends Resource, U extends object = T, V = null>(resource: string, {
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
            }, [ignoreContext, resourceContext?.state, localState]);
            const sortedState = useMemo(() => (!isArray(state) || !sorter) ? state : [...state].sort(sorter), [state, sorter, isArray]);
            const [extra, setExtra] = useState<V | null>(null);
            const [error, setError] = useState<AxiosError | null>(null);
            const [loading, setLoading] = useState(autoRefresh);
            const [eventOverride, setEventOverride] = useState<string | null>(null);
            
            const socketClient = useSocketClient();
            const event = useMemo(() => socketClient && (eventOverrideConfig ?? eventOverride ?? resource?.split(".").map(part => {
                const singular = pluralize.singular(part).replaceAll("-", "_");
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
                    setState(prev => isArray(prev) ? (prev.map(s => s.id == item.id ? {
                        ...s,
                        ...item
                    } : s)) : {...prev, ...item} as T)
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
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const body = await inverseTransformer(item);
                    return axios.post(routeFunction(`${resource}.store`, params), (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? objectToFormData(body, reactNative) : body, useFormData ? {
                        ...config,
                        headers: {
                            ...config?.headers,
                            "content-type": "multipart/form-data"
                        },
                    } : config)
                })() : null;
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
                    return item;
                }
            }, [axios, params, routeFunction]);
        
            const updateList = useCallback(async (id: T["id"] | "single", update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.update(id, update, updateMethodOverride, config);
                }
                
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const body = filter(await inverseTransformer(pruneUnchangedOverride ? pruneUnchanged(update, requireNotNull(isArray(state) ? state.find(item => item.id == id) : state, "update called before state ready"), reactNative) : update));
                    const route = routeFunction(`${resource}.update`, id === "single" ? params : {
                        [paramName!]: id,
                        ...params
                    });
                    return (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? axios.post<T>(route, objectToFormData({
                        ...body,
                        _method: "put"
                    }, reactNative), {
                        ...config,
                        headers: {
                            ...config?.headers,
                            "content-type": "multipart/form-data"
                        }
                    }) : axios.put<T>(route, body, config)
                })() : null;
                if (updateMethod === "on-success") {
                    handleUpdated(filter(await transformer((await promise!).data)));
                }
                else {
                    handleUpdated({
                        id,
                        ...update
                    } as DeepPartial<T>);
                    if (promise) {
                        handleUpdated(filter(await transformer((await promise!).data)));
                    }
                }
            }, [state, axios, params, routeFunction, resourceContext, ignoreContext]);
        
            const updateSingle = useCallback((update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
                return updateList(requireNotNull(id), update, updateMethodOverride, config);
            }, [id, updateList]);
    
            const batchUpdate = useCallback(async (update: (DeepPartial<U> & {id: T["id"]})[], updateMethodOverride?: UpdateMethod, config?: AxiosRequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.batchUpdate(update, updateMethodOverride, config);
                }
                
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const body = {
                        _batch: (await Promise.all(update.map(async update => {
                            const pruned: DeepPartial<U> = pruneUnchangedOverride ? pruneUnchanged(update, requireNotNull((state as T[]).find(item => item.id == update.id), "update called before state ready"), reactNative, ["id"]) : update;
                            const keys = Object.keys(pruned);
                            return (keys.length === 1 && keys[0] === "id") ? [] : [filter(await inverseTransformer(pruned))];
                        }))).flat()
                    }
                    const route = routeFunction(`${resource}.batch.update`, params);
                    return (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? axios.post<T[]>(route, objectToFormData({
                        ...body,
                        _method: "put"
                    }, reactNative), {
                        ...config,
                        headers: {
                            ...config?.headers,
                            "content-type": "multipart/form-data"
                        }
                    }) : axios.put<T[]>(route, body, config);
                })() : null;
                if (updateMethod === "on-success") {
                    await Promise.all((await promise!).data.map(async update => handleUpdated(filter(await transformer(update)))));
                }
                else {
                    for (const item of update) {
                        handleUpdated(item as DeepPartial<T>);
                    }
                    if (promise) {
                        await Promise.all((await promise!).data.map(async update => handleUpdated(filter(await transformer(update)))));
                    }
                }
            }, [state, axios, params, routeFunction, resourceContext, ignoreContext]);
        
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
                }
                else {
                    handleDestroyed(id);
                    return promise;
                }
            }, [axios, params, routeFunction, resourceContext, ignoreContext]);
        
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
        
            return [
                sortedState, 
                {
                    ...(!ignoreContext && isNotNull(resourceContext) ? {
                        loading: resourceContext.actions.loading,
                        refresh: resourceContext.actions.refresh,
                        error: resourceContext.actions.error,
                        extra: resourceContext.actions.extra,
                        store: resourceContext.actions.store
                    } : {loading, refresh, error, extra, store}), 
                    ...(id !== undefined 
                        ? {update: updateSingle, destroy: destroySingle} 
                        : {update: updateList, destroy: destroyList, batchUpdate})
                }
            ];
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
}