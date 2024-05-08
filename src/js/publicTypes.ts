import type { AxiosRequestConfig } from "axios"
import type { DeepPartial } from "ts-essentials"
import type { Param, ReturnCommon, UpdateMethod } from "./types"

export interface Resource {
    id?: string | number
}

export interface ReturnList<T extends Resource, U, V> extends ReturnCommon<T, U> {
    /**
     * Updates an existing item for the current resource
     * @param id The id of the item to update
     * @param update Partial item. Omitted fields are considered unchanged.
     * @param updateMethod The update method to be used
     *  'on-success' will only update the resource in the frontend once the backend returns a successful response.
     *      The frontend will be updated using the data from the backends response (which might be different from the data sent in the request)
     *  'immediate' will update the resource in the frontend immediately while also sending the request to the backend. The frontend will be updated using
     *      only the data provided in the request, but a subsequent 'updated' event (socket only) may update the item again once the requests succeeeds
     *  'local-only' will only update the frontend with the values provided, without sending any request to the backend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (id: T["id"], update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    batchUpdate: (update: (DeepPartial<U> & {id: T["id"]})[], updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Destroys an item for the current resource
     * @param id The id of the item to destroy
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (id: T["id"], updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Extra data returned from the initial get request. Requires 'withExtra' option to be set to 'true'. See documentation
     * for this option for the expected response format
     */
    extra: V | null
}

export interface ReturnSingle<T extends Resource, U = T> extends ReturnCommon<T, U> {
    /**
     * Updates the current item
     * @param update Partial item. Omitted fields will be considered unchanged.
     * @param updateMethod The update method to be used
     *  'on-success' will only update the resource in the frontend once the backend returns a successful response.
     *      The frontend will be updated using the data from the backends response (which might be different from the data sent in the request)
     *  'immediate' will update the resource in the frontend immediately while also sending the request to the backend. The frontend will be updated using
     *      only the data provided in the request, but a subsequent 'updated' event (socket only) may update the item again once the requests succeeeds
     *  'local-only' will only update the frontend with the values provided, without sending any request to the backend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    update: (update: DeepPartial<U>, updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>,
    /**
     * Destroys the current item
     * @param updateMethod The update method to be used
     *  'on-success' will only remove the item in the frontend once the backend returns a successful response.
     *  'immediate' will update the frontend immedately while also sending the request to the backend
     *  'local-only' will only remove the item in the frontend
     * @param config An AxiosRequestConfig may be passed to be used for the request
     * @returns A void promise that resolves once an 'on-success' request is complete or immediately otherwise
     */
    destroy: (updateMethod?: UpdateMethod, config?: AxiosRequestConfig) => Promise<void>
}

export type Params = {[param: string]: Param | Param[] | Params}
export type RouteFunction = (route: string, params?: Params) => string