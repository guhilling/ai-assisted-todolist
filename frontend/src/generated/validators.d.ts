/**
 * The compiled validators, typed as predicates over the generated types.
 *
 * Written by `npm run generate:api`. A validator narrows `unknown` to the type its schema
 * describes, which is the difference between this and the `as` it replaced: the claim is
 * made by a check that runs, not by an assertion the compiler erases.
 */
import type { TaskResponse, CurrentUserResponse, AuthProvidersResponse } from './types';

/** One Ajv validator: a type guard that also reports why it said no. */
export type Validator<T> = ((data: unknown) => data is T) & {
    errors?: { instancePath: string; message?: string }[] | null;
};

export declare const validateTaskResponse: Validator<TaskResponse>;
export declare const validateCurrentUserResponse: Validator<CurrentUserResponse>;
export declare const validateAuthProvidersResponse: Validator<AuthProvidersResponse>;
