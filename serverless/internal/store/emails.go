package store

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// metaReader is the one call that says which email keys an account: a read of a META item.
type metaReader interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
}

// AccountEmail is the email that keys the account of the person signed in as email, the one
// every partition key, deletion and deletion record of theirs is made from (OwnerKey,
// identity.EmailHash). It is the email lower-cased (identity.Canonical, #622), unless the email
// as sent holds an account: before #622 a partition was the hash of the email exactly as the
// provider sent it, and such an account keeps its partition rather than its board being lost.
//
// An email in lower case is answered without a read; one with capitals costs one strongly
// consistent read of the META item under it as sent, which every account that holds anything
// has. That account is taken even when one under the lower case exists too, as when another
// provider sent the address in lower case before #622: the older stays reachable rather than
// hidden, until it is deleted. Once it is, the email keys the lower-cased account.
func (a *Accounts) AccountEmail(ctx context.Context, email string) (string, error) {
	return accountEmail(ctx, a.client, a.table, email)
}

// accountEmail is AccountEmail on any table client: Sessions needs it to link a session from
// the account it belongs to.
func accountEmail(ctx context.Context, client metaReader, table, email string) (string, error) {
	canonical := identity.Canonical(email)
	if canonical == email {
		return email, nil
	}
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(table), Key: metaOfOwner(OwnerKey(email)), ConsistentRead: aws.Bool(true),
		ProjectionExpression: aws.String("PK"),
	})
	if err != nil {
		return "", fmt.Errorf("read whether the email as sent has an account: %w", err)
	}
	if len(out.Item) > 0 {
		return email, nil
	}
	return canonical, nil
}
