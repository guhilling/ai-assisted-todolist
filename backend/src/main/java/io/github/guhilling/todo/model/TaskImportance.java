package io.github.guhilling.todo.model;

/**
 * How much a task matters relative to its owner's other tasks.
 *
 * <p>Importance is purely descriptive: it sets a dot's colour in the UI and never affects
 * ordering, which is always by due date.</p>
 */
public enum TaskImportance {
    LOW,
    MEDIUM,
    HIGH
}
