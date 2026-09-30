package io.github.guhilling.todo.model;

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
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * A single thing its owner means to get done: the aggregate root of this domain.
 *
 * <p>A task has no independent existence — {@code owner} is mandatory and never changes,
 * so every task belongs to exactly one {@link User} from the moment it is created. That is
 * the invariant the whole board rests on, and it is enforced twice: by the not-null column
 * here and by the ownership predicate in every query {@code TaskResource} issues.</p>
 *
 * <p>The fields are public because this is a Panache active-record entity; Hibernate
 * rewrites accesses into accessor calls at build time, so the public fields are an idiom
 * rather than an encapsulation hole. Checkstyle's VisibilityModifier check is switched off
 * in this project for exactly that reason.</p>
 */
@Entity
public class Task extends PanacheEntityBase {

    public static final int MAX_DESCRIPTION_LENGTH = 255;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @NotBlank
    @Size(max = MAX_DESCRIPTION_LENGTH)
    @Column(nullable = false)
    public String description;

    @Column(name = "due_date", nullable = false)
    public LocalDate dueDate;

    /**
     * How much the task matters, as the PostgreSQL {@code task_importance} enum type.
     *
     * <p>{@code NAMED_ENUM} is what makes the column the database's own enum rather than a
     * string: the driver would otherwise send a {@code varchar} parameter, which PostgreSQL
     * refuses to assign to an enum column without a cast. {@code columnDefinition} names the
     * type, because Hibernate would otherwise derive it from this Java type and look for
     * {@code taskimportance}.</p>
     */
    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "task_importance")
    public TaskImportance importance;

    /** Where the task stands, as the PostgreSQL {@code task_state} enum type. */
    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "task_state")
    public TaskState state = TaskState.TODO;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    public User owner;
}
