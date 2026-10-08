package de.hilling.taskfest.attachment;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * That the orphan clean-up (#208) deletes each object on its own, so one failed deletion does not
 * stop the rest -- a plain unit test, since LocalStack never refuses a deletion.
 */
class OrphanDeletionTest {

    @Test
    void shouldGoOnDeletingAfterOneDeletionFails() {
        List<String> attempted = new ArrayList<>();

        List<String> deleted = OrphanedObjects.deleteEach(List.of("a", "b", "c"), key -> {
            attempted.add(key);
            if (key.equals("b")) {
                throw new IllegalStateException("S3 refused");
            }
        });

        assertEquals(List.of("a", "b", "c"), attempted);
        assertEquals(List.of("a", "c"), deleted);
    }
}
