// Package replay deletes again any account a restore of the table brought back (#213, #553), and
// prunes the deletion records no restore can need any more. EventBridge Scheduler runs it daily
// through cmd/replay, and the restore procedure runs it once against the restored table before
// the API is switched to it, so that nobody can sign in to a restored account first
// (doc/deployment/serverless.md, Gunnar's decision on #553).
//
// It keeps every rule of the Quarkus backend's DeletionReplay: an account is deleted again only
// if it was created before its deletion, so someone who signed up again afterwards keeps the new
// one; each record is handled on its own, so one failure stops nothing else; a record is pruned
// once it is older than the oldest point the table could be restored to, unless its account is
// still there, and never while that point is unknown.
package replay

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
)

// Records is the deletion records in the bucket (internal/files).
type Records interface {
	Deletions(ctx context.Context) ([]files.Deletion, error)
	ForgetIfUnchanged(ctx context.Context, d files.Deletion) error
}

// Accounts deletes again the account a record names (internal/store's Accounts.Reapply) and says
// whether there was one to delete.
type Accounts interface {
	Reapply(ctx context.Context, hash string, at time.Time) (bool, error)
}

// RestorePoints says how far back the table could be restored (internal/store).
type RestorePoints interface {
	Oldest(ctx context.Context) (time.Time, bool, error)
}

// Report is what one run did, returned to Lambda and logged.
type Report struct {
	// Records is how many deletions are on record, Reapplied how many accounts were deleted
	// again, Failed how many could not be, and Pruned how many records were removed.
	Records, Reapplied, Failed, Pruned int
}

// Run re-applies every recorded deletion, then prunes. It fails when an account could not be
// deleted again, so that the run shows as failed; the next run tries again. Pruning that cannot
// be done only waits for the next run: a record kept longer costs nothing.
func Run(ctx context.Context, records Records, accounts Accounts, points RestorePoints) (Report, error) {
	all, err := records.Deletions(ctx)
	if err != nil {
		return Report{}, err
	}
	report := Report{Records: len(all)}
	stillThere := map[string]bool{}
	var failures []error
	for _, d := range all {
		again, err := accounts.Reapply(ctx, d.Hash, d.At)
		switch {
		case err != nil:
			slog.ErrorContext(ctx, "an account could not be deleted again; the next run tries again", "error", err)
			stillThere[d.Hash] = true
			failures = append(failures, err)
			report.Failed++
		case again:
			report.Reapplied++
		}
	}
	report.Pruned = prune(ctx, records, all, points, stillThere)
	slog.InfoContext(ctx, "replayed the account deletions", "event", "deletion-replay", "records", report.Records,
		"reapplied", report.Reapplied, "failed", report.Failed, "pruned", report.Pruned)
	if len(failures) > 0 {
		return report, fmt.Errorf("%d account(s) not deleted again: %w", len(failures), errors.Join(failures...))
	}
	return report, nil
}

// prune removes the records no restore can need any more, and returns how many it removed.
func prune(ctx context.Context, records Records, all []files.Deletion, points RestorePoints,
	stillThere map[string]bool) int {
	oldest, known, err := points.Oldest(ctx)
	if err != nil {
		slog.WarnContext(ctx, "the oldest restore point is unknown; no record is pruned", "error", err)
		return 0
	}
	pruned := 0
	for _, d := range Prunable(all, oldest, known, stillThere) {
		if err := records.ForgetIfUnchanged(ctx, d); err != nil {
			slog.WarnContext(ctx, "a deletion record could not be pruned; the next run tries again", "error", err)
			continue
		}
		pruned++
	}
	return pruned
}

// Prunable is the records no restore can make necessary again: those older than the oldest point
// the table could be restored to, except any whose account is still there, a re-deletion that
// failed, which the next run must still be able to retry. None when that point is not known.
func Prunable(all []files.Deletion, oldest time.Time, known bool, stillThere map[string]bool) []files.Deletion {
	if !known {
		return nil
	}
	var prunable []files.Deletion
	for _, d := range all {
		if d.At.Before(oldest) && !stillThere[d.Hash] {
			prunable = append(prunable, d)
		}
	}
	return prunable
}
