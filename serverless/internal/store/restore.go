package store

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// RestoreAPI is the DynamoDB calls that say how far back the table could be restored.
type RestoreAPI interface {
	DescribeContinuousBackups(ctx context.Context, in *dynamodb.DescribeContinuousBackupsInput, opts ...func(*dynamodb.Options)) (*dynamodb.DescribeContinuousBackupsOutput, error)
	ListBackups(ctx context.Context, in *dynamodb.ListBackupsInput, opts ...func(*dynamodb.Options)) (*dynamodb.ListBackupsOutput, error)
	ListTables(ctx context.Context, in *dynamodb.ListTablesInput, opts ...func(*dynamodb.Options)) (*dynamodb.ListTablesOutput, error)
}

// RestorePoints is how far back the table could be restored, which is how long a deletion record
// must be kept (#213, #553): DynamoDB's counterpart of the Quarkus backend's RdsRestorePoints.
type RestorePoints struct {
	client RestoreAPI
	table  string
}

// NewRestorePoints returns the restore points of the named table.
func NewRestorePoints(client RestoreAPI, table string) *RestorePoints {
	return &RestorePoints{client: client, table: table}
}

// Oldest is the oldest point the table could be restored to: the start of the point-in-time
// recovery window of any table in the region, or the oldest backup there, whichever is oldest.
// Every table and backup counts, not only this table's: a restore goes into a new table, and the
// one it came from, with its window and backups, stays restorable until it is deleted. A record
// kept too long costs nothing; one pruned too early lets a restore bring an account back for
// good. known is false when there is no window and no backup, and then nothing is pruned.
func (p *RestorePoints) Oldest(ctx context.Context) (oldest time.Time, known bool, err error) {
	consider := func(at *time.Time) {
		if at != nil && (!known || at.Before(oldest)) {
			oldest, known = *at, true
		}
	}
	tables, err := p.tables(ctx)
	if err != nil {
		return time.Time{}, false, err
	}
	for _, table := range tables {
		continuous, err := p.client.DescribeContinuousBackups(ctx, &dynamodb.DescribeContinuousBackupsInput{
			TableName: aws.String(table)})
		if err != nil {
			return time.Time{}, false, fmt.Errorf("read %s's point-in-time recovery: %w", table, err)
		}
		if d := continuous.ContinuousBackupsDescription; d != nil && d.PointInTimeRecoveryDescription != nil &&
			d.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus == types.PointInTimeRecoveryStatusEnabled {
			consider(d.PointInTimeRecoveryDescription.EarliestRestorableDateTime)
		}
	}
	in := &dynamodb.ListBackupsInput{BackupType: types.BackupTypeFilterAll}
	for {
		out, err := p.client.ListBackups(ctx, in)
		if err != nil {
			return time.Time{}, false, fmt.Errorf("list the backups: %w", err)
		}
		for _, b := range out.BackupSummaries {
			consider(b.BackupCreationDateTime)
		}
		if out.LastEvaluatedBackupArn == nil {
			return oldest, known, nil
		}
		in.ExclusiveStartBackupArn = out.LastEvaluatedBackupArn
	}
}

// tables is every table in the region, the configured one included even where the listing is
// eventually consistent and does not have it yet.
func (p *RestorePoints) tables(ctx context.Context) ([]string, error) {
	tables := []string{p.table}
	in := &dynamodb.ListTablesInput{}
	for {
		out, err := p.client.ListTables(ctx, in)
		if err != nil {
			return nil, fmt.Errorf("list the tables: %w", err)
		}
		for _, name := range out.TableNames {
			if name != p.table {
				tables = append(tables, name)
			}
		}
		if out.LastEvaluatedTableName == nil {
			return tables, nil
		}
		in.ExclusiveStartTableName = out.LastEvaluatedTableName
	}
}
