package identity

import "testing"

func TestTheEmailsHashIsItsSHA256InLowerCaseHex(t *testing.T) {
	// As the Quarkus backend's DeletionRecords.hash writes it, so that its records stay readable.
	const want = "542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345"
	if got := EmailHash("person@example.com"); got != want {
		t.Errorf("hash %s; want %s", got, want)
	}
}

func TestTheEmailIsKnownInLowerCase(t *testing.T) {
	// #622: Gunnar@Example.com and gunnar@example.com are one person, whichever case a provider
	// sends; nothing else about the address is changed.
	if got := Canonical(" Gunnar@Example.COM"); got != " gunnar@example.com" {
		t.Errorf("got %q", got)
	}
}

func TestOnlyTheLettersAToZAreLowerCased(t *testing.T) {
	// Unicode's lower case maps the Kelvin sign (U+212A) onto a plain k: an address written with
	// it would have been Kate's account. Only A to Z are folded; anything else stays as sent.
	for _, sent := range []string{"Kate@example.com", "Ärger@example.com", "İsa@example.com"} {
		if got := Canonical(sent); got == "kate@example.com" || got == "ärger@example.com" || got == "isa@example.com" || got == "i̇sa@example.com" {
			t.Errorf("%q became %q", sent, got)
		}
	}
	if got := Canonical("ÄRGER@Example.com"); got != "Ärger@example.com" {
		t.Errorf("got %q", got)
	}
}
