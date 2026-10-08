/**
 * The types the backend speaks, generated from its published JSON Schemas.
 *
 * Written by `npm run generate:api`; `frontend-ci.yml` fails if this file and the schemas
 * under `doc/api/schema/` have come apart. Edit the backend, not this.
 */

/**
 * The `AnnounceRequest` the backend speaks.
 *
 * Generated from `doc/api/schema/AnnounceRequest.schema.json`. Do not edit.
 */
export type AnnounceRequest = {
    fileName: string;
    contentType: string;
    sizeBytes: number;
};

/**
 * The `AttachmentResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/AttachmentResponse.schema.json`. Do not edit.
 */
export type AttachmentResponse = {
    id: number;
    fileName: string;
    contentType: string;
    sizeBytes: number;
};

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
 * The `Instant` the backend speaks.
 *
 * Generated from `doc/api/schema/Instant.schema.json`. Do not edit.
 */
export type Instant = string;

/**
 * The `LinkResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/LinkResponse.schema.json`. Do not edit.
 */
export type LinkResponse = {
    url: string;
    expiresAt: Instant;
};

/**
 * The `LocalDate` the backend speaks.
 *
 * Generated from `doc/api/schema/LocalDate.schema.json`. Do not edit.
 */
export type LocalDate = string;

/**
 * The `RefusalResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/RefusalResponse.schema.json`. Do not edit.
 */
export type RefusalResponse = {
    refusal: 'UNSUPPORTED_TYPE' | 'EMPTY' | 'TOO_LARGE' | 'TASK_FULL' | 'USER_FULL' | 'MISMATCH';
};

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
    attachmentIds?: number[] | null;
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
    attachments?: AttachmentResponse[];
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

/**
 * The `UploadResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/UploadResponse.schema.json`. Do not edit.
 */
export type UploadResponse = {
    attachment: AttachmentResponse;
    url: string;
    headers: Record<string, string>;
    expiresAt: Instant;
};

/**
 * The `VersionResponse` the backend speaks.
 *
 * Generated from `doc/api/schema/VersionResponse.schema.json`. Do not edit.
 */
export type VersionResponse = {
    version: string;
};
