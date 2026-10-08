package de.hilling.taskfest.attachment;

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

/**
 * Checks that an attachment's kind and state are the database's own enum types, declaring the
 * same labels as the Java enums -- the attachment counterpart of {@code TaskEnumColumnTest}, for
 * the same reason: the two are declared in different files ({@code db/changes/002-attachments.xml}
 * and the enums), and drift should fail here rather than at the first upload.
 */
@QuarkusTest
class AttachmentEnumColumnTest {

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

    private String underlyingTypeOf(String column) {
        return query(
            "select udt_name from information_schema.columns"
                + " where table_name = 'attachment' and column_name = '" + column + "'",
            results -> {
                results.next();
                return results.getString(1);
            });
    }

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
    void shouldStoreKindAndStateAsTheDatabasesOwnEnumTypes() {
        assertThat(underlyingTypeOf("kind"), equalTo("attachment_kind"));
        assertThat(underlyingTypeOf("state"), equalTo("attachment_state"));
    }

    @Test
    void shouldDeclareTheSameKindsAsTheJavaEnum() {
        assertThat(labelsOf("attachment_kind"), contains(names(AttachmentKind.values())));
    }

    @Test
    void shouldDeclareTheSameStatesAsTheJavaEnum() {
        assertThat(labelsOf("attachment_state"), contains(names(AttachmentState.values())));
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
