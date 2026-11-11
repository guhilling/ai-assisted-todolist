package identity

import "testing"

func TestTheEmailsHashIsItsSHA256InLowerCaseHex(t *testing.T) {
	// As the Quarkus backend's DeletionRecords.hash writes it, so that its records stay readable.
	const want = "542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345"
	if got := EmailHash("person@example.com"); got != want {
		t.Errorf("hash %s; want %s", got, want)
	}
}
