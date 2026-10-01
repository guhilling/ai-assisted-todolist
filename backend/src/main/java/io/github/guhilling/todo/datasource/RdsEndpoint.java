package io.github.guhilling.todo.datasource;

import java.net.URI;

/**
 * The host and port an IAM authentication token is signed for, taken from the JDBC URL.
 *
 * <p>Derived rather than configured a second time: RDS checks the token against the endpoint the
 * connection actually goes to, so a separately configured host that drifted from the URL would
 * fail as a bare authentication error with nothing to say why.</p>
 *
 * @param host the instance's DNS name, exactly as the connection uses it
 * @param port the port the connection uses
 */
public record RdsEndpoint(String host, int port) {

    /** PostgreSQL's default, which the JDBC driver also assumes when the URL names no port. */
    public static final int POSTGRES_PORT = 5432;

    private static final String PREFIX = "jdbc:postgresql:";

    /**
     * Reads the endpoint out of a PostgreSQL JDBC URL.
     *
     * @param jdbcUrl a {@code jdbc:postgresql://host[:port]/database} URL
     * @return the host and port the driver will connect to
     * @throws IllegalArgumentException if the URL is not a PostgreSQL one
     */
    public static RdsEndpoint fromJdbcUrl(String jdbcUrl) {
        if (!jdbcUrl.startsWith(PREFIX)) {
            throw new IllegalArgumentException("Not a PostgreSQL JDBC URL: " + jdbcUrl);
        }
        URI uri = URI.create(jdbcUrl.substring("jdbc:".length()));
        return new RdsEndpoint(uri.getHost(), uri.getPort() == -1 ? POSTGRES_PORT : uri.getPort());
    }
}
