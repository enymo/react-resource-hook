import { DeepPartial } from "ts-essentials";

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
            const result = isSubsetRecursive(value, b[key]);
            if (!result) {
                return false;
            }
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