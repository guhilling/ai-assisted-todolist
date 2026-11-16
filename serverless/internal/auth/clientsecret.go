package auth

import (
	"fmt"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// signedSecretLifetime is how long a signed client secret lasts. Apple allows six months, but
// one is signed for each exchange of a code, so it need only outlast that one request: a secret
// that leaked from a log would be worthless minutes later, and there is nothing to rotate.
const signedSecretLifetime = 5 * time.Minute

// clientSecret is what the backend sends the provider's token endpoint as its client secret:
// the configured one, or, for a provider with a signing key, a JWT signed now.
func (p Provider) clientSecret(now time.Time) (string, error) {
	if p.SigningKey == nil {
		return p.ClientSecret, nil
	}
	return p.signedClientSecret(now)
}

// signedClientSecret is the client secret Sign in with Apple requires
// (https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret):
// a JWT signed ES256 with the team's key, naming the key in its header (kid), issued by the team
// (iss), about the client (sub), for the provider (aud, its issuer URL, https://appleid.apple.com
// at Apple), and expiring at most six months after it was issued.
func (p Provider) signedClientSecret(now time.Time) (string, error) {
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: p.SigningKey},
		(&jose.SignerOptions{}).WithHeader(jose.HeaderKey("kid"), p.SigningKeyID))
	if err != nil {
		return "", fmt.Errorf("sign the client secret: %w", err)
	}
	raw, err := jwt.Signed(signer).Claims(jwt.Claims{
		Issuer: p.SigningTeamID, Subject: p.ClientID, Audience: jwt.Audience{p.Issuer},
		IssuedAt: jwt.NewNumericDate(now), Expiry: jwt.NewNumericDate(now.Add(signedSecretLifetime)),
	}).Serialize()
	if err != nil {
		return "", fmt.Errorf("sign the client secret: %w", err)
	}
	return raw, nil
}
