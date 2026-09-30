package io.github.guhilling.todo.model;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Checks that the two enum columns really are the database's own enum types.
 *
 * <p>The mapping is easy to lose. Dropping {@code @JdbcTypeCode(SqlTypes.NAMED_ENUM)} or the
 * {@code columnDefinition} leaves an application that still compiles, still passes every other
 * test, and quietly stores a string in a column that was meant to constrain it. Hibernate's
 * schema validation does not catch that on its own, so this asserts the shape from the database
 * side instead.</p>
 *
 * <p>The label test is the one that matters most. A native enum is only worth having while the
 * database and the Java type agree, and they are declared in two different files: the Java enum
 * and {@code db/changes/001-baseline.xml}. Adding a constant to one and not the other fails
 * here rather than at the first request that uses it.</p>
 */
@QuarkusTest
class TaskEnumColumnTest {

    @Inject
    DataSource dataSource;

    private <T> T query(String sql, SqlFunction<ResultSet, T> read) {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql);
             ResultSet results = statement.executeQuery()) {
            return read.apply(results);
        } catch (SQLException cause) {
            throw new IllegalStateException(sql, cause);
        }
    }

    /** The database's name for a column's type, which for an enum column is the type itself. */
    private String underlyingTypeOf(String column) {
        return query(
            "select udt_name from information_schema.columns"
                + " where table_name = 'task' and column_name = '" + column + "'",
            results -> {
                results.next();
                return results.getString(1);
            });
    }

    /** Every label of a PostgreSQL enum type, in the order the type declares them. */
    private List<String> labelsOf(String type) {
        return query(
            "select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid"
                + " where t.typname = '" + type + "' order by e.enumsortorder",
            results -> {
                List<String> labels = new ArrayList<>();
                while (results.next()) {
                    labels.add(results.getString(1));
                }
                return labels;
            });
    }

    @Test
    void shouldStoreStateAsTheDatabasesOwnEnumType() {
        assertThat(underlyingTypeOf("state"), equalTo("task_state"));
    }

    @Test
    void shouldStoreImportanceAsTheDatabasesOwnEnumType() {
        assertThat(underlyingTypeOf("importance"), equalTo("task_importance"));
    }

    @Test
    void shouldDeclareTheSameStatesAsTheJavaEnum() {
        assertThat(labelsOf("task_state"), contains(names(TaskState.values())));
    }

    @Test
    void shouldDeclareTheSameImportancesAsTheJavaEnum() {
        assertThat(labelsOf("task_importance"), contains(names(TaskImportance.values())));
    }

    @Test
    void shouldRefuseAStateTheApplicationDoesNotDefine() {
        // The point of the whole change: the database itself rejects the value, rather than
        // storing it and leaving the mistake to be found by whatever reads it next.
        assertThrows(
            IllegalStateException.class,
            () -> query("select 'NOPE'::task_state", results -> null));
    }

    private static String[] names(Enum<?>[] values) {
        return Arrays.stream(values).map(Enum::name).toArray(String[]::new);
    }

    /** A {@link java.util.function.Function} that is allowed to throw, which JDBC calls do. */
    @FunctionalInterface
    private interface SqlFunction<T, R> {
        R apply(T input) throws SQLException;
    }
}
