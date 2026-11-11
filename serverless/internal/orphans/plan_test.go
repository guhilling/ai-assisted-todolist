package orphans

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

// OrphanPlanTest, case for case.

var now = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

const day = 24 * time.Hour

func object(key string, age time.Duration) files.Stored {
	return files.Stored{Key: key, LastModified: now.Add(-age)}
}

func row(id int64, key string, available bool) store.FileRow {
	return store.FileRow{Owner: "USER#owner", ID: id, ObjectKey: key, Available: available}
}

func plan(objects []files.Stored, rows []store.FileRow) Plan {
	return PlanRun(objects, rows, now)
}

func TestAnObjectForALinkIsNeitherMissedNorKept(t *testing.T) {
	// A link (#414) is its item alone: no object to find missing, none to keep from deletion.
	p := plan([]files.Stored{object("orphan", 8*day), object("kept", 8*day)},
		[]store.FileRow{row(1, "kept", true), row(2, "", true)})

	if !slices.Equal(p.Deletions, []string{"orphan"}) || len(p.Missing) != 0 {
		t.Errorf("%+v", p)
	}
}

func TestLinksButNoFilesHoldTheRun(t *testing.T) {
	p := plan([]files.Stored{object("orphan", 8*day)}, []store.FileRow{row(1, "", true)})

	if len(p.Deletions) != 0 || p.Hold != HoldNoAttachments {
		t.Errorf("%+v", p)
	}
}

func TestAnObjectNoItemRefersToGoesOnceOlderThanTheMargin(t *testing.T) {
	p := plan([]files.Stored{object("orphan", 8*day), object("kept", 8*day)}, []store.FileRow{row(1, "kept", true)})

	if !slices.Equal(p.Deletions, []string{"orphan"}) || p.Orphans != 1 || p.Hold != HoldNone {
		t.Errorf("%+v", p)
	}
}

func TestAnOrphanYoungerThanTheMarginIsSparedButCounted(t *testing.T) {
	// Counted, so the alert sees it from the first hour rather than after seven days.
	p := plan([]files.Stored{object("young", 6*day)}, []store.FileRow{row(1, "other", true)})

	if len(p.Deletions) != 0 || p.Orphans != 1 {
		t.Errorf("%+v", p)
	}
}

func TestOnlyOrphansOlderThanAnUploadTakesCountTowardsTheAlert(t *testing.T) {
	// An upload whose item was written just after the run read the items looks like an orphan for
	// a moment; it must not page anyone.
	p := plan([]files.Stored{object("in-flight", 5*time.Minute), object("stale", 2*time.Hour)},
		[]store.FileRow{row(1, "other", true)})

	if p.Orphans != 2 || p.Alertable != 1 {
		t.Errorf("%+v", p)
	}
}

func TestEveryOrphanGoesHoweverMany(t *testing.T) {
	var objects []files.Stored
	for i := range 500 {
		objects = append(objects, object(fmt.Sprintf("o%d", i), 8*day))
	}

	if p := plan(objects, []store.FileRow{row(1, "known", true)}); len(p.Deletions) != 500 {
		t.Errorf("%d deletions", len(p.Deletions))
	}
}

func TestATableWithNoAttachmentsDeletesNothingButCountsEverything(t *testing.T) {
	// An environment brought up with an empty table, its bucket intact: nothing goes, and every
	// object counts as an orphan, so the alert says something is wrong.
	p := plan([]files.Stored{object("a", 30*day), object("b", 30*day)}, nil)

	if len(p.Deletions) != 0 || p.Orphans != 2 || p.Hold != HoldNoAttachments {
		t.Errorf("%+v", p)
	}
}

func TestAvailableAttachmentsWithoutTheirObjectAreNamedButNotPendingOnes(t *testing.T) {
	p := plan([]files.Stored{object("present", day)},
		[]store.FileRow{row(1, "present", true), row(2, "missing", true), row(3, "not-yet", false)})

	if len(p.Missing) != 1 || p.Missing[0].ID != 2 {
		t.Errorf("%+v", p.Missing)
	}
}

func TestWhatWasListedIsCounted(t *testing.T) {
	if p := plan([]files.Stored{object("a", 0), object("b", 0)}, nil); p.Listed != 2 {
		t.Error(p.Listed)
	}
}

func TestAnAttachmentsThumbnailIsKeptAndAnOrphansDeleted(t *testing.T) {
	// A thumbnail (#236) belongs to its attachment's item, and goes when the item has gone.
	p := plan([]files.Stored{object("kept", 8*day), object(board.ThumbnailKey("kept"), 8*day),
		object(board.ThumbnailKey("gone"), 8*day)}, []store.FileRow{row(1, "kept", true)})

	if !slices.Equal(p.Deletions, []string{board.ThumbnailKey("gone")}) || p.Orphans != 1 {
		t.Errorf("%+v", p)
	}
}

func TestAnAttachmentIsNotMissedForWantOfAThumbnail(t *testing.T) {
	// Most attachments have none, a PDF or an older image, and that is no missing object.
	if p := plan([]files.Stored{object("kept", 8*day)}, []store.FileRow{row(1, "kept", true)}); len(p.Missing) != 0 {
		t.Errorf("%+v", p.Missing)
	}
}
