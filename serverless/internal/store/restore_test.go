package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// backupsAnswer answers the two calls the restore points make: the table's point-in-time
// recovery, and the region's backups, a page per element of pages.
type backupsAnswer struct {
	recovery *types.PointInTimeRecoveryDescription
	// others is the recovery of the region's other tables, by name.
	others map[string]*types.PointInTimeRecoveryDescription
	pages  [][]time.Time
	err    error
}

func (b *backupsAnswer) DescribeContinuousBackups(_ context.Context, in *dynamodb.DescribeContinuousBackupsInput, _ ...func(*dynamodb.Options)) (*dynamodb.DescribeContinuousBackupsOutput, error) {
	if b.err != nil {
		return nil, b.err
	}
	recovery := b.recovery
	if other, ok := b.others[aws.ToString(in.TableName)]; ok {
		recovery = other
	}
	return &dynamodb.DescribeContinuousBackupsOutput{ContinuousBackupsDescription: &types.ContinuousBackupsDescription{
		ContinuousBackupsStatus: types.ContinuousBackupsStatusEnabled, PointInTimeRecoveryDescription: recovery}}, nil
}

func (b *backupsAnswer) ListTables(context.Context, *dynamodb.ListTablesInput, ...func(*dynamodb.Options)) (*dynamodb.ListTablesOutput, error) {
	if b.err != nil {
		return nil, b.err
	}
	names := []string{"taskfest-test"}
	for name := range b.others {
		names = append(names, name)
	}
	return &dynamodb.ListTablesOutput{TableNames: names}, nil
}

func (b *backupsAnswer) ListBackups(_ context.Context, in *dynamodb.ListBackupsInput, _ ...func(*dynamodb.Options)) (*dynamodb.ListBackupsOutput, error) {
	page := 0
	if in.ExclusiveStartBackupArn != nil {
		page = 1
	}
	out := &dynamodb.ListBackupsOutput{}
	if page < len(b.pages) {
		for _, at := range b.pages[page] {
			out.BackupSummaries = append(out.BackupSummaries, types.BackupSummary{
				BackupArn: aws.String("arn"), BackupCreationDateTime: aws.Time(at)})
		}
	}
	if page+1 < len(b.pages) {
		out.LastEvaluatedBackupArn = aws.String("next")
	}
	return out, nil
}

var restoreDay = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)

func recoveringSince(at time.Time) *types.PointInTimeRecoveryDescription {
	return &types.PointInTimeRecoveryDescription{PointInTimeRecoveryStatus: types.PointInTimeRecoveryStatusEnabled,
		EarliestRestorableDateTime: aws.Time(at)}
}

func TestTheOldestRestorePointIsTheEarliestOfRecoveryAndEveryBackup(t *testing.T) {
	points := NewRestorePoints(&backupsAnswer{recovery: recoveringSince(restoreDay),
		pages: [][]time.Time{{restoreDay.Add(time.Hour)}, {restoreDay.Add(-48 * time.Hour)}}}, "taskfest-test")

	oldest, known, err := points.Oldest(context.Background())

	if err != nil || !known || !oldest.Equal(restoreDay.Add(-48*time.Hour)) {
		t.Errorf("got %v, %v, %v", oldest, known, err)
	}
}

func TestRecoveryAloneGivesTheOldestPoint(t *testing.T) {
	points := NewRestorePoints(&backupsAnswer{recovery: recoveringSince(restoreDay)}, "taskfest-test")

	oldest, known, err := points.Oldest(context.Background())

	if err != nil || !known || !oldest.Equal(restoreDay) {
		t.Errorf("got %v, %v, %v", oldest, known, err)
	}
}

func TestWithoutRecoveryOrBackupsTheOldestPointIsUnknown(t *testing.T) {
	off := &types.PointInTimeRecoveryDescription{PointInTimeRecoveryStatus: types.PointInTimeRecoveryStatusDisabled}
	points := NewRestorePoints(&backupsAnswer{recovery: off}, "taskfest-test")

	if _, known, err := points.Oldest(context.Background()); known || err != nil {
		t.Errorf("known %v, %v", known, err)
	}
}

func TestARefusedListingIsAnError(t *testing.T) {
	points := NewRestorePoints(&backupsAnswer{err: errors.New("access denied")}, "taskfest-test")

	if _, known, err := points.Oldest(context.Background()); known || err == nil {
		t.Errorf("known %v, %v", known, err)
	}
}

func TestAnOldTablesRecoveryWindowCountsAfterARestore(t *testing.T) {
	// The functions use the restored table; the one it was restored from can still be restored
	// to any point of its own window, until it is deleted.
	points := NewRestorePoints(&backupsAnswer{recovery: recoveringSince(restoreDay),
		others: map[string]*types.PointInTimeRecoveryDescription{
			"taskfest-test-before": recoveringSince(restoreDay.Add(-30 * 24 * time.Hour))}}, "taskfest-test")

	oldest, known, err := points.Oldest(context.Background())

	if err != nil || !known || !oldest.Equal(restoreDay.Add(-30*24*time.Hour)) {
		t.Errorf("got %v, %v, %v", oldest, known, err)
	}
}
