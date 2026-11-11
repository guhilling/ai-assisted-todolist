package replay

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
)

var (
	oldest = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	// now is the run's clock, well after every record but the in-flight one.
	now = oldest.Add(30 * 24 * time.Hour)
)

func deletion(hash string, at time.Time) files.Deletion { return files.Deletion{Hash: hash, At: at} }

func hashes(ds []files.Deletion) []string {
	var out []string
	for _, d := range ds {
		out = append(out, d.Hash)
	}
	slices.Sort(out)
	return out
}

func TestOnlyRecordsOlderThanTheOldestRestorePointByTheMarginArePruned(t *testing.T) {
	// The margin covers a deletion finished up to a day after its record was written.
	records := []files.Deletion{deletion("before", oldest.Add(-PruneMargin-time.Hour)),
		deletion("within", oldest.Add(-PruneMargin+time.Hour)), deletion("after", oldest.Add(time.Hour))}

	got := Prunable(records, oldest, true, nil)

	if !slices.Equal(hashes(got), []string{"before"}) {
		t.Errorf("pruned %v", hashes(got))
	}
}

func TestTheRecordOfAnAccountStillThereIsKept(t *testing.T) {
	// Its re-deletion failed; pruning the record would make the failure permanent.
	records := []files.Deletion{deletion("failed", oldest.Add(-PruneMargin-time.Hour))}

	if got := Prunable(records, oldest, true, map[string]bool{"failed": true}); len(got) != 0 {
		t.Errorf("pruned %v", hashes(got))
	}
}

func TestNothingIsPrunedWhenTheOldestRestorePointIsUnknown(t *testing.T) {
	records := []files.Deletion{deletion("old", oldest.Add(-365*24*time.Hour))}

	if got := Prunable(records, time.Time{}, false, nil); len(got) != 0 {
		t.Errorf("pruned %v", hashes(got))
	}
}

// fakes for one run: the records, which accounts are back or fail, and the restore points.
type fakeRecords struct {
	records []files.Deletion
	pruned  []string
}

func (f *fakeRecords) Deletions(context.Context) ([]files.Deletion, error) { return f.records, nil }

func (f *fakeRecords) ForgetIfUnchanged(_ context.Context, d files.Deletion) error {
	f.pruned = append(f.pruned, d.Hash)
	return nil
}

type fakeAccounts struct {
	back, failing map[string]bool
	asked         map[string]time.Time
}

func (f *fakeAccounts) Reapply(_ context.Context, hash string, at time.Time) (bool, error) {
	f.asked[hash] = at
	if f.failing[hash] {
		return false, errors.New("throttled")
	}
	return f.back[hash], nil
}

type fakePoints struct {
	oldest time.Time
	known  bool
	err    error
}

func (f fakePoints) Oldest(context.Context) (time.Time, bool, error) { return f.oldest, f.known, f.err }

func TestEveryRecordIsReappliedAtItsTimeAndAFailureStopsNoOther(t *testing.T) {
	records := &fakeRecords{records: []files.Deletion{deletion("back", oldest.Add(time.Hour)),
		deletion("failing", oldest.Add(2*time.Hour)), deletion("gone", oldest.Add(3*time.Hour))}}
	accounts := &fakeAccounts{back: map[string]bool{"back": true}, failing: map[string]bool{"failing": true},
		asked: map[string]time.Time{}}

	report, err := Run(context.Background(), now, records, accounts, fakePoints{oldest: oldest, known: true})

	if err == nil {
		t.Error("a failed re-deletion did not fail the run")
	}
	for _, r := range records.records {
		if !accounts.asked[r.Hash].Equal(r.At) {
			t.Errorf("%s asked at %v; want %v", r.Hash, accounts.asked[r.Hash], r.At)
		}
	}
	if report.Records != 3 || report.Reapplied != 1 || report.Failed != 1 {
		t.Errorf("report %+v", report)
	}
}

func TestARunPrunesWhatNoRestoreCanNeedButAFailedAccountsRecord(t *testing.T) {
	gone := oldest.Add(-PruneMargin - time.Hour)
	records := &fakeRecords{records: []files.Deletion{deletion("long-gone", gone),
		deletion("failing", gone), deletion("recent", oldest.Add(time.Hour))}}
	accounts := &fakeAccounts{failing: map[string]bool{"failing": true}, asked: map[string]time.Time{}}

	report, _ := Run(context.Background(), now, records, accounts, fakePoints{oldest: oldest, known: true})

	if !slices.Equal(records.pruned, []string{"long-gone"}) || report.Pruned != 1 {
		t.Errorf("pruned %v, report %+v", records.pruned, report)
	}
}

func TestEveryRecordIsKeptWhenTheRestorePointsCannotBeRead(t *testing.T) {
	records := &fakeRecords{records: []files.Deletion{deletion("old", oldest.Add(-PruneMargin-time.Hour))}}
	accounts := &fakeAccounts{asked: map[string]time.Time{}}

	_, err := Run(context.Background(), now, records, accounts, fakePoints{err: errors.New("access denied")})

	if err != nil || len(records.pruned) != 0 {
		t.Errorf("pruned %v, %v", records.pruned, err)
	}
}

func TestARecordStillBeingWrittenIsLeftToItsRequest(t *testing.T) {
	// Its request may yet fail to mark the account and take the record back; the user is then
	// told the deletion failed, and the replay must not have carried it out.
	records := &fakeRecords{records: []files.Deletion{deletion("in-flight", now.Add(-time.Minute))}}
	accounts := &fakeAccounts{back: map[string]bool{"in-flight": true}, asked: map[string]time.Time{}}

	report, err := Run(context.Background(), now, records, accounts, fakePoints{})

	if err != nil || len(accounts.asked) != 0 || report.Reapplied != 0 {
		t.Errorf("asked %v, report %+v, %v", accounts.asked, report, err)
	}
}
