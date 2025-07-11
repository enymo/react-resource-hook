import compare from "@enymo/comparison";
import { DeepPartial } from "ts-essentials";
import { Delta, Resource } from "./types";

function isAtomic(input: any) {
    return (
        input instanceof File
        || input === null
        || typeof input !== "object"
    )
}

function isSubsetRecursive(a: any, b: any) {
    if (isAtomic(a)) {
        return a === b;
    }
    else {
        for (const [key, value] of Array.isArray(a) ? a.entries() : Object.entries(a)) {
            if (!isSubsetRecursive(value, b[key])) return false;
        }
        return true;
    }
}

function pruneUnchangedRecursive(input: any, comparison: any, target: any, ignoreKeys: string[] = []) {
    for (const [key, value] of Object.entries(input)) {
        if (isAtomic(value) || Array.isArray(value)) {
            if (ignoreKeys.includes(key) || !isSubsetRecursive(value, comparison[key])) {
                target[key] = value;
            }
        }
        else {
            target[key] = {};
            pruneUnchangedRecursive(value, comparison[key], target[key]);
        }
    }
}

export function pruneUnchanged<T>(input: object, comparison: object, ignoreKeys: string[] = []): DeepPartial<T> {
    const target = {}
    pruneUnchangedRecursive(input, comparison, target, ignoreKeys);
    return target as DeepPartial<T>;
}

export function resolveDeltas<T extends Resource, U extends T | T[]>(input: U, ...deltas: Delta<T>[]): U extends T[] ? U : U | null {
    if (Array.isArray(input)) {
        const map = new Map(input.map(item => [item.id, item]));

        for (const delta of deltas) {
            switch (delta.action) {
                case "store":
                    map.set(delta.resource.id, delta.resource);
                    break;
                case "update":
                    map.set(delta.id, {
                        ...map.get(delta.id),
                        ...delta.update
                    } as T);
                    break;
                case "destroy":
                    map.delete(delta.id);
                    break;
            }
        }

        return [...map.values()] as U extends T[] ? U : U | null;
    }
    else {
        return deltas.reduce<T | null>((item, delta) => {
            if (item !== null && delta.id === item.id) {
                if (delta.action === "update") {
                    return {
                        ...item,
                        ...delta.update
                    } as T
                }
                else if (delta.action === "destroy") {
                    return null;
                }
            }
            return item;
        }, input as unknown as T) as U extends T[] ? U : U | null
    }
}

export function diff<T extends Resource>(local: T[], remote: T[]) {
    const sortedLocal = [...local].sort((a, b) => compare(a.id, b.id));
    const sortedRemote = [...remote].sort((a, b) => compare(a.id, b.id));

    const created: T[] = [];
    const updated: T[] = [];
    const destroyed: T["id"][] = [];

    let i = 0;
    let j = 0;
    while (i < sortedLocal.length || j < sortedRemote.length) {
        const comparison = i < sortedLocal.length && j < sortedRemote.length ? compare(sortedLocal[i].id, sortedRemote[j].id) : 0;
        if (j >= sortedRemote.length || comparison < 0) {
            destroyed.push(sortedLocal[i].id);
            i++;
        }
        else if (i >= sortedLocal.length || comparison > 0) {
            created.push(sortedRemote[j]);
            j++;
        }
        else {
            if (!isSubsetRecursive(sortedLocal[i], sortedRemote[j])) {
                updated.push(sortedRemote[j]);
            }
            i++;
            j++;
        }
    }

    return {created, updated, destroyed};
}