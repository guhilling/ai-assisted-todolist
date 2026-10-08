package de.hilling.taskfest.attachment;

import de.hilling.taskfest.model.Task;
import de.hilling.taskfest.model.User;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A file attached to a task (#204): its metadata here, its content in S3 under {@link #objectKey}.
 *
 * <p>Its own aggregate, not part of the task's (doc/domain-model.md), and its owner's alone. The
 * owner is kept on the attachment because an attachment outlives its task for the undo window: deleting a task
 * <em>detaches</em> its attachments ({@link #detachedAt}) rather than deleting them, undo
 * attaches them to the task it re-creates, and the sweep deletes them -- row and object -- once
 * the window has passed. The object key is random and says nothing about the owner or the file.</p>
 */
@Entity
@Table(name = "attachment")
public class Attachment extends PanacheEntityBase {

    /** The longest file name kept; longer ones are cut. */
    public static final int MAX_FILE_NAME_LENGTH = 255;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    /** The task it belongs to; null while detached from a deleted one. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "task_id")
    public Task task;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    public User owner;

    @Column(name = "file_name", nullable = false, length = MAX_FILE_NAME_LENGTH)
    public String fileName;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "attachment_kind")
    public AttachmentKind kind;

    @Column(name = "size_bytes", nullable = false)
    public long sizeBytes;

    /** Where the content is in the environment's attachment bucket. */
    @Column(name = "object_key", nullable = false, unique = true)
    public String objectKey;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "attachment_state")
    public AttachmentState state = AttachmentState.PENDING;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    /** When its task was deleted; the sweep deletes it once the undo window has passed. */
    @Column(name = "detached_at")
    public Instant detachedAt;
}
