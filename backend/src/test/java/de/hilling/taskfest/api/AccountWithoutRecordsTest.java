package de.hilling.taskfest.api;

import de.hilling.taskfest.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Deleting an account where deletion records are switched off (#213) -- the Compose stacks, which
 * have no bucket, and this plain test profile: the account goes, without a record.
 */
@QuarkusTest
class AccountWithoutRecordsTest {

    @Test
    @TestSecurity(user = "no-bucket@example.com")
    @OidcSecurity(claims = { @Claim(key = "email", value = "no-bucket@example.com") })
    void shouldDeleteTheAccountWithoutARecord() {
        given().when().get("/api/tasks").then().statusCode(200);

        given().when().delete("/api/account").then().statusCode(204);

        assertEquals(0L, (long) QuarkusTransaction.requiringNew().call(() -> User.count("email", "no-bucket@example.com")));
    }
}
