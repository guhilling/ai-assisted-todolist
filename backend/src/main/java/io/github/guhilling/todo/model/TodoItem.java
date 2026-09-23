package io.github.guhilling.todo.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;

@Entity
public class TodoItem extends PanacheEntity {

    @NotBlank
    @Column(nullable = false)
    public String description;

    @FutureOrPresent
    @Column(nullable = false)
    public LocalDate dueDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public TodoState state = TodoState.OPEN;
}
