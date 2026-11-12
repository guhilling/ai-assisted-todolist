package secrets

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// stored answers GetSecretValue from a map of ARNs to values, and counts the calls.
type stored struct {
	values map[string]string
	calls  int
}

func (s *stored) GetSecretValue(_ context.Context, in *secretsmanager.GetSecretValueInput,
	_ ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error) {
	s.calls++
	v, ok := s.values[aws.ToString(in.SecretId)]
	if !ok {
		return nil, errors.New("no such secret")
	}
	return &secretsmanager.GetSecretValueOutput{SecretString: aws.String(v)}, nil
}

func TestASettingNamedWithArnIsReadFromItsSecret(t *testing.T) {
	client := &stored{values: map[string]string{"arn:google": "g-secret"}}
	env := []string{"TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN=arn:google", "TABLE_NAME=t"}

	getenv, err := Resolve(context.Background(), env, client)

	if err != nil {
		t.Fatal(err)
	}
	if got := getenv("TASKFEST_OIDC_GOOGLE_CLIENT_SECRET"); got != "g-secret" {
		t.Errorf("secret %q", got)
	}
	if got := getenv("TABLE_NAME"); got != "t" {
		t.Errorf("other settings pass through: %q", got)
	}
}

func TestWithoutSecretsNothingIsAsked(t *testing.T) {
	client := &stored{}

	getenv, err := Resolve(context.Background(), []string{"TASKFEST_OIDC_COGNITO_CLIENT_SECRET=c"}, client)

	if err != nil || getenv("TASKFEST_OIDC_COGNITO_CLIENT_SECRET") != "c" || client.calls != 0 {
		t.Errorf("err %v, calls %d", err, client.calls)
	}
}

func TestASecretThatCannotBeReadFailsTheStart(t *testing.T) {
	_, err := Resolve(context.Background(), []string{"X_SECRET_ARN=arn:missing"}, &stored{})

	if err == nil {
		t.Error("no error")
	}
}

func TestASettingGivenBothWaysIsRefused(t *testing.T) {
	client := &stored{values: map[string]string{"arn:x": "from-secret"}}

	_, err := Resolve(context.Background(), []string{"X_SECRET=plain", "X_SECRET_ARN=arn:x"}, client)

	if err == nil {
		t.Error("one of the two would be ignored without a word")
	}
}

// binary answers every secret with SecretBinary only, as a secret stored as bytes is.
type binary struct{}

func (binary) GetSecretValue(context.Context, *secretsmanager.GetSecretValueInput,
	...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error) {
	return &secretsmanager.GetSecretValueOutput{SecretBinary: []byte("bytes")}, nil
}

func TestASecretWithoutTextFailsTheStart(t *testing.T) {
	_, err := Resolve(context.Background(), []string{"X_SECRET_ARN=arn:x"}, binary{})

	if err == nil {
		t.Error("an empty client secret would pass for a setting")
	}
}
