package de.hilling.taskfest.attachment;

import jakarta.enterprise.context.ApplicationScoped;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentials;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.identity.spi.AwsCredentialsIdentity;
import software.amazon.awssdk.identity.spi.AwsSessionCredentialsIdentity;
import software.amazon.awssdk.identity.spi.IdentityProvider;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;

/**
 * The attachment bucket, and the only class that talks to S3 (#204).
 *
 * <p>The browser moves file content itself, through links signed here: an upload link that only
 * accepts exactly the announced size and type -- both are signed into it, so S3 refuses anything
 * else -- and a short-lived download link. The backend itself asks whether an object is there, deletes
 * it, and lists the bucket for the orphan clean-up (#208). It also keeps the deletion records of
 * #213, small text objects under their own prefix, in the same bucket.</p>
 */
@ApplicationScoped
public class AttachmentStore {

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String bucket;

    /** The client's own credentials, which the download links are signed with explicitly. */
    private final IdentityProvider<? extends AwsCredentialsIdentity> credentials;

    AttachmentStore(S3Client s3, S3Presigner presigner, AttachmentsConfig config) {
        this.s3 = s3;
        this.presigner = presigner;
        this.bucket = config.bucket();
        this.credentials = s3.serviceClientConfiguration().credentialsProvider();
    }

    /**
     * An upload link, as the browser needs it.
     *
     * @param url where to PUT the file
     * @param headers the signed headers the PUT must carry, less those the browser sets itself
     * @param expiresAt until when it works
     */
    public record UploadLink(String url, Map<String, String> headers, Instant expiresAt) {
    }

    /**
     * A download link.
     *
     * @param url where the browser fetches the file
     * @param expiresAt until when it works
     */
    public record DownloadLink(String url, Instant expiresAt) {
    }

    /**
     * A link the browser uploads the file with. Its size and type are signed into it: S3 refuses an
     * upload of any other length or type, which is what enforces the size limit on the content
     * itself rather than on what the browser said.
     */
    public UploadLink uploadLink(String key, String contentType, long sizeBytes, Duration lifetime) {
        PresignedPutObjectRequest signed = presigner.presignPutObject(request -> request
            .signatureDuration(lifetime)
            .putObjectRequest(put -> put.bucket(bucket).key(key)
                .contentType(contentType)
                .contentLength(sizeBytes)));
        // The browser sends Host and Content-Length itself, and may not set them; everything else
        // that was signed it has to send exactly.
        Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        signed.signedHeaders().forEach((name, values) -> {
            if (!name.equalsIgnoreCase("host") && !name.equalsIgnoreCase("content-length")) {
                headers.put(name, String.join(",", values));
            }
        });
        return new UploadLink(signed.url().toString(), Map.copyOf(headers), signed.expiration());
    }

    /**
     * A link the browser opens the file with, inline -- images and PDFs show in the browser (D2) --
     * under its original name. Storage answers it with a {@code Cache-Control} for as long as the
     * link works (#236): what is under a key never changes, so the browser may keep it for as long
     * as it asks by this URL.
     */
    public DownloadLink downloadLink(String key, String contentType, String fileName, Duration lifetime) {
        String encoded = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        // Signed with credentials resolved here, so their expiry is known: a presigned URL stops
        // working when the session that signed it ends, and on ECS that is the task role's, which
        // rotates. The link then says so, and is neither handed out again nor cached past it.
        AwsCredentialsIdentity identity = credentials.resolveIdentity().join();
        PresignedGetObjectRequest signed = presigner.presignGetObject(request -> request
            .signatureDuration(lifetime)
            .getObjectRequest(get -> get.bucket(bucket).key(key)
                .responseContentType(contentType)
                .responseCacheControl("private, max-age=" + lifetime.toSeconds())
                .responseContentDisposition("inline; filename*=UTF-8''" + encoded)
                .overrideConfiguration(override -> override.credentialsProvider(
                    StaticCredentialsProvider.create(asCredentials(identity))))));
        return new DownloadLink(signed.url().toString(), worksUntil(signed.expiration(), identity.expirationTime()));
    }

    /** The resolved identity as the credentials type a request override takes, session token included. */
    private static AwsCredentials asCredentials(AwsCredentialsIdentity identity) {
        if (identity instanceof AwsCredentials credentials) {
            return credentials;
        }
        if (identity instanceof AwsSessionCredentialsIdentity session) {
            return AwsSessionCredentials.create(session.accessKeyId(), session.secretAccessKey(),
                session.sessionToken());
        }
        return AwsBasicCredentials.create(identity.accessKeyId(), identity.secretAccessKey());
    }

    /** Until when a link works: its own expiry, or the signing credentials' when they end first. */
    static Instant worksUntil(Instant signedUntil, Optional<Instant> credentialsExpire) {
        return credentialsExpire.filter(end -> end.isBefore(signedUntil)).orElse(signedUntil);
    }

    /**
     * One object in the bucket, as a listing returns it.
     *
     * @param key its key
     * @param lastModified when it was written
     */
    public record StoredObject(String key, Instant lastModified) {
    }

    /**
     * Every attachment object in the bucket, page by page; at demo sizes, a handful of requests.
     * Attachment keys are bare UUIDs, so anything under a prefix -- the deletion records of #213 --
     * is something else and is left out: the orphan clean-up must never take it for an orphan.
     */
    public List<StoredObject> list() {
        return listUnder("").stream().filter(object -> !object.key().contains("/")).toList();
    }

    /** Every object whose key starts with this prefix. */
    public List<StoredObject> listUnder(String prefix) {
        return s3.listObjectsV2Paginator(list -> list.bucket(bucket).prefix(prefix)).contents().stream()
            .map(object -> new StoredObject(object.key(), object.lastModified()))
            .toList();
    }

    /** Writes a small text object, such as a deletion record (#213), replacing any already there. */
    public void putText(String key, String text) {
        s3.putObject(put -> put.bucket(bucket).key(key).contentType("text/plain"), RequestBody.fromString(text));
    }


    /** What S3 holds under the key, or empty when nothing is there. */
    public Optional<HeadObjectResponse> head(String key) {
        try {
            return Optional.of(s3.headObject(head -> head.bucket(bucket).key(key)));
        } catch (NoSuchKeyException missing) {
            // The SDK maps HEAD's bodiless 404 to this, as it does GET's.
            return Optional.empty();
        }
    }

    /** Deletes the object; deleting one that is not there is no error. */
    public void delete(String key) {
        s3.deleteObject(delete -> delete.bucket(bucket).key(key));
    }
}
