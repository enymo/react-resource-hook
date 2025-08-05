import { assertNotNull, isNotNull, requireNotNull } from "@enymo/ts-nullsafe";
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { CacheResourceBackendAdapter, OnCreatedListener, OnDestroyedListener, OnUpdatedListener, Options, OptionsImplementation, OptionsList, OptionsSingle, Params, RefreshOptions, Resource, ResourceBackendAdapter, ReturnList, ReturnSingle, UpdateMethod } from "./types";
import { deepEquals, pruneUnchanged } from "./util";

export type {
    ActionHookReturn, CacheResourceBackendAdapter, Delta, OnCreatedListener,
    OnDestroyedListener,
    OnUpdatedListener,
    Params,
    Resource,
    ResourceBackendAdapter, ResourceQueryResponse,
    ResourceResponse,
    ReturnList,
    ReturnSingle
} from "./types";
export type { DeepPartial };
export class OfflineError extends Error {
    constructor(public originalError: Error, message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}
export class ConflictError extends Error {}

export default function createResourceFactory<ResourceConfig extends {}, CacheResourceConfig extends {}, UseConfig extends {}, CacheUseConfig extends {}, RequestConfig, CacheRequestConfig>({ adapter, cache } : {
    adapter: ResourceBackendAdapter<ResourceConfig, UseConfig, RequestConfig>,
    cache?: {
        adapter: CacheResourceBackendAdapter<CacheResourceConfig, CacheUseConfig, CacheRequestConfig>,
        equalityCallback?: (a: any, b: any) => boolean
    }
}) {     
    return <T extends Resource, U extends object = T, V = null>(resource: string, {
        defaultUpdateMethod = "on-success",
        pruneUnchanged: pruneUnchangedConfig = false,
        conflictResolver,
        uniqueIdentifierCallback = item => item.id.toString(),
        cache: cacheConfig = {},
        ...config
    }: {
        defaultUpdateMethod?: UpdateMethod,
        pruneUnchanged?: boolean,
        conflictResolver?: (local: T | null, common: T | null, remote: T | null) => T | null,
        uniqueIdentifierCallback?: (item: T) => string,
        cache?: {
            defaultEnabled?: boolean,
            batchSync?: boolean,
            preferOffline?: boolean
        } & Partial<CacheResourceConfig>
    } & Partial<ResourceConfig> = {}) => {
        const ResourceContext = createContext<{
            state: T[],
            actions: ReturnList<RequestConfig, CacheRequestConfig, T, U, V>,
            addCreatedListener: (listener: OnCreatedListener<T>) => () => void,
            addUpdatedListener: (listener: OnUpdatedListener<T>) => () => void,
            addDestroyedListener: (listener: OnDestroyedListener<T>) => () => void,
        } | null>(null);

        const {actionHook: useActions, eventHook: useEvent} = adapter(resource, config as Partial<ResourceConfig>);
        const cacheAdapter = cache?.adapter(resource, cacheConfig, true);
    
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
            const cacheActions = cacheAdapter?.actionHook<T>({});

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

            const [meta, setMeta] = useState<V | null>(null);
            const [error, setError] = useState<Error | null>(null);
            const [loading, setLoading] = useState(autoRefresh);

            const handleConflict = useCallback((local: T | null, common: T | null, remote: T | null) => {
                const id = uniqueIdentifierCallback(requireNotNull(local ?? remote, "local and remote must not both be null"));
                try {
                    if (conflictResolver) {
                        return conflictResolver(local, common, remote);
                    }
                    throw new ConflictError();
                }
                catch (e) {
                    throw e;
                }
                /* TODO: Implement manual conflict handling
                catch (e) {
                    if (e instanceof ConflictError) {
                        setConflicts(conflicts => conflicts.some(conflict => conflict.id === id)
                            ? conflicts.map(conflict => conflict.id === id ? {id, local, common, remote} : conflict)
                            : [...conflicts, {id, local, common, remote}]
                        )
                    }
                    throw e;
                }
                */
            }, []);
        
            const handleCreated = useCallback((item: T) => {
                if (onCreated?.(item) ?? true) {
                    const id = uniqueIdentifierCallback(item);
                    setState(prev => ((prev as T[]).find(s => s.id == item.id)) ? (prev as T[]).map(s => s.id == item.id ? {
                        ...s,
                        ...item
                    } : s) : [...prev as T[], item]);
                }
            }, [onCreated, setState]);

            const handleUpdated = useCallback((item: DeepPartial<T>) => {
                if (onUpdated?.(item) ?? true) {
                    const {id, ...rest} = item;
                    setState(prev => isArray(prev) ? (prev.map(s => s.id == id ? {
                        ...s,
                        ...rest
                    } : s)) : {...prev, ...rest} as unknown as T)
                }
            }, [onUpdated, setState]);

            const handleDestroyed = useCallback((delId: T["id"]) => {
                if (onDestroyed?.(delId) ?? true) {
                    setState(prev => isArray(prev) ? prev.filter(s => s.id !== delId) : null);
                }
            }, [onDestroyed, setState]);
        
            useEvent<T>(
                params,
                "created", 
                async item => !loading && handleCreated(item),
                (ignoreContext || !isNotNull(resourceContext)) && id === undefined,
                [loading, handleCreated]
            );
            useEvent<DeepPartial<T> & Resource>(
                params,
                "updated",
                async item => (!loading && (id === undefined || item.id === (state as T).id)) && handleUpdated(item),
                (ignoreContext || !isNotNull(resourceContext)),
                [id, state, loading, handleUpdated]
            );
            useEvent<T["id"]>(
                params,
                "destroyed",
                delId => !loading && (id === undefined || delId === (state as T).id) && handleDestroyed(delId),
                (ignoreContext || !isNotNull(resourceContext)),
                [id, state, loading, handleDestroyed]
            );
        
            const store = useCallback(async (item: DeepPartial<U> = {} as DeepPartial<U>, options?: Options<RequestConfig, CacheRequestConfig>) => {            
                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    const cacheResult = cache && await cacheActions?.store(item, options?.cache?.config);
                    try {
                        const result = await actions.store(item, options?.config)
                        cache && await cacheActions?.sync((item as Resource).id);
                        return result;
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cacheResult) throw e.originalError;
                            return cacheResult;
                        }
                        throw e;
                    }
                })() : null;
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
            }, [actions.store, cacheActions?.store, setState, handleCreated]);

            const batchStore = useCallback(async (items: DeepPartial<U>[], options?: Options<RequestConfig, CacheRequestConfig>) => {
                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    const cacheResult = cache && await cacheActions?.batchStore(items, options?.cache?.config);
                    try {
                        const result = await actions.batchStore(items, options?.config);
                        cache && await cacheActions?.sync(...items.map(item => (item as Resource).id));
                        return result;
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cacheResult) throw e.originalError;
                            return cacheResult;
                        }
                        throw e;
                    }                    
                })() : null;
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
            }, [actions.batchStore, cacheActions?.batchStore, setState, handleCreated]);
        
            const updateList = useCallback(async (id: T["id"], update: DeepPartial<U>, options?: Options<RequestConfig, CacheRequestConfig>) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.update(id, update, options);
                }
                
                const comparison = pruneUnchangedConfig ? isArray(state) ? state.find(item => item.id === id) ?? null : state : null;
                const pruned = comparison ? pruneUnchanged(update, comparison) : update;
                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    const cacheResult = cache && await cacheActions?.update(id, pruned, options?.cache?.config);
                    try {
                        const result = await actions.update(id, pruned, options?.config);
                        cache && await cacheActions?.sync(id);
                        return result;
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cacheResult) throw e.originalError;
                            return cacheResult;
                        }
                        throw e;
                    }
                })() : null;
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
            }, [state, resourceContext, ignoreContext, actions.update, cacheActions?.update, handleUpdated]);
        
            const updateSingle = useCallback((update: DeepPartial<U>, options?: Options<RequestConfig, CacheRequestConfig>) => {
                return updateList(requireNotNull(id), update, options);
            }, [id, updateList]);
    
            const batchUpdate = useCallback(async (update: (DeepPartial<U> & {id: T["id"]})[], options?: Options<RequestConfig, CacheRequestConfig>) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.batchUpdate(update, options);
                }
                
                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" ? (async () => {
                    const pruned = update.map(update => {
                        const comparison = pruneUnchangedConfig ? (state as T[]).find(item => item.id === update.id) : undefined;
                        return (comparison ? pruneUnchanged(update, comparison, ["id"]) : update) as DeepPartial<T> & Resource;
                    }).filter(update => Object.keys(update).length > 1);
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    const cacheResult = cache && cacheActions?.batchUpdate(pruned, options?.cache?.config);
                    try {
                        const result = actions.batchUpdate(pruned, options?.config);
                        cache && cacheActions?.sync(...pruned.map(item => item.id));
                        return result;
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cacheResult) throw e.originalError;
                            return cacheResult;
                        }
                        throw e;
                    }
                })() : null;
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
            }, [state, resourceContext, ignoreContext, actions.batchUpdate, cacheActions?.batchUpdate, handleUpdated]);
        
            const destroyList = useCallback(async (id: T["id"], options?: Options<RequestConfig, CacheRequestConfig>) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.destroy(id, options);
                }
    
                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" && (async () => {
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    cache && cacheActions?.destroy(id, options?.cache?.config);
                    try {
                        actions.destroy(id, options?.config);
                        cache && cacheActions?.sync(id);
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cache || !cacheActions) throw e.originalError;
                            return;
                        }
                        throw e;
                    }
                })();
                if (updateMethod !== "immediate") {
                    await promise;
                }
                handleDestroyed(id);
                return promise;
            }, [resourceContext, ignoreContext, actions.destroy, cacheActions?.destroy, handleDestroyed]);
        
            const destroySingle = useCallback((options?: Options<RequestConfig, CacheRequestConfig>) => destroyList(requireNotNull(id), options), [destroyList, id]);

            const batchDestroy = useCallback(async (ids: number[], options?: Options<RequestConfig, CacheRequestConfig>) => {
                if (!ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.actions.batchDestroy(ids, options);
                }

                const updateMethod = options?.updateMethod ?? defaultUpdateMethod;
                const promise = updateMethod !== "local-only" && (async () => {
                    const cache = options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false;
                    cache && cacheActions?.batchDestroy(ids, options?.cache?.config);
                    try {
                        actions.batchDestroy(ids, options?.config);
                        cache && cacheActions?.sync(...ids);
                    }
                    catch (e) {
                        if (e instanceof OfflineError) {
                            if (!cache || !cacheActions) throw e.originalError;
                            return;
                        }
                        throw e;
                    }
                })();
                if (updateMethod !== "immediate") {
                    await promise;
                }
                for (const id of ids) {
                    handleDestroyed(id);
                }
                return promise;
            }, [ignoreContext, resourceContext, actions.batchDestroy, cacheActions?.batchDestroy, handleDestroyed]);
        
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

            const refresh = useCallback(async (options?: RefreshOptions<RequestConfig, CacheRequestConfig>) => {
                if (ignoreContext || !isNotNull(resourceContext)) {
                    try {
                        setError(null);
                        if (id !== null) {
                            setLoading(true);
                            try {
                                const response = await (async () => {
                                    const preferOffline = options?.cache?.preferOffline ?? cacheConfig.preferOffline ?? false;
                                    if (preferOffline && cacheActions?.refresh && id === undefined) {
                                        const response = await cacheActions.refresh(undefined, options?.cache?.config, options?.signal);
                                        if ((response.data as T[]).length > 0) {
                                            return response;
                                        }
                                    }
                                    try {
                                        const response = await actions.refresh<V>(id, options?.config, options?.signal);

                                        if ((options?.cache?.enabled ?? cacheConfig.defaultEnabled ?? false) && cacheActions?.getCache && Array.isArray(response.data)) {
                                            const cache = await cacheActions.getCache();
                                            const map = new Map(response.data.map(item => [uniqueIdentifierCallback(item), item]));
                                            const mapIds = new Set(map.keys());
                                            const syncIds = new Set<T["id"]>();
                                            
                                            const remoteStore: T[] = [];
                                            const remoteUpdate: T[] = [];
                                            const remoteDestroy: T["id"][] = [];

                                            const localStore: T[] = [];
                                            const localUpdate: T[] = [];
                                            const localDestroy: T["id"][] = [];

                                            for (const entry of cache) {
                                                const id = uniqueIdentifierCallback(entry.remote ?? entry.local!);
                                                // Remove any id present in changes so we can later see which remote entries are new
                                                mapIds.delete(id);
                                                const remote = map.get(id) ?? null;
                                                if (entry.remote !== undefined) {
                                                    // Local entry was created / updated / destroyed since last sync
                                                    if (
                                                        deepEquals(entry.remote, remote) // Also returns true if both entry.remote and remote are null
                                                    ) {
                                                        // Remote entry was not changed since last sync. Local entry has precendence

                                                        if (entry.remote === null) {
                                                            // Remote entry does not exist. Store local entry on remote
                                                            assertNotNull(entry.local, "Cache error! Local and remote must not both be null!")
                                                            remoteStore.push(entry.local);
                                                            map.set(id, entry.local);
                                                        }
                                                        else if (entry.local === null) {
                                                            // Local entry was destroyed. Destroy on remote
                                                            remoteDestroy.push(entry.remote.id);
                                                            map.delete(id);
                                                        }
                                                        else {
                                                            // Local entry was updated. Update on remote
                                                            remoteUpdate.push(entry.local);
                                                            map.set(id, entry.local);
                                                        }
                                                    }
                                                    else {
                                                        // Both local and remote entries were changed. Conflict!
                                                        try {
                                                            // Try automatic conflict handling
                                                            const resolution = handleConflict(entry.local, entry.remote, remote);
                                                            
                                                            // Resolution found. Sync with both local and remote
                                                            if (resolution === null) {
                                                                // Resolution is to delete the item

                                                                if (remote !== null) {
                                                                    // Exists on remote. Destroy it
                                                                    remoteDestroy.push(remote.id);
                                                                    map.delete(id);
                                                                }
                                                                if (entry.local !== null) {
                                                                    // Exists locally. Destroy it
                                                                    localDestroy.push(entry.local.id);
                                                                }
                                                            }
                                                            else {
                                                                const resolutionId = uniqueIdentifierCallback(resolution);
                                                                if (remote === null) {
                                                                    // Does not exist on remote. Store it
                                                                    remoteStore.push(resolution);
                                                                    map.set(resolutionId, resolution);
                                                                }
                                                                else if (remote.id !== resolution.id) {
                                                                    // Id has changed. Destroy then store
                                                                    remoteDestroy.push(remote.id);
                                                                    remoteStore.push(resolution);
                                                                    map.delete(id);
                                                                    map.set(resolutionId, resolution);
                                                                }
                                                                else {
                                                                    // Exists on remote. Update it
                                                                    remoteUpdate.push(resolution);
                                                                    map.set(id, resolution);
                                                                }

                                                                if (entry.local === null) {
                                                                    // Does not exist locally. Store it
                                                                    localStore.push(resolution);
                                                                }
                                                                else if (entry.local.id !== resolution.id) {
                                                                    // Id has changed. Destroy then store
                                                                    localDestroy.push(entry.local.id)
                                                                    localStore.push(resolution)
                                                                }
                                                                else {
                                                                    // Exists locally. Update it
                                                                    localUpdate.push(resolution);
                                                                }
                                                            }
                                                        }
                                                        catch (e) {
                                                            if (e instanceof ConflictError) {
                                                                // Conflict resolution has failed! Skip item
                                                                continue;
                                                            }
                                                        }
                                                    }
                                                    // If we get to here, sync has been handled successfully. Item will be marked as synced after write is done
                                                    syncIds.add(entry.remote?.id ?? entry.local!.id);
                                                }
                                                else if (!deepEquals(remote, entry.local)) {
                                                    // Local item has not changed, but remote has. Remote item has precendece
                                                    if (remote === null) {
                                                        // Item destroyed remotely. Destroy locally
                                                        localDestroy.push(entry.local!.id);
                                                    }
                                                    else {
                                                        // Item updated remotely. Update locally
                                                        localUpdate.push(remote);
                                                    }
                                                }
                                            }

                                            // Apply all newly created remote items locally
                                            for (const id of mapIds.values()) {
                                                const remote = map.get(id)!;
                                                localStore.push(remote);
                                            }

                                            // Everything has been resolved. Now dispatch all write actions to both remote and local storage
                                            if (cacheConfig.batchSync) {
                                                await Promise.all([
                                                    remoteStore.length > 0 && actions.batchStore(remoteStore, options?.config),
                                                    remoteUpdate.length > 0 && actions.batchUpdate(remoteUpdate, options?.config),
                                                    remoteDestroy.length > 0 && actions.batchDestroy(remoteDestroy, options?.config),
                                                    localStore.length > 0 && cacheActions.batchStore(localStore, options?.cache?.config),
                                                    localUpdate.length > 0 && cacheActions.batchUpdate(localUpdate, options?.cache?.config),
                                                    localDestroy.length > 0 && cacheActions.batchDestroy(localDestroy, options?.cache?.config)
                                                ]);
                                            }
                                            else {
                                                await Promise.all([
                                                    ...remoteStore.map(item => actions.store(item, options?.config)),
                                                    ...remoteUpdate.map(({id, ...item}) => actions.update(id, item, options?.config)),
                                                    ...remoteDestroy.map(id => actions.destroy(id, options?.config)),
                                                    ...localStore.map(item => cacheActions.store(item, options?.cache?.config)),
                                                    ...localUpdate.map(({id, ...item}) => cacheActions.update(id, item, options?.cache?.config)),
                                                    ...localDestroy.map(id => cacheActions.destroy(id, options?.cache?.config))
                                                ])
                                            }

                                            for (const item of localStore) {
                                                syncIds.add(item.id);
                                            }
                                            for (const item of localUpdate) {
                                                syncIds.add(item.id);
                                            }
                                            for (const id of localDestroy) {
                                                syncIds.add(id);
                                            }

                                            await cacheActions.sync(...syncIds);

                                            return {
                                                ...response,
                                                data: [...map.values()]
                                            }
                                        }

                                        return response;
                                    }
                                    catch (e) {
                                        if (e instanceof OfflineError) {
                                            return (await cacheActions?.refresh(id, options?.cache?.config, options?.signal)) ?? {
                                                data: null,
                                                error: e.originalError,
                                                meta: null
                                            }
                                        }
                                        throw e;
                                    }
                                })();
                                if (options?.signal?.aborted) return;

                                setMeta(response.meta);
                                setState(response.data);
                                setError(response.error);
                            }
                            catch (e) {
                                if (!options?.signal?.aborted) {
                                    throw e;
                                }
                            }
                        }
                        else {
                            setState(id === undefined ? [] : null);
                        }
                    }
                    finally {
                        if (!options?.signal?.aborted) {
                            setLoading(false);
                        }
                    }
                }
            }, [setState, id, setLoading, setError, ignoreContext, resourceContext, actions.refresh]);
        
            useEffect(() => {
                if (autoRefresh) {
                    const abortController = new AbortController();
                    refresh({
                        signal: abortController.signal
                    });
                    return () => abortController.abort();
                }
            }, [refresh, autoRefresh]);

            useEffect(() => {
                if (ignoreContext || !resourceContext) {
                    return actions.addOfflineListener(offline => {
                        if (!offline) {
                            refresh();
                        }
                    })
                }
            }, [actions.addOfflineListener, refresh]);
    
            useEffect(() => {
                if (isNotNull(onCreated) && !ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.addCreatedListener(onCreated);
                }
            }, [onCreated, ignoreContext, resourceContext]);
    
            useEffect(() => {
                if (isNotNull(onUpdated) && !ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.addUpdatedListener(onUpdated);
                }
            }, [onUpdated, ignoreContext, resourceContext]);
    
            useEffect(() => {
                if (isNotNull(onDestroyed) && !ignoreContext && isNotNull(resourceContext)) {
                    return resourceContext.addDestroyedListener(onDestroyed);
                }
            }, [onDestroyed, ignoreContext, resourceContext]);
        
            return [
                sortedState, 
                {
                    ...(!ignoreContext && isNotNull(resourceContext) ? {
                        loading: resourceContext.actions.loading,
                        refresh: resourceContext.actions.refresh,
                        error: resourceContext.actions.error,
                        meta: resourceContext.actions.meta,
                        store: resourceContext.actions.store,
                        batchStore: resourceContext.actions.batchStore,
                        query: resourceContext.actions.query
                    } : {loading, refresh, error, meta, store, batchStore, query}), 
                    ...(id !== undefined 
                        ? {update: updateSingle, destroy: destroySingle} 
                        : {update: updateList, destroy: destroyList, batchUpdate, batchDestroy})
                }
            ];
        }) as {
            (options?: OptionsList<T, U>): [T[], ReturnList<RequestConfig, CacheRequestConfig, T, U, V>],
            (options:  OptionsSingle<T, U>): [T | null, ReturnSingle<RequestConfig, CacheRequestConfig, T, U>]
        }
    
        const ResourceProvider = ({params, children}: {
            params?: Params,
            children: ReactNode
        }) => {
            const createdListeners = useRef(new Set<OnCreatedListener<T>>());
            const updatedListeners = useRef(new Set<OnUpdatedListener<T>>());
            const destroyedListeners = useRef(new Set<OnDestroyedListener<T>>());
    
            const handleCreated = useCallback<OnCreatedListener<T>>(item => {
                let result = true;
                for (const listener of createdListeners.current) {
                    if (!listener(item)) {
                        result = false;
                    };
                }
                return result;
            }, [createdListeners]);
    
            const handleUpdated = useCallback<OnUpdatedListener<T>>(item => {
                let result = true;
                for (const listener of updatedListeners.current) {
                    if (!listener(item)) {
                        result = false;
                    }
                }
                return result;
            }, [updatedListeners]);
    
            const handleDestroyed = useCallback<OnDestroyedListener<T>>(id => {
                let result = true;
                for (const listener of destroyedListeners.current) {
                    if (!listener(id)) {
                        result = false;
                    }
                }
                return result;
            }, [destroyedListeners]);

            const addCreatedListener = useCallback((listener: OnCreatedListener<T>) => {
                createdListeners.current.add(listener);
                return () => createdListeners.current.delete(listener);
            }, [createdListeners]);

            const addUpdatedListener = useCallback((listener: OnUpdatedListener<T>) => {
                updatedListeners.current.add(listener);
                return () => updatedListeners.current.delete(listener);
            }, [updatedListeners]);

            const addDestroyedListener = useCallback((listener: OnDestroyedListener<T>) => {
                destroyedListeners.current.add(listener);
                return () => destroyedListeners.current.delete(listener);
            }, [destroyedListeners])
    
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
                    addCreatedListener,
                    addUpdatedListener,
                    addDestroyedListener
                }}>
                    {children}
                </ResourceContext.Provider>
            )
        }
    
        return [useResource, ResourceProvider] as const;
    }
}