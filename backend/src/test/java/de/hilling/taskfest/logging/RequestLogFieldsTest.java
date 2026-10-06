package de.hilling.taskfest.logging;

import java.security.Principal;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Pins down the two pure decisions behind {@link RequestLog}'s fields, without Quarkus: which
 * request id a header yields, and which name a user is logged under. {@link RequestLogTest} covers
 * the handler itself, in-JVM.
 */
class RequestLogFieldsTest {

    private static final String ROOT = "Root=1-67891233-abcdef012345678912345678";

    @Test
    void shouldTakeTheTraceRootFromTheLoadBalancersHeader() {
        assertEquals(ROOT, RequestLog.requestId("Self=1-67891234-12456789abcdef012345678;" + ROOT + ";Sampled=1"));
    }

    @Test
    void shouldMakeUpAnIdWhenTheHeaderIsMissingMalformedOrHuge() {
        assertEquals(36, RequestLog.requestId(null).length());
        assertNotEquals("anything", RequestLog.requestId("anything"));
        assertNotEquals(ROOT, RequestLog.requestId(ROOT + "x".repeat(1000)));
    }

    @Test
    void shouldLogANameWhenThereIsNoToken() {
        Principal named = () -> "alice";
        assertEquals("alice", RequestLog.subject(named));
    }

    @Test
    void shouldLogUnknownRatherThanNothing() {
        Principal nameless = () -> null;
        assertEquals("unknown", RequestLog.subject(nameless));
        assertEquals("unknown", RequestLog.subject(null));
    }
}
