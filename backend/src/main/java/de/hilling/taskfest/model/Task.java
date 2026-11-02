package de.hilling.taskfest.model;

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
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Size;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Optional;
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

    /**
     * The longest zone name a task takes: the longest the JDK knows,
     * {@code America/Argentina/ComodRivadavia}, is 32, so twice that leaves room for tzdata to grow.
     */
    public static final int MAX_TIME_ZONE_LENGTH = 64;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    /** What is to be done; none yet while the task is a {@link #draft}. */
    @Size(max = MAX_DESCRIPTION_LENGTH)
    @Column
    public String description;

    /** When it is due; none yet while the task is a {@link #draft}. */
    @Column(name = "due_date")
    public LocalDate dueDate;

    /**
     * The time of day it is due at, to the minute (#474); none for a task due all day. Without a
     * {@link #timeZone} it is floating: read on whoever's clock is looking, like "pills at 08:00".
     */
    @Column(name = "due_time")
    public LocalTime dueTime;

    /**
     * The zone {@link #dueTime} is meant in, an IANA name such as {@code Europe/Berlin}; none for a
     * floating time. Only ever set with a time, which the {@code task_zone_only_with_time}
     * constraint holds to.
     */
    @Size(max = MAX_TIME_ZONE_LENGTH)
    @Column(name = "time_zone")
    public String timeZone;

    /**
     * Whether this is a draft (#381): what the app's add form attaches files to before Add, so they
     * upload while the form is filled in. A draft is not on the board, nor anywhere else a task is
     * seen, until it is added; one abandoned is swept with its files.
     */
    @Column(nullable = false)
    public boolean draft;

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

    /**
     * The moment a zoned task is due at; none for an all-day task or a floating time, which have no
     * one moment.
     *
     * <p>Worked out on every read and never stored, so a tzdata update in the JDK is picked up at
     * once (Skeet, "Storing UTC is not a silver bullet"). A time in a daylight-saving gap moves
     * later, and one in an overlap takes the earlier moment: what {@link ZonedDateTime#of} does,
     * and what RFC 5545 and Temporal do too.</p>
     *
     * <p>A zone this JVM does not know -- saved by one with newer tzdata, before a rollback, or
     * written around the API -- gives no moment rather than an exception, which would fail the
     * owner's whole board for one task.</p>
     *
     * @return the moment, if the task is zoned in a zone this JVM knows
     */
    public Optional<Instant> dueAt() {
        if (dueTime == null || timeZone == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(ZonedDateTime.of(dueDate, dueTime, ZoneId.of(timeZone)).toInstant());
        } catch (DateTimeException unknownZone) {
            return Optional.empty();
        }
    }

    /**
     * A task that is no draft has a description and a due date: what the database's
     * {@code task_complete_unless_draft} constraint holds to, checked here before it gets there.
     *
     * @return whether the task is a draft or complete
     */
    @AssertTrue
    public boolean isCompleteUnlessDraft() {
        return draft || description != null && !description.isBlank() && dueDate != null;
    }
}
