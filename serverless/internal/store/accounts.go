package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// AccountsAPI is the DynamoDB calls deleting an account makes: the item calls, and the batches
// its items are deleted in.
type AccountsAPI interface {
	ItemAPI
	BatchWriteItem(ctx context.Context, in *dynamodb.BatchWriteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
}

// Accounts deletes a user's account (#553): every item of their partition, and the sessions it
// links to. A transaction holds at most 100 items and a user's tasks have no limit, so the account
// is first marked deleted on its META item, then deleted batch by batch, META last. A deletion
// that stops half-way stays marked, and is finished by the account's next request (Settle) or by
// the replay (Gunnar's decision on #553).
type Accounts struct {
	client AccountsAPI
	table  string
	now    func() time.Time
}

// NewAccounts returns the accounts in the named table.
func NewAccounts(client AccountsAPI, table string) *Accounts {
	return &Accounts{client: client, table: table, now: time.Now}
}

// deletedAt is the META attribute that marks an account as being deleted, in Unix seconds.
const deletedAt = "deletedAt"

// sessionLinkPrefix starts the sort key of the item in the user's partition that links them to
// one of their sessions, SESSION#<key>, so that deleting the account ends it.
const sessionLinkPrefix = "SESSION#"

// Most items one BatchWriteItem takes, and how often one with items left unprocessed is retried.
const (
	batchSize     = 25
	batchAttempts = 8
	// sweeps bounds how often the partition is read again for items a racing request wrote
	// while it was being deleted; normally the second read finds none.
	sweeps = 4
)

// Mark marks the user's account as being deleted. From here on the deletion counts as done:
// whatever stops it is finished later. Marking again keeps the first time.
func (a *Accounts) Mark(ctx context.Context, email string) error {
	_, err := a.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(a.table), Key: metaKey(email),
		UpdateExpression:          aws.String("SET #deleted = if_not_exists(#deleted, :now)"),
		ExpressionAttributeNames:  map[string]string{"#deleted": deletedAt},
		ExpressionAttributeValues: map[string]types.AttributeValue{":now": number(a.now().Unix())},
	})
	if err != nil {
		return fmt.Errorf("mark the account deleted: %w", err)
	}
	return nil
}

// Settle finishes the deletion of the user's account if one was left half-way, so that a request
// never sees what is left of it. One strongly consistent read of META when there is none.
func (a *Accounts) Settle(ctx context.Context, email string) error {
	out, err := a.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(a.table), Key: metaKey(email), ConsistentRead: aws.Bool(true),
		ProjectionExpression: aws.String("#deleted"), ExpressionAttributeNames: map[string]string{"#deleted": deletedAt},
	})
	if err != nil {
		return fmt.Errorf("read the account: %w", err)
	}
	if _, marked := out.Item[deletedAt]; !marked {
		return nil
	}
	slog.WarnContext(ctx, "finishing an account deletion that stopped half-way")
	return a.Finish(ctx, email)
}

// Finish deletes every item of a marked account, ends its sessions and deletes META last. The
// partition is read again until nothing is left, for items a request racing the deletion wrote.
// The stream deletes the attachments' files as their items go (cmd/streams).
func (a *Accounts) Finish(ctx context.Context, email string) error {
	tasks, attachments := 0, 0
	for range sweeps {
		keys, err := a.held(ctx, email)
		if err != nil {
			return err
		}
		if len(keys) == 0 {
			if err := a.deleteMeta(ctx, email); err != nil {
				return err
			}
			slog.InfoContext(ctx, "deleted an account", "event", "account-deleted",
				"tasks", tasks, "attachments", attachments)
			return nil
		}
		for _, key := range keys {
			sk := key["SK"].(*types.AttributeValueMemberS).Value
			tasks += boolInt(strings.HasPrefix(sk, "TASK#"))
			attachments += boolInt(strings.HasPrefix(sk, attachmentPrefix))
		}
		if err := a.deleteAll(ctx, keys); err != nil {
			return err
		}
	}
	return errors.New("delete the account: requests kept writing to it")
}

// held is the keys of everything the account holds but META, and of the sessions it links to.
func (a *Accounts) held(ctx context.Context, email string) ([]map[string]types.AttributeValue, error) {
	in := &dynamodb.QueryInput{
		TableName: aws.String(a.table), ConsistentRead: aws.Bool(true),
		KeyConditionExpression:    aws.String("PK = :pk"),
		ProjectionExpression:      aws.String("PK, SK"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: OwnerKey(email)}},
	}
	var keys []map[string]types.AttributeValue
	for {
		out, err := a.client.Query(ctx, in)
		if err != nil {
			return nil, fmt.Errorf("read the account: %w", err)
		}
		for _, item := range out.Items {
			sk, _ := item["SK"].(*types.AttributeValueMemberS)
			if sk == nil || sk.Value == "META" {
				continue
			}
			keys = append(keys, item)
			if session, ok := strings.CutPrefix(sk.Value, sessionLinkPrefix); ok {
				keys = append(keys, sessionKey(session))
			}
		}
		if len(out.LastEvaluatedKey) == 0 {
			return keys, nil
		}
		in.ExclusiveStartKey = out.LastEvaluatedKey
	}
}

// deleteAll deletes the items with these keys, a batch at a time, retrying what DynamoDB leaves
// unprocessed.
func (a *Accounts) deleteAll(ctx context.Context, keys []map[string]types.AttributeValue) error {
	for start := 0; start < len(keys); start += batchSize {
		var requests []types.WriteRequest
		for _, key := range keys[start:min(start+batchSize, len(keys))] {
			requests = append(requests, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: key}})
		}
		pending := map[string][]types.WriteRequest{a.table: requests}
		for attempt := 0; len(pending[a.table]) > 0; attempt++ {
			if attempt == batchAttempts {
				return errors.New("delete the account: DynamoDB kept items unprocessed")
			}
			if attempt > 0 {
				if err := pause(ctx); err != nil {
					return err
				}
			}
			out, err := a.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: pending})
			if err != nil {
				return fmt.Errorf("delete the account's items: %w", err)
			}
			pending = out.UnprocessedItems
		}
	}
	return nil
}

// deleteMeta deletes the META item, last, while it is still marked: one that is not was written
// by an account begun anew since, and stays.
func (a *Accounts) deleteMeta(ctx context.Context, email string) error {
	_, err := a.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(a.table), Key: metaKey(email),
		ConditionExpression:      aws.String("attribute_exists(#deleted)"),
		ExpressionAttributeNames: map[string]string{"#deleted": deletedAt},
	})
	if err != nil && !notThere(err) {
		return fmt.Errorf("delete the account: %w", err)
	}
	return nil
}

// boolInt is 1 for true, for counting.
func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
