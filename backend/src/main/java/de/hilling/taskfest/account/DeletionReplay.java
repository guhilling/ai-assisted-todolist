package de.hilling.taskfest.account;

import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.runtime.StartupEvent;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes again any account a database restore brought back (#213), and prunes the records no
 * restore can need any more.
 *
 * <p>It runs <em>during</em> start-up, before the application serves anyone: a restore always comes
 * with a start, and a restored account must not be signed into and added to before it is deleted
 * again. Then daily, for anything the start-up run could not finish. An account is deleted again
 * only if it was created before its deletion; someone who signed up again afterwards has a newer
 * one, and keeps it. Every record and every account is handled on its own, so one failure stops
 * nothing else.</p>
 */
@ApplicationScoped
public class DeletionReplay {

    private static final Logger LOG = LoggerFactory.getLogger(DeletionReplay.class);

    private final DeletionRecords records;
    private final AccountDeletion deletion;
    private final RestorePoints restorePoints;
    private final AccountsConfig config;

    DeletionReplay(DeletionRecords records, AccountDeletion deletion, RestorePoints restorePoints,
                   AccountsConfig config) {
        this.records = records;
        this.deletion = deletion;
        this.restorePoints = restorePoints;
        this.config = config;
    }

    void onStart(@Observes StartupEvent start) {
        run();
    }

    @Scheduled(every = "{taskfest.account.deletion-replay.every}",
        delayed = "{taskfest.account.deletion-replay.delay}",
        concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void scheduled() {
        run();
    }

    /** One run, if deletions are enabled here; a failure is logged, never thrown into start-up. */
    void run() {
        if (!config.deletionsEnabled()) {
            return;
        }
        try {
            List<DeletionRecords.Deletion> all = records.all();
            replay(all);
            prune(all);
        } catch (RuntimeException failure) {
            LOG.error("Could not re-apply account deletions; the next run tries again", failure);
        }
    }

    /** Re-applies these recorded deletions to the accounts it still finds. */
    void replay(List<DeletionRecords.Deletion> all) {
        Map<String, DeletionRecords.Deletion> byHash = all.stream()
            .collect(Collectors.toMap(DeletionRecords.Deletion::emailHash, Function.identity(), (a, b) -> b));
        if (byHash.isEmpty()) {
            return;
        }
        List<User> users = QuarkusTransaction.requiringNew().call(() -> User.<User>listAll());
        for (User user : users) {
            DeletionRecords.Deletion recorded = byHash.get(DeletionRecords.hash(user.email));
            if (recorded == null || !user.createdAt.isBefore(recorded.deletedAt())) {
                continue;
            }
            try {
                LOG.warn("Account {} was deleted but is back, likely from a restored snapshot; deleting it again",
                    user.id);
                deletion.purge(user.email);
            } catch (RuntimeException failure) {
                LOG.error("Could not delete account {} again; the next run tries again", user.id, failure);
            }
        }
    }

    /** Removes the records older than anything the database could be restored to. */
    private void prune(List<DeletionRecords.Deletion> all) {
        List<DeletionRecords.Deletion> prunable = DeletionRecords.prunable(all, restorePoints.oldest());
        for (DeletionRecords.Deletion record : prunable) {
            try {
                records.remove(record);
            } catch (RuntimeException failure) {
                LOG.warn("Could not remove a deletion record; the next run tries again", failure);
            }
        }
        if (!prunable.isEmpty()) {
            LOG.info("Removed {} deletion record(s) older than any restorable snapshot", prunable.size());
        }
    }
}
