export function filter<T>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input