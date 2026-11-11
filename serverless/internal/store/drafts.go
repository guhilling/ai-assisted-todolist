package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// A draft is a DRAFT#<id> item in the user's partition, with an expiresAt that is the table's
// TTL attribute: the Quarkus backend's draft sweep becomes DynamoDB deleting it. TTL takes up to
// about two days, so a draft past its expiry is gone to every read and write here, not only once
// deleted.
//
// The limit (board.MaxOpenDrafts) is kept on the user's META item: an openDraft#<id> attribute
// per open draft, holding its expiry, and a draftsVersion that every change to them counts up.
// Starting a draft writes both in one transaction, on the condition that the version is still the
// one its count was read with, so two drafts started at once cannot both take the last place. A
// draft that expires stops counting by its expiry, so nothing has to count it down when TTL
// deletes it. Top-level attributes rather than one map, since removing an attribute that is not
// there is nothing, while removing a key from a map that is not there is an invalid path.
//
// A transaction the SDK sends again after a timeout carries the same ClientRequestToken, which
// the SDK fills in before it retries, so DynamoDB answers it as the success it already was rather
// than failing its conditions on its own writes.
const (
	openDraftPrefix = "openDraft#"
	draftsVersion   = "draftsVersion"
	// draftAttempts bounds how often a draft write is tried again after losing a race.
	draftAttempts = 16
)

// draftItem is a draft as stored: no description or due date until it is added.
type draftItem struct {
	ID        int64 `dynamodbav:"id"`
	ExpiresAt int64 `dynamodbav:"expiresAt"`
}

// draftKey is the key of the user's draft with this id.
func draftKey(email string, id int64) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: OwnerKey(email)},
		"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("DRAFT#%08d", id)},
	}
}

// openDraft is the META attribute that holds the open draft's expiry.
func openDraft(id int64) string { return openDraftPrefix + strconv.FormatInt(id, 10) }

// openDrafts is what the user's META item says of their drafts: each open one's attribute with
// its expiry, and the version they were read at, nil before the first.
type openDrafts struct {
	expiries map[string]int64
	version  *int64
}

// StartDraft starts a draft for the user and returns its id, the next on their count; started is
// false, and nothing written, when they have board.MaxOpenDrafts open already.
func (w *Writes) StartDraft(ctx context.Context, email string, now time.Time) (id int64, started bool, err error) {
	for range draftAttempts {
		open, err := w.openDraftsOf(ctx, email)
		if err != nil {
			return 0, false, err
		}
		var expired []string
		for name, expires := range open.expiries {
			if expires <= now.Unix() {
				expired = append(expired, name)
			}
		}
		if len(open.expiries)-len(expired) >= board.MaxOpenDrafts {
			return 0, false, nil
		}
		// Counted once, after the limit is known to leave room: a retry keeps the id.
		if id == 0 {
			if id, err = w.nextID(ctx, email); err != nil {
				return 0, false, err
			}
		}
		expires := now.Add(board.DraftLifetime).Unix()
		reasons, err := w.transact(ctx, w.recount(email, open.version, id, expires, expired),
			w.putDraft(email, id, expires), w.noTask(email, id))
		switch {
		case err != nil:
			return 0, false, err
		case reasons == nil:
			return id, true, nil
		case failed(reasons, 1) || failed(reasons, 2):
			// Taken by an item written around the count: the next id, as a create steps over one.
			slog.WarnContext(ctx, "a draft id was taken without being counted", "draft", id)
			id = 0
		}
		// Otherwise another write changed the drafts meanwhile: count again.
		if err := pause(ctx); err != nil {
			return 0, false, err
		}
	}
	return 0, false, errors.New("start a draft: lost every race for the count")
}

// AddDraft makes the user's draft t.ID the task t, with the draft's id and its attachments, which
// then last as a task's do. Adding it again, as a retry whose answer was lost does (#427), sets t's
// values on the task it became, its due time and zone too, which a create always sends. found is
// false when the user has neither a draft nor a task with this id, and nothing is written.
func (w *Writes) AddDraft(ctx context.Context, email string, t board.Task, now time.Time) (board.Task, bool, error) {
	put, err := w.newTask(email, t)
	if err != nil {
		return board.Task{}, false, err
	}
	for range draftAttempts {
		state, err := w.readAttachments(ctx, email, nil)
		if err != nil {
			return board.Task{}, false, err
		}
		items := []types.TransactWriteItem{w.takeDraft(email, t.ID, now), {Put: put},
			w.forget(email, t.ID, state.version)}
		for _, it := range state.items {
			if it.live(now) && it.on(t.ID) {
				items = append(items, w.reexpire(email, it, 0, now, nil, map[string]types.AttributeValue{}, nil))
			}
		}
		reasons, err := w.transact(ctx, items...)
		switch {
		case err != nil:
			return board.Task{}, false, err
		case reasons == nil:
			return t, true, nil
		case failed(reasons, 0):
			// No open draft: a task with this id, if the user has one, takes the values.
			return w.Replace(ctx, email, t, false)
		case failed(reasons, 1):
			// A draft and a task with one id: a start steps over a task's id, so only an item
			// written around the count can be one. Neither is touched.
			return board.Task{}, false, fmt.Errorf("add draft %d: a task has its id", t.ID)
		}
		if err := pause(ctx); err != nil {
			return board.Task{}, false, err
		}
	}
	return board.Task{}, false, errors.New("add a draft: lost every race for the count")
}

// DiscardDraft deletes the user's open draft with this id and its attachments' items; found is
// false when they have none, for a task with this id too, which stays. The attachments' files go
// as those of every deleted attachment item do: through the table's stream.
func (w *Writes) DiscardDraft(ctx context.Context, email string, id int64, now time.Time) (bool, error) {
	for range draftAttempts {
		state, err := w.readAttachments(ctx, email, nil)
		if err != nil {
			return false, err
		}
		items := []types.TransactWriteItem{w.takeDraft(email, id, now), w.forget(email, id, state.version)}
		for _, it := range state.items {
			if it.on(id) {
				items = append(items, types.TransactWriteItem{Delete: &types.Delete{
					TableName: aws.String(w.table), Key: attachmentKey(email, it.ID)}})
			}
		}
		reasons, err := w.transact(ctx, items...)
		switch {
		case err != nil:
			return false, err
		case reasons == nil:
			return true, nil
		case failed(reasons, 0):
			return false, nil
		}
		if err := pause(ctx); err != nil {
			return false, err
		}
	}
	return false, errors.New("discard a draft: lost every race for the count")
}

// openDraftsOf reads what the user's META item says of their drafts, strongly consistent.
func (w *Writes) openDraftsOf(ctx context.Context, email string) (openDrafts, error) {
	out, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: metaKey(email), ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return openDrafts{}, fmt.Errorf("count the drafts: %w", err)
	}
	open := openDrafts{expiries: map[string]int64{}}
	for name, value := range out.Item {
		if !strings.HasPrefix(name, openDraftPrefix) && name != draftsVersion {
			continue
		}
		var n int64
		if err := attributevalue.Unmarshal(value, &n); err != nil {
			return openDrafts{}, fmt.Errorf("count the drafts: %s: %w", name, err)
		}
		if name == draftsVersion {
			open.version = &n
		} else {
			open.expiries[name] = n
		}
	}
	return open, nil
}

// recount adds the new draft to the user's open drafts and takes the expired ones off, on the
// condition that they are still at version.
func (w *Writes) recount(email string, version *int64, id, expires int64, expired []string) types.TransactWriteItem {
	names := map[string]string{"#new": openDraft(id), "#version": draftsVersion}
	condition, next := "attribute_not_exists(#version)", int64(1)
	values := map[string]types.AttributeValue{":expires": number(expires)}
	if version != nil {
		condition, next = "#version = :version", *version+1
		values[":version"] = number(*version)
	}
	values[":next"] = number(next)
	expr := "SET #new = :expires, #version = :next"
	if len(expired) > 0 {
		var gone []string
		for i, name := range expired {
			placeholder := "#gone" + strconv.Itoa(i)
			names[placeholder] = name
			gone = append(gone, placeholder)
		}
		expr += " REMOVE " + strings.Join(gone, ", ")
	}
	return types.TransactWriteItem{Update: &types.Update{
		TableName: aws.String(w.table), Key: metaKey(email),
		UpdateExpression: aws.String(expr), ConditionExpression: aws.String(condition),
		ExpressionAttributeNames: names, ExpressionAttributeValues: values,
	}}
}

// putDraft writes a new draft, on the condition that no draft has its id.
func (w *Writes) putDraft(email string, id, expires int64) types.TransactWriteItem {
	item, _ := attributevalue.MarshalMap(draftItem{ID: id, ExpiresAt: expires}) // two numbers always marshal
	for k, v := range draftKey(email, id) {
		item[k] = v
	}
	return types.TransactWriteItem{Put: &types.Put{
		TableName: aws.String(w.table), Item: item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	}}
}

// noTask is the condition that no task has this id either, as a create steps over one written
// around the count: the draft would become a second item with the task's id when it is added.
func (w *Writes) noTask(email string, id int64) types.TransactWriteItem {
	return types.TransactWriteItem{ConditionCheck: &types.ConditionCheck{
		TableName: aws.String(w.table), Key: taskKey(email, id),
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	}}
}

// takeDraft deletes the user's draft, on the condition that it is there and open at now.
func (w *Writes) takeDraft(email string, id int64, now time.Time) types.TransactWriteItem {
	return types.TransactWriteItem{Delete: &types.Delete{
		TableName: aws.String(w.table), Key: draftKey(email, id),
		ConditionExpression:       aws.String("attribute_exists(PK) AND expiresAt > :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":now": number(now.Unix())},
	}}
}

// forget takes a draft off the user's open drafts and counts their version up, so that a start
// that read them before cannot write back what it read; and counts the attachments' version up, on
// the condition that it is still version, since the draft's attachments change with it.
func (w *Writes) forget(email string, id int64, version *int64) types.TransactWriteItem {
	return types.TransactWriteItem{Update: w.bumpUpdate(email, version, "REMOVE #draft ADD #version :one",
		map[string]string{"#draft": openDraft(id), "#version": draftsVersion},
		map[string]types.AttributeValue{":one": number(1)})}
}

// number is n as a DynamoDB number.
func number(n int64) types.AttributeValue {
	return &types.AttributeValueMemberN{Value: strconv.FormatInt(n, 10)}
}

// transact writes the items in one transaction: a draft's, an attachment's, a delete's. One cancelled by a condition or by another write
// to the same items answers why, item by item, to be tried again or answered; any other reason,
// throttling or an invalid request, is an error.
func (w *Writes) transact(ctx context.Context, items ...types.TransactWriteItem) ([]types.CancellationReason, error) {
	_, err := w.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
	var cancelled *types.TransactionCanceledException
	if !errors.As(err, &cancelled) {
		if err != nil {
			return nil, fmt.Errorf("write a transaction: %w", err)
		}
		return nil, nil
	}
	for _, reason := range cancelled.CancellationReasons {
		switch aws.ToString(reason.Code) {
		case "None", "ConditionalCheckFailed", "TransactionConflict":
		default:
			return nil, fmt.Errorf("write a transaction: %w", err)
		}
	}
	return cancelled.CancellationReasons, nil
}

// failed says whether the transaction's item i failed its condition.
func failed(reasons []types.CancellationReason, i int) bool {
	return i < len(reasons) && aws.ToString(reasons[i].Code) == "ConditionalCheckFailed"
}

// pause waits a few random milliseconds before a retry, so that requests that collided do not
// collide again in step; a request given up on meanwhile ends the wait with its error.
func pause(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Duration(5+rand.IntN(20)) * time.Millisecond):
		return nil
	}
}
