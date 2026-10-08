package de.hilling.taskfest.support;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/**
 * S3 for the tests that need it (#204): LocalStack, started by Quarkus Dev Services, with the
 * attachment bucket created. Its own profile, so the tests that never touch S3 do not pay for the
 * container (#134).
 */
public class AttachmentStorageProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
            "quarkus.s3.devservices.enabled", "true",
            "quarkus.s3.devservices.buckets", "taskfest-attachments",
            "taskfest.account.deletions-enabled", "true",
            "quarkus.aws.devservices.localstack.container-properties.S3_SKIP_SIGNATURE_VALIDATION", "0");
    }
}
