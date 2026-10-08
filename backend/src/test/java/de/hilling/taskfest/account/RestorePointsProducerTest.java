package de.hilling.taskfest.account;

import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

/**
 * Which restore points the backend asks (#213): RDS's, for the instance configured in AWS, and
 * "unknown" -- keeping every record -- wherever none is.
 */
class RestorePointsProducerTest {

    private static AccountsConfig config(Optional<String> instance) {
        return new AccountsConfig() {
            @Override
            public boolean deletionsEnabled() {
                return true;
            }

            @Override
            public Optional<String> dbInstance() {
                return instance;
            }

            @Override
            public DeletionReplaySchedule deletionReplay() {
                return null;
            }
        };
    }

    @Test
    void shouldAskRdsAboutTheConfiguredInstance() {
        RestorePoints points = new RestorePointsProducer().restorePoints(config(Optional.of("taskfest-qa-db")),
            "eu-central-1");

        assertInstanceOf(RdsRestorePoints.class, points);
    }

    @Test
    void shouldKnowNothingWithoutAnInstance() {
        RestorePoints points = new RestorePointsProducer().restorePoints(config(Optional.empty()), "eu-central-1");

        assertEquals(Optional.empty(), points.oldest());
    }
}
