package de.hilling.taskfest.account;

import de.hilling.taskfest.model.User;
import io.quarkus.hibernate.orm.panache.Panache;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.runtime.StartupEvent;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes again any account a database restore brought back (#213), and prunes the records no
 * restore can need any more.
 *
 * <p>The re-deletion runs <em>during</em> start-up, before the application serves anyone: a restore
 * always comes with a start, and a restored account must not be signed into and added to before it
 * is deleted again. It runs daily as well, together with the pruning, which asks RDS and so is kept
 * off the start-up path. An account is deleted again only if it was created before its deletion --
 * checked again under the row lock -- so someone who signed up again afterwards keeps the new one.
 * Every record and every account is handled on its own, so one failure stops nothing else.</p>
 */
@ApplicationScoped
public class DeletionReplay {

    private static final Logger LOG = LoggerFactory.getLogger(DeletionReplay.class);

    /** The users whose email hashes to one of the records', found by the database rather than in Java. */
    private static final String USERS_BY_EMAIL_HASH =
        "select * from app_user where encode(sha256(convert_to(email, 'UTF8')), 'hex') in (:hashes)";

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
        run(false);
    }

    @Scheduled(every = "{taskfest.account.deletion-replay.every}",
        delayed = "{taskfest.account.deletion-replay.delay}",
        concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void scheduled() {
        run(true);
    }

    /** One run, if deletions are enabled here; a failure is logged, never thrown into start-up. */
    void run(boolean prune) {
        if (!config.deletionsEnabled()) {
            return;
        }
        try {
            List<DeletionRecords.Deletion> all = records.all();
            replay(all);
            if (prune) {
                prune(all);
            }
        } catch (RuntimeException failure) {
            LOG.error("Could not re-apply account deletions; the next run tries again", failure);
        }
    }

    /** Re-applies these recorded deletions to the accounts it still finds. */
    private void replay(List<DeletionRecords.Deletion> all) {
        Map<String, DeletionRecords.Deletion> byHash = all.stream()
            .collect(Collectors.toMap(DeletionRecords.Deletion::emailHash, Function.identity(), (a, b) -> b));
        for (User user : restored(byHash)) {
            DeletionRecords.Deletion recorded = byHash.get(DeletionRecords.hash(user.email));
            try {
                LOG.warn("Account {} was deleted but is back, likely from a restored snapshot; deleting it again",
                    user.id);
                deletion.purge(user.email, recorded.deletedAt());
            } catch (RuntimeException failure) {
                LOG.error("Could not delete account {} again; the next run tries again", user.id, failure);
            }
        }
    }

    /** The users a record names that were created before their deletion: restored ones. */
    private static List<User> restored(Map<String, DeletionRecords.Deletion> byHash) {
        if (byHash.isEmpty()) {
            return List.of();
        }
        @SuppressWarnings("unchecked")
        List<User> named = QuarkusTransaction.requiringNew().call(() -> Panache.getEntityManager()
            .createNativeQuery(USERS_BY_EMAIL_HASH, User.class)
            .setParameter("hashes", byHash.keySet())
            .getResultList());
        return named.stream()
            .filter(user -> user.createdAt.isBefore(byHash.get(DeletionRecords.hash(user.email)).deletedAt()))
            .toList();
    }

    /**
     * Removes the records older than anything the database could be restored to -- except any whose
     * account is still there, because its re-deletion failed and must be retried.
     */
    private void prune(List<DeletionRecords.Deletion> all) {
        Map<String, DeletionRecords.Deletion> byHash = all.stream()
            .collect(Collectors.toMap(DeletionRecords.Deletion::emailHash, Function.identity(), (a, b) -> b));
        Set<String> stillPresent = restored(byHash).stream()
            .map(user -> DeletionRecords.hash(user.email))
            .collect(Collectors.toSet());
        List<DeletionRecords.Deletion> prunable =
            DeletionRecords.prunable(all, restorePoints.oldest(), stillPresent);
        for (DeletionRecords.Deletion due : prunable) {
            try {
                records.removeIfUnchanged(due);
            } catch (RuntimeException failure) {
                LOG.warn("Could not remove a deletion record; the next run tries again", failure);
            }
        }
        if (!prunable.isEmpty()) {
            LOG.info("Removed up to {} deletion record(s) older than any restorable snapshot", prunable.size());
        }
    }
}
