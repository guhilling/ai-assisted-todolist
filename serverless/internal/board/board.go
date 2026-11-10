// Package board is the domain: a user's tasks as the board shows them, in the
// order doc/domain-model.md defines, with no AWS package in sight so that it would survive a move
// away from Lambda.
package board

import (
	"sort"
	"sync"
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

// The states, as the API spells them. StateWorking is only ever received, and stored as
// StateTodo (Open).
const (
	StateTodo    State = "TODO"
	StateDone    State = "DONE"
	StateWorking State = "WORKING"
)

// Task is one task, the aggregate the domain model describes: what is stored of it, and what
// the API's TaskResponse is made from.
type Task struct {
	ID          int64
	Description string
	DueDate     string // ISO date, 2026-11-30
	DueTime     *string
	TimeZone    *string
	Importance  Importance
	State       State
}

// rank orders importances, high first. One the API does not know ranks after all of them
// rather than with HIGH, which is what a missing map entry's zero would mean.
func rank(i Importance) int {
	switch i {
	case ImportanceHigh:
		return 0
	case ImportanceMedium:
		return 1
	case ImportanceLow:
		return 2
	}
	return 3
}

// Sort puts tasks in board order: by due date, then high before medium before low, then by id,
// which is creation order (#217), as the backend sorts.
func Sort(tasks []Task) {
	sort.SliceStable(tasks, func(i, j int) bool {
		a, b := tasks[i], tasks[j]
		if a.DueDate != b.DueDate {
			return a.DueDate < b.DueDate
		}
		if rank(a.Importance) != rank(b.Importance) {
			return rank(a.Importance) < rank(b.Importance)
		}
		return a.ID < b.ID
	})
}

// zones holds every zone loaded so far, or nil for a name the runtime does not know: Go does not
// cache time.LoadLocation, and a board is mostly in one or two zones.
var zones sync.Map

// loadZone is the named zone, loaded once, or nil when the runtime does not know it.
func loadZone(name string) *time.Location {
	if z, ok := zones.Load(name); ok {
		return z.(*time.Location)
	}
	z, err := time.LoadLocation(name)
	if err != nil {
		z = nil
	}
	zones.Store(name, z)
	return z
}

// DueAt is the moment a zoned task is due at, worked out on every read, so that a tzdata update
// is picked up at once; nil for an all-day or a floating task, and for a zone this runtime does
// not know, which must not fail the board.
//
// A time in a daylight-saving gap moves later, and one in an overlap takes the earlier of its two
// moments: what the Quarkus backend's ZonedDateTime.of does, and RFC 5545 and Temporal too. Go's
// own time.Date leaves that choice open, so it is made here.
func DueAt(t Task) (*time.Time, error) {
	if t.DueTime == nil || t.TimeZone == nil {
		return nil, nil
	}
	zone := loadZone(*t.TimeZone)
	if zone == nil {
		return nil, nil
	}
	wall, err := time.Parse("2006-01-02 15:04", t.DueDate+" "+*t.DueTime)
	if err != nil {
		return nil, err
	}
	at := resolve(wall, zone)
	return &at, nil
}

// resolve is the moment the wall-clock time wall (read as if UTC) is in zone, as ZonedDateTime.of
// resolves it. Every offset is between -12 and +14 hours, so the moment is within a day of wall,
// and the offsets either side of that span are the only ones it can have.
func resolve(wall time.Time, zone *time.Location) time.Time {
	offset := func(at time.Time) time.Duration {
		_, seconds := at.In(zone).Zone()
		return time.Duration(seconds) * time.Second
	}
	before, after := offset(wall.Add(-15*time.Hour)), offset(wall.Add(13*time.Hour))
	// Read with the offset from before a change first: in an overlap, where both fit, that is the
	// earlier moment.
	for _, o := range []time.Duration{before, after} {
		if at := wall.Add(-o); offset(at) == o {
			return at
		}
	}
	// Neither fits: the time is in a gap, and read with the offset from before it, which moves it
	// later by the gap's length.
	return wall.Add(-before)
}
