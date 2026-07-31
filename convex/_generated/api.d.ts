/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as estimateLeads from "../estimateLeads.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as notifications from "../notifications.js";
import type * as timeClock from "../timeClock.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appointments: typeof appointments;
  auth: typeof auth;
  crons: typeof crons;
  customers: typeof customers;
  estimateLeads: typeof estimateLeads;
  http: typeof http;
  inventory: typeof inventory;
  notifications: typeof notifications;
  timeClock: typeof timeClock;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
