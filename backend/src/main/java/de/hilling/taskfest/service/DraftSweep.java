package de.hilling.taskfest.service;

import de.hilling.taskfest.attachment.AttachmentsConfig;
import de.hilling.taskfest.model.Task;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deletes draft tasks (#381) abandoned for longer than an upload may stay pending -- the app
 * killed, the phone off, the form never closed -- every minute.
 *
 * <p>The draft's row goes; its files lose their task through the foreign key's ON DELETE SET NULL,
 * and {@code AttachmentSweep} deletes them, row and object, as it does any attachment whose task went
 * without detaching it. The lifetime is {@code taskfest.attachments.pending-lifetime} (Gunnar's
 * decision on #381), so a draft lasts as long as an announced upload does.</p>
 */
@ApplicationScoped
public class DraftSweep {

    private static final Logger LOG = LoggerFactory.getLogger(DraftSweep.class);

    private final AttachmentsConfig config;

    DraftSweep(AttachmentsConfig config) {
        this.config = config;
    }

    @Scheduled(every = "1m", delayed = "1m", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void scheduled() {
        long deleted = sweep(Instant.now());
        if (deleted > 0) {
            LOG.info("Swept {} abandoned draft task(s)", deleted);
        }
    }

    /**
     * Deletes the drafts started before {@code now} minus the pending lifetime.
     *
     * @return how many were deleted
     */
    public long sweep(Instant now) {
        Instant before = now.minus(config.pendingLifetime());
        return QuarkusTransaction.requiringNew().call(() -> Task.delete("draft = true and createdAt < ?1", before));
    }
}
