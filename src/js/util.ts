export function filter<T>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input

export function objectToFormData(input: object, fd = new FormData(), prefix?: string) {
    for (const [key, value] of Object.entries(input)) {
        if (Array.isArray(value)) {
            for (const val of value) {
                fd.append((prefix ? `${prefix}[${key}]` : key) + "[]", val);
            }
        }
        else if (typeof value === "object") {
            objectToFormData(value, fd, (prefix ? `${prefix}[${key}]` : key));
        }
    }
    return fd;
}