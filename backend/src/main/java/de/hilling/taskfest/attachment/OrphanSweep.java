package de.hilling.taskfest.attachment;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;

/**
 * Runs {@link OrphanedObjects#sweep} shortly after every start and then daily (#208).
 *
 * <p>After every start, so that running it by hand needs no tool of its own: redeploying the
 * running version, which is how configuration is rolled out anyway, runs it. Two tasks overlap
 * during a blue/green deployment and may both run; deleting an object that is already gone is
 * harmless.</p>
 */
@ApplicationScoped
public class OrphanSweep {

    private final OrphanedObjects orphans;

    OrphanSweep(OrphanedObjects orphans) {
        this.orphans = orphans;
    }

    @Scheduled(every = "{taskfest.attachments.orphan-sweep.every}",
        delayed = "{taskfest.attachments.orphan-sweep.delay}",
        concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void sweep() {
        orphans.sweep(Instant.now());
    }
}
