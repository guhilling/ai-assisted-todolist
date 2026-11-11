// Package secrets reads the settings whose values must not pass through OpenTofu or a Lambda
// function's configuration, such as a provider's client secret, from Secrets Manager (#554). It is
// the one place Secrets Manager's types may appear.
package secrets

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// arnSuffix marks a setting that names a secret: X_SECRET_ARN holds the ARN whose value is
// X_SECRET.
const arnSuffix = "_SECRET_ARN"

// API is the one Secrets Manager call this package makes.
type API interface {
	GetSecretValue(ctx context.Context, in *secretsmanager.GetSecretValueInput,
		opts ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

// Resolve returns a getenv over environ, KEY=value pairs as os.Environ gives them, in which each
// setting X_SECRET_ARN also gives X_SECRET, read from that secret once, now: at a cold start, never
// during a request. A secret that cannot be read fails the start, and so does a setting given both
// ways, since one of them would be ignored without a word.
func Resolve(ctx context.Context, environ []string, client API) (func(string) string, error) {
	settings := make(map[string]string, len(environ))
	for _, kv := range environ {
		if k, v, ok := strings.Cut(kv, "="); ok {
			settings[k] = v
		}
	}
	resolved := make(map[string]string)
	for k, arn := range settings {
		name, ok := strings.CutSuffix(k, arnSuffix)
		if !ok {
			continue
		}
		name += "_SECRET"
		if _, both := settings[name]; both {
			return nil, fmt.Errorf("%s and %s are both set", name, k)
		}
		out, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(arn)})
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", k, err)
		}
		resolved[name] = aws.ToString(out.SecretString)
	}
	for k, v := range resolved {
		settings[k] = v
	}
	return func(k string) string { return settings[k] }, nil
}
