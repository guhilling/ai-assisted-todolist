package store

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// An attachment is an ATT#<id> item in its owner's partition, with the id of the task or draft it
// is on, and an expiresAt, the table's TTL attribute, for as long as it is not kept for good: an
// upload not confirmed, a deleted task's attachment within the undo window, or a draft's, which
// goes with the draft. Expiry is the sweeps of the Quarkus backend becoming DynamoDB deleting the
// item; TTL takes up to about two days, so an attachment past its expiry is gone to every read and
// write here, and counts no more.
//
// The limits (board.MaxPerTask, board.MaxPerUser) are counted from the items themselves, read
// strongly consistent, and every write to them counts attachmentsVersion on the META item up, on
// the condition that it is still the one read before the items were: two attachments announced at
// once cannot both take the last place. The version is read before the task, so a task deleted or
// a draft added in between, which count it up too, makes the write try again rather than attach to
// what is no longer there.
const (
	attachmentPrefix   = "ATT#"
	attachmentsVersion = "attachmentsVersion"
	lastAttachmentID   = "lastAttachmentId"
)

// attachmentItem is an attachment as stored.
type attachmentItem struct {
	ID         int64  `dynamodbav:"id"`
	TaskID     *int64 `dynamodbav:"taskId,omitempty"` // none while detached from a deleted task
	FileName   string `dynamodbav:"fileName"`
	Kind       string `dynamodbav:"kind"`
	SizeBytes  int64  `dynamodbav:"sizeBytes"`
	ObjectKey  string `dynamodbav:"objectKey,omitempty"`
	URL        string `dynamodbav:"url,omitempty"`
	Available  bool   `dynamodbav:"available"`
	Thumbnail  bool   `dynamodbav:"thumbnail"`
	CreatedAt  int64  `dynamodbav:"createdAt"`
	DetachedAt *int64 `dynamodbav:"detachedAt,omitempty"`
	ExpiresAt  *int64 `dynamodbav:"expiresAt,omitempty"`
}

// attachment is the stored attachment as the domain's.
func (it attachmentItem) attachment() board.Attachment {
	a := board.Attachment{ID: it.ID, FileName: it.FileName, Kind: board.Kind(it.Kind), SizeBytes: it.SizeBytes,
		ObjectKey: it.ObjectKey, URL: it.URL, Available: it.Available, Thumbnail: it.Thumbnail}
	if it.TaskID != nil {
		a.TaskID = *it.TaskID
	}
	return a
}

// live says whether the attachment is still there at now: not past its expiry.
func (it attachmentItem) live(now time.Time) bool {
	return it.ExpiresAt == nil || *it.ExpiresAt > now.Unix()
}

// on says whether the attachment is on the task or draft with this id.
func (it attachmentItem) on(taskID int64) bool { return it.TaskID != nil && *it.TaskID == taskID }

// expiry is when the attachment stops existing unless something keeps it: an upload not confirmed
// after the pending lifetime, a detached one after the undo window, a draft's when the draft
// expires (draftExpires, 0 for a task), whichever comes first; nil when it is kept for good.
func (it attachmentItem) expiry(draftExpires int64) *int64 {
	var ends []int64
	if !it.Available {
		ends = append(ends, it.CreatedAt+int64(board.PendingLifetime.Seconds()))
	}
	if it.DetachedAt != nil {
		ends = append(ends, *it.DetachedAt+int64(board.UndoWindow.Seconds()))
	}
	if draftExpires != 0 {
		ends = append(ends, draftExpires)
	}
	if len(ends) == 0 {
		return nil
	}
	end := slices.Min(ends)
	return &end
}

// attachmentKey is the key of the user's attachment with this id.
func attachmentKey(email string, id int64) map[string]types.AttributeValue {
	return ownersAttachmentKey(OwnerKey(email), id)
}

// ownersAttachmentKey is the key of the attachment with this id in the partition owner.
func ownersAttachmentKey(owner string, id int64) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: owner},
		"SK": &types.AttributeValueMemberS{Value: fmt.Sprintf("ATT#%08d", id)},
	}
}

// Attachments returns the available attachments on each of the user's tasks, oldest first, by
// task id: what the board lists. Pending ones, detached ones and a draft's are left out. Read
// strongly consistent, so that an answer straight after a write, an undo's, shows it.
func (s *Store) Attachments(ctx context.Context, email string, now time.Time) (map[int64][]board.Attachment, error) {
	items, err := attachmentsOf(ctx, s.client, s.table, email, true)
	if err != nil {
		return nil, err
	}
	byTask := map[int64][]board.Attachment{}
	for _, it := range items {
		if it.live(now) && it.Available && it.TaskID != nil {
			byTask[*it.TaskID] = append(byTask[*it.TaskID], it.attachment())
		}
	}
	return byTask, nil
}

// attachmentsOf reads every attachment item of the user, in id order, expired ones included: one
// Query on their partition, page after page. Consistent where it is counted from.
func attachmentsOf(ctx context.Context, client QueryAPI, table, email string, consistent bool) ([]attachmentItem, error) {
	in := &dynamodb.QueryInput{
		TableName:              aws.String(table),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :att)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":  &types.AttributeValueMemberS{Value: OwnerKey(email)},
			":att": &types.AttributeValueMemberS{Value: attachmentPrefix},
		},
		ConsistentRead: aws.Bool(consistent),
	}
	var items []attachmentItem
	for {
		out, err := client.Query(ctx, in)
		if err != nil {
			return nil, fmt.Errorf("query attachments: %w", err)
		}
		var page []attachmentItem
		if err := attributevalue.UnmarshalListOfMaps(out.Items, &page); err != nil {
			return nil, fmt.Errorf("read attachments: %w", err)
		}
		items = append(items, page...)
		if len(out.LastEvaluatedKey) == 0 {
			return items, nil
		}
		in.ExclusiveStartKey = out.LastEvaluatedKey
	}
}

// attachState is what a write to a user's attachments is decided from, read in this order: the
// version, the task or draft, the items.
type attachState struct {
	version *int64
	items   []attachmentItem
}

// readAttachments reads the version on the user's META item, then, after between, their
// attachments.
func (w *Writes) readAttachments(ctx context.Context, email string, between func() error) (attachState, error) {
	version, err := w.attachmentsVersionOf(ctx, email)
	if err != nil {
		return attachState{}, err
	}
	if between != nil {
		if err := between(); err != nil {
			return attachState{}, err
		}
	}
	items, err := attachmentsOf(ctx, w.client, w.table, email, true)
	return attachState{version: version, items: items}, err
}

// attachmentsVersionOf reads the attachments version on the user's META item, strongly
// consistent; nil before the first write to their attachments.
func (w *Writes) attachmentsVersionOf(ctx context.Context, email string) (*int64, error) {
	out, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: metaKey(email), ConsistentRead: aws.Bool(true),
		ProjectionExpression:     aws.String("#v"),
		ExpressionAttributeNames: map[string]string{"#v": attachmentsVersion},
	})
	if err != nil {
		return nil, fmt.Errorf("read the attachments' version: %w", err)
	}
	v, ok := out.Item[attachmentsVersion]
	if !ok {
		return nil, nil
	}
	var n int64
	if err := attributevalue.Unmarshal(v, &n); err != nil {
		return nil, fmt.Errorf("read the attachments' version: %w", err)
	}
	return &n, nil
}

// bump counts the user's attachments version up, on the condition that it is still version.
func (w *Writes) bump(email string, version *int64) types.TransactWriteItem {
	return types.TransactWriteItem{Update: w.bumpUpdate(email, version, nil, nil, nil, nil)}
}

// bumpUpdate is an update of the user's META item that counts the attachments version up, on the
// condition that it is still version, with more to remove and add on the item, each clause's
// parts as an update expression writes them, and their names and values.
func (w *Writes) bumpUpdate(email string, version *int64, remove, add []string, names map[string]string,
	values map[string]types.AttributeValue) *types.Update {
	if names == nil {
		names = map[string]string{}
	}
	if values == nil {
		values = map[string]types.AttributeValue{}
	}
	names["#av"] = attachmentsVersion
	values[":aone"] = number(1)
	condition := "attribute_not_exists(#av)"
	if version != nil {
		condition = "#av = :av"
		values[":av"] = number(*version)
	}
	expr := "ADD " + strings.Join(append(add, "#av :aone"), ", ")
	if len(remove) > 0 {
		expr = "REMOVE " + strings.Join(remove, ", ") + " " + expr
	}
	return &types.Update{
		TableName: aws.String(w.table), Key: metaKey(email), UpdateExpression: aws.String(expr),
		ConditionExpression: aws.String(condition), ExpressionAttributeNames: names, ExpressionAttributeValues: values,
	}
}

// target is the user's task or open draft with this id: found, and the draft's expiry, 0 for a
// task. The draft is read first: a draft becomes a task, never the other way round, so a draft
// added between the two reads is found as the task it became.
func (w *Writes) target(ctx context.Context, email string, taskID int64, now time.Time) (int64, bool, error) {
	draft, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: draftKey(email, taskID), ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return 0, false, fmt.Errorf("find the draft: %w", err)
	}
	if len(draft.Item) > 0 {
		var d draftItem
		if err := attributevalue.UnmarshalMap(draft.Item, &d); err != nil {
			return 0, false, fmt.Errorf("read the draft: %w", err)
		}
		return d.ExpiresAt, d.ExpiresAt > now.Unix(), nil
	}
	task, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: taskKey(email, taskID), ConsistentRead: aws.Bool(true),
		ProjectionExpression: aws.String("PK"),
	})
	if err != nil {
		return 0, false, fmt.Errorf("find the task: %w", err)
	}
	return 0, len(task.Item) > 0, nil
}

// counts is how many live attachments are on the task and how many the user has altogether.
func (s attachState) counts(taskID int64, now time.Time) (onTask, ofUser int) {
	for _, it := range s.items {
		if it.live(now) {
			ofUser++
			if it.on(taskID) {
				onTask++
			}
		}
	}
	return onTask, ofUser
}

// find is the live attachment with this id, if the user has one.
func (s attachState) find(id int64, now time.Time) (attachmentItem, bool) {
	for _, it := range s.items {
		if it.ID == id && it.live(now) {
			return it, true
		}
	}
	return attachmentItem{}, false
}

// Attach adds a to the user's task or open draft taskID, if board.Admit lets it, and returns it with
// its id and, for a file, the key its content goes under: a file pending until its upload is
// confirmed, a link available at once. board.ErrNotFound when the user has no such task or draft,
// a board.Refusal when it is refused.
func (w *Writes) Attach(ctx context.Context, email string, taskID int64, a board.Attachment, now time.Time) (board.Attachment, error) {
	var id int64
	var key string
	for range draftAttempts {
		var draftExpires int64
		state, err := w.readAttachments(ctx, email, func() error {
			expires, found, err := w.target(ctx, email, taskID, now)
			if err == nil && !found {
				err = board.ErrNotFound
			}
			draftExpires = expires
			return err
		})
		if err != nil {
			return board.Attachment{}, err
		}
		onTask, ofUser := state.counts(taskID, now)
		if err := board.Admit(a, onTask, ofUser); err != nil {
			return board.Attachment{}, err
		}
		// Counted once, after the limits are known to leave room: a retry keeps the id and key.
		if id == 0 {
			if id, err = w.next(ctx, email, lastAttachmentID); err != nil {
				return board.Attachment{}, err
			}
			if a.Kind.IsFile() {
				// Random, saying nothing of the owner or the file, and without a slash.
				key = strings.ToLower(rand.Text())
			}
		}
		it := attachmentItem{ID: id, TaskID: &taskID, FileName: a.FileName, Kind: string(a.Kind),
			SizeBytes: a.SizeBytes, ObjectKey: key, URL: a.URL, Available: !a.Kind.IsFile(), CreatedAt: now.Unix()}
		it.ExpiresAt = it.expiry(draftExpires)
		item, err := attributevalue.MarshalMap(it)
		if err != nil {
			return board.Attachment{}, fmt.Errorf("write the attachment: %w", err)
		}
		for k, v := range attachmentKey(email, id) {
			item[k] = v
		}
		reasons, err := w.transact(ctx, w.bump(email, state.version), types.TransactWriteItem{Put: &types.Put{
			TableName: aws.String(w.table), Item: item, ConditionExpression: aws.String("attribute_not_exists(PK)"),
		}})
		switch {
		case err != nil:
			return board.Attachment{}, err
		case reasons == nil:
			return it.attachment(), nil
		case failed(reasons, 1):
			// Taken by an item written around the count: the next id.
			id = 0
		}
		if err := pause(ctx); err != nil {
			return board.Attachment{}, err
		}
	}
	return board.Attachment{}, errors.New("attach: lost every race for the count")
}

// Attachment is the user's live attachment id on their task or open draft taskID, pending or
// available; board.ErrNotFound when there is none, for someone else's too.
func (w *Writes) Attachment(ctx context.Context, email string, taskID, id int64, now time.Time) (board.Attachment, error) {
	it, err := w.attachmentOn(ctx, email, taskID, id, now)
	if err != nil {
		return board.Attachment{}, err
	}
	return it.attachment(), nil
}

// attachmentOn reads the live attachment id on the user's task or open draft taskID.
func (w *Writes) attachmentOn(ctx context.Context, email string, taskID, id int64, now time.Time) (attachmentItem, error) {
	if _, found, err := w.target(ctx, email, taskID, now); err != nil || !found {
		return attachmentItem{}, errors.Join(err, notFoundUnless(err))
	}
	out, err := w.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(w.table), Key: attachmentKey(email, id), ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return attachmentItem{}, fmt.Errorf("find the attachment: %w", err)
	}
	var it attachmentItem
	if len(out.Item) == 0 {
		return attachmentItem{}, board.ErrNotFound
	}
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return attachmentItem{}, fmt.Errorf("read the attachment: %w", err)
	}
	if !it.live(now) || !it.on(taskID) {
		return attachmentItem{}, board.ErrNotFound
	}
	return it, nil
}

// notFoundUnless is board.ErrNotFound when err is nil: nothing failed, and nothing was found.
func notFoundUnless(err error) error {
	if err != nil {
		return nil
	}
	return board.ErrNotFound
}

// liveCondition holds that an attachment item is there and not past its expiry at :now.
const liveCondition = "attribute_exists(PK) AND (attribute_not_exists(expiresAt) OR expiresAt > :now)"

// Confirm makes the user's pending attachment id on taskID available, with or without a
// thumbnail, once its upload has been found in storage; one already available stays as it is.
// board.ErrNotFound when it is gone or not the user's.
func (w *Writes) Confirm(ctx context.Context, email string, taskID, id int64, thumbnail bool, now time.Time) (board.Attachment, error) {
	for range draftAttempts {
		var draftExpires int64
		var found bool
		state, err := w.readAttachments(ctx, email, func() error {
			var err error
			draftExpires, found, err = w.target(ctx, email, taskID, now)
			return err
		})
		if err != nil {
			return board.Attachment{}, err
		}
		it, ok := state.find(id, now)
		if !found || !ok || !it.on(taskID) {
			return board.Attachment{}, board.ErrNotFound
		}
		if it.Available {
			return it.attachment(), nil
		}
		it.Available, it.Thumbnail = true, thumbnail
		reasons, err := w.transact(ctx, w.bump(email, state.version), w.reexpire(email, it, draftExpires, now,
			[]string{"available = :yes", "thumbnail = :thumbnail"}, map[string]types.AttributeValue{
				":yes": &types.AttributeValueMemberBOOL{Value: true}, ":thumbnail": &types.AttributeValueMemberBOOL{Value: thumbnail},
			}, nil))
		if err != nil {
			return board.Attachment{}, err
		}
		if reasons == nil {
			return it.attachment(), nil
		}
		if err := pause(ctx); err != nil {
			return board.Attachment{}, err
		}
	}
	return board.Attachment{}, errors.New("confirm: lost every race for the count")
}

// reexpire is an update of a live attachment item that sets the expiry it has with draftExpires,
// or removes it when it is kept for good, with more to set and remove.
func (w *Writes) reexpire(email string, it attachmentItem, draftExpires int64, now time.Time, set []string,
	values map[string]types.AttributeValue, remove []string) types.TransactWriteItem {
	values[":now"] = number(now.Unix())
	if end := it.expiry(draftExpires); end != nil {
		set = append(set, "expiresAt = :expires")
		values[":expires"] = number(*end)
	} else {
		remove = append(remove, "expiresAt")
	}
	var expr []string
	if len(set) > 0 {
		expr = append(expr, "SET "+strings.Join(set, ", "))
	}
	if len(remove) > 0 {
		expr = append(expr, "REMOVE "+strings.Join(remove, ", "))
	}
	return types.TransactWriteItem{Update: &types.Update{
		TableName: aws.String(w.table), Key: attachmentKey(email, it.ID),
		UpdateExpression:    aws.String(strings.Join(expr, " ")),
		ConditionExpression: aws.String(liveCondition), ExpressionAttributeValues: values,
	}}
}

// RemoveAttachment deletes the user's attachment item id; one already gone is no error. Its files,
// if it has any, are the caller's to delete.
func (w *Writes) RemoveAttachment(ctx context.Context, email string, id int64) error {
	for range draftAttempts {
		version, err := w.attachmentsVersionOf(ctx, email)
		if err != nil {
			return err
		}
		reasons, err := w.transact(ctx, w.bump(email, version), types.TransactWriteItem{Delete: &types.Delete{
			TableName: aws.String(w.table), Key: attachmentKey(email, id),
		}})
		if err != nil || reasons == nil {
			return err
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
	return errors.New("remove an attachment: lost every race for the count")
}

// Reattach puts the user's attachments ids, detached from a deleted task within the undo window,
// on the task an undo re-created (D3 on #204), oldest first and only as many as the task may still
// take. Anything else is ignored rather than refused, since undo is best effort by nature.
func (w *Writes) Reattach(ctx context.Context, email string, taskID int64, ids []int64, now time.Time) error {
	for range draftAttempts {
		var found bool
		state, err := w.readAttachments(ctx, email, func() error {
			var err error
			draftExpires, ok, err := w.target(ctx, email, taskID, now)
			found = ok && draftExpires == 0
			return err
		})
		if err != nil || !found {
			return err
		}
		onTask, _ := state.counts(taskID, now)
		items := []types.TransactWriteItem{w.bump(email, state.version)}
		for _, it := range state.items {
			if len(items)-1 >= board.MaxPerTask-onTask {
				break
			}
			if !it.live(now) || it.TaskID != nil || !slices.Contains(ids, it.ID) {
				continue
			}
			it.TaskID, it.DetachedAt = &taskID, nil
			op := w.reexpire(email, it, 0, now, []string{"taskId = :task"},
				map[string]types.AttributeValue{":task": number(taskID)}, []string{"detachedAt"})
			op.Update.ConditionExpression = aws.String(liveCondition + " AND attribute_not_exists(taskId)")
			items = append(items, op)
		}
		if len(items) == 1 {
			return nil
		}
		reasons, err := w.transact(ctx, items...)
		if err != nil || reasons == nil {
			return err
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
	return errors.New("reattach: lost every race for the count")
}

// detach is the updates that detach the attachments on the user's task id, which is being
// deleted, keeping them for the undo window.
func (w *Writes) detach(email string, state attachState, id int64, now time.Time) []types.TransactWriteItem {
	var items []types.TransactWriteItem
	for _, it := range state.items {
		if !it.live(now) || !it.on(id) {
			continue
		}
		detached := now.Unix()
		it.TaskID, it.DetachedAt = nil, &detached
		items = append(items, w.reexpire(email, it, 0, now, []string{"detachedAt = :detached"},
			map[string]types.AttributeValue{":detached": number(detached)}, []string{"taskId"}))
	}
	return items
}
