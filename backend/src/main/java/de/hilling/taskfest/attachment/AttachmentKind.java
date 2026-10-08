package de.hilling.taskfest.attachment;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * The kinds of file a task may carry (#204, D2): PDFs, and the images every browser shows inline.
 *
 * <p>HEIC is left out although phones produce it: only Safari can show it, and D2 wants images
 * inline. SVG is left out on purpose: it is a document that can carry script, and S3 would serve it
 * as one.</p>
 *
 * <p>Stored as the PostgreSQL enum {@code attachment_kind}; the names are the column's labels,
 * which {@code AttachmentKindColumnTest} keeps in step.</p>
 */
public enum AttachmentKind {
    PDF("application/pdf"),
    JPEG("image/jpeg"),
    PNG("image/png"),
    WEBP("image/webp"),
    GIF("image/gif");

    private final String contentType;

    AttachmentKind(String contentType) {
        this.contentType = contentType;
    }

    /** @return the media type the file is uploaded and served with */
    public String contentType() {
        return contentType;
    }

    /**
     * The kind a declared content type names, ignoring case and parameters.
     *
     * @param contentType what the browser says the file is, such as {@code image/png}
     * @return the kind, or empty for a type that is not allowed
     */
    public static Optional<AttachmentKind> of(String contentType) {
        if (contentType == null) {
            return Optional.empty();
        }
        String bare = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values()).filter(kind -> kind.contentType.equals(bare)).findFirst();
    }
}
