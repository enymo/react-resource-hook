import { isNotNull, requireNotNull } from "@enymo/ts-nullsafe";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { OnCreatedListener, OnDestroyedListener, OnUpdatedListener, OptionsImplementation, OptionsList, OptionsSingle, Params, Resource, ResourceBackendAdapter, ReturnList, ReturnSingle, UpdateMethod } from "./types";
import { pruneUnchanged } from "./util";

export type { ActionHookReturn, OnCreatedListener, OnDestroyedListener, OnUpdatedListener, Params, Resource, ResourceBackendAdapter, ResourceQueryResponse, ResourceResponse, ReturnList, ReturnSingle } from "./types";

export default function createResourceFactory<ResourceConfig extends {}, UseConfig extends {}, RequestConfig, Error>({ adapter } : {
    adapter: ResourceBackendAdapter<ResourceConfig, UseConfig, RequestConfig, Error>
}) {     
    return <T extends Resource, U extends object = T, V = null>(resource: string, {
        defaultUpdateMethod = "on-success",
        pruneUnchanged: pruneUnchangedConfig = false,
        ...config
    }: {
        defaultUpdateMethod?: UpdateMethod,
        pruneUnchanged?: boolean
    } & Partial<ResourceConfig> = {}) => {
        const ResourceContext = createContext<{
            state: T[],
            actions: ReturnList<RequestConfig, Error, T, U, V>,
            addCreatedListener(listener: OnCreatedListener<T>): void,
            removeCreatedListener(listener: OnCreatedListener<T>): void,
            addUpdatedListener(listener: OnUpdatedListener<T>): void,
            removeUpdatedListener(listener: OnUpdatedListener<T>): void,
            addDestroyedListener(listener: OnDestroyedListener<T>): void,
            removeDestroyedListener(listener: OnDestroyedListener<T>): void
        } | null>(null);

        const {actionHook: useActions, eventHook: useEvent} = adapter(resource, config as Partial<ResourceConfig>);
    
        const useResource = (({
            id,
            params,
            sorter,
            onCreated,
            onUpdated,
            onDestroyed,
            autoRefresh = true,
            ignoreContext = false,
            ...resourceConfig
        }: OptionsImplementation<T, U> & Partial<UseConfig> = {}) => {
            const isArray = useCallback((input: T | T[] | null): input is T[] => {
                return id === undefined;
            }, [id]);
            const actions = useActions<T>(resourceConfig as Partial<UseConfig>, params);
            const resourceContext = useContext(ResourceContext);
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
            const [error, setError] = useState<Error | null>(null);
            const [loading, setLoading] = useState(autoRefresh);
        
            const handleCreated = useCallback((item: T) => {
                if (onCreated?.(item) ?? true) {
                    setState(prev => ((prev as T[]).find(s => s.id == item.id)) ? (prev as T[]).map(s => s.id == item.id ? {
                        ...s,
                        ...item
                    } : s) : [...prev as T[], item]);
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
        
            useEvent<T>(params, "created", ((ignoreContext || !isNotNull(resourceContext)) && id === undefined) ? (async item => !loading && handleCreated(item)) : undefined, [loading, handleCreated]);
            useEvent<DeepPartial<T>>(params, "updated", (ignoreContext || !isNotNull(resourceContext)) ? (async item => (!loading && (id === undefined || item.id === (state as T).id)) && handleUpdated(item)) : undefined, [id, state, loading, handleUpdated]);
            useEvent<T["id"]>(params, "destroyed", (ignoreContext || !isNotNull(resourceContext)) ? (delId => !loading && (id === undefined || delId === (state as T).id) && handleDestroyed(delId)) : undefined, [id, state, loading, handleDestroyed]);
        
            const store = useCallback(async (item: DeepPartial<U> = {} as DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {            
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? actions.store(item, config) : null;
                if (updateMethod === "on-success" || id !== undefined) {
                    const result = await promise!;
                    if (id === undefined) {
                        handleCreated(result);
                    }
                    return result;
                }
                else {
                    handleCreated(item as T);
                    if (updateMethod !== "local-only") {
                        const result = await promise!;
                        setState(prev => (prev as T[]).map(i => i === item ? result : i));
                        return result;
                    }
                    return item;
                }
            }, [actions.store, setState, handleCreated]);

            const batchStore = useCallback(async (items: DeepPartial<U>[], updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? actions.batchStore(items, config) : null;
                if (updateMethod === "on-success" || id !== undefined) {
                    const result = await promise!;
                    if (id === undefined) {
                        for (const item of result) {
                            handleCreated(item);
                        }
                    }
                    return result;
                }
                else {
                    for (const item of items) {
                        handleCreated(item as T);
                    }
                    if (updateMethod !== "local-only") {
                        const result = await promise!;
                        setState(prev => (prev as T[]).map(i => {
                            const index = items.findIndex(item => i === item);
                            return index === -1 ? i : result[index];
                        }));
                        return result;
                    }
                    return items;
                }
            }, [actions.batchStore, setState, handleCreated]);
        
            const updateList = useCallback(async (id: T["id"], update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    const comparison = pruneUnchangedConfig ? isArray(state) ? state.find(item => item.id === id) ?? null : state : null;
                    return resourceContext.actions.update(id, comparison ? pruneUnchanged(update, comparison) : update, updateMethodOverride, config);
                }
                
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? actions.update(id, update, config) : null;
                if (updateMethod === "on-success") {
                    handleUpdated(await promise!);
                }
                else {
                    handleUpdated({
                        id,
                        ...update
                    } as DeepPartial<T>);
                    if (promise) {
                        handleUpdated(await promise!);
                    }
                }
            }, [state, resourceContext, ignoreContext, actions.update, state, handleUpdated]);
        
            const updateSingle = useCallback((update: DeepPartial<U>, updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                return updateList(requireNotNull(id), update, updateMethodOverride, config);
            }, [id, updateList]);
    
            const batchUpdate = useCallback(async (update: (DeepPartial<U> & {id: T["id"]})[], updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.batchUpdate(update, updateMethodOverride, config);
                }
                
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? actions.batchUpdate(update.map(update => {
                    const comparison = pruneUnchangedConfig ? (state as T[]).find(item => item.id === update.id) : undefined;
                    return (comparison ? pruneUnchanged(update, comparison, ["id"]) : update) as DeepPartial<T>;
                }).filter(update => Object.keys(update).length > 1), config) : null;
                if (updateMethod === "on-success") {
                    (await promise!).map(update => handleUpdated(update));
                }
                else {
                    for (const item of update) {
                        handleUpdated(item as DeepPartial<T>);
                    }
                    if (promise) {
                        for (const item of await promise!) {
                            handleUpdated(item);
                        }
                    }
                }
            }, [state, resourceContext, ignoreContext, actions.batchUpdate, state, handleUpdated]);
        
            const destroyList = useCallback(async (id: T["id"], updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.destroy(id, updateMethodOverride, config);
                }
    
                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" && actions.destroy(id, config);
                if (updateMethod !== "immediate") {
                    await promise;
                }
                handleDestroyed(id);
                return promise;
            }, [resourceContext, ignoreContext, actions.destroy, handleDestroyed]);
        
            const destroySingle = useCallback((updateMethodOverride?: UpdateMethod, config?: RequestConfig) => destroyList(requireNotNull(id), updateMethodOverride, config), [destroyList, id]);

            const batchDestroy = useCallback(async (ids: number[], updateMethodOverride?: UpdateMethod, config?: RequestConfig) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.batchDestroy(ids, updateMethodOverride, config);
                }

                const updateMethod = updateMethodOverride ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" && actions.batchDestroy(ids, config);
                if (updateMethod !== "immediate") {
                    await promise;
                }
                for (const id of ids) {
                    handleDestroyed(id);
                }
                return promise;
            }, [ignoreContext, resourceContext, actions.batchDestroy, handleDestroyed]);
        
            const query = useCallback(async (action: string, data: any, params?: Params, config?: RequestConfig) => {
                const response = await actions.query(action, data, params, config);
                if (response.update === "replace" || id !== undefined) {
                    setState(response.data);
                }
                else {
                    for (const item of response.data) {
                        handleCreated(item);
                    }
                    for (const id of response.destroy) {
                        handleDestroyed(id);
                    }
                }
            }, [actions.query, setState, handleCreated, handleDestroyed]);

            const refresh = useCallback(async (config?: RequestConfig, signal?: AbortSignal) => {
                if (ignoreContext || !isNotNull(resourceContext)) {
                    try {
                        setError(null);
                        if (id !== null) {
                            setLoading(true);
                            try {
                                const response = await actions.refresh<V>(id, config, signal);
                                setExtra(response.extra);
                                setState(response.data);
                                setError(response.error);
                            }
                            catch (e) {
                                if (!signal?.aborted) {
                                    throw e;
                                }
                            }
                        }
                        else {
                            setState(id === undefined ? [] : null);
                        }
                    }
                    finally {
                        if (!signal?.aborted) {
                            setLoading(false);
                        }
                    }
                }
            }, [setState, id, setLoading, setError, ignoreContext, resourceContext, actions.refresh]);
        
            useEffect(() => {
                if (autoRefresh) {
                    const abortController = new AbortController();
                    refresh(undefined, abortController.signal);
                    return () => abortController.abort();
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
                        store: resourceContext.actions.store,
                        batchStore: resourceContext.actions.batchStore,
                        query: resourceContext.actions.query
                    } : {loading, refresh, error, extra, store, batchStore, query}), 
                    ...(id !== undefined 
                        ? {update: updateSingle, destroy: destroySingle} 
                        : {update: updateList, destroy: destroyList, batchUpdate, batchDestroy})
                }
            ];
        }) as {
            (options?: OptionsList<T, U>): [T[], ReturnList<RequestConfig, Error, T, U, V>],
            (options:  OptionsSingle<T, U>): [T | null, ReturnSingle<RequestConfig, Error, T, U>]
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