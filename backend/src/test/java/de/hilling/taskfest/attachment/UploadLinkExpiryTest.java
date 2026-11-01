package de.hilling.taskfest.attachment;

import java.lang.reflect.Proxy;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Until when an upload link works (#434): like a download link, no longer than the session that
 * signed it, which on ECS is the task role's and may end before the link's own lifetime. Signed
 * offline, with made-up session credentials; nothing reaches S3.
 */
class UploadLinkExpiryTest {

    @Test
    void shouldEndWithTheSigningSessionWhenItExpiresFirst() {
        Instant sessionEnds = Instant.now().plus(Duration.ofMinutes(5)).truncatedTo(ChronoUnit.SECONDS);
        StaticCredentialsProvider session = StaticCredentialsProvider.create(AwsSessionCredentials.builder()
            .accessKeyId("ASIAEXAMPLE").secretAccessKey("example-secret").sessionToken("example-token")
            .expirationTime(sessionEnds).build());
        // The store reads only the bucket's name from its configuration.
        AttachmentsConfig config = (AttachmentsConfig) Proxy.newProxyInstance(AttachmentsConfig.class.getClassLoader(),
            new Class<?>[] { AttachmentsConfig.class }, (proxy, method, args) -> "taskfest-test-attachments");
        try (S3Client s3 = S3Client.builder().region(Region.EU_CENTRAL_1).credentialsProvider(session).build();
             S3Presigner presigner = S3Presigner.builder().region(Region.EU_CENTRAL_1).credentialsProvider(session)
                 .build()) {
            AttachmentStore store = new AttachmentStore(s3, presigner, config);

            AttachmentStore.UploadLink link = store.uploadLink("key", "image/png", 1, Duration.ofMinutes(15));

            assertEquals(sessionEnds, link.expiresAt());
        }
    }

    @Test
    void shouldSignWithTheSessionWhoseExpiryItReports() {
        // The presigner's own session differs, so a link signed with that one shows in its token.
        Instant sessionEnds = Instant.now().plus(Duration.ofMinutes(5)).truncatedTo(ChronoUnit.SECONDS);

        AttachmentStore.UploadLink link = uploadLink(session("client-token", sessionEnds),
            session("presigner-token", sessionEnds.plus(Duration.ofHours(1))));

        assertEquals("client-token", queryParameter(link.url(), "X-Amz-Security-Token"));
        assertEquals(sessionEnds, link.expiresAt());
    }

    @Test
    void shouldEndWithItsOwnLifetimeWhenTheSessionOutlivesIt() {
        StaticCredentialsProvider session = session("example-token", Instant.now().plus(Duration.ofHours(1)));

        AttachmentStore.UploadLink link = uploadLink(session, session);

        // The link's own expiry, as its signature states it: signed at X-Amz-Date, for X-Amz-Expires.
        // The signature has whole seconds; the store reports the signer's clock, to the microsecond.
        Instant signedAt = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssX")
            .parse(queryParameter(link.url(), "X-Amz-Date"), Instant::from);
        assertEquals("900", queryParameter(link.url(), "X-Amz-Expires"));
        assertEquals(signedAt.plus(Duration.ofMinutes(15)), link.expiresAt().truncatedTo(ChronoUnit.SECONDS));
    }

    /** Session credentials ending at the given time, with a token to tell them apart by. */
    private static StaticCredentialsProvider session(String token, Instant ends) {
        return StaticCredentialsProvider.create(AwsSessionCredentials.builder()
            .accessKeyId("ASIAEXAMPLE").secretAccessKey("example-secret").sessionToken(token)
            .expirationTime(ends).build());
    }

    /** A 15-minute upload link from a store whose S3 client and presigner have these credentials. */
    private static AttachmentStore.UploadLink uploadLink(StaticCredentialsProvider client,
                                                         StaticCredentialsProvider presigning) {
        AttachmentsConfig config = (AttachmentsConfig) Proxy.newProxyInstance(AttachmentsConfig.class.getClassLoader(),
            new Class<?>[] { AttachmentsConfig.class }, (proxy, method, args) -> "taskfest-test-attachments");
        try (S3Client s3 = S3Client.builder().region(Region.EU_CENTRAL_1).credentialsProvider(client).build();
             S3Presigner presigner = S3Presigner.builder().region(Region.EU_CENTRAL_1).credentialsProvider(presigning)
                 .build()) {
            return new AttachmentStore(s3, presigner, config).uploadLink("key", "image/png", 1, Duration.ofMinutes(15));
        }
    }

    /** One query parameter of a signed URL, decoded. */
    private static String queryParameter(String url, String name) {
        return Arrays.stream(URI.create(url).getRawQuery().split("&"))
            .map(pair -> pair.split("=", 2))
            .filter(pair -> pair[0].equals(name))
            .map(pair -> URLDecoder.decode(pair[1], StandardCharsets.UTF_8))
            .findFirst().orElseThrow();
    }
}
