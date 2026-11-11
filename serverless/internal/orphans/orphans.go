// Package orphans is the clean-up of objects in the attachment bucket that no attachment item
// refers to (#208, #552), and the report of the reverse. EventBridge Scheduler runs it hourly
// through cmd/orphans.
//
// An attachment lives in two places that cannot change in one transaction. The table's stream
// deletes the files of every attachment item that goes, but some still stay behind: an upload
// that arrives after its item expired, a stream record that ran out of retries, or a table
// restored from a backup older than files written since. Such an object would otherwise stay for
// good, unopenable and billed. The reverse, an available attachment whose object is missing, is
// only logged: deleting an item is a decision about someone's data, and the item is the one thing
// that says what was lost.
package orphans

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/store"
)

const (
	// Margin is how old an orphan must be before it is deleted: far beyond an upload link's
	// lifetime, so an upload under way is never mistaken for one left behind.
	Margin = 7 * 24 * time.Hour
	// AlertAfter is how old an orphan must be to count towards the alert: longer than an upload
	// takes, so a file whose item was written just after the run read the items never pages.
	AlertAfter = board.PendingLifetime
	// AlertAbove is how many settled orphans a run may find before it raises the alert line the
	// environment's alarm watches: Gunnar's threshold is two.
	AlertAbove = 2
)

// Hold is why a run deleted nothing it otherwise would have.
type Hold string

// The holds.
const (
	HoldNone Hold = "NONE"
	// HoldNoAttachments is a table holding no file attachments, links having no object, so it
	// cannot tell an orphan from a file: an environment brought up empty.
	HoldNoAttachments Hold = "NO_ATTACHMENTS"
)

// Plan is what one run will do, decided from a bucket listing and the attachment items alone, so
// the decision has a plain unit test.
type Plan struct {
	// Deletions is the orphans older than the margin, none when the run is held.
	Deletions []string
	Hold      Hold
	// Orphans is how many objects no item refers to, of any age, and Alertable how many of them
	// are older than AlertAfter, which is what the alert counts.
	Orphans, Alertable int
	// Missing is the available attachments whose object was not listed.
	Missing []store.FileRow
	Listed  int
}

// PlanRun decides a run at now. An object no item refers to, as its file or as its thumbnail, is
// an orphan. Every orphan is counted, whatever its age and whether or not the run is held, so the
// alert sees a table that does not match the bucket within the hour, days before anything would
// be deleted (#208, Gunnar's decision).
func PlanRun(objects []files.Stored, rows []store.FileRow, now time.Time) Plan {
	referenced, listed := map[string]bool{}, map[string]bool{}
	var fileRows []store.FileRow
	for _, r := range rows {
		if r.ObjectKey != "" {
			fileRows = append(fileRows, r)
			referenced[r.ObjectKey], referenced[board.ThumbnailKey(r.ObjectKey)] = true, true
		}
	}
	for _, o := range objects {
		listed[o.Key] = true
	}
	p := Plan{Hold: HoldNone, Listed: len(objects)}
	if len(fileRows) == 0 {
		p.Hold = HoldNoAttachments
	}
	for _, r := range fileRows {
		if r.Available && !listed[r.ObjectKey] {
			p.Missing = append(p.Missing, r)
		}
	}
	for _, o := range objects {
		if referenced[o.Key] {
			continue
		}
		p.Orphans++
		if o.LastModified.Before(now.Add(-AlertAfter)) {
			p.Alertable++
		}
		if p.Hold == HoldNone && o.LastModified.Before(now.Add(-Margin)) {
			p.Deletions = append(p.Deletions, o.Key)
		}
	}
	return p
}

// Bucket is the attachment bucket as the clean-up uses it: internal/files, or a test's.
type Bucket interface {
	List(ctx context.Context) ([]files.Stored, error)
	Head(ctx context.Context, key string) (files.Object, bool, error)
	Delete(ctx context.Context, key string) error
}

// Items is the attachment items as the clean-up reads them: internal/store, or a test's.
type Items interface {
	FileRows(ctx context.Context) ([]store.FileRow, error)
	StillAvailable(ctx context.Context, r store.FileRow, now time.Time) (bool, error)
}

// Report is what one run found and did.
type Report struct {
	Listed, Orphans int
	Alerted         bool
	// Deleted is the keys of the objects deleted; keys are random and name no file.
	Deleted []string
	Hold    Hold
	// WithoutObject is the available attachments whose object is missing, as owner/id.
	WithoutObject []string
}

// Sweep runs the clean-up as of now. The items are read before the bucket is listed, so a file
// uploaded in between is unknown to the items and too young to go, never mistaken for an orphan.
func Sweep(ctx context.Context, items Items, bucket Bucket, now time.Time) (Report, error) {
	rows, err := items.FileRows(ctx)
	if err != nil {
		return Report{}, err
	}
	objects, err := bucket.List(ctx)
	if err != nil {
		return Report{}, err
	}
	p := PlanRun(objects, rows, now)
	r := Report{Listed: p.Listed, Orphans: p.Orphans, Alerted: p.Alertable > AlertAbove, Hold: p.Hold}
	// Each on its own, so one failure does not stop the rest; a failed one is left for the next run.
	for _, key := range p.Deletions {
		if err := bucket.Delete(ctx, key); err != nil {
			slog.WarnContext(ctx, "an orphaned object could not be deleted; the next run tries again",
				"key", key, "error", err)
			continue
		}
		r.Deleted = append(r.Deleted, key)
	}
	// Checked again: one removed while the run was listing would otherwise be reported as lost.
	for _, row := range p.Missing {
		available, err := items.StillAvailable(ctx, row, now)
		if err != nil {
			return r, err
		}
		_, there, err := bucket.Head(ctx, row.ObjectKey)
		if err != nil {
			return r, err
		}
		if available && !there {
			r.WithoutObject = append(r.WithoutObject, fmt.Sprintf("%s/%d", row.Owner, row.ID))
		}
	}
	report(ctx, r, p)
	return r, nil
}

// The run line's fields, and the alert line's: the field the alarm's metric filter matches.
const (
	runListed  = "orphanSweepListed"
	runOrphans = "orphanSweepOrphans"
	runDeleted = "orphanSweepDeleted"
	alert      = "orphanSweepAlert"
)

// report logs what a run found and did, the counts as fields of their own.
func report(ctx context.Context, r Report, p Plan) {
	slog.InfoContext(ctx, fmt.Sprintf("Orphan clean-up: %d object(s) listed, %d orphan(s), %d deleted",
		r.Listed, r.Orphans, len(r.Deleted)), runListed, r.Listed, runOrphans, r.Orphans, runDeleted, len(r.Deleted))
	if r.Alerted {
		slog.WarnContext(ctx, fmt.Sprintf("%d object(s) older than an hour have no attachment referring to them; "+
			"more than %d. A table restored from an older backup, or started empty, looks like this, "+
			"and orphans are deleted after %v.", p.Alertable, AlertAbove, Margin), alert, true)
	}
	if len(r.Deleted) > 0 {
		slog.InfoContext(ctx, "deleted objects no attachment refers to", "keys", r.Deleted)
	}
	if r.Hold == HoldNoAttachments && r.Listed > 0 {
		slog.WarnContext(ctx, fmt.Sprintf("The table holds no file attachments but the bucket holds %d object(s); "+
			"deleted none.", r.Listed))
	}
	if len(r.WithoutObject) > 0 {
		slog.WarnContext(ctx, "available attachments have no object in storage, kept for a person to look at",
			"attachments", r.WithoutObject)
	}
}
