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

export function deepEquals(a: any, b: any, equalityCallback: (a: any, b: any) => boolean = (a, b) => a === b) {
    if (isAtomic(a) && isAtomic(b)) {
        return equalityCallback(a, b);
    }
    else if (!isAtomic(a) && !isAtomic(b) && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set<string | number>();
        for (const [key, value] of Array.isArray(a) ? a.entries() : Object.entries(a)) {
            keys.add(key);
            if (!deepEquals(value, b[key])) return false;
        }
        for (const [key, value] of Array.isArray(b) ? b.entries() : Object.entries(b)) {
            if (!keys.has(key)) {
                if (!deepEquals(value, a[key])) return false;
            }
        }
        return true;
    }
    else {
        return false;
    }
}

function pruneUnchangedRecursive(input: any, comparison: any, target: any, ignoreKeys: string[] = []) {
    for (const [key, value] of Object.entries(input)) {
        if (isAtomic(value) || Array.isArray(value)) {
            if (ignoreKeys.includes(key) || !deepEquals(value, comparison[key])) {
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

export function findChangedPathsRecursive(a: any, b: any): string[] {
    const result: string[] = [];
    const keys = new Set<string | number>();
    for (const [key, value] of Array.isArray(a) ? a.entries() : Object.entries(a)) {
        keys.add(key);
        if (isAtomic(value) || isAtomic(b[key]) || Array.isArray(value) !== Array.isArray(b[key])) {
            if (value !== b[key]) {
                result.push(key.toString());
            }
        }
        else {
            result.push(...findChangedPathsRecursive(value, b[key]).map(path => `${key}.${path}`));
        }
    }
    for (const [key, value] of Array.isArray(b) ? b.entries() : Object.entries(b)) {
        if (!keys.has(key)) {
            if (isAtomic(value) || isAtomic(a[key]) || Array.isArray(value) !== Array.isArray(b[key])) {
                if (value !== a[key]) {
                    result.push(key.toString());
                }
            }
            else {
                result.push(...findChangedPathsRecursive(value, a[key]).map(path => `${key}.${path}`));
            }
        }
    }
    return result;
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
            if (!deepEquals(sortedLocal[i], sortedRemote[j])) {
                updated.push(sortedRemote[j]);
            }
            i++;
            j++;
        }
    }

    return {created, updated, destroyed};
}