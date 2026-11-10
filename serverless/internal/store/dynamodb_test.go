package store

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	tcdynamodb "github.com/testcontainers/testcontainers-go/modules/dynamodb"
)

// The DynamoDB Local image the repository tests run against; Renovate moves it.
const dynamoDBLocal = "amazon/dynamodb-local:3.3.2"

// localTable starts DynamoDB Local in a container, as the Java backend's tests start PostgreSQL,
// and creates an empty table shaped like the real one (PK and SK, both strings).
func localTable(t *testing.T) (*dynamodb.Client, string) {
	t.Helper()
	ctx := context.Background()
	ctr, err := tcdynamodb.Run(ctx, dynamoDBLocal)
	if err != nil {
		t.Fatalf("starting DynamoDB Local: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })
	endpoint, err := ctr.ConnectionString(ctx)
	if err != nil {
		t.Fatal(err)
	}
	client := dynamodb.New(dynamodb.Options{
		Region:       "eu-central-1",
		BaseEndpoint: aws.String("http://" + endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider("local", "local", ""),
	})
	table := "taskfest-test"
	_, err = client.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:   aws.String(table),
		BillingMode: types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String("PK"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("SK"), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String("PK"), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String("SK"), KeyType: types.KeyTypeRange},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return client, table
}

func put(t *testing.T, client *dynamodb.Client, table string, item map[string]any) {
	t.Helper()
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.PutItem(context.Background(), &dynamodb.PutItemInput{TableName: aws.String(table), Item: av}); err != nil {
		t.Fatal(err)
	}
}

func TestTheBoardIsReadFromDynamoDBAndHoldsOnlyTheCallersTasks(t *testing.T) {
	client, table := localTable(t)
	mine, theirs := OwnerKey("taskfest-test-one@example.com"), OwnerKey("taskfest-test-two@example.com")
	zone, at := "Europe/Berlin", "10:00"
	put(t, client, table, map[string]any{"PK": mine, "SK": "TASK#00000001", "id": 1, "description": "Mine",
		"dueDate": "2026-11-30", "dueTime": at, "timeZone": zone, "importance": "HIGH", "state": "TODO"})
	put(t, client, table, map[string]any{"PK": mine, "SK": "DRAFT#00000002", "id": 2})
	put(t, client, table, map[string]any{"PK": theirs, "SK": "TASK#00000003", "id": 3, "description": "Theirs",
		"dueDate": "2026-11-30", "importance": "LOW", "state": "TODO"})
	s := New(client, table)

	tasks, err := s.Tasks(context.Background(), "taskfest-test-one@example.com")

	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].ID != 1 || tasks[0].Description != "Mine" {
		t.Fatalf("got %+v; want the one task, not the draft or another user's", tasks)
	}
	if tasks[0].DueTime == nil || *tasks[0].DueTime != at || tasks[0].TimeZone == nil || *tasks[0].TimeZone != zone {
		t.Errorf("due time and zone: %+v", tasks[0])
	}
}

func TestPrimingAnEmptyTableSucceeds(t *testing.T) {
	client, table := localTable(t)

	if err := New(client, table).Prime(context.Background()); err != nil {
		t.Error(err)
	}
}
