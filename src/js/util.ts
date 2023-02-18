export function filter<T>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input

function objectToFormDataRecursive(input: any, reactNative: boolean, fd: FormData, path: string) {
    if (input instanceof File || typeof input !== "object" || (reactNative && "uri" in input && "name" in input && "type" in input)) {
        fd.append(path, input);
    }
    else {
        for (const [key, value] of Array.isArray(input) ? input.entries() : Object.entries(input)) {
            objectToFormDataRecursive(value, reactNative, fd, `${path}[${key}]`);
        }
    }
}

export function objectToFormData(input: object, reactNative: boolean) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(input)) {
        objectToFormDataRecursive(value, reactNative, fd, key);
    }
    return fd;
}