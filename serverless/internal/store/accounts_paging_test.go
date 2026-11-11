package store

import (
	"context"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// pagedTable answers a partition's Query two items to a page, as DynamoDB does past 1 MB, and
// takes batch deletes; the item calls Finish makes besides find no META.
type pagedTable struct {
	AccountsAPI
	sks []string
}

func (p *pagedTable) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	start := 0
	if in.ExclusiveStartKey != nil {
		last := in.ExclusiveStartKey["SK"].(*types.AttributeValueMemberS).Value
		for i, sk := range p.sks {
			if sk == last {
				start = i + 1
			}
		}
	}
	out := &dynamodb.QueryOutput{}
	for _, sk := range p.sks[start:min(start+2, len(p.sks))] {
		out.Items = append(out.Items, map[string]types.AttributeValue{
			"PK": in.ExpressionAttributeValues[":pk"], "SK": &types.AttributeValueMemberS{Value: sk}})
	}
	if start+2 < len(p.sks) {
		out.LastEvaluatedKey = out.Items[len(out.Items)-1]
	}
	return out, nil
}

func (p *pagedTable) BatchWriteItem(_ context.Context, in *dynamodb.BatchWriteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error) {
	for _, requests := range in.RequestItems {
		for _, r := range requests {
			gone := r.DeleteRequest.Key["SK"].(*types.AttributeValueMemberS).Value
			for i, sk := range p.sks {
				if sk == gone {
					p.sks = append(p.sks[:i], p.sks[i+1:]...)
					break
				}
			}
		}
	}
	return &dynamodb.BatchWriteItemOutput{}, nil
}

func (p *pagedTable) DeleteItem(context.Context, *dynamodb.DeleteItemInput, ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	return &dynamodb.DeleteItemOutput{}, nil
}

func (p *pagedTable) GetItem(context.Context, *dynamodb.GetItemInput, ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	return &dynamodb.GetItemOutput{}, nil
}

func TestEveryPageOfThePartitionIsDeleted(t *testing.T) {
	// More pages than the sweeps that look for racing writes, so they cannot make up for one
	// that reads only the first page.
	table := &pagedTable{sks: []string{"ATT#00000001", "DRAFT#00000002"}}
	for i := 1; i <= 2*(sweeps+2); i++ {
		table.sks = append(table.sks, fmt.Sprintf("TASK#%08d", i))
	}

	if err := NewAccounts(table, "taskfest-test").Finish(context.Background(), "person@example.com"); err != nil {
		t.Fatal(err)
	}

	if len(table.sks) != 0 {
		t.Errorf("left: %v", table.sks)
	}
}
