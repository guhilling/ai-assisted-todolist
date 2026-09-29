/**
 * The types the backend speaks, generated from its published JSON Schemas.
 *
 * Written by `npm run generate:api`; `frontend-ci.yml` fails if this file and the schemas
 * under `doc/api/schema/` have come apart. Edit the backend, not this.
 */

/**
 * The `AuthProviderResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/AuthProviderResponse.schema.json`. Do not edit.
 */
export type AuthProviderResponse = {
    id: string;
    label: string;
    available: boolean;
    loginUrl: string | null;
    issuer: string;
};

/**
 * The `AuthProvidersResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/AuthProvidersResponse.schema.json`. Do not edit.
 */
export type AuthProvidersResponse = {
    enabled: boolean;
    providers: AuthProviderResponse[];
};

/**
 * The `CurrentUserResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/CurrentUserResponse.schema.json`. Do not edit.
 */
export type CurrentUserResponse = {
    email: string;
    name?: string | null;
    pictureUrl?: string | null;
};

/**
 * The `LocalDate` the backend speaks.
 *
 * Generated from `doc/api/schema/LocalDate.schema.json`. Do not edit.
 */
export type LocalDate = string;

/**
 * The `TaskCreateRequest` the backend speaks.
 *
 * Generated from `doc/api/schema/TaskCreateRequest.schema.json`. Do not edit.
 */
export type TaskCreateRequest = {
    description: string;
    dueDate: LocalDate;
    importance: TaskImportance;
    state: TaskState;
};

/**
 * The `TaskImportance` the backend speaks.
 *
 * Generated from `doc/api/schema/TaskImportance.schema.json`. Do not edit.
 */
export type TaskImportance = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * The `TaskResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/TaskResponse.schema.json`. Do not edit.
 */
export type TaskResponse = {
    id: number;
    description: string;
    dueDate: LocalDate;
    importance: TaskImportance;
    state: TaskState;
};

/**
 * The `TaskState` the backend speaks.
 *
 * Generated from `doc/api/schema/TaskState.schema.json`. Do not edit.
 */
export type TaskState = 'TODO' | 'WORKING' | 'DONE';

/**
 * The `TaskUpdateRequest` the backend speaks.
 *
 * Generated from `doc/api/schema/TaskUpdateRequest.schema.json`. Do not edit.
 */
export type TaskUpdateRequest = {
    description: string;
    dueDate: LocalDate;
    importance: TaskImportance;
    state: TaskState;
};
