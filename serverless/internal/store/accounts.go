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
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
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

// accountCreatedAt is the META attribute that says when the account began, in Unix seconds,
// written with the first id it counts: what tells an account restored from before a deletion
// from one begun since (#553).
const accountCreatedAt = "createdAt"

// linkCreated is the session link's attribute that says when the session began, in Unix seconds.
const linkCreated = "created"

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

// ownerOf is a partition key from an email's hash: what a deletion record names.
func ownerOf(hash string) string { return "USER#" + hash }

// metaOfOwner is the key of the META item in the partition owner.
func metaOfOwner(owner string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: owner},
		"SK": &types.AttributeValueMemberS{Value: "META"},
	}
}

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
	m, err := a.meta(ctx, OwnerKey(email))
	if err != nil || !m.marked {
		return false, err
	}
	slog.WarnContext(ctx, "finishing an account deletion that stopped half-way")
	return true, a.finish(ctx, OwnerKey(email), m.deletedAt)
}

// Reapply deletes again the account a deletion record names by its email's hash, as the replay
// does after a restore, and says whether there was anything to delete. Only an account created
// before the deletion is deleted, decided by the write that marks it, so an account begun anew
// since is never taken for the restored one; one without its creation time counts as older.
// Without META, what is left of a deletion that stopped after META went is deleted: no task,
// draft or attachment is ever written without META. A session signed in since the deletion
// stays, with its link.
func (a *Accounts) Reapply(ctx context.Context, hash string, at time.Time) (bool, error) {
	owner := ownerOf(hash)
	_, err := a.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(a.table), Key: metaOfOwner(owner),
		UpdateExpression: aws.String("SET #deleted = if_not_exists(#deleted, :at)"),
		ConditionExpression: aws.String(
			"attribute_exists(PK) AND (attribute_not_exists(#created) OR #created < :at)"),
		ExpressionAttributeNames:  map[string]string{"#deleted": deletedAt, "#created": accountCreatedAt},
		ExpressionAttributeValues: map[string]types.AttributeValue{":at": number(at.Unix())},
	})
	if err == nil {
		slog.WarnContext(ctx, "a deleted account is back, likely from a restore; deleting it again")
		return true, a.finish(ctx, owner, at.Unix())
	}
	if !notThere(err) {
		return false, fmt.Errorf("mark the account deleted again: %w", err)
	}
	m, err := a.meta(ctx, owner)
	if err != nil || m.exists {
		return false, err
	}
	var took tally
	n, err := a.sweep(ctx, owner, at.Unix(), &took)
	if n > 0 && err == nil {
		slog.WarnContext(ctx, "deleted what a deletion left", "items", n)
	}
	return n > 0, err
}

// metaState is what the account's META item says of its deletion.
type metaState struct {
	exists, marked bool
	// deletedAt is when it was marked, in Unix seconds.
	deletedAt int64
}

// meta reads the account's META item, strongly consistent.
func (a *Accounts) meta(ctx context.Context, owner string) (metaState, error) {
	out, err := a.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(a.table), Key: metaOfOwner(owner), ConsistentRead: aws.Bool(true),
		ProjectionExpression: aws.String("PK, #deleted"), ExpressionAttributeNames: map[string]string{"#deleted": deletedAt},
	})
	if err != nil {
		return metaState{}, fmt.Errorf("read the account: %w", err)
	}
	m := metaState{exists: len(out.Item) > 0}
	if v, ok := out.Item[deletedAt]; ok {
		m.marked = true
		if err := attributevalue.Unmarshal(v, &m.deletedAt); err != nil {
			return metaState{}, fmt.Errorf("read the account's deletion: %w", err)
		}
	}
	return m, nil
}

// tally counts what a deletion took, for its log line.
type tally struct{ tasks, attachments int }

// Finish deletes every item of a marked account, ends its sessions and deletes META last.
func (a *Accounts) Finish(ctx context.Context, email string) error {
	m, err := a.meta(ctx, OwnerKey(email))
	if err != nil {
		return err
	}
	if !m.marked {
		m.deletedAt = a.now().Unix()
	}
	return a.finish(ctx, OwnerKey(email), m.deletedAt)
}

// finish deletes every item of the marked account under owner, but sessions signed in after
// the deletion, at Unix seconds, which a user who signed in again keeps, and deletes META last.
// The partition is read again until a read finds nothing, for items a request racing the
// deletion wrote. The stream deletes the attachments' files as their items go (cmd/streams).
func (a *Accounts) finish(ctx context.Context, owner string, at int64) error {
	var took tally
	for sweep := 0; ; sweep++ {
		n, err := a.sweep(ctx, owner, at, &took)
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
	if err := a.deleteMeta(ctx, owner); err != nil {
		return err
	}
	// A write that passed its check before the mark can land between the last read and META's
	// delete, and with META gone nothing would settle it: one more read takes it, unless an
	// account begun anew has its own META by then. Should this fail, the replay takes what is
	// left, from the deletion's record.
	m, err := a.meta(ctx, owner)
	if err != nil {
		return err
	}
	if !m.exists {
		if _, err := a.sweep(ctx, owner, at, &took); err != nil {
			return err
		}
	}
	slog.InfoContext(ctx, "deleted an account", "event", "account-deleted",
		"tasks", took.tasks, "attachments", took.attachments)
	return nil
}

// sweep deletes everything the account under owner holds but META, and the sessions it links
// to but those signed in after at, a page of the partition at a time, and returns how many
// items of the partition it deleted.
func (a *Accounts) sweep(ctx context.Context, owner string, at int64, took *tally) (int, error) {
	in := &dynamodb.QueryInput{
		TableName: aws.String(a.table), ConsistentRead: aws.Bool(true),
		KeyConditionExpression:    aws.String("PK = :pk"),
		ProjectionExpression:      aws.String("PK, SK, #created"),
		ExpressionAttributeNames:  map[string]string{"#created": linkCreated},
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: owner}},
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
			session, isLink := strings.CutPrefix(sk.Value, sessionLinkPrefix)
			if isLink && signedInAfter(item, at) {
				continue
			}
			keys = append(keys, map[string]types.AttributeValue{"PK": item["PK"], "SK": sk})
			deleted++
			took.tasks += boolInt(strings.HasPrefix(sk.Value, "TASK#"))
			took.attachments += boolInt(strings.HasPrefix(sk.Value, attachmentPrefix))
			if isLink {
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

// signedInAfter says whether a session link was written after at, in Unix seconds; one that
// does not say when counts as before.
func signedInAfter(link map[string]types.AttributeValue, at int64) bool {
	var created int64
	v, ok := link[linkCreated]
	return ok && attributevalue.Unmarshal(v, &created) == nil && created > at
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

// deleteMeta deletes the META item under owner, last, while it is still marked: one that is not
// was written by an account begun anew since, and stays.
func (a *Accounts) deleteMeta(ctx context.Context, owner string) error {
	_, err := a.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(a.table), Key: metaOfOwner(owner),
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
