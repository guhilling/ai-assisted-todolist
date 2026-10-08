package de.hilling.taskfest.account;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.rds.RdsClient;

/**
 * Provides the {@link RestorePoints} of the environment's database: RDS's own, where an instance is
 * configured (in AWS), and "unknown" everywhere else, which keeps every deletion record.
 */
@ApplicationScoped
public class RestorePointsProducer {

    @Produces
    @ApplicationScoped
    RestorePoints restorePoints(AccountsConfig config,
                                @ConfigProperty(name = "quarkus.s3.aws.region") String region) {
        return config.dbInstance()
            .<RestorePoints>map(instance -> new RdsRestorePoints(RdsClient.builder()
                .region(Region.of(region))
                .httpClientBuilder(UrlConnectionHttpClient.builder())
                .build(), instance))
            .orElse(Optional::empty);
    }
}
