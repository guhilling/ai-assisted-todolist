package de.hilling.taskfest.model;

/**
 * How much a task matters relative to its owner's other tasks.
 *
 * <p>It orders tasks due the same day, most important first (#217), and sets a dot's colour in
 * the UI; across dates the due date alone decides. <strong>The declaration order is the rank</strong>,
 * least important first, here and in the PostgreSQL enum {@code task_importance} that
 * {@code TaskEnumColumnTest} keeps in step: the task list sorts by it descending. A new level goes
 * where it ranks -- {@code ALTER TYPE ... ADD VALUE ... BEFORE/AFTER} -- not simply at the end.</p>
 */
public enum TaskImportance {
    LOW,
    MEDIUM,
    HIGH
}
