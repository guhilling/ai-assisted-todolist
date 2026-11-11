package main

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

type memBucket struct {
	deleted []string
	failing map[string]bool
}

func (b *memBucket) Delete(_ context.Context, key string) error {
	if b.failing[key] {
		return errors.New("S3 is down")
	}
	b.deleted = append(b.deleted, key)
	return nil
}

func record(seq, name, sk, objectKey string) events.DynamoDBEventRecord {
	r := events.DynamoDBEventRecord{EventName: name, Change: events.DynamoDBStreamRecord{
		SequenceNumber: seq,
		Keys:           map[string]events.DynamoDBAttributeValue{"SK": events.NewStringAttribute(sk)},
		OldImage:       map[string]events.DynamoDBAttributeValue{"SK": events.NewStringAttribute(sk)},
	}}
	if objectKey != "" {
		r.Change.OldImage["objectKey"] = events.NewStringAttribute(objectKey)
	}
	return r
}

func TestADeletedAttachmentsFileAndThumbnailGo(t *testing.T) {
	// Removed, discarded with its draft, or deleted by TTL: the record is the same.
	b := &memBucket{}

	got := handle(context.Background(), b, events.DynamoDBEvent{Records: []events.DynamoDBEventRecord{
		record("1", "REMOVE", "ATT#00000007", "abc"),
	}})

	if len(got.BatchItemFailures) != 0 || !slices.Equal(b.deleted, []string{"abc", "abc.thumbnail"}) {
		t.Errorf("%+v, deleted %v", got, b.deleted)
	}
}

func TestEverythingElseIsLeftAlone(t *testing.T) {
	// A link has no file; a task, draft or session goes without one; an attachment written or
	// changed keeps its files.
	b := &memBucket{}

	handle(context.Background(), b, events.DynamoDBEvent{Records: []events.DynamoDBEventRecord{
		record("1", "REMOVE", "ATT#00000008", ""),
		record("2", "REMOVE", "TASK#00000001", ""),
		record("3", "REMOVE", "DRAFT#00000002", "looks-like-a-key"),
		record("4", "MODIFY", "ATT#00000009", "kept"),
		record("5", "INSERT", "ATT#00000010", "new"),
	}})

	if len(b.deleted) != 0 {
		t.Errorf("deleted %v", b.deleted)
	}
}

func TestOnlyTheRecordsThatFailedAreAnsweredAsFailures(t *testing.T) {
	b := &memBucket{failing: map[string]bool{"bad.thumbnail": true}}

	got := handle(context.Background(), b, events.DynamoDBEvent{Records: []events.DynamoDBEventRecord{
		record("1", "REMOVE", "ATT#00000001", "good"),
		record("2", "REMOVE", "ATT#00000002", "bad"),
		record("3", "REMOVE", "ATT#00000003", "also-good"),
	}})

	if len(got.BatchItemFailures) != 1 || got.BatchItemFailures[0].ItemIdentifier != "2" {
		t.Errorf("%+v", got)
	}
	if !slices.Contains(b.deleted, "also-good") {
		t.Error("a failure stopped the rest")
	}
}

func TestARecordWithoutItsOldImageIsNoFailure(t *testing.T) {
	// A misconfigured stream: logged as an error, since retrying would never bring the key.
	b := &memBucket{}
	r := record("1", "REMOVE", "ATT#00000007", "")
	r.Change.OldImage = nil

	got := handle(context.Background(), b, events.DynamoDBEvent{Records: []events.DynamoDBEventRecord{r}})

	if len(got.BatchItemFailures) != 0 || len(b.deleted) != 0 {
		t.Errorf("%+v, deleted %v", got, b.deleted)
	}
}
