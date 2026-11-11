package board

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
)

// The bounds on a task's strings, the Quarkus backend's columns (doc/decisions/domain-and-backend.md).
const (
	MaxDescriptionLength = 255
	// MaxTimeZoneLength leaves room for tzdata to grow: the longest name, America/Argentina/
	// ComodRivadavia, is 32.
	MaxTimeZoneLength = 64
)

// dueTimePattern is a due time as the contract publishes it: hours and minutes, 00:00 to 23:59.
var dueTimePattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// Check says whether a task's fields keep every rule the Quarkus backend's request records hold
// them to, but for the one only a new task has (TodaySomewhere). It answers why not, for the log;
// the caller gets a 400 either way, as from Quarkus.
func Check(t Task) error {
	switch {
	case isBlank(t.Description):
		return errors.New("the description is blank")
	case javaLength(t.Description) > MaxDescriptionLength:
		return errors.New("the description is too long")
	case !isDate(t.DueDate):
		return errors.New("the due date is no date")
	case t.DueTime != nil && !dueTimePattern.MatchString(*t.DueTime):
		return errors.New("the due time is not HH:mm")
	case t.TimeZone != nil && javaLength(*t.TimeZone) > MaxTimeZoneLength:
		return errors.New("the time zone is too long")
	case t.TimeZone != nil && !KnownZone(*t.TimeZone):
		return errors.New("the time zone is none the backend knows")
	case t.TimeZone != nil && t.DueTime == nil:
		// A zone says where a time is meant, so on an all-day task it would say nothing.
		return errors.New("a time zone needs a due time")
	case t.Importance != ImportanceLow && t.Importance != ImportanceMedium && t.Importance != ImportanceHigh:
		return errors.New("the importance is none")
	case t.State != StateTodo && t.State != StateDone:
		return errors.New("the state is none")
	}
	return nil
}

// Open is the state a task is stored with: WORKING, which apps from before #334 can still send
// until #345, is the open task it now is.
func Open(s State) State {
	if s == StateWorking {
		return StateTodo
	}
	return s
}

// westernmost is UTC-12, the zone whose today is the earliest date still today anywhere.
var westernmost = time.FixedZone("UTC-12", -12*60*60)

// TodaySomewhere says whether a new task's due date is today or later somewhere: no earlier than
// today in UTC-12 (#425). Judged by UTC, a task due today was refused as past at 21:00 in New
// York. The cost is that a user ahead of UTC-12 may set yesterday, which an update can do anyway.
func TodaySomewhere(date string, now time.Time) bool {
	return date >= now.In(westernmost).Format(time.DateOnly)
}

// asThemselves are the fixed offsets that are meant as themselves: UTC, and GMT, the same for all
// practical purposes (Gunnar on #488).
var asThemselves = map[string]bool{"UTC": true, "Etc/UTC": true, "GMT": true, "Etc/GMT": true}

// unknownToJava are zones in Go's tzdata that the JDK the Quarkus backend runs on does not have:
// EST, MST and HST, once fixed offsets and now links, and ROC. The JDK refuses them, so do we.
// The other way round, the JDK still has a few SystemV/ zones tzdata dropped long ago; no browser
// or app sends one, so that difference stays.
var unknownToJava = map[string]bool{"EST": true, "MST": true, "HST": true, "ROC": true}

// KnownZone says whether a task may be given this zone (#474): an IANA name the backend knows,
// exactly as written, that is not a fixed offset by another name. Etc/GMT-2 is +02:00 all year,
// so a task given it would come out an hour wrong for half of it, as with a bare offset, which is
// no name at all.
func KnownZone(name string) bool {
	if asThemselves[name] {
		return true
	}
	if !tzdataZones[name] || unknownToJava[name] {
		return false
	}
	zone := loadZone(name)
	if zone == nil {
		return false
	}
	// A zone with no transitions at all is a fixed offset, as Java's ZoneRules.isFixedOffset.
	start, end := time.Now().In(zone).ZoneBounds()
	return !start.IsZero() || !end.IsZero()
}

// isDate says whether s is a date as the contract writes it, 2026-11-10.
func isDate(s string) bool {
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
}

// Blank says whether a request's text is blank as @NotBlank says: Java's String.isBlank.
func Blank(s string) bool { return isBlank(s) }

// Length is a request's text's length as @Size measures it, in UTF-16 code units.
func Length(s string) int { return javaLength(s) }

// isBlank is Java's String.isBlank, which @NotBlank uses: nothing but Character.isWhitespace.
func isBlank(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return !javaWhitespace(r) }) < 0
}

// javaWhitespace is Character.isWhitespace: a Unicode space, line or paragraph separator other
// than the no-break ones, or one of the ASCII controls Java counts.
func javaWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', 0x1c, 0x1d, 0x1e, 0x1f:
		return true
	case 0x00a0, 0x2007, 0x202f:
		return false
	}
	return unicode.In(r, unicode.Zs, unicode.Zl, unicode.Zp)
}

// javaLength is a string's length as Java counts it, in UTF-16 code units: what @Size bounds.
func javaLength(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}
