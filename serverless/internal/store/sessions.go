package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// ItemAPI is the DynamoDB calls that read and write items: sessions', the task writes', and the
// transactions that keep a user's drafts and their count together.
type ItemAPI interface {
	QueryAPI
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	TransactWriteItems(ctx context.Context, in *dynamodb.TransactWriteItemsInput, opts ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error)
}

// Sessions keeps the website's sessions and its sign-ins under way in the table (#549), each in
// a partition of its own, SESSION#<key> or SIGNIN#<key>, keyed by the hash of its cookie's value.
// expiresAt, in Unix seconds, is the table's TTL attribute, so an ended item deletes itself.
type Sessions struct {
	client ItemAPI
	table  string
	now    func() time.Time
}

// NewSessions returns sessions in the named table.
func NewSessions(client ItemAPI, table string) *Sessions {
	return &Sessions{client: client, table: table, now: time.Now}
}

var _ auth.Store = (*Sessions)(nil)

// sessionItem is a session as stored. Times are Unix seconds, like the TTL attribute.
type sessionItem struct {
	PK        string `dynamodbav:"PK"`
	SK        string `dynamodbav:"SK"`
	Email     string `dynamodbav:"email"`
	Name      string `dynamodbav:"name,omitempty"`
	Picture   string `dynamodbav:"picture,omitempty"`
	Provider  string `dynamodbav:"provider"`
	Subject   string `dynamodbav:"subject,omitempty"`
	Created   int64  `dynamodbav:"created"`
	LastSeen  int64  `dynamodbav:"lastSeen"`
	ExpiresAt int64  `dynamodbav:"expiresAt"`
}

type pendingItem struct {
	PK        string `dynamodbav:"PK"`
	SK        string `dynamodbav:"SK"`
	Provider  string `dynamodbav:"provider"`
	Verifier  string `dynamodbav:"verifier"`
	Nonce     string `dynamodbav:"nonce"`
	ExpiresAt int64  `dynamodbav:"expiresAt"`
}

// sessionKey is the key of the session item for this session key.
func sessionKey(key string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "SESSION#" + key},
		"SK": &types.AttributeValueMemberS{Value: "SESSION"},
	}
}

// pendingKey is the key of the item holding a sign-in under way.
func pendingKey(key string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "SIGNIN#" + key},
		"SK": &types.AttributeValueMemberS{Value: "SIGNIN"},
	}
}

// sessionLink is the item in the user's partition that names one of their sessions, so that
// deleting the account ends it (#553). It expires when the session can last no longer.
type sessionLink struct {
	PK        string `dynamodbav:"PK"`
	SK        string `dynamodbav:"SK"`
	ExpiresAt int64  `dynamodbav:"expiresAt"`
}

// PutSession stores a new session, and first its link from the user's account: a link without a
// session ends nothing, a session without a link would outlive the account's deletion.
func (s *Sessions) PutSession(ctx context.Context, key string, session auth.Session, expires time.Time) error {
	link, err := attributevalue.MarshalMap(sessionLink{PK: OwnerKey(session.Email), SK: sessionLinkPrefix + key,
		ExpiresAt: session.Created.Add(auth.AbsoluteLifetime).Unix()})
	if err != nil {
		return err
	}
	if _, err := s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(s.table), Item: link}); err != nil {
		return fmt.Errorf("link the session: %w", err)
	}
	item, err := attributevalue.MarshalMap(sessionItem{
		PK: "SESSION#" + key, SK: "SESSION",
		Email: session.Email, Name: session.Name, Picture: session.Picture,
		Provider: session.Provider, Subject: session.Subject,
		Created: session.Created.Unix(), LastSeen: session.LastSeen.Unix(), ExpiresAt: expires.Unix(),
	})
	if err != nil {
		return err
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(s.table), Item: item})
	if err != nil {
		return fmt.Errorf("put session: %w", err)
	}
	return nil
}

// GetSession reads a session, or ok false when there is none. Whether it has ended is the
// caller's to judge from its times: TTL deletes late.
func (s *Sessions) GetSession(ctx context.Context, key string) (auth.Session, bool, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{TableName: aws.String(s.table), Key: sessionKey(key)})
	if err != nil {
		return auth.Session{}, false, fmt.Errorf("get session: %w", err)
	}
	if out.Item == nil {
		return auth.Session{}, false, nil
	}
	var it sessionItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return auth.Session{}, false, fmt.Errorf("read session: %w", err)
	}
	return auth.Session{
		Identity: identity.Identity{Email: it.Email, Name: it.Name, Picture: it.Picture,
			Provider: it.Provider, Subject: it.Subject},
		Created: time.Unix(it.Created, 0), LastSeen: time.Unix(it.LastSeen, 0),
	}, true, nil
}

// TouchSession records a session's latest request and its new end, only while it still exists,
// so a request racing a sign-out cannot bring the session back.
func (s *Sessions) TouchSession(ctx context.Context, key string, lastSeen, expires time.Time) error {
	_, err := s.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:           aws.String(s.table),
		Key:                 sessionKey(key),
		UpdateExpression:    aws.String("SET lastSeen = :seen, expiresAt = :expires"),
		ConditionExpression: aws.String("attribute_exists(PK)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":seen":    &types.AttributeValueMemberN{Value: strconv.FormatInt(lastSeen.Unix(), 10)},
			":expires": &types.AttributeValueMemberN{Value: strconv.FormatInt(expires.Unix(), 10)},
		},
	})
	var gone *types.ConditionalCheckFailedException
	if err != nil && !errors.As(err, &gone) {
		return fmt.Errorf("touch session: %w", err)
	}
	return nil
}

// DeleteSession ends a session.
func (s *Sessions) DeleteSession(ctx context.Context, key string) error {
	_, err := s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: aws.String(s.table), Key: sessionKey(key)})
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// PutPendingSignIn stores a sign-in under way.
func (s *Sessions) PutPendingSignIn(ctx context.Context, key string, p auth.PendingSignIn, expires time.Time) error {
	item, err := attributevalue.MarshalMap(pendingItem{
		PK: "SIGNIN#" + key, SK: "SIGNIN", Provider: p.Provider, Verifier: p.Verifier, Nonce: p.Nonce,
		ExpiresAt: expires.Unix(),
	})
	if err != nil {
		return err
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(s.table), Item: item})
	if err != nil {
		return fmt.Errorf("put sign-in: %w", err)
	}
	return nil
}

// TakePendingSignIn deletes a sign-in under way and returns what it was, in one request, so two
// callbacks with the same state cannot both finish it. One past its time counts as none.
func (s *Sessions) TakePendingSignIn(ctx context.Context, key string) (auth.PendingSignIn, bool, error) {
	out, err := s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.table), Key: pendingKey(key), ReturnValues: types.ReturnValueAllOld,
	})
	if err != nil {
		return auth.PendingSignIn{}, false, fmt.Errorf("take sign-in: %w", err)
	}
	if out.Attributes == nil {
		return auth.PendingSignIn{}, false, nil
	}
	var it pendingItem
	if err := attributevalue.UnmarshalMap(out.Attributes, &it); err != nil {
		return auth.PendingSignIn{}, false, fmt.Errorf("read sign-in: %w", err)
	}
	if s.now().Unix() > it.ExpiresAt {
		return auth.PendingSignIn{}, false, nil
	}
	return auth.PendingSignIn{Provider: it.Provider, Verifier: it.Verifier, Nonce: it.Nonce}, true, nil
}
