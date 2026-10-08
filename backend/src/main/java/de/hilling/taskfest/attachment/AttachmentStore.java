package de.hilling.taskfest.attachment;

import jakarta.enterprise.context.ApplicationScoped;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
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
 * else -- and a short-lived download link. The backend itself only asks whether an object is there
 * and deletes it.</p>
 */
@ApplicationScoped
public class AttachmentStore {

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String bucket;

    AttachmentStore(S3Client s3, S3Presigner presigner, AttachmentsConfig config) {
        this.s3 = s3;
        this.presigner = presigner;
        this.bucket = config.bucket();
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
    public UploadLink uploadLink(String key, AttachmentKind kind, long sizeBytes, Duration lifetime) {
        PresignedPutObjectRequest signed = presigner.presignPutObject(request -> request
            .signatureDuration(lifetime)
            .putObjectRequest(put -> put.bucket(bucket).key(key)
                .contentType(kind.contentType())
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
     * under its original name.
     */
    public DownloadLink downloadLink(String key, AttachmentKind kind, String fileName, Duration lifetime) {
        String encoded = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        PresignedGetObjectRequest signed = presigner.presignGetObject(request -> request
            .signatureDuration(lifetime)
            .getObjectRequest(get -> get.bucket(bucket).key(key)
                .responseContentType(kind.contentType())
                .responseContentDisposition("inline; filename*=UTF-8''" + encoded)));
        return new DownloadLink(signed.url().toString(), signed.expiration());
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
