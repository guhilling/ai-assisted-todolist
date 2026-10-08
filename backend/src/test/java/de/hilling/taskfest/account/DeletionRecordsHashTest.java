package de.hilling.taskfest.account;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * The key a deletion record (#213) is stored under: the SHA-256 of the email, in lower-case hex.
 *
 * <p>Pinned with a known value, because a record written by one release must still be found by
 * the next: changing the hash, its encoding or the input's normalisation would silently stop
 * restored accounts from being deleted again.</p>
 */
class DeletionRecordsHashTest {

    @Test
    void shouldHashTheEmailWithSha256InLowerCaseHex() {
        // printf '%s' 'alice@example.com' | shasum -a 256
        assertEquals("ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976",
            DeletionRecords.hash("alice@example.com"));
    }

    @Test
    void shouldHashTheEmailExactlyAsSent() {
        // Users are keyed by the email exactly as the identity provider sends it, so is the record.
        assertNotEquals(DeletionRecords.hash("alice@example.com"), DeletionRecords.hash("Alice@example.com"));
    }
}
