package board

import (
	"strings"
	"testing"
	"time"
)

// valid is a task every rule lets through: due all day on 30 November 2099.
func valid() Task {
	return Task{Description: "Call the office", DueDate: "2099-11-30",
		Importance: ImportanceMedium, State: StateTodo}
}

func at(clock, zone string) Task {
	t := valid()
	if clock != "" {
		t.DueTime = &clock
	}
	if zone != "" {
		t.TimeZone = &zone
	}
	return t
}

func refused(t *testing.T, task Task) {
	t.Helper()
	if Check(task) == nil {
		t.Errorf("%+v was let through", task)
	}
}

func accepted(t *testing.T, task Task) {
	t.Helper()
	if err := Check(task); err != nil {
		t.Errorf("%+v was refused: %v", task, err)
	}
}

// DueTimeRulesTest, case for case.

func TestAnAllDayTaskIsAccepted(t *testing.T) { accepted(t, valid()) }

func TestAFloatingTimeIsAccepted(t *testing.T) { accepted(t, at("10:00", "")) }

func TestAZonedTimeIsAccepted(t *testing.T) {
	accepted(t, at("10:00", "Europe/Berlin"))
	accepted(t, at("10:00", "America/New_York"))
}

func TestAZoneWithoutATimeIsRefused(t *testing.T) { refused(t, at("", "Europe/Berlin")) }

func TestAZoneNobodyKnowsIsRefused(t *testing.T) { refused(t, at("10:00", "Europe/Atlantis")) }

func TestAZoneNamedInTheWrongCaseIsRefused(t *testing.T) {
	// On macOS's disk, which ignores case, time.LoadLocation alone would take it.
	refused(t, at("10:00", "europe/berlin"))
}

func TestABareOffsetIsRefused(t *testing.T) {
	// An offset is not a zone: +02:00 is Berlin's in summer only.
	refused(t, at("10:00", "+02:00"))
}

func TestAnOffsetUnderAZonesNameIsRefused(t *testing.T) {
	// Etc/GMT-2 is +02:00 all year. EST, MST and HST are zones in Go's tzdata, links to Panama,
	// Phoenix and Honolulu, but unknown to the JDK Quarkus runs on, which refuses them.
	for _, zone := range []string{"Etc/GMT-2", "EST", "MST", "HST", "ROC"} {
		refused(t, at("10:00", zone))
	}
}

func TestUTCIsAccepted(t *testing.T) {
	accepted(t, at("10:00", "UTC"))
	accepted(t, at("10:00", "Etc/UTC"))
}

func TestGMTIsAcceptedAsUTC(t *testing.T) {
	// The same for all practical purposes (Gunnar on #488).
	accepted(t, at("10:00", "GMT"))
	accepted(t, at("10:00", "Etc/GMT"))
}

func TestTheRuntimesOwnZonesAreNoZones(t *testing.T) {
	for _, zone := range []string{"Local", "", "Factory"} {
		task := at("10:00", "")
		task.TimeZone = &zone
		refused(t, task)
	}
}

func TestAZoneLongerThan64IsRefused(t *testing.T) {
	refused(t, at("10:00", "Europe/"+strings.Repeat("A", 60)))
}

// DueTimeTest's refusals of a time, at the rule rather than the wire.

func TestATimeFinerThanMinutesIsRefused(t *testing.T) { refused(t, at("10:00:30", "")) }

func TestTwentyFourOClockIsRefused(t *testing.T) { refused(t, at("24:00", "Europe/Berlin")) }

func TestATimeWithoutItsLeadingZeroIsRefused(t *testing.T) { refused(t, at("9:00", "")) }

// TaskResourceTest's invalid requests, and the bounds on the description.

func TestABlankDescriptionIsRefused(t *testing.T) {
	for _, d := range []string{"", " ", "\t\n"} {
		task := valid()
		task.Description = d
		refused(t, task)
	}
}

func TestADescriptionIsBlankAsJavaSeesIt(t *testing.T) {
	// @NotBlank is String.isBlank() in Hibernate Validator 9.1, Character.isWhitespace: an em
	// space is blank, a no-break space is not.
	task := valid()
	task.Description = " 　"
	refused(t, task)
	task.Description = " "
	accepted(t, task)
}

func TestADescriptionPastTheColumnLengthIsRefused(t *testing.T) {
	task := valid()
	task.Description = strings.Repeat("x", 256)
	refused(t, task)
	task.Description = strings.Repeat("x", 255)
	accepted(t, task)
}

func TestTheDescriptionIsMeasuredAsJavaMeasuresIt(t *testing.T) {
	// In UTF-16 code units: an emoji outside the basic plane is two, as in String.length().
	task := valid()
	task.Description = strings.Repeat("😀", 128)
	refused(t, task)
	task.Description = strings.Repeat("😀", 127) + "x"
	accepted(t, task)
}

func TestNoImportanceOrNoStateIsRefused(t *testing.T) {
	task := valid()
	task.Importance = ""
	refused(t, task)
	task = valid()
	task.State = ""
	refused(t, task)
	task = valid()
	task.Importance = "URGENT"
	refused(t, task)
}

func TestADueDateThatIsNoDateIsRefused(t *testing.T) {
	for _, d := range []string{"", "2099-02-30", "30.11.2099", "2099-11-30T10:00"} {
		task := valid()
		task.DueDate = d
		refused(t, task)
	}
}

func TestWorkingIsStoredAsTheOpenTaskItNowIs(t *testing.T) {
	// Apps from before #334 can still send it, until #345.
	if got := Open(StateWorking); got != StateTodo {
		t.Errorf("got %q", got)
	}
	if got := Open(StateDone); got != StateDone {
		t.Errorf("got %q", got)
	}
}

// TodaySomewhereTest, case for case.

func todaySomewhereAt(instant, date string) bool {
	now, err := time.Parse(time.RFC3339, instant)
	if err != nil {
		panic(err)
	}
	return TodaySomewhere(date, now)
}

func TestUTCsYesterdayIsAcceptedWhileItIsStillTodayInUTCMinusTwelve(t *testing.T) {
	if !todaySomewhereAt("2026-10-31T11:59:59Z", "2026-10-30") {
		t.Error("refused")
	}
}

func TestUTCsYesterdayIsRefusedOnceItIsTodayNowhere(t *testing.T) {
	if todaySomewhereAt("2026-10-31T12:00:00Z", "2026-10-30") {
		t.Error("accepted")
	}
}

func TestTheDayBeforeUTCMinusTwelvesTodayIsRefused(t *testing.T) {
	if todaySomewhereAt("2026-10-31T11:59:59Z", "2026-10-29") {
		t.Error("accepted")
	}
}

func TestANewTasksDueDateIsHeldToTodaySomewhere(t *testing.T) {
	// The HTTP test can tell this from "today in UTC" only before 12:00 UTC; this one always.
	if !todaySomewhereAt("2026-10-31T06:00:00Z", "2026-10-30") {
		t.Error("refused")
	}
}
