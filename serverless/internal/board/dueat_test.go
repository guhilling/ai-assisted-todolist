package board

import (
	"testing"
	"time"
)

// TaskDueAtTest's daylight-saving cases: a time in a gap moves later, one in an overlap takes the
// earlier of its two moments, as Java's ZonedDateTime.of, RFC 5545 and Temporal do. 2027's changes
// in Berlin are on 28 March (02:00 becomes 03:00) and on 31 October (03:00 becomes 02:00).

func dueAt(t *testing.T, date, clock, zone string) string {
	t.Helper()
	at, err := DueAt(Task{DueDate: date, DueTime: &clock, TimeZone: &zone})
	if err != nil || at == nil {
		t.Fatalf("no moment: %v", err)
	}
	return at.Format(time.RFC3339)
}

func TestATimeInTheSpringGapMovesLater(t *testing.T) {
	// 02:30 does not exist that night; it is read with the offset from before the gap.
	if got := dueAt(t, "2027-03-28", "02:30", "Europe/Berlin"); got != "2027-03-28T01:30:00Z" {
		t.Errorf("got %s", got)
	}
}

func TestATimeInTheAutumnOverlapTakesTheEarlierMoment(t *testing.T) {
	// 02:30 happens twice that night, at +02:00 and again at +01:00.
	if got := dueAt(t, "2027-10-31", "02:30", "Europe/Berlin"); got != "2027-10-31T00:30:00Z" {
		t.Errorf("got %s", got)
	}
}

func TestTheGapAndOverlapRulesHoldInTheSouthernHemisphereToo(t *testing.T) {
	// Sydney: 2027-04-04 03:00 becomes 02:00 (overlap), 2027-10-03 02:00 becomes 03:00 (gap).
	if got := dueAt(t, "2027-04-04", "02:30", "Australia/Sydney"); got != "2027-04-03T15:30:00Z" {
		t.Errorf("overlap: got %s", got)
	}
	if got := dueAt(t, "2027-10-03", "02:30", "Australia/Sydney"); got != "2027-10-02T16:30:00Z" {
		t.Errorf("gap: got %s", got)
	}
}

func TestAnOrdinaryTimeNextToAChangeKeepsItsOwnOffset(t *testing.T) {
	// The hours either side of the spring change are not in the gap.
	if got := dueAt(t, "2027-03-28", "01:59", "Europe/Berlin"); got != "2027-03-28T00:59:00Z" {
		t.Errorf("before: got %s", got)
	}
	if got := dueAt(t, "2027-03-28", "03:00", "Europe/Berlin"); got != "2027-03-28T01:00:00Z" {
		t.Errorf("after: got %s", got)
	}
}
