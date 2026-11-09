// Package board is the domain of the spike (#535): a user's tasks as the board shows them, in the
// order doc/domain-model.md defines, with no AWS package in sight so that it would survive a move
// away from Lambda.
package board

import (
	"sort"
	"time"
)

// Importance is how much a task matters to its owner; it orders tasks within one due date.
type Importance string

// The importances, as the API spells them.
const (
	ImportanceLow    Importance = "LOW"
	ImportanceMedium Importance = "MEDIUM"
	ImportanceHigh   Importance = "HIGH"
)

// State is whether a task is open or done.
type State string

// The states, as the API spells them.
const (
	StateTodo State = "TODO"
	StateDone State = "DONE"
)

// Task is one task as the board lists it: the fields of the API's TaskResponse that the spike
// stores. CreatedAt only breaks ties and is not sent.
type Task struct {
	ID          int64
	Description string
	DueDate     string // ISO date, 2026-11-30
	DueTime     *string
	TimeZone    *string
	Importance  Importance
	State       State
	CreatedAt   time.Time
}

var rank = map[Importance]int{ImportanceHigh: 0, ImportanceMedium: 1, ImportanceLow: 2}

// Sort puts tasks in board order: by due date, then high before medium before low, then by
// creation (#217).
func Sort(tasks []Task) {
	sort.SliceStable(tasks, func(i, j int) bool {
		a, b := tasks[i], tasks[j]
		if a.DueDate != b.DueDate {
			return a.DueDate < b.DueDate
		}
		if rank[a.Importance] != rank[b.Importance] {
			return rank[a.Importance] < rank[b.Importance]
		}
		return a.CreatedAt.Before(b.CreatedAt)
	})
}

// DueAt is the moment a zoned task is due at, worked out on every read; nil for an all-day or a
// floating task, and for a zone this runtime does not know, which must not fail the board.
//
// The spike takes Go's resolution of a daylight-saving gap or overlap as it is; whether it
// matches the backend's (later in a gap, earlier in an overlap) is checked by the port.
func DueAt(t Task) (*time.Time, error) {
	if t.DueTime == nil || t.TimeZone == nil {
		return nil, nil
	}
	zone, err := time.LoadLocation(*t.TimeZone)
	if err != nil {
		return nil, nil
	}
	local, err := time.ParseInLocation("2006-01-02 15:04", t.DueDate+" "+*t.DueTime, zone)
	if err != nil {
		return nil, err
	}
	at := local.UTC()
	return &at, nil
}
