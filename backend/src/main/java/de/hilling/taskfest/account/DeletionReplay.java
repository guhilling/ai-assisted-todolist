package de.hilling.taskfest.account;

import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes again any account a database restore brought back (#213): shortly after every start --
 * a restore always comes with one -- and daily.
 *
 * <p>An account is deleted again only if it was created before its deletion. A restored account
 * carries its old creation time; someone who signed up again after deleting their account has a
 * newer one, and keeps it. A stack with no bucket, such as the Compose ones, switches this off
 * with {@code every=off}.</p>
 */
@ApplicationScoped
public class DeletionReplay {

    private static final Logger LOG = LoggerFactory.getLogger(DeletionReplay.class);

    private final DeletionRecords records;
    private final AccountDeletion deletion;

    DeletionReplay(DeletionRecords records, AccountDeletion deletion) {
        this.records = records;
        this.deletion = deletion;
    }

    @Scheduled(every = "{taskfest.account.deletion-replay.every}",
        delayed = "{taskfest.account.deletion-replay.delay}",
        concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void scheduled() {
        replay();
    }

    /** Re-applies every recorded deletion to the accounts it still finds. */
    void replay() {
        Map<String, DeletionRecords.Deletion> byHash = records.all().stream()
            .collect(Collectors.toMap(DeletionRecords.Deletion::emailHash, Function.identity(), (a, b) -> b));
        if (byHash.isEmpty()) {
            return;
        }
        List<User> users = QuarkusTransaction.requiringNew().call(() -> User.<User>listAll());
        List<User> returned = users.stream()
            .filter(user -> {
                DeletionRecords.Deletion recorded = byHash.get(DeletionRecords.hash(user.email));
                return recorded != null && user.createdAt.isBefore(recorded.deletedAt());
            })
            .toList();
        for (User user : returned) {
            LOG.warn("Account {} was deleted but is back, likely from a restored snapshot; deleting it again",
                user.id);
            deletion.purge(user.email);
        }
    }
}
