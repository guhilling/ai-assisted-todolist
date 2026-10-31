package de.hilling.taskfest.attachment;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
        S3Client s3 = S3Client.builder().region(Region.EU_CENTRAL_1).credentialsProvider(session).build();
        S3Presigner presigner = S3Presigner.builder().region(Region.EU_CENTRAL_1).credentialsProvider(session).build();
        // The store reads only the bucket's name from its configuration.
        AttachmentsConfig config = (AttachmentsConfig) Proxy.newProxyInstance(AttachmentsConfig.class.getClassLoader(),
            new Class<?>[] { AttachmentsConfig.class }, (proxy, method, args) -> "taskfest-test-attachments");
        AttachmentStore store = new AttachmentStore(s3, presigner, config);

        AttachmentStore.UploadLink link = store.uploadLink("key", "image/png", 1, Duration.ofMinutes(15));

        assertEquals(sessionEnds, link.expiresAt());
    }
}
