package de.hilling.taskfest.attachment;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs {@link AttachmentService#sweep} every minute: a deleted task's attachments go once the undo
 * window has passed (D3 on #204), and uploads that never arrived once they are stale.
 *
 * <p>Two tasks overlap during a blue/green deployment, so the sweep may run twice at once; deleting
 * an object or a row that is already gone is harmless.</p>
 */
@ApplicationScoped
public class AttachmentSweep {

    private static final Logger LOG = LoggerFactory.getLogger(AttachmentSweep.class);

    private final AttachmentService attachments;

    AttachmentSweep(AttachmentService attachments) {
        this.attachments = attachments;
    }

    @Scheduled(every = "1m", delayed = "1m", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void sweep() {
        int deleted = attachments.sweep(Instant.now());
        if (deleted > 0) {
            LOG.info("Swept {} attachment(s)", deleted);
        }
    }
}
