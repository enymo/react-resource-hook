export function filter<T>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input

export function objectToFormData(input: object, reactNative: boolean, fd = new FormData(), prefix?: string) {
    for (const [key, value] of Object.entries(input)) {
        if (Array.isArray(value)) {
            for (const val of value) {
                fd.append((prefix ? `${prefix}[${key}]` : key) + "[]", val);
            }
        }
        else if (typeof value === "object" && (!reactNative || !("uri" in value && "name" in value && "type" in value))) {
            objectToFormData(value, reactNative, fd, (prefix ? `${prefix}[${key}]` : key));
        }
        else {
            fd.append(prefix ? `${prefix}[${key}]` : key, value);
        }
        else {
            fd.append(prefix ? `${prefix}[${key}]` : key, value);
        }
    }
    return fd;
}