package de.hilling.taskfest.attachment;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * The kinds of attachment a task may carry: the files of #204, D2 -- PDFs, and the images every
 * browser shows inline -- and links (#414), which are no file at all.
 *
 * <p>HEIC is left out although phones produce it: only Safari can show it, and D2 wants images
 * inline. SVG is left out on purpose: it is a document that can carry script, and S3 would serve it
 * as one.</p>
 *
 * <p>A link is its URL and title, kept in its row, with nothing in S3. Its type is the one for a
 * list of URLs, {@code text/uri-list}, and no upload is ever taken for it.</p>
 *
 * <p>Stored as the PostgreSQL enum {@code attachment_kind}; the names are the column's labels,
 * which {@code AttachmentEnumColumnTest} keeps in step.</p>
 */
public enum AttachmentKind {
    PDF("application/pdf"),
    JPEG("image/jpeg"),
    PNG("image/png"),
    WEBP("image/webp"),
    GIF("image/gif"),
    LINK("text/uri-list");

    private final String contentType;

    AttachmentKind(String contentType) {
        this.contentType = contentType;
    }

    /** @return whether it is a file, with its content in S3, rather than a link */
    public boolean isFile() {
        return this != LINK;
    }

    /** @return whether a row previews it as a picture, and so whether it may have a thumbnail (#236) */
    public boolean isImage() {
        return isFile() && this != PDF;
    }

    /** @return the media type the file is uploaded and served with */
    public String contentType() {
        return contentType;
    }

    /**
     * The kind of file a declared content type names, ignoring case and parameters. Never a link:
     * a file announced as one would be a link with an object and no URL.
     *
     * @param contentType what the browser says the file is, such as {@code image/png}
     * @return the kind, or empty for a type that is not allowed
     */
    public static Optional<AttachmentKind> of(String contentType) {
        if (contentType == null) {
            return Optional.empty();
        }
        String bare = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values()).filter(AttachmentKind::isFile)
            .filter(kind -> kind.contentType.equals(bare)).findFirst();
    }
}
