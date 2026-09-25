package io.github.guhilling.todo.model;

/**
 * Where a task stands in the small workflow the board models.
 *
 * <p>The three values are deliberately coarse — there is no reopening rule, no terminal
 * state and no transition validation, because a personal todo list gains nothing from
 * being a state machine. Any value may follow any other.</p>
 */
public enum TaskState {
    TODO,
    WORKING,
    DONE
}
