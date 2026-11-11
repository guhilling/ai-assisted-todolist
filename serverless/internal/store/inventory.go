package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// InventoryAPI is the DynamoDB calls the orphan clean-up's reads make.
type InventoryAPI interface {
	Scan(ctx context.Context, in *dynamodb.ScanInput, opts ...func(*dynamodb.Options)) (*dynamodb.ScanOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// Inventory is every user's attachment items, as the orphan clean-up (internal/orphans) reads
// them: the one read across partitions, a Scan, which at a demo's size is a page or two an hour.
type Inventory struct {
	client InventoryAPI
	table  string
}

// NewInventory returns the inventory of the named table.
func NewInventory(client InventoryAPI, table string) *Inventory {
	return &Inventory{client: client, table: table}
}

// FileRow is what the clean-up needs to know of one attachment item.
type FileRow struct {
	Owner     string // the partition key, USER#<hash>
	ID        int64
	ObjectKey string // empty for a link
	Available bool
}

// FileRows reads every attachment item of every user, expired ones too: an expired item's files
// are the stream's to delete once TTL deletes it, never the clean-up's.
func (inv *Inventory) FileRows(ctx context.Context) ([]FileRow, error) {
	in := &dynamodb.ScanInput{
		TableName:                 aws.String(inv.table),
		FilterExpression:          aws.String("begins_with(SK, :att)"),
		ProjectionExpression:      aws.String("PK, SK, objectKey, available"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":att": &types.AttributeValueMemberS{Value: attachmentPrefix}},
		ConsistentRead:            aws.Bool(true),
	}
	var rows []FileRow
	for {
		out, err := inv.client.Scan(ctx, in)
		if err != nil {
			return nil, fmt.Errorf("scan attachments: %w", err)
		}
		var page []struct {
			PK, SK    string
			ObjectKey string `dynamodbav:"objectKey"`
			Available bool   `dynamodbav:"available"`
		}
		if err := attributevalue.UnmarshalListOfMaps(out.Items, &page); err != nil {
			return nil, fmt.Errorf("read attachments: %w", err)
		}
		for _, it := range page {
			id, err := strconv.ParseInt(strings.TrimPrefix(it.SK, attachmentPrefix), 10, 64)
			if err != nil {
				return nil, fmt.Errorf("read attachment %s: %w", it.SK, err)
			}
			rows = append(rows, FileRow{Owner: it.PK, ID: id, ObjectKey: it.ObjectKey, Available: it.Available})
		}
		if len(out.LastEvaluatedKey) == 0 {
			return rows, nil
		}
		in.ExclusiveStartKey = out.LastEvaluatedKey
	}
}

// StillAvailable says whether the attachment is still there, available and not past its expiry.
func (inv *Inventory) StillAvailable(ctx context.Context, r FileRow, now time.Time) (bool, error) {
	out, err := inv.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(inv.table), ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: r.Owner},
			"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("ATT#%08d", r.ID)},
		},
	})
	if err != nil {
		return false, fmt.Errorf("find attachment %s/%d: %w", r.Owner, r.ID, err)
	}
	if len(out.Item) == 0 {
		return false, nil
	}
	var it attachmentItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return false, fmt.Errorf("read attachment %s/%d: %w", r.Owner, r.ID, err)
	}
	return it.Available && it.live(now), nil
}
