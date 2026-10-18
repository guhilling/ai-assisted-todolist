package de.hilling.taskfest.model;

/**
 * Where a task stands in the small workflow the board models: open or done.
 *
 * <p>{@link #WORKING}, "in progress", is no longer offered by the website or the app (#334), and the
 * tasks that had it became open. It stays here until #345 removes it, because apps installed
 * before then can still send it.</p>
 *
 * <p>The values are deliberately coarse — there is no reopening rule, no terminal
 * state and no transition validation, because a personal todo list gains nothing from
 * being a state machine. Any value may follow any other.</p>
 */
public enum TaskState {
    TODO,
    WORKING,
    DONE
}
