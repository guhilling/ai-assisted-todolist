package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
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
// never sees what is left of it, and says whether there was one. One strongly consistent read of
// META when there is none.
func (a *Accounts) Settle(ctx context.Context, email string) (bool, error) {
	marked, err := a.marked(ctx, email)
	if err != nil || !marked {
		return false, err
	}
	slog.WarnContext(ctx, "finishing an account deletion that stopped half-way")
	return true, a.Finish(ctx, email)
}

// marked says whether the user's META item exists, and with it whether it is marked deleted.
func (a *Accounts) marked(ctx context.Context, email string) (bool, error) {
	exists, marked, err := a.meta(ctx, email)
	return exists && marked, err
}

// meta reads whether the user's META item exists and whether it is marked deleted.
func (a *Accounts) meta(ctx context.Context, email string) (exists, marked bool, err error) {
	out, err := a.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(a.table), Key: metaKey(email), ConsistentRead: aws.Bool(true),
		ProjectionExpression: aws.String("PK, #deleted"), ExpressionAttributeNames: map[string]string{"#deleted": deletedAt},
	})
	if err != nil {
		return false, false, fmt.Errorf("read the account: %w", err)
	}
	_, marked = out.Item[deletedAt]
	return len(out.Item) > 0, marked, nil
}

// tally counts what a deletion took, for its log line.
type tally struct{ tasks, attachments int }

// Finish deletes every item of a marked account, ends its sessions and deletes META last. The
// partition is read again until a read finds nothing, for items a request racing the deletion
// wrote. The stream deletes the attachments' files as their items go (cmd/streams).
func (a *Accounts) Finish(ctx context.Context, email string) error {
	var took tally
	for sweep := 0; ; sweep++ {
		n, err := a.sweep(ctx, email, &took)
		if err != nil {
			return err
		}
		if n == 0 {
			break
		}
		if sweep == sweeps {
			return errors.New("delete the account: requests kept writing to it")
		}
	}
	if err := a.deleteMeta(ctx, email); err != nil {
		return err
	}
	// A write that passed its check before the mark can land between the last read and META's
	// delete, and with META gone nothing would settle it: one more read takes it, unless an
	// account begun anew has its own META by then.
	exists, _, err := a.meta(ctx, email)
	if err != nil {
		return err
	}
	if !exists {
		if _, err := a.sweep(ctx, email, &took); err != nil {
			return err
		}
	}
	slog.InfoContext(ctx, "deleted an account", "event", "account-deleted",
		"tasks", took.tasks, "attachments", took.attachments)
	return nil
}

// sweep deletes everything the account holds but META, and the sessions it links to, a page of
// the partition at a time, and returns how many items of the partition it deleted.
func (a *Accounts) sweep(ctx context.Context, email string, took *tally) (int, error) {
	in := &dynamodb.QueryInput{
		TableName: aws.String(a.table), ConsistentRead: aws.Bool(true),
		KeyConditionExpression:    aws.String("PK = :pk"),
		ProjectionExpression:      aws.String("PK, SK"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: OwnerKey(email)}},
	}
	deleted := 0
	for {
		out, err := a.client.Query(ctx, in)
		if err != nil {
			return 0, fmt.Errorf("read the account: %w", err)
		}
		var keys []map[string]types.AttributeValue
		for _, item := range out.Items {
			sk, _ := item["SK"].(*types.AttributeValueMemberS)
			if sk == nil || sk.Value == "META" {
				continue
			}
			keys = append(keys, item)
			deleted++
			took.tasks += boolInt(strings.HasPrefix(sk.Value, "TASK#"))
			took.attachments += boolInt(strings.HasPrefix(sk.Value, attachmentPrefix))
			if session, ok := strings.CutPrefix(sk.Value, sessionLinkPrefix); ok {
				keys = append(keys, sessionKey(session))
			}
		}
		if err := a.deleteAll(ctx, keys); err != nil {
			return 0, err
		}
		if len(out.LastEvaluatedKey) == 0 {
			return deleted, nil
		}
		in.ExclusiveStartKey = out.LastEvaluatedKey
	}
}

// deleteAll deletes the items with these keys, a batch at a time, retrying what DynamoDB leaves
// unprocessed with a growing pause, as AWS advises for a throttled table.
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
			if err := backOff(ctx, attempt); err != nil {
				return err
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

// backOff waits before the attempt: not before the first, then 50 ms doubling up to two seconds,
// with jitter, about five seconds over every attempt.
func backOff(ctx context.Context, attempt int) error {
	if attempt == 0 {
		return nil
	}
	wait := min(50*time.Millisecond<<(attempt-1), 2*time.Second)
	wait = wait/2 + time.Duration(rand.Int64N(int64(wait/2)))
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(wait):
		return nil
	}
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
