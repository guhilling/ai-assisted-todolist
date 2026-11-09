package board

import (
	"testing"
	"time"
)

func task(id int64, due string, importance Importance) Task {
	return Task{ID: id, Description: "t", DueDate: due, Importance: importance, State: StateTodo}
}

func TestSortOrdersByDueDateThenImportanceThenCreation(t *testing.T) {
	tasks := []Task{
		task(1, "2026-11-12", ImportanceLow),
		task(2, "2026-11-11", ImportanceLow),
		task(3, "2026-11-11", ImportanceHigh),
		task(4, "2026-11-11", ImportanceMedium),
		task(5, "2026-11-11", ImportanceHigh),
	}

	Sort(tasks)

	want := []int64{3, 5, 4, 2, 1}
	for i, id := range want {
		if tasks[i].ID != id {
			t.Fatalf("position %d: got task %d, want %d (order %v)", i, tasks[i].ID, id, ids(tasks))
		}
	}
}

func TestDueAtIsNullForAllDayAndFloatingTasks(t *testing.T) {
	allDay := task(1, "2026-11-30", ImportanceLow)
	floating := allDay
	floating.DueTime = ptr("10:00")

	for name, tk := range map[string]Task{"all day": allDay, "floating": floating} {
		at, err := DueAt(tk)
		if err != nil || at != nil {
			t.Errorf("%s: got %v, %v; want nil, nil", name, at, err)
		}
	}
}

func TestDueAtIsTheMomentInTheTasksZone(t *testing.T) {
	tk := task(1, "2026-11-30", ImportanceLow)
	tk.DueTime = ptr("10:00")
	tk.TimeZone = ptr("Europe/Berlin")

	at, err := DueAt(tk)

	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 30, 9, 0, 0, 0, time.UTC); !at.Equal(want) {
		t.Errorf("got %v, want %v", at, want)
	}
}

func TestAnUnknownZoneGivesNoDueAtRatherThanFailing(t *testing.T) {
	tk := task(1, "2026-11-30", ImportanceLow)
	tk.DueTime = ptr("10:00")
	tk.TimeZone = ptr("Mars/Olympus_Mons")

	at, err := DueAt(tk)

	if err != nil || at != nil {
		t.Errorf("got %v, %v; want nil, nil", at, err)
	}
}

func ids(tasks []Task) []int64 {
	out := make([]int64, len(tasks))
	for i, tk := range tasks {
		out[i] = tk.ID
	}
	return out
}

func ptr(s string) *string { return &s }
